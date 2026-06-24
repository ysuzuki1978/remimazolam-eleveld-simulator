/**
 * induction-engine.js — real-time induction simulation.
 *
 * Runs the 8-state model with a wall-clock timer (setInterval), advancing
 * `speed`× real-time per tick. Supports an initial bolus, live continuous-rate
 * changes, extra boluses, and LOC snapshots. Notifies UI via callbacks.
 *
 * Integration: dt = 0.01 min (0.6 s) inside each tick.
 */

class InductionEngine {
  constructor() {
    this.patient = null;
    this.params = null;
    this.state = null;
    this.timer = null;
    this.running = false;
    this.elapsedMin = 0;
    this.contMgHr = 0;
    this.speedMult = 1;       // real-time (1 sim-min per wall-min)
    this.maxMin = 60;         // auto-stop horizon
    this.tickMs = 100;
    this.dt = 0.01;
    this.lastTick = 0;
    this.callbacks = [];
  }

  onUpdate(fn) { this.callbacks.push(fn); }

  /** Initialise (does not auto-start the timer). */
  prepare(patient, bolusMg, contMgHr) {
    this.patient = patient;
    this.params = EleveldRemimazolam.computeParameters(patient);
    this.state = EleveldRemimazolam.createInitialState();
    if (bolusMg > 0) EleveldRemimazolam.bolus(this.state, bolusMg);
    this.contMgHr = contMgHr || 0;
    this.elapsedMin = 0;
    this.notify();
  }

  _now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  start() {
    if (this.running || !this.state) return;
    this.running = true;
    this.lastTick = this._now();
    this.timer = setInterval(() => this._tick(), this.tickMs);
  }

  /**
   * Advance the simulation by the ACTUAL wall-clock time elapsed since the last
   * tick (× speedMult). Driving the advance from the real clock — rather than
   * assuming each interval is exactly tickMs — keeps it true real-time despite
   * timer jitter and background-tab throttling. Integration uses sub-steps of
   * at most `dt` for accuracy; a 0.5 min cap avoids a huge jump after the tab
   * was suspended.
   */
  _tick() {
    const now = this._now();
    let simMin = ((now - this.lastTick) / 1000 / 60) * this.speedMult;
    this.lastTick = now;
    if (simMin <= 0) return;
    if (simMin > 0.5) simMin = 0.5;            // clamp after long suspension
    const n = Math.max(1, Math.ceil(simMin / this.dt));
    const sub = simMin / n;
    const inf = this.contMgHr / 60;
    for (let i = 0; i < n; i++) this.state = EleveldRemimazolam.step(this.state, inf, sub, this.params);
    this.elapsedMin += simMin;
    this.notify();
    if (this.elapsedMin >= this.maxMin) this.stop();
  }

  pause() { this.running = false; if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  stop() { this.pause(); }

  setSpeed(mult) { this.speedMult = mult; if (this.running) { this.pause(); this.start(); } }
  setContinuous(mgHr) { this.contMgHr = mgHr || 0; }
  giveBolus(mg) { if (this.state && mg > 0) { EleveldRemimazolam.bolus(this.state, mg); this.notify(); } }

  observe() { return this.state ? EleveldRemimazolam.observe(this.state, this.params) : null; }

  notify() {
    const o = this.observe();
    if (!o) return;
    const snap = { elapsedMin: this.elapsedMin, running: this.running, ...o };
    this.callbacks.forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
  }
}

if (typeof window !== 'undefined') window.InductionEngine = InductionEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = { InductionEngine };
