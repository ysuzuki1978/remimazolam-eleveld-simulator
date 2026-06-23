/**
 * charts.js — Chart.js wrappers for the Remimazolam TCI Simulator.
 *
 *   MultiLineChart : configurable static/updatable multi-series line chart
 *                    with independent left/right y-axes. Used by monitoring
 *                    and TCI result views.
 *   RealtimeChart  : rolling-window chart for the real-time induction view.
 *
 * Requires Chart.js v3 (loaded via CDN in index.html).
 */

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
    plugins: {
      legend: { labels: { color: CHART_COLORS.text, boxWidth: 14, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          title: (items) => items.length ? `${Number(items[0].parsed.x).toFixed(1)} min` : ''
        }
      }
    },
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
    } else {
      this.chart = new Chart(this.canvas.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: baseLineOptions(this._scales())
      });
    }
  }

  destroy() { if (this.chart) { this.chart.destroy(); this.chart = null; } }
}

class RealtimeChart {
  /**
   * Rolling-window chart: effect-site Ce (left) + BIS (right) vs elapsed seconds.
   * @param {string} canvasId
   * @param {number} maxPoints
   */
  constructor(canvasId, maxPoints = 600) {
    this.canvas = document.getElementById(canvasId);
    this.maxPoints = maxPoints;
    this.chart = new Chart(this.canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Ce BIS (µg/mL)', data: [], borderColor: CHART_COLORS.ceBis, backgroundColor: CHART_COLORS.ceBis, yAxisID: 'left' },
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
          title: { display: true, text: 'Ce (µg/mL)', color: CHART_COLORS.text, font: { size: 11 } },
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

  addPoint(timeMin, ceBis, bis) {
    const ds = this.chart.data.datasets;
    ds[0].data.push({ x: timeMin, y: ceBis });
    ds[1].data.push({ x: timeMin, y: bis });
    if (ds[0].data.length > this.maxPoints) { ds[0].data.shift(); ds[1].data.shift(); }
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
