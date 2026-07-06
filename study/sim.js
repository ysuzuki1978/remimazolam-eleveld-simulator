/**
 * sim.js — Simulation harness for the "remimazolam TIVA without step-down" study.
 *
 * Core question: with a single fixed maintenance infusion rate (no manual
 * step-down), does the plasma / effect-site concentration stay within a tight
 * band over a 5-6 h anaesthetic, across a broad virtual population (age x body
 * type), and is this materially better than propofol (which classically needs
 * step-down)?
 *
 * Two engines:
 *  - Generic 3-compartment + effect-site model (parent drug) for the PK
 *    step-down comparison between remimazolam and propofol. Because the 3-cpt
 *    model is LINEAR, the percentage band and step-down ratio are independent
 *    of the absolute target concentration — the comparison is scale-free.
 *  - Full Eleveld 2025 remimazolam engine (incl. metabolite CNS7054) for the
 *    PD analysis (BIS / MOAA/S drift, age sensitivity) — done in pd.js.
 *
 * PK parameters:
 *  - remimazolam: Eleveld 2025 (js/remimazolam-eleveld-pkpd.js)
 *  - propofol:    Eleveld 2018 (../propofol_TCI_TIVA_V1_0_0/js/eleveld-pk-pd.js)
 *
 * Output: results/pk_matrix.json, results/pk_summary.csv
 */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Drug PK parameter providers                                         */
/* ------------------------------------------------------------------ */

// remimazolam (Eleveld 2025)
const RM = require('../js/remimazolam-eleveld-pkpd.js').EleveldRemimazolam;
const rmModels = require('../js/models.js');
function remiParams(age, wgt) {
  const p = RM.computeParameters(new rmModels.Patient({ age, weight: wgt, sex: rmModels.SexType.MALE, opioid: true }));
  return { V1: p.V1, V2: p.V2, V3: p.V3, CL: p.CL, Q2: p.Q2, Q3: p.Q3, ke0: p.ke0_bis };
}

// propofol (Eleveld 2018) — load the app engine into scope
const PF_DIR = path.join(__dirname, '..', '..', 'propofol_TCI_TIVA_V1_0_0');
const pfModels = require(path.join(PF_DIR, 'js', 'models.js'));
for (const k in pfModels) global[k] = pfModels[k];
eval(fs.readFileSync(path.join(PF_DIR, 'js', 'eleveld-pk-pd.js'), 'utf8') +
  '\n;global.EleveldPKPDCalculator = EleveldPKPDCalculator;');
function propParams(age, wgt, hgt) {
  const pt = new pfModels.Patient('x', age, wgt, hgt, pfModels.SexType.MALE, pfModels.AsapsType.CLASS_1_2, pfModels.OpioidType.YES);
  const pk = EleveldPKPDCalculator.calculatePKParameters(pt);
  const pd = EleveldPKPDCalculator.calculatePDParameters(pt);
  return { V1: pk.V1, V2: pk.V2, V3: pk.V3, CL: pk.CL, Q2: pk.Q2, Q3: pk.Q3, ke0: pd.ke0 };
}

/* ------------------------------------------------------------------ */
/* Generic 3-compartment + effect-site integrator (RK4)                */
/* ------------------------------------------------------------------ */

function rateConstants(pk) {
  const { V1, V2, V3, CL, Q2, Q3 } = pk;
  return { k10: CL / V1, k12: Q2 / V1, k21: Q2 / V2, k13: Q3 / V1, k31: Q3 / V3, ke0: pk.ke0, V1 };
}
// state y = [A1, A2, A3, Ce]; infusion R (mg/min) into A1
function deriv(y, R, kc) {
  const [A1, A2, A3, Ce] = y;
  const cp = A1 / kc.V1;
  return [
    A2 * kc.k21 + A3 * kc.k31 - A1 * (kc.k10 + kc.k12 + kc.k13) + R,
    A1 * kc.k12 - A2 * kc.k21,
    A1 * kc.k13 - A3 * kc.k31,
    kc.ke0 * (cp - Ce)
  ];
}
function rk4(y, R, dt, kc) {
  const k1 = deriv(y, R, kc);
  const y2 = y.map((v, i) => v + 0.5 * dt * k1[i]); const k2 = deriv(y2, R, kc);
  const y3 = y.map((v, i) => v + 0.5 * dt * k2[i]); const k3 = deriv(y3, R, kc);
  const y4 = y.map((v, i) => v + dt * k3[i]); const k4 = deriv(y4, R, kc);
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

const DT = 0.05;          // integration step (min)
const DTC = 0.1;          // control interval (min)

/**
 * Infusion-rate profile needed to HOLD plasma Cp constant at Ct (BET-style).
 * Returns { rateAt: {t: mg/h}, series: [{t, cp, ce, rate}] }.
 * This is the classic manual step-down requirement.
 */
function holdPlasma(pk, Ct, durMin) {
  const kc = rateConstants(pk);
  // unit-rate plasma sensitivity over one control interval (state-independent, LTI)
  let u = [0, 0, 0, 0];
  const nStep = Math.round(DTC / DT);
  for (let i = 0; i < nStep; i++) u = rk4(u, 1, DT, kc);
  const sens = u[0] / kc.V1;                       // ΔCp per (1 mg/min) over DTC
  function homogNextCp(y) { let yy = y.slice(); for (let i = 0; i < nStep; i++) yy = rk4(yy, 0, DT, kc); return yy[0] / kc.V1; }

  let y = [Ct * kc.V1, 0, 0, 0];                   // loaded to target
  const series = [];
  const totalC = Math.round(durMin / DTC);
  for (let c = 0; c <= totalC; c++) {
    const t = c * DTC;
    const cpH = homogNextCp(y);
    let R = (Ct - cpH) / sens; if (R < 0) R = 0;
    series.push({ t, cp: y[0] / kc.V1, ce: y[3], rate: R * 60 });
    for (let i = 0; i < nStep; i++) y = rk4(y, R, DT, kc);
  }
  return { series };
}

/**
 * Fixed-rate maintenance: load bolus = Ct*V1, then a CONSTANT rate for durMin.
 * Returns Cp/Ce time series (mg/h rate constant).
 */
function fixedRate(pk, Ct, rateMgH, durMin) {
  const kc = rateConstants(pk);
  const R = rateMgH / 60;
  let y = [Ct * kc.V1, 0, 0, 0];
  const series = [];
  const totalC = Math.round(durMin / DTC);
  const nStep = Math.round(DTC / DT);
  for (let c = 0; c <= totalC; c++) {
    series.push({ t: c * DTC, cp: y[0] / kc.V1, ce: y[3] });
    for (let i = 0; i < nStep; i++) y = rk4(y, R, DT, kc);
  }
  return series;
}

/** Fixed regimen: bolus B (mg) at t=0 then constant rate R (mg/h) for durMin. */
function fixedRegimen(pk, B, rateMgH, durMin) {
  const kc = rateConstants(pk);
  const R = rateMgH / 60;
  let y = [B, 0, 0, 0];
  const series = [];
  const totalC = Math.round(durMin / DTC);
  const nStep = Math.round(DTC / DT);
  for (let c = 0; c <= totalC; c++) {
    series.push({ t: c * DTC, cp: y[0] / kc.V1, ce: y[3] });
    for (let i = 0; i < nStep; i++) y = rk4(y, R, DT, kc);
  }
  return series;
}

/**
 * Best SINGLE fixed regimen: optimize (loading bolus B, constant rate R) to
 * minimize the max fractional plasma deviation from Ct over [t0, durMin].
 * This is the fairest "one setting for the whole case" characterization.
 */
function bestFixedRegimen(pk, Ct, durMin, t0) {
  const kc = rateConstants(pk);
  const V1 = kc.V1;
  const cssRate = Ct * kc.k10 * V1 * 60;           // elimination-only rate (mg/h)
  let best = null;
  for (let bf = 1.0; bf <= 2.6; bf += 0.05) {      // bolus = bf * Ct*V1
    const B = bf * Ct * V1;
    for (let rf = 0.8; rf <= 2.2; rf += 0.02) {    // rate = rf * Css
      const R = cssRate * rf;
      const s = fixedRegimen(pk, B, R, durMin);
      let lo = Infinity, hi = -Infinity;
      for (const p of s) { if (p.t < t0) continue; const d = p.cp / Ct; if (d < lo) lo = d; if (d > hi) hi = d; }
      const maxDev = Math.max(hi - 1, 1 - lo);
      if (!best || maxDev < best.maxDev) best = { B, R, maxDev, lo, hi };
    }
  }
  return {
    bolusMg: +best.B.toFixed(1),
    rateMgH: +best.R.toFixed(1),
    maxDevPct: +(best.maxDev * 100).toFixed(1),
    bandLoPct: +((best.lo - 1) * 100).toFixed(1),
    bandHiPct: +((best.hi - 1) * 100).toFixed(1)
  };
}

/**
 * "Forgot to step down" scenario: hold Cp at Ct with a controller until
 * tSwitch, then FREEZE the rate for the rest of the case. Reports how far Cp
 * overshoots — the intrinsic penalty of not stepping down.
 */
function freezeAfter(pk, Ct, tSwitch, durMin) {
  const kc = rateConstants(pk);
  const nStep = Math.round(DTC / DT);
  let u = [0, 0, 0, 0]; for (let i = 0; i < nStep; i++) u = rk4(u, 1, DT, kc); const sens = u[0] / kc.V1;
  const homogNextCp = (y) => { let yy = y.slice(); for (let i = 0; i < nStep; i++) yy = rk4(yy, 0, DT, kc); return yy[0] / kc.V1; };
  let y = [Ct * kc.V1, 0, 0, 0];
  let Rfrozen = null;
  let maxCp = 0, cp360 = Ct;
  const totalC = Math.round(durMin / DTC);
  for (let c = 0; c <= totalC; c++) {
    const t = c * DTC;
    let R;
    if (t < tSwitch) { const cpH = homogNextCp(y); R = (Ct - cpH) / sens; if (R < 0) R = 0; }
    else { if (Rfrozen === null) Rfrozen = (() => { const cpH = homogNextCp(y); let r = (Ct - cpH) / sens; return r < 0 ? 0 : r; })(); R = Rfrozen; }
    const cp = y[0] / kc.V1;
    if (t >= tSwitch) { if (cp > maxCp) maxCp = cp; cp360 = cp; }
    for (let i = 0; i < nStep; i++) y = rk4(y, R, DT, kc);
  }
  return { overshootMaxPct: +((maxCp / Ct - 1) * 100).toFixed(1), overshoot360Pct: +((cp360 / Ct - 1) * 100).toFixed(1) };
}

/** Context-sensitive 50% decrement time after stopping at end of case. */
function decrement50(pk, Ct, durMin) {
  const kc = rateConstants(pk);
  // reach ~steady using best fixed rate hold, then stop and time Cp fall to 50%
  const cssRate = Ct * kc.k10 * kc.V1;             // mg/min elimination-only
  let y = [Ct * kc.V1, 0, 0, 0];
  const nStep = Math.round(DTC / DT);
  const totalC = Math.round(durMin / DTC);
  // hold near target with elimination rate + small correction via plasma clamp
  for (let c = 0; c < totalC; c++) {
    // simple plasma clamp to keep Cp≈Ct during the "case"
    const cpH = (() => { let yy = y.slice(); for (let i = 0; i < nStep; i++) yy = rk4(yy, 0, DT, kc); return yy[0] / kc.V1; })();
    let u = [0, 0, 0, 0]; for (let i = 0; i < nStep; i++) u = rk4(u, 1, DT, kc); const sens = u[0] / kc.V1;
    let R = (Ct - cpH) / sens; if (R < 0) R = 0;
    for (let i = 0; i < nStep; i++) y = rk4(y, R, DT, kc);
  }
  const cpStop = y[0] / kc.V1;
  let t = 0;
  while (t < 240) { for (let i = 0; i < nStep; i++) y = rk4(y, 0, DT, kc); t += DTC; if (y[0] / kc.V1 <= 0.5 * cpStop) break; }
  return +t.toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Virtual population matrix                                           */
/* ------------------------------------------------------------------ */

const HEIGHT = { 3: 96, 6: 116, 10: 138, 20: 171, 40: 171, 60: 168, 80: 165, 90: 162, 100: 158 };
const AGES = [3, 6, 10, 20, 40, 60, 80, 90, 100];
// BMI by category (age-appropriate for children)
function bmiSet(age) {
  if (age <= 5) return { under: 14, normal: 16, obese: 18 };
  if (age <= 8) return { under: 13.5, normal: 15.5, obese: 18.5 };
  if (age < 18) return { under: 14.5, normal: 17, obese: 22 };
  return { under: 17, normal: 22, obese: 30 };
}
function buildMatrix() {
  const rows = [];
  for (const age of AGES) {
    const h = HEIGHT[age];
    const bmis = bmiSet(age);
    for (const [bt, bmi] of Object.entries(bmis)) {
      const tbw = Math.round(bmi * Math.pow(h / 100, 2) * 2) / 2;
      rows.push({
        age, height: h, bodyType: bt, bmi, weight: tbw,
        ageExtrap: age < 6 || age > 93,
        weightExtrap: tbw < 21 || tbw > 171
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const DUR = 360;          // 6 h
const T0 = 15;            // maintenance window start (min) — after loading phase
const CT = { remi: 1.0, prop: 3.0 };  // absolute targets (µg/mL); % metrics are target-independent

function analysePatient(row) {
  const out = { ...row };
  for (const drug of ['remi', 'prop']) {
    const pk = drug === 'remi' ? remiParams(row.age, row.weight) : propParams(row.age, row.weight, row.height);
    const Ct = CT[drug];
    const hold = holdPlasma(pk, Ct, DUR).series;
    const at = (t) => hold.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
    const r30 = at(30).rate, r60 = at(60).rate, r360 = at(360).rate;
    const best = bestFixedRegimen(pk, Ct, DUR, T0);
    const froze = freezeAfter(pk, Ct, 20, DUR);
    const dec50 = decrement50(pk, Ct, DUR);
    out[drug] = {
      V1: +pk.V1.toFixed(2), V2: +pk.V2.toFixed(1), V3: +pk.V3.toFixed(1),
      CL: +pk.CL.toFixed(3), Q2: +pk.Q2.toFixed(2), Q3: +pk.Q3.toFixed(3), ke0: +pk.ke0.toFixed(4),
      // step-down requirement (hold-rate decline)
      stepdown_60_over_360: +(r60 / r360).toFixed(2),
      stepdown_decline_60to360_pct: +((1 - r360 / r60) * 100).toFixed(1),
      // "forgot to step down" overshoot (freeze maintenance at 20 min)
      freeze_overshoot_max_pct: froze.overshootMaxPct,
      freeze_overshoot_360_pct: froze.overshoot360Pct,
      // best single fixed regimen (bolus + rate) band over the case
      bestfix_bolus_mg: best.bolusMg,
      bestfix_rate_mgh: best.rateMgH,
      bestfix_maxdev_pct: best.maxDevPct,
      bestfix_band_lo_pct: best.bandLoPct,
      bestfix_band_hi_pct: best.bandHiPct,
      decrement50_min: dec50
    };
  }
  return out;
}

function main() {
  const matrix = buildMatrix();
  const results = matrix.map(analysePatient);
  fs.writeFileSync(path.join(__dirname, 'results', 'pk_matrix.json'), JSON.stringify(results, null, 2));

  // CSV summary
  const cols = ['age', 'bodyType', 'bmi', 'weight', 'ageExtrap', 'weightExtrap',
    'remi.V3', 'prop.V3',
    'remi.stepdown_decline_60to360_pct', 'prop.stepdown_decline_60to360_pct',
    'remi.bestfix_maxdev_pct', 'prop.bestfix_maxdev_pct',
    'remi.decrement50_min', 'prop.decrement50_min'];
  const get = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
  const lines = [cols.join(',')];
  for (const r of results) lines.push(cols.map(c => get(r, c)).join(','));
  fs.writeFileSync(path.join(__dirname, 'results', 'pk_summary.csv'), lines.join('\n'));

  // console summary
  console.log('n patients:', results.length);
  const R_ = results.map(r => r.remi), P_ = results.map(r => r.prop);
  const mean = (a, k) => (a.reduce((s, x) => s + x[k], 0) / a.length);
  const rng = (a, k) => `${Math.min(...a.map(x => x[k])).toFixed(1)}–${Math.max(...a.map(x => x[k])).toFixed(1)}`;
  console.log('\nheadline metrics (remi vs propofol, across all 27 virtual patients):');
  console.log(`  best single fixed-regimen band ±%:   remi ${rng(R_, 'bestfix_maxdev_pct')} (mean ${mean(R_, 'bestfix_maxdev_pct').toFixed(1)})   prop ${rng(P_, 'bestfix_maxdev_pct')} (mean ${mean(P_, 'bestfix_maxdev_pct').toFixed(1)})`);
  console.log(`  overshoot if maint. frozen @20min %: remi ${rng(R_, 'freeze_overshoot_360_pct')} (mean ${mean(R_, 'freeze_overshoot_360_pct').toFixed(1)})   prop ${rng(P_, 'freeze_overshoot_360_pct')} (mean ${mean(P_, 'freeze_overshoot_360_pct').toFixed(1)})`);
  console.log(`  hold-rate decline 60→360min %:       remi ${rng(R_, 'stepdown_decline_60to360_pct')} (mean ${mean(R_, 'stepdown_decline_60to360_pct').toFixed(1)})   prop ${rng(P_, 'stepdown_decline_60to360_pct')} (mean ${mean(P_, 'stepdown_decline_60to360_pct').toFixed(1)})`);
  console.log('\nage bt     wt   | remi: V3   bestfix±%  freeze360%  t50 | prop: V3    bestfix±%  freeze360%  t50');
  for (const r of results) {
    const R = r.remi, P = r.prop;
    console.log(
      `${String(r.age).padStart(3)} ${r.bodyType.padEnd(6)} ${String(r.weight).padStart(5)}${r.weightExtrap ? '*' : ' '}| ` +
      `${String(R.V3).padStart(5)} ${String(R.bestfix_maxdev_pct).padStart(7)}   ${String(R.freeze_overshoot_360_pct).padStart(7)}   ${String(R.decrement50_min).padStart(5)} | ` +
      `${String(P.V3).padStart(6)} ${String(P.bestfix_maxdev_pct).padStart(7)}   ${String(P.freeze_overshoot_360_pct).padStart(7)}   ${String(P.decrement50_min).padStart(5)}`
    );
  }
}

module.exports = {
  remiParams, propParams, rateConstants, rk4, deriv,
  holdPlasma, fixedRegimen, bestFixedRegimen, freezeAfter, decrement50,
  buildMatrix, HEIGHT, AGES, bmiSet, DT, DTC
};

if (require.main === module) main();
