/**
 * charts.js — Chart.js wrappers for the Remimazolam TCI Simulator.
 *
 *   MultiLineChart : configurable static/updatable multi-series line chart
 *                    with independent left/right y-axes. Used by monitoring
 *                    and TCI result views.
 *   RealtimeChart  : rolling-window chart for the real-time induction view.
 *
 * Requires Chart.js v3 (loaded via CDN in index.html).
 * Optional: chartjs-plugin-zoom + hammer.js (vendored locally) enable
 * wheel/pinch zoom and drag pan on the static result charts.
 */

// Register the zoom plugin if it was loaded (vendored, may be absent offline
// on very old caches — degrade gracefully to a non-zoomable chart).
if (typeof window !== 'undefined' && window.Chart && window.ChartZoom) {
  try { window.Chart.register(window.ChartZoom); } catch (e) { /* already registered */ }
}
const ZOOM_AVAILABLE = typeof window !== 'undefined' && !!window.ChartZoom;

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

/**
 * @param {Object} scales
 * @param {Object} [opts]  { zoom:boolean } — enable time-axis wheel/pinch zoom + drag pan
 */
function baseLineOptions(scales, opts = {}) {
  const plugins = {
    legend: { labels: { color: CHART_COLORS.text, boxWidth: 14, font: { size: 11 } } },
    tooltip: {
      callbacks: {
        title: (items) => items.length ? `${Number(items[0].parsed.x).toFixed(1)} min` : ''
      }
    }
  };
  if (opts.zoom && ZOOM_AVAILABLE) {
    // Zoom/pan the time (x) axis only; the concentration axis auto-scales.
    plugins.zoom = {
      pan: { enabled: true, mode: 'x' },
      zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
      limits: { x: { min: 'original', max: 'original' } }
    };
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: false,
    elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.15 } },
    plugins,
    scales
  };
}

class MultiLineChart {
  /**
   * @param {string} canvasId
   * @param {Object} axes  { left:{title, min?, max?}, right?:{title, min?, max?} }
   */
  constructor(canvasId, axes) {
    this.canvas = document.getElementById(canvasId);
    this.axes = axes;
    this.chart = null;
    // double-click resets any zoom/pan back to the full time range
    if (this.canvas && ZOOM_AVAILABLE) {
      this.canvas.addEventListener('dblclick', () => {
        if (this.chart && this.chart.resetZoom) this.chart.resetZoom();
      });
    }
  }

  _scales() {
    const mkAxis = (cfg, position, drawGrid) => ({
      type: 'linear',
      position,
      min: cfg.min,
      max: cfg.max,
      title: { display: true, text: cfg.title, color: CHART_COLORS.text, font: { size: 11 } },
      ticks: { color: CHART_COLORS.text, font: { size: 10 } },
      grid: { color: CHART_COLORS.grid, drawOnChartArea: drawGrid }
    });
    const scales = {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (min)', color: CHART_COLORS.text, font: { size: 11 } },
        ticks: { color: CHART_COLORS.text, font: { size: 10 } },
        grid: { color: CHART_COLORS.grid }
      },
      left: mkAxis(this.axes.left, 'left', true)
    };
    if (this.axes.right) scales.right = mkAxis(this.axes.right, 'right', false);
    return scales;
  }

  /**
   * @param {Object[]} points  time series
   * @param {Object[]} series  [{key,label,color,axis:'left'|'right',dash?}]
   */
  render(points, series) {
    const datasets = series.map(s => ({
      label: s.label,
      data: points.map(p => ({ x: p.timeMin, y: p[s.key] })),
      borderColor: s.color,
      backgroundColor: s.color,
      yAxisID: s.axis === 'right' ? 'right' : 'left',
      borderDash: s.dash || [],
      spanGaps: true
    }));

    if (this.chart) {
      this.chart.data.datasets = datasets;
      this.chart.options.scales = this._scales();
      this.chart.update();
      // new data → show the full new time range rather than a stale zoom window
      if (this.chart.resetZoom) this.chart.resetZoom('none');
    } else {
      this.chart = new Chart(this.canvas.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: baseLineOptions(this._scales(), { zoom: true })
      });
    }
  }

  destroy() { if (this.chart) { this.chart.destroy(); this.chart = null; } }
}

class RealtimeChart {
  /**
   * Rolling-window chart: plasma Cp + effect-site Ce (BIS) + effect-site Ce
   * (MOAA/S) on the left axis, predicted BIS on the right axis, vs elapsed min.
   * @param {string} canvasId
   * @param {number} maxPoints
   */
  constructor(canvasId, maxPoints = 4000) {
    this.canvas = document.getElementById(canvasId);
    this.maxPoints = maxPoints;
    this.chart = new Chart(this.canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Cp (parent)', data: [], borderColor: CHART_COLORS.cpRemi, backgroundColor: CHART_COLORS.cpRemi, yAxisID: 'left' },
          { label: 'Ce (BIS)', data: [], borderColor: CHART_COLORS.ceBis, backgroundColor: CHART_COLORS.ceBis, yAxisID: 'left' },
          { label: 'Ce (MOAA/S)', data: [], borderColor: CHART_COLORS.ceMoaas, backgroundColor: CHART_COLORS.ceMoaas, borderDash: [4, 3], yAxisID: 'left' },
          { label: 'BIS', data: [], borderColor: CHART_COLORS.bis, backgroundColor: CHART_COLORS.bis, yAxisID: 'right' }
        ]
      },
      options: baseLineOptions({
        x: {
          type: 'linear',
          title: { display: true, text: 'Elapsed (min)', color: CHART_COLORS.text, font: { size: 11 } },
          ticks: { color: CHART_COLORS.text, font: { size: 10 } },
          grid: { color: CHART_COLORS.grid }
        },
        left: {
          type: 'linear', position: 'left', min: 0,
          title: { display: true, text: 'Conc. (µg/mL)', color: CHART_COLORS.text, font: { size: 11 } },
          ticks: { color: CHART_COLORS.text, font: { size: 10 } },
          grid: { color: CHART_COLORS.grid }
        },
        right: {
          type: 'linear', position: 'right', min: 0, max: 100,
          title: { display: true, text: 'BIS', color: CHART_COLORS.text, font: { size: 11 } },
          ticks: { color: CHART_COLORS.text, font: { size: 10 } },
          grid: { drawOnChartArea: false }
        }
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
  }

  reset() {
    this.chart.data.datasets.forEach(d => { d.data = []; });
    this.chart.update('none');
  }
}

if (typeof window !== 'undefined') {
  window.CHART_COLORS = CHART_COLORS;
  window.MultiLineChart = MultiLineChart;
  window.RealtimeChart = RealtimeChart;
}
