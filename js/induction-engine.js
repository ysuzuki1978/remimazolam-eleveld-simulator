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
    this.speedMult = 30;      // ×real-time
    this.maxMin = 60;         // auto-stop horizon
    this.tickMs = 100;
    this.dt = 0.01;
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

  start() {
    if (this.running || !this.state) return;
    this.running = true;
    const simPerTick = (this.tickMs / 1000 / 60) * this.speedMult; // min advanced per tick
    this.timer = setInterval(() => this._tick(simPerTick), this.tickMs);
  }

  _tick(simMin) {
    const steps = Math.max(1, Math.round(simMin / this.dt));
    const inf = this.contMgHr / 60;
    for (let i = 0; i < steps; i++) this.state = EleveldRemimazolam.step(this.state, inf, this.dt, this.params);
    this.elapsedMin += steps * this.dt;
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
