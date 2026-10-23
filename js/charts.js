/**
 * charts.js — Chart.js wrappers for the Remimazolam TCI Simulator.
 *
 *   MultiLineChart : configurable static/updatable multi-series line chart
 *                    with independent left/right y-axes. Used by monitoring
 *                    and TCI result views. Zoom/pan on the time axis and a
 *                    time cursor come from chart-zoom.js; the legend is HTML
 *                    chips that also read the values at the cursor.
 *   RealtimeChart  : rolling-window chart for the real-time induction view.
 *
 * Requires Chart.js v3 (loaded via CDN in index.html) and chart-zoom.js.
 */

/** A finger gets no tooltip: it stays after the touch and covers the curves. */
const COARSE_POINTER = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const isPhoneWidth = () => window.matchMedia('(max-width: 560px)').matches;

const CHART_COLORS = {
  cpRemi: '#3A8FD6',
  ceBis: '#2EA88B',
  ceMoaas: '#9B72B0',
  cpMet: '#D4A017',
  bis: '#E2603B',
  moaas: '#C77DCE',
  target: '#E2603B',
  grid: 'rgba(138,152,165,0.14)',
  text: '#8B98A5'
};

function baseLineOptions(scales) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.15 } },
    // Touch devices get no hover events at all; the cursor and the legend chips
    // carry the readings instead.
    events: COARSE_POINTER ? [] : ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => items.length ? `${Number(items[0].parsed.x).toFixed(1)} min` : ''
        }
      }
    },
    scales
  };
}

/** "Conc. (µg/mL)" -> "µg/mL"; "BIS" -> "BIS". Says which axis a chip is read on. */
function shortUnit(title) {
  const m = /\(([^)]*)\)/.exec(title || '');
  return m ? m[1] : (title || '');
}

/** One axis's tick/title styling. Titles are dropped on a phone: they cost ~28px of width each. */
function axisStyle(title, extra = {}) {
  return Object.assign({
    title: { display: !isPhoneWidth(), text: title, color: CHART_COLORS.text, font: { size: 11 } },
    ticks: { color: CHART_COLORS.text, font: { size: 11 } }
  }, extra);
}

/** The point whose timeMin is closest to t, in points sorted by timeMin. */
function nearestByTime(points, t) {
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeMin < t) lo = mid + 1; else hi = mid;
  }
  return (lo > 0 && t - points[lo - 1].timeMin < points[lo].timeMin - t) ? points[lo - 1] : points[lo];
}

/** Legend chip markup. `valueFor` is the key the value span is filled by. */
function chipHtml(c) {
  return `<button type="button" class="legend-chip${c.hidden ? ' off' : ''}" data-key="${c.key}" aria-pressed="${!c.hidden}">` +
    `<span class="legend-swatch" style="--swatch:${c.color};${c.dash && c.dash.length ? 'border-top-style:dashed;' : ''}"></span>` +
    `<span class="legend-name" title="${c.label}">${c.label}</span>` +
    `<span class="legend-value" data-value-for="${c.key}"></span>` +
    // "µg/mL ←": the unit is dropped on a phone and the arrow stays, saying which axis to read
    `<span class="legend-unit"><span class="u">${c.unit.slice(0, -1)}</span>${c.unit.slice(-1)}</span></button>`;
}

class MultiLineChart {
  /**
   * @param {string} canvasId
   * @param {Object} axes  { left:{title, min?, max?}, right?:{title, min?, max?} }
   * @param {Object} [opts] { onCursor(t|null) } — the reader pointed at minute t (null = cleared)
   */
  constructor(canvasId, axes, opts = {}) {
    this.canvas = document.getElementById(canvasId);
    this.axes = axes;
    this.opts = opts;
    this.chart = null;
    this.points = [];
    this.series = [];
    this.hidden = new Set();
    /** minute the reader pointed at, or null for "the end of the run" */
    this.cursor = null;

    const wrap = this.canvas.parentElement;
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'chart-legend';
    wrap.parentNode.insertBefore(this.legendEl, wrap);
    this.toolsEl = document.createElement('div');
    this.toolsEl.className = 'chart-tools';
    this.toolsEl.innerHTML =
      '<span class="chart-hint">Tap: cursor · pinch: zoom · drag: pan · double-tap: reset</span>' +
      '<span class="chart-zoom">' +
      '<button type="button" class="zoom-btn zoom-clear" data-act="clear" aria-label="Clear the cursor" hidden>Cursor ✕</button>' +
      '<button type="button" class="zoom-btn" data-act="out" aria-label="Zoom out">−</button>' +
      '<button type="button" class="zoom-btn" data-act="in" aria-label="Zoom in">+</button>' +
      '<button type="button" class="zoom-btn zoom-reset" data-act="fit" aria-label="Show the whole run" disabled>Fit</button>' +
      '</span>';
    wrap.parentNode.insertBefore(this.toolsEl, wrap.nextSibling);

    this.zoom = window.createChartZoom({
      host: wrap,
      getChart: () => this.chart,
      getExtent: () => this._extent(),
      onChange: () => this._applyView(),
      onCursor: (t) => this.setCursor(t)
    });

    this.toolsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'in') this.zoom.step(0.5);
      else if (b.dataset.act === 'out') this.zoom.step(2);
      else if (b.dataset.act === 'fit') this.zoom.reset();
      else if (b.dataset.act === 'clear') this.setCursor(null);
    });
    this.legendEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.legend-chip');
      if (!chip) return;
      const key = chip.dataset.key;
      if (this.hidden.has(key)) this.hidden.delete(key); else this.hidden.add(key);
      chip.classList.toggle('off', this.hidden.has(key));
      chip.setAttribute('aria-pressed', String(!this.hidden.has(key)));
      if (this.chart) {
        this.chart.data.datasets.forEach(d => { d.hidden = this.hidden.has(d.seriesKey); });
        this.chart.update('none');
      }
      this._drawValues();
    });
  }

  _extent() {
    const pts = this.points;
    return pts.length ? { min: pts[0].timeMin, max: pts[pts.length - 1].timeMin } : { min: 0, max: 1 };
  }

  _scales() {
    const win = this.zoom.window();
    const mkAxis = (cfg, position, drawGrid) => axisStyle(cfg.title, {
      type: 'linear',
      position,
      min: cfg.min,
      max: cfg.max,
      grid: { color: CHART_COLORS.grid, drawOnChartArea: drawGrid }
    });
    const x = axisStyle('Time (min)', {
      type: 'linear', min: win.min, max: win.max,
      grid: { color: CHART_COLORS.grid }
    });
    // The window's own edges are not round numbers once zoomed.
    x.title.display = true;
    x.ticks.includeBounds = false;
    x.ticks.maxRotation = 0;
    x.ticks.callback = (v) => Number(v.toFixed(2));
    const scales = { x, left: mkAxis(this.axes.left, 'left', true) };
    if (this.axes.right) scales.right = mkAxis(this.axes.right, 'right', false);
    return scales;
  }

  /** Moves the window on the chart that is already drawn. */
  _applyView() {
    this.toolsEl.querySelector('[data-act="fit"]').disabled = !this.zoom.isZoomed();
    if (!this.chart) return;
    const win = this.zoom.window();
    this.chart.options.scales.x.min = win.min;
    this.chart.options.scales.x.max = win.max;
    this.chart.update('none');
  }

  /** Puts the cursor at minute t (null clears it) and tells the owner. */
  setCursor(t) {
    this.cursor = t;
    this.toolsEl.querySelector('[data-act="clear"]').hidden = t === null;
    if (this.chart) this.chart.update('none');
    this._drawValues();
    if (this.opts.onCursor) this.opts.onCursor(t);
  }

  /** The reading of every series at the cursor (the end of the run when there is none). */
  _drawValues() {
    if (!this.points.length) return;
    const p = nearestByTime(this.points, this.cursor === null ? Infinity : this.cursor);
    for (const node of this.legendEl.querySelectorAll('[data-value-for]')) {
      const v = p[node.dataset.valueFor];
      node.textContent = this.hidden.has(node.dataset.valueFor) || v == null || !Number.isFinite(v) ? '' : Number(v).toPrecision(3);
    }
  }

  /**
   * @param {Object[]} points  time series
   * @param {Object[]} series  [{key,label,color,axis:'left'|'right',dash?}]
   */
  render(points, series) {
    this.points = points;
    this.series = series;
    // new data → the whole new range and no stale cursor, rather than a stale window
    this.zoom.reset();
    this.cursor = null;
    this.toolsEl.querySelector('[data-act="clear"]').hidden = true;

    const datasets = series.map(s => ({
      label: s.label,
      seriesKey: s.key,
      data: points.map(p => ({ x: p.timeMin, y: p[s.key] })),
      borderColor: s.color,
      backgroundColor: s.color,
      yAxisID: s.axis === 'right' ? 'right' : 'left',
      borderDash: s.dash || [],
      spanGaps: true,
      hidden: this.hidden.has(s.key)
    }));

    this.legendEl.innerHTML = series.map(s => chipHtml({
      key: s.key, label: s.label, color: s.color, dash: s.dash, hidden: this.hidden.has(s.key),
      unit: `${shortUnit(s.axis === 'right' ? this.axes.right.title : this.axes.left.title)} ${s.axis === 'right' ? '→' : '←'}`
    })).join('');

    if (this.chart) {
      this.chart.data.datasets = datasets;
      this.chart.options.scales = this._scales();
      this.chart.update('none');
    } else {
      const self = this;
      const options = baseLineOptions(this._scales());
      this.chart = new Chart(this.canvas.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options,
        plugins: [{
          id: 'cursorLine',
          afterDatasetsDraw(chart) {
            if (self.cursor === null) return;
            const x = chart.scales.x;
            if (self.cursor < x.min || self.cursor > x.max) return;
            const px = x.getPixelForValue(self.cursor);
            const a = chart.chartArea, ctx = chart.ctx;
            ctx.save();
            ctx.strokeStyle = CHART_COLORS.text;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
            ctx.restore();
          }
        }]
      });
    }
    this._applyView();
    this._drawValues();
  }

  destroy() { if (this.chart) { this.chart.destroy(); this.chart = null; } }
}

class RealtimeChart {
  /**
   * Rolling-window chart: plasma Cp + effect-site Ce (BIS) + effect-site Ce
   * (MOAA/S) on the left axis, predicted BIS on the right axis, vs elapsed min.
   * Its legend chips show the latest value of each series.
   * @param {string} canvasId
   * @param {number} maxPoints
   */
  constructor(canvasId, maxPoints = 4000) {
    this.canvas = document.getElementById(canvasId);
    this.maxPoints = maxPoints;
    const keys = [
      { key: 'cp', label: 'Cp (parent)', color: CHART_COLORS.cpRemi, unit: 'µg/mL ←' },
      { key: 'ceBis', label: 'Ce (BIS)', color: CHART_COLORS.ceBis, unit: 'µg/mL ←' },
      { key: 'ceMoaas', label: 'Ce (MOAA/S)', color: CHART_COLORS.ceMoaas, dash: [4, 3], unit: 'µg/mL ←' },
      { key: 'bis', label: 'BIS', color: CHART_COLORS.bis, unit: 'BIS →' }
    ];
    this.hidden = new Set();
    const wrap = this.canvas.parentElement;
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'chart-legend';
    this.legendEl.innerHTML = keys.map(chipHtml).join('');
    wrap.parentNode.insertBefore(this.legendEl, wrap);
    this.legendEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.legend-chip');
      if (!chip) return;
      const i = keys.findIndex(k => k.key === chip.dataset.key);
      const off = !this.chart.data.datasets[i].hidden;
      this.chart.data.datasets[i].hidden = off;
      chip.classList.toggle('off', off);
      chip.setAttribute('aria-pressed', String(!off));
      this.chart.update('none');
    });

    const ds = (k, axis) => ({
      label: k.label, data: [], borderColor: k.color, backgroundColor: k.color,
      borderDash: k.dash || [], yAxisID: axis
    });
    this.chart = new Chart(this.canvas.getContext('2d'), {
      type: 'line',
      data: { datasets: [ds(keys[0], 'left'), ds(keys[1], 'left'), ds(keys[2], 'left'), ds(keys[3], 'right')] },
      options: baseLineOptions({
        x: axisStyle('Elapsed (min)', { type: 'linear', grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text, font: { size: 11 }, maxRotation: 0 } }),
        left: axisStyle('Conc. (µg/mL)', { type: 'linear', position: 'left', min: 0, grid: { color: CHART_COLORS.grid } }),
        right: axisStyle('BIS', { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false } })
      })
    });
  }

  /** @param {{cp,ceBis,ceMoaas,bis}} v */
  addPoint(timeMin, v) {
    const ds = this.chart.data.datasets;
    ds[0].data.push({ x: timeMin, y: v.cp });
    ds[1].data.push({ x: timeMin, y: v.ceBis });
    ds[2].data.push({ x: timeMin, y: v.ceMoaas });
    ds[3].data.push({ x: timeMin, y: v.bis });
    if (ds[0].data.length > this.maxPoints) ds.forEach(d => d.data.shift());
    this.chart.update('none');
    for (const k of ['cp', 'ceBis', 'ceMoaas', 'bis']) {
      const node = this.legendEl.querySelector(`[data-value-for="${k}"]`);
      if (node) node.textContent = Number(v[k]).toPrecision(3);
    }
  }

  reset() {
    this.chart.data.datasets.forEach(d => { d.data = []; });
    this.chart.update('none');
    this.legendEl.querySelectorAll('[data-value-for]').forEach(n => { n.textContent = ''; });
  }
}

if (typeof window !== 'undefined') {
  window.CHART_COLORS = CHART_COLORS;
  window.MultiLineChart = MultiLineChart;
  window.RealtimeChart = RealtimeChart;
}
