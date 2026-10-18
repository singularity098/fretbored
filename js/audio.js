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

  function makePluck(midi) {
    const c = getCtx();
    const sr = c.sampleRate;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(sr * 2.4);
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const exact = sr / freq;
    // The two-point average in the loop adds half a sample of delay.
    const P = Math.max(2, Math.round(exact - 0.5));
    const rho = Math.pow(0.001, 1 / (freq * 3.2)); // ~-60 dB after 3.2 s
    let prev = 0;
    for (let i = 0; i < P; i++) {
      const r = Math.random() * 2 - 1;
      d[i] = 0.6 * r + 0.4 * prev; // slightly darkened pick noise
      prev = d[i];
    }
    for (let i = P; i < len; i++) {
      d[i] = rho * 0.5 * (d[i - P] + (i - P - 1 >= 0 ? d[i - P - 1] : 0));
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak ? 0.9 / peak : 1;
    const fade = Math.floor(sr * 0.3);
    const attack = Math.floor(sr * 0.0015); // soften the pick transient
    for (let i = 0; i < len; i++) {
      d[i] *= norm;
      if (i < attack) d[i] *= i / attack;
      if (i > len - fade) d[i] *= (len - i) / fade;
    }
    return { buffer: buf, rate: (P + 0.5) / exact };
  }

  function getPluck(midi) {
    let p = pluckCache.get(midi);
    if (!p) {
      p = makePluck(midi);
      pluckCache.set(midi, p);
    }
    return p;
  }

  // Render any uncached notes now, so scheduling a phrase isn't delayed by synthesis.
  function prepare(midis) {
    midis.forEach(getPluck);
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
  let toneChain = null; // { id, input }

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

  function toneInput(c) {
    const fb = FS.settings && FS.settings.fretboard;
    const id = fb && FS.TONES.some((x) => x[0] === fb.tone) ? fb.tone : 'clean';
    if (!toneChain || toneChain.id !== id) {
      const old = toneChain;
      toneChain = buildTone(c, id);
      // Let notes already playing through the old chain ring out, then free it.
      if (old && old.nodes) setTimeout(() => old.nodes.forEach((n) => n.disconnect()), 4000);
    }
    return toneChain.input;
  }

  // opts.clean: bypass the guitar tone (the tuner's reference notes).
  function playNote(midi, when, duration, gain, opts) {
    const c = getCtx();
    const p = getPluck(midi);
    const src = c.createBufferSource();
    src.buffer = p.buffer;
    src.playbackRate.value = p.rate;
    const g = c.createGain();
    const t = Math.max(when, c.currentTime);
    const dur = duration || 1.6;
    g.gain.setValueAtTime(gain === undefined ? 0.5 : gain, t);
    g.gain.setValueAtTime(gain === undefined ? 0.5 : gain, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    src.connect(g).connect(opts && opts.clean ? master : toneInput(c));
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

  // buildTone is exposed so tests can render a tone offline and compare levels.
  FS.audio = { ctx: getCtx, playNote, prepare, loadSamples, playSample, playBuffer, samples, buildTone };
})();
