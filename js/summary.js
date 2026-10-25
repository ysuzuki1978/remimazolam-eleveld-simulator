/**
 * summary.js — the headline numbers shown above the charts, as data.
 *
 * The controllers draw them; building them here keeps the arithmetic (which
 * site a plan targets, which minimum is a "deep BIS") out of the DOM code.
 * A metric is { lbl, val, unit, cls }: label, formatted value, unit, CSS class.
 */

/** A BIS below this is flagged as deeper than a general-anaesthesia target. */
const DEEP_BIS = 50;

/** @param {SimulationResult} result  non-empty */
function monitoringMetrics(result) {
  const last = result.timePoints[result.timePoints.length - 1];
  return [
    { lbl: 'Max Cp (parent)', val: result.maxCpRemi.toFixed(3), unit: 'µg/mL', cls: 'cp' },
    { lbl: 'Min BIS', val: result.minBis != null ? result.minBis.toFixed(1) : '—', unit: '', cls: 'bis' },
    { lbl: 'Max Ce (BIS)', val: result.maxCeBis.toFixed(3), unit: 'µg/mL', cls: 'ce' },
    { lbl: 'Max Ce (MOAA/S)', val: result.maxCeMoaas.toFixed(3), unit: 'µg/mL', cls: 'moaas' },
    { lbl: 'Max metabolite', val: result.maxCpMet.toFixed(3), unit: 'µg/mL', cls: 'met' },
    { lbl: 'Final MOAA/S', val: last.moaasWeighted.toFixed(2), unit: '(0-5)', cls: 'moaas' }
  ];
}

/**
 * @param {Object} result  from TciEngine.plan*()
 * @param {'ce'|'moaas'|'bis'} mode  what the target was stated in
 */
function planMetrics(result, mode) {
  const pts = result.points;
  const last = pts[pts.length - 1];
  const siteLabel = result.targetSite === 'bis' ? 'BIS' : 'MOAA/S';
  let target;
  if (mode === 'bis') target = { lbl: 'Target BIS', val: String(result.bisTarget), unit: '', cls: 'ce' };
  else if (mode === 'moaas') target = { lbl: 'Target MOAA/S', val: String(result.moaasTarget), unit: '/5', cls: 'moaas' };
  else target = { lbl: `Target Ce (${siteLabel})`, val: pts[0].targetCe.toFixed(2), unit: 'µg/mL', cls: 'ce' };
  return [
    { lbl: 'Loading bolus', val: result.loadingBolusMg.toFixed(1), unit: 'mg', cls: 'cp' },
    target,
    { lbl: 'Final rate', val: last.infusionMgHr.toFixed(1), unit: 'mg/hr', cls: 'cp' },
    { lbl: 'Total dose', val: result.totalDoseMg.toFixed(0), unit: 'mg', cls: 'met' },
    { lbl: 'Final BIS', val: last.bis.toFixed(1), unit: '', cls: 'bis' },
    { lbl: 'Final MOAA/S', val: last.moaasWeighted.toFixed(2), unit: '/5', cls: 'moaas' }
  ];
}

/** True if any point's predicted BIS is below DEEP_BIS. */
function reachesDeepBis(points) {
  return points.some(p => p.bis < DEEP_BIS);
}

function metricsHtml(metrics) {
  return metrics.map(m =>
    `<div class="metric ${m.cls}"><div class="val">${m.val}<span class="unit"> ${m.unit}</span></div><div class="lbl">${m.lbl}</div></div>`
  ).join('');
}

if (typeof window !== 'undefined') {
  window.DEEP_BIS = DEEP_BIS;
  window.monitoringMetrics = monitoringMetrics;
  window.planMetrics = planMetrics;
  window.reachesDeepBis = reachesDeepBis;
  window.metricsHtml = metricsHtml;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEEP_BIS, monitoringMetrics, planMetrics, reachesDeepBis, metricsHtml };
}
