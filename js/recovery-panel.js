/**
 * recovery-panel.js — "if the infusion stops now, when does the patient recover?"
 *
 * A small reusable panel used by both the TCI and Monitoring result views.
 * Given the state-carrying sample points of a run (each point has `.state`,
 * the full 8-state vector) plus the model params, it predicts — from a chosen
 * stop point — the time to:
 *   - MOAA/S >= 4 and BIS >= 70   (awakening; case A)
 *   - effect-site Ce (BIS site) decreasing by a slider % (case B; 50% ~ CSHT)
 *   - effect-site Ce reaching an absolute target the user types (case C)
 *
 * The stop point defaults to the end of the run; hovering the bound chart moves
 * it to the hovered time ("from MM:SS"), so induction / maintenance / pre-wake
 * recovery scenarios can be compared. The metabolite (CNS7054) accumulated up
 * to the stop point is carried through the washout, so tolerance is reflected.
 */

class RecoveryPanel {
  /** @param {string} containerId  element to render into */
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    /** @type {{points:Object[], params:Object, ceSite:string}|null} */
    this.data = null;
    this.chart = null;
    this.hoverIdx = null;      // index of the hovered sample point (null = end of run)
    this._build();
  }

  _build() {
    if (!this.el) return;
    this.el.classList.add('recovery');
    this.el.innerHTML = `
      <div class="rec-head">
        <span class="rec-title">Recovery — if infusion stops</span>
        <span class="rec-from" data-el="from">from end of plan</span>
      </div>
      <div class="rec-grid">
        <div class="rec-cell awake"><div class="rec-lbl">MOAA/S ≥ 4 (responds)</div><div class="rec-val" data-k="moaas">—</div></div>
        <div class="rec-cell awake"><div class="rec-lbl">BIS ≥ 70 (awake)</div><div class="rec-val" data-k="bis">—</div></div>
      </div>
      <div class="rec-row">
        <label class="rec-ctrl">Ce (BIS) −<output data-el="decOut">50</output>%
          <input type="range" data-el="dec" min="20" max="95" step="5" value="50">
        </label>
        <div class="rec-val" data-k="dec">—</div>
      </div>
      <div class="rec-row">
        <label class="rec-ctrl">Ce (BIS) → target
          <input type="number" data-el="tgt" min="0" step="0.05" value="0.30"> µg/mL
        </label>
        <div class="rec-val" data-k="tgt">—</div>
      </div>`;

    const q = (sel) => this.el.querySelector(sel);
    this.ui = {
      from: q('[data-el="from"]'),
      dec: q('[data-el="dec"]'),
      decOut: q('[data-el="decOut"]'),
      tgt: q('[data-el="tgt"]'),
      vMoaas: q('.rec-val[data-k="moaas"]'),
      vBis: q('.rec-val[data-k="bis"]'),
      vDec: q('.rec-val[data-k="dec"]'),
      vTgt: q('.rec-val[data-k="tgt"]')
    };
    this.ui.dec.addEventListener('input', () => { this.ui.decOut.textContent = this.ui.dec.value; this.update(); });
    this.ui.tgt.addEventListener('input', () => this.update());
  }

  /** @param {{points:Object[], params:Object, ceSite?:string}} data */
  setData(data) {
    this.data = data && data.points && data.points.length ? { ceSite: 'bis', ...data } : null;
    this.hoverIdx = null;
    this.update();
  }

  /** Bind chart hover so the stop point tracks the cursor time. */
  bindChart(chart) {
    if (!chart || !chart.canvas || this._boundCanvas === chart.canvas) { this.chart = chart; return; }
    this.chart = chart;
    this._boundCanvas = chart.canvas;
    chart.canvas.addEventListener('mousemove', (e) => this._onHover(e));
    chart.canvas.addEventListener('mouseleave', () => { if (this.hoverIdx !== null) { this.hoverIdx = null; this.update(); } });
  }

  _onHover(e) {
    if (!this.data || !this.chart || !this.chart.scales || !this.chart.scales.x) return;
    const rect = this.chart.canvas.getBoundingClientRect();
    const t = this.chart.scales.x.getValueForPixel(e.clientX - rect.left);
    const idx = this._nearestIndex(t);
    if (idx !== this.hoverIdx) { this.hoverIdx = idx; this.update(); }
  }

  _nearestIndex(t) {
    const pts = this.data.points;
    // points are ascending in timeMin; binary search then compare neighbours
    let lo = 0, hi = pts.length - 1;
    if (t <= pts[0].timeMin) return 0;
    if (t >= pts[hi].timeMin) return hi;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].timeMin < t) lo = mid + 1; else hi = mid;
    }
    return (lo > 0 && Math.abs(pts[lo - 1].timeMin - t) <= Math.abs(pts[lo].timeMin - t)) ? lo - 1 : lo;
  }

  _stopPoint() {
    if (!this.data) return null;
    const pts = this.data.points;
    return pts[this.hoverIdx !== null ? this.hoverIdx : pts.length - 1];
  }

  update() {
    if (!this.el) return;
    const sp = this._stopPoint();
    if (!sp || !sp.state) {
      this.ui.from.textContent = 'no plan yet';
      ['vMoaas', 'vBis', 'vDec', 'vTgt'].forEach(k => { this.ui[k].textContent = '—'; this.ui[k].classList.remove('unreachable'); });
      return;
    }
    this.ui.from.textContent = this.hoverIdx !== null
      ? `from ${fmtClock(sp.timeMin)} (hover)`
      : 'from end of plan';

    const decFrac = (parseFloat(this.ui.dec.value) || 50) / 100;
    const tgtRaw = parseFloat(this.ui.tgt.value);
    const ceAbs = Number.isFinite(tgtRaw) && tgtRaw > 0 ? tgtRaw : null;

    const r = EleveldRemimazolam.predictRecovery(sp.state, this.data.params, {
      ceSite: this.data.ceSite, ceDecFraction: decFrac, ceAbsTarget: ceAbs
    });

    this.ui.vMoaas.textContent = fmtDur(r.toMoaas);
    this.ui.vBis.textContent = fmtDur(r.toBis);
    this.ui.vDec.textContent = fmtDur(r.toCeDecrement);
    if (ceAbs == null) {
      this.ui.vTgt.textContent = '—';
      this.ui.vTgt.classList.remove('unreachable');
    } else if (r.ceUnreachable) {
      this.ui.vTgt.textContent = `≥ current (${r.ce0.toFixed(2)})`;
      this.ui.vTgt.classList.add('unreachable');
    } else {
      this.ui.vTgt.textContent = fmtDur(r.toCeTarget);
      this.ui.vTgt.classList.remove('unreachable');
    }
  }
}

/** minutes -> "X.X min" / "now" / ">12 h" (null = not reached within horizon) */
function fmtDur(min) {
  if (min == null) return '> 12 h';
  if (min <= 0) return 'now';
  if (min < 100) return `${min.toFixed(1)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h} h ${m} min`;
}

/** elapsed minutes -> "MM:SS" clock-style label for the "from" note */
function fmtClock(min) {
  const total = Math.max(0, Math.round(min * 60));
  const mm = Math.floor(total / 60), ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

if (typeof window !== 'undefined') window.RecoveryPanel = RecoveryPanel;
