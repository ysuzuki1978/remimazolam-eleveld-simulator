/**
 * recovery-panel.js — emergence forecast: "if the infusion stops now, when
 * does the patient emerge?"
 *
 * A small reusable panel used by both the TCI and Monitoring result views.
 * Given the state-carrying sample points of a run (each point has `.state`,
 * the full 8-state vector) plus the model params, it predicts — from a chosen
 * stop point — the time to:
 *   - MOAA/S >= 4 (responds to name) — a model-based emergence endpoint
 *   - effect-site Ce falling to the user's recorded ROC (return-of-consciousness)
 *     Ce — a personalised wake-up threshold
 *   - (secondary, PK) effect-site Ce decrement by a preset fraction
 *
 * Predicted BIS is intentionally NOT used as a wake-up endpoint: for a
 * benzodiazepine the model's BIS does not reliably reach ~70 at emergence
 * (ceiling), so a recorded ROC concentration is the better personalised target.
 *
 * The stop point defaults to the end of the run; hovering the bound chart moves
 * it to the hovered time ("from MM:SS"), so induction / maintenance / pre-wake
 * scenarios can be compared. The metabolite (CNS7054) accumulated up to the
 * stop point is carried through the washout, so tolerance is reflected.
 */

class RecoveryPanel {
  /** @param {string} containerId  element to render into */
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    /** @type {{points:Object[], params:Object, ceSite:string}|null} */
    this.data = null;
    this.chart = null;
    this.hoverIdx = null;      // index of the hovered sample point (null = end of run)
    this.decFrac = 0.5;        // selected Ce-decrement fraction (0.5 / 0.75 / 0.9)
    this._build();
  }

  _build() {
    if (!this.el) return;
    this.el.classList.add('recovery');
    this.el.innerHTML = `
      <div class="rec-head">
        <span class="rec-title">Emergence forecast · infusion stopped</span>
        <span class="rec-from" data-el="from">from end of plan</span>
      </div>
      <div class="rec-grid">
        <div class="rec-cell awake">
          <div class="rec-lbl">MOAA/S ≥ 4 · responds to name</div>
          <div class="rec-val" data-k="moaas">—</div>
        </div>
        <div class="rec-cell wake">
          <div class="rec-lbl">Ce falls to ROC <span class="rec-cell-sub" data-el="rocTileSub"></span></div>
          <div class="rec-val" data-k="wake">—</div>
        </div>
      </div>
      <div class="rec-roc">
        <label class="rec-ctrl">Recorded ROC Ce
          <input type="number" data-el="roc" min="0" step="0.01" placeholder="—"> µg/mL
        </label>
        <span class="rec-sub" data-el="rocHint">Record it on the Induction tab, or type the effect-site Ce at which your patient woke.</span>
      </div>
      <div class="rec-row rec-secondary">
        <div class="rec-ctrl-wrap">
          <span class="rec-ctrl-lbl">Effect-site Ce decrement <span class="rec-muted">(PK)</span></span>
          <span class="rec-chips" data-el="chips">
            <button type="button" class="rec-chip active" data-dec="50" title="−50% ≈ context-sensitive half-time">−50%</button>
            <button type="button" class="rec-chip" data-dec="75">−75%</button>
            <button type="button" class="rec-chip" data-dec="90">−90%</button>
          </span>
          <span class="rec-sub" data-el="decConc">—</span>
        </div>
        <div class="rec-val" data-k="dec">—</div>
      </div>`;

    const q = (sel) => this.el.querySelector(sel);
    this.ui = {
      from: q('[data-el="from"]'),
      roc: q('[data-el="roc"]'),
      rocHint: q('[data-el="rocHint"]'),
      rocTileSub: q('[data-el="rocTileSub"]'),
      chips: q('[data-el="chips"]'),
      decConc: q('[data-el="decConc"]'),
      vMoaas: q('.rec-val[data-k="moaas"]'),
      vWake: q('.rec-val[data-k="wake"]'),
      vDec: q('.rec-val[data-k="dec"]')
    };
    this.ui.roc.addEventListener('input', () => this.update());
    this.ui.chips.querySelectorAll('.rec-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.ui.chips.querySelectorAll('.rec-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.decFrac = (parseFloat(chip.dataset.dec) || 50) / 100;
        this.update();
      });
    });
  }

  /** @param {{points:Object[], params:Object, ceSite?:string, rocCe?:number}} data */
  setData(data) {
    this.data = data && data.points && data.points.length ? { ceSite: 'bis', ...data } : null;
    this.hoverIdx = null;
    // pre-fill the ROC field from a value recorded before this panel existed,
    // but never clobber a value the user has already typed
    if (data && data.rocCe != null && this.ui && this.ui.roc.value === '') {
      this.ui.roc.value = (+data.rocCe).toFixed(3);
    }
    this.update();
  }

  /** Set the recorded ROC Ce (called when the user records ROC in induction). */
  setRoc(ce) {
    if (!this.ui) return;
    this.ui.roc.value = (ce == null || !Number.isFinite(+ce)) ? '' : (+ce).toFixed(3);
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
      ['vMoaas', 'vWake', 'vDec'].forEach(k => { this.ui[k].textContent = '—'; this.ui[k].classList.remove('unreachable'); });
      this.ui.decConc.textContent = '—';
      this.ui.rocTileSub.textContent = '';
      return;
    }
    this.ui.from.textContent = this.hoverIdx !== null
      ? `from ${fmtClock(sp.timeMin)} (hover)`
      : 'from end of plan';

    const rocRaw = parseFloat(this.ui.roc.value);
    const rocCe = Number.isFinite(rocRaw) && rocRaw > 0 ? rocRaw : null;

    const r = EleveldRemimazolam.predictRecovery(sp.state, this.data.params, {
      ceSite: this.data.ceSite, ceDecFraction: this.decFrac, ceWakeTarget: rocCe
    });

    // MOAA/S (model-based emergence)
    this.ui.vMoaas.textContent = fmtDur(r.toMoaas);

    // Ce -> ROC (personalised wake-up threshold)
    if (rocCe == null) {
      this.ui.vWake.textContent = 'set ROC ↓';
      this.ui.vWake.classList.add('unreachable');
      this.ui.rocTileSub.textContent = '';
    } else {
      this.ui.rocTileSub.textContent = `(${rocCe.toFixed(2)} µg/mL)`;
      this.ui.vWake.classList.remove('unreachable');
      this.ui.vWake.textContent = r.alreadyAwakeByCe ? 'now (Ce ≤ ROC)' : fmtDur(r.toCeWake);
    }

    // secondary PK decrement
    this.ui.vDec.textContent = fmtDur(r.toCeDecrement);
    this.ui.decConc.textContent = `${r.ce0.toFixed(2)} → ${(r.ce0 * (1 - this.decFrac)).toFixed(2)} µg/mL`;
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
