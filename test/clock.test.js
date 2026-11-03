/** Clock time: HH:MM parsing, midnight wrap, labels of events on a case that runs past midnight. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./lib/load');

const C = loadApp().get('ClockTime');

test('HH:MM parses to minutes since midnight and rejects nonsense', () => {
  assert.strictEqual(C.toMinutes('08:30'), 510);
  assert.strictEqual(C.toMinutes('8:30'), 510);
  assert.strictEqual(C.toMinutes('00:00'), 0, 'midnight is zero, not falsy-by-accident');
  for (const bad of ['', null, undefined, '24:00', '08:60', 'half eight', '0830', 830]) {
    assert.strictEqual(C.toMinutes(bad), null, String(bad));
  }
});

test('toHHMM wraps past 24 h and before 0', () => {
  assert.strictEqual(C.toHHMM(1500), '01:00');
  assert.strictEqual(C.toHHMM(-30), '23:30');
  assert.strictEqual(C.toHHMM(1439.6), '00:00');
  assert.strictEqual(C.toHHMM(0), '00:00');
});

test('elapsed time from the start: the next day when the event time is earlier, null when unparseable', () => {
  assert.strictEqual(C.elapsedFromStart('23:50', '00:10'), 20);
  assert.strictEqual(C.elapsedFromStart('08:00', '08:00'), 0);
  assert.strictEqual(C.elapsedFromStart('08:00', '07:59'), 1439, 'one minute earlier is a day later, not a minute before');
  assert.strictEqual(C.elapsedFromStart('', '08:00'), null);
  assert.strictEqual(C.elapsedFromStart('08:00', 'x'), null);
});

test('labelAt is the inverse of elapsedFromStart across midnight', () => {
  for (const [start, event] of [['23:40', '00:50'], ['08:00', '09:15'], ['12:00', '11:30']]) {
    assert.strictEqual(C.labelAt(start, C.elapsedFromStart(start, event)), event);
  }
  assert.strictEqual(C.labelAt('garbage', 90), '01:30', 'an unparseable start counts as midnight');
});

test('now() is the local HH:MM, zero padded, from the date it is given', () => {
  assert.strictEqual(C.now(new Date(2026, 9, 25, 7, 5, 59)), '07:05');
  assert.strictEqual(C.now(new Date(2026, 9, 25, 23, 59, 0)), '23:59');
});

test('the default anaesthesia start is a valid clock time and Patient uses it', () => {
  const app = loadApp();
  const start = app.get('DEFAULT_ANES_START');
  assert.notStrictEqual(app.get('ClockTime').toMinutes(start), null);
  assert.strictEqual(app.run(`new Patient({age: 40, weight: 70}).anesStart`), start);
});
