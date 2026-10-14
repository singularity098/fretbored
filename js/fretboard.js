/* Fretscape — SVG fretboard shared by the Scales and Chords tabs. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  FS.WOODS = [
    ['ebony', 'Ebony'],
    ['rosewood', 'Rosewood'],
    ['maple', 'Maple'],
  ];

  FS.DOT_THEMES = {
    aurora: { name: 'Aurora', root: '#ff7a59', note: '#3dd6c3' },
    amber: { name: 'Amber', root: '#ffb627', note: '#8fa2ff' },
    neon: { name: 'Neon', root: '#ff3d8b', note: '#2de2ff' },
    forest: { name: 'Forest', root: '#f4d35e', note: '#5fbf8f' },
    ivory: { name: 'Ivory', root: '#ffffff', note: '#9aa5b8' },
    spectrum: { name: 'Spectrum', root: '#ffffff', note: '#9aa5b8', spectrum: true },
  };

  // One hue per interval for the Spectrum theme.
  const spectrumColor = (iv) => `hsl(${(iv * 30 + 10) % 360} 78% 62%)`;

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

    layout() {
      const fb = FS.settings.fretboard;
      const tuning = FS.currentTuning().notes;
      const n = tuning.length;
      const frets = fb.frets;
      const gap = n <= 5 ? 38 : n === 6 ? 34 : 31;
      const padTop = 22;
      const padBottom = gap / 2 + 26;
      const openW = 50;
      const tail = 18;
      const height = padTop + padBottom + (n - 1) * gap;
      const widths = [];
      let total = 0;
      for (let i = 1; i <= frets; i++) {
        widths.push(Math.pow(2, -i / 24));
        total += widths[widths.length - 1];
      }
      const minLast = 36;
      const needed = (minLast * total) / widths[widths.length - 1];
      const avail = Math.max(this.host.clientWidth - openW - tail - 2, needed);
      const k = avail / total;
      const fretX = [openW];
      for (let i = 0; i < frets; i++) fretX.push(fretX[i] + widths[i] * k);
      const width = fretX[frets] + tail;
      const lefty = fb.lefty;
      const X = (x) => (lefty ? width - x : x);
      const cellX = (f) => (f === 0 ? openW / 2 - 4 : (fretX[f - 1] + fretX[f]) / 2);
      const stringY = (s) => padTop + (n - 1 - s) * gap;
      return { tuning, n, frets, gap, padTop, height, width, fretX, openW, X, cellX, stringY, lefty };
    }

    render() {
      if (!this.host.isConnected || !this.host.clientWidth) return;
      const L = this.layout();
      this.L = L;
      const fb = FS.settings.fretboard;
      const theme = FS.DOT_THEMES[fb.dots] || FS.DOT_THEMES.aurora;
      const { n, frets, height, width, fretX, X, cellX, stringY, gap, openW } = L;
      const top = stringY(n - 1);
      const bottom = stringY(0);
      const parts = [];

      parts.push(`<svg xmlns="${NS}" class="fretboard wood-${FS.WOODS.some((w) => w[0] === fb.wood) ? fb.wood : 'ebony'}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fretboard">`);
      parts.push(`<defs>
        <linearGradient id="${this.uid}wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style="stop-color:var(--board-1)"/><stop offset="0.5" style="stop-color:var(--board-2)"/><stop offset="1" style="stop-color:var(--board-1)"/>
        </linearGradient>
        <linearGradient id="${this.uid}string" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#8d8a84"/>
        </linearGradient>
      </defs>`);

      // Board
      const bx1 = Math.min(X(openW), X(fretX[frets]));
      const bx2 = Math.max(X(openW), X(fretX[frets]));
      parts.push(`<rect class="board" x="${bx1}" y="${top - gap / 2}" width="${bx2 - bx1}" height="${bottom - top + gap}" rx="4" fill="url(#${this.uid}wood)"/>`);

      // Inlays
      const midY = (top + bottom) / 2;
      for (let f = 1; f <= frets; f++) {
        const cx = X(cellX(f));
        if (INLAYS.includes(f)) parts.push(`<circle class="inlay" cx="${cx}" cy="${midY}" r="6"/>`);
        if (DOUBLE_INLAYS.includes(f)) {
          const off = (bottom - top) / 4;
          parts.push(`<circle class="inlay" cx="${cx}" cy="${midY - off}" r="6"/><circle class="inlay" cx="${cx}" cy="${midY + off}" r="6"/>`);
        }
      }

      // Frets + nut
      for (let f = 1; f <= frets; f++) {
        const x = X(fretX[f]);
        parts.push(`<line class="fret" x1="${x}" y1="${top - gap / 2}" x2="${x}" y2="${bottom + gap / 2}"/>`);
      }
      parts.push(`<rect class="nut" x="${X(openW) - (L.lefty ? 0 : 5)}" y="${top - gap / 2}" width="5" height="${bottom - top + gap}" rx="1.5"/>`);

      // Strings (thicker for lower strings)
      for (let s = 0; s < n; s++) {
        const y = stringY(s);
        const thick = 1 + ((n - 1 - s) / Math.max(1, n - 1)) * (n <= 5 ? 2.6 : 2);
        const x1 = Math.min(X(openW), X(fretX[frets] + 10));
        const x2 = Math.max(X(openW), X(fretX[frets] + 10));
        parts.push(`<rect class="string" x="${x1}" y="${y - thick / 2}" width="${x2 - x1}" height="${thick}" fill="url(#${this.uid}string)"/>`);
      }

      // Fret numbers
      for (let f = 1; f <= frets; f++) {
        const cls = INLAYS.includes(f) || DOUBLE_INLAYS.includes(f) ? 'fretnum marked' : 'fretnum';
        parts.push(`<text class="${cls}" x="${X(cellX(f))}" y="${bottom + gap / 2 + 16}">${f}</text>`);
      }

      // Clickable cells, each with a hover ghost dot.
      const r = Math.min(gap * 0.42, 14);
      for (let s = 0; s < n; s++) {
        const y = stringY(s);
        for (let f = 0; f <= frets; f++) {
          const xa = f === 0 ? 0 : fretX[f - 1];
          const xb = f === 0 ? openW - 5 : fretX[f];
          const x1 = Math.min(X(xa), X(xb));
          const w = Math.abs(X(xb) - X(xa));
          parts.push(`<g class="cell" data-s="${s}" data-f="${f}"><rect x="${x1}" y="${y - gap / 2}" width="${w}" height="${gap}"/><circle class="ghost" cx="${X(cellX(f))}" cy="${y}" r="${r}"/></g>`);
        }
      }

      // Muted string markers
      for (const s of this.model.muted || []) {
        parts.push(`<text class="mute" x="${X(cellX(0))}" y="${stringY(s)}">×</text>`);
      }

      // Notes
      const keys = new Set();
      for (const note of this.model.notes) {
        const key = `${note.s}:${note.f}:${note.kind}`;
        keys.add(key);
        const enter = this.prevKeys.has(key) ? '' : ' enter';
        const x = X(cellX(note.f));
        const y = stringY(note.s);
        let fill;
        if (note.kind === 'root') fill = theme.root;
        else if (theme.spectrum && note.iv !== undefined) fill = spectrumColor(note.iv);
        else fill = theme.note;
        const label = FS.theory.pretty(note.label || '');
        const fs = label.length >= 4 ? 9 : label.length === 3 ? 10.5 : 12.5;
        const cls = `note ${note.kind}${enter}`;
        const midi = L.tuning[note.s] + note.f;
        parts.push(`<g class="${cls}" data-midi="${midi}" transform="translate(${x} ${y})" style="--dot:${fill}">`);
        if (note.kind === 'root') parts.push(`<circle class="halo" r="${r + 4}"/>`);
        parts.push(`<circle class="dot" r="${note.kind === 'faint' ? r * 0.82 : r}"/>`);
        if (label) parts.push(`<text style="font-size:${fs}px">${label}</text>`);
        parts.push('</g>');
      }
      this.prevKeys = keys;

      parts.push('</svg>');
      this.host.innerHTML = parts.join('');
      if (L.lefty !== this.lastLefty) {
        // Start with the nut in view.
        this.lastLefty = L.lefty;
        this.host.scrollLeft = L.lefty ? this.host.scrollWidth : 0;
      }
    }

    // Scroll a horizontally overflowing board so a fret is in view.
    scrollToFret(f) {
      if (!this.L || this.host.scrollWidth <= this.host.clientWidth) return;
      const x = this.L.X(this.L.cellX(f));
      this.host.scrollTo({ left: Math.max(0, x - this.host.clientWidth / 2), behavior: 'smooth' });
    }

    // Briefly highlight every position of an exact MIDI note.
    flash(midi, ms) {
      const els = this.host.querySelectorAll(`.note[data-midi="${midi}"]`);
      els.forEach((el) => {
        el.classList.remove('playing');
        void el.getBoundingClientRect();
        el.classList.add('playing');
        setTimeout(() => el.classList.remove('playing'), ms || 260);
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

      host.addEventListener('pointerdown', (e) => {
        const c = cellOf(e);
        if (!c) return;
        press = { c, x: e.clientX, y: e.clientY, long: false, timer: null };
        if (e.pointerType !== 'mouse') {
          press.timer = setTimeout(() => {
            if (!press) return;
            press.long = true;
            if (navigator.vibrate) navigator.vibrate(15);
            fireRoot(c);
          }, 480);
        }
      });
      const cancel = () => {
        if (press && press.timer) clearTimeout(press.timer);
      };
      host.addEventListener('pointermove', (e) => {
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
          cancel();
          press.moved = true;
        }
      });
      host.addEventListener('pointercancel', () => {
        cancel();
        press = null;
      });
      host.addEventListener('click', (e) => {
        const c = cellOf(e);
        const p = press;
        cancel();
        press = null;
        if (!c || (p && (p.long || p.moved))) return;
        if (Date.now() - lastRootAt < 600) return;
        if (this.handlers.onToggle) this.handlers.onToggle(c.s, c.f);
      });
      host.addEventListener('contextmenu', (e) => {
        const c = cellOf(e);
        if (!c) return;
        e.preventDefault();
        cancel();
        fireRoot(c);
      });
    }
  }

  FS.Fretboard = Fretboard;
})();
