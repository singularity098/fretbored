/* Fretscape — app shell: tabs, theme, startup. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const TABS = ['scales', 'chords', 'circle', 'metronome'];
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
    ({ scales: FS.initScales, chords: FS.initChords, circle: FS.initCircle, metronome: FS.initMetronome })[tab](panel);
  }

  FS.showTab = function (tab) {
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
      if (on && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    ensureInit(tab);
    FS.emit('fretboard');
    if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  };

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();

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
