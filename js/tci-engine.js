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

  const LOADING_MG_PER_KG = 0.1;   // standard loading bolus (mg/kg)
  const CTRL_GAIN = 1.5;           // how aggressively plasma is raised to pull Ce up
  const CTRL_CLIP = 2.2;           // cap plasma overshoot at CLIP × target

  /** state-vector index of the targeted effect-site compartment. */
  function effectSiteIndex(site) { return site === 'moaas' ? 6 : 7; }

  /**
   * General planner (effect-site-target TCI).
   *
   * Delivers a standard weight-based loading bolus (0.1 mg/kg) at t=0, then
   * drives the SELECTED effect-site concentration (BIS-site ke0=0.145 or
   * MOAA/S-site ke0=0.298) toward the (possibly time-varying) target. Each
   * control interval sets a plasma goal slightly above target while the
   * effect-site is still below it (proportional, capped at CTRL_CLIP×target),
   * so Ce rises smoothly without large overshoot and settles at target
   * (where plasma = effect-site = target).
   *
   * @param {Patient} patient
   * @param {(timeMin:number, obs:Object, params:Object)=>number} targetCeFn
   *        desired effect-site target (µg/mL) at a given time
   * @param {Object} [opts] { duration=60, dtCtrl=0.1, maxMgHr=1200,
   *                          sampleInterval=0.5, targetSite='bis'|'moaas' }
   * @returns {{params, targetSite, loadingBolusMg, peakRateMgHr, totalDoseMg, points}}
   */
  function plan(patient, targetCeFn, opts = {}) {
    const params = M.computeParameters(patient);
    const duration = opts.duration != null ? opts.duration : 60;
    const dtCtrl = opts.dtCtrl != null ? opts.dtCtrl : DEFAULT_CTRL;
    const rMax = (opts.maxMgHr != null ? opts.maxMgHr : 1200) / 60;
    const sampleInterval = opts.sampleInterval != null ? opts.sampleInterval : 0.5;
    const targetSite = opts.targetSite === 'moaas' ? 'moaas' : 'bis';
    const ceIdx = effectSiteIndex(targetSite);
    const s = infusionSensitivity(params, dtCtrl);

    const loadingBolusMg = LOADING_MG_PER_KG * patient.covariates.WGT;   // 0.1 mg/kg

    let y = M.bolus(M.createInitialState(), loadingBolusMg);
    const points = [];
    let totalDoseMg = loadingBolusMg;
    let peakRateMgHr = 0;
    const totalCtrl = Math.round(duration / dtCtrl);
    const sampleEvery = Math.max(1, Math.round(sampleInterval / dtCtrl));

    for (let c = 0; c <= totalCtrl; c++) {
      const tMin = c * dtCtrl;
      const obs = M.observe(y, params);
      const targetCe = targetCeFn(tMin, obs, params);
      const ceNow = y[ceIdx];

      // plasma goal: above target while the effect-site is below it, capped.
      let cpSet = targetCe + CTRL_GAIN * Math.max(0, targetCe - ceNow);
      if (cpSet > CTRL_CLIP * targetCe) cpSet = CTRL_CLIP * targetCe;

      const cpHomog = predictCpHomog(y, params, dtCtrl);
      let r = (cpSet - cpHomog) / s;        // mg/min
      if (r < 0) r = 0; else if (r > rMax) r = rMax;
      const rHr = r * 60;
      if (rHr > peakRateMgHr) peakRateMgHr = rHr;

      if (c % sampleEvery === 0) {
        points.push({ timeMin: tMin, infusionMgHr: rHr, targetCe, bolusMg: c === 0 ? loadingBolusMg : 0, ...obs });
      }

      if (c < totalCtrl) {
        const steps = Math.round(dtCtrl / DT);
        for (let i = 0; i < steps; i++) y = M.step(y, r, DT, params);
        totalDoseMg += r * dtCtrl;
      }
    }
    return { params, targetSite, loadingBolusMg, peakRateMgHr, totalDoseMg, points };
  }

  /**
   * Constant effect-site Ce target (µg/mL).
   * @param {Object} [opts] supports targetSite ('bis' | 'moaas')
   */
  function planCeTarget(patient, targetCe, opts = {}) {
    return plan(patient, () => targetCe, opts);
  }

  /**
   * Maintain a target BIS by raising the required Ce as the metabolite
   * accumulates. Drives the BIS effect-site. (competitive-antagonism aware)
   */
  function planBisTarget(patient, bisTarget, opts = {}) {
    const r = plan(patient, (t, obs, params) => M.requiredCeForBIS(bisTarget, obs.cpMet, params), { ...opts, targetSite: 'bis' });
    r.bisTarget = bisTarget;
    return r;
  }

  /**
   * Maintain a target (probability-weighted) MOAA/S score by raising the
   * required Ce as the metabolite accumulates. Drives the MOAA/S effect-site.
   */
  function planMoaasTarget(patient, moaasTarget, opts = {}) {
    const r = plan(patient, (t, obs, params) => M.requiredCeForMoaas(moaasTarget, obs.cpMet, params), { ...opts, targetSite: 'moaas' });
    r.moaasTarget = moaasTarget;
    return r;
  }

  return { plan, planCeTarget, planBisTarget, planMoaasTarget };
})();

if (typeof window !== 'undefined') window.TciEngine = TciEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = { TciEngine };
