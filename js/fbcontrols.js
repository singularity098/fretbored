/* Fretbored — fretboard settings bar (shared state) and the custom tuning editor. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  function changed() {
    FS.save();
    FS.emit('fretboard');
  }

  FS.createFretboardControls = function (container) {
    const fb = () => FS.settings.fretboard;

    const stringsSel = h('select', { 'aria-label': 'Number of strings' });
    for (const [v, label] of FS.STRING_OPTIONS) stringsSel.append(h('option', { value: v }, label));
    stringsSel.addEventListener('change', () => {
      fb().strings = +stringsSel.value;
      const first = FS.allTunings().find((t) => t.strings === fb().strings);
      fb().tuning = first.id;
      changed();
    });

    const tuningSel = h('select', { 'aria-label': 'Tuning', class: 'tuning-select' });
    tuningSel.addEventListener('change', () => {
      fb().tuning = tuningSel.value;
      changed();
    });
    const editBtn = h('button', { class: 'icon-btn', title: 'Edit / create custom tuning', 'aria-label': 'Custom tuning editor' });
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    editBtn.addEventListener('click', () => FS.openTuningEditor());

    const fretSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Number of frets' });
    for (const f of FS.FRET_OPTIONS) {
      fretSeg.append(
        h('button', { dataset: { v: f }, onclick: () => { fb().frets = f; changed(); } }, String(f))
      );
    }

    const labelSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Dot labels' });
    for (const [v, label] of [['notes', 'Notes'], ['intervals', 'Intervals']]) {
      labelSeg.append(h('button', { dataset: { v }, onclick: () => { fb().labels = v; changed(); } }, label));
    }

    const layoutSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fretboard layout' });
    for (const [v, label] of [['horizontal', 'Sideways'], ['vertical', 'Vertical']]) {
      layoutSeg.append(h('button', { dataset: { v }, onclick: () => { fb().orientation = v; changed(); } }, label));
    }

    const woodSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fretboard wood' });
    for (const [v, label] of FS.WOODS) {
      woodSeg.append(h('button', { dataset: { v }, onclick: () => { fb().wood = v; changed(); } }, label));
    }

    const lefty = h('input', { type: 'checkbox', role: 'switch' });
    lefty.addEventListener('change', () => {
      fb().lefty = lefty.checked;
      changed();
    });

    const field = (label, ...ctl) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), ...ctl);

    // Collapsible: folded by default; open/closed is shared by every tab and remembered.
    const tuningLabel = h('span', { class: 'fb-settings-tuning' });
    const controls = h('div', { class: 'fb-controls' });
    const details = h('details', { class: 'fb-settings' },
      h('summary', null,
        h('span', { class: 'fb-settings-title' }, 'Fretboard settings'),
        h('span', { class: 'fb-settings-hint' }, 'strings, tuning, frets, wood, labels…'),
        tuningLabel),
      controls);
    details.open = !!fb().controlsOpen;
    details.addEventListener('toggle', () => {
      if (fb().controlsOpen === details.open) return;
      fb().controlsOpen = details.open;
      FS.save();
      FS.emit('fbcontrols:open', details.open);
    });
    FS.on('fbcontrols:open', (open) => {
      if (details.open !== open) details.open = open;
    });
    container.append(details);
    controls.append(
      field('Strings', stringsSel),
      field('Tuning', h('div', { class: 'inline' }, tuningSel, editBtn)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Frets'), fretSeg),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Labels'), labelSeg),
      h('div', { class: 'field mobile-only' }, h('span', { class: 'field-label' }, 'Layout'), layoutSeg),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wood'), woodSeg),
      h('label', { class: 'field switch-field' }, h('span', { class: 'field-label' }, 'Left-handed'), h('span', { class: 'switch' }, lefty, h('span', { class: 'slider' })))
    );

    function sync() {
      const s = fb();
      const cur = FS.currentTuning();
      stringsSel.value = s.strings;
      tuningSel.innerHTML = '';
      const presets = FS.TUNINGS.filter((t) => t.strings === s.strings);
      const custom = (s.customTunings || []).filter((t) => t.strings === s.strings);
      const addOpts = (parent, list) =>
        list.forEach((t) => parent.append(h('option', { value: t.id }, `${t.name} — ${FS.tuningLabel(t)}`)));
      if (custom.length) {
        const g1 = h('optgroup', { label: 'Presets' });
        addOpts(g1, presets);
        const g2 = h('optgroup', { label: 'Custom' });
        addOpts(g2, custom);
        tuningSel.append(g1, g2);
      } else addOpts(tuningSel, presets);
      tuningSel.value = cur.id;
      fretSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.v === s.frets));
      labelSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === s.labels));
      layoutSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === s.orientation));
      woodSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === s.wood));
      lefty.checked = !!s.lefty;
      tuningLabel.textContent = `${cur.name} · ${FS.tuningLabel(cur)}`;
    }
    sync();
    FS.on('fretboard', sync);
  };

  /* ---------------------------------------------------------------- Tuning editor */

  FS.openTuningEditor = function () {
    const dlg = document.getElementById('tuning-editor');
    const fb = FS.settings.fretboard;
    const cur = FS.currentTuning();
    const isCustom = cur.id.startsWith('custom-');
    const T = FS.theory;

    dlg.innerHTML = '';
    const form = h('form', { method: 'dialog', class: 'dialog-body' });
    const name = h('input', { type: 'text', value: isCustom ? cur.name : `My ${cur.name}`, maxlength: 40, required: true, 'aria-label': 'Tuning name' });
    const rows = h('div', { class: 'tuning-rows' });
    const notes = cur.notes.slice();

    const preview = h('div', { class: 'tuning-preview' });
    const updatePreview = () => (preview.textContent = notes.map((m) => T.pretty(T.midiName(m))).join('  '));

    // Highest string first, like the fretboard.
    for (let s = notes.length - 1; s >= 0; s--) {
      const noteSel = h('select', { 'aria-label': `String ${notes.length - s} note` });
      T.SHARP.forEach((nm, pc) => noteSel.append(h('option', { value: pc }, T.pretty(T.pcLabel(pc)))));
      const octSel = h('select', { 'aria-label': `String ${notes.length - s} octave` });
      for (let o = 0; o <= 5; o++) octSel.append(h('option', { value: o }, String(o)));
      noteSel.value = notes[s] % 12;
      octSel.value = Math.floor(notes[s] / 12) - 1;
      const upd = () => {
        notes[s] = (+octSel.value + 1) * 12 + +noteSel.value;
        updatePreview();
      };
      noteSel.addEventListener('change', upd);
      octSel.addEventListener('change', upd);
      rows.append(h('div', { class: 'tuning-row' }, h('span', { class: 'string-num' }, `String ${notes.length - s}`), noteSel, octSel));
    }
    updatePreview();

    const save = h('button', { type: 'submit', class: 'btn primary', value: 'save' }, isCustom ? 'Save changes' : 'Save as custom tuning');
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel');
    const del = isCustom
      ? h('button', {
          type: 'button',
          class: 'btn danger',
          onclick: () => {
            fb.customTunings = fb.customTunings.filter((t) => t.id !== cur.id);
            fb.tuning = '';
            dlg.close();
            changed();
            FS.toast('Custom tuning deleted');
          },
        }, 'Delete')
      : null;

    form.append(
      h('h2', null, 'Custom tuning'),
      h('p', { class: 'muted' }, `Set each string's note and octave (${fb.strings} strings, highest string first).`),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
      rows,
      preview,
      h('div', { class: 'dialog-actions' }, del, h('span', { class: 'spacer' }), cancel, save)
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = { id: isCustom ? cur.id : `custom-${Date.now()}`, strings: fb.strings, name: name.value.trim() || 'Custom', notes: notes.slice() };
      if (isCustom) fb.customTunings = fb.customTunings.map((x) => (x.id === t.id ? t : x));
      else fb.customTunings = (fb.customTunings || []).concat(t);
      fb.tuning = t.id;
      dlg.close();
      changed();
      FS.toast(`Saved tuning “${t.name}”`);
    });
    dlg.append(form);
    dlg.showModal();
  };
})();
