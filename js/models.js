/**
 * models.js — Data structures for the Remimazolam TCI Simulator
 *
 * Drug-agnostic patient model, covariate enums, and result containers.
 * The Eleveld 2025 PK-PD math lives in remimazolam-eleveld-pkpd.js.
 *
 * Units convention (whole app):
 *   - drug amount: mg          - volume: L          - concentration: µg/mL (= mg/L)
 *   - rate: mg/min (internal)  - clearance: L/min   - time: min
 */

/* ------------------------------------------------------------------ */
/* Covariate enums                                                     */
/* ------------------------------------------------------------------ */

const SexType = Object.freeze({
  MALE: 'male',
  FEMALE: 'female',
  // NONMEM dummy: M1F2 (male=1, female=2)
  toM1F2(sex) { return sex === SexType.FEMALE ? 2 : 1; },
  displayName(sex) { return sex === SexType.FEMALE ? 'Female' : 'Male'; }
});

const HepaticFunction = Object.freeze({
  NORMAL: 'normal',        // Pugh-Child score <= 8
  SEVERE: 'severe',        // Pugh-Child score > 8
  // NONMEM dummy: P1GT8 (<=8 -> 1, >8 -> 2)
  toP1GT8(h) { return h === HepaticFunction.SEVERE ? 2 : 1; },
  displayName(h) { return h === HepaticFunction.SEVERE ? 'Severe (Pugh-Child > 8)' : 'Normal'; }
});

const RenalFunction = Object.freeze({
  NORMAL: 'normal',
  ESRD: 'esrd',            // end-stage renal disease
  // NONMEM dummy: H1ESRD2 (normal -> 1, ESRD -> 2)
  toH1ESRD2(r) { return r === RenalFunction.ESRD ? 2 : 1; },
  displayName(r) { return r === RenalFunction.ESRD ? 'ESRD' : 'Normal'; }
});

const OpioidStatus = Object.freeze({
  ABSENT: false,
  PRESENT: true,
  // NONMEM dummy: OA1P2 (absent -> 1, present -> 2)
  toOA1P2(present) { return present ? 2 : 1; },
  displayName(present) { return present ? 'Present' : 'Absent'; }
});

/* ------------------------------------------------------------------ */
/* Patient                                                             */
/* ------------------------------------------------------------------ */

class Patient {
  /**
   * @param {Object} o
   * @param {string} [o.id]
   * @param {number} o.age          years
   * @param {number} o.weight       kg (total body weight)
   * @param {number} [o.height]     cm (display/BMI only; not used in PK)
   * @param {string} o.sex          SexType
   * @param {boolean} o.opioid      opioid co-administration
   * @param {string} [o.hepatic]    HepaticFunction (default NORMAL)
   * @param {string} [o.renal]      RenalFunction (default NORMAL)
   */
  constructor(o = {}) {
    this.id = o.id || 'patient-1';
    this.age = Number(o.age);
    this.weight = Number(o.weight);
    this.height = o.height != null ? Number(o.height) : null;
    this.sex = o.sex || SexType.MALE;
    this.opioid = !!o.opioid;
    this.hepatic = o.hepatic || HepaticFunction.NORMAL;
    this.renal = o.renal || RenalFunction.NORMAL;
    this.anesStart = o.anesStart || '08:00';   // anaesthesia start (HH:MM)
  }

  get bmi() {
    if (!this.height || this.height <= 0) return null;
    const h = this.height / 100;
    return this.weight / (h * h);
  }

  /** NONMEM dummy variables used by the Eleveld model equations. */
  get covariates() {
    return {
      AGE: this.age,
      WGT: this.weight,
      M1F2: SexType.toM1F2(this.sex),
      OA1P2: OpioidStatus.toOA1P2(this.opioid),
      P1GT8: HepaticFunction.toP1GT8(this.hepatic),
      H1ESRD2: RenalFunction.toH1ESRD2(this.renal)
    };
  }

  validate() {
    const errors = [];
    if (!Number.isFinite(this.age) || this.age < 1 || this.age > 100) {
      errors.push('Age must be between 1 and 100 years');
    }
    if (!Number.isFinite(this.weight) || this.weight < 5 || this.weight > 250) {
      errors.push('Weight must be between 5 and 250 kg');
    }
    if (this.height != null && (this.height < 30 || this.height > 250)) {
      errors.push('Height must be between 30 and 250 cm');
    }
    if (![SexType.MALE, SexType.FEMALE].includes(this.sex)) {
      errors.push('Invalid sex');
    }
    return { isValid: errors.length === 0, errors };
  }

  clone() {
    return new Patient({
      id: this.id, age: this.age, weight: this.weight, height: this.height,
      sex: this.sex, opioid: this.opioid, hepatic: this.hepatic, renal: this.renal,
      anesStart: this.anesStart
    });
  }
}

/* ------------------------------------------------------------------ */
/* Clock-time helpers (events are entered as HH:MM wall-clock)         */
/* ------------------------------------------------------------------ */

const ClockTime = Object.freeze({
  /** "HH:MM" -> minutes since midnight (null if invalid). */
  toMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  },
  /** minutes since midnight -> "HH:MM" (wraps past 24 h, e.g. overnight cases). */
  toHHMM(mins) {
    const t = ((Math.round(mins) % 1440) + 1440) % 1440;
    const h = Math.floor(t / 60), m = t % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },
  /**
   * Elapsed minutes from a start clock time to an event clock time.
   * If the event time is earlier in the day, assume it is on the next day.
   */
  elapsedFromStart(startHHMM, eventHHMM) {
    const s = ClockTime.toMinutes(startHHMM), e = ClockTime.toMinutes(eventHHMM);
    if (s == null || e == null) return null;
    let d = e - s;
    if (d < 0) d += 1440;
    return d;
  }
});

/* ------------------------------------------------------------------ */
/* Dose events & time series                                           */
/* ------------------------------------------------------------------ */

/** A single administration event on the timeline. */
class DoseEvent {
  /**
   * @param {number} timeMin           start time (min from anaesthesia start)
   * @param {number} bolusMg           instantaneous bolus (mg)
   * @param {number} continuousMgHr    continuous infusion rate from this time (mg/hr)
   */
  constructor(timeMin, bolusMg = 0, continuousMgHr = 0) {
    this.timeMin = Number(timeMin) || 0;
    this.bolusMg = Number(bolusMg) || 0;
    this.continuousMgHr = Number(continuousMgHr) || 0;
  }
}

/** One sampled point of the simulation output. */
class TimePoint {
  constructor(o) {
    this.timeMin = o.timeMin;            // min
    this.cpRemi = o.cpRemi;              // remimazolam plasma (arterial) µg/mL
    this.ceBis = o.ceBis;                // remimazolam effect-site for BIS µg/mL
    this.ceMoaas = o.ceMoaas;            // remimazolam effect-site for MOAA/S µg/mL
    this.cpMet = o.cpMet;                // CNS7054 plasma µg/mL
    this.bis = o.bis;                    // predicted BIS (0-100)
    this.moaasWeighted = o.moaasWeighted; // probability-weighted MOAA/S (0-5)
    this.infusionMgHr = o.infusionMgHr != null ? o.infusionMgHr : null; // mg/hr at this time
  }
}

/** Container for a completed simulation run, with summary + CSV export. */
class SimulationResult {
  constructor(patient, timePoints, meta = {}) {
    this.patient = patient;
    this.timePoints = timePoints || [];
    this.meta = meta;                    // e.g. { mode, target, doseEvents }
  }

  get maxCpRemi() { return Math.max(0, ...this.timePoints.map(p => p.cpRemi)); }
  get maxCeBis() { return Math.max(0, ...this.timePoints.map(p => p.ceBis)); }
  get minBis() { return this.timePoints.length ? Math.min(...this.timePoints.map(p => p.bis)) : null; }
  get maxCpMet() { return Math.max(0, ...this.timePoints.map(p => p.cpMet)); }

  toCSV() {
    const p = this.patient;
    const lines = [];
    lines.push('# Remimazolam TCI Simulator (Eleveld 2025)');
    lines.push(`# Patient,${p.id}`);
    lines.push(`# Age,${p.age},yr`);
    lines.push(`# Weight,${p.weight},kg`);
    lines.push(`# Sex,${SexType.displayName(p.sex)}`);
    lines.push(`# Opioid,${OpioidStatus.displayName(p.opioid)}`);
    lines.push(`# Hepatic,${HepaticFunction.displayName(p.hepatic)}`);
    lines.push(`# Renal,${RenalFunction.displayName(p.renal)}`);
    if (this.meta.mode) lines.push(`# Mode,${this.meta.mode}`);
    lines.push('');
    lines.push('time_min,Cp_remi_ug_mL,Ce_BIS_ug_mL,Ce_MOAAS_ug_mL,Cp_CNS7054_ug_mL,BIS,MOAAS_weighted,infusion_mg_hr');
    for (const tp of this.timePoints) {
      lines.push([
        tp.timeMin.toFixed(3),
        fmt(tp.cpRemi), fmt(tp.ceBis), fmt(tp.ceMoaas), fmt(tp.cpMet),
        tp.bis != null ? tp.bis.toFixed(2) : '',
        tp.moaasWeighted != null ? tp.moaasWeighted.toFixed(3) : '',
        tp.infusionMgHr != null ? tp.infusionMgHr.toFixed(4) : ''
      ].join(','));
    }
    return lines.join('\n');
  }
}

function fmt(x) {
  return (x == null || !Number.isFinite(x)) ? '' : x.toFixed(5);
}

/* ------------------------------------------------------------------ */
/* Exports (browser globals + CommonJS for node validation scripts)    */
/* ------------------------------------------------------------------ */

if (typeof window !== 'undefined') {
  window.SexType = SexType;
  window.HepaticFunction = HepaticFunction;
  window.RenalFunction = RenalFunction;
  window.OpioidStatus = OpioidStatus;
  window.Patient = Patient;
  window.ClockTime = ClockTime;
  window.DoseEvent = DoseEvent;
  window.TimePoint = TimePoint;
  window.SimulationResult = SimulationResult;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SexType, HepaticFunction, RenalFunction, OpioidStatus,
    Patient, ClockTime, DoseEvent, TimePoint, SimulationResult
  };
}
