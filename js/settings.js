/* Fretbored — Settings dialog (opened from the header's gear): the guitar settings, the options that
 * used to sit on the tabs (arpeggio direction and speed, trainer setup, metronome sound) and backup.
 * A tab builds its own controls into its section with FS.settingsHost(id). */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  const hosts = {};
  FS.settingsHost = (id) => hosts[id];

  // Tabs whose controls live in this dialog. They are built before it opens, so the controls exist
  // even if the tab was never shown.
  const OWNER_TABS = ['arpeggios', 'trainer', 'metronome'];

  FS.setupSettings = function (prepareTab) {
    const dlg = document.getElementById('settings-dialog');
    const btn = document.getElementById('settings-btn');

    const section = (id, title) => {
      hosts[id] = h('div', { class: 'controls' });
      return h('section', { class: 'settings-section' }, h('h3', { class: 'section-title' }, title), hosts[id]);
    };
    const guitar = section('guitar', 'Guitar');
    FS.createFretboardControls(hosts.guitar);

    /* ---- Backup: everything stored in the browser, as a JSON file ---- */

    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Backup file to import' });
    const status = h('p', { class: 'muted small settings-status', role: 'status' });
    file.addEventListener('change', () => importFile(file, status));
    const backup = h('section', { class: 'settings-section' },
      h('h3', { class: 'section-title' }, 'Backup'),
      h('div', { class: 'controls' },
        h('div', { class: 'inline wrap' },
          h('button', { class: 'btn', onclick: () => exportBackup(status) }, '⤓ Export settings & progress'),
          h('button', { class: 'btn ghost', onclick: () => file.click() }, '⤒ Import from a backup file…')),
        h('p', { class: 'muted small' }, 'Everything saved on this device: settings, themes, custom tunings, Trainer history and daily streak.'),
        status,
        file));

    dlg.setAttribute('aria-label', 'Settings');
    dlg.append(
      h('div', { class: 'settings-head' },
        h('h2', null, 'Settings'),
        h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close settings', onclick: () => dlg.close() }, '✕')),
      h('div', { class: 'settings-body' },
        guitar,
        section('arpeggios', 'Arpeggios'),
        section('trainer', 'Trainer'),
        section('metronome', 'Metronome sound'),
        backup)
    );
    // A tap on the dimmed page closes the dialog (the dialog itself has no padding, so only the backdrop lands on it).
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    btn.addEventListener('click', () => {
      OWNER_TABS.forEach(prepareTab);
      dlg.showModal();
    });

    try {
      if (sessionStorage.getItem('fretbored:imported')) {
        sessionStorage.removeItem('fretbored:imported');
        setTimeout(() => FS.toast('Backup imported'), 300);
      }
    } catch (e) {
      /* sessionStorage unavailable */
    }
  };

  function exportBackup(status) {
    const data = FS.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fretbored-backup-${data.exported.slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    status.textContent = 'Backup saved — import it on another device to carry everything over.';
  }

  async function importFile(file, status) {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch (e) {
      status.textContent = 'That file is not a Fretbored backup.';
      return;
    }
    const when = data && data.exported ? new Date(data.exported).toLocaleString() : null;
    const ok = window.confirm(`Import this backup${when ? ` from ${when}` : ''}?\n\nIt replaces everything saved on this device: settings, themes, custom tunings, Trainer history and daily streak.`);
    if (!ok) return;
    const err = FS.importData(data);
    if (err) {
      status.textContent = err;
      return;
    }
    try {
      sessionStorage.setItem('fretbored:imported', '1');
    } catch (e) {
      /* only used for the confirmation toast */
    }
    location.reload();
  }
})();
