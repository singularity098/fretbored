/* Fretbored — SVG fretboard shared by the Scales and Chords tabs. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  FS.WOODS = [
    ['ebony', 'Ebony'],
    ['rosewood', 'Rosewood'],
    ['maple', 'Maple'],
  ];

  // Note dot colours come from the app colour theme: --dot-root / --dot-note (+ -ink for the
  // label) are set per theme in style.css.

  const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
  const DOUBLE_INLAYS = [12, 24];
  const NS = 'http://www.w3.org/2000/svg';
  let instances = 0;

  class Fretboard {
    /**
     * handlers: { onToggle(string, fret), onRoot(string, fret) }
     */
    constructor(host, handlers) {
      this.host = host;
      this.handlers = handlers || {};
      this.model = { notes: [], muted: [] };
      this.prevKeys = new Set();
      this.uid = `fb${++instances}`; // gradient ids must be unique per page
      host.classList.add('fretboard-scroll');
      this.bindEvents();
      let w = 0;
      this.ro = new ResizeObserver(() => {
        const nw = host.clientWidth;
        if (Math.abs(nw - w) > 2) {
          w = nw;
          this.render();
        }
      });
      this.ro.observe(host);
      FS.on('fretboard', () => this.render());
    }

    setModel(model) {
      this.model = model;
      this.render();
    }

    // Vertical layout is a phone option; wider screens always use the horizontal board.
    isVertical() {
      return FS.settings.fretboard.orientation === 'vertical' && FS.isNarrow();
    }

    /*
     * Layout works in two axes: u runs along the neck (nut → body) and v runs across the
     * strings. pt()/rect() map them to SVG x/y for the current orientation and handedness.
     */
    layout() {
      const fb = FS.settings.fretboard;
      const tuning = FS.currentTuning().notes;
      const n = tuning.length;
      const frets = fb.frets;
      const vertical = this.isVertical();
      const lefty = fb.lefty;
      const hostW = this.host.clientWidth;

      let gap, vPadLo, vPadHi;
      if (vertical) {
        // Fill the phone's width with the strings; fret numbers sit on the left.
        vPadLo = 30;
        vPadHi = 8;
        gap = Math.max(34, Math.min(58, (hostW - vPadLo - vPadHi - 2) / n));
      } else {
        gap = n <= 5 ? 38 : n === 6 ? 34 : 31;
        vPadLo = 4;
        vPadHi = 26;
      }
      const across = vPadLo + vPadHi + n * gap;

      const openW = vertical ? 46 : 50;
      const tail = 18;
      const widths = [];
      let total = 0;
      for (let i = 1; i <= frets; i++) {
        widths.push(Math.pow(2, -i / 24));
        total += widths[widths.length - 1];
      }
      const minLast = vertical ? 40 : 36;
      const needed = (minLast * total) / widths[widths.length - 1];
      const avail = vertical ? needed : Math.max(hostW - openW - tail - 2, needed);
      const k = avail / total;
      const fretX = [openW];
      for (let i = 0; i < frets; i++) fretX.push(fretX[i] + widths[i] * k);
      const along = fretX[frets] + tail;

      // Across position of each string. Horizontal: high string on top. Vertical: low string
      // on the left, like a chord chart. Left-handed mirrors the neck (horizontal) or the
      // string order (vertical).
      const stringV = (s) => {
        const idx = vertical ? (lefty ? n - 1 - s : s) : n - 1 - s;
        return vPadLo + gap / 2 + idx * gap;
      };
      const U = (u) => (!vertical && lefty ? along - u : u);
      const pt = (u, v) => (vertical ? [v, U(u)] : [U(u), v]);
      const rect = (u1, u2, v1, v2) => {
        const [xa, ya] = pt(u1, v1);
        const [xb, yb] = pt(u2, v2);
        return `x="${Math.min(xa, xb)}" y="${Math.min(ya, yb)}" width="${Math.abs(xb - xa)}" height="${Math.abs(yb - ya)}"`;
      };
      const cellU = (f) => (f === 0 ? openW / 2 - 4 : (fretX[f - 1] + fretX[f]) / 2);
      const width = vertical ? across : along;
      const height = vertical ? along : across;
      return { tuning, n, frets, gap, width, height, fretX, openW, stringV, pt, rect, cellU, lefty, vertical, vPadLo };
    }

    render() {
      if (!this.host.isConnected || !this.host.clientWidth) return;
      const L = this.layout();
      this.L = L;
      const fb = FS.settings.fretboard;
      const { n, frets, height, width, fretX, pt, rect, cellU, stringV, gap, openW, vertical } = L;
      const vLo = L.vPadLo; // board edges across the strings
      const vHi = vLo + n * gap;
      const xy = (u, v) => {
        const [x, y] = pt(u, v);
        return { x, y };
      };
      const parts = [];
      const g2 = vertical ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"';

      this.host.classList.toggle('vertical', vertical);
      // Vertical boards on Chords/Arpeggios crop to the shape's frets (model.focus) unless the
      // player asked for the whole neck. The full board is still drawn; the viewBox hides the rest.
      const crop = this.cropRange(L);
      this.updateNeckToggle(L);
      let y0 = 0;
      let shownH = height;
      if (crop) {
        // Room above the top fret for the muted-string markers when the nut is cropped away.
        const muteRoom = (this.model.muted || []).length ? 24 : 8;
        y0 = crop.start === 0 ? 0 : fretX[crop.start - 1] - muteRoom;
        shownH = (crop.end >= frets ? height : fretX[crop.end] + 8) - y0;
      }
      parts.push(`<svg xmlns="${NS}" class="fretboard wood-${FS.WOODS.some((w) => w[0] === fb.wood) ? fb.wood : 'ebony'}" width="${width}" height="${shownH}" viewBox="0 ${y0} ${width} ${shownH}" role="img" aria-label="Fretboard">`);
      parts.push(`<defs>
        <linearGradient id="${this.uid}wood" ${g2}>
          <stop offset="0" style="stop-color:var(--board-1)"/><stop offset="0.5" style="stop-color:var(--board-2)"/><stop offset="1" style="stop-color:var(--board-1)"/>
        </linearGradient>
        <linearGradient id="${this.uid}string" ${g2}>
          <stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#8d8a84"/>
        </linearGradient>
      </defs>`);

      // Board
      parts.push(`<rect class="board" ${rect(openW, fretX[frets], vLo, vHi)} rx="4" fill="url(#${this.uid}wood)"/>`);

      // Inlays
      const mid = (vLo + vHi) / 2;
      const inlay = (f, v) => {
        const c = xy(cellU(f), v);
        return `<circle class="inlay" cx="${c.x}" cy="${c.y}" r="6"/>`;
      };
      for (let f = 1; f <= frets; f++) {
        if (INLAYS.includes(f)) parts.push(inlay(f, mid));
        if (DOUBLE_INLAYS.includes(f)) {
          const off = (vHi - vLo) / 4;
          parts.push(inlay(f, mid - off), inlay(f, mid + off));
        }
      }

      // Frets + nut
      for (let f = 1; f <= frets; f++) {
        const a = xy(fretX[f], vLo);
        const b = xy(fretX[f], vHi);
        parts.push(`<line class="fret" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
      }
      const nutU = !vertical && L.lefty ? openW : openW - 5;
      parts.push(`<rect class="nut" ${rect(nutU, nutU + 5, vLo, vHi)} rx="1.5"/>`);

      // Strings (thicker for lower strings)
      for (let s = 0; s < n; s++) {
        const v = stringV(s);
        const thick = 1 + ((n - 1 - s) / Math.max(1, n - 1)) * (n <= 5 ? 2.6 : 2);
        parts.push(`<rect class="string" ${rect(openW, fretX[frets] + 10, v - thick / 2, v + thick / 2)} fill="url(#${this.uid}string)"/>`);
      }

      // Fret numbers: below the board (horizontal) or to its left (vertical)
      for (let f = 1; f <= frets; f++) {
        const cls = INLAYS.includes(f) || DOUBLE_INLAYS.includes(f) ? 'fretnum marked' : 'fretnum';
        const c = xy(cellU(f), vertical ? vLo - 14 : vHi + 16);
        parts.push(`<text class="${cls}" x="${c.x}" y="${c.y}">${f}</text>`);
      }

      // Clickable cells, each with a hover ghost dot.
      const r = Math.min(gap * 0.42, vertical ? 16 : 14);
      for (let s = 0; s < n; s++) {
        const v = stringV(s);
        for (let f = 0; f <= frets; f++) {
          const ua = f === 0 ? 0 : fretX[f - 1];
          const ub = f === 0 ? openW - 5 : fretX[f];
          const c = xy(cellU(f), v);
          parts.push(`<g class="cell" data-s="${s}" data-f="${f}"><rect ${rect(ua, ub, v - gap / 2, v + gap / 2)}/><circle class="ghost" cx="${c.x}" cy="${c.y}" r="${r}"/></g>`);
        }
      }

      // Optional shading of cells outside an active area (model.isActive(s, f) → bool).
      if (this.model.isActive) {
        for (let s = 0; s < n; s++) {
          const v = stringV(s);
          for (let f = 0; f <= frets; f++) {
            if (this.model.isActive(s, f)) continue;
            const ua = f === 0 ? 0 : fretX[f - 1];
            const ub = f === 0 ? openW - 5 : fretX[f];
            parts.push(`<rect class="shade" ${rect(ua, ub, v - gap / 2, v + gap / 2)}/>`);
          }
        }
      }

      // Muted string markers
      for (const s of this.model.muted || []) {
        const c = xy(crop && crop.start > 0 ? fretX[crop.start - 1] - 13 : cellU(0), stringV(s));
        parts.push(`<text class="mute" x="${c.x}" y="${c.y}">×</text>`);
      }

      // Notes
      const keys = new Set();
      for (const note of this.model.notes) {
        const key = `${note.s}:${note.f}:${note.kind}`;
        keys.add(key);
        const enter = this.prevKeys.has(key) ? '' : ' enter';
        const c = xy(cellU(note.f), stringV(note.s));
        let fill = note.kind === 'root' ? 'var(--dot-root)' : 'var(--dot-note)';
        let ink = note.kind === 'root' ? 'var(--dot-root-ink)' : 'var(--dot-note-ink)';
        if (note.color) (fill = note.color), (ink = '#0d1017');
        const label = FS.theory.pretty(note.label || '');
        const fs = (label.length >= 4 ? 9 : label.length === 3 ? 10.5 : 12.5) * (r / 14);
        const cls = `note ${note.kind}${enter}`;
        const midi = L.tuning[note.s] + note.f;
        parts.push(`<g class="${cls}" data-midi="${midi}" transform="translate(${c.x} ${c.y})" style="--dot:${fill};--dot-text:${ink}">`);
        if (note.kind === 'root') parts.push(`<circle class="halo" r="${r + 4}"/>`);
        parts.push(`<circle class="dot" r="${note.kind === 'faint' ? r * 0.82 : r}"/>`);
        if (label) parts.push(`<text style="font-size:${fs.toFixed(1)}px">${label}</text>`);
        parts.push('</g>');
      }
      this.prevKeys = keys;

      parts.push('</svg>');
      this.host.innerHTML = parts.join('');
      const mode = `${vertical}:${L.lefty}`;
      if (mode !== this.lastMode) {
        // Start with the nut in view.
        this.lastMode = mode;
        this.host.scrollLeft = !vertical && L.lefty ? this.host.scrollWidth : 0;
      }
    }

    /*
     * Frets to show on a cropped vertical board: the focus range with a fret to spare below it
     * (room to edit a chord), at least five frets, and from the nut when the shape is near it.
     */
    cropRange(L) {
      const focus = this.model.focus;
      if (!L.vertical || !focus || FS.settings.fretboard.wholeNeck) return null;
      const start = focus.lo <= 2 ? 0 : focus.lo - 1;
      const end = Math.min(L.frets, Math.max(focus.hi + 1, start + 4));
      return { start, end };
    }

    // "Whole neck / Shape only" button under a vertical board that has a focus range.
    updateNeckToggle(L) {
      const show = L.vertical && !!this.model.focus;
      if (!this.neckBtn) {
        if (!show) return;
        this.neckBtn = document.createElement('button');
        this.neckBtn.type = 'button';
        this.neckBtn.className = 'btn ghost small neck-toggle';
        this.neckBtn.addEventListener('click', () => {
          FS.settings.fretboard.wholeNeck = !FS.settings.fretboard.wholeNeck;
          FS.save();
          FS.emit('fretboard');
        });
        this.host.after(this.neckBtn);
      }
      this.neckBtn.hidden = !show;
      this.neckBtn.textContent = FS.settings.fretboard.wholeNeck ? 'Show this shape only' : 'Show the whole neck';
    }

    // Scroll a horizontally overflowing board so a fret is in view.
    scrollToFret(f) {
      if (!this.L || this.L.vertical || this.host.scrollWidth <= this.host.clientWidth) return;
      const [x] = this.L.pt(this.L.cellU(f), 0);
      this.host.scrollTo({ left: Math.max(0, x - this.host.clientWidth / 2), behavior: 'smooth' });
    }

    // Briefly highlight every position of an exact MIDI note.
    flash(midi, ms) {
      const els = this.host.querySelectorAll(`.note[data-midi="${midi}"]`);
      // Alternate two identical animations so a repeat flash restarts without a forced layout.
      this.flashes = (this.flashes || 0) + 1;
      const cls = this.flashes % 2 ? 'playing-a' : 'playing-b';
      els.forEach((el) => {
        el.classList.remove('playing-a', 'playing-b');
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), ms || 260);
      });
    }

    bindEvents() {
      const host = this.host;
      let press = null;
      let lastRootAt = 0;
      const cellOf = (e) => {
        const g = e.target.closest && e.target.closest('.cell');
        return g ? { s: +g.dataset.s, f: +g.dataset.f } : null;
      };
      const fireRoot = (c) => {
        if (Date.now() - lastRootAt < 900) return;
        lastRootAt = Date.now();
        if (this.handlers.onRoot) this.handlers.onRoot(c.s, c.f);
      };

      // Long-press (touch) sets the root. Firefox for Android runs its own long-press gesture
      // and may send pointercancel mid-press, so touch events are tracked too and a press is
      // only abandoned when the finger actually moves (e.g. to scroll).
      const LONG_MS = 450;
      const begin = (c, x, y) => {
        if (press && press.timer) clearTimeout(press.timer);
        press = { c, x, y, long: false, moved: false, at: Date.now(), timer: null };
        press.timer = setTimeout(() => {
          if (!press || press.moved) return;
          press.long = true;
          try {
            if (navigator.vibrate) navigator.vibrate(15);
          } catch (err) {
            /* vibration unsupported */
          }
          fireRoot(press.c);
        }, LONG_MS);
      };
      const moveTo = (x, y) => {
        if (press && !press.moved && Math.hypot(x - press.x, y - press.y) > 12) {
          press.moved = true;
          clearTimeout(press.timer);
        }
      };
      const release = () => {
        if (press && press.timer && !press.long) clearTimeout(press.timer);
      };
      const sameCell = (a, b) => a && b && a.s === b.s && a.f === b.f;

      host.addEventListener('pointerdown', (e) => {
        const c = cellOf(e);
        if (!c) return;
        if (e.pointerType === 'mouse') press = { c, x: e.clientX, y: e.clientY, long: false, moved: false, timer: null };
        else begin(c, e.clientX, e.clientY);
      });
      host.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length > 1) {
            release();
            if (press) press.moved = true;
            return;
          }
          const c = cellOf(e);
          if (!c) return;
          // pointerdown usually got here first for the same touch
          if (press && sameCell(press.c, c) && Date.now() - press.at < 100) return;
          begin(c, e.touches[0].clientX, e.touches[0].clientY);
        },
        { passive: true }
      );
      host.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') moveTo(e.clientX, e.clientY);
      });
      host.addEventListener('touchmove', (e) => moveTo(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
      host.addEventListener('pointerup', release);
      host.addEventListener('touchend', release, { passive: true });
      host.addEventListener('touchcancel', () => {
        release();
        if (press) press.moved = true;
      }, { passive: true });
      host.addEventListener('click', (e) => {
        const c = cellOf(e);
        const p = press;
        release();
        press = null;
        if (!c || (p && (p.long || p.moved))) return;
        // A click right after a long-press root change is the tail of that press (touch only).
        if (Date.now() - lastRootAt < 600 && !(p && p.timer === null)) return;
        if (this.handlers.onToggle) this.handlers.onToggle(c.s, c.f);
      });
      host.addEventListener('contextmenu', (e) => {
        const c = cellOf(e);
        if (!c) return;
        e.preventDefault();
        release();
        if (press) press.long = true; // swallow the click that may follow
        fireRoot(c);
      });
    }
  }

  // Phones get the option of a vertical fretboard.
  const narrowQuery = window.matchMedia('(max-width: 760px)');
  FS.isNarrow = () => narrowQuery.matches;
  const onNarrowChange = () => FS.emit('fretboard');
  if (narrowQuery.addEventListener) narrowQuery.addEventListener('change', onNarrowChange);
  else if (narrowQuery.addListener) narrowQuery.addListener(onNarrowChange);

  FS.Fretboard = Fretboard;
})();
