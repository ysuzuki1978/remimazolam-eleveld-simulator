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

/* -------- service worker -------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
  });
}

document.addEventListener('DOMContentLoaded', () => App.init());
