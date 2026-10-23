/**
 * chart-zoom.js — zoom, pan and a time cursor for the result charts, on the
 * time axis only. Replaces chartjs-plugin-zoom + hammer.js.
 *
 * Why not the plugin: it leaves `touch-action: none` on the canvas, so a finger
 * that lands on a chart can no longer scroll the page, and on a phone the
 * charts are most of the screen. It also has no reset control and no way to
 * place a cursor with a finger. This module sets `touch-action: pan-y` on the
 * host instead: vertical drags scroll the page as usual, and every horizontal
 * drag and pinch comes here.
 *
 * One finger: drag pans when zoomed in, moves the cursor when not. A tap puts
 * the cursor there. Two fingers: pinch zooms about the midpoint and moving the
 * midpoint pans. Double-tap / double-click resets. Ctrl+wheel (a trackpad
 * pinch arrives as one) zooms about the pointer; a horizontal wheel pans.
 *
 * The module owns the visible window and nothing else. It never draws: it asks
 * the chart for the x scale, changes the window, and calls `onChange`, where
 * the owner rescales the axes. The y axis is fitted by Chart.js to what is in
 * the window.
 */

(function () {
  /** Narrowest window offered, in minutes. */
  const MIN_SPAN_MIN = 2;
  const TAP_SLOP_PX = 8;
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_PX = 32;

  /**
   * @param {Object} o
   * @param {HTMLElement} o.host        element that receives the pointer events
   * @param {()=>Chart|null} o.getChart
   * @param {()=>{min:number,max:number}} o.getExtent  the whole time range of the data
   * @param {()=>void} o.onChange       the window moved
   * @param {(t:number)=>void} o.onCursor  the reader pointed at minute t
   */
  function createChartZoom({ host, getChart, getExtent, onChange, onCursor }) {
    /** null is the whole range; otherwise the window in minutes. */
    let view = null;

    const minSpan = () => Math.min(MIN_SPAN_MIN, getExtent().max - getExtent().min);

    /** The window to draw, always inside the data's extent. */
    function windowNow() {
      const { min: lo, max: hi } = getExtent();
      if (!view) return { min: lo, max: hi };
      const span = Math.min(Math.max(view.max - view.min, minSpan()), hi - lo);
      const min = Math.min(Math.max(view.min, lo), hi - span);
      return { min, max: min + span };
    }

    function isZoomed() {
      const { min: lo, max: hi } = getExtent();
      const w = windowNow();
      return w.max - w.min < (hi - lo) - 1e-9;
    }

    function set(min, max) {
      const { min: lo, max: hi } = getExtent();
      const span = Math.min(Math.max(max - min, minSpan()), hi - lo);
      const start = Math.min(Math.max(min, lo), hi - span);
      view = span >= (hi - lo) - 1e-9 ? null : { min: start, max: start + span };
      onChange();
    }

    function reset() {
      if (!view) return;
      view = null;
      onChange();
    }

    /** Scales the window by `factor` (<1 zooms in), keeping minute `anchor` where it is on screen. */
    function zoomBy(factor, anchor) {
      const w = windowNow();
      const span = w.max - w.min;
      const { min: lo, max: hi } = getExtent();
      const next = Math.min(Math.max(span * factor, minSpan()), hi - lo);
      const frac = span > 0 ? (anchor - w.min) / span : 0.5;
      set(anchor - frac * next, anchor - frac * next + next);
    }

    function area() {
      const chart = getChart();
      if (!chart || !chart.chartArea || !chart.scales || !chart.scales.x) return null;
      const rect = chart.canvas.getBoundingClientRect();
      return { left: rect.left + chart.chartArea.left, width: chart.chartArea.right - chart.chartArea.left };
    }

    /** The minute under a screen x, from the current window. */
    function timeAt(clientX) {
      const a = area();
      if (!a || a.width <= 0) return null;
      const w = windowNow();
      const frac = Math.min(Math.max((clientX - a.left) / a.width, 0), 1);
      return w.min + frac * (w.max - w.min);
    }

    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let lastTap = null;

    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const midX = () => {
      const [a, b] = [...pointers.values()];
      return (a.x + b.x) / 2;
    };
    const startDrag = (x, y, moved) => {
      const w = windowNow();
      drag = { x, y, min: w.min, span: w.max - w.min, moved, scrub: false };
    };

    host.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        startDrag(e.clientX, e.clientY, false);
      } else if (pointers.size === 2) {
        drag = null;
        const w = windowNow();
        const a = area();
        pinch = a && {
          span: w.max - w.min,
          dist: Math.max(distance(), 1),
          anchor: timeAt(midX())
        };
      }
    });

    host.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && pointers.size >= 2) {
        const a = area();
        if (!a || a.width <= 0) return;
        const { min: lo, max: hi } = getExtent();
        const span = Math.min(Math.max(pinch.span * pinch.dist / Math.max(distance(), 1), minSpan()), hi - lo);
        // Keep the minute that was under the midpoint at the start under the
        // midpoint now: that is both the zoom centre and the pan.
        const frac = Math.min(Math.max((midX() - a.left) / a.width, 0), 1);
        set(pinch.anchor - frac * span, pinch.anchor - frac * span + span);
        return;
      }

      if (!drag || pointers.size !== 1) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) drag.moved = true;
      if (!drag.moved) return;

      if (isZoomed()) {
        const a = area();
        if (!a || a.width <= 0) return;
        const min = drag.min - (dx / a.width) * drag.span;
        set(min, min + drag.span);
      } else {
        // Nothing to pan, so the finger moves the cursor — once the move is
        // mostly sideways, so a vertical page scroll that starts on the chart
        // does not drag the cursor along.
        if (!drag.scrub && Math.abs(dx) > Math.abs(dy)) drag.scrub = true;
        if (drag.scrub) {
          const t = timeAt(e.clientX);
          if (t !== null) onCursor(t);
        }
      }
    });

    function finish(e) {
      if (!pointers.has(e.pointerId)) return;
      const wasTap = drag && !drag.moved && e.type === 'pointerup';
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        drag = null;
        if (wasTap) tap(e);
      } else if (pointers.size === 1) {
        // One finger of a pinch is still down; it pans from where it is now.
        const [rest] = pointers.values();
        startDrag(rest.x, rest.y, true);
      }
    }
    host.addEventListener('pointerup', finish);
    host.addEventListener('pointercancel', finish);

    function tap(e) {
      const now = e.timeStamp;
      if (lastTap && now - lastTap.at < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
        lastTap = null;
        reset();
        return;
      }
      lastTap = { at: now, x: e.clientX, y: e.clientY };
      const t = timeAt(e.clientX);
      if (t !== null) onCursor(t);
    }

    host.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const t = timeAt(e.clientX);
        if (t !== null) zoomBy(Math.exp(e.deltaY * 0.01), t);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && isZoomed()) {
        e.preventDefault();
        const a = area();
        if (!a || a.width <= 0) return;
        const w = windowNow();
        const shift = (e.deltaX / a.width) * (w.max - w.min);
        set(w.min + shift, w.max + shift);
      }
    }, { passive: false });

    return {
      window: windowNow,
      isZoomed,
      reset,
      /** Button zoom, about the middle of what is showing. */
      step(factor) {
        const w = windowNow();
        zoomBy(factor, (w.min + w.max) / 2);
      }
    };
  }

  if (typeof window !== 'undefined') window.createChartZoom = createChartZoom;
})();
