/* Fretbored — app shell: tabs, theme, startup. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const TABS = ['scales', 'chords', 'arpeggios', 'trainer', 'circle', 'metronome', 'tuner'];
  const inited = {};

  function applyTheme() {
    document.documentElement.dataset.theme = FS.settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = FS.settings.theme === 'light' ? '#f5f6fa' : '#0c0f14';
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
   * Phones: swipe the page left/right to go to the next/previous tab. Swipes that start on
   * something that scrolls sideways (sideways fretboard, tab bar), a slider or a dialog are left
   * alone, as are mostly-vertical moves, slow drags and multi-finger gestures.
   */
  function setupSwipe() {
    let start = null;
    const scrollsSideways = (el) => {
      for (; el && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
      }
      return false;
    };
    document.addEventListener('touchstart', (e) => {
      start = null;
      if (e.touches.length !== 1 || !FS.isNarrow()) return;
      const t = e.target;
      if (t.closest('input, select, textarea, dialog, [data-noswipe]') || scrollsSideways(t)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (start && e.touches.length > 1) start = null;
    }, { passive: true });
    document.addEventListener('touchcancel', () => (start = null), { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!start) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      const quick = Date.now() - start.at < 700;
      start = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const i = TABS.indexOf(FS.settings.tab) + (dx < 0 ? 1 : -1);
      if (i < 0 || i >= TABS.length) return; // no wrap-around: the ends stay put
      FS.showTab(TABS[i], dx < 0 ? 'next' : 'prev');
      window.scrollTo(0, 0);
    }, { passive: true });
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

    document.getElementById('theme-toggle').addEventListener('click', () => {
      FS.settings.theme = FS.settings.theme === 'light' ? 'dark' : 'light';
      FS.save();
      applyTheme();
      FS.emit('fretboard');
    });

    const fromHash = location.hash.slice(1);
    FS.showTab(TABS.includes(fromHash) ? fromHash : FS.settings.tab);
    window.addEventListener('hashchange', () => {
      const t = location.hash.slice(1);
      if (TABS.includes(t) && t !== FS.settings.tab) FS.showTab(t);
    });
  });
})();
