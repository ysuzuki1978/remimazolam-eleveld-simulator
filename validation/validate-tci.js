#!/usr/bin/env node
/**
 * validate-tci.js — checks for the TCI / BIS-target dosing planner.
 *
 *   node validation/validate-tci.js
 *
 * Verifies:
 *   1. effect-site Ce target converges and holds
 *   2. BIS target (60/50/40) holds BIS near target with tolerance-driven
 *      dose escalation (required Ce and infusion rate increase over time)
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
const refPt = () => new Patient({ age: 50, weight: 70, sex: SexType.MALE, opioid: true });

console.log('\n=== 1. Effect-site Ce target = 0.80 µg/mL ===');
{
  const r = TciEngine.planCeTarget(refPt(), 0.80, { duration: 30, sampleInterval: 0.5 });
  check('loading bolus > 0', r.loadingBolusMg > 0, `(${r.loadingBolusMg.toFixed(2)} mg)`);
  // after 8 min, effect-site Ce within 3% of target and stays
  const after = r.points.filter(p => p.timeMin >= 8);
  const maxErr = Math.max(...after.map(p => Math.abs(p.ceBis - 0.80)));
  check('Ce within 3% of target after 8 min', maxErr <= 0.03, `(max err ${maxErr.toFixed(4)})`);
  // plasma not wildly overshooting in maintenance (after onset Cp ~ target)
  const cpAfter = r.points.filter(p => p.timeMin >= 10);
  const cpMaxErr = Math.max(...cpAfter.map(p => Math.abs(p.cp - 0.80)));
  check('plasma held near target in maintenance', cpMaxErr <= 0.03, `(max err ${cpMaxErr.toFixed(4)})`);
}

console.log('\n=== 2. BIS targets hold + tolerance-driven escalation ===');
for (const target of [60, 50, 40]) {
  const r = TciEngine.planBisTarget(refPt(), target, { duration: 45, sampleInterval: 0.5 });
  const after = r.points.filter(p => p.timeMin >= 8);
  const bisErr = Math.max(...after.map(p => Math.abs(p.bis - target)));
  check(`BIS=${target}: held within ±3 after 8 min`, bisErr <= 3, `(max |BIS-${target}| = ${bisErr.toFixed(2)})`);

  // required Ce increases over time (tolerance)
  const t10 = r.points.find(p => Math.abs(p.timeMin - 10) < 0.3);
  const t40 = r.points.find(p => Math.abs(p.timeMin - 40) < 0.3);
  check(`BIS=${target}: required Ce rises (10->40 min)`, t40.targetCe > t10.targetCe,
        `(${t10.targetCe.toFixed(3)} -> ${t40.targetCe.toFixed(3)} µg/mL)`);
  // infusion rate increases over time (escalation)
  check(`BIS=${target}: infusion escalates (10->40 min)`, t40.infusionMgHr > t10.infusionMgHr,
        `(${t10.infusionMgHr.toFixed(1)} -> ${t40.infusionMgHr.toFixed(1)} mg/hr)`);
  // metabolite accumulates
  check(`BIS=${target}: metabolite accumulates`, t40.cpMet > t10.cpMet,
        `(${t10.cpMet.toFixed(2)} -> ${t40.cpMet.toFixed(2)} µg/mL)`);
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
