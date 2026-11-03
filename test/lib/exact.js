/**
 * Exact solution of the 8-state remimazolam system by a matrix exponential.
 *
 * expm() is taken from validation/lib/exact.js of anesthesia-triad-simulator
 * v0.8.6 (commit 48f6305, same author, MIT). The state matrix is written out
 * here from volumes, clearances and ke0 as in the paper's Figure 1, not from the
 * rate constants that deriv() in the code under test uses, so the check does not
 * share the code's own wiring.
 *
 * With the state y and a constant infusion u over an interval,
 *     [y(t + h); u] = exp(M h) [y(t); u],   M = [[A, b], [0, 0]]
 * which is exact for a piecewise-constant infusion with boluses added at their
 * instants.
 *
 * State order (as in remimazolam-eleveld-pkpd.js):
 *   0 A1 central  1 A2  2 A3  3 A5 depot  4 A6 metabolite central  5 A7 metabolite peripheral
 *   6 A9 Ce (MOAA/S site)   7 A10 Ce (BIS site)
 */
'use strict';

const zeros = (n, m = n) => Array.from({ length: n }, () => new Array(m).fill(0));
const identity = (n) => zeros(n).map((row, i) => { row[i] = 1; return row; });

function multiply(a, b) {
  const n = a.length, m = b[0].length, inner = b.length;
  const out = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

const maxAbs = (a) => a.reduce((m, row) => row.reduce((r, x) => Math.max(r, Math.abs(x)), m), 0);

/** exp(M) by scaling and squaring with a Taylor series on the scaled matrix. */
function expm(matrix) {
  const n = matrix.length;
  const norm = matrix.reduce((m, row) => Math.max(m, row.reduce((s, x) => s + Math.abs(x), 0)), 0);
  const squarings = norm > 0.5 ? Math.ceil(Math.log2(norm / 0.5)) : 0;
  const scale = Math.pow(2, -squarings);
  const scaled = matrix.map(row => row.map(x => x * scale));

  let term = identity(n);
  let sum = identity(n);
  for (let k = 1; k <= 30; k++) {
    term = multiply(term, scaled).map(row => row.map(x => x / k));
    sum = sum.map((row, i) => row.map((x, j) => x + term[i][j]));
    if (maxAbs(term) < 1e-20 * maxAbs(sum)) break;
  }
  for (let i = 0; i < squarings; i++) sum = multiply(sum, sum);
  return sum;
}

/** The 9x9 augmented matrix from a parameter set (computeParameters output). */
function augmentedMatrix(p) {
  const k10 = p.CL / p.V1, k12 = p.Q2 / p.V1, k21 = p.Q2 / p.V2, k13 = p.Q3 / p.V1, k31 = p.Q3 / p.V3;
  const k12m = p.Q2m / p.V1m, k21m = p.Q2m / p.V2m, kmo = p.CLm / p.V1m;
  const M = zeros(9);
  M[0][0] = -(k10 + k12 + k13); M[0][1] = k21; M[0][2] = k31; M[0][8] = 1;   // + infusion (mg/min)
  M[1][0] = k12; M[1][1] = -k21;
  M[2][0] = k13; M[2][2] = -k31;
  M[3][0] = p.MRAT * k10; M[3][3] = -p.KMD;
  M[4][3] = p.KMD; M[4][4] = -(kmo + k12m); M[4][5] = k21m;
  M[5][4] = k12m; M[5][5] = -k21m;
  M[6][0] = p.ke0_moaas / p.V1; M[6][6] = -p.ke0_moaas;
  M[7][0] = p.ke0_bis / p.V1; M[7][7] = -p.ke0_bis;
  return M;
}

/** exp(M h) for a parameter set and a step h (min). */
function propagator(p, h) {
  return expm(augmentedMatrix(p).map(row => row.map(x => x * h)));
}

/** Advance [y; u] by one propagator. Returns a new 8-state array. */
function advance(E, y, uMgPerMin) {
  const v = [...y, uMgPerMin];
  const out = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 9; j++) out[i] += E[i][j] * v[j];
  return out;
}

/**
 * The state at every grid step for a dose record.
 * events: [{ step, bolusMg?, rateMgPerMin? }] on the grid of `dt`; a rate holds until the next event that sets one.
 * Returns an array of 8-state vectors, index = step (0..totalSteps).
 */
function exactStates(events, p, { dt, totalSteps }) {
  const E = propagator(p, dt);
  const sorted = events.slice().sort((a, b) => a.step - b.step);
  let y = new Array(8).fill(0), u = 0, next = 0;
  const states = [];
  for (let s = 0; s <= totalSteps; s++) {
    while (next < sorted.length && sorted[next].step === s) {
      y[0] += sorted[next].bolusMg || 0;
      if (sorted[next].rateMgPerMin != null) u = sorted[next].rateMgPerMin;
      next++;
    }
    states.push(y.slice());
    if (s < totalSteps) y = advance(E, y, u);
  }
  return states;
}

module.exports = { expm, propagator, advance, exactStates, augmentedMatrix };
