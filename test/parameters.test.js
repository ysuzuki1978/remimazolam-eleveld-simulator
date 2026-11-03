/**
 * Parameters of the Eleveld 2025 remimazolam model.
 *
 * Published anchors: Table 1 of Eleveld DJ et al., Br J Anaesth 2025;135:206-17
 * for the reference individual (35 y, 70 kg, male, no opioid, normal liver and
 * kidney), at the precision printed there. Regression pins: values this code
 * produced at v1.14.0 for other patients, to catch an unintended change.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./lib/load');
const { assertRelative } = require('./lib/harness');

const app = loadApp();
const M = app.get('EleveldRemimazolam');
const patient = (o) => app.run(`new Patient(${JSON.stringify({ height: 170, ...o })})`);

test('reference individual reproduces Table 1 at its printed precision', () => {
  const p = M.computeParameters(patient({ age: 35, weight: 70, sex: 'male', opioid: false }));
  // [name, printed value, tolerance = half a unit in the last printed digit]
  const table1 = [['V1', 4.31, 0.005], ['V2', 12.3, 0.05], ['V3', 18.6, 0.05], ['CL', 1.12, 0.005],
    ['Q2', 1.45, 0.005], ['Q3', 0.298, 0.0005], ['V1m', 6.85, 0.005], ['V2m', 5.12, 0.005],
    ['CLm', 0.0665, 0.00005], ['Q2m', 0.141, 0.0005], ['ke0_bis', 0.145, 0.0005], ['ke0_moaas', 0.298, 0.0005],
    ['ce50_bis', 0.982, 0.0005], ['ce50_moaas', 0.182, 0.0005]];
  for (const [name, value, tol] of table1) {
    assert.ok(Math.abs(p[name] - value) <= tol, `${name}: ${p[name]} vs Table 1 ${value}`);
  }
});

test('covariate directions: age, sex, opioid, liver and kidney move the parameters the way the paper says', () => {
  const base = { age: 35, weight: 70, sex: 'male', opioid: false };
  const at = (o) => M.computeParameters(patient({ ...base, ...o }));
  const ref = at({});
  assert.ok(at({ age: 80 }).V3 > ref.V3, 'V3 rises with age');
  assert.ok(at({ age: 80 }).ce50_bis < ref.ce50_bis, 'Ce50 (BIS) falls with age');
  assert.ok(at({ sex: 'female' }).CL > ref.CL, 'female clearance higher');
  assert.ok(at({ opioid: true }).CL < ref.CL, 'opioid lowers clearance');
  assert.ok(at({ hepatic: 'severe' }).V3 > ref.V3, 'severe liver disease raises V3');
  assert.ok(at({ renal: 'esrd' }).CLm < ref.CLm, 'ESRD lowers metabolite clearance');
  assert.ok(at({ weight: 100 }).V1 > ref.V1 && at({ weight: 100 }).CL > ref.CL, 'size scales volumes and clearance');
});

test('regression pins (v1.14.0 values) for an elderly woman on opioids and for a child', () => {
  const pins = [
    [{ age: 72, weight: 55, sex: 'female', opioid: true }, { V1: 3.3843071, CL: 0.95668008, V3: 25.575786, ke0_bis: 0.097772136, ce50_bis: 0.53539621 }],
    [{ age: 8, weight: 25, sex: 'male', opioid: false }, { V1: 1.5383214, CL: 0.51732123, V3: 5.4653536, ke0_bis: 0.19324485, ce50_bis: 1.5297357 }]
  ];
  for (const [o, expected] of pins) {
    const p = M.computeParameters(patient(o));
    for (const [name, value] of Object.entries(expected)) assertRelative(p[name], value, 1e-7, `${o.age} y ${name}`);
  }
});

test('Patient validates its own range', () => {
  assert.strictEqual(patient({ age: 0.5, weight: 70, sex: 'male' }).validate().isValid, false);
  assert.strictEqual(patient({ age: 40, weight: 300, sex: 'male' }).validate().isValid, false);
  assert.strictEqual(patient({ age: 40, weight: 70, sex: 'male' }).validate().isValid, true);
});
