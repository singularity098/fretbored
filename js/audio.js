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
   * Guitar tones. Notes go through one shared amp chain (so a strummed chord breaks up as a whole,
   * like a real amp): high-pass → pre-gain → soft tanh clip (tube-like overdrive) → mid push →
   * speaker-cabinet low-pass → output level matched to the clean sound. (A heavier Distortion
   * tone was tried and removed at the owner's request — too messy.)
   */
  FS.TONES = [
    ['clean', 'Clean'],
    ['overdrive', 'Overdriven'],
  ];

  function clipCurve() {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); // warm, tube-like
    }
    return curve;
  }

  function buildTone(c, id, dest) {
    dest = dest || master;
    if (id !== 'overdrive') return { id: 'clean', input: dest };
    const input = c.createGain();
    const hp = c.createBiquadFilter(); // tighten the lows before clipping
    hp.type = 'highpass';
    hp.frequency.value = 70;
    const pre = c.createGain();
    pre.gain.value = 3;
    const shaper = c.createWaveShaper();
    shaper.curve = clipCurve();
    shaper.oversample = '4x';
    const mid = c.createBiquadFilter(); // a little mid push
    mid.type = 'peaking';
    mid.frequency.value = 900;
    mid.Q.value = 0.9;
    mid.gain.value = 2.5;
    const cab = c.createBiquadFilter(); // speaker roll-off
    cab.type = 'lowpass';
    cab.frequency.value = 4800;
    cab.Q.value = 0.8;
    const out = c.createGain();
    out.gain.value = 0.27; // roughly level-matched to clean (a little louder, as amps are)
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
    return { src, gain: g, when: t };
  }

  // Cuts a note from playNote short. Notes are queued on the audio clock up front, so stopping the
  // timers that highlight them is not enough: a note not yet started never sounds, and one that is
  // sounding fades out over a few ms (an abrupt cut would click).
  function stopNote(note) {
    const now = getCtx().currentTime;
    if (note.when > now) {
      note.src.stop(now);
      return;
    }
    note.gain.gain.cancelScheduledValues(now);
    note.gain.gain.setTargetAtTime(0, now, 0.004);
    note.src.stop(now + 0.03);
  }

  /* ---- Click sounds ---- */

  // All generated in code at the context's rate, the same formulas as the NAMsayin plugin's metronome
  // (src/engine/metronome/Metronome.cpp), so both sound identical.
  function makeBuffer(seconds, fn) {
    const c = getCtx();
    const sr = c.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = fn(i, i / sr, sr, len);
    return buf;
  }

  // Classic: a tone with its 2nd and 3rd harmonics (0.5 : 0.15 : 0.05) decaying with a 50 ms time
  // constant, cut off after 50 ms; 0.5 ms and 6 ms fades soften the start and keep the cut from popping.
  // (Fitted exactly from the WAV samples the app used to embed.)
  function classicClick(freq) {
    return makeBuffer(0.05, (i, t, sr, len) => {
      const w = 2 * Math.PI * freq * t;
      const tone = 0.5 * Math.sin(w) + 0.15 * Math.sin(2 * w) + 0.05 * Math.sin(3 * w);
      const fade = Math.min(1, i / (sr * 0.0005), (len - i) / Math.floor(sr * 0.006));
      return tone * Math.exp(-t / 0.05) * fade;
    });
  }

  // Digital: a short band-limited square wave (odd harmonics up to near Nyquist), held briefly, then a fast decay.
  function digitalClick(freq) {
    return makeBuffer(0.06, (i, t, sr) => {
      let square = 0;
      for (let k = 1; k * freq < 0.45 * sr; k += 2) square += Math.sin(2 * Math.PI * k * freq * t) / k;
      const env = Math.min(1, i / 20) * (t < 0.02 ? 1 : Math.exp(-(t - 0.02) * 120));
      return square * (4 / Math.PI) * env * 0.45;
    });
  }

  function beep(freq, dur) {
    return makeBuffer(dur, (i, t) => Math.sin(2 * Math.PI * freq * t) * Math.min(1, i / 40) * Math.exp(-t * 60) * 0.9);
  }

  function loadSamples() {
    if (!samplesPromise) {
      samples.high = classicClick(1500);
      samples.low = classicClick(1000);
      samples.digitalHigh = digitalClick(1975.5); // B6
      samples.digitalLow = digitalClick(1318.5); // E6
      samples.beepHigh = beep(1760, 0.06);
      samples.beepMid = beep(1100, 0.06);
      samples.beepLow = beep(880, 0.05);
      samplesPromise = Promise.resolve(samples);
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
  FS.audio = { ctx: getCtx, playNote, stopNote, prepare, loadSamples, playSample, playBuffer, samples, buildTone, buildChain, pluck };
})();
