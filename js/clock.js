/**
 * clock.js — wall-clock helpers (HH:MM strings and minutes since midnight).
 *
 * Dose events are entered as clock times; the simulation runs on elapsed
 * minutes from the anaesthesia start. Everything that converts between the two
 * lives here so the form code does not repeat the arithmetic.
 *
 * Units: clock time "HH:MM" (24 h) · minutes since midnight · elapsed time min.
 */

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
   * @returns {?number} null if either time does not parse
   */
  elapsedFromStart(startHHMM, eventHHMM) {
    const s = ClockTime.toMinutes(startHHMM), e = ClockTime.toMinutes(eventHHMM);
    if (s == null || e == null) return null;
    let d = e - s;
    if (d < 0) d += 1440;
    return d;
  },
  /**
   * The clock time of an instant elapsedMin after the start. A start that does
   * not parse counts as midnight.
   */
  labelAt(startHHMM, elapsedMin) {
    const s = ClockTime.toMinutes(startHHMM);
    return ClockTime.toHHMM((s == null ? 0 : s) + elapsedMin);
  },
  /** The wall clock as "HH:MM". Takes the date so that it can be tested. */
  now(date = new Date()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
});

if (typeof window !== 'undefined') window.ClockTime = ClockTime;
if (typeof module !== 'undefined' && module.exports) module.exports = { ClockTime };
