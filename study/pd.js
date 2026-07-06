/**
 * pd.js — PD analysis with the full Eleveld 2025 remimazolam engine
 * (including metabolite CNS7054).
 *
 * (A) Effect drift under a fixed-rate regimen: at a roughly constant Ce, does
 *     BIS / MOAA/S drift over 6 h because of metabolite accumulation (tolerance)?
 * (B) Age sensitivity: at the SAME effect-site Ce, how different is BIS across ages?
 *
 * Output: results/pd_matrix.json, results/pd_age_sensitivity.json
 */
const fs = require('fs');
const path = require('path');
const RM = require('../js/remimazolam-eleveld-pkpd.js').EleveldRemimazolam;
const rmModels = require('../js/models.js');

const pkMatrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'pk_matrix.json'), 'utf8'));

const DUR = 360, dt = 0.1, samp = 5;

/* (A) fixed-rate effect drift across the matrix */
const pd = pkMatrix.map(row => {
  const pt = new rmModels.Patient({ age: row.age, weight: row.weight, sex: rmModels.SexType.MALE, opioid: true });
  // fixed regimen from the PK best-fixed-regimen (holds Cp ~ target 1.0 µg/mL)
  const bolus = row.remi.bestfix_bolus_mg, rateMgH = row.remi.bestfix_rate_mgh;
  const { points } = RM.simulate(pt, [new rmModels.DoseEvent(0, bolus, rateMgH)], { duration: DUR, dt, sampleInterval: samp });
  const at = (t) => points.reduce((a, b) => Math.abs(b.timeMin - t) < Math.abs(a.timeMin - t) ? b : a);
  const p30 = at(30), p120 = at(120), p240 = at(240), p360 = at(360);
  return {
    age: row.age, bodyType: row.bodyType, weight: row.weight, ageExtrap: row.ageExtrap, weightExtrap: row.weightExtrap,
    bolus_mg: bolus, rate_mgh: rateMgH,
    ce_bis_30: +p30.ceBis.toFixed(3), ce_bis_360: +p360.ceBis.toFixed(3),
    cpMet_30: +p30.cpMet.toFixed(2), cpMet_120: +p120.cpMet.toFixed(2), cpMet_240: +p240.cpMet.toFixed(2), cpMet_360: +p360.cpMet.toFixed(2),
    bis_30: +p30.bis.toFixed(1), bis_120: +p120.bis.toFixed(1), bis_240: +p240.bis.toFixed(1), bis_360: +p360.bis.toFixed(1),
    bis_drift_30to360: +(p360.bis - p30.bis).toFixed(1),
    moaas_30: +p30.moaasWeighted.toFixed(2), moaas_360: +p360.moaasWeighted.toFixed(2),
    moaas_drift_30to360: +(p360.moaasWeighted - p30.moaasWeighted).toFixed(2)
  };
});
fs.writeFileSync(path.join(__dirname, 'results', 'pd_matrix.json'), JSON.stringify(pd, null, 2));

/* (B) age sensitivity: BIS at fixed effect-site Ce (metabolite absent) */
function bisAtCe(age, ceBis) {
  const p = RM.computeParameters(new rmModels.Patient({ age, weight: 70, sex: rmModels.SexType.MALE, opioid: true }));
  // state with A10 (BIS effect-site) = ceBis, metabolite 0
  const y = [0, 0, 0, 0, 0, 0, 0, ceBis];
  return RM.observe(y, p).bis;
}
const ages = [6, 10, 20, 40, 60, 80, 90];
const ceLevels = [0.4, 0.6, 0.8, 1.0, 1.2];
const ageSens = { ages, ceLevels, grid: {} };
for (const ce of ceLevels) ageSens.grid[ce] = ages.map(a => +bisAtCe(a, ce).toFixed(1));
fs.writeFileSync(path.join(__dirname, 'results', 'pd_age_sensitivity.json'), JSON.stringify(ageSens, null, 2));

/* console summary */
console.log('=== (A) Effect drift under fixed-rate remimazolam (metabolite tolerance) ===');
console.log('age bt      wt   | Ce_bis 30/360 | cpMet 30/360 | BIS 30/120/240/360 (drift) | MOAA/S 30/360 (drift)');
for (const r of pd) {
  console.log(
    `${String(r.age).padStart(3)} ${r.bodyType.padEnd(6)} ${String(r.weight).padStart(5)}${r.weightExtrap ? '*' : ' '}| ` +
    `${r.ce_bis_30.toFixed(2)}/${r.ce_bis_360.toFixed(2)}     | ${String(r.cpMet_30).padStart(4)}/${String(r.cpMet_360).padStart(5)} | ` +
    `${String(r.bis_30).padStart(4)}/${String(r.bis_120).padStart(4)}/${String(r.bis_240).padStart(4)}/${String(r.bis_360).padStart(4)} (${r.bis_drift_30to360 >= 0 ? '+' : ''}${r.bis_drift_30to360}) | ` +
    `${r.moaas_30.toFixed(2)}/${r.moaas_360.toFixed(2)} (${r.moaas_drift_30to360 >= 0 ? '+' : ''}${r.moaas_drift_30to360})`
  );
}
const drifts = pd.map(r => r.bis_drift_30to360);
console.log(`\nBIS drift 30→360min: mean +${(drifts.reduce((a, b) => a + b, 0) / drifts.length).toFixed(1)}, range +${Math.min(...drifts)}..+${Math.max(...drifts)}`);

console.log('\n=== (B) Age sensitivity: BIS at the SAME effect-site Ce (no metabolite) ===');
console.log('Ce_bis \\ age:  ' + ages.map(a => String(a).padStart(5)).join(''));
for (const ce of ceLevels) console.log(`   ${ce.toFixed(1)}       ` + ageSens.grid[ce].map(v => String(v).padStart(5)).join(''));
