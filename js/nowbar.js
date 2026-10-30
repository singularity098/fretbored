/* Fretbored — "now viewing" bar: the current scale/chord/key with its play button, pinned to the bottom of the screen on every tab that has one. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});
  const h = (...a) => FS.h(...a);

  // Keep the page's end clear of the visible bar (see body.has-now-bar in style.css).
  function syncBody() {
    const shown = document.querySelector('.now-bar.show');
    document.body.classList.toggle('has-now-bar', !!shown);
    if (shown) document.documentElement.style.setProperty('--nowbar-h', `${shown.offsetHeight}px`);
  }

  /**
   * panel: the tab panel; watchEl: the title element, used by the arrow that jumps back to it;
   * onAction: handler for the bar's play button.
   * Returns { set({ accent, rest, notes, action }) }.
   */
  FS.createNowBar = function (panel, watchEl, onAction) {
    const accent = h('span', { class: 'accent-text' });
    const rest = h('span');
    const notes = h('div', { class: 'nb-notes' });
    const action = h('button', { class: 'btn primary small nb-action', onclick: onAction });
    // Jumps to the title and its controls, wherever they are (↑ above, ↓ below); hidden while they are on screen.
    const up = h('button', {
      class: 'icon-btn nb-up',
      title: 'Go to the controls',
      'aria-label': 'Scroll to the controls',
      onclick: () => {
        const topbar = document.querySelector('.topbar').offsetHeight;
        window.scrollTo({ top: Math.max(0, window.scrollY + watchEl.getBoundingClientRect().top - topbar - 12), behavior: 'smooth' });
      },
    }, '↑');
    const bar = h('div', { class: 'now-bar', 'aria-hidden': 'true', 'data-noswipe': '' },
      h('div', { class: 'nb-inner' }, h('div', { class: 'nb-text' }, h('div', { class: 'nb-title' }, accent, rest), notes), action, up)
    );
    document.body.append(bar);
    new ResizeObserver(syncBody).observe(bar);

    let queued = false;
    function check() {
      queued = false;
      const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const r = watchEl.getBoundingClientRect();
      const below = r.top > window.innerHeight - 40;
      const above = r.bottom < top;
      up.hidden = !(above || below);
      up.textContent = below ? '↓' : '↑';
      const show = !panel.hidden;
      bar.classList.toggle('show', show);
      bar.setAttribute('aria-hidden', String(!show));
      syncBody();
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
