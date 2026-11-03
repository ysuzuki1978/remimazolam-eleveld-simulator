/** Small helpers shared by the tests (the runner is node:test). */
'use strict';
const assert = require('node:assert');

/** Largest |computed - reference| over the series, relative to the series peak. */
function peakRelativeError(reference, computed) {
  assert.strictEqual(computed.length, reference.length, 'series differ in length');
  const peak = reference.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  let worst = 0;
  for (let i = 0; i < reference.length; i++) worst = Math.max(worst, Math.abs(computed[i] - reference[i]) / peak);
  return worst;
}

function assertRelative(actual, expected, tolerance, label) {
  const error = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(error <= tolerance, `${label}: ${actual} vs ${expected} (relative ${error.toExponential(2)} > ${tolerance})`);
}

module.exports = { peakRelativeError, assertRelative };
