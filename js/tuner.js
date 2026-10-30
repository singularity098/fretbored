/* Fretbored — Tuner tab: microphone pitch detection with needle and strobe displays. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);
  const NS = 'http://www.w3.org/2000/svg';

  const IN_TUNE = 2; // cents
  const CLOSE = 10;
  const HOLD_MS = 1500; // keep showing the last note this long after the sound stops
  const STROBE_ROWS = [1, 2, 4]; // fundamental and two octaves, like a Peterson strobe

  FS.initTuner = function (panel) {
    const t = FS.theory;
    const P = FS.pitch;
    const st = FS.settings.tuner;

    /* ---------------------------------------------------------------- State */

    const eng = {
      running: false,
      stream: null,
      source: null,
      analyser: null,
      buf: null,
      size: 0,
      detect: null,
      raf: 0,
      hist: [],
      cents: 0,
      target: null, // { midi, string }
      lastSeen: 0,
      lastFrame: 0,
      phase: STROBE_ROWS.map(() => 0),
      wake: null,
    };

    /* ---------------------------------------------------------------- DOM */

    const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Display' });
    for (const [v, label] of [['needle', 'Traditional'], ['strobe', 'Strobe']]) {
      modeSeg.append(h('button', { dataset: { v }, onclick: () => { st.mode = v; FS.save(); renderControls(); } }, label));
    }
    const targetSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Target' });
    for (const [v, label] of [['instrument', 'Instrument'], ['chromatic', 'Chromatic']]) {
      targetSeg.append(h('button', { dataset: { v }, onclick: () => { st.target = v; st.lock = -1; resetReading(); FS.save(); renderControls(); } }, label));
    }

    const a4Val = h('span', { class: 'stepper-val wide' });
    const a4Stepper = h('div', { class: 'stepper' },
      h('button', { class: 'btn round small', 'aria-label': 'Lower reference pitch', onclick: () => setA4(st.a4 - 1) }, '−'),
      a4Val,
      h('button', { class: 'btn round small', 'aria-label': 'Raise reference pitch', onclick: () => setA4(st.a4 + 1) }, '+')
    );
    const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': 'Sensitivity' });
    sens.addEventListener('input', () => { st.sensitivity = +sens.value; FS.save(); });

    const noteEl = h('div', { class: 'tn-note' });
    const subEl = h('div', { class: 'tn-sub' });
    const centsEl = h('div', { class: 'tn-cents' });
    const freqEl = h('div', { class: 'tn-freq' });
    const statusEl = h('div', { class: 'tn-status' });

    // Needle gauge
    const gauge = document.createElementNS(NS, 'svg');
    gauge.setAttribute('viewBox', '0 0 320 186');
    gauge.setAttribute('class', 'tn-gauge');
    const polar = (r, deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [160 + r * Math.cos(a), 166 + r * Math.sin(a)];
    };
    const arc = (r, d0, d1) => {
      const [x0, y0] = polar(r, d0);
      const [x1, y1] = polar(r, d1);
      return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
    };
    const ang = (c) => (Math.max(-50, Math.min(50, c)) / 50) * 62;
    let g = `<path class="tn-arc" d="${arc(140, -62, 62)}"/>`;
    g += `<path class="tn-zone" d="${arc(140, ang(-IN_TUNE * 2), ang(IN_TUNE * 2))}"/>`;
    for (let c = -50; c <= 50; c += 5) {
      const major = c % 25 === 0;
      const [x0, y0] = polar(major ? 122 : 130, ang(c));
      const [x1, y1] = polar(146, ang(c));
      g += `<line class="tn-tick${major ? ' major' : ''}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
      if (major) {
        const [lx, ly] = polar(108, ang(c));
        g += `<text class="tn-label" x="${lx}" y="${ly}">${c > 0 ? '+' + c : c}</text>`;
      }
    }
    g += `<text class="tn-flat" x="22" y="176">♭</text><text class="tn-sharp" x="298" y="176">♯</text>`;
    g += '<g class="tn-needle"><line x1="160" y1="166" x2="160" y2="34"/><circle cx="160" cy="166" r="7"/></g>';
    gauge.innerHTML = g;
    const needle = gauge.querySelector('.tn-needle');

    // Strobe
    const strobe = h('canvas', { class: 'tn-strobe', 'aria-label': 'Strobe display' });
    const needleView = h('div', { class: 'tn-view needle-view' }, gauge);
    const strobeView = h('div', { class: 'tn-view strobe-view' }, strobe);

    const startBtn = h('button', { class: 'btn primary tn-start', onclick: () => (eng.running ? stop() : start()) });
    const micMsg = h('p', { class: 'muted small center tn-msg' });

    const stringRow = h('div', { class: 'tn-strings', role: 'group', 'aria-label': 'Strings' });
    const refBtn = h('button', { class: 'btn ghost small', onclick: () => playReference(), title: 'Play the target note' }, '♪ Reference tone');

    const field = (label, ...ctl) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), ...ctl);

    panel.append(
      h('div', { class: 'tuner-layout' },
        h('div', { class: 'card tn-main' },
          h('div', { class: 'tn-head' }, noteEl, subEl),
          needleView,
          strobeView,
          h('div', { class: 'tn-readout' }, centsEl, statusEl, freqEl),
          stringRow,
          h('div', { class: 'tn-actions' }, refBtn, startBtn),
          micMsg
        ),
        h('div', { class: 'card tn-side' },
          h('h3', { class: 'section-title' }, 'Display'),
          modeSeg,
          h('h3', { class: 'section-title' }, 'Tune to'),
          targetSeg,
          h('h3', { class: 'section-title' }, 'Calibration'),
          h('div', { class: 'inline wrap gap-lg' }, field('Reference A4', a4Stepper), field('Sensitivity', sens)),
          h('p', { class: 'muted small' }, 'Raise sensitivity in a quiet room or for a quiet instrument; lower it if background noise makes the reading jump. Audio is analysed on your device and never leaves it.')
        )
      )
    );

    /* ---------------------------------------------------------------- Helpers */

    const tuningNotes = () => FS.currentTuning().notes;
    const a4Offset = () => 12 * Math.log2(st.a4 / 440); // in semitones, for the reference tone
    const noteName = (midi) => t.pretty(t.SHARP[t.mod12(midi)]);
    const octave = (midi) => Math.floor(midi / 12) - 1;

    function setA4(v) {
      st.a4 = Math.max(415, Math.min(466, v));
      FS.save();
      resetReading();
      renderControls();
    }

    function resetReading() {
      eng.hist = [];
      eng.target = null;
    }

    function analysisSize() {
      // Low bass notes need a longer window to fit a couple of periods.
      const low = Math.min(...tuningNotes());
      return st.target === 'instrument' && P.midiToFreq(low, st.a4) > 60 ? 4096 : 8192;
    }

    /* ---------------------------------------------------------------- Microphone */

    async function start() {
      micMsg.textContent = '';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        micMsg.textContent = 'This browser can’t access the microphone here. The tuner needs a secure page (https).';
        return;
      }
      try {
        eng.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        micMsg.textContent =
          e && e.name === 'NotAllowedError'
            ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.'
            : 'Couldn’t open the microphone' + (e && e.message ? `: ${e.message}` : '.');
        return;
      }
      const ctx = FS.audio.ctx();
      if (ctx.state !== 'running') await ctx.resume();
      eng.source = ctx.createMediaStreamSource(eng.stream);
      eng.analyser = ctx.createAnalyser();
      configureAnalyser();
      eng.source.connect(eng.analyser);
      eng.running = true;
      resetReading();
      eng.lastFrame = performance.now();
      try {
        if (navigator.wakeLock) eng.wake = await navigator.wakeLock.request('screen');
      } catch (e) {
        eng.wake = null;
      }
      renderControls();
      eng.raf = requestAnimationFrame(frame);
    }

    function configureAnalyser() {
      const size = analysisSize();
      if (size === eng.size && eng.analyser.fftSize === size) return;
      eng.size = size;
      eng.analyser.fftSize = size;
      eng.buf = new Float32Array(size);
      eng.detect = P.createDetector(size);
      resetReading();
    }

    function stop() {
      if (!eng.running) return;
      eng.running = false;
      cancelAnimationFrame(eng.raf);
      try {
        eng.source.disconnect();
      } catch (e) {
        /* already disconnected */
      }
      eng.stream.getTracks().forEach((tr) => tr.stop());
      eng.stream = eng.source = eng.analyser = null;
      eng.size = 0;
      if (eng.wake) eng.wake.release().catch(() => {});
      eng.wake = null;
      resetReading();
      renderControls();
      renderIdle();
    }

    /* ---------------------------------------------------------------- Analysis */

    function analyse(now) {
      const ctx = FS.audio.ctx();
      eng.analyser.getFloatTimeDomainData(eng.buf);
      const notes = tuningNotes();
      const minF = Math.max(25, Math.min(60, P.midiToFreq(Math.min(...notes), st.a4) * 0.75));
      const r = eng.detect(eng.buf, ctx.sampleRate, minF, 1500);
      const gate = 0.02 * Math.pow(1 - st.sensitivity, 2) + 0.0008;
      if (!r.freq || r.rms < gate || r.clarity < 0.85) return;

      // Median of recent readings; start over when the note clearly changes.
      if (eng.hist.length) {
        const med = median(eng.hist);
        if (Math.abs(1200 * Math.log2(r.freq / med)) > 60) eng.hist = [];
      }
      eng.hist.push(r.freq);
      if (eng.hist.length > 7) eng.hist.shift();
      const f = median(eng.hist);
      const midi = P.freqToMidi(f, st.a4);

      // Target note: nearest semitone, or a string of the tuning (locked, or nearest with hysteresis).
      let target;
      if (st.target === 'chromatic') target = { midi: Math.round(midi), string: -1 };
      else if (st.lock >= 0 && st.lock < notes.length) target = { midi: notes[st.lock], string: st.lock };
      else {
        let bestS = 0;
        notes.forEach((n, s) => {
          if (Math.abs(midi - n) < Math.abs(midi - notes[bestS])) bestS = s;
        });
        const cur = eng.target && eng.target.string >= 0 ? eng.target.string : -1;
        if (cur >= 0 && cur < notes.length && Math.abs(midi - notes[cur]) < Math.abs(midi - notes[bestS]) + 0.5) bestS = cur;
        target = { midi: notes[bestS], string: bestS };
      }
      const c = (midi - target.midi) * 100;
      if (!eng.target || eng.target.midi !== target.midi || eng.target.string !== target.string) eng.cents = c;
      else eng.cents += (c - eng.cents) * 0.35;
      eng.target = target;
      eng.freq = f;
      eng.lastSeen = now;
    }

    function median(a) {
      const s = a.slice().sort((x, y) => x - y);
      return s[s.length >> 1];
    }

    /* ---------------------------------------------------------------- Rendering */

    function frame(now) {
      if (!eng.running) return;
      const dt = Math.min(0.1, (now - eng.lastFrame) / 1000);
      eng.lastFrame = now;
      analyse(now);
      const active = eng.target && now - eng.lastSeen < HOLD_MS;
      render(active, dt);
      eng.raf = requestAnimationFrame(frame);
    }

    function render(active, dt) {
      const c = active ? eng.cents : 0;
      const abs = Math.abs(c);
      const state = !active ? 'idle' : abs <= IN_TUNE ? 'tuned' : abs <= CLOSE ? 'close' : 'off';
      panel.querySelector('.tn-main').dataset.state = state;

      if (eng.target) {
        noteEl.innerHTML = `${noteName(eng.target.midi)}<sub>${octave(eng.target.midi)}</sub>`;
        subEl.textContent = eng.target.string >= 0 ? `String ${tuningNotes().length - eng.target.string}` : 'Chromatic';
        centsEl.textContent = `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(1)} ¢`;
        freqEl.textContent = `${eng.freq.toFixed(1)} Hz`;
        statusEl.textContent = !active ? 'Play a note' : state === 'tuned' ? 'In tune' : c < 0 ? 'Tune up ↑' : 'Tune down ↓';
      }
      needle.style.transform = `rotate(${ang(c)}deg)`;
      highlightString(active ? eng.target.string : -1);
      if (st.mode === 'strobe') drawStrobe(active ? c : 0, dt, state);
    }

    function renderIdle() {
      noteEl.innerHTML = '—';
      subEl.textContent = st.target === 'chromatic' ? 'Chromatic' : FS.currentTuning().name;
      centsEl.textContent = '';
      freqEl.textContent = '';
      statusEl.textContent = eng.running ? 'Play a note' : 'Tap Start to use the microphone';
      needle.style.transform = 'rotate(0deg)';
      panel.querySelector('.tn-main').dataset.state = 'idle';
      highlightString(-1);
      if (st.mode === 'strobe') drawStrobe(0, 0, 'idle');
    }

    function drawStrobe(cents, dt, state) {
      const dpr = window.devicePixelRatio || 1;
      const w = strobe.clientWidth;
      const hgt = strobe.clientHeight;
      if (!w || !hgt) return;
      if (strobe.width !== Math.round(w * dpr) || strobe.height !== Math.round(hgt * dpr)) {
        strobe.width = Math.round(w * dpr);
        strobe.height = Math.round(hgt * dpr);
      }
      const g2 = strobe.getContext('2d');
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.clearRect(0, 0, w, hgt);
      const css = getComputedStyle(strobe);
      const on = css.getPropertyValue(state === 'tuned' ? '--tn-good' : state === 'idle' ? '--tn-idle' : '--tn-band').trim() || '#3dd6c3';
      const rowH = hgt / STROBE_ROWS.length;
      // Band speed in px/s per cent; doubles each octave row like a real strobe.
      const speed = 5;
      STROBE_ROWS.forEach((mult, i) => {
        eng.phase[i] += cents * speed * mult * dt;
        const period = 56 / mult + 12;
        const off = ((eng.phase[i] % period) + period) % period;
        g2.fillStyle = on;
        g2.globalAlpha = 0.95 - i * 0.18;
        for (let x = off - period; x < w; x += period) g2.fillRect(x, i * rowH + 3, period / 2, rowH - 6);
      });
      g2.globalAlpha = 1;
    }

    function highlightString(s) {
      [...stringRow.children].forEach((b) => {
        const i = +b.dataset.s;
        b.classList.toggle('detected', i === s && i >= 0);
        b.classList.toggle('active', i === st.lock);
      });
    }

    function renderStrings() {
      const notes = tuningNotes();
      stringRow.innerHTML = '';
      stringRow.hidden = st.target !== 'instrument';
      stringRow.append(h('button', { class: 'pill' + (st.lock < 0 ? ' auto-on' : ''), dataset: { s: -1 }, onclick: () => { st.lock = -1; FS.save(); resetReading(); renderStrings(); } }, 'Auto'));
      notes.forEach((m, s) => {
        stringRow.append(
          h('button', {
            class: 'pill tn-string',
            dataset: { s },
            title: `String ${notes.length - s}`,
            onclick: () => { st.lock = st.lock === s ? -1 : s; FS.save(); resetReading(); renderStrings(); },
          }, h('span', null, noteName(m)), h('sub', null, String(octave(m))))
        );
      });
      highlightString(-1);
    }

    function renderControls() {
      modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.mode));
      targetSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.target));
      a4Val.textContent = `${st.a4} Hz`;
      sens.value = st.sensitivity;
      needleView.hidden = st.mode !== 'needle';
      strobeView.hidden = st.mode !== 'strobe';
      startBtn.innerHTML = eng.running ? '■ Stop' : '🎤 Start tuner';
      startBtn.classList.toggle('running', eng.running);
      renderStrings();
      if (eng.running) configureAnalyser();
      else renderIdle();
    }

    function playReference() {
      const notes = tuningNotes();
      let midi;
      if (eng.target) midi = eng.target.midi;
      else if (st.target === 'instrument') midi = notes[st.lock >= 0 ? st.lock : 0];
      else midi = 69;
      const ctx = FS.audio.ctx();
      FS.audio.playNote(midi + a4Offset(), ctx.currentTime + 0.03, 2.2, 0.5, { clean: true }); // reference tones stay clean
    }

    /* ---------------------------------------------------------------- Lifecycle */

    FS.on('fretboard', () => {
      if (st.lock >= tuningNotes().length) st.lock = -1;
      resetReading();
      renderControls();
    });
    FS.on('tab', (tab) => {
      if (tab !== 'tuner') stop();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
    });
    window.addEventListener('resize', () => {
      if (!eng.running && st.mode === 'strobe') drawStrobe(0, 0, 'idle');
    });

    renderControls();
  };
})();
