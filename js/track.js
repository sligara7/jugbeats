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

import { PROGRESSION, MINOR_PENTATONIC as DEFAULT_SCALE } from './dsp.js';

export const STEPS_PER_BAR = 16;

export { PROGRESSION };

/**
 * Which chord is sounding at an absolute step.
 *
 * Keyed to ABSOLUTE time rather than to any round's loop, because the
 * progression belongs to the piece rather than to a layer. That has a lovely
 * consequence once rounds are different lengths: a three-bar bass under a
 * four-bar progression plays the same recorded note over a different chord each
 * time round, so one phrase keeps meaning something new. The pentatonic is what
 * makes that safe rather than lucky.
 */
export function chordAt(absStep) {
  const bar = Math.floor(absStep / STEPS_PER_BAR);
  return ((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length;
}

/**
 * The most lanes any round has. Used as a fixed STRIDE when packing notes, so
 * every round encodes the same way whether it has two lanes or four — a couple
 * of wasted bits per step buys one code path and one link format.
 *
 * How many lanes a round ACTUALLY has is `round.lanes.length`, and that varies:
 * two on the drums, four on the pitched rounds (dec:more-notes-on-the-pitched-rounds).
 */
export const LANE_STRIDE = 4;


/**
 * The grid she can land on, in sixteenths. 2 = eighth notes.
 *
 * A playability decision, not a musical one: at 138bpm two adjacent sixteenths
 * are 108ms apart, which is not hard but impossible. Eighths put the tightest
 * spacing at ~217ms. The loop still RUNS on sixteenths so swing has somewhere
 * to sit between the eighths; she just cannot land on the in-between ones.
 */
export const GRID = 2;

/** The finest a round may go: sixteenths. One grid step, no subdivision left. */
export const FINE_GRID = 1;

/**
 * Snap a continuous playhead position to the grid she can land on.
 *
 * EXPORTED SO THERE IS EXACTLY ONE OF THESE. It was once done in two places
 * with two different roundings, and where they disagreed a note sounded twice.
 * The grid is now per round, so it is passed in rather than assumed.
 */
export function quantise(atStep, grid = GRID) {
  if (!Array.isArray(grid)) return Math.round(atStep / grid) * grid;
  // A RHYTHM LOCK: the grid is a list of positions in the bar rather than a
  // spacing, so snapping means finding the nearest one. Neighbouring bars are
  // searched too, because the nearest allowed position to a tap just before the
  // barline is in the NEXT bar.
  let best = 0;
  let bestD = Infinity;
  const bar = Math.floor(atStep / STEPS_PER_BAR);
  for (let b = bar - 1; b <= bar + 1; b++) {
    for (const slot of grid) {
      const abs = b * STEPS_PER_BAR + slot;
      const d = Math.abs(abs - atStep);
      if (d < bestD) { bestD = d; best = abs; }
    }
  }
  return best;
}

/**
 * May a note land on this slot?
 *
 * A grid is EITHER a spacing — 2 for eighths, 1 for sixteenths — OR a list of
 * allowed positions within the bar. The second is a RHYTHM LOCK, and it is the
 * same idea as the scale lock applied to time: the pentatonic means she cannot
 * play a wrong note because the lanes will not offer her one, and a rhythm lock
 * means she cannot play a wrong beat because the grid will not accept one
 * (dec:idea-reggaeton-palette).
 */
export function onGrid(slot, grid) {
  if (!Array.isArray(grid)) return slot % grid === 0;
  const inBar = ((slot % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
  return grid.includes(inBar);
}

/**
 * How long a block sits on screen for a note on this grid.
 *
 * On a spacing that is the spacing. On a rhythm lock the gaps are uneven by
 * definition, so an eighth is used — long enough to read as a block, short
 * enough never to overlap the next allowed position, since a lock this design
 * would ship never puts two hits closer than a sixteenth apart.
 */
export const blockSteps = (grid) => (Array.isArray(grid) ? 2 : grid);

/** Is this round's rhythm fixed by its palette rather than chosen by her? */
export const isLocked = (grid) => Array.isArray(grid);

/**
 * The rounds, in the order she plays them (dec:two-thumbs-loop-pedal).
 *
 * OWNED BY THE PALETTE AND INJECTED INTO THE TRACK. They lived here as a module
 * global for one session — `export let ROUNDS` with a setter — which worked
 * because ES module live bindings meant no importer had to change. That apparent
 * cheapness was the whole problem: every consumer silently depended on state
 * somebody else had set, which is exactly what injection exists to prevent.
 *
 * Two sounds per round, one per thumb. `sustains` is whether holding a key means
 * anything: you do not hold a drum, but you do hold a singing bowl, which is why
 * it belongs to the instrument rather than to the round position. `click` marks
 * the round the metronome is needed for; it retires after round one, because
 * from then on her own beat is the click. `grid` is optional and may be a
 * spacing or a rhythm lock.
 */
export const DEFAULT_ROUNDS = [
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

/**
 * The shape a palette has to have for a Track to use it — the protocol, stated
 * where it is consumed rather than where it is declared.
 *
 * Checked rather than trusted, because JavaScript has no way to declare it and
 * a palette with a missing field would otherwise fail somewhere far away and
 * much later.
 */
export function checkPalette(palette) {
  if (!palette || !Array.isArray(palette.rounds)) {
    throw new TypeError('a palette must have a rounds array');
  }
  if (palette.rounds.length !== DEFAULT_ROUNDS.length) {
    throw new Error(`a palette must define exactly ${DEFAULT_ROUNDS.length} rounds`);
  }
  if (!Array.isArray(palette.scale) || palette.scale.length < 2) {
    throw new TypeError('a palette must have a scale of at least two degrees');
  }
  // A LOCKED ROUND MAY NOT SUSTAIN, and this is a guard rather than a taste.
  // Held notes are walked in even steps — start, previous, how many fit — and a
  // rhythm lock has uneven gaps by definition, so the two models do not compose.
  const bad = palette.rounds.find((r) => Array.isArray(r.grid) && r.sustains);
  if (bad) {
    throw new Error(`round "${bad.id}" cannot both hold notes and lock its rhythm`);
  }
  return palette;
}



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
  constructor({ bars = 4, palette } = {}) {
    /**
     * WHICH STYLE THIS TRACK IS, injected rather than reached for.
     *
     * The track is where a palette actually bites — its rounds are the lanes,
     * its scale is the pitches, its grids are where a note may land — and every
     * other part of the game already receives a track. So handing the palette to
     * the track hands it to session, link and midi for nothing.
     */
    this.palette = checkPalette(palette ?? { rounds: DEFAULT_ROUNDS, scale: DEFAULT_SCALE, id: 0 });
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
    this.roundBars = Object.fromEntries(this.rounds.map((r) => [r.id, bars]));

    /**
     * How fine a grid each round may land on (dec:idea-finer-notes-per-round).
     *
     * Eighths everywhere by default, because that is the forgiving one: every
     * tap snaps to the nearest grid point, so halving the grid halves the
     * tolerance — from about 108ms either side to about 54ms — and a finer grid
     * records a nine-year-old's timing faithfully instead of tidying it away.
     *
     * Sixteenths are OPT-IN per round for exactly that reason, and the round
     * that wants them is the drums: a sixteenth-note snare or hat run is a
     * signature of the genre and is simply unreachable at eighths.
     *
     * SIXTEENTHS COME OUT SHUFFLED, NOT EVEN, and that is deliberate rather
     * than overlooked. Swing leans the "and" of each beat, so at 100bpm a
     * sixteenth run measures 150, 198, 102, 150ms — a long:short of 66:34,
     * which is within a hair of a triplet shuffle. That is not a lurch, it is
     * the shuffled-sixteenth feel hip-hop and phonk are built on. Straightening
     * them would mean the clock answering two questions about when a step is,
     * and it would take the swing off her kick as well, since kick and snare
     * share a round.
     */
    // FROM THE PALETTE'S OWN ROUNDS. A round may declare a rhythm lock — a list of
    // positions rather than a spacing — and ROUNDS is already whichever palette
    // this is, so the default arrives without Track having to know about palettes.
    this.roundGrid = Object.fromEntries(this.rounds.map((r) => [r.id, r.grid ?? GRID]));
    /** events[roundId] = Set of "slot*LANE_STRIDE + lane". A Set so a double tap on
     *  the same slot is idempotent rather than a stack of identical notes. */
    this.events = Object.fromEntries(this.rounds.map((r) => [r.id, new Set()]));
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

  /** The rounds this track is played in — the palette's, not a global's. */
  get rounds() { return this.palette.rounds; }

  /** The scale its pitched lanes are locked to. */
  get scale() { return this.palette.scale; }

  /** Which style it was made with. Travels in the link from v6 on. */
  get paletteId() { return this.palette.id ?? 0; }

  /** One round by id. */
  roundById(roundId) { return this.rounds.find((r) => r.id === roundId); }

  /** How many keys this round puts under her thumbs. */
  laneCount(roundId) { return this.roundById(roundId)?.lanes.length ?? 0; }

  /** The grid this round lands on, in sixteenths. 2 = eighths, 1 = sixteenths. */
  gridFor(roundId) {
    return this.roundGrid[roundId] ?? GRID;
  }

  /**
   * Set a round's grid. Coarsening is NON-DESTRUCTIVE in the same way
   * shortening is: notes on the in-between steps stay stored and simply stop
   * being reported, so going back to sixteenths brings them all back.
   */
  setGrid(roundId, grid) {
    if (!(roundId in this.roundGrid)) return false;
    // A LOCKED ROUND DOES NOT TOGGLE. Its rhythm belongs to the palette, not to
    // the track, so neither she nor a decoded link may talk it out of it — a
    // reggaetón round that could be switched to plain eighths would stop being
    // reggaetón and nothing would say why.
    if (isLocked(this.roundGrid[roundId])) return false;
    this.roundGrid[roundId] = grid === FINE_GRID ? FINE_GRID : GRID;
    return true;
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
    return Math.max(...this.rounds.map((r) => this.loopStepsFor(r.id)));
  }

  /**
   * When every round lines up again — the lowest common multiple of their
   * lengths. Four fours meet every four bars; a three among them makes it
   * twelve. This is the number that decides whether polymeter reads as a
   * pattern or as the game being broken.
   */
  get compositeBars() {
    return this.rounds.map((r) => this.barsFor(r.id)).reduce(lcm, 1);
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
    const slot = ((quantise(atStep, this.gridFor(roundId)) % loop) + loop) % loop;
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
    for (let lane = 0; lane < this.laneCount(roundId); lane++) if (set.has(slot * LANE_STRIDE + lane)) out.push(lane);
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
    const grid = this.gridFor(roundId);
    for (const v of this.events[roundId] ?? []) {
      const slot = Math.floor(v / LANE_STRIDE);
      // A note on an in-between step is kept but not reported while the round
      // is coarse, so coarsening never destroys anything.
      if (slot < loop && onGrid(slot, grid)) out.push({ slot, lane: v % LANE_STRIDE });
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

    const grid = this.gridFor(roundId);
    if (!this.roundById(roundId)?.sustains) {
      for (const { slot, lane } of this.notes(roundId)) out.push({ lane, start: slot, length: blockSteps(grid) });
      return out;
    }

    for (let lane = 0; lane < this.laneCount(roundId); lane++) {
      let start = null;
      let last = null;
      for (let slot = 0; slot < this.loopStepsFor(roundId); slot += grid) {
        if (set.has(slot * LANE_STRIDE + lane)) {
          if (start === null) start = slot;
          last = slot;
        } else if (start !== null) {
          out.push({ lane, start, length: last - start + grid });
          start = null;
        }
      }
      if (start !== null) out.push({ lane, start, length: last - start + grid });
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
    const grid = this.gridFor(roundId);
    if (!onGrid(slot, grid)) return false; // not on this round's grid at all
    if (!this.roundById(roundId)?.sustains) return true;

    // A lane held the whole way round has no gap to start after, so give it one
    // — otherwise it is occupied everywhere and sounds nowhere.
    const loop = this.loopStepsFor(roundId);
    const filled = loop / grid;
    let n = 0;
    for (let s = 0; s < loop; s += grid) if (set.has(s * LANE_STRIDE + lane)) n++;
    if (n === filled) return slot === 0;

    const prev = ((slot - grid) % loop + loop) % loop;
    return !set.has(prev * LANE_STRIDE + lane);
  }

  /** Notes currently inside the loop — what she can actually hear. */
  /**
   * How long the run STARTING at this slot is, in steps — 0 if none starts here.
   *
   * The scheduler needs this to sound a held note for the length she held it.
   * Walking forward on demand rather than caching: a loop is at most a few dozen
   * steps and this runs a handful of times per tick, so a cache would be another
   * thing to invalidate for no measurable gain.
   */
  runLengthAt(roundId, lane, slot) {
    if (!this.isRunStart(roundId, lane, slot)) return 0;
    const grid = this.gridFor(roundId);
    if (!this.roundById(roundId)?.sustains) return blockSteps(grid);
    const set = this.events[roundId];
    const loop = this.loopStepsFor(roundId);
    let n = 0;
    for (let s = slot; s < loop && set.has(s * LANE_STRIDE + lane); s += grid) n += grid;
    return n;
  }

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
    return this.rounds.every((r) => this.count(r.id) === 0);
  }

  /** Plain snapshot — exactly what the link codec serialises. */
  toJSON() {
    return {
      bars: this.bars,
      roundBars: { ...this.roundBars },
      roundGrid: { ...this.roundGrid },
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
    Object.assign(t.roundGrid, data?.roundGrid ?? {});
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
