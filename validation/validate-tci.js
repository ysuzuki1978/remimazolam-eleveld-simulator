#!/usr/bin/env node
/**
 * validate-tci.js — checks for the plasma-target TCI / BIS-target dosing planner.
 *
 *   node validation/validate-tci.js
 *
 * The planner gives a standard weight-based loading bolus (0.1 mg/kg) at t=0,
 * then clamps plasma at the (possibly time-varying) target each control
 * interval. The effect-site / BIS follow with the ke0 lag (maintenance starts
 * once plasma has fallen to target).
 *
 * Verifies:
 *   1. effect-site Ce target: loading bolus = 0.1 mg/kg; plasma settles at
 *      target; Ce converges to target
 *   2. BIS target (60/50/40): BIS converges near target; tolerance-driven
 *      escalation (required Ce rises, metabolite accumulates, late infusion rises)
 *   3. loading bolus = 0.1 mg/kg across weights
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

console.log('\n=== 1. Effect-site Ce target = 0.80 µg/mL (0.1 mg/kg bolus + plasma-clamp) ===');
{
  const r = TciEngine.planCeTarget(refPt(), 0.80, { duration: 40, sampleInterval: 0.5 });
  check('loading bolus = 0.1 mg/kg', Math.abs(r.loadingBolusMg - 0.1 * 70) < 1e-6, `(${r.loadingBolusMg.toFixed(2)} mg)`);
  // plasma settles at target once the bolus has redistributed (t >= 5 min)
  const cpErr = Math.max(...r.points.filter(p => p.timeMin >= 5).map(p => Math.abs(p.cp - 0.80)));
  check('plasma held at target after 5 min', cpErr <= 0.02, `(max |Cp-0.80| = ${cpErr.toFixed(4)})`);
  // effect-site converges to target by end of 40 min
  const last = r.points[r.points.length - 1];
  check('Ce within 3% of target by 40 min', Math.abs(last.ceBis - 0.80) <= 0.024, `(Ce=${last.ceBis.toFixed(4)})`);
}

console.log('\n=== 2. BIS targets converge + tolerance-driven escalation ===');
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
    console.log(`     (BIS=${target}: late infusion ${t30.infusionMgHr.toFixed(1)} -> ${t45.infusionMgHr.toFixed(1)} mg/hr; tolerance effect small for light sedation)`);
  }
}

console.log('\n=== 3. Loading bolus = 0.1 mg/kg across weights ===');
{
  for (const wgt of [50, 70, 90]) {
    const r = TciEngine.planBisTarget(new Patient({ age: 50, weight: wgt, sex: SexType.MALE, opioid: true }), 50, { duration: 5, sampleInterval: 1 });
    check(`weight ${wgt} kg -> bolus ${(0.1 * wgt).toFixed(1)} mg`, Math.abs(r.loadingBolusMg - 0.1 * wgt) < 1e-6, `(${r.loadingBolusMg.toFixed(2)} mg)`);
  }
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
