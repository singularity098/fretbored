/* Fretbored — "now viewing" bar that pins the current scale/chord under the top bar while scrolling. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  // Keep --topbar-h in sync so fixed elements can sit just below the (sticky) top bar.
  function trackTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar || trackTopbar.done) return;
    trackTopbar.done = true;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
    set();
    new ResizeObserver(set).observe(bar);
  }

  /**
   * panel: the tab panel; watchEl: the title element — the bar shows while it is out of view (scrolled above the top bar, or still below the screen);
   * onAction: handler for the bar's play button.
   * Returns { set({ accent, rest, notes, action }) }.
   */
  FS.createNowBar = function (panel, watchEl, onAction) {
    trackTopbar();
    const accent = h('span', { class: 'accent-text' });
    const rest = h('span');
    const notes = h('div', { class: 'nb-notes' });
    const action = h('button', { class: 'btn primary small nb-action', onclick: onAction });
    // Jumps to the title and its controls, wherever they are (↑ above, ↓ below).
    const up = h('button', {
      class: 'icon-btn nb-up',
      title: 'Go to the controls',
      'aria-label': 'Scroll to the controls',
      onclick: () => {
        const topbar = document.querySelector('.topbar').offsetHeight;
        window.scrollTo({ top: Math.max(0, window.scrollY + watchEl.getBoundingClientRect().top - topbar - 12), behavior: 'smooth' });
      },
    }, '↑');
    const bar = h('div', { class: 'now-bar', 'aria-hidden': 'true' },
      h('div', { class: 'nb-inner' }, h('div', { class: 'nb-text' }, h('div', { class: 'nb-title' }, accent, rest), notes), action, up)
    );
    document.body.append(bar);

    let queued = false;
    function check() {
      queued = false;
      const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const r = watchEl.getBoundingClientRect();
      // The title can be out of view above (scrolled past) or below (the fretboard comes first).
      const below = r.top > window.innerHeight - 40;
      const show = !panel.hidden && (r.bottom < top || below);
      up.textContent = below ? '↓' : '↑';
      // Title below the screen (fretboard first): sit at the bottom so the top of the tab stays usable.
      if (show) bar.classList.toggle('at-bottom', below);
      bar.classList.toggle('show', show);
      bar.setAttribute('aria-hidden', String(!show));
    }
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(check);
      }
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    FS.on('tab', queue);
    new ResizeObserver(queue).observe(panel); // layout shifts (e.g. the fretboard rendering)

    return {
      set(o) {
        accent.textContent = o.accent || '';
        rest.textContent = o.rest ? ` ${o.rest}` : '';
        notes.textContent = o.notes || '';
        action.textContent = o.action || '';
        action.hidden = !o.action;
      },
    };
  };
})();
