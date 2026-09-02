// The track (comp:track) — her music as plain data.
//
// Provides iface:the-track. Plain values throughout: no objects that hold
// behaviour, no reference to the clock or the audio engine. Whatever this holds
// has to be expressible in the link format without translation, because this is
// the thing that gets packed into a URL and sent to someone.
//
// Governed by dec:one-clock — recording happens AFTER the sound has already
// played, never between her thumb and her ear — and by dec:layers-advance-the-keys,
// which is where the layer list comes from.

export const STEPS_PER_BAR = 16;

/**
 * The grid she can actually place notes on, in sixteenths. 2 = eighth notes.
 *
 * THIS IS A PLAYABILITY DECISION, NOT A MUSICAL ONE (dec:play-on-eighths). The
 * first build quantised to sixteenths, and at 138bpm two adjacent sixteenths are
 * 108 milliseconds apart — the owner's verdict on playing it was that blocks
 * arriving straight after each other were impossible to play, which was exactly
 * right. Eighths put the tightest possible spacing at ~217ms, which a
 * nine-year-old's thumb can actually hit.
 *
 * The loop still RUNS on sixteenths, because swing needs somewhere to sit
 * between the eighths. She just cannot land on the in-between ones.
 */
export const GRID = 2;

/**
 * Snap a continuous playhead position to the grid she can land on.
 *
 * EXPORTED SO THERE IS EXACTLY ONE OF THESE. It was previously done in two
 * places with two different roundings — the track to the nearest eighth, the
 * shell's double-trigger guard to the nearest sixteenth — and the moment they
 * disagreed the guard was filed against a step the note does not live on, so
 * the note sounded twice. Anything that needs to know which step a moment
 * belongs to calls this.
 */
export function quantise(atStep) {
  return Math.round(atStep / GRID) * GRID;
}

/**
 * The layers, in the order the keys hand over. Each names what its four lanes
 * play. Drums map to baked voices; bass and lead map to scale degrees.
 *
 * Four lanes each, because there are four keys (dec:four-keys-two-thumbs).
 *
 * `sustains` is whether holding a key means anything on that layer. It does not
 * for drums, and the owner put it plainly: you do not hold a drum. A kick is a
 * struck object — it has one length, its own — so consecutive kicks stay
 * separate hits and holding the key does nothing at all. An 808 and a melody
 * note DO have a length you choose, which is exactly what holding is for.
 */
export const LAYERS = [
  { id: 'drums', label: 'Drums', lanes: ['kick', 'snare', 'hat', 'cowbell'], sustains: false },
  { id: 'bass',  label: '808',   lanes: [0, 2, 3, 4],  sustains: true },  // root, ♭3, 4, 5
  { id: 'lead',  label: 'Melody', lanes: [0, 4, 5, 7], sustains: true },  // root, 5, ♭6, octave
];

const layerById = (id) => LAYERS.find((l) => l.id === id);

export class Track {
  /**
   * @param {{bars?: number}} opts
   *
   * TWO BARS, not four. Four bars is thirty-two eighth-note slots per lane and a
   * seven-second loop — far more room than a nine-year-old wants to fill, and
   * the owner's verdict on playing it was that the drums were simply too much to
   * keep up with. Two bars halves everything, and it brings her pattern back
   * round twice as often, which is most of the satisfaction of making a loop.
   */
  constructor({ bars = 2 } = {}) {
    this.bars = bars;
    /** events[layerId] = Set of encoded "step*4+lane" — a Set so a double tap
     *  on the same slot is idempotent rather than a stack of identical notes. */
    this.events = Object.fromEntries(LAYERS.map((l) => [l.id, new Set()]));
    /** Her shaping numbers, per pitched instrument. Small, flat, link-sized. */
    this.shaping = { bass: {}, lead: {} };
  }

  get loopSteps() {
    return this.bars * STEPS_PER_BAR;
  }

  /**
   * Record a tap.
   *
   * `atStep` is the continuous position the clock reported when she touched;
   * it is rounded to the nearest EIGHTH, which is what makes a nine-year-old
   * sound like she can play and — just as important — guarantees that nothing
   * she records can come back closer together than her thumb can manage.
   * Rounding is deliberately generous and symmetric: quantising late-only would
   * teach her to rush.
   *
   * Returns the loop step it landed on, so the stage can flash the right slot.
   */
  record(layerId, lane, atStep) {
    const quantised = quantise(atStep);
    const slot = ((quantised % this.loopSteps) + this.loopSteps) % this.loopSteps;
    this.events[layerId]?.add(slot * 4 + lane);
    return slot;
  }

  /** Remove a note. Out-of-range is refused rather than clamped — a silently
   *  clamped note lands on the wrong beat and sounds like a timing bug. */
  erase(layerId, lane, slot) {
    if (slot < 0 || slot >= this.loopSteps) throw new RangeError(`step ${slot} outside loop`);
    this.events[layerId]?.delete(slot * 4 + lane);
  }

  /** Every lane firing on this loop step, per layer. */
  lanesAt(layerId, slot) {
    const out = [];
    const set = this.events[layerId];
    if (!set) return out;
    for (let lane = 0; lane < 4; lane++) if (set.has(slot * 4 + lane)) out.push(lane);
    return out;
  }

  /** All notes in a layer as {slot, lane}. Raw occupancy; prefer runs(). */
  notes(layerId) {
    const out = [];
    for (const v of this.events[layerId] ?? []) out.push({ slot: (v / 4) | 0, lane: v % 4 });
    return out;
  }

  /**
   * The notes of a layer as HELD BLOCKS — consecutive slots in one lane merged
   * into a single run of {lane, start, length}.
   *
   * This is the whole answer to a problem the owner found by playing it: four
   * notes in a row read as four things to hit, and hitting four things in a row
   * is not possible. In the game she already plays they would be ONE long block
   * that you press once and hold, exactly like holding a piano key for the
   * length of the note. Same data underneath — the stored slots and therefore
   * the shared link do not change at all — but what she sees and what she has
   * to do both get simpler.
   *
   * Runs deliberately do NOT wrap around the end of the loop. A block that
   * disappeared off the bottom and reappeared at the top would be harder to read
   * than the two blocks it replaced.
   */
  runs(layerId) {
    const set = this.events[layerId];
    const out = [];
    if (!set) return out;

    // On a layer that does not sustain, every note is its own block. Merging
    // two kicks into one long one would draw a sustain that cannot be played
    // and cannot be heard.
    if (!layerById(layerId)?.sustains) {
      for (const { slot, lane } of this.notes(layerId)) out.push({ lane, start: slot, length: GRID });
      return out;
    }

    for (let lane = 0; lane < 4; lane++) {
      let start = null;
      let last = null;
      for (let slot = 0; slot < this.loopSteps; slot += GRID) {
        if (set.has(slot * 4 + lane)) {
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
   * Does a held block BEGIN on this slot?
   *
   * The scheduler fires a voice only where this is true, so a run sounds once
   * and then rings for its length rather than retriggering on every step it
   * covers. A held 808 is one long note, which is what an 808 does; a held kick
   * is one kick, which is what a kick does.
   */
  isRunStart(layerId, lane, slot) {
    const set = this.events[layerId];
    if (!set || !set.has(slot * 4 + lane)) return false;

    // Every hit on a non-sustaining layer sounds. Two kicks in a row are two
    // kicks, and always were.
    if (!layerById(layerId)?.sustains) return true;

    // A lane filled the whole way round has no gap to start after, so give it
    // one — otherwise it would be occupied everywhere and sound nowhere.
    const filled = this.loopSteps / GRID;
    let n = 0;
    for (let s = 0; s < this.loopSteps; s += GRID) if (set.has(s * 4 + lane)) n++;
    if (n === filled) return slot === 0;

    const prev = ((slot - GRID) % this.loopSteps + this.loopSteps) % this.loopSteps;
    return !set.has(prev * 4 + lane);
  }

  count(layerId) {
    return this.events[layerId]?.size ?? 0;
  }

  isEmpty() {
    return LAYERS.every((l) => this.count(l.id) === 0);
  }

  clear(layerId) {
    this.events[layerId]?.clear();
  }

  /** Plain snapshot — this is exactly what the link codec serialises. */
  toJSON() {
    return {
      bars: this.bars,
      events: Object.fromEntries(Object.entries(this.events).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
      shaping: this.shaping,
    };
  }

  static fromJSON(data) {
    const t = new Track({ bars: data?.bars ?? 4 });
    for (const [id, list] of Object.entries(data?.events ?? {})) {
      if (t.events[id]) for (const v of list) t.events[id].add(v);
    }
    Object.assign(t.shaping, data?.shaping ?? {});
    return t;
  }
}
