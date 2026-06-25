#!/usr/bin/env node
/**
 * validate-tci.js — checks for the effect-site-target TCI / BIS-target planner.
 *
 *   node validation/validate-tci.js
 *
 * The planner gives a 0.1 mg/kg loading bolus, then drives the SELECTED
 * effect-site (BIS-site ke0=0.145 or MOAA/S-site ke0=0.298) toward the
 * (possibly time-varying) target, capping plasma overshoot.
 *
 * Verifies:
 *   1. effect-site Ce target, site=bis: BIS effect-site converges to target
 *   2. effect-site Ce target, site=moaas: MOAA/S effect-site converges, faster
 *   3. BIS target (60/50/40): BIS converges near target; tolerance escalation
 *   4. loading bolus = 0.1 mg/kg across weights
 */

const { Patient, SexType } = require('../js/models.js');
global.EleveldRemimazolam = require('../js/remimazolam-eleveld-pkpd.js').EleveldRemimazolam;
const { TciEngine } = require('../js/tci-engine.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? '  ' + detail : ''}`); }
}
const at = (pts, t) => pts.reduce((a, b) => Math.abs(b.timeMin - t) < Math.abs(a.timeMin - t) ? b : a);
const refPt = () => new Patient({ age: 50, weight: 70, sex: SexType.MALE, opioid: true });

console.log('\n=== 1. Effect-site Ce target 0.80, site=bis ===');
{
  const r = TciEngine.planCeTarget(refPt(), 0.80, { duration: 40, sampleInterval: 0.5, targetSite: 'bis' });
  check('loading bolus = 0.1 mg/kg', Math.abs(r.loadingBolusMg - 7.0) < 1e-6, `(${r.loadingBolusMg.toFixed(2)} mg)`);
  const tail = r.points.filter(p => p.timeMin >= 25);
  const err = Math.max(...tail.map(p => Math.abs(p.ceBis - 0.80)));
  check('BIS effect-site within 4% of target after 25 min', err <= 0.032, `(max |Ce_BIS-0.80| = ${err.toFixed(4)})`);
  check('plasma overshoot capped (Cp <= 2.2×target)', Math.max(...r.points.map(p => p.cp)) <= 0.80 * 2.2 + 0.05,
        `(max Cp = ${Math.max(...r.points.map(p => p.cp)).toFixed(3)})`);
}

console.log('\n=== 2. Effect-site Ce target 0.80, site=moaas (faster) ===');
{
  const rb = TciEngine.planCeTarget(refPt(), 0.80, { duration: 40, sampleInterval: 0.5, targetSite: 'bis' });
  const rm = TciEngine.planCeTarget(refPt(), 0.80, { duration: 40, sampleInterval: 0.5, targetSite: 'moaas' });
  const tail = rm.points.filter(p => p.timeMin >= 25);
  const err = Math.max(...tail.map(p => Math.abs(p.ceMoaas - 0.80)));
  check('MOAA/S effect-site within 4% of target after 25 min', err <= 0.032, `(max |Ce_MOAAS-0.80| = ${err.toFixed(4)})`);
  // MOAA/S site reaches target faster than BIS site does (compare at 6 min)
  const m6 = at(rm.points, 6).ceMoaas, b6 = at(rb.points, 6).ceBis;
  check('MOAA/S-site reaches target faster than BIS-site', m6 > b6, `(MOAA/S@6min=${m6.toFixed(3)} > BIS@6min=${b6.toFixed(3)})`);
}

console.log('\n=== 3. BIS targets converge + tolerance escalation ===');
for (const target of [60, 50, 40]) {
  const r = TciEngine.planBisTarget(refPt(), target, { duration: 45, sampleInterval: 0.5 });
  const tail = r.points.filter(p => p.timeMin >= 30);
  const bisErr = Math.max(...tail.map(p => Math.abs(p.bis - target)));
  check(`BIS=${target}: within ±3 over last 15 min`, bisErr <= 3, `(max |BIS-${target}| = ${bisErr.toFixed(2)})`);
  const t10 = at(r.points, 10), t30 = at(r.points, 30), t45 = at(r.points, 45);
  check(`BIS=${target}: required Ce rises (10->45 min)`, t45.targetCe > t10.targetCe,
        `(${t10.targetCe.toFixed(3)} -> ${t45.targetCe.toFixed(3)} µg/mL)`);
  check(`BIS=${target}: metabolite accumulates`, t45.cpMet > t10.cpMet,
        `(${t10.cpMet.toFixed(2)} -> ${t45.cpMet.toFixed(2)} µg/mL)`);
  if (target <= 50) {
    check(`BIS=${target}: late infusion escalates (30->45 min)`, t45.infusionMgHr > t30.infusionMgHr,
          `(${t30.infusionMgHr.toFixed(1)} -> ${t45.infusionMgHr.toFixed(1)} mg/hr)`);
  } else {
    console.log(`     (BIS=${target}: late infusion ${t30.infusionMgHr.toFixed(1)} -> ${t45.infusionMgHr.toFixed(1)} mg/hr; small for light sedation)`);
  }
}

console.log('\n=== 3b. MOAA/S targets hold + tolerance escalation ===');
{
  const M = global.EleveldRemimazolam;
  const p0 = M.computeParameters(refPt());
  // inversion round-trips (Ca=0)
  for (const tgt of [3.0, 2.5, 1.0]) {
    const ce = M.requiredCeForMoaas(tgt, 0, p0);
    const w = M.moaasFromCe(ce, 0, p0).weighted;
    check(`requiredCeForMoaas(${tgt}) round-trips`, Math.abs(w - tgt) <= 0.02, `(Ce=${ce.toFixed(3)} -> ${w.toFixed(3)})`);
  }
  for (const target of [3.0, 2.5, 1.0]) {
    const r = TciEngine.planMoaasTarget(refPt(), target, { duration: 60, sampleInterval: 0.5 });
    const tail = r.points.filter(x => x.timeMin >= 30);
    const err = Math.max(...tail.map(x => Math.abs(x.moaasWeighted - target)));
    check(`MOAA/S=${target}: held within ±0.15 after 30 min`, err <= 0.15, `(max dev ${err.toFixed(3)})`);
    const t10 = at(r.points, 10), t60 = at(r.points, 60);
    check(`MOAA/S=${target}: required Ce rises (10->60 min)`, t60.targetCe > t10.targetCe,
          `(${t10.targetCe.toFixed(3)} -> ${t60.targetCe.toFixed(3)} µg/mL)`);
  }
}

console.log('\n=== 4. Loading bolus = 0.1 mg/kg across weights ===');
{
  for (const wgt of [50, 70, 90]) {
    const r = TciEngine.planBisTarget(new Patient({ age: 50, weight: wgt, sex: SexType.MALE, opioid: true }), 50, { duration: 5, sampleInterval: 1 });
    check(`weight ${wgt} kg -> bolus ${(0.1 * wgt).toFixed(1)} mg`, Math.abs(r.loadingBolusMg - 0.1 * wgt) < 1e-6, `(${r.loadingBolusMg.toFixed(2)} mg)`);
  }
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
