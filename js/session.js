// The session (comp:coach) — the rounds, and what to put in front of her next.
//
// Provides iface:the-nudge. It emits INTENTIONS and never learns what any of
// them looks like; the shell subscribes and decides how they are shown. That
// direction is what keeps this out of a cycle with the shell.
//
// Governed by dec:two-thumbs-loop-pedal. This is the loop pedal: press to start,
// play two sounds, press to keep or press to throw away, then the next pair
// over the top. It replaces the coach's old job of silently handing four keys
// between three instruments — the owner watched a nine-year-old and concluded
// that a beginning and an end she controls beats an interface that records
// everything forever.
//
// It reads the track and never sits on the audio path.

import { ROUNDS } from './track.js';

/** Taps needed to set a tempo, and the range a child's beat can land in. */
const TAPS_TO_SET = 4;
const MIN_BPM = 60;
const MAX_BPM = 170;
/** Longer than this between taps and she has started again, not kept going. */
const TAP_TIMEOUT_MS = 2400;

/** Bars of count-in before recording starts. One is enough at these tempos. */
export const COUNT_IN_BARS = 1;

/**
 * The states, and they are deliberately few enough to say out loud:
 *   'tempo'     — tapping out a speed. Nothing is being recorded.
 *   'counting'  — the count-in is running. Still nothing being recorded.
 *   'recording' — she is playing. Taps land in the current round.
 *   'done'      — every round accepted.
 */
export class Session {
  constructor(track) {
    this.track = track;
    this.state = 'tempo';
    this.roundIndex = 0;
    this.countInEndsAtStep = 0;

    this._taps = [];
    /**
     * Whether this track HAS a tempo — which is not the same question as
     * whether she has tapped one.
     *
     * It used to be derived from the tap count, and that was wrong for the one
     * case that matters most: a track someone SENT her already has a tempo, it
     * came inside the link. Deriving it from taps meant the receiver was asked
     * to tap out a speed the track already knew, before it would play at all.
     */
    this._tempoSet = false;
    this._listeners = new Set();
  }

  get round() {
    return ROUNDS[this.roundIndex];
  }

  get recording() {
    return this.state === 'recording';
  }

  /** Does the click sound right now? Round one only — after that her own beat
   *  is the click, and a metronome over a drum pattern is the sound of a test. */
  get clickAudible() {
    if (this.state === 'tempo' || this.state === 'counting') return true;
    return this.state === 'recording' && this.round?.click === true;
  }

  onNudge(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(nudge) {
    // Fire and forget. A hint that queues up and arrives late is worse than one
    // that never arrives (iface:the-nudge).
    for (const fn of this._listeners) fn(nudge);
  }

  // -------------------------------------------------------------------------
  // Setting the tempo, by tapping it
  // -------------------------------------------------------------------------

  /**
   * One tap of the tempo. Returns the bpm once enough taps have landed.
   *
   * Uses the median gap rather than the mean: one wild tap in four ruins an
   * average and barely moves a median, and a child's fourth tap is exactly where
   * a wild one turns up.
   */
  tapTempo(nowMs = performance.now()) {
    if (this._taps.length && nowMs - this._taps[this._taps.length - 1] > TAP_TIMEOUT_MS) {
      this._taps = [];
    }
    this._taps.push(nowMs);
    if (this._taps.length > 6) this._taps.shift();

    if (this._taps.length < TAPS_TO_SET) {
      this._emit({ kind: 'tap-counted', taps: this._taps.length, needed: TAPS_TO_SET });
      return null;
    }

    const gaps = [];
    for (let i = 1; i < this._taps.length; i++) gaps.push(this._taps[i] - this._taps[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];

    const bpm = clamp(Math.round(60000 / median), MIN_BPM, MAX_BPM);
    this.track.bpm = bpm;
    this._tempoSet = true;
    this._emit({ kind: 'tempo-set', bpm });
    return bpm;
  }

  /** Nudge the tempo without retapping. */
  nudgeTempo(delta) {
    this.track.bpm = clamp(this.track.bpm + delta, MIN_BPM, MAX_BPM);
    this._taps = [];
    // Nudging does not un-set the tempo. It used to, because the flag WAS the
    // tap count and this clears the taps — so a nudge sent her back to "TAP 0/4"
    // with a perfectly good tempo already in hand.
    this._tempoSet = true;
    this._emit({ kind: 'tempo-set', bpm: this.track.bpm });
    return this.track.bpm;
  }

  get tapsSoFar() {
    return this._taps.length;
  }

  get tempoIsSet() {
    return this._tempoSet;
  }

  /**
   * Throw away the tempo and go back to tapping one.
   *
   * This existed as a dead end: once four taps had landed there was no route
   * back, so a child who tapped something too fast could only escape by
   * reloading the page — which she would never think to do. The very first
   * thing she does was the one thing she could not undo.
   */
  clearTempo() {
    this._taps = [];
    this._tempoSet = false;
    this._emit({ kind: 'tempo-cleared' });
  }

  /**
   * May she retap right now?
   *
   * Only before anything has been kept. Changing tempo later would move notes
   * that have already been recorded against the old one, and the clock refuses
   * to retune while running for exactly that reason — so the offer is withdrawn
   * rather than the request being refused after she makes it.
   */
  get canRetapTempo() {
    return this.state === 'tempo' && this.tempoIsSet && this.track.accepted.size === 0;
  }

  // -------------------------------------------------------------------------
  // The transport
  // -------------------------------------------------------------------------

  /** START — begin the count-in for the current round. */
  begin(atStep) {
    if (this.state === 'recording') return false;
    this.state = 'counting';
    this.countInEndsAtStep = atStep;
    this._emit({ kind: 'counting-in', roundId: this.round.id });
    return true;
  }

  /** Called as the clock passes; flips counting into recording at the right bar. */
  tick(atStep) {
    if (this.state === 'counting' && atStep >= this.countInEndsAtStep) {
      this.state = 'recording';
      this._emit({ kind: 'recording', roundId: this.round.id });
    }
  }

  /**
   * STOP — keep what she played and move on.
   *
   * Refuses an empty round rather than accepting silence: pressing stop with
   * nothing recorded almost always means she pressed the wrong thing, and
   * "accepting" it would advance her past a round she never played.
   */
  stop() {
    if (this.state !== 'recording') return false;
    const id = this.round.id;
    if (this.track.count(id) === 0) {
      this._emit({ kind: 'nothing-to-keep' });
      return false;
    }

    this.track.accept(id);
    this._emit({ kind: 'round-kept', roundId: id, index: this.roundIndex });

    if (this.roundIndex + 1 < ROUNDS.length) {
      this.roundIndex++;
      this.state = 'tempo'; // idle, waiting for START — the tempo is already set
      this._emit({ kind: 'next-round', roundId: this.round.id, index: this.roundIndex });
    } else {
      this.state = 'done';
      this._emit({ kind: 'all-done' });
    }
    return true;
  }

  /**
   * Stop everything without keeping or throwing anything away.
   *
   * Distinct from STOP, which keeps a round and moves on, and from RESET, which
   * empties one. This is just "be quiet" — the track is untouched and she picks
   * up wherever she likes. Anything she had already recorded in this round
   * stays recorded; she simply is not recording any more.
   */
  halt() {
    this.state = 'tempo';
    this._emit({ kind: 'halted' });
    return true;
  }

  /** RESET — throw this round away and go again. Never touches earlier rounds. */
  reset() {
    const id = this.round.id;
    this.track.clear(id);
    this.state = 'tempo';
    this._emit({ kind: 'round-reset', roundId: id });
    return true;
  }

  /** Jump back to a round she has already done, to play it again. */
  goTo(index) {
    if (index < 0 || index > this.furthestReachable()) return false;
    this.roundIndex = index;
    this.state = 'tempo';
    this._emit({ kind: 'round-changed', roundId: this.round.id, index });
    return true;
  }

  /** She can reach every accepted round, plus the next one along. */
  furthestReachable() {
    let i = 0;
    while (i < ROUNDS.length && this.track.accepted.has(ROUNDS[i].id)) i++;
    return Math.min(i, ROUNDS.length - 1);
  }

  /** A shared track arrives finished, so every round is hers to revisit. */
  openEverything() {
    for (const r of ROUNDS) if (this.track.count(r.id) > 0) this.track.accept(r.id);
    this.roundIndex = 0;
    this.state = 'tempo';
    // IT ARRIVED WITH ITS TEMPO. Whoever made this chose a speed and it travelled
    // in the link, so asking the person they sent it to for four taps before it
    // will play is asking them to invent something they were given.
    this._tempoSet = true;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
