/**
 * format.js — number and duration formatting shared by the panels, the
 * readout strip and the CSV export. Pure functions, no DOM.
 */

/** x to d decimals for display; an em dash for a missing or non-finite value. */
function formatNumber(x, d = 2) {
  return (x == null || !Number.isFinite(x)) ? '—' : x.toFixed(d);
}

/** x to d decimals for a CSV cell; an empty cell for a missing or non-finite value. */
function csvNumber(x, d = 5) {
  return (x == null || !Number.isFinite(x)) ? '' : x.toFixed(d);
}

/**
 * Minutes -> "X.X min" / "now" / "H h M min" / "> 12 h".
 * @param {?number} min  time in minutes; null = not reached within the horizon
 */
function formatDuration(min) {
  if (min == null) return '> 12 h';
  if (min <= 0) return 'now';
  if (min < 100) return `${min.toFixed(1)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h} h ${m} min`;
}

/** Elapsed minutes -> "M:SS" (a stopwatch label, not a time of day). */
function formatElapsedClock(min) {
  const total = Math.max(0, Math.round(min * 60));
  const mm = Math.floor(total / 60), ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

if (typeof window !== 'undefined') {
  window.formatNumber = formatNumber;
  window.csvNumber = csvNumber;
  window.formatDuration = formatDuration;
  window.formatElapsedClock = formatElapsedClock;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatNumber, csvNumber, formatDuration, formatElapsedClock };
}
