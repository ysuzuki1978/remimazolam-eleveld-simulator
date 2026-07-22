/**
 * remimazolam-eleveld-pkpd.js
 * Eleveld 2025 remimazolam PK-PD model (core engine).
 *
 *   Eleveld DJ, Colin PJ, van den Berg JP, Koomen JV, Stoehr T, Struys MMRF.
 *   Br J Anaesth. 2025;135(1):206-217. doi:10.1016/j.bja.2025.02.038 (CC BY 4.0)
 *
 * Implements the final model exactly as given in the paper (Table 1, Fig 1)
 * and the Supplementary NONMEM code ($PK / $DES / $THETA / $ERR).
 *
 * Units (internal): drug amount mg · volume L · concentration µg/mL (= mg/L)
 *                   · clearance L/min · rate mg/min · time min.
 * The NONMEM "/1000" factors come from its internal µg amounts; with mg/L here
 * concentrations are already in µg/mL so no /1000 is needed.
 *
 * State vector y (8 states; venous-delay compartments A4/A8 are omitted because
 * TCI / effect-site use arterial + effect-site concentrations):
 *   y[0] A1  remimazolam central        (mg)
 *   y[1] A2  remimazolam peripheral 1   (mg)
 *   y[2] A3  remimazolam peripheral 2   (mg)
 *   y[3] A5  depot (front-end kinetics) (mg)
 *   y[4] A6  CNS7054 central            (mg-equivalent)
 *   y[5] A7  CNS7054 peripheral         (mg-equivalent)
 *   y[6] A9  remimazolam effect-site for MOAA/S (µg/mL)
 *   y[7] A10 remimazolam effect-site for BIS    (µg/mL)
 *
 * Key PD facts confirmed from the Supplementary NONMEM code:
 *   - BIS and MOAA/S sigmoids have NO gamma exponent (γ = 1).
 *   - The metabolite has NO effect-site; its central (plasma) concentration
 *     drives competitive antagonism directly.
 */

const EleveldRemimazolam = (() => {

  // Reference values (70 kg, 35 yr, male, normal hepatic/renal, no opioids).
  // These equal exp(THETA) from the Supplementary $THETA block.
  const REF = Object.freeze({
    // remimazolam PK
    V1: 4.30730, V2: 12.2994, V3: 18.6411,
    CL: 1.11977, Q2: 1.45260, Q3: 0.297838,
    // CNS7054 PK
    V1m: 6.851, V2m: 5.119, CLm: 0.06654, Q2m: 0.14064, Kdepot: 0.21539,
    MW_remi: 439.3, MW_met: 425.3,
    // BIS PD
    ke0_bis: 0.14497, ce50_bis: 0.98235, ca50_bis: 8.4097, baseline: 93.7196,
    // MOAA/S PD
    ke0_moaas: 0.29827, ce50_moaas: 0.18206, ca50_moaas: 11.921, DEFF: 19.888,
    // MOAA/S proportional-odds thetas
    b0_theta: -16.5952, th34: 0.975672,
    d12: 0.94218, d23: 1.46992, d34: 2.53989,
    kd01_opiates: 1.66842
  });

  /**
   * Compute all individual PK-PD parameters and rate constants for a patient.
   * @param {Patient|Object} patient  must expose `.covariates`
   */
  function computeParameters(patient) {
    const c = patient.covariates;
    const { AGE, WGT, M1F2, OA1P2, P1GT8, H1ESRD2 } = c;

    const Fsize = WGT / 70;
    const CSIZ = Math.pow(WGT / 70, 0.75);

    // --- remimazolam covariate exponents ---
    const KAV3 = 7.30817 / 1000 * (AGE - 35);
    const KSV3 = 28.7037 / 100 * (M1F2 - 1);
    const KHV3 = 82.3788 / 100 * (P1GT8 - 1);
    const KSCL = 16.2802 / 100 * (M1F2 - 1);
    const KOCL = -13.9340 / 100 * (OA1P2 - 1);

    const V1 = Fsize * REF.V1;
    const V2 = Fsize * REF.V2;
    const V3 = Fsize * REF.V3 * Math.exp(KAV3 + KSV3 + KHV3);
    const CL = CSIZ * REF.CL * Math.exp(KSCL + KOCL);
    const Q2 = CSIZ * REF.Q2;                                  // (WGT/70)^0.75 * Q2ref
    const Q3 = Math.pow(V3 / REF.V3, 0.75) * REF.Q3;

    // --- CNS7054 (metabolite) ---
    const VSCA = Math.pow(WGT / 70, 0.518482);
    const KRCL = -218.261 / 100 * (H1ESRD2 - 1);
    const KMOCL = -32.7503 / 100 * (OA1P2 - 1);
    const KPQ2 = 188.28 / 100 * (P1GT8 - 1);
    const KAQ2 = 15.7409 / 1000 * (AGE - 35);

    const V1m = REF.V1m * VSCA;
    const V2m = REF.V2m * VSCA;
    const CLm = REF.CLm * Math.pow(VSCA, 0.75) * Math.exp(KRCL + KMOCL);
    const Q2m = REF.Q2m * Math.pow(VSCA, 0.75) * Math.exp(KPQ2 + KAQ2);
    const KMD = REF.Kdepot * Math.pow(VSCA, -0.25);            // depot -> metabolite
    const KMO = CLm / V1m;                                     // metabolite elimination
    const MRAT = REF.MW_met / REF.MW_remi;                     // 100% conversion, MW correction

    // --- rate constants ---
    const k10 = CL / V1, k12 = Q2 / V1, k21 = Q2 / V2, k13 = Q3 / V1, k31 = Q3 / V3;
    const k123 = k10 + k12 + k13;
    const k12m = Q2m / V1m, k21m = Q2m / V2m;

    // --- PD: effect-site rate constants & Ce50/Ca50 (age covariates) ---
    const ke0_bis = REF.ke0_bis * Math.exp(-10.6456 / 1000 * (AGE - 35));
    const ce50_bis = REF.ce50_bis * Math.exp(-16.4038 / 1000 * (AGE - 35));
    const ca50_bis = REF.ca50_bis;
    const baseline = REF.baseline;

    const ke0_moaas = REF.ke0_moaas;                           // no age covariate
    const ce50_moaas = REF.ce50_moaas * Math.exp(-7.626 / 1000 * (AGE - 35));
    const ca50_moaas = REF.ca50_moaas;
    const DEFF = REF.DEFF;

    // --- MOAA/S proportional-odds intercepts (opioid-dependent) ---
    const DEOP = REF.kd01_opiates * (OA1P2 - 1);
    const DEB0 = Math.exp(REF.th34) - Math.exp(REF.th34 - DEOP);
    const b0 = REF.b0_theta + DEB0;
    const d01 = Math.exp(REF.th34 - DEOP);
    const d12 = REF.d12, d23 = REF.d23, d34 = REF.d34;

    return {
      V1, V2, V3, CL, Q2, Q3,
      V1m, V2m, CLm, Q2m, KMD, KMO, MRAT,
      k10, k12, k21, k13, k31, k123, k12m, k21m,
      ke0_bis, ce50_bis, ca50_bis, baseline,
      ke0_moaas, ce50_moaas, ca50_moaas, DEFF,
      b0, d01, d12, d23, d34
    };
  }

  /** Fresh zero state (drug-naive). */
  function createInitialState() {
    return [0, 0, 0, 0, 0, 0, 0, 0];
  }

  /** Add an instantaneous bolus (mg) to the central compartment. Mutates & returns y. */
  function bolus(y, doseMg) {
    y[0] += doseMg;
    return y;
  }

  /**
   * State derivative. dA9/dA10 are in concentration units (effect-site).
   * @param {number[]} y
   * @param {number} infMgMin  continuous infusion rate (mg/min) into A1
   * @param {Object} p         parameters from computeParameters
   */
  function deriv(y, infMgMin, p) {
    const A1 = y[0], A2 = y[1], A3 = y[2], A5 = y[3], A6 = y[4], A7 = y[5], A9 = y[6], A10 = y[7];
    const cp = A1 / p.V1;
    const metFlux = A6 * p.k12m - A7 * p.k21m;   // central -> peripheral net
    return [
      A2 * p.k21 + A3 * p.k31 - A1 * p.k123 + infMgMin, // dA1
      A1 * p.k12 - A2 * p.k21,                          // dA2
      A1 * p.k13 - A3 * p.k31,                          // dA3
      A1 * p.k10 * p.MRAT - A5 * p.KMD,                 // dA5 depot
      A5 * p.KMD - A6 * p.KMO - metFlux,                // dA6 metabolite central
      metFlux,                                          // dA7 metabolite peripheral
      p.ke0_moaas * (cp - A9),                          // dA9 MOAA/S effect-site
      p.ke0_bis * (cp - A10)                            // dA10 BIS effect-site
    ];
  }

  /** One RK4 integration step of length dt (min). Returns a NEW state array. */
  function step(y, infMgMin, dt, p) {
    const k1 = deriv(y, infMgMin, p);
    const y2 = new Array(8), y3 = new Array(8), y4 = new Array(8);
    for (let i = 0; i < 8; i++) y2[i] = y[i] + 0.5 * dt * k1[i];
    const k2 = deriv(y2, infMgMin, p);
    for (let i = 0; i < 8; i++) y3[i] = y[i] + 0.5 * dt * k2[i];
    const k3 = deriv(y3, infMgMin, p);
    for (let i = 0; i < 8; i++) y4[i] = y[i] + dt * k3[i];
    const k4 = deriv(y4, infMgMin, p);
    const out = new Array(8);
    for (let i = 0; i < 8; i++) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return out;
  }

  /** Numerically stable logistic. */
  function sigmoid(x) {
    return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
  }

  /**
   * Observe outputs from a state vector.
   * @returns {{cp,ceBis,ceMoaas,cpMet,bis,moaasProbs:number[],moaasWeighted}}
   */
  function observe(y, p) {
    const cp = y[0] / p.V1;
    const ceMoaas = y[6];
    const ceBis = y[7];
    const cpMet = y[4] / p.V1m;

    // --- BIS (competitive Emax, γ = 1) ---
    const rB = ceBis / p.ce50_bis;
    const effB = rB / (1 + rB + cpMet / p.ca50_bis);
    let bis = p.baseline * (1 - effB);
    if (bis < 0) bis = 0;
    if (bis > p.baseline) bis = p.baseline;

    // --- MOAA/S (proportional odds, γ = 1) ---
    const m = moaasFromCe(ceMoaas, cpMet, p);

    return { cp, ceBis, ceMoaas, cpMet, bis, moaasProbs: m.probs, moaasWeighted: m.weighted };
  }

  /**
   * MOAA/S proportional-odds score from a MOAA/S effect-site concentration and
   * the metabolite (plasma) concentration. Returns per-score probabilities and
   * the probability-weighted mean (0..5).
   */
  function moaasFromCe(ceMoaas, cpMet, p) {
    const rM = ceMoaas / p.ce50_moaas;
    const PEFFM = p.DEFF * rM / (1 + rM + cpMet / p.ca50_moaas);
    const LLE0 = p.b0 + PEFFM;
    const LLE1 = LLE0 + p.d01;
    const LLE2 = LLE1 + p.d12;
    const LLE3 = LLE2 + p.d23;
    const LLE4 = LLE3 + p.d34;
    const PLE0 = sigmoid(LLE0), PLE1 = sigmoid(LLE1), PLE2 = sigmoid(LLE2),
          PLE3 = sigmoid(LLE3), PLE4 = sigmoid(LLE4);
    // P[score = k], k = 0..5
    const probs = [PLE0, PLE1 - PLE0, PLE2 - PLE1, PLE3 - PLE2, PLE4 - PLE3, 1 - PLE4].map(v => v < 0 ? 0 : v);
    let weighted = 0;
    for (let k = 0; k < 6; k++) weighted += k * probs[k];
    return { probs, weighted };
  }

  /**
   * Invert the MOAA/S model: effect-site Ce (µg/mL) required for a target
   * probability-weighted MOAA/S score, given the metabolite concentration.
   * The weighted score decreases monotonically with Ce, so we bisect.
   * As cpMet accumulates, the required Ce rises (tolerance).
   */
  function requiredCeForMoaas(moaasTarget, cpMet, p) {
    if (moaasTarget >= 5) return 0;                 // already awake
    const target = moaasTarget <= 0 ? 1e-3 : moaasTarget;
    let lo = 0, hi = 10;                             // Ce range (µg/mL)
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      // weighted > target => still too light => need more drug => raise lo
      if (moaasFromCe(mid, cpMet, p).weighted > target) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /**
   * Invert the BIS equation: effect-site Ce (µg/mL) required to reach a target
   * BIS given the current metabolite concentration cpMet.
   *   E = 1 - BIS/Baseline = (Ce/Ce50) / (1 + Ce/Ce50 + Ca/Ca50)
   *   => Ce = Ce50 · E·(1 + Ca/Ca50) / (1 - E)
   * As cpMet accumulates, the required Ce rises (tolerance).
   */
  function requiredCeForBIS(bisTarget, cpMet, p) {
    const E = 1 - bisTarget / p.baseline;
    if (E <= 0) return 0;             // target >= baseline -> no drug needed
    if (E >= 1) return Infinity;      // target 0 -> unreachable
    return p.ce50_bis * E * (1 + cpMet / p.ca50_bis) / (1 - E);
  }

  /**
   * Recovery prediction: from a state y0 with the infusion STOPPED, integrate
   * forward and find the time (min) to each recovery endpoint. This is the
   * "if I stop the infusion now, when does the patient recover?" question, and
   * because the metabolite CNS7054 competitively antagonises the effect, its
   * (still-rising, then falling) concentration is carried through the washout.
   *
   * Endpoints (each null if not reached within maxMin):
   *   - toMoaas:       MOAA/S (probability-weighted) rises to >= moaasTarget
   *   - toBis:         predicted BIS rises to >= bisTarget
   *   - toCeWake:      effect-site Ce falls to/below ceWakeTarget — a recorded
   *                    return-of-consciousness (ROC) Ce used as a personalised
   *                    wake-up threshold. If Ce is already <= ceWakeTarget the
   *                    time is 0 (already at/below the wake threshold).
   *   - toCeDecrement: effect-site Ce falls to (1 - ceDecFraction) x its stop value
   *   - toCeTarget:    effect-site Ce falls to the absolute ceAbsTarget (µg/mL)
   *
   * The effect-site used for the Ce endpoints is selected by ceSite
   * ('bis' -> ke0 0.145 slot, 'moaas' -> ke0 0.298 slot). Awakening endpoints
   * are effect-model outputs and do not depend on ceSite.
   *
   * @param {number[]} y0
   * @param {Object} p   params from computeParameters
   * @param {Object} [opts] { moaasTarget=4, bisTarget=70, ceWakeTarget=null,
   *                          ceDecFraction=0.5, ceAbsTarget=null, ceSite='bis',
   *                          dt=0.25, maxMin=720 }
   * @returns {{ce0:number, ceSite:string, ceUnreachable:boolean, alreadyAwakeByCe:boolean,
   *            toMoaas:?number, toBis:?number, toCeWake:?number,
   *            toCeDecrement:?number, toCeTarget:?number}}
   */
  function predictRecovery(y0, p, opts = {}) {
    const dt = opts.dt != null ? opts.dt : 0.25;
    const maxMin = opts.maxMin != null ? opts.maxMin : 720;
    const ceIdx = opts.ceSite === 'moaas' ? 6 : 7;
    const moaasTarget = opts.moaasTarget != null ? opts.moaasTarget : 4;
    const bisTarget = opts.bisTarget != null ? opts.bisTarget : 70;
    const decFrac = opts.ceDecFraction != null ? opts.ceDecFraction : null;
    const ceAbs = opts.ceAbsTarget != null ? opts.ceAbsTarget : null;
    const ceWake = opts.ceWakeTarget != null ? opts.ceWakeTarget : null;

    let y = y0.slice();
    const ce0 = y[ceIdx];
    const decThreshold = decFrac != null ? ce0 * (1 - decFrac) : null;
    // an absolute Ce target at or above the current Ce cannot be reached by
    // washout alone (concentration only falls once the infusion is off)
    const ceUnreachable = ceAbs != null && ceAbs >= ce0;
    // a ROC wake threshold at/above the current Ce means the patient is already
    // at/below the wake concentration -> should already be emerging (time 0)
    const alreadyAwakeByCe = ceWake != null && ce0 <= ceWake;

    const res = {
      ce0, ceSite: opts.ceSite === 'moaas' ? 'moaas' : 'bis', ceUnreachable, alreadyAwakeByCe,
      toMoaas: null, toBis: null, toCeWake: null, toCeDecrement: null, toCeTarget: null
    };

    const o0 = observe(y, p);
    if (o0.moaasWeighted >= moaasTarget) res.toMoaas = 0;
    if (o0.bis >= bisTarget) res.toBis = 0;
    if (ceWake != null && y[ceIdx] <= ceWake) res.toCeWake = 0;
    if (decThreshold != null && y[ceIdx] <= decThreshold) res.toCeDecrement = 0;
    if (ceAbs != null && !ceUnreachable && y[ceIdx] <= ceAbs) res.toCeTarget = 0;

    const done = () =>
      res.toMoaas != null && res.toBis != null &&
      (ceWake == null || res.toCeWake != null) &&
      (decThreshold == null || res.toCeDecrement != null) &&
      (ceAbs == null || ceUnreachable || res.toCeTarget != null);

    const steps = Math.round(maxMin / dt);
    for (let s = 1; s <= steps && !done(); s++) {
      y = step(y, 0, dt, p);
      const t = s * dt;
      const o = observe(y, p);
      if (res.toMoaas == null && o.moaasWeighted >= moaasTarget) res.toMoaas = t;
      if (res.toBis == null && o.bis >= bisTarget) res.toBis = t;
      if (res.toCeWake == null && ceWake != null && y[ceIdx] <= ceWake) res.toCeWake = t;
      if (res.toCeDecrement == null && decThreshold != null && y[ceIdx] <= decThreshold) res.toCeDecrement = t;
      if (res.toCeTarget == null && ceAbs != null && !ceUnreachable && y[ceIdx] <= ceAbs) res.toCeTarget = t;
    }
    return res;
  }

  /**
   * Forward-simulate a list of dose events.
   * Semantics: each DoseEvent applies its bolus at event time and SETS the
   * continuous infusion rate (mg/hr) from that time forward.
   *
   * @param {Patient} patient
   * @param {DoseEvent[]} doseEvents
   * @param {Object} [opts] { duration=60, dt=0.1, sampleInterval=dt }  (min)
   * @returns {{params, points: Object[]}}  points are plain observation objects + timeMin + infusionMgHr
   */
  function simulate(patient, doseEvents, opts = {}) {
    const p = computeParameters(patient);
    const duration = opts.duration != null ? opts.duration : 60;
    const dt = opts.dt != null ? opts.dt : 0.1;
    const sampleInterval = opts.sampleInterval != null ? opts.sampleInterval : dt;

    // snap events to the integration grid
    const events = (doseEvents || [])
      .map(e => ({ step: Math.round(e.timeMin / dt), bolusMg: e.bolusMg || 0, contMgHr: e.continuousMgHr || 0, hasCont: e.continuousMgHr != null }))
      .sort((a, b) => a.step - b.step);

    let y = createInitialState();
    let infMgMin = 0;
    const totalSteps = Math.round(duration / dt);
    const sampleEvery = Math.max(1, Math.round(sampleInterval / dt));
    const points = [];
    let ev = 0;

    const record = (t, inf) => {
      const o = observe(y, p);
      // keep the full state so recovery ("stop infusion now") can be predicted
      // forward from any sampled time — see predictRecovery().
      points.push({ timeMin: t, infusionMgHr: inf * 60, state: y.slice(), ...o });
    };

    for (let s = 0; s <= totalSteps; s++) {
      // apply any events scheduled at this step (bolus + infusion change)
      while (ev < events.length && events[ev].step === s) {
        if (events[ev].bolusMg) bolus(y, events[ev].bolusMg);
        infMgMin = events[ev].contMgHr / 60;
        ev++;
      }
      if (s % sampleEvery === 0) record(s * dt, infMgMin);
      if (s < totalSteps) y = step(y, infMgMin, dt, p);
    }
    return { params: p, points };
  }

  return {
    REF,
    computeParameters,
    createInitialState,
    bolus,
    deriv,
    step,
    observe,
    moaasFromCe,
    requiredCeForBIS,
    requiredCeForMoaas,
    predictRecovery,
    simulate
  };
})();

if (typeof window !== 'undefined') window.EleveldRemimazolam = EleveldRemimazolam;
if (typeof module !== 'undefined' && module.exports) module.exports = { EleveldRemimazolam };
