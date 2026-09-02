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
 * The layers, in the order the keys hand over. Each names what its four lanes
 * play. Drums map to baked voices; bass and lead map to scale degrees.
 *
 * Four lanes each, because there are four keys (dec:four-keys-two-thumbs).
 */
export const LAYERS = [
  { id: 'drums', label: 'Drums', lanes: ['kick', 'snare', 'hat', 'cowbell'] },
  { id: 'bass',  label: '808',   lanes: [0, 2, 3, 4] },   // root, ♭3, 4, 5
  { id: 'lead',  label: 'Melody', lanes: [0, 4, 5, 7] },  // root, 5, ♭6, octave
];

export class Track {
  /** @param {{bars?: number}} opts */
  constructor({ bars = 4 } = {}) {
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
   * it is rounded to the nearest sixteenth, which is what makes a nine-year-old
   * sound like she can play. Rounding is deliberately generous and symmetric:
   * quantising late-only would teach her to rush.
   *
   * Returns the loop step it landed on, so the stage can flash the right slot.
   */
  record(layerId, lane, atStep) {
    const slot = ((Math.round(atStep) % this.loopSteps) + this.loopSteps) % this.loopSteps;
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

  /** All notes in a layer as {slot, lane} — what the stage draws. */
  notes(layerId) {
    const out = [];
    for (const v of this.events[layerId] ?? []) out.push({ slot: (v / 4) | 0, lane: v % 4 });
    return out;
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
