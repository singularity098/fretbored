/* Fretbored — Web Audio: shared context, plucked-string synth, embedded click samples. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  let ctx = null;
  let master = null;
  const pluckCache = new Map();
  let samplesPromise = null;
  const samples = {};

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      // Everything is scheduled ahead of time, so a larger output buffer costs nothing in
      // accuracy and avoids the underruns ("crackles") that tiny buffers cause under load.
      ctx = new AC({ latencyHint: 'playback' });
      master = ctx.createDynamicsCompressor();
      master.threshold.value = -10;
      master.knee.value = 6;
      master.ratio.value = 4;
      master.connect(ctx.destination);
      // Let iOS play Web Audio even when the ringer switch is on silent.
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch (e) {
        /* not supported */
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ---- Karplus–Strong plucked string, rendered once per MIDI note and cached ---- */

  // muted: palm mute — the string is damped at the bridge, so the note dies within a few tenths of
  // a second, sounds darker and has a softer attack.
  function makePluck(midi, muted) {
    const c = getCtx();
    const sr = c.sampleRate;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(sr * (muted ? 0.9 : 2.4));
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const exact = sr / freq;
    // The two-point average in the loop adds half a sample of delay.
    const P = Math.max(2, Math.round(exact - 0.5));
    const rho = Math.pow(0.001, 1 / (freq * (muted ? 0.3 : 3.2))); // ~-60 dB after 3.2 s (0.3 s muted)
    let prev = 0;
    for (let i = 0; i < P; i++) {
      const r = Math.random() * 2 - 1;
      d[i] = muted ? 0.3 * r + 0.7 * prev : 0.6 * r + 0.4 * prev; // darkened pick noise (more when muted)
      prev = d[i];
    }
    for (let i = P; i < len; i++) {
      d[i] = rho * 0.5 * (d[i - P] + (i - P - 1 >= 0 ? d[i - P - 1] : 0));
    }
    if (muted) {
      // The palm also soaks up the highs: a gentle one-pole low-pass over the whole note.
      let y = 0;
      for (let i = 0; i < len; i++) d[i] = y += 0.3 * (d[i] - y);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak ? 0.9 / peak : 1;
    const fade = Math.floor(sr * (muted ? 0.1 : 0.3));
    const attack = Math.floor(sr * (muted ? 0.004 : 0.0015)); // soften the pick transient
    for (let i = 0; i < len; i++) {
      d[i] *= norm;
      if (i < attack) d[i] *= i / attack;
      if (i > len - fade) d[i] *= (len - i) / fade;
    }
    return { buffer: buf, rate: (P + 0.5) / exact };
  }

  const palmMuted = () => !!(FS.settings && FS.settings.fretboard && FS.settings.fretboard.palmMute);

  function getPluck(midi, muted) {
    const key = `${midi}:${muted ? 'm' : ''}`;
    let p = pluckCache.get(key);
    if (!p) {
      p = makePluck(midi, muted);
      pluckCache.set(key, p);
    }
    return p;
  }

  // Render any uncached notes now, so scheduling a phrase isn't delayed by synthesis.
  function prepare(midis) {
    const m = palmMuted();
    midis.forEach((x) => getPluck(x, m));
  }

  /*
   * Guitar tones. Notes go through one shared amp chain (so a strummed chord distorts as a whole,
   * like a real amp): pre-gain → wave-shaper (soft clip for overdrive, hard for distortion) →
   * EQ / speaker-cabinet low-pass → output level matched to the clean sound.
   */
  FS.TONES = [
    ['clean', 'Clean'],
    ['overdrive', 'Overdriven'],
    ['distortion', 'Distortion'],
  ];

  function clipCurve(kind) {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      if (kind === 'overdrive') curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); // warm, tube-like
      else {
        // Harder, slightly asymmetric clip for distortion.
        const y = x >= 0 ? x : x * 0.85;
        curve[i] = Math.tanh(9 * y) / Math.tanh(9);
      }
    }
    return curve;
  }

  function buildTone(c, id, dest) {
    dest = dest || master;
    if (id === 'clean') return { id, input: dest };
    const drive = id === 'overdrive';
    const input = c.createGain();
    const hp = c.createBiquadFilter(); // tighten the lows before clipping
    hp.type = 'highpass';
    hp.frequency.value = drive ? 70 : 110;
    const pre = c.createGain();
    pre.gain.value = drive ? 3 : 9;
    const shaper = c.createWaveShaper();
    shaper.curve = clipCurve(id);
    shaper.oversample = '4x';
    const mid = c.createBiquadFilter(); // distortion: scooped mids; overdrive: a little mid push
    mid.type = 'peaking';
    mid.frequency.value = drive ? 900 : 650;
    mid.Q.value = 0.9;
    mid.gain.value = drive ? 2.5 : -5;
    const cab = c.createBiquadFilter(); // 4x12-ish speaker roll-off
    cab.type = 'lowpass';
    cab.frequency.value = drive ? 4800 : 4000;
    cab.Q.value = 0.8;
    const out = c.createGain();
    out.gain.value = drive ? 0.27 : 0.17; // roughly level-matched to clean (a little louder, as amps are)
    input.connect(hp).connect(pre).connect(shaper).connect(mid).connect(cab).connect(out).connect(dest);
    return { id, input, nodes: [input, hp, pre, shaper, mid, cab, out] };
  }

  /*
   * Effects after the amp: delay (repeats get darker, like an analog delay) and reverb (a
   * generated impulse response — decaying noise, so no sound files). Delay also feeds the reverb.
   * Nothing is built while they're off, so they cost nothing then.
   */
  FS.REVERBS = [
    ['off', 'Off'],
    ['room', 'Room'],
    ['hall', 'Hall'],
  ];
  FS.DELAYS = [
    ['off', 'Off'],
    ['slap', 'Slapback'],
    ['echo', 'Echo'],
  ];
  const REVERB = { room: { secs: 1.1, wet: 0.4 }, hall: { secs: 2.8, wet: 0.42 } };
  const DELAY = { slap: { time: 0.11, feedback: 0.12, wet: 0.32 }, echo: { time: 0.36, feedback: 0.38, wet: 0.3 } };
  const irCache = new WeakMap(); // per AudioContext: { room, hall }

  function impulse(c, kind) {
    let per = irCache.get(c);
    if (!per) irCache.set(c, (per = {}));
    if (per[kind]) return per[kind];
    const { secs } = REVERB[kind];
    const sr = c.sampleRate;
    const len = Math.floor(sr * secs);
    const buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Noise with an exponential decay; low-passed more as it fades (air absorbs the highs).
        const x = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * Math.exp(-4 * t);
        lp += (0.55 - 0.4 * t) * (x - lp);
        d[i] = i < sr * 0.004 ? lp * (i / (sr * 0.004)) : lp;
      }
    }
    return (per[kind] = buf);
  }

  // The whole guitar chain for the current settings: tone → delay/reverb → dest.
  function buildChain(c, o, dest) {
    dest = dest || master;
    const nodes = [];
    const node = (n) => (nodes.push(n), n);
    let fxIn = dest;
    if ((o.reverb && o.reverb !== 'off') || (o.delay && o.delay !== 'off')) {
      fxIn = node(c.createGain());
      fxIn.connect(dest); // dry
      let reverbIn = null;
      if (REVERB[o.reverb]) {
        const conv = node(c.createConvolver());
        conv.buffer = impulse(c, o.reverb);
        const wet = node(c.createGain());
        wet.gain.value = REVERB[o.reverb].wet;
        fxIn.connect(conv).connect(wet).connect(dest);
        reverbIn = conv;
      }
      if (DELAY[o.delay]) {
        const p = DELAY[o.delay];
        const dl = node(c.createDelay(1));
        dl.delayTime.value = p.time;
        const tone = node(c.createBiquadFilter());
        tone.type = 'lowpass';
        tone.frequency.value = 2800;
        const fb = node(c.createGain());
        fb.gain.value = p.feedback;
        const wet = node(c.createGain());
        wet.gain.value = p.wet;
        fxIn.connect(dl);
        dl.connect(tone).connect(fb).connect(dl); // feedback loop
        tone.connect(wet).connect(dest);
        if (reverbIn) wet.connect(reverbIn);
      }
    }
    const tone = buildTone(c, o.tone || 'clean', fxIn);
    return { input: tone.input, nodes: nodes.concat(tone.nodes || []) };
  }

  let chain = null; // { key, input, nodes }
  function chainInput(c) {
    const fb = (FS.settings && FS.settings.fretboard) || {};
    const pick = (list, v) => (list.some((x) => x[0] === v) ? v : 'off');
    const o = { tone: FS.TONES.some((x) => x[0] === fb.tone) ? fb.tone : 'clean', reverb: pick(FS.REVERBS, fb.reverb), delay: pick(FS.DELAYS, fb.delay) };
    const key = `${o.tone}|${o.reverb}|${o.delay}`;
    if (!chain || chain.key !== key) {
      const old = chain;
      chain = { key, ...buildChain(c, o) };
      // Let notes (and reverb tails) already in the old chain ring out, then free it.
      if (old) setTimeout(() => old.nodes.forEach((n) => n.disconnect()), 6000);
    }
    return chain.input;
  }

  // opts.clean: plain, unmuted note straight to the output — no tone, palm mute or effects (the
  // tuner's reference notes).
  function playNote(midi, when, duration, gain, opts) {
    const c = getCtx();
    const clean = !!(opts && opts.clean);
    const muted = !clean && palmMuted();
    const p = getPluck(midi, muted);
    const src = c.createBufferSource();
    src.buffer = p.buffer;
    src.playbackRate.value = p.rate;
    const g = c.createGain();
    const t = Math.max(when, c.currentTime);
    const dur = duration || 1.6;
    // Palm-muted notes lose their highs (and loudness): bring them back up to match open notes.
    const level = (gain === undefined ? 0.5 : gain) * (muted ? 1.8 : 1);
    g.gain.setValueAtTime(level, t);
    g.gain.setValueAtTime(level, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    src.connect(g).connect(clean ? master : chainInput(c));
    src.start(t);
    src.stop(t + dur + 0.3);
    return src;
  }

  /* ---- Click samples ---- */

  function decode(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const c = getCtx();
    // Callback form for older Safari.
    return new Promise((resolve, reject) => c.decodeAudioData(bytes.buffer, resolve, reject)).then(smoothEdges);
  }

  // Some samples start or end on a non-zero value (the classic clicks are cut off
  // mid-decay), which pops. Fade the first 0.5 ms and last 6 ms to zero.
  function smoothEdges(buf) {
    const fadeIn = Math.floor(buf.sampleRate * 0.0005);
    const fadeOut = Math.min(Math.floor(buf.sampleRate * 0.006), Math.floor(buf.length / 3));
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      const n = d.length;
      for (let i = 0; i < fadeIn; i++) d[i] *= i / fadeIn;
      for (let i = 0; i < fadeOut; i++) d[n - 1 - i] *= i / fadeOut;
    }
    return buf;
  }

  function beep(freq, dur) {
    const c = getCtx();
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / c.sampleRate;
      const env = Math.min(1, i / 40) * Math.exp(-t * 60);
      d[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.9;
    }
    return buf;
  }

  function loadSamples() {
    if (!samplesPromise) {
      const S = FS.SOUNDS || {};
      samplesPromise = Promise.all(
        Object.entries(S).map(([k, b64]) =>
          decode(b64).then((buf) => {
            samples[k] = buf;
          })
        )
      ).then(() => {
        samples.beepHigh = beep(1760, 0.06);
        samples.beepMid = beep(1100, 0.06);
        samples.beepLow = beep(880, 0.05);
        return samples;
      });
    }
    return samplesPromise;
  }

  function playSample(name, when, gain) {
    const c = getCtx();
    const buf = samples[name];
    if (!buf) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(c.destination);
    src.start(when);
    return src;
  }

  // Play a pre-mixed buffer whose gain is already baked in (one node instead of two).
  function playBuffer(buf, when) {
    const src = getCtx().createBufferSource();
    src.buffer = buf;
    src.connect(getCtx().destination);
    src.start(when);
    return src;
  }

  // buildTone / buildChain / pluck are exposed so tests can render offline and check the sound.
  const pluck = (midi, muted) => getPluck(midi, muted).buffer;
  FS.audio = { ctx: getCtx, playNote, prepare, loadSamples, playSample, playBuffer, samples, buildTone, buildChain, pluck };
})();
