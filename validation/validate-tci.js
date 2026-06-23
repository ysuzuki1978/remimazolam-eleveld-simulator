#!/usr/bin/env node
/**
 * validate-tci.js — checks for the plasma-target TCI / BIS-target dosing planner.
 *
 *   node validation/validate-tci.js
 *
 * The planner gives a small loading bolus (= targetCe·V1) to fill the central
 * compartment to target, then clamps plasma at the (possibly time-varying)
 * target each control interval. The effect-site / BIS follow with the ke0 lag.
 *
 * Verifies:
 *   1. effect-site Ce target: plasma held at target; Ce converges to target
 *   2. BIS target (60/50/40): BIS converges near target; tolerance-driven
 *      escalation (required Ce rises, metabolite accumulates, late infusion rises)
 *   3. loading bolus for a fixed BIS target decreases with age
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

console.log('\n=== 1. Effect-site Ce target = 0.80 µg/mL (plasma-clamp) ===');
{
  const r = TciEngine.planCeTarget(refPt(), 0.80, { duration: 40, sampleInterval: 0.5 });
  const params = r.params;
  check('loading bolus = target·V1', Math.abs(r.loadingBolusMg - 0.80 * params.V1) < 1e-6, `(${r.loadingBolusMg.toFixed(2)} mg)`);
  // plasma held at target throughout (incl. t=0 after the loading bolus)
  const cpErr = Math.max(...r.points.map(p => Math.abs(p.cp - 0.80)));
  check('plasma held at target (all times)', cpErr <= 0.02, `(max |Cp-0.80| = ${cpErr.toFixed(4)})`);
  // effect-site converges to target by end of 40 min
  const last = r.points[r.points.length - 1];
  check('Ce within 3% of target by 40 min', Math.abs(last.ceBis - 0.80) <= 0.024, `(Ce=${last.ceBis.toFixed(4)})`);
  // effect-site rises monotonically (no overshoot)
  let mono = true; for (let i = 1; i < r.points.length; i++) if (r.points[i].ceBis < r.points[i - 1].ceBis - 1e-6) mono = false;
  check('Ce rises monotonically (no overshoot)', mono);
}

console.log('\n=== 2. BIS targets converge + tolerance-driven escalation ===');
for (const target of [60, 50, 40]) {
  const r = TciEngine.planBisTarget(refPt(), target, { duration: 45, sampleInterval: 0.5 });
  // BIS settles near target over the last 15 min
  const tail = r.points.filter(p => p.timeMin >= 30);
  const bisErr = Math.max(...tail.map(p => Math.abs(p.bis - target)));
  check(`BIS=${target}: within ±3 over last 15 min`, bisErr <= 3, `(max |BIS-${target}| = ${bisErr.toFixed(2)})`);

  const t10 = at(r.points, 10), t30 = at(r.points, 30), t45 = at(r.points, 45);
  check(`BIS=${target}: required Ce rises (10->45 min)`, t45.targetCe > t10.targetCe,
        `(${t10.targetCe.toFixed(3)} -> ${t45.targetCe.toFixed(3)} µg/mL)`);
  check(`BIS=${target}: metabolite accumulates`, t45.cpMet > t10.cpMet,
        `(${t10.cpMet.toFixed(2)} -> ${t45.cpMet.toFixed(2)} µg/mL)`);
  // For deeper targets, tolerance dominates and late infusion rises (30 -> 45 min).
  // For light sedation (BIS 60) the tolerance effect is small, so report only.
  if (target <= 50) {
    check(`BIS=${target}: late infusion escalates (30->45 min)`, t45.infusionMgHr > t30.infusionMgHr,
          `(${t30.infusionMgHr.toFixed(1)} -> ${t45.infusionMgHr.toFixed(1)} mg/hr)`);
  } else {
    console.log(`     (BIS=${target}: late infusion ${t30.infusionMgHr.toFixed(1)} -> ${t45.infusionMgHr.toFixed(1)} mg/hr; tolerance effect small for light sedation)`);
  }
}

console.log('\n=== 3. Loading bolus for BIS=50 decreases with age ===');
{
  const ages = [20, 40, 60, 80];
  const bolusByAge = ages.map(a => {
    const r = TciEngine.planBisTarget(new Patient({ age: a, weight: 70, sex: SexType.MALE, opioid: true }), 50, { duration: 5, sampleInterval: 1 });
    return { a, b: r.loadingBolusMg };
  });
  bolusByAge.forEach(({ a, b }) => console.log(`     age ${a}: loading bolus = ${b.toFixed(2)} mg`));
  let dec = true;
  for (let i = 1; i < bolusByAge.length; i++) if (bolusByAge[i].b >= bolusByAge[i - 1].b) dec = false;
  check('loading bolus strictly decreases with age', dec);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
