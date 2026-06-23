#!/usr/bin/env node
/**
 * validate-model.js — sanity checks for the Eleveld 2025 remimazolam engine.
 *
 *   node validation/validate-model.js
 *
 * Verifies:
 *   1. reference-individual parameters vs paper Table 1
 *   2. covariate directions (age / sex / opioid / hepatic / renal)
 *   3. numerical sanity (RK4 vs fine Euler, single-bolus decay)
 *   4. BIS inversion round-trip + proposed-concentration BIS levels
 *   5. age effect: required Ce for a BIS target decreases with age
 */

const { Patient, SexType, HepaticFunction, RenalFunction, DoseEvent } = require('../js/models.js');
const { EleveldRemimazolam: M } = require('../js/remimazolam-eleveld-pkpd.js');

let pass = 0, fail = 0;
const approx = (a, b, relTol = 0.005) => Math.abs(a - b) <= relTol * Math.abs(b) + 1e-9;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? '  ' + detail : ''}`); }
}
const ref = () => new Patient({ age: 35, weight: 70, sex: SexType.MALE, opioid: false });

console.log('\n=== 1. Reference individual vs Table 1 (70kg, 35yr, male, no opioid) ===');
{
  const p = M.computeParameters(ref());
  check('V1 = 4.31',  approx(p.V1, 4.31, 0.01), `(${p.V1.toFixed(4)})`);
  check('V2 = 12.3',  approx(p.V2, 12.3, 0.01), `(${p.V2.toFixed(4)})`);
  check('V3 = 18.6',  approx(p.V3, 18.6, 0.01), `(${p.V3.toFixed(4)})`);
  check('CL = 1.12',  approx(p.CL, 1.12, 0.01), `(${p.CL.toFixed(4)})`);
  check('Q2 = 1.45',  approx(p.Q2, 1.45, 0.01), `(${p.Q2.toFixed(4)})`);
  check('Q3 = 0.298', approx(p.Q3, 0.298, 0.01), `(${p.Q3.toFixed(4)})`);
  check('V1m = 6.85', approx(p.V1m, 6.85, 0.01), `(${p.V1m.toFixed(4)})`);
  check('V2m = 5.12', approx(p.V2m, 5.12, 0.01), `(${p.V2m.toFixed(4)})`);
  check('CLm = 0.0665', approx(p.CLm, 0.0665, 0.01), `(${p.CLm.toFixed(5)})`);
  check('Q2m = 0.141', approx(p.Q2m, 0.141, 0.01), `(${p.Q2m.toFixed(5)})`);
  check('KMD(kdepot) = 0.215', approx(p.KMD, 0.215, 0.01), `(${p.KMD.toFixed(5)})`);
  check('ke0_BIS = 0.145', approx(p.ke0_bis, 0.145, 0.01), `(${p.ke0_bis.toFixed(5)})`);
  check('Ce50_BIS = 0.982', approx(p.ce50_bis, 0.982, 0.01), `(${p.ce50_bis.toFixed(4)})`);
  check('Baseline = 93.7', approx(p.baseline, 93.7, 0.01), `(${p.baseline.toFixed(3)})`);
  check('Ca50_BIS = 8.41', approx(p.ca50_bis, 8.41, 0.01), `(${p.ca50_bis.toFixed(4)})`);
  check('ke0_MOAAS = 0.298', approx(p.ke0_moaas, 0.298, 0.01), `(${p.ke0_moaas.toFixed(5)})`);
  check('Ce50_MOAAS = 0.182', approx(p.ce50_moaas, 0.182, 0.01), `(${p.ce50_moaas.toFixed(4)})`);
  check('Ca50_MOAAS = 11.9', approx(p.ca50_moaas, 11.9, 0.01), `(${p.ca50_moaas.toFixed(3)})`);
  check('DEFF = 19.9', approx(p.DEFF, 19.9, 0.01), `(${p.DEFF.toFixed(3)})`);
  check('d01(no opioid) = 2.65', approx(p.d01, 2.65, 0.01), `(${p.d01.toFixed(4)})`);
  check('d12 = 0.942', approx(p.d12, 0.942, 0.01), `(${p.d12.toFixed(4)})`);
  check('d23 = 1.47', approx(p.d23, 1.47, 0.01), `(${p.d23.toFixed(4)})`);
  check('d34 = 2.54', approx(p.d34, 2.54, 0.01), `(${p.d34.toFixed(4)})`);
  check('b0(no opioid) = -16.6', approx(p.b0, -16.6, 0.01), `(${p.b0.toFixed(3)})`);
}

console.log('\n=== 1b. Opioid-present MOAA/S intercepts vs Table 1 ===');
{
  const p = M.computeParameters(new Patient({ age: 35, weight: 70, sex: SexType.MALE, opioid: true }));
  check('b0(opioid) = -14.4', approx(p.b0, -14.4, 0.01), `(${p.b0.toFixed(3)})`);
  check('d01(opioid) = 0.500', approx(p.d01, 0.500, 0.02), `(${p.d01.toFixed(4)})`);
}

console.log('\n=== 2. Covariate directions ===');
{
  const base = M.computeParameters(ref());
  const female = M.computeParameters(new Patient({ age: 35, weight: 70, sex: SexType.FEMALE, opioid: false }));
  const old = M.computeParameters(new Patient({ age: 80, weight: 70, sex: SexType.MALE, opioid: false }));
  const opioid = M.computeParameters(new Patient({ age: 35, weight: 70, sex: SexType.MALE, opioid: true }));
  const hep = M.computeParameters(new Patient({ age: 35, weight: 70, sex: SexType.MALE, opioid: false, hepatic: HepaticFunction.SEVERE }));
  const esrd = M.computeParameters(new Patient({ age: 35, weight: 70, sex: SexType.MALE, opioid: false, renal: RenalFunction.ESRD }));
  check('CL higher in females', female.CL > base.CL, `(${female.CL.toFixed(3)} > ${base.CL.toFixed(3)})`);
  check('V3 higher in females', female.V3 > base.V3, `(${female.V3.toFixed(2)} > ${base.V3.toFixed(2)})`);
  check('V3 increases with age', old.V3 > base.V3, `(${old.V3.toFixed(2)} > ${base.V3.toFixed(2)})`);
  check('CL lower with opioids', opioid.CL < base.CL, `(${opioid.CL.toFixed(3)} < ${base.CL.toFixed(3)})`);
  check('V3 higher with hepatic insufficiency', hep.V3 > base.V3, `(${hep.V3.toFixed(2)} > ${base.V3.toFixed(2)})`);
  check('metabolite CLm lower in ESRD', esrd.CLm < base.CLm, `(${esrd.CLm.toFixed(5)} < ${base.CLm.toFixed(5)})`);
  check('BIS ke0 decreases with age', old.ke0_bis < base.ke0_bis, `(${old.ke0_bis.toFixed(4)} < ${base.ke0_bis.toFixed(4)})`);
  check('BIS Ce50 decreases with age', old.ce50_bis < base.ce50_bis, `(${old.ce50_bis.toFixed(4)} < ${base.ce50_bis.toFixed(4)})`);
}

console.log('\n=== 3. Numerical sanity ===');
{
  const patient = ref();
  const p = M.computeParameters(patient);
  // single 10 mg bolus, no infusion, RK4 dt=0.1 vs fine Euler dt=0.001
  function runRK4(dt, tEnd) {
    let y = M.bolus(M.createInitialState(), 10);
    const n = Math.round(tEnd / dt);
    for (let i = 0; i < n; i++) y = M.step(y, 0, dt, p);
    return M.observe(y, p).cp;
  }
  function runEuler(dt, tEnd) {
    let y = M.bolus(M.createInitialState(), 10);
    const n = Math.round(tEnd / dt);
    for (let i = 0; i < n; i++) {
      const d = M.deriv(y, 0, p);
      y = y.map((v, j) => v + dt * d[j]);
    }
    return M.observe(y, p).cp;
  }
  const cpRK4 = runRK4(0.1, 10);
  const cpEuler = runEuler(0.001, 10);
  check('RK4(dt=0.1) ≈ fine Euler(dt=0.001) at t=10min', approx(cpRK4, cpEuler, 0.01),
        `(RK4=${cpRK4.toFixed(5)}, Euler=${cpEuler.toFixed(5)})`);

  // immediate post-bolus Cp = dose / V1
  let y0 = M.bolus(M.createInitialState(), 10);
  check('post-bolus Cp = dose/V1', approx(M.observe(y0, p).cp, 10 / p.V1, 1e-6),
        `(${M.observe(y0, p).cp.toFixed(4)} = ${(10 / p.V1).toFixed(4)})`);

  // Cp monotonically decreasing after a bolus (no infusion)
  let y = M.bolus(M.createInitialState(), 10), prev = M.observe(y, p).cp, mono = true;
  for (let i = 0; i < 600; i++) { y = M.step(y, 0, 0.1, p); const cp = M.observe(y, p).cp; if (cp > prev + 1e-9) mono = false; prev = cp; }
  check('Cp monotonically decays after bolus', mono);

  // metabolite present after 5 min
  let ys = M.bolus(M.createInitialState(), 10);
  for (let i = 0; i < 50; i++) ys = M.step(ys, 0, 0.1, p);  // 5 min
  check('metabolite present after 5 min (Cp_met > 0)', M.observe(ys, p).cpMet > 0,
        `(Cp_met=${M.observe(ys, p).cpMet.toExponential(2)})`);

  // effect-site lags plasma immediately after a bolus (t=0.5 min: Ce < Cp)
  let ye = M.bolus(M.createInitialState(), 10);
  for (let i = 0; i < 5; i++) ye = M.step(ye, 0, 0.1, p);   // 0.5 min
  const oe = M.observe(ye, p);
  check('effect-site Ce_bis lags plasma early (Ce<Cp at 0.5 min)', oe.ceBis < oe.cp,
        `(Ce=${oe.ceBis.toFixed(4)}, Cp=${oe.cp.toFixed(4)})`);

  // hysteresis: effect-site Ce_bis peaks LATER than plasma (peak Cp is at t=0)
  let yh = M.bolus(M.createInitialState(), 10), peakCeT = 0, peakCe = 0, t = 0;
  for (let i = 0; i < 600; i++) { yh = M.step(yh, 0, 0.1, p); t += 0.1; const ce = M.observe(yh, p).ceBis; if (ce > peakCe) { peakCe = ce; peakCeT = t; } }
  check('effect-site Ce_bis peaks after plasma (hysteresis)', peakCeT > 0.1, `(peak Ce at ${peakCeT.toFixed(1)} min)`);
}

console.log('\n=== 4. BIS inversion + proposed concentrations ===');
{
  const p = M.computeParameters(ref());
  for (const target of [60, 50, 40]) {
    const ce = M.requiredCeForBIS(target, 0, p);
    // plug Ce back into the BIS formula (Ca=0) and confirm we recover target
    const rB = ce / p.ce50_bis;
    const bisBack = p.baseline * (1 - rB / (1 + rB));
    check(`requiredCeForBIS(${target}) round-trips`, approx(bisBack, target, 0.001),
          `(Ce=${ce.toFixed(3)} µg/mL -> BIS=${bisBack.toFixed(2)})`);
  }
  // tolerance: required Ce rises when metabolite present
  const ce0 = M.requiredCeForBIS(50, 0, p);
  const ce4 = M.requiredCeForBIS(50, 4, p);
  check('required Ce for BIS=50 rises with metabolite (tolerance)', ce4 > ce0,
        `(Ca=0 -> ${ce0.toFixed(3)}, Ca=4 -> ${ce4.toFixed(3)} µg/mL)`);

  // proposed concentrations (Fig 2): anaesthesia 5.25× / sedation 1.75× MOAA/S Ce50
  // at steady state effect-site Ce = plasma = target; report resulting BIS (Ca=0)
  const bisAt = (ceTarget) => { const r = ceTarget / p.ce50_bis; return p.baseline * (1 - r / (1 + r)); };
  const ceAnaes = 5.25 * p.ce50_moaas, ceSed = 1.75 * p.ce50_moaas;
  const bisAnaes = bisAt(ceAnaes), bisSed = bisAt(ceSed);
  check('anaesthesia target (5.25×Ce50_MOAAS) -> BIS ~50', bisAnaes >= 40 && bisAnaes <= 55,
        `(Ce=${ceAnaes.toFixed(3)} -> BIS=${bisAnaes.toFixed(1)})`);
  check('sedation target (1.75×Ce50_MOAAS) -> BIS 60-80', bisSed >= 60 && bisSed <= 80,
        `(Ce=${ceSed.toFixed(3)} -> BIS=${bisSed.toFixed(1)})`);
}

console.log('\n=== 5. Age effect: required Ce for BIS=50 decreases with age ===');
{
  const ages = [20, 40, 60, 80];
  const ceByAge = ages.map(a => {
    const p = M.computeParameters(new Patient({ age: a, weight: 70, sex: SexType.MALE, opioid: true }));
    return { a, ce: M.requiredCeForBIS(50, 0, p) };
  });
  ceByAge.forEach(({ a, ce }) => console.log(`     age ${a}: Ce(BIS50) = ${ce.toFixed(3)} µg/mL`));
  let dec = true;
  for (let i = 1; i < ceByAge.length; i++) if (ceByAge[i].ce >= ceByAge[i - 1].ce) dec = false;
  check('required Ce strictly decreases with age', dec);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
