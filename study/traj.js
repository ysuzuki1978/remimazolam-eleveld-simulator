/**
 * traj.js — export representative time courses for figures and to verify the
 * qualitative "plateau vs climb" difference between remimazolam and propofol.
 */
const fs = require('fs');
const path = require('path');
const S = require('./sim.js');

const DUR = 360, DTC = S.DTC, DT = S.DT;
const CT = { remi: 1.0, prop: 3.0 };

// hold-plasma rate profile (step-down requirement) — already in sim via holdPlasma
// freeze-after-20min trajectory (Cp vs t) to show plateau vs climb
function freezeTraj(pk, Ct, tSwitch, durMin) {
  const kc = S.rateConstants(pk);
  const nStep = Math.round(DTC / DT);
  let u = [0, 0, 0, 0]; for (let i = 0; i < nStep; i++) u = S.rk4(u, 1, DT, kc); const sens = u[0] / kc.V1;
  const homogNextCp = (y) => { let yy = y.slice(); for (let i = 0; i < nStep; i++) yy = S.rk4(yy, 0, DT, kc); return yy[0] / kc.V1; };
  let y = [Ct * kc.V1, 0, 0, 0], Rfrozen = null;
  const out = [];
  const totalC = Math.round(durMin / DTC);
  for (let c = 0; c <= totalC; c++) {
    const t = c * DTC;
    let R;
    if (t < tSwitch) { const cpH = homogNextCp(y); R = (Ct - cpH) / sens; if (R < 0) R = 0; }
    else { if (Rfrozen === null) { const cpH = homogNextCp(y); let r = (Ct - cpH) / sens; Rfrozen = r < 0 ? 0 : r; } R = Rfrozen; }
    if (Math.round(t * 10) % 5 === 0) out.push({ t: +t.toFixed(1), cpRel: +(y[0] / kc.V1 / Ct).toFixed(4) });
    for (let i = 0; i < nStep; i++) y = S.rk4(y, R, DT, kc);
  }
  return out;
}

// hold-rate profile normalized to its 360-min value (step-down shape)
function holdRateTraj(pk, Ct, durMin) {
  const s = S.holdPlasma(pk, Ct, durMin).series;
  const r360 = s[s.length - 1].rate;
  return s.filter(p => Math.round(p.t * 10) % 5 === 0).map(p => ({ t: +p.t.toFixed(1), rateRel: +(p.rate / r360).toFixed(4), rateMgH: +p.rate.toFixed(1) }));
}

const reps = [
  { age: 20, weight: 64.5, label: 'young adult (20y, 64.5kg)' },
  { age: 40, weight: 64.5, label: 'adult (40y, 64.5kg)' },
  { age: 80, weight: 60, label: 'elderly (80y, 60kg)' },
  { age: 10, weight: 32.5, label: 'child (10y, 32.5kg)' }
];
const heightFor = (age) => S.HEIGHT[age];

const traj = {};
for (const r of reps) {
  const rp = S.remiParams(r.age, r.weight);
  const pp = S.propParams(r.age, r.weight, heightFor(r.age));
  traj[r.label] = {
    age: r.age, weight: r.weight,
    remi_V3: +rp.V3.toFixed(1), prop_V3: +pp.V3.toFixed(1),
    remi_freeze: freezeTraj(rp, CT.remi, 20, DUR),
    prop_freeze: freezeTraj(pp, CT.prop, 20, DUR),
    remi_holdrate: holdRateTraj(rp, CT.remi, DUR),
    prop_holdrate: holdRateTraj(pp, CT.prop, DUR)
  };
}
fs.writeFileSync(path.join(__dirname, 'results', 'trajectories.json'), JSON.stringify(traj, null, 2));

// quick console check: plateau vs climb (Cp relative at 60/180/360 under frozen rate)
console.log('Frozen-rate Cp (relative to target) — plateau vs climb:');
console.log('patient                         | remi 60m/180m/360m      | prop 60m/180m/360m');
for (const r of reps) {
  const t = traj[r.label];
  const g = (arr, tt) => arr.find(p => p.t === tt).cpRel;
  console.log(`${r.label.padEnd(31)} | ${g(t.remi_freeze,60).toFixed(3)} / ${g(t.remi_freeze,180).toFixed(3)} / ${g(t.remi_freeze,360).toFixed(3)}   | ${g(t.prop_freeze,60).toFixed(3)} / ${g(t.prop_freeze,180).toFixed(3)} / ${g(t.prop_freeze,360).toFixed(3)}`);
}
