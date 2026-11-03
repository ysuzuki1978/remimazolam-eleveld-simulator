# Changelog

Format after [Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Older releases are in the README history table.

## [1.14.1] - 2026-10-25

Cleanup release: helpers that were written inline in several places are now written once, and the engine is
tested against the exact solution. No change to the model, the parameters, the plans or any number shown.

### Verified unchanged
- 5 patients (age 8-90 y, 25-110 kg, opioid, severe hepatic, ESRD) x dose record, monitoring CSV, 5 TCI plans,
  recovery prediction, required-Ce inversion and 40 induction ticks: every value is bit-identical to v1.14.0
  (JSON round trip, 1.75 MB).
- Headless Chrome (390 x 844), scripted run on the v1.14.0 tree and on this tree gives identical output for:
  patient start across midnight, three dose events and their clock labels, Monitoring metric tiles, CSV
  (monitoring and TCI), four TCI plans (Ce on both sites, MOAA/S target, BIS target) with dosing tables and
  emergence-forecast text, Send to Monitoring, induction start / LOC / ROC / reset, both Now buttons.

### Changed
- `js/clock.js`: `ClockTime` moved out of `models.js`; new `ClockTime.now()` and `ClockTime.labelAt()` replace
  two copies of the HH:MM-from-Date code and the start + elapsed label arithmetic. The default start is
  `DEFAULT_ANES_START`.
- `js/format.js`: `formatNumber`, `csvNumber`, `formatDuration`, `formatElapsedClock` (from `main.js`, `models.js`
  and `recovery-panel.js`). `js/series.js`: `nearestByTime` (from `charts.js`), so the helpers load without Chart.js.
- `TciEngine.scheduleRows()` and `TciEngine.planToDoseEvents()`: the plan read off at clinical times, once. The
  dosing table and Send to Monitoring each had their own copy and used different nearest-sample searches (they
  agree on the 0.5 min grid used here). `TciEngine.LOADING_MG_PER_KG` and `TciEngine.SCHEDULE_TIMES` are named.
- `TimePoint.fromObservation()` replaces two copies of the field mapping; `downloadCsv()` replaces two copies of
  the blob / anchor code; the induction readout before a run takes the awake BIS from the model baseline
  (93.7196, shown as 93.7).
- `js/summary.js`: the metric tiles and the deep-BIS flag are built as data (`monitoringMetrics`, `planMetrics`,
  `reachesDeepBis`), not inside the DOM code.

### Fixed
- `simulate()`: a dose event dated before time 0 stopped every later event from being applied (3 mg at -5 min
  followed by 7 mg + 60 mg/hr at 0 gave Cp = 0 throughout; it now gives Cp = 2.32 ug/mL at t = 0). The app cannot
  create such an event (elapsed time is never negative); this concerns callers of the engine.

### Removed
- `Patient.clone()` and the `hasCont` flag in `simulate()`: no callers.

### Added
- `npm test` (Node `node --test`, no dependencies, 37 tests):
  - the engine against the exact solution (matrix exponential; the state matrix is written from volumes,
    clearances and ke0, not from `deriv()`): `simulate()` for 4 patients over bolus, two rate changes, a later
    bolus and stop, peak-relative error below 1e-6 (measured 1.3e-7 for Cp, 5.0e-8 for Ce, 7.5e-9 for the
    metabolite in the elderly opioid case); `TciEngine.plan()` replayed with the rates it chose, below 1e-8;
    `InductionEngine` ticks with a fake clock, a bolus and a rate change on the way; the emergence forecast
    within one step of the exact washout;
  - parameters: Table 1 at its printed precision, covariate directions, regression pins;
  - clock, schedule, CSV, metric tiles and formatters;
  - negative controls, each failing the same comparison: rate in mg/min instead of mg/hr (error 0.98),
    events one step late (1.9e-2), ke0 1 % off (2.4e-3), forward Euler (above 1e-3);
  - every script in `index.html` is in the service-worker precache list; the version agrees across
    `package.json`, the footer, the cache name, the README and this file.
