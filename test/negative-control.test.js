/**
 * Negative controls: the comparison against the exact solution has to see the
 * kinds of mistake that matter. Each case feeds a deliberately wrong input or
 * variant to the same comparison that passes in exact.test.js and requires it to
 * fail by a wide margin (threshold 1e-6 there).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./lib/load');
const { exactStates } = require('./lib/exact');
const { peakRelativeError, assertRelative } = require('./lib/harness');

const app = loadApp();
const M = app.get('EleveldRemimazolam');
const p = app.run(`new Patient({age: 72, weight: 55, sex: 'female', opioid: true, height: 170})`);
const RECORD = [[0, 7, 0], [2, 0, 30], [20, 0, 60], [45, 3, 0], [60, 0, 0]];
const DT = 0.1, DURATION = 90, EVERY = 5;

const doseEvents = (record) => record.map(([t, b, r]) => app.run(`new DoseEvent(${t}, ${b}, ${r})`));
const exactEvents = (record, { rateScale = 1, lateSteps = 0 } = {}) =>
  record.map(([t, b, r]) => ({ step: Math.round(t / DT) + lateSteps, bolusMg: b, rateMgPerMin: rateScale * r / 60 }));

/** Peak-relative error of the Ce (BIS site) series of `points` against the exact response to `events`. */
function ceError(points, params, events) {
  const states = exactStates(events, params, { dt: DT, totalSteps: Math.round(DURATION / DT) }).filter((_, s) => s % EVERY === 0);
  return peakRelativeError(states.map(y => y[7]), points.map(pt => pt.ceBis));
}

const run = () => M.simulate(p, doseEvents(RECORD), { duration: DURATION, dt: DT, sampleInterval: DT * EVERY });

test('control: the unmodified engine passes (so the failures below are caused by the change)', () => {
  const { params, points } = run();
  assert.ok(ceError(points, params, exactEvents(RECORD)) < 1e-6);
});

test('a rate taken as mg/min instead of mg/hr (60 x) is detected', () => {
  const { params, points } = run();
  const err = ceError(points, params, exactEvents(RECORD, { rateScale: 60 }));
  assert.ok(err > 1e-2, `error ${err.toExponential(2)}`);
});

test('events applied one integration step late are detected', () => {
  const { params, points } = run();
  const err = ceError(points, params, exactEvents(RECORD, { lateSteps: 1 }));
  assert.ok(err > 1e-4, `error ${err.toExponential(2)}`);
});

test('an effect-site rate constant 1 % off is detected', () => {
  const { params, points } = run();
  const wrong = { ...params, ke0_bis: params.ke0_bis * 1.01 };
  const err = ceError(points, wrong, exactEvents(RECORD));
  assert.ok(err > 1e-4, `error ${err.toExponential(2)}`);
});

test('forward Euler at the same step is detected, so the comparison can resolve integration error', () => {
  const params = M.computeParameters(p);
  let y = M.createInitialState();
  const euler = [];
  const ev = Object.fromEntries(RECORD.map(([t, b, r]) => [Math.round(t / DT), [b, r / 60]]));
  let u = 0;
  for (let s = 0; s <= Math.round(DURATION / DT); s++) {
    if (ev[s]) { y[0] += ev[s][0]; u = ev[s][1]; }
    if (s % EVERY === 0) euler.push({ ceBis: y[7] });
    const d = M.deriv(y, u, params);
    y = y.map((v, i) => v + DT * d[i]);
  }
  const err = ceError(euler, params, exactEvents(RECORD));
  assert.ok(err > 1e-3, `error ${err.toExponential(2)}`);
});

test('the parameter pins notice a 1e-6 relative change', () => {
  const params = M.computeParameters(p);
  assertRelative(params.V1, 3.3843071, 1e-7, 'unchanged V1');
  assert.throws(() => assertRelative(params.V1 * (1 + 1e-6), 3.3843071, 1e-7, 'perturbed V1'));
});
