/**
 * tci-engine.js — effect-site target-controlled infusion (TCI) and
 * BIS-target dosing planning.
 *
 * Method (model-predictive, no analytic BET needed):
 *   1. Loading bolus B sized so the BIS effect-site peak reaches the initial
 *      target Ce. For the linear central subsystem this is exact:
 *      B = targetCe0 / peak(Ce_bis | 1 mg bolus).
 *      At the effect-site peak, plasma = effect-site = target (dCe/dt = 0),
 *      so maintenance can clamp plasma at the target with no overshoot.
 *   2. Maintenance: each control interval, choose the infusion rate that makes
 *      the predicted end-of-interval plasma equal the (possibly time-varying)
 *      target. By superposition Cp_end(r) = Cp_homogeneous + r·s, where s is
 *      the unit-rate response (state-independent for the LTI A1/A2/A3 system).
 *
 * A time-varying target function lets the BIS-target planner raise the required
 * Ce as the metabolite accumulates (tolerance) — see planBisTarget (S6).
 */

const TciEngine = (() => {
  const M = (typeof EleveldRemimazolam !== 'undefined') ? EleveldRemimazolam
            : (typeof require !== 'undefined' ? require('./remimazolam-eleveld-pkpd.js').EleveldRemimazolam : null);

  const DT = 0.01;          // integration step (min)
  const DEFAULT_CTRL = 0.1; // control update interval (min, ~6 s)

  /** Peak BIS effect-site concentration for a 1 mg bolus (no infusion). */
  function unitBolusPeakCeBis(params, horizonMin = 30) {
    let y = M.bolus(M.createInitialState(), 1);
    let peak = 0;
    const n = Math.round(horizonMin / DT);
    for (let i = 0; i < n; i++) { y = M.step(y, 0, DT, params); if (y[7] > peak) peak = y[7]; }
    return peak;
  }

  /** Plasma response at end of one control interval to a unit (1 mg/min) rate. */
  function infusionSensitivity(params, dtCtrl) {
    let y = M.createInitialState();
    const n = Math.round(dtCtrl / DT);
    for (let i = 0; i < n; i++) y = M.step(y, 1, DT, params);
    return y[0] / params.V1;
  }

  /** Predicted plasma at end of interval with zero infusion (homogeneous). */
  function predictCpHomog(y, params, dtCtrl) {
    let yy = y.slice();
    const n = Math.round(dtCtrl / DT);
    for (let i = 0; i < n; i++) yy = M.step(yy, 0, DT, params);
    return yy[0] / params.V1;
  }

  /**
   * General planner.
   * @param {Patient} patient
   * @param {(timeMin:number, obs:Object, params:Object)=>number} targetCeFn
   *        desired plasma/effect-site clamp (µg/mL) at a given time
   * @param {Object} [opts] { duration=60, dtCtrl=0.1, maxMgHr=1200, sampleInterval=0.5 }
   * @returns {{params, loadingBolusMg, points: Object[]}}
   */
  function plan(patient, targetCeFn, opts = {}) {
    const params = M.computeParameters(patient);
    const duration = opts.duration != null ? opts.duration : 60;
    const dtCtrl = opts.dtCtrl != null ? opts.dtCtrl : DEFAULT_CTRL;
    const rMax = (opts.maxMgHr != null ? opts.maxMgHr : 1200) / 60;
    const sampleInterval = opts.sampleInterval != null ? opts.sampleInterval : 0.5;

    const peakUnit = unitBolusPeakCeBis(params);
    const obs0 = M.observe(M.createInitialState(), params);
    const targetCe0 = targetCeFn(0, obs0, params);
    const loadingBolusMg = peakUnit > 0 ? targetCe0 / peakUnit : 0;
    const s = infusionSensitivity(params, dtCtrl);

    let y = M.bolus(M.createInitialState(), loadingBolusMg);
    const points = [];
    const totalCtrl = Math.round(duration / dtCtrl);
    const sampleEvery = Math.max(1, Math.round(sampleInterval / dtCtrl));

    for (let c = 0; c <= totalCtrl; c++) {
      const tMin = c * dtCtrl;
      const obs = M.observe(y, params);
      const targetCe = targetCeFn(tMin, obs, params);

      const cpHomog = predictCpHomog(y, params, dtCtrl);
      let r = (targetCe - cpHomog) / s;        // mg/min
      if (r < 0) r = 0; else if (r > rMax) r = rMax;

      if (c % sampleEvery === 0) points.push({ timeMin: tMin, infusionMgHr: r * 60, targetCe, ...obs });

      if (c < totalCtrl) {
        const steps = Math.round(dtCtrl / DT);
        for (let i = 0; i < steps; i++) y = M.step(y, r, DT, params);
      }
    }
    return { params, loadingBolusMg, peakUnit, points };
  }

  /** Constant effect-site Ce target (µg/mL). */
  function planCeTarget(patient, targetCe, opts = {}) {
    return plan(patient, () => targetCe, opts);
  }

  /**
   * Maintain a target BIS by raising the required Ce as the metabolite
   * accumulates. (S6 — competitive-antagonism aware.)
   */
  function planBisTarget(patient, bisTarget, opts = {}) {
    const r = plan(patient, (t, obs, params) => M.requiredCeForBIS(bisTarget, obs.cpMet, params), opts);
    r.bisTarget = bisTarget;
    return r;
  }

  return { plan, planCeTarget, planBisTarget, unitBolusPeakCeBis };
})();

if (typeof window !== 'undefined') window.TciEngine = TciEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = { TciEngine };
