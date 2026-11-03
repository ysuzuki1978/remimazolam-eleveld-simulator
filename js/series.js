/**
 * series.js — lookups on a sampled time series (points sorted by timeMin).
 */

/**
 * The point whose timeMin is closest to t. On a tie the later point wins.
 * @param {{timeMin: number}[]} points  sorted by timeMin, not empty
 * @param {number} t  minutes
 */
function nearestByTime(points, t) {
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeMin < t) lo = mid + 1; else hi = mid;
  }
  return (lo > 0 && t - points[lo - 1].timeMin < points[lo].timeMin - t) ? points[lo - 1] : points[lo];
}

if (typeof window !== 'undefined') window.nearestByTime = nearestByTime;
if (typeof module !== 'undefined' && module.exports) module.exports = { nearestByTime };
