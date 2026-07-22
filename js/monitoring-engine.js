/**
 * monitoring-engine.js — dose-event timeline simulation.
 *
 * Wraps EleveldRemimazolam.simulate() and produces a SimulationResult
 * (TimePoint list + CSV export). Each DoseEvent applies its bolus at the
 * event time and SETS the continuous infusion rate (mg/hr) from that time.
 */

class MonitoringEngine {
  constructor() {
    this.patient = null;
    /** @type {DoseEvent[]} */
    this.doseEvents = [];
  }

  setPatient(patient) { this.patient = patient; }

  addDoseEvent(ev) {
    this.doseEvents.push(ev);
    this.doseEvents.sort((a, b) => a.timeMin - b.timeMin);
  }

  removeDoseEvent(index) { this.doseEvents.splice(index, 1); }
  clearDoseEvents() { this.doseEvents = []; }

  /**
   * @param {Object} [opts] { duration, dt=0.1, sampleInterval=0.5, tailMin=120 } (min)
   *   If `duration` is omitted, the simulation runs until the last dose event
   *   time + `tailMin` (default 120 min), matching the propofol simulator.
   * @returns {SimulationResult}
   */
  run(opts = {}) {
    if (!this.patient) throw new Error('patient not set');
    if (!this.doseEvents.length) throw new Error('at least one dose event is required');
    const dt = opts.dt != null ? opts.dt : 0.1;
    const sampleInterval = opts.sampleInterval != null ? opts.sampleInterval : 0.5;
    const tailMin = opts.tailMin != null ? opts.tailMin : 120;
    const lastEventMin = Math.max(...this.doseEvents.map(e => e.timeMin));
    const duration = opts.duration != null ? opts.duration : lastEventMin + tailMin;

    const { points, params } = EleveldRemimazolam.simulate(this.patient, this.doseEvents, { duration, dt, sampleInterval });
    const tps = points.map(p => new TimePoint({
      timeMin: p.timeMin,
      cpRemi: p.cp,
      ceBis: p.ceBis,
      ceMoaas: p.ceMoaas,
      cpMet: p.cpMet,
      bis: p.bis,
      moaasWeighted: p.moaasWeighted,
      infusionMgHr: p.infusionMgHr
    }));
    const result = new SimulationResult(this.patient, tps, { mode: 'monitoring', doseEvents: this.doseEvents.slice() });
    // expose raw state-carrying points + params for the recovery panel
    result.simPoints = points;
    result.params = params;
    return result;
  }
}

if (typeof window !== 'undefined') window.MonitoringEngine = MonitoringEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = { MonitoringEngine };
