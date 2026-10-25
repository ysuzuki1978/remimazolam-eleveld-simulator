/** The plan as a schedule, the data classes, the CSV, the metric tiles and the formatters. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./lib/load');

const app = loadApp();
/** Objects built inside the vm have their own Array/Object prototypes; compare by value. */
const plain = (x) => JSON.parse(JSON.stringify(x));
const T = app.get('TciEngine');
const patient = app.run(`new Patient({age: 40, weight: 70, sex: 'male', opioid: false, height: 175, id: 'case-7'})`);
const plan = T.planCeTarget(patient, 0.5, { duration: 70, sampleInterval: 0.5, targetSite: 'moaas' });

test('scheduleRows: the loading bolus sits at minute 0 only, and rows stop where the plan stops', () => {
  const rows = T.scheduleRows(plan);
  assert.deepStrictEqual(plain(rows.map(r => r.timeMin)), plain(T.SCHEDULE_TIMES));
  assert.strictEqual(rows[0].bolusMg, plan.loadingBolusMg);
  assert.ok(rows.slice(1).every(r => r.bolusMg === 0));
  for (const r of rows) assert.ok(Math.abs(r.point.timeMin - r.timeMin) < 1e-9, 'each row is the sample at its time');
  const short = T.planCeTarget(patient, 0.5, { duration: 12, sampleInterval: 0.5 });
  assert.deepStrictEqual(plain(T.scheduleRows(short).map(r => r.timeMin)), [0, 1, 2, 3, 5, 10]);
});

test('planToDoseEvents: bolus and rate rounded to a pump setting, rate held until the next row, no stop added', () => {
  const events = T.planToDoseEvents(plan);
  assert.strictEqual(events.length, T.SCHEDULE_TIMES.length);
  assert.strictEqual(events[0].bolusMg, Number(plan.loadingBolusMg.toFixed(1)));
  assert.ok(events.slice(1).every(e => e.bolusMg === 0));
  events.forEach((e, i) => {
    const row = T.scheduleRows(plan)[i];
    assert.strictEqual(e.timeMin, row.timeMin);
    assert.strictEqual(e.continuousMgHr, Number(row.point.infusionMgHr.toFixed(1)));
  });
  assert.ok(events[events.length - 1].continuousMgHr > 0, 'the last rate is not turned off');
  // the schedule, simulated, stays near the plan once it has settled
  const sim = app.get('EleveldRemimazolam').simulate(patient, events, { duration: 60, dt: 0.1, sampleInterval: 60 });
  const end = sim.points[sim.points.length - 1];
  assert.ok(Math.abs(end.ceMoaas - 0.5) < 0.03, `Ce (MOAA/S) at 60 min: ${end.ceMoaas}`);
});

test('TimePoint.fromObservation maps cp to cpRemi and keeps the rest', () => {
  const pt = plan.points[10];
  const tp = app.get('TimePoint').fromObservation(pt);
  assert.strictEqual(tp.cpRemi, pt.cp);
  for (const k of ['timeMin', 'ceBis', 'ceMoaas', 'cpMet', 'bis', 'moaasWeighted', 'infusionMgHr']) assert.strictEqual(tp[k], pt[k], k);
  assert.strictEqual(new (app.get('TimePoint'))({ timeMin: 0, cpRemi: 0, ceBis: 0, ceMoaas: 0, cpMet: 0, bis: 90, moaasWeighted: 5 }).infusionMgHr, null);
});

test('CSV: header, units in the column names, empty cells for missing values', () => {
  const TP = app.get('TimePoint'), SR = app.get('SimulationResult');
  const res = new SR(patient, plan.points.slice(0, 3).map(p => TP.fromObservation(p)), { mode: 'tci:test' });
  const lines = res.toCSV().split('\n');
  assert.strictEqual(lines[0], '# Remimazolam TCI Simulator (Eleveld 2025)');
  assert.ok(lines.includes('# Patient,case-7') && lines.includes('# Mode,tci:test') && lines.includes('# Sex,Male'));
  const head = lines.indexOf('time_min,Cp_remi_ug_mL,Ce_BIS_ug_mL,Ce_MOAAS_ug_mL,Cp_CNS7054_ug_mL,BIS,MOAAS_weighted,infusion_mg_hr');
  assert.ok(head > 0);
  assert.strictEqual(lines.length, head + 1 + 3);
  const first = lines[head + 1].split(',');
  assert.strictEqual(first.length, 8);
  assert.strictEqual(first[0], '0.000');
  const blank = new SR(patient, [new TP({ timeMin: 1, cpRemi: NaN, ceBis: null, ceMoaas: undefined, cpMet: 0, bis: null, moaasWeighted: null })]).toCSV();
  assert.ok(blank.endsWith('1.000,,,,0.00000,,,'), blank.split('\n').pop());
});

test('metric tiles: label, value and unit for a plan and for a monitoring run', () => {
  const m = app.get('planMetrics')(plan, 'ce');
  assert.deepStrictEqual(plain(m.map(x => x.lbl)), ['Loading bolus', 'Target Ce (MOAA/S)', 'Final rate', 'Total dose', 'Final BIS', 'Final MOAA/S']);
  assert.strictEqual(m[0].val, plan.loadingBolusMg.toFixed(1));
  assert.strictEqual(m[1].val, '0.50');
  const bisPlan = T.planBisTarget(patient, 50, { duration: 20, sampleInterval: 0.5 });
  assert.deepStrictEqual(plain(app.get('planMetrics')(bisPlan, 'bis')[1]), { lbl: 'Target BIS', val: '50', unit: '', cls: 'ce' });
  const eng = app.run('new MonitoringEngine()');
  eng.setPatient(patient); eng.addDoseEvent(app.run('new DoseEvent(0, 7, 60)'));
  const res = eng.run({ tailMin: 30 });
  const mon = app.get('monitoringMetrics')(res);
  assert.strictEqual(mon.length, 6);
  assert.strictEqual(mon[0].val, res.maxCpRemi.toFixed(3));
  assert.match(app.get('metricsHtml')(mon), /^<div class="metric cp">.*Max Cp \(parent\)/);
});

test('reachesDeepBis flags a minimum below 50 and not at 50', () => {
  const f = app.get('reachesDeepBis');
  assert.strictEqual(f([{ bis: 60 }, { bis: 49.9 }]), true);
  assert.strictEqual(f([{ bis: 60 }, { bis: 50 }]), false);
});

test('MonitoringEngine.run: runs 120 min past the last event by default and orders events by time', () => {
  const eng = app.run('new MonitoringEngine()');
  eng.setPatient(patient);
  eng.addDoseEvent(app.run('new DoseEvent(30, 0, 0)'));
  eng.addDoseEvent(app.run('new DoseEvent(0, 7, 60)'));
  assert.deepStrictEqual(plain(eng.doseEvents.map(e => e.timeMin)), [0, 30]);
  const res = eng.run();
  assert.strictEqual(res.timePoints[res.timePoints.length - 1].timeMin, 150);
  assert.throws(() => app.run('new MonitoringEngine().run()'), /patient not set/);
});

test('simulate(): an event dated before time 0 is applied at time 0 and does not block later events', () => {
  const M = app.get('EleveldRemimazolam');
  const events = [app.run('new DoseEvent(-5, 3, 0)'), app.run('new DoseEvent(0, 7, 60)')];
  const { params, points } = M.simulate(patient, events, { duration: 5, dt: 0.1, sampleInterval: 5 });
  assert.ok(Math.abs(points[0].cp - 10 / params.V1) < 1e-12, `Cp at 0: ${points[0].cp}`);
  assert.strictEqual(points[0].infusionMgHr, 60);
});

test('nearestByTime: nearest sample, the later one on a tie, ends clamp', () => {
  const f = app.get('nearestByTime');
  const pts = [0, 1, 2, 4].map(t => ({ timeMin: t }));
  assert.strictEqual(f(pts, 1.2).timeMin, 1);
  assert.strictEqual(f(pts, 1.5).timeMin, 2);
  assert.strictEqual(f(pts, 3.4).timeMin, 4);
  assert.strictEqual(f(pts, -10).timeMin, 0);
  assert.strictEqual(f(pts, Infinity).timeMin, 4);
});

test('formatters: dash for missing, "now", minutes, hours; stopwatch label', () => {
  const g = (n) => app.get(n);
  assert.strictEqual(g('formatNumber')(null), '—');
  assert.strictEqual(g('formatNumber')(NaN, 1), '—');
  assert.strictEqual(g('formatNumber')(1.005, 2), '1.00');
  assert.strictEqual(g('formatNumber')(93.7196, 1), '93.7');
  assert.strictEqual(g('csvNumber')(undefined), '');
  assert.strictEqual(g('csvNumber')(0.123456789), '0.12346');
  assert.strictEqual(g('formatDuration')(null), '> 12 h');
  assert.strictEqual(g('formatDuration')(0), 'now');
  assert.strictEqual(g('formatDuration')(12.34), '12.3 min');
  assert.strictEqual(g('formatDuration')(125), '2 h 5 min');
  assert.strictEqual(g('formatElapsedClock')(1.5), '1:30');
  assert.strictEqual(g('formatElapsedClock')(-3), '0:00');
});
