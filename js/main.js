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

  /* -------- pub/sub -------- */
  function onPatientChange(fn) { patientListeners.push(fn); }
  function emitPatientChange() { patientListeners.forEach(fn => { try { fn(patient); } catch (e) { console.error(e); } }); }
  function getPatient() { return patient; }

  /* -------- patient summary -------- */
  function renderPatientSummary() {
    const el = document.getElementById('patientInfo');
    if (!patient) { el.textContent = '患者未設定'; return; }
    const bmi = patient.bmi;
    const parts = [
      `<b>${escapeHtml(patient.id)}</b>`,
      `${patient.age}歳`,
      `${patient.weight}kg`,
      SexType.displayName(patient.sex),
      patient.opioid ? 'オピオイド+' : 'オピオイド−'
    ];
    if (bmi) parts.push(`BMI ${bmi.toFixed(1)}`);
    if (patient.hepatic === HepaticFunction.SEVERE) parts.push('肝↓');
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
      renal: document.getElementById('pRenal').value
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

  return { init, getPatient, onPatientChange };
})();

/* ================================================================== */
/* Monitoring controller (S3)                                          */
/* ================================================================== */
const MonitoringController = (() => {
  const engine = new MonitoringEngine();
  let chartConc = null, chartMoaas = null;
  let lastResult = null;
  // pending event being edited via the modal (null => not open)
  let pending = null;

  function renderEventsTable() {
    const body = document.getElementById('monEventsBody');
    const empty = document.getElementById('monEventsEmpty');
    body.innerHTML = '';
    if (!engine.doseEvents.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    engine.doseEvents.forEach((ev, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${ev.timeMin}</td><td>${ev.bolusMg || 0}</td><td>${ev.continuousMgHr || 0}</td>` +
        `<td><button class="btn btn-ghost" data-i="${i}" style="padding:2px 10px;font-size:0.75rem;">削除</button></td>`;
      tr.querySelector('button').addEventListener('click', () => { engine.removeDoseEvent(i); renderEventsTable(); });
      body.appendChild(tr);
    });
  }

  function openEventModal() {
    document.getElementById('evTime').value = 0;
    document.getElementById('evBolus').value = 0;
    document.getElementById('evCont').value = 0;
    document.getElementById('doseEventModal').classList.add('open');
  }
  function closeEventModal() { document.getElementById('doseEventModal').classList.remove('open'); }
  function saveEvent() {
    const t = parseFloat(document.getElementById('evTime').value) || 0;
    const b = parseFloat(document.getElementById('evBolus').value) || 0;
    const c = parseFloat(document.getElementById('evCont').value) || 0;
    engine.addDoseEvent(new DoseEvent(t, b, c));
    renderEventsTable();
    closeEventModal();
  }

  function run() {
    const patient = App.getPatient();
    if (!patient) return;
    engine.setPatient(patient);
    if (!engine.doseEvents.length) { alert('投与イベントを1つ以上追加してください'); return; }
    const duration = Math.max(1, parseFloat(document.getElementById('monDuration').value) || 60);
    lastResult = engine.run({ duration, dt: 0.1, sampleInterval: 0.5 });
    renderResult(lastResult);
    document.getElementById('monCsvBtn').disabled = false;
  }

  function renderResult(result) {
    document.getElementById('monResultsCard').style.display = '';
    const pts = result.timePoints;

    // metrics
    const last = pts[pts.length - 1];
    const metrics = [
      { lbl: '最高 Cp (親薬)', val: result.maxCpRemi.toFixed(3), unit: 'µg/mL', cls: 'cp' },
      { lbl: '最低 BIS', val: result.minBis != null ? result.minBis.toFixed(1) : '—', unit: '', cls: 'bis' },
      { lbl: '最高 Ce (BIS)', val: result.maxCeBis.toFixed(3), unit: 'µg/mL', cls: 'ce' },
      { lbl: '最高 代謝物', val: result.maxCpMet.toFixed(3), unit: 'µg/mL', cls: 'met' },
      { lbl: '最終 MOAA/S', val: last.moaasWeighted.toFixed(2), unit: '(0-5)', cls: 'moaas' }
    ];
    document.getElementById('monMetrics').innerHTML = metrics.map(m =>
      `<div class="metric ${m.cls}"><div class="val">${m.val}<span class="unit"> ${m.unit}</span></div><div class="lbl">${m.lbl}</div></div>`
    ).join('');

    document.getElementById('monDeepBisNotice').style.display = (result.minBis != null && result.minBis < 50) ? '' : 'none';

    // concentration + BIS chart
    if (!chartConc) chartConc = new MultiLineChart('monChartConc', { left: { title: '濃度 (µg/mL)', min: 0 }, right: { title: 'BIS', min: 0, max: 100 } });
    chartConc.render(pts, [
      { key: 'cpRemi', label: 'Cp 親薬', color: CHART_COLORS.cpRemi, axis: 'left' },
      { key: 'ceBis', label: 'Ce (BIS)', color: CHART_COLORS.ceBis, axis: 'left' },
      { key: 'ceMoaas', label: 'Ce (MOAA/S)', color: CHART_COLORS.ceMoaas, axis: 'left', dash: [4, 3] },
      { key: 'cpMet', label: 'CNS7054', color: CHART_COLORS.cpMet, axis: 'left', dash: [2, 2] },
      { key: 'bis', label: 'BIS', color: CHART_COLORS.bis, axis: 'right' }
    ]);

    // MOAA/S chart
    if (!chartMoaas) chartMoaas = new MultiLineChart('monChartMoaas', { left: { title: 'MOAA/S (0-5)', min: 0, max: 5 } });
    chartMoaas.render(pts, [
      { key: 'moaasWeighted', label: '確率加重 MOAA/S', color: CHART_COLORS.moaas, axis: 'left' }
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
    renderEventsTable();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => MonitoringController.init());

/* -------- service worker -------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
  });
}

document.addEventListener('DOMContentLoaded', () => App.init());
