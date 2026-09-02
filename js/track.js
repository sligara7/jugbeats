// The track (comp:track) — her music as plain data.
//
// Provides iface:the-track. Plain values throughout: no objects that hold
// behaviour, no reference to the clock or the audio engine. Whatever this holds
// has to be expressible in the link format without translation, because this is
// the thing that gets packed into a URL and sent to someone.
//
// Governed by dec:two-thumbs-loop-pedal — two lanes per round, built up one
// round at a time — and by dec:one-clock, since recording happens after the
// sound has already played, never between her thumb and her ear.

export const STEPS_PER_BAR = 16;

/** Two lanes. One per thumb (dec:two-thumbs-loop-pedal). */
export const LANES = 2;

/**
 * The grid she can land on, in sixteenths. 2 = eighth notes.
 *
 * A playability decision, not a musical one: at 138bpm two adjacent sixteenths
 * are 108ms apart, which is not hard but impossible. Eighths put the tightest
 * spacing at ~217ms. The loop still RUNS on sixteenths so swing has somewhere
 * to sit between the eighths; she just cannot land on the in-between ones.
 */
export const GRID = 2;

/**
 * Snap a continuous playhead position to the grid she can land on.
 *
 * EXPORTED SO THERE IS EXACTLY ONE OF THESE. It was once done in two places
 * with two different roundings, and where they disagreed a note sounded twice.
 */
export function quantise(atStep) {
  return Math.round(atStep / GRID) * GRID;
}

/**
 * The rounds, in the order she plays them (dec:two-thumbs-loop-pedal).
 *
 * Two sounds each, one per thumb. Kick and snare first because those two alone
 * ARE a beat and everything else is decoration. Hats and cowbell second because
 * that is what arrives next in the phonk she listens to — a tom would have made
 * it a drum lesson (dec:idea-which-two-sounds-per-round).
 *
 * `sustains` is whether holding a key means anything. You do not hold a drum:
 * a drum is a struck object and its length is its own. A pitched note has a
 * length the player chooses, which is what holding is for.
 *
 * `click` marks the round the metronome is needed for. It retires after round
 * one, because from then on her own beat is the click.
 */
export const ROUNDS = [
  {
    id: 'r1', label: 'Beat', full: 'Kick & Snare', sustains: false, click: true,
    lanes: [{ voice: 'kick', name: 'KICK' }, { voice: 'snare', name: 'SNARE' }],
  },
  {
    id: 'r2', label: 'Hats', full: 'Hats & Cowbell', sustains: false, click: false,
    lanes: [{ voice: 'hat', name: 'HAT' }, { voice: 'cowbell', name: 'BELL' }],
  },
  // The degrees below index into the MINOR PENTATONIC: 0 root, 1 flat third,
  // 2 fourth, 3 fifth, 4 flat seventh. Every pair of those is consonant, which
  // is what will let her press two at once and never hear a mistake
  // (dec:pentatonic-for-chords).
  {
    id: 'r3', label: '808', full: 'The 808', sustains: true, click: false,
    // Root and fifth — the two notes most bass lines are actually made of.
    lanes: [{ voice: 'bass', degree: 0, name: 'LOW' }, { voice: 'bass', degree: 3, name: 'HIGH' }],
  },
  {
    id: 'r4', label: 'Melody', full: 'The Melody', sustains: true, click: false,
    // Root and flat third — the minor third is the phonk interval.
    lanes: [{ voice: 'lead', degree: 0, name: 'ONE' }, { voice: 'lead', degree: 1, name: 'TWO' }],
  },
];

export const roundById = (id) => ROUNDS.find((r) => r.id === id);

export class Track {
  /** @param {{bars?: number}} opts */
  constructor({ bars = 2 } = {}) {
    this.bars = bars;
    /** events[roundId] = Set of "slot*LANES + lane". A Set so a double tap on
     *  the same slot is idempotent rather than a stack of identical notes. */
    this.events = Object.fromEntries(ROUNDS.map((r) => [r.id, new Set()]));
    /** Which rounds she has accepted with STOP. Only these play back. */
    this.accepted = new Set();
    /** Her shaping numbers, per pitched instrument. Small, flat, link-sized. */
    this.shaping = { bass: {}, lead: {} };
    /** The tempo she tapped. Part of the track: it is hers, not the game's. */
    this.bpm = 100;
  }

  get loopSteps() {
    return this.bars * STEPS_PER_BAR;
  }

  /**
   * Record a tap. Rounded to the nearest eighth — generous and symmetric, since
   * quantising late-only would teach her to rush.
   */
  record(roundId, lane, atStep) {
    const slot = ((quantise(atStep) % this.loopSteps) + this.loopSteps) % this.loopSteps;
    this.events[roundId]?.add(slot * LANES + lane);
    return slot;
  }

  /** Out-of-range is refused rather than clamped: a silently clamped note lands
   *  on the wrong beat and sounds like a timing bug. */
  erase(roundId, lane, slot) {
    if (slot < 0 || slot >= this.loopSteps) throw new RangeError(`step ${slot} outside loop`);
    this.events[roundId]?.delete(slot * LANES + lane);
  }

  lanesAt(roundId, slot) {
    const out = [];
    const set = this.events[roundId];
    if (!set) return out;
    for (let lane = 0; lane < LANES; lane++) if (set.has(slot * LANES + lane)) out.push(lane);
    return out;
  }

  notes(roundId) {
    const out = [];
    for (const v of this.events[roundId] ?? []) {
      out.push({ slot: Math.floor(v / LANES), lane: v % LANES });
    }
    return out;
  }

  /**
   * The notes of a round as HELD BLOCKS — consecutive slots merged into one run.
   *
   * On a round that does not sustain, every note is its own block: merging two
   * kicks would draw a sustain that cannot be played and cannot be heard.
   * Runs do not wrap the end of the loop; a block that vanished off the bottom
   * and reappeared at the top would be harder to read than the two it replaced.
   */
  runs(roundId) {
    const set = this.events[roundId];
    const out = [];
    if (!set) return out;

    if (!roundById(roundId)?.sustains) {
      for (const { slot, lane } of this.notes(roundId)) out.push({ lane, start: slot, length: GRID });
      return out;
    }

    for (let lane = 0; lane < LANES; lane++) {
      let start = null;
      let last = null;
      for (let slot = 0; slot < this.loopSteps; slot += GRID) {
        if (set.has(slot * LANES + lane)) {
          if (start === null) start = slot;
          last = slot;
        } else if (start !== null) {
          out.push({ lane, start, length: last - start + GRID });
          start = null;
        }
      }
      if (start !== null) out.push({ lane, start, length: last - start + GRID });
    }
    return out;
  }

  /**
   * Does a held block BEGIN here? The scheduler fires only where this is true,
   * so a run sounds once and rings rather than retriggering on every step.
   */
  isRunStart(roundId, lane, slot) {
    const set = this.events[roundId];
    if (!set || !set.has(slot * LANES + lane)) return false;
    if (!roundById(roundId)?.sustains) return true;

    // A lane held the whole way round has no gap to start after, so give it one
    // — otherwise it is occupied everywhere and sounds nowhere.
    const filled = this.loopSteps / GRID;
    let n = 0;
    for (let s = 0; s < this.loopSteps; s += GRID) if (set.has(s * LANES + lane)) n++;
    if (n === filled) return slot === 0;

    const prev = ((slot - GRID) % this.loopSteps + this.loopSteps) % this.loopSteps;
    return !set.has(prev * LANES + lane);
  }

  count(roundId) {
    return this.events[roundId]?.size ?? 0;
  }

  clear(roundId) {
    this.events[roundId]?.clear();
    this.accepted.delete(roundId);
  }

  accept(roundId) {
    if (this.count(roundId) > 0) this.accepted.add(roundId);
  }

  isEmpty() {
    return ROUNDS.every((r) => this.count(r.id) === 0);
  }

  /** Plain snapshot — exactly what the link codec serialises. */
  toJSON() {
    return {
      bars: this.bars,
      bpm: this.bpm,
      events: Object.fromEntries(
        Object.entries(this.events).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])
      ),
      accepted: [...this.accepted],
      shaping: this.shaping,
    };
  }

  static fromJSON(data) {
    const t = new Track({ bars: data?.bars ?? 2 });
    t.bpm = data?.bpm ?? 100;
    for (const [id, list] of Object.entries(data?.events ?? {})) {
      if (t.events[id]) for (const v of list) t.events[id].add(v);
    }
    for (const id of data?.accepted ?? []) t.accepted.add(id);
    Object.assign(t.shaping, data?.shaping ?? {});
    return t;
  }
}
