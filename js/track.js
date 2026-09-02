// The track (comp:track) — her music as plain data.
//
// Provides iface:the-track. Plain values throughout: no objects that hold
// behaviour, no reference to the clock or the audio engine. Whatever this holds
// has to be expressible in the link format without translation, because this is
// the thing that gets packed into a URL and sent to someone.
//
// Governed by dec:two-thumbs-loop-pedal — she builds it one round at a time —
// and by dec:one-clock, since recording happens after the
// sound has already played, never between her thumb and her ear.

export const STEPS_PER_BAR = 16;

/**
 * The most lanes any round has. Used as a fixed STRIDE when packing notes, so
 * every round encodes the same way whether it has two lanes or four — a couple
 * of wasted bits per step buys one code path and one link format.
 *
 * How many lanes a round ACTUALLY has is `round.lanes.length`, and that varies:
 * two on the drums, four on the pitched rounds (dec:more-notes-on-the-pitched-rounds).
 */
export const LANE_STRIDE = 4;

/** How many keys this round puts under her thumbs. */
export const laneCount = (roundId) => roundById(roundId)?.lanes.length ?? 0;

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
  // FOUR LANES ON THE PITCHED ROUNDS, two under each thumb. Two notes is enough
  // for a bass line only in the sense that two notes is enough for a doorbell.
  //
  // This is not a return to the four-key layout that was superseded: those were
  // four different INSTRUMENTS, which is four decisions taken while also
  // deciding when. These are four positions on one instrument, which is a single
  // decision — which pitch — and is how every real instrument already works.
  //
  // Degrees index the MINOR PENTATONIC: 0 root, 1 flat third, 2 fourth,
  // 3 fifth, 4 flat seventh, 5 the octave. Every pair of them is consonant, so
  // any two she presses together sound deliberate (dec:pentatonic-for-chords).
  {
    id: 'r3', label: '808', full: 'The 808', sustains: true, click: false,
    // Root, fourth, fifth, flat seventh — the vocabulary of almost every bass
    // line ever written, with the root under her outside thumb where it belongs.
    lanes: [
      { voice: 'bass', degree: 0, name: 'ROOT' },
      { voice: 'bass', degree: 2, name: '4th' },
      { voice: 'bass', degree: 3, name: '5th' },
      { voice: 'bass', degree: 4, name: '♭7' },
    ],
  },
  {
    id: 'r4', label: 'Melody', full: 'The Melody', sustains: true, click: false,
    // The minor triad plus the octave: root, flat third, fifth, root again an
    // octave up. Any subset of that is a chord, and it spans far enough to be
    // an actual tune rather than two notes alternating.
    lanes: [
      { voice: 'lead', degree: 0, name: 'ROOT' },
      { voice: 'lead', degree: 1, name: '♭3' },
      { voice: 'lead', degree: 3, name: '5th' },
      { voice: 'lead', degree: 5, name: '8ve' },
    ],
  },
];

export const roundById = (id) => ROUNDS.find((r) => r.id === id);

export class Track {
  /**
   * @param {{bars?: number}} opts
   *
   * FOUR BARS, and this is a reversion worth labelling as one.
   *
   * It was cut from four to two because the drums were getting out of hand, and
   * that reason is now genuinely gone: the eighth-note grid stopped notes
   * arriving faster than a thumb can move, the clear button gave her a way to
   * thin a busy layer, and half of what sounded like clutter turned out to be a
   * bug that sounded every other tap twice.
   *
   * With the cause removed, two bars was only making the loop come round twice
   * as often — which is exactly what made it feel repetitive. A design that
   * never revisits a constraint once its reason has gone just accumulates them.
   */
  constructor({ bars = 4 } = {}) {
    this.bars = bars;

    /**
     * How many bars each round loops over, INDEPENDENTLY (dec:layers-of-different-lengths).
     *
     * A three-bar bass under a four-bar drum loop drifts apart and comes back
     * together every twelve bars. That is the Kashmir effect — a riff in 3/4
     * over drums in 4/4 — reached without any notion of a time signature
     * anywhere in the code. Loop length was already a number; making it a number
     * per round is a far smaller change than meter would have been, and it
     * sounds nearly identical.
     *
     * Two layers realign after the lowest common multiple of their lengths, so
     * small numbers matter: three against four meet every twelve bars, which a
     * listener hears as a pattern. Seven against eight take fifty-six, which a
     * listener hears as drift.
     */
    this.roundBars = Object.fromEntries(ROUNDS.map((r) => [r.id, bars]));
    /** events[roundId] = Set of "slot*LANE_STRIDE + lane". A Set so a double tap on
     *  the same slot is idempotent rather than a stack of identical notes. */
    this.events = Object.fromEntries(ROUNDS.map((r) => [r.id, new Set()]));
    /** Which rounds she has accepted with STOP. Only these play back. */
    this.accepted = new Set();

    /**
     * Rounds silenced right now (dec:arrangement-breathes).
     *
     * DELIBERATELY NOT SAVED AND NOT SHARED, which is the whole distinction:
     * CLEAR deletes, MUTE silences. Muting is something she does WHILE playing —
     * drop the drums out for four bars and bring them back, the way a producer
     * does — and a performance choice is not part of the composition. Whoever
     * opens her link hears everything she made; if she truly does not want a
     * layer, clearing it is the tool for that.
     *
     * It also means this costs no link-format change, which is the difference
     * between an afternoon and a version bump.
     */
    this.muted = new Set();
    /** Her shaping numbers, per pitched instrument. Small, flat, link-sized. */
    this.shaping = { bass: {}, lead: {} };
    /** The tempo she tapped. Part of the track: it is hers, not the game's. */
    this.bpm = 100;
  }

  /** Bars in one round's loop. */
  barsFor(roundId) {
    return this.roundBars[roundId] ?? this.bars;
  }

  /** Steps in one round's loop — the modulus its notes wrap at. */
  loopStepsFor(roundId) {
    return this.barsFor(roundId) * STEPS_PER_BAR;
  }

  /**
   * Set a round's length.
   *
   * NON-DESTRUCTIVE ON THE WAY DOWN. Shortening leaves notes beyond the new end
   * stored but unplayed, so lengthening again brings them back exactly. She can
   * try three bars, dislike it, and go back to four without losing anything —
   * which is the difference between an experiment and a commitment.
   */
  setBars(roundId, bars) {
    if (!(roundId in this.roundBars)) return false;
    this.roundBars[roundId] = Math.max(1, Math.min(8, Math.round(bars)));
    return true;
  }

  /** The longest round. Used for sizing, never for wrapping. */
  get maxLoopSteps() {
    return Math.max(...ROUNDS.map((r) => this.loopStepsFor(r.id)));
  }

  /**
   * When every round lines up again — the lowest common multiple of their
   * lengths. Four fours meet every four bars; a three among them makes it
   * twelve. This is the number that decides whether polymeter reads as a
   * pattern or as the game being broken.
   */
  get compositeBars() {
    return ROUNDS.map((r) => this.barsFor(r.id)).reduce(lcm, 1);
  }

  /** Kept for callers that only ever wanted somewhere to wrap; prefer
   *  loopStepsFor, which knows which round is being asked about. */
  get loopSteps() {
    return this.bars * STEPS_PER_BAR;
  }

  /**
   * Record a tap. Rounded to the nearest eighth — generous and symmetric, since
   * quantising late-only would teach her to rush.
   */
  record(roundId, lane, atStep) {
    const loop = this.loopStepsFor(roundId);
    const slot = ((quantise(atStep) % loop) + loop) % loop;
    this.events[roundId]?.add(slot * LANE_STRIDE + lane);
    return slot;
  }

  /** Out-of-range is refused rather than clamped: a silently clamped note lands
   *  on the wrong beat and sounds like a timing bug. */
  erase(roundId, lane, slot) {
    if (slot < 0 || slot >= this.loopStepsFor(roundId)) {
      throw new RangeError(`step ${slot} outside this round's loop`);
    }
    this.events[roundId]?.delete(slot * LANE_STRIDE + lane);
  }

  lanesAt(roundId, slot) {
    const out = [];
    const set = this.events[roundId];
    if (!set) return out;
    for (let lane = 0; lane < laneCount(roundId); lane++) if (set.has(slot * LANE_STRIDE + lane)) out.push(lane);
    return out;
  }

  /**
   * The notes of a round that are INSIDE its current loop.
   *
   * Shortening a round leaves its far notes stored but out of range; they are
   * filtered here rather than deleted, so lengthening brings them back exactly.
   */
  notes(roundId) {
    const out = [];
    const loop = this.loopStepsFor(roundId);
    for (const v of this.events[roundId] ?? []) {
      const slot = Math.floor(v / LANE_STRIDE);
      if (slot < loop) out.push({ slot, lane: v % LANE_STRIDE });
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

    for (let lane = 0; lane < laneCount(roundId); lane++) {
      let start = null;
      let last = null;
      for (let slot = 0; slot < this.loopStepsFor(roundId); slot += GRID) {
        if (set.has(slot * LANE_STRIDE + lane)) {
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
    if (!set || !set.has(slot * LANE_STRIDE + lane)) return false;
    if (!roundById(roundId)?.sustains) return true;

    // A lane held the whole way round has no gap to start after, so give it one
    // — otherwise it is occupied everywhere and sounds nowhere.
    const loop = this.loopStepsFor(roundId);
    const filled = loop / GRID;
    let n = 0;
    for (let s = 0; s < loop; s += GRID) if (set.has(s * LANE_STRIDE + lane)) n++;
    if (n === filled) return slot === 0;

    const prev = ((slot - GRID) % loop + loop) % loop;
    return !set.has(prev * LANE_STRIDE + lane);
  }

  /** Notes currently inside the loop — what she can actually hear. */
  count(roundId) {
    return this.notes(roundId).length;
  }

  clear(roundId) {
    this.events[roundId]?.clear();
    this.accepted.delete(roundId);
    // An emptied round has nothing to silence, and leaving it muted would mean
    // she rebuilds it and hears nothing.
    this.muted.delete(roundId);
  }

  accept(roundId) {
    if (this.count(roundId) > 0) this.accepted.add(roundId);
  }

  isMuted(roundId) {
    return this.muted.has(roundId);
  }

  /** Silence a kept round, or bring it back. Only kept rounds can be muted —
   *  there is nothing to silence in one she has not finished. */
  toggleMute(roundId) {
    if (!this.accepted.has(roundId)) return false;
    if (this.muted.has(roundId)) this.muted.delete(roundId);
    else this.muted.add(roundId);
    return this.muted.has(roundId);
  }

  isEmpty() {
    return ROUNDS.every((r) => this.count(r.id) === 0);
  }

  /** Plain snapshot — exactly what the link codec serialises. */
  toJSON() {
    return {
      bars: this.bars,
      roundBars: { ...this.roundBars },
      bpm: this.bpm,
      events: Object.fromEntries(
        Object.entries(this.events).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])
      ),
      accepted: [...this.accepted],
      shaping: this.shaping,
    };
  }

  static fromJSON(data) {
    const t = new Track({ bars: data?.bars ?? 4 });
    t.bpm = data?.bpm ?? 100;
    Object.assign(t.roundBars, data?.roundBars ?? {});
    for (const [id, list] of Object.entries(data?.events ?? {})) {
      if (t.events[id]) for (const v of list) t.events[id].add(v);
    }
    for (const id of data?.accepted ?? []) t.accepted.add(id);
    Object.assign(t.shaping, data?.shaping ?? {});
    return t;
  }
}

/** Greatest common divisor, and from it the lowest common multiple — the number
 *  of bars after which two loops of different lengths line up again. */
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a, b) {
  return (a * b) / gcd(a, b);
}
