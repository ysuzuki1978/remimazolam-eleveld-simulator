/**
 * The engines against the exact solution (matrix exponential, test/lib/exact.js).
 * Tolerance: the RK4 error at dt = 0.1 min is far below 1e-6 of the series peak
 * for this system; the negative controls in negative-control.test.js show that
 * the comparison would see a 1 % error.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./lib/load');
const { exactStates, propagator, advance } = require('./lib/exact');
const { peakRelativeError } = require('./lib/harness');

const app = loadApp();
const M = app.get('EleveldRemimazolam');
const patient = (o) => app.run(`new Patient(${JSON.stringify({ height: 170, ...o })})`);

const PATIENTS = {
  reference: { age: 35, weight: 70, sex: 'male', opioid: false },
  elderlyOpioid: { age: 72, weight: 55, sex: 'female', opioid: true },
  child: { age: 8, weight: 25, sex: 'male', opioid: false },
  organDisease: { age: 55, weight: 110, sex: 'female', opioid: false, hepatic: 'severe', renal: 'esrd' }
};

// bolus + rate changes + a later bolus + stop; times (min) on the 0.1 min grid
const RECORD = [[0, 7, 0], [2, 0, 30], [20, 0, 60], [45, 3, 0], [60, 0, 0]];

/** [timeMin, bolusMg, mg/hr] -> what DoseEvent takes, and the exact solver's events. */
function toEvents(record, dt) {
  return {
    doseEvents: record.map(([t, b, r]) => app.run(`new DoseEvent(${t}, ${b}, ${r})`)),
    exact: record.map(([t, b, r]) => ({ step: Math.round(t / dt), bolusMg: b, rateMgPerMin: r / 60 }))
  };
}

const SERIES = [
  ['Cp', (p, y) => y[0] / p.V1, (pt) => pt.cp],
  ['Ce (BIS site)', (p, y) => y[7], (pt) => pt.ceBis],
  ['Ce (MOAA/S site)', (p, y) => y[6], (pt) => pt.ceMoaas],
  ['metabolite', (p, y) => y[4] / p.V1m, (pt) => pt.cpMet]
];

for (const [name, o] of Object.entries(PATIENTS)) {
  test(`simulate(): ${name} matches the exact solution for bolus, rate changes, a later bolus and stop`, () => {
    const dt = 0.1, duration = 90, sampleEvery = 5;
    const p = patient(o);
    const { doseEvents, exact } = toEvents(RECORD, dt);
    const { params, points } = M.simulate(p, doseEvents, { duration, dt, sampleInterval: dt * sampleEvery });
    const states = exactStates(exact, params, { dt, totalSteps: Math.round(duration / dt) });
    const atSamples = states.filter((_, s) => s % sampleEvery === 0);
    assert.strictEqual(points.length, atSamples.length);
    for (const [label, fromState, fromPoint] of SERIES) {
      const err = peakRelativeError(atSamples.map(y => fromState(params, y)), points.map(fromPoint));
      assert.ok(err < 1e-6, `${name} ${label}: peak-relative error ${err.toExponential(2)}`);
    }
    // the recorded infusion rate is the rate in force, in mg/hr
    assert.strictEqual(points.find(pt => pt.timeMin === 10).infusionMgHr, 30);
    assert.strictEqual(points.find(pt => pt.timeMin === 30).infusionMgHr, 60);
    assert.strictEqual(points.find(pt => pt.timeMin === 70).infusionMgHr, 0);
  });
}

test('TciEngine.plan(): the plasma and effect-site curves are the exact response to the rates it chose', () => {
  // sampleInterval = control interval, so every control rate is recorded
  const p = patient(PATIENTS.elderlyOpioid);
  for (const [label, plan] of [
    ['Ce target, MOAA/S site', app.get('TciEngine').planCeTarget(p, 0.5, { duration: 20, sampleInterval: 0.1, targetSite: 'moaas' })],
    ['BIS target 50', app.get('TciEngine').planBisTarget(p, 50, { duration: 20, sampleInterval: 0.1 })]
  ]) {
    const dtCtrl = 0.1;
    const events = plan.points.map((pt, i) => ({ step: i, bolusMg: i === 0 ? plan.loadingBolusMg : 0, rateMgPerMin: pt.infusionMgHr / 60 }));
    const states = exactStates(events, plan.params, { dt: dtCtrl, totalSteps: plan.points.length - 1 });
    for (const [series, fromState, fromPoint] of SERIES) {
      const err = peakRelativeError(states.map(y => fromState(plan.params, y)), plan.points.map(fromPoint));
      assert.ok(err < 1e-8, `${label} ${series}: peak-relative error ${err.toExponential(2)}`);
    }
  }
});

test('TciEngine.planCeTarget(): the effect-site Ce reaches the target and the bolus is 0.1 mg/kg', () => {
  const T = app.get('TciEngine');
  const p = patient(PATIENTS.reference);
  const plan = T.planCeTarget(p, 0.5, { duration: 30, sampleInterval: 0.5, targetSite: 'moaas' });
  assert.strictEqual(plan.loadingBolusMg, 0.1 * 70);
  const end = plan.points[plan.points.length - 1];
  assert.ok(Math.abs(end.ceMoaas - 0.5) < 0.01, `Ce at 30 min ${end.ceMoaas}`);
  assert.ok(Math.max(...plan.points.map(pt => pt.ceMoaas)) < 0.5 * 1.05, 'overshoot above 5 %');
});

test('InductionEngine: ticks of a fake clock match the exact solution, with a bolus and a rate change on the way', () => {
  const p = patient({ age: 50, weight: 70, sex: 'male', opioid: false });
  const engine = app.run('new InductionEngine()');
  let now = 1000;
  engine._now = () => now;
  engine.prepare(p, 7, 30);
  engine.running = true;
  engine.lastTick = now;
  const params = engine.params;
  const hMin = 137 / 60000;                       // one tick: 137 ms of wall time at 1x
  const E = propagator(params, hMin);
  let y = new Array(8).fill(0); y[0] = 7;
  let u = 30 / 60;
  for (let k = 0; k < 40; k++) {
    now += 137; engine._tick();
    y = advance(E, y, u);
    if (k === 10) { engine.giveBolus(2); y[0] += 2; }
    if (k === 20) { engine.setContinuous(60); u = 60 / 60; }
  }
  const err = Math.max(...engine.state.map((v, i) => Math.abs(v - y[i]) / Math.max(1e-9, Math.abs(y[i]))));
  assert.ok(err < 1e-6, `final state relative error ${err.toExponential(2)}`);
  assert.ok(Math.abs(engine.elapsedMin - 40 * hMin) < 1e-12);
});

test('predictRecovery(): the time for Ce to fall by half is within one step of the exact washout', () => {
  const p = patient(PATIENTS.reference);
  const { params, points } = M.simulate(p, app.run('[new DoseEvent(0, 7, 60)]'), { duration: 30, dt: 0.1, sampleInterval: 30 });
  const y0 = points[points.length - 1].state;
  const r = M.predictRecovery(y0, params, { ceDecFraction: 0.5, ceSite: 'bis', dt: 0.25 });
  assert.ok(r.toCeDecrement > 0);
  // exact: the first 0.25 min step at which the BIS-site Ce is at or below half its start
  const E = propagator(params, 0.25);
  let y = y0.slice(), t = 0;
  while (y[7] > y0[7] * 0.5) { y = advance(E, y, 0); t += 0.25; }
  assert.ok(Math.abs(r.toCeDecrement - t) <= 0.25 + 1e-9, `${r.toCeDecrement} vs exact ${t}`);
});
