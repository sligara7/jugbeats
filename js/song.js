// The song (dec:a-segment-is-a-whole-track) — an ordered list of segments.
//
// THE MECHANISM req:learn-song-structure HAS BEEN WAITING FOR. That requirement
// has been accepted since before any of this existed — "she comes away knowing
// music moves over time, intro, build, drop, loop, and can arrange her bars into
// an actual little song rather than one repeating pattern" — and nothing in the
// game could do it. Every other thing the game teaches had something behind it.
// This one had nothing.
//
// A SEGMENT IS A WHOLE TRACK, which is the owner's call from three shapes. The
// cheaper ones made a segment a mask over one recording — the same notes with
// different layers muted — and that is genuinely how a lot of arranging works.
// It also forecloses, permanently, a chorus whose MELODY is different, and this
// palette's heavy half is a different riff rather than a louder verse. Whole
// tracks cost more of everything and can do that; masks cannot, at any price.
//
// PATTERNS AND AN ORDER LIST, which is how every tracker since the 1980s, every
// drum machine and Ableton's session view all work. It is the whole economics
// of the feature: a verse used twice is STORED once and REFERENCED twice, so a
// song costs as many segments as are actually different rather than as many as
// are played. ABABCB is three segments and six references.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: decide anything about sound, time or
// the screen. It is the arrangement as data, and it holds no clock, no palette
// lookup and no audio. Playback asks it what is sounding at a given step; the
// codec asks it for its parts.

/**
 * An ordered arrangement of segments.
 *
 * `segments` are the unique recordings. `order` indexes into them, so the same
 * segment can appear as often as it likes for one byte a time.
 */
export class Song {
  constructor({ segments = [], order = null } = {}) {
    this.segments = segments;
    // A song with no order stated plays its segments once each, in the order
    // they were made. That is what a person means by "I made these".
    this.order = order ?? segments.map((_, i) => i);
  }

  /** The one-segment case, which is every track this game has ever made. */
  static of(track) {
    return new Song({ segments: [track], order: [0] });
  }

  get isSingle() {
    return this.segments.length === 1 && this.order.length === 1;
  }

  /** Every segment actually referenced, in playing order. */
  get playlist() {
    return this.order.map((i) => this.segments[i]).filter(Boolean);
  }

  /** How long one segment plays: its own longest round. */
  lengthOf(index) {
    return this.segments[index]?.maxLoopSteps ?? 0;
  }

  /** How long the whole song is, in steps, before it comes round again. */
  get totalSteps() {
    return this.order.reduce((n, i) => n + this.lengthOf(i), 0);
  }

  /**
   * WHICH SEGMENT IS SOUNDING, and where inside it — the one question playback
   * asks.
   *
   * The local step restarts at zero for every entry in the order, which is not
   * a detail: each round inside a segment wraps at its OWN length
   * (dec:layers-of-different-lengths), and a three-bar bass under four-bar drums
   * only drifts correctly if the segment's own clock starts where the segment
   * does. Feeding it an absolute step would make the polymeter depend on what
   * came before it in the song.
   *
   * Returns null for an empty song rather than a fake segment, because a caller
   * that would silently play nothing is a caller that should say so.
   */
  at(absStep) {
    const total = this.totalSteps;
    if (!total) return null;
    let n = ((absStep % total) + total) % total;
    for (let slot = 0; slot < this.order.length; slot++) {
      const index = this.order[slot];
      const len = this.lengthOf(index);
      if (n < len) {
        return { segment: this.segments[index], index, slot, localStep: n };
      }
      n -= len;
    }
    return null;                       // unreachable while lengths are positive
  }

  /** Where in the song a slot of the order begins, in absolute steps. */
  startOf(slot) {
    let n = 0;
    for (let i = 0; i < slot && i < this.order.length; i++) n += this.lengthOf(this.order[i]);
    return n;
  }

  /** Add a new unique segment and play it once, at the end. */
  add(track) {
    this.segments.push(track);
    this.order.push(this.segments.length - 1);
    return this.segments.length - 1;
  }

  /** Play an existing segment again — one more entry in the order, no new
   *  recording and no new bytes beyond the reference itself. */
  repeat(index) {
    if (index < 0 || index >= this.segments.length) return false;
    this.order.push(index);
    return true;
  }

  /** Take a slot out of the order. The segment survives if anything else still
   *  references it; a segment nothing plays is kept, because she recorded it. */
  removeSlot(slot) {
    if (slot < 0 || slot >= this.order.length) return false;
    this.order.splice(slot, 1);
    return true;
  }

  toJSON() {
    return { order: [...this.order], segments: this.segments.map((s) => s.toJSON()) };
  }
}
