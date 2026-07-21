/**
 * info-popup.js — small click-to-open information popover for ⓘ icons.
 *
 * A single floating popup is reused for every anchor. Attach an ⓘ element with
 * InfoPopup.attach(iconEl, htmlOrFn); clicking (or Enter/Space) toggles the
 * popup near the icon. It closes on outside click, Escape, scroll or resize,
 * and is clamped/flipped to stay inside the viewport.
 */

const InfoPopup = (() => {
  let popup = null;
  let anchor = null;

  function ensure() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'info-popup';
    popup.setAttribute('role', 'dialog');
    popup.hidden = true;
    document.body.appendChild(popup);
    document.addEventListener('click', (e) => {
      if (popup.hidden) return;
      if (e.target === anchor || anchor?.contains(e.target) || popup.contains(e.target)) return;
      hide();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return popup;
  }

  function position(a) {
    const r = a.getBoundingClientRect();
    // measure first (visibility hidden so no flash)
    popup.style.visibility = 'hidden';
    popup.hidden = false;
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = r.left + window.scrollX;
    left = Math.min(left, window.scrollX + vw - pw - 8);
    left = Math.max(left, window.scrollX + 8);
    let top = r.bottom + window.scrollY + 6;
    // flip above the icon when there isn't room below
    if (r.bottom + ph + 12 > window.innerHeight && r.top - ph - 6 > 0) {
      top = r.top + window.scrollY - ph - 6;
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.visibility = '';
  }

  function show(a, html) {
    ensure();
    popup.innerHTML = html;
    anchor = a;
    a.setAttribute('aria-expanded', 'true');
    position(a);
  }

  function hide() {
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    anchor = null;
  }

  function toggle(a, html) {
    if (popup && !popup.hidden && anchor === a) { hide(); return; }
    show(a, html);
  }

  /** @param {Element} el  @param {string|()=>string} htmlOrFn */
  function attach(el, htmlOrFn) {
    if (!el) return;
    el.classList.add('info-ico');
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', 'false');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'More information');
    const getHtml = () => (typeof htmlOrFn === 'function' ? htmlOrFn() : htmlOrFn);
    el.addEventListener('click', (e) => { e.stopPropagation(); toggle(el, getHtml()); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(el, getHtml()); }
    });
  }

  return { attach, hide };
})();

if (typeof window !== 'undefined') window.InfoPopup = InfoPopup;
