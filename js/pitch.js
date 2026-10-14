/* Fretbored — pitch detection (McLeod Pitch Method, with an FFT-based autocorrelation). */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  // In-place iterative radix-2 FFT for a fixed power-of-two size.
  function makeFFT(n) {
    const rev = new Uint32Array(n);
    const bits = Math.round(Math.log2(n));
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    return function fft(re, im, inverse) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i];
          re[i] = re[j];
          re[j] = t;
          t = im[i];
          im[i] = im[j];
          im[j] = t;
        }
      }
      const sgn = inverse ? 1 : -1;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j;
            const b = a + half;
            const wr = cos[k];
            const wi = sgn * sin[k];
            const tr = re[b] * wr - im[b] * wi;
            const ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
      if (inverse) {
        for (let i = 0; i < n; i++) {
          re[i] /= n;
          im[i] /= n;
        }
      }
    };
  }

  /**
   * Create a detector for analysis windows of `size` samples (a power of two).
   * detect(samples, sampleRate, minFreq, maxFreq) → { freq, clarity, rms } (freq 0 if none).
   */
  function createDetector(size) {
    const N = size;
    const M = N * 2; // zero-padded so the autocorrelation doesn't wrap around
    const fft = makeFFT(M);
    const re = new Float64Array(M);
    const im = new Float64Array(M);
    const x = new Float64Array(N);
    const nsdf = new Float64Array(N);
    const K = 0.9; // pick the first peak within 90% of the highest (avoids octave errors)

    return function detect(samples, sampleRate, minFreq, maxFreq) {
      let mean = 0;
      for (let i = 0; i < N; i++) mean += samples[i];
      mean /= N;
      let energy = 0;
      for (let i = 0; i < N; i++) {
        x[i] = samples[i] - mean;
        energy += x[i] * x[i];
      }
      const rms = Math.sqrt(energy / N);
      if (energy === 0) return { freq: 0, clarity: 0, rms };

      // Autocorrelation r(τ) via |FFT|².
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < N; i++) re[i] = x[i];
      fft(re, im, false);
      for (let k = 0; k < M; k++) {
        re[k] = re[k] * re[k] + im[k] * im[k];
        im[k] = 0;
      }
      fft(re, im, true);

      // Normalised square difference function: n(τ) = 2 r(τ) / m(τ).
      const maxLag = Math.min(N - 2, Math.ceil(sampleRate / minFreq) + 2);
      const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
      let m = 2 * energy;
      nsdf[0] = 1;
      for (let t = 1; t <= maxLag; t++) {
        m -= x[t - 1] * x[t - 1] + x[N - t] * x[N - t];
        nsdf[t] = m > 1e-12 ? (2 * re[t]) / m : 0;
      }

      // Key maxima: the highest point of each positive region after the first zero crossing.
      let t = 1;
      while (t < maxLag && nsdf[t] > 0) t++;
      const peaks = [];
      let inPos = false;
      let best = -1;
      for (; t < maxLag; t++) {
        if (nsdf[t] > 0) {
          if (!inPos) {
            inPos = true;
            best = -1;
          }
          if (best < 0 || nsdf[t] > nsdf[best]) best = t;
        } else if (inPos) {
          inPos = false;
          if (best >= minLag) peaks.push(best);
        }
      }
      if (inPos && best >= minLag && best < maxLag) peaks.push(best);
      if (!peaks.length) return { freq: 0, clarity: 0, rms };

      let highest = 0;
      for (const p of peaks) highest = Math.max(highest, nsdf[p]);
      const p = peaks.find((q) => nsdf[q] >= K * highest);

      // Parabolic interpolation for a sub-sample period.
      const a = nsdf[p - 1];
      const b = nsdf[p];
      const c = nsdf[p + 1];
      const denom = a - 2 * b + c;
      const shift = denom ? (a - c) / (2 * denom) : 0;
      const period = p + shift;
      const clarity = b - ((a - c) * shift) / 4;
      return { freq: sampleRate / period, clarity: Math.min(1, clarity), rms };
    };
  }

  const freqToMidi = (f, a4) => 69 + 12 * Math.log2(f / a4);
  const midiToFreq = (m, a4) => a4 * Math.pow(2, (m - 69) / 12);

  FS.pitch = { createDetector, makeFFT, freqToMidi, midiToFreq };
})();
