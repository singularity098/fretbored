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
      ctx = new AC({ latencyHint: 'interactive' });
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
    for (let i = 0; i < len; i++) {
      d[i] *= norm;
      if (i > len - fade) d[i] *= (len - i) / fade;
    }
    return { buffer: buf, rate: (P + 0.5) / exact };
  }

  function playNote(midi, when, duration, gain) {
    const c = getCtx();
    let p = pluckCache.get(midi);
    if (!p) {
      p = makePluck(midi);
      pluckCache.set(midi, p);
    }
    const src = c.createBufferSource();
    src.buffer = p.buffer;
    src.playbackRate.value = p.rate;
    const g = c.createGain();
    const t = Math.max(when, c.currentTime);
    const dur = duration || 1.6;
    g.gain.setValueAtTime(gain === undefined ? 0.5 : gain, t);
    g.gain.setValueAtTime(gain === undefined ? 0.5 : gain, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    src.connect(g).connect(master);
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
    return new Promise((resolve, reject) => c.decodeAudioData(bytes.buffer, resolve, reject));
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

  FS.audio = { ctx: getCtx, playNote, loadSamples, playSample, samples };
})();
