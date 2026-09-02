// The clock (comp:clock) — the only part that knows what time it is.
//
// Provides iface:the-beat. Governed by dec:one-clock: musical time has exactly
// one authority here, derived from the audio hardware clock. Nothing else in the
// game holds a timer, a frame counter, or an elapsed-time variable, and the
// visual position of a falling block is computed from this rather than advanced
// per frame.
//
// Why the audio clock and not performance.now(): the sound is scheduled against
// the audio hardware, so anything that decides WHEN a note happens has to live
// in the same time base or the two drift. Frame timestamps stall under load; the
// audio clock does not.

/**
 * Scheduling window. The scheduler wakes every TICK and commits every note
 * falling inside the next LOOKAHEAD, so the audio thread always has work queued
 * ahead of it. The gap between them is the safety margin: as long as a wake-up
 * is not delayed by more than (LOOKAHEAD - TICK), no note is ever late.
 *
 * 25ms / 120ms leaves ~95ms of slack, which comfortably survives a garbage
 * collection or a janky frame on a phone. Larger lookahead is more robust and
 * less responsive to a tempo change; we never change tempo mid-loop, so this
 * errs toward robust.
 */
const TICK_MS = 25;
const LOOKAHEAD = 0.12;

export const STEPS_PER_BAR = 16; // sixteenth notes

export class Clock {
  /**
   * @param {AudioContext} ctx
   * @param {{bpm?: number, swing?: number}} opts
   *   swing — how far the "and" of each beat leans late, as a fraction of a
   *   sixteenth. 0 is a drum machine; around a third is where phonk lives.
   *
   * SWING IS AT THE EIGHTH, NOT THE SIXTEENTH. It used to delay every odd
   * sixteenth, which was correct for a sixteenth-note groove and became silent
   * the moment notes were quantised to eighths — every note would have landed on
   * an unswung step and the groove would have quietly vanished. It delays the
   * "and" of each beat instead, which is what a human drummer does.
   */
  constructor(ctx, { bpm = 138, swing = 0.32 } = {}) {
    this.ctx = ctx;
    this.bpm = bpm;
    this.swing = swing;

    this._startedAt = null;   // audio time of step 0, or null if not running
    this._scheduledTo = 0;    // absolute step index already committed
    this._timer = null;
    this._listeners = new Set();
  }

  /** Seconds per sixteenth. */
  get stepSeconds() {
    return 60 / this.bpm / 4;
  }

  get running() {
    return this._startedAt !== null;
  }

  /**
   * Audio time at which absolute step `step` sounds, swing included.
   *
   * Accepts a fractional step and interpolates, so a caller asking "where is
   * step 6.4 right now" gets a straight answer rather than having to know about
   * swing at all.
   */
  timeOf(step) {
    if (this._startedAt === null) return null;
    const whole = Math.floor(step);
    const frac = step - whole;
    const at = (s) => {
      // The "and" of the beat — steps 2, 6, 10, 14 of each bar — leans late.
      const swung = ((s % 4) + 4) % 4 === 2 ? this.swing * this.stepSeconds : 0;
      return this._startedAt + s * this.stepSeconds + swung;
    };
    return frac === 0 ? at(whole) : at(whole) + (at(whole + 1) - at(whole)) * frac;
  }

  /**
   * Where we are now, as a continuous absolute step position.
   *
   * DELIBERATELY UNSWUNG. Swing belongs to where a note SOUNDS, not to where the
   * playhead is; applying it here would make the highway lurch. The stage draws
   * a block by asking timeOf() for that block's own step, which carries swing
   * correctly for that one note.
   *
   * Returns null before the first tap — not zero. A caller must not be able to
   * mistake "not running" for "at the beginning" (iface:the-beat).
   */
  now() {
    if (this._startedAt === null) return null;
    return (this.ctx.currentTime - this._startedAt) / this.stepSeconds;
  }

  /** Convenience: bar, step-within-bar, and the absolute step, or null. */
  position() {
    const abs = this.now();
    if (abs === null) return null;
    const step = Math.floor(abs);
    return {
      absolute: abs,
      bar: Math.floor(step / STEPS_PER_BAR),
      step: ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR,
    };
  }

  /**
   * Register a scheduling callback. Called on every tick with the half-open
   * range of absolute steps now inside the lookahead window, plus a function
   * giving each one its audio time.
   *
   * @param {(fromStep: number, toStep: number, timeOf: (s:number)=>number) => void} fn
   * @returns {() => void} unsubscribe
   */
  onSchedule(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Start the clock. Must be called from inside a user gesture on iOS, after the
   * context has been resumed — the shell owns that (dec:beat-the-silent-switch).
   */
  start() {
    if (this.running) return;
    // Start a hair in the future so the first scheduled step is not already
    // in the past by the time this returns.
    this._startedAt = this.ctx.currentTime + 0.05;
    this._scheduledTo = 0;
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
    this._startedAt = null;
    this._scheduledTo = 0;
  }

  _tick() {
    if (this._startedAt === null) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;

    // Advance to the first step past the horizon. Compare against the SWUNG
    // time, or a swung-late note near the boundary gets committed a tick late.
    let to = this._scheduledTo;
    while (this.timeOf(to) < horizon) {
      to++;
      // Guard against a pathological jump — a suspended tab can leave
      // currentTime far ahead, and we would otherwise schedule thousands of
      // steps in one go. Skipping ahead is correct: those notes are long past.
      if (to - this._scheduledTo > 512) {
        this._scheduledTo = Math.floor((this.ctx.currentTime - this._startedAt) / this.stepSeconds);
        to = this._scheduledTo;
        break;
      }
    }

    if (to > this._scheduledTo) {
      const from = this._scheduledTo;
      this._scheduledTo = to;
      for (const fn of this._listeners) fn(from, to, (s) => this.timeOf(s));
    }
  }
}
