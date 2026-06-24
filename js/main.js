/**
 * main.js — UI controller for the Remimazolam TCI Simulator.
 *
 * Holds the current Patient, drives the patient editor modal and tab
 * navigation, and exposes a small pub/sub so mode modules (induction,
 * TCI, monitoring — added in later sprints) can react to patient changes.
 */

const App = (() => {
  /** @type {Patient|null} */
  let patient = null;
  const patientListeners = [];

  /** LOC effect-site Ce recorded in induction (µg/mL), shared with the TCI tab. */
  let locCe = null;
  const locCeListeners = [];

  /* -------- pub/sub -------- */
  function onPatientChange(fn) { patientListeners.push(fn); }
  function emitPatientChange() { patientListeners.forEach(fn => { try { fn(patient); } catch (e) { console.error(e); } }); }
  function getPatient() { return patient; }

  function onLocCeChange(fn) { locCeListeners.push(fn); }
  function setLocCe(ce) { locCe = ce; locCeListeners.forEach(fn => { try { fn(ce); } catch (e) { console.error(e); } }); }
  function getLocCe() { return locCe; }

  /* -------- patient summary -------- */
  function renderPatientSummary() {
    const el = document.getElementById('patientInfo');
    if (!patient) { el.textContent = 'No patient set'; return; }
    const bmi = patient.bmi;
    const parts = [
      `<b>${escapeHtml(patient.id)}</b>`,
      `${patient.age} yr`,
      `${patient.weight} kg`,
      SexType.displayName(patient.sex),
      patient.opioid ? 'Opioid+' : 'Opioid−'
    ];
    if (bmi) parts.push(`BMI ${bmi.toFixed(1)}`);
    if (patient.hepatic === HepaticFunction.SEVERE) parts.push('Hepatic↓');
    if (patient.renal === RenalFunction.ESRD) parts.push('ESRD');
    el.innerHTML = parts.join(' · ');
  }

  /* -------- patient modal -------- */
  function openPatientModal() {
    if (patient) {
      document.getElementById('pId').value = patient.id;
      document.getElementById('pAge').value = patient.age;
      document.getElementById('pWeight').value = patient.weight;
      document.getElementById('pHeight').value = patient.height ?? '';
      document.getElementById('pAnesStart').value = patient.anesStart || '08:00';
      setRadio('pSex', patient.sex);
      setRadio('pOpioid', patient.opioid ? 'yes' : 'no');
      document.getElementById('pHepatic').value = patient.hepatic;
      document.getElementById('pRenal').value = patient.renal;
    }
    document.getElementById('patientErrors').classList.add('hidden');
    document.getElementById('patientModal').classList.add('open');
  }
  function closePatientModal() {
    document.getElementById('patientModal').classList.remove('open');
  }
  function savePatientFromModal() {
    const candidate = new Patient({
      id: document.getElementById('pId').value.trim() || 'patient-1',
      age: document.getElementById('pAge').value,
      weight: document.getElementById('pWeight').value,
      height: document.getElementById('pHeight').value || null,
      sex: getRadio('pSex'),
      opioid: getRadio('pOpioid') === 'yes',
      hepatic: document.getElementById('pHepatic').value,
      renal: document.getElementById('pRenal').value,
      anesStart: document.getElementById('pAnesStart').value || '08:00'
    });
    const v = candidate.validate();
    const errBox = document.getElementById('patientErrors');
    if (!v.isValid) {
      errBox.innerHTML = v.errors.join('<br>');
      errBox.classList.remove('hidden');
      return;
    }
    patient = candidate;
    renderPatientSummary();
    emitPatientChange();
    closePatientModal();
  }

  /* -------- tabs -------- */
  function initTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(tab.dataset.panel).classList.add('active');
      });
    });
  }

  /* -------- helpers -------- */
  function setRadio(name, value) {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  }
  function getRadio(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* -------- init -------- */
  function init() {
    // default reference patient (70 kg / 35 yr / male / no opioid)
    patient = new Patient({ id: 'patient-1', age: 35, weight: 70, height: 170, sex: SexType.MALE, opioid: false });

    document.getElementById('editPatientBtn').addEventListener('click', openPatientModal);
    document.getElementById('patientCancelBtn').addEventListener('click', closePatientModal);
    document.getElementById('patientSaveBtn').addEventListener('click', savePatientFromModal);
    document.getElementById('patientModal').addEventListener('click', (e) => {
      if (e.target.id === 'patientModal') closePatientModal();
    });

    initTabs();
    renderPatientSummary();
    emitPatientChange();
  }

  return { init, getPatient, onPatientChange, onLocCeChange, setLocCe, getLocCe };
})();

/* ================================================================== */
/* Monitoring controller (S3)                                          */
/* ================================================================== */
const MonitoringController = (() => {
  const engine = new MonitoringEngine();
  let chartConc = null, chartMoaas = null;
  let lastResult = null;

  function startTime() {
    const p = App.getPatient();
    return (p && p.anesStart) ? p.anesStart : '08:00';
  }

  // The elapsed minutes (timeMin) are the source of truth; the start time is
  // only a display reference. Re-derive each event's clock label as
  // (start + timeMin) so shifting the start time just shifts the labels.
  function resyncEvents() {
    const startMin = ClockTime.toMinutes(startTime());
    engine.doseEvents.forEach(ev => { ev.clock = ClockTime.toHHMM(startMin + ev.timeMin); });
    engine.doseEvents.sort((a, b) => a.timeMin - b.timeMin);
  }

  function renderEventsTable() {
    resyncEvents();
    document.getElementById('monAnesStartRef').textContent = startTime();
    const body = document.getElementById('monEventsBody');
    const empty = document.getElementById('monEventsEmpty');
    body.innerHTML = '';
    if (!engine.doseEvents.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    engine.doseEvents.forEach((ev, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${ev.clock}</td>` +
        `<td>+${ev.timeMin.toFixed(0)}</td><td>${ev.bolusMg || 0}</td><td>${ev.continuousMgHr || 0}</td>` +
        `<td><button class="btn btn-ghost" data-i="${i}" style="padding:2px 10px;font-size:0.75rem;">Remove</button></td>`;
      tr.querySelector('button').addEventListener('click', () => { engine.removeDoseEvent(i); renderEventsTable(); });
      body.appendChild(tr);
    });
  }

  function openEventModal() {
    document.getElementById('evStartRef').textContent = startTime();
    document.getElementById('evTime').value = startTime();
    document.getElementById('evBolus').value = 0;
    document.getElementById('evCont').value = 0;
    document.getElementById('doseEventModal').classList.add('open');
  }
  function closeEventModal() { document.getElementById('doseEventModal').classList.remove('open'); }
  function saveEvent() {
    const clock = document.getElementById('evTime').value || startTime();
    const elapsed = ClockTime.elapsedFromStart(startTime(), clock);
    if (elapsed == null) { alert('Invalid time'); return; }
    const b = parseFloat(document.getElementById('evBolus').value) || 0;
    const c = parseFloat(document.getElementById('evCont').value) || 0;
    const ev = new DoseEvent(elapsed, b, c);
    ev.clock = clock;
    engine.addDoseEvent(ev);
    renderEventsTable();
    closeEventModal();
  }

  function run() {
    const patient = App.getPatient();
    if (!patient) return;
    engine.setPatient(patient);
    if (!engine.doseEvents.length) { alert('Add at least one dose event'); return; }
    resyncEvents();
    // run until 120 min after the last event (duration omitted)
    lastResult = engine.run({ dt: 0.1, sampleInterval: 0.5, tailMin: 120 });
    renderResult(lastResult);
    document.getElementById('monCsvBtn').disabled = false;
  }

  function renderResult(result) {
    document.getElementById('monResultsCard').style.display = '';
    const pts = result.timePoints;

    // metrics
    const last = pts[pts.length - 1];
    const metrics = [
      { lbl: 'Max Cp (parent)', val: result.maxCpRemi.toFixed(3), unit: 'µg/mL', cls: 'cp' },
      { lbl: 'Min BIS', val: result.minBis != null ? result.minBis.toFixed(1) : '—', unit: '', cls: 'bis' },
      { lbl: 'Max Ce (BIS)', val: result.maxCeBis.toFixed(3), unit: 'µg/mL', cls: 'ce' },
      { lbl: 'Max metabolite', val: result.maxCpMet.toFixed(3), unit: 'µg/mL', cls: 'met' },
      { lbl: 'Final MOAA/S', val: last.moaasWeighted.toFixed(2), unit: '(0-5)', cls: 'moaas' }
    ];
    document.getElementById('monMetrics').innerHTML = metrics.map(m =>
      `<div class="metric ${m.cls}"><div class="val">${m.val}<span class="unit"> ${m.unit}</span></div><div class="lbl">${m.lbl}</div></div>`
    ).join('');

    document.getElementById('monDeepBisNotice').style.display = (result.minBis != null && result.minBis < 50) ? '' : 'none';

    // concentration + BIS chart
    if (!chartConc) chartConc = new MultiLineChart('monChartConc', { left: { title: 'Conc. (µg/mL)', min: 0 }, right: { title: 'BIS', min: 0, max: 100 } });
    chartConc.render(pts, [
      { key: 'cpRemi', label: 'Cp (parent)', color: CHART_COLORS.cpRemi, axis: 'left' },
      { key: 'ceBis', label: 'Ce (BIS)', color: CHART_COLORS.ceBis, axis: 'left' },
      { key: 'ceMoaas', label: 'Ce (MOAA/S)', color: CHART_COLORS.ceMoaas, axis: 'left', dash: [4, 3] },
      { key: 'cpMet', label: 'CNS7054', color: CHART_COLORS.cpMet, axis: 'left', dash: [2, 2] },
      { key: 'bis', label: 'BIS', color: CHART_COLORS.bis, axis: 'right' }
    ]);

    // MOAA/S chart
    if (!chartMoaas) chartMoaas = new MultiLineChart('monChartMoaas', { left: { title: 'MOAA/S (0-5)', min: 0, max: 5 } });
    chartMoaas.render(pts, [
      { key: 'moaasWeighted', label: 'Prob.-weighted MOAA/S', color: CHART_COLORS.moaas, axis: 'left' }
    ]);
  }

  function exportCsv() {
    if (!lastResult) return;
    const blob = new Blob([lastResult.toCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remimazolam_monitoring_${lastResult.patient.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function init() {
    document.getElementById('monAddEventBtn').addEventListener('click', openEventModal);
    document.getElementById('evCancelBtn').addEventListener('click', closeEventModal);
    document.getElementById('evSaveBtn').addEventListener('click', saveEvent);
    document.getElementById('doseEventModal').addEventListener('click', (e) => { if (e.target.id === 'doseEventModal') closeEventModal(); });
    document.getElementById('monRunBtn').addEventListener('click', run);
    document.getElementById('monCsvBtn').addEventListener('click', exportCsv);
    // re-derive elapsed minutes if the anaesthesia start time changes
    App.onPatientChange(() => renderEventsTable());
    renderEventsTable();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => MonitoringController.init());

/* ================================================================== */
/* Induction controller (S4)                                           */
/* ================================================================== */
const InductionController = (() => {
  const engine = new InductionEngine();
  let chart = null;
  const locSnapshots = [];

  function fmt(x, d = 2) { return (x == null || !Number.isFinite(x)) ? '—' : x.toFixed(d); }

  function setRunningUI(running) {
    document.getElementById('indStartBtn').disabled = running;
    document.getElementById('indPauseBtn').disabled = !running;
    document.getElementById('indBolusBtn').disabled = !engine.state;
    document.getElementById('indRecordBtn').disabled = !engine.state;
  }

  function onUpdate(s) {
    document.getElementById('indElapsed').innerHTML = `${s.elapsedMin.toFixed(1)}<span class="unit"> min</span>`;
    document.getElementById('indCp').innerHTML = `${fmt(s.cp)}<span class="unit"> µg/mL</span>`;
    document.getElementById('indCe').innerHTML = `${fmt(s.ceBis)}<span class="unit"> µg/mL</span>`;
    document.getElementById('indCeMoaas').innerHTML = `${fmt(s.ceMoaas)}<span class="unit"> µg/mL</span>`;
    document.getElementById('indBis').textContent = fmt(s.bis, 1);
    document.getElementById('indMoaas').innerHTML = `${fmt(s.moaasWeighted, 1)}<span class="unit"> /5</span>`;
    if (chart) chart.addPoint(s.elapsedMin, { cp: s.cp, ceBis: s.ceBis, ceMoaas: s.ceMoaas, bis: s.bis });
    if (!s.running && engine.timer === null) setRunningUI(false);
  }

  function ensureChart() {
    if (!chart) chart = new RealtimeChart('indChart', 1200);
  }

  function start() {
    const patient = App.getPatient();
    if (!patient) return;
    if (!engine.state) {
      const bolus = parseFloat(document.getElementById('indBolus').value) || 0;
      const cont = parseFloat(document.getElementById('indCont').value) || 0;
      ensureChart();
      chart.reset();
      engine.prepare(patient, bolus, cont);
    } else {
      // resume: pick up any continuous-rate change
      engine.setContinuous(parseFloat(document.getElementById('indCont').value) || 0);
    }
    engine.start();
    setRunningUI(true);
  }

  function pause() { engine.pause(); setRunningUI(false); }

  function giveBolus() {
    const mg = parseFloat(document.getElementById('indBolus').value) || 0;
    engine.giveBolus(mg);
  }

  function record() {
    const s = engine.observe();
    if (!s) return;
    locSnapshots.push({ t: engine.elapsedMin, cp: s.cp, ce: s.ceBis, bis: s.bis, moaas: s.moaasWeighted });
    renderLoc();
    // share the latest LOC effect-site Ce with the TCI tab
    App.setLocCe(s.ceBis);
  }

  // default induction bolus = 0.1 mg/kg of the current patient
  function applyDefaultBolus() {
    const p = App.getPatient();
    if (p && p.weight) document.getElementById('indBolus').value = (0.1 * p.weight).toFixed(1);
  }

  function renderLoc() {
    document.getElementById('indLocCard').style.display = locSnapshots.length ? '' : 'none';
    document.getElementById('indLocBody').innerHTML = locSnapshots.map(s =>
      `<tr><td>${s.t.toFixed(1)}</td><td>${s.cp.toFixed(3)}</td><td>${s.ce.toFixed(3)}</td><td>${s.bis.toFixed(1)}</td><td>${s.moaas.toFixed(2)}</td></tr>`
    ).join('');
  }

  function reset() {
    engine.pause();
    engine.state = null;
    engine.elapsedMin = 0;
    locSnapshots.length = 0;
    renderLoc();
    App.setLocCe(null);
    applyDefaultBolus();
    if (chart) chart.reset();
    document.getElementById('indElapsed').innerHTML = '0.0<span class="unit"> min</span>';
    document.getElementById('indCp').innerHTML = '0.00<span class="unit"> µg/mL</span>';
    document.getElementById('indCe').innerHTML = '0.00<span class="unit"> µg/mL</span>';
    document.getElementById('indCeMoaas').innerHTML = '0.00<span class="unit"> µg/mL</span>';
    document.getElementById('indBis').textContent = '93.7';
    document.getElementById('indMoaas').innerHTML = '5.0<span class="unit"> /5</span>';
    setRunningUI(false);
    document.getElementById('indBolusBtn').disabled = true;
    document.getElementById('indRecordBtn').disabled = true;
  }

  function init() {
    engine.onUpdate(onUpdate);
    document.getElementById('indStartBtn').addEventListener('click', start);
    document.getElementById('indPauseBtn').addEventListener('click', pause);
    document.getElementById('indBolusBtn').addEventListener('click', giveBolus);
    document.getElementById('indRecordBtn').addEventListener('click', record);
    document.getElementById('indResetBtn').addEventListener('click', reset);
    document.getElementById('indCont').addEventListener('change', (e) => engine.setContinuous(parseFloat(e.target.value) || 0));
    // reset induction when patient changes
    App.onPatientChange(() => reset());
    applyDefaultBolus();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => InductionController.init());

/* ================================================================== */
/* TCI / dosing-plan controller (S5 effect-site Ce + S6 BIS target)    */
/* ================================================================== */
const TciController = (() => {
  let chartConc = null, chartRate = null;
  let lastResult = null, lastMode = 'ce';
  const LOC_MARGIN = 0.15;   // target Ce = LOC Ce + 0.15 µg/mL

  function currentMode() {
    const el = document.querySelector('input[name="tciMode"]:checked');
    return el ? el.value : 'ce';
  }

  // LOC -> dosing-plan transfer banner
  function updateLocBanner() {
    const banner = document.getElementById('tciLocBanner');
    const loc = App.getLocCe();
    if (loc == null) { banner.classList.add('hidden'); return; }
    const tgt = loc + LOC_MARGIN;
    document.getElementById('tciLocText').innerHTML =
      `LOC effect-site Ce recorded in induction = <b>${loc.toFixed(3)}</b> µg/mL → target <b>${tgt.toFixed(2)}</b> µg/mL (LOC + ${LOC_MARGIN})`;
    banner.classList.remove('hidden');
  }
  function applyLoc() {
    const loc = App.getLocCe();
    if (loc == null) return;
    document.querySelector('input[name="tciMode"][value="ce"]').checked = true;
    syncModeUI();
    document.getElementById('tciCe').value = (loc + LOC_MARGIN).toFixed(2);
    plan();
  }

  function syncModeUI() {
    const mode = currentMode();
    document.getElementById('tciCeControls').style.display = mode === 'ce' ? '' : 'none';
    document.getElementById('tciBisControls').style.display = mode === 'bis' ? '' : 'none';
  }

  function plan() {
    const patient = App.getPatient();
    if (!patient) return;
    const mode = currentMode();
    const duration = Math.max(5, parseFloat(document.getElementById('tciDuration').value) || 60);
    if (mode === 'ce') {
      const ce = parseFloat(document.getElementById('tciCe').value) || 0.5;
      lastResult = TciEngine.planCeTarget(patient, ce, { duration, sampleInterval: 0.5 });
      lastResult.label = `Effect-site Ce target ${ce.toFixed(2)} µg/mL`;
    } else {
      const bis = parseFloat(document.getElementById('tciBis').value) || 50;
      lastResult = TciEngine.planBisTarget(patient, bis, { duration, sampleInterval: 0.5 });
      lastResult.label = `Target BIS ${bis}`;
    }
    lastMode = mode;
    render(lastResult, mode);
  }

  function render(result, mode) {
    document.getElementById('tciResultsCard').style.display = '';
    const pts = result.points;
    const last = pts[pts.length - 1];
    const minBis = Math.min(...pts.map(p => p.bis));
    const rates = pts.filter(p => p.timeMin > 0).map(p => p.infusionMgHr);
    const finalRate = last.infusionMgHr;

    const targetMetric = mode === 'bis'
      ? { lbl: 'Target BIS', val: String(result.bisTarget), unit: '', cls: 'ce' }
      : { lbl: 'Target Ce', val: pts[0].targetCe.toFixed(2), unit: 'µg/mL', cls: 'ce' };
    const metrics = [
      { lbl: 'Loading bolus', val: result.loadingBolusMg.toFixed(1), unit: 'mg', cls: 'cp' },
      targetMetric,
      { lbl: 'Final rate', val: finalRate.toFixed(1), unit: 'mg/hr', cls: 'cp' },
      { lbl: 'Total dose', val: result.totalDoseMg.toFixed(0), unit: 'mg', cls: 'met' },
      { lbl: 'Final BIS', val: last.bis.toFixed(1), unit: '', cls: 'bis' }
    ];
    document.getElementById('tciMetrics').innerHTML = metrics.map(m =>
      `<div class="metric ${m.cls}"><div class="val">${m.val}<span class="unit"> ${m.unit}</span></div><div class="lbl">${m.lbl}</div></div>`
    ).join('');
    document.getElementById('tciDeepBisNotice').style.display = minBis < 50 ? '' : 'none';

    // concentration + BIS chart (incl. target Ce)
    if (!chartConc) chartConc = new MultiLineChart('tciChartConc', { left: { title: 'Conc. (µg/mL)', min: 0 }, right: { title: 'BIS', min: 0, max: 100 } });
    chartConc.render(pts, [
      { key: 'cp', label: 'Cp (parent)', color: CHART_COLORS.cpRemi, axis: 'left' },
      { key: 'ceBis', label: 'Ce (BIS)', color: CHART_COLORS.ceBis, axis: 'left' },
      { key: 'targetCe', label: 'Target Ce', color: CHART_COLORS.target, axis: 'left', dash: [5, 4] },
      { key: 'cpMet', label: 'CNS7054', color: CHART_COLORS.cpMet, axis: 'left', dash: [2, 2] },
      { key: 'bis', label: 'BIS', color: CHART_COLORS.bis, axis: 'right' }
    ]);

    // infusion rate chart
    if (!chartRate) chartRate = new MultiLineChart('tciChartRate', { left: { title: 'Infusion rate (mg/hr)', min: 0 } });
    chartRate.render(pts, [{ key: 'infusionMgHr', label: 'Infusion rate', color: CHART_COLORS.ceMoaas, axis: 'left' }]);

    // loading-bolus note
    document.getElementById('tciBolusNote').innerHTML =
      `At t=0, give a <b>loading bolus of ${result.loadingBolusMg.toFixed(1)} mg</b> (0.1 mg/kg); thereafter the infusion rate maintains plasma at the target.`;

    // schedule table at clinical sample times
    const wanted = [0, 1, 2, 3, 5, 10, 15, 20, 30, 40, 50, 60].filter(t => t <= pts[pts.length - 1].timeMin);
    const body = document.getElementById('tciScheduleBody');
    body.innerHTML = wanted.map(t => {
      const p = pts.reduce((a, b) => Math.abs(b.timeMin - t) < Math.abs(a.timeMin - t) ? b : a);
      const bolus = t === 0 ? result.loadingBolusMg.toFixed(1) : '—';
      return `<tr><td>${t}</td><td>${bolus}</td><td>${p.infusionMgHr.toFixed(1)}</td><td>${p.targetCe.toFixed(3)}</td><td>${p.ceBis.toFixed(3)}</td><td>${p.bis.toFixed(1)}</td></tr>`;
    }).join('');
  }

  function exportCsv() {
    if (!lastResult) return;
    const patient = App.getPatient();
    const tps = lastResult.points.map(p => new TimePoint({
      timeMin: p.timeMin, cpRemi: p.cp, ceBis: p.ceBis, ceMoaas: p.ceMoaas,
      cpMet: p.cpMet, bis: p.bis, moaasWeighted: p.moaasWeighted, infusionMgHr: p.infusionMgHr
    }));
    const res = new SimulationResult(patient, tps, { mode: `tci:${lastResult.label}` });
    const blob = new Blob([res.toCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `remimazolam_tci_${patient.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function init() {
    document.querySelectorAll('input[name="tciMode"]').forEach(r => r.addEventListener('change', syncModeUI));
    document.getElementById('tciPlanBtn').addEventListener('click', plan);
    document.getElementById('tciCsvBtn').addEventListener('click', exportCsv);
    document.querySelectorAll('#tciCeControls [data-ce]').forEach(b =>
      b.addEventListener('click', () => { document.getElementById('tciCe').value = b.dataset.ce; }));
    document.querySelectorAll('#tciBisControls [data-bis]').forEach(b =>
      b.addEventListener('click', () => { document.getElementById('tciBis').value = b.dataset.bis; }));
    document.getElementById('tciLocApplyBtn').addEventListener('click', applyLoc);
    App.onLocCeChange(updateLocBanner);
    // refresh the LOC banner whenever the TCI tab is opened
    document.querySelector('.tab[data-panel="panel-tci"]').addEventListener('click', updateLocBanner);
    syncModeUI();
    updateLocBanner();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => TciController.init());

/* ================================================================== */
/* Stepper controls (shared)                                           */
/* ================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.stepper button[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const stepBy = parseFloat(btn.dataset.step) || 1;
      const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
      const max = input.max !== '' ? parseFloat(input.max) : Infinity;
      let v = (parseFloat(input.value) || 0) + stepBy;
      v = Math.min(max, Math.max(min, v));
      input.value = Number.isInteger(v) ? v : parseFloat(v.toFixed(3));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
});

/* -------- service worker + update detection -------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let userInitiatedUpdate = false;

  const showUpdateBanner = (reg) => {
    const banner = document.getElementById('updateBanner');
    if (!banner) return;
    banner.classList.remove('hidden');
    document.getElementById('updateReloadBtn').onclick = () => {
      userInitiatedUpdate = true;
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    };
  };

  // When the new worker takes control (after SKIP_WAITING), reload into it.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userInitiatedUpdate) window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // a new version was already downloaded and is waiting
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // installed + an existing controller => this is an update, not first install
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
        });
      });

      // check for updates on load and hourly, and when the tab regains focus
      reg.update();
      setInterval(() => reg.update(), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
    }).catch((err) => console.warn('SW registration failed:', err));
  });
}

document.addEventListener('DOMContentLoaded', () => App.init());
