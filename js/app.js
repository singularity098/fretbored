/* Fretbored — app shell: tabs, theme, startup. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const TABS = ['scales', 'chords', 'arpeggios', 'trainer', 'circle', 'tuner', 'metronome'];
  const inited = {};

  // App colour themes (the palettes live in style.css as [data-theme=…]). Swatch: background,
  // card, accent — also used for the browser's theme-color.
  const THEMES = [
    { id: 'dark', name: 'Dark', sw: ['#0c0f14', '#1a2130', '#ff7a59'] },
    { id: 'light', name: 'Light', sw: ['#f5f6fa', '#ffffff', '#2563eb'] },
    { id: 'amoled', name: 'AMOLED Black', sw: ['#000000', '#0b0b0c', '#22d3ee'] },
    { id: 'dracula', name: 'Dracula', sw: ['#21222c', '#44475a', '#ff79c6'] },
    { id: 'solarized', name: 'Solarized', sw: ['#002b36', '#073642', '#b58900'] },
    { id: 'tokyonight', name: 'Tokyo Night', sw: ['#16161e', '#1a1b26', '#7aa2f7'] },
    { id: 'latte', name: 'Catppuccin Latte', sw: ['#e6e9ef', '#eff1f5', '#8839ef'] },
    { id: 'frappe', name: 'Catppuccin Frappé', sw: ['#292c3c', '#303446', '#a6d189'] },
    { id: 'macchiato', name: 'Catppuccin Macchiato', sw: ['#1e2030', '#24273a', '#f5a97f'] },
    { id: 'mocha', name: 'Catppuccin Mocha', sw: ['#181825', '#1e1e2e', '#cba6f7'] },
  ];
  FS.THEMES = THEMES;

  // App styles: the look of note dots, buttons and tabs, independent of the colour theme (the rules
  // live in style.css as :root[data-style=…]; Classic is the original look and has none). Ring is
  // the default; a saved style that was removed (Glass, Flat, Pixel, Sticker, Pearl, Neon) falls back to it.
  const STYLES = [
    { id: 'ring', name: 'Ring' },
    { id: 'classic', name: 'Classic' },
    { id: 'halo', name: 'Target' },
  ];
  FS.STYLES = STYLES;

  // Menu preview: a root dot and a note dot drawn the way the style draws them on the fretboard.
  function stylePreview(id) {
    const dot = (cx, c) => {
      const ring = '#0e1014';
      switch (id) {
        case 'ring': return `<circle cx="${cx}" cy="10" r="7" style="fill:${ring};stroke:${c};stroke-width:2.2"/>`;
        case 'halo': return `<circle cx="${cx}" cy="10" r="8.5" style="fill:none;stroke:${c};stroke-width:1.4"/><circle cx="${cx}" cy="10" r="5.5" style="fill:${c}"/>`;
        default: return `<circle cx="${cx}" cy="10" r="7" style="fill:${c};stroke:rgba(0,0,0,.35)"/>`;
      }
    };
    const span = document.createElement('span');
    span.className = 'style-swatch';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 40 20" width="40" height="20">${dot(10, 'var(--dot-root)')}${dot(29, 'var(--dot-note)')}</svg>`;
    return span;
  }

  function applyStyle() {
    const style = STYLES.find((x) => x.id === FS.settings.style) || STYLES.find((x) => x.id === 'ring');
    FS.settings.style = style.id;
    document.documentElement.dataset.style = style.id;
    document.querySelectorAll('#theme-menu [data-style]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === style.id)));
  }

  function applyTheme() {
    const theme = THEMES.find((x) => x.id === FS.settings.theme) || THEMES[0];
    FS.settings.theme = theme.id;
    document.documentElement.dataset.theme = theme.id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme.sw[0];
    document.querySelectorAll('#theme-menu [data-id]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === theme.id)));
  }

  // Header palette button → menu of colour themes and styles, side by side (stacked on phones).
  function setupThemeMenu() {
    const btn = document.getElementById('theme-btn');
    const menu = document.getElementById('theme-menu');
    const colours = FS.h('div', { class: 'menu-group', role: 'group', 'aria-label': 'Colours' }, FS.h('div', { class: 'menu-head', 'aria-hidden': 'true' }, 'Colours'));
    const styles = FS.h('div', { class: 'menu-group', role: 'group', 'aria-label': 'Style' }, FS.h('div', { class: 'menu-head', 'aria-hidden': 'true' }, 'Style'));
    menu.append(colours, styles);
    for (const style of STYLES) {
      styles.append(FS.h('button', {
        role: 'menuitemradio', class: 'theme-item', dataset: { style: style.id },
        onclick: () => {
          FS.settings.style = style.id;
          FS.save();
          applyStyle();
          FS.emit('fretboard');
        },
      }, stylePreview(style.id), style.name));
    }
    for (const theme of THEMES) {
      colours.append(FS.h('button', {
        role: 'menuitemradio', class: 'theme-item', dataset: { id: theme.id },
        onclick: () => {
          FS.settings.theme = theme.id;
          FS.save();
          applyTheme();
          FS.emit('fretboard');
        },
      }, FS.h('span', { class: 'theme-swatch', 'aria-hidden': 'true', style: `--sw-bg:${theme.sw[0]};--sw-card:${theme.sw[1]};--sw-accent:${theme.sw[2]}` }), theme.name));
    }
    applyTheme();
    applyStyle();
    popupMenu(btn, menu, () => menu.querySelector('[aria-checked="true"]'));
  }

  // Header pop-up menu: opens under its button, closes on outside tap / Escape, arrow keys move.
  // Returns close().
  function popupMenu(btn, menu, focusFirst) {
    const items = () => [...menu.querySelectorAll('[role^="menuitem"]')];
    const open = () => {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      ((focusFirst && focusFirst()) || items()[0]).focus();
    };
    const close = () => {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !btn.parentElement.contains(e.target)) close();
    });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('[role^="menuitem"]')) {
        close();
        btn.focus();
      }
    });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        close();
        btn.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
      }
    });
    return close;
  }

  // Back up / restore everything stored in the browser as a JSON file.
  function setupDataMenu() {
    const btn = document.getElementById('data-btn');
    const menu = document.getElementById('data-menu');
    const file = document.getElementById('import-file');
    popupMenu(btn, menu);
    menu.querySelector('[data-act="export"]').addEventListener('click', () => {
      const data = FS.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fretbored-backup-${data.exported.slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      FS.toast('Backup saved — import it on another device to carry everything over');
    });
    menu.querySelector('[data-act="import"]').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      let data;
      try {
        data = JSON.parse(await f.text());
      } catch (e) {
        FS.toast('That file is not a Fretbored backup');
        return;
      }
      const when = data && data.exported ? new Date(data.exported).toLocaleString() : null;
      const ok = window.confirm(`Import this backup${when ? ` from ${when}` : ''}?\n\nIt replaces everything saved on this device: settings, themes, custom tunings, Trainer history and daily streak.`);
      if (!ok) return;
      const err = FS.importData(data);
      if (err) {
        FS.toast(err);
        return;
      }
      try {
        sessionStorage.setItem('fretbored:imported', '1');
      } catch (e) {
        /* only used for the confirmation toast */
      }
      location.reload();
    });
    try {
      if (sessionStorage.getItem('fretbored:imported')) {
        sessionStorage.removeItem('fretbored:imported');
        setTimeout(() => FS.toast('Backup imported'), 300);
      }
    } catch (e) {
      /* sessionStorage unavailable */
    }
  }

  // Panels are built the first time they are shown so hidden fretboards don't render at width 0.
  function ensureInit(tab) {
    if (inited[tab]) return;
    inited[tab] = true;
    const panel = document.getElementById(`panel-${tab}`);
    ({ scales: FS.initScales, chords: FS.initChords, arpeggios: FS.initArpeggios, circle: FS.initCircle, trainer: FS.initTrainer, metronome: FS.initMetronome, tuner: FS.initTuner })[tab](panel);
  }

  // from: 'next'/'prev' when reached by swiping, so the panel slides in from that side.
  FS.showTab = function (tab, from) {
    if (!TABS.includes(tab)) tab = 'scales';
    FS.settings.tab = tab;
    FS.save();
    for (const t of TABS) {
      const btn = document.getElementById(`tab-${t}`);
      const panel = document.getElementById(`panel-${t}`);
      const on = t === tab;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      panel.classList.toggle('slide-next', on && from === 'next');
      panel.classList.toggle('slide-prev', on && from === 'prev');
      if (on && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    ensureInit(tab);
    FS.emit('tab', tab);
    FS.emit('fretboard');
    if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  };

  /*
   * Phones: drag the page sideways to move between tabs. The panel follows the finger; letting go
   * past about a third of the screen (or after a quick flick) slides it off and the neighbouring
   * tab slides in from that side, otherwise it springs back. At the first/last tab the page only
   * stretches a little. Gestures that start on something that scrolls sideways (sideways
   * fretboard, tab bar), a form control or a dialog are left alone, as are mostly-vertical moves.
   */
  function setupSwipe() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let g = null; // the gesture in progress
    const scrollsSideways = (el) => {
      for (; el && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
      }
      return false;
    };
    const neighbour = (dx) => {
      const i = TABS.indexOf(FS.settings.tab) + (dx < 0 ? 1 : -1);
      return i >= 0 && i < TABS.length ? TABS[i] : null; // no wrap-around
    };
    const setPos = (panel, x, animate) => {
      panel.style.transition = animate ? 'transform 0.2s ease-out, opacity 0.2s ease-out' : 'none';
      panel.style.transform = x ? `translateX(${x}px)` : '';
      panel.style.opacity = x ? String(Math.max(0.35, 1 - Math.abs(x) / window.innerWidth)) : '';
    };
    const clear = (panel) => {
      panel.style.transition = panel.style.transform = panel.style.opacity = panel.style.willChange = '';
    };

    document.addEventListener('touchstart', (e) => {
      g = null;
      if (e.touches.length !== 1 || !FS.isNarrow()) return;
      const t = e.target;
      if (t.closest('input, select, textarea, dialog, [data-noswipe]') || scrollsSideways(t)) return;
      const panel = document.getElementById(`panel-${FS.settings.tab}`);
      if (!panel || panel.dataset.leaving) return;
      g = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: performance.now(), dx: 0, mode: null, panel };
    }, { passive: true });

    // Not passive: once the gesture is clearly sideways, stop the page scrolling while dragging.
    document.addEventListener('touchmove', (e) => {
      if (!g) return;
      if (e.touches.length > 1) {
        if (g.mode === 'h') setPos(g.panel, 0, true);
        g = null;
        return;
      }
      const dx = e.touches[0].clientX - g.x;
      const dy = e.touches[0].clientY - g.y;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < 10) return;
        g.mode = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
        if (g.mode === 'v') return (g = null);
        g.x += Math.sign(dx) * 10; // start following from here, without a jump
        g.panel.style.willChange = 'transform, opacity';
      }
      if (e.cancelable) e.preventDefault();
      g.dx = e.touches[0].clientX - g.x;
      // Rubber band at the ends: there is no tab to go to.
      const x = neighbour(g.dx) ? g.dx : g.dx * 0.25;
      if (!reduceMotion.matches) setPos(g.panel, x, false);
    }, { passive: false });

    const end = (cancelled) => {
      if (!g || g.mode !== 'h') return (g = null);
      const { panel, dx, at } = g;
      g = null;
      const next = cancelled ? null : neighbour(dx);
      const speed = Math.abs(dx) / Math.max(1, performance.now() - at); // px per ms
      const commit = next && (Math.abs(dx) > window.innerWidth * 0.3 || (Math.abs(dx) > 50 && speed > 0.35));
      if (!commit) {
        setPos(panel, 0, true);
        setTimeout(() => clear(panel), 220);
        return;
      }
      const go = () => {
        delete panel.dataset.leaving;
        clear(panel);
        FS.showTab(next, dx < 0 ? 'next' : 'prev');
        window.scrollTo(0, 0);
      };
      if (reduceMotion.matches) return go();
      panel.dataset.leaving = '1';
      setPos(panel, Math.sign(dx) * window.innerWidth, true); // finish sliding off, then switch
      setTimeout(go, 170);
    };
    document.addEventListener('touchend', () => end(false), { passive: true });
    document.addEventListener('touchcancel', () => end(true), { passive: true });
  }

  /* ---- Installable app (PWA): manifest, offline service worker, install button ---- */
  function setupPwa() {
    if (!/^https?:$/.test(location.protocol)) return; // nothing to install from file://
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.append(link);
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
    // Chrome-family browsers offer an install prompt; show our button only when they do.
    const btn = document.getElementById('install-app');
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      btn.hidden = true;
    });
    window.addEventListener('appinstalled', () => {
      btn.hidden = true;
      FS.toast('Fretbored installed — find it on your home screen');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    applyStyle();
    setupPwa();
    setupSwipe();

    document.querySelectorAll('[role="tab"]').forEach((btn) => {
      btn.addEventListener('click', () => FS.showTab(btn.dataset.tab));
      btn.addEventListener('keydown', (e) => {
        const i = TABS.indexOf(btn.dataset.tab);
        let j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
        if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
        if (j !== null) {
          e.preventDefault();
          FS.showTab(TABS[j]);
          document.getElementById(`tab-${TABS[j]}`).focus();
        }
      });
    });

    setupThemeMenu();
    setupDataMenu();

    const fromHash = location.hash.slice(1);
    FS.showTab(TABS.includes(fromHash) ? fromHash : FS.settings.tab);
    window.addEventListener('hashchange', () => {
      const t = location.hash.slice(1);
      if (TABS.includes(t) && t !== FS.settings.tab) FS.showTab(t);
    });
  });
})();
