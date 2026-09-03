// The haunted palette (dec:idea-haunting-palette) — for Halloween.
//
// Pure like js/dsp.js and js/ethereal.js: sample rate in, Float32Array out, no
// Web Audio and no DOM, so the forge can render it to a WAV and the browser can
// fill the same buffers at load (dec:two-speed-synthesis).
//
// THE OWNER SUPPLIED THE THEORY HIMSELF, in his note on evolutionary musicology:
// shrill, dissonant, high-pitched sound reads as frightening because it mimics
// the acoustic profile of a scream or an animal distress call, and goes more or
// less straight to the amygdala. That is not decoration on this palette, it is
// the brief — it says exactly which knobs to turn.
//
// SO THIS IS THE CALM PALETTE POINTED THE OTHER WAY, and almost every mechanism
// is the same one inverted:
//
//   CALM                             HAUNTED
//   partials tuned to agree          partials tuned to BEAT against each other
//   a large warm room                a large COLD one, or none at all
//   a wordless choir                 the same voice, higher and narrower
//   consonant by construction        the tritone, on purpose
//
// ROUGHNESS IS THE MECHANISM, and it is worth naming because it is not the same
// thing as dissonance in the harmonic sense. Two partials a few cents apart beat
// against each other at a rate the ear cannot resolve into two tones, and that
// beating is heard as grinding. It is why an out-of-tune piano is unpleasant in
// a way an honest minor second is not, and it costs one number per partial.

import {
  lin, exp, shape, alloc, noiseSource, normalize, fadeOut,
  ratios as RATIOS, struck, formantBank, sawPair,
} from './synth.js';

// ---------------------------------------------------------------------------
// The struck things
// ---------------------------------------------------------------------------

/**
 * THE SAME TABLE THE CALM PALETTE USES, WITH THE RATIOS CHOSEN TO GRIND.
 *
 * Every set is normalised so its first partial is the note asked for — the same
 * rule and for the same reason: used raw, textbook bell ratios put the perceived
 * pitch nine semitones below the note, which measured that way and would break
 * the scale lock in the one voice nobody would think to check.
 *
 * `beat` is the new column and the whole idea: each partial is doubled a few
 * cents away from itself, so the pair drifts in and out of phase. 0 is clean.
 * Around 0.4% is a slow shimmer; 2% is a sound with something wrong with it.
 */
export const HAUNTED_IDIOPHONES = {
  // A music box left somewhere damp. Celesta ratios, detuned until the sweetness
  // curdles — the most recognisable "something is wrong here" sound there is,
  // because the ear knows exactly what it is supposed to sound like.
  musicbox: { m: RATIOS([1, 4.05, 9.6, 16.2]), g: [1, 0.3, 0.12, 0.05],
              d: [1, 2.2, 3.2, 4.4], attack: 0.002, decay: 4.2, beat: 0.009, peak: 0.55, dur: [2.0, 6.0], norm: 2.4 },

  // A cracked bell. The textbook inharmonic set, beating hard.
  tollbell: { m: RATIOS([0.56, 0.92, 1.19, 1.71, 2.0, 2.74, 3.76]),
              g: [1, 0.7, 0.55, 0.34, 0.28, 0.18, 0.1],
              d: [1, 1.2, 1.4, 1.9, 2.2, 2.9, 3.7], attack: 0.005, decay: 2.2, beat: 0.014, peak: 0.68, dur: [2.0, 6.0], norm: 2.4 },

  // Struck metal with no tuning at all — a pipe, a chain, a gate.
  clang:    { m: RATIOS([1, 1.41, 2.13, 3.17, 4.61]), g: [1, 0.8, 0.6, 0.35, 0.2],
              d: [1, 1.3, 1.7, 2.4, 3.2], attack: 0.001, decay: 3.4, beat: 0.02, peak: 0.6, dur: [2.0, 6.0], norm: 2.4 },

  // High, thin and piercing — the register the brief actually asks for.
  shard:    { m: RATIOS([1, 2.76, 5.4, 8.2]), g: [1, 0.5, 0.3, 0.16],
              d: [1, 1.6, 2.2, 3.0], attack: 0.001, decay: 2.0, beat: 0.006, peak: 0.42, dur: [2.0, 6.0], norm: 2.4 },
};

export function renderHauntedIdiophone(sr, hz, name, s, opts) {
  const inst = HAUNTED_IDIOPHONES[name];
  if (!inst) throw new Error(`no haunted idiophone named "${name}"`);
  return struck(sr, hz, inst, s, opts);
}

// ---------------------------------------------------------------------------
// The sustained things
// ---------------------------------------------------------------------------

/**
 * Glass harmonica — the ghost instrument, and not metaphorically.
 *
 * Franklin's rotating glass bowls, played by wet fingers. It was used for two
 * centuries specifically to portray ghosts, madness and altered states, to the
 * point where it was blamed at the time for driving its players insane. The
 * owner put it on his own crystalline list, and it is the single most on-the-nose
 * instrument available here.
 *
 * WHY IT SOUNDS DISEMBODIED: an almost pure tone with very few harmonics, a
 * swell you cannot locate the start of, and no attack transient at all. Human
 * hearing places a sound largely by its onset, so a sound with no onset does not
 * seem to come from anywhere.
 */
export function renderGlassHarmonica(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 2.2, 7.0);
  const out = alloc(sr, dur);
  const attack = lin(c.punchier, 1.4, 0.5);

  // Very few partials, and the third barely there. Glass is nearly a sine.
  const partials = [
    { m: 1, g: 1.0, d: 1.0000 },
    { m: 1, g: 0.5, d: 1.0021 },   // the friction wobble, as a slow beat
    { m: 2, g: 0.17, d: 1.0000 },
    { m: 3, g: 0.05, d: 0.9987 },
    { m: 5, g: 0.02, d: 1.0034 },
  ];
  const ph = new Float64Array(partials.length);
  let wob = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // A swell with no locatable beginning, and a long fall.
    const up = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const left = dur - t;
    const rel = dur * 0.5;
    const down = left < rel ? 0.5 - 0.5 * Math.cos((Math.PI * left) / rel) : 1;
    const env = up * down;

    // The finger never quite steadies. Slow, shallow, and slightly irregular.
    wob += (2 * Math.PI * 3.1) / sr;
    const drift = 1 + Math.sin(wob) * 0.0022 + Math.sin(wob * 0.37) * 0.0013;

    let x = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += (2 * Math.PI * hz * partials[k].m * partials[k].d * drift) / sr;
      x += Math.sin(ph[k]) * partials[k].g;
    }
    out[i] = (x / 1.75) * env;
  }
  return normalize(fadeOut(out, sr, 60), 0.6);
}

/**
 * The wail — the calm palette's breath voice, pitched up and narrowed.
 *
 * The distance between a choir and a scream is smaller than it sounds, and it is
 * mostly three things: register, formant width, and how steady the pitch is. A
 * high narrow formant over an unsteady tone is the acoustic profile the brief
 * names, and the ear does not need to be told what it is.
 *
 * KEPT ON A LEASH ON PURPOSE. The other player in this design is nine. The
 * vibrato is irregular but shallow, the attack is a swell rather than a shriek,
 * and there are no sudden onsets anywhere — sudden loud onsets are the one thing
 * that turns "fun scary" into "actually distressing", and they are the same
 * arousal mechanism the sleep work spent a whole session trying not to trip.
 */
export function renderWail(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 2.0, 6.0);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0x13ad);

  // Narrow, high formants — an "eee"-ish vowel rather than the calm "ooh".
  const formants = [
    { hz: 420, q: 16, g: 1.0 },
    { hz: 2200, q: 20, g: 0.55 },
    { hz: 3100, q: 22, g: 0.3 },
  ];
  const bank = formantBank(formants);
  const source = sawPair(1.0038);
  let v1 = 0, v2 = 0;
  const attack = lin(c.punchier, 0.8, 0.25);

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const up = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const left = dur - t;
    const rel = dur * 0.42;
    const down = left < rel ? left / rel : 1;
    const env = up * down;

    // TWO vibratos at unrelated rates, so the pitch never settles into a pattern
    // the ear can predict. One alone reads as an opera singer; two read as a
    // voice that is not in control of itself.
    v1 += (2 * Math.PI * 5.3) / sr;
    v2 += (2 * Math.PI * 1.7) / sr;
    const drift = 1 + Math.sin(v1) * 0.006 + Math.sin(v2) * 0.009;

    const src = source(hz * drift, sr) + rnd() * 0.05;
    out[i] = bank(src, sr) * env * 0.3;
  }
  return normalize(fadeOut(out, sr, 60), 0.58);
}

/**
 * The drone underneath — a cold, low sustained bed with something moving in it.
 *
 * Voiced up for the same reason everything here is (dec:drone-voiced-up): a
 * phone speaker is deaf below a few hundred hertz, and a drone written where a
 * drone belongs would eat headroom while being inaudible.
 */
export function renderDread(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 2.4, 8.0);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0x77c1);
  const attack = lin(c.punchier, 1.6, 0.6);

  // A stack with a tritone in it, which is the palette's whole harmonic idea
  // stated once in a single voice.
  const partials = [
    { m: 1, g: 1.0, d: 1.0 },
    { m: 1, g: 0.7, d: 1.006 },              // beating against itself
    { m: Math.pow(2, 6 / 12), g: 0.34, d: 1.0 },  // the tritone
    { m: 2, g: 0.3, d: 0.9965 },
    { m: 3, g: 0.12, d: 1.004 },
  ];
  const ph = new Float64Array(partials.length);
  let lp = 0, sweep = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const up = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const left = dur - t;
    const rel = dur * 0.45;
    const down = left < rel ? left / rel : 1;
    const env = up * down;

    let x = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += (2 * Math.PI * hz * partials[k].m * partials[k].d) / sr;
      x += Math.sin(ph[k]) * partials[k].g;
    }
    x = x / 2.5 + rnd() * 0.012;

    // A filter that never sits still, so the sound keeps almost-resolving into
    // something and not doing it.
    sweep += (2 * Math.PI * 0.07) / sr;
    const cutoff = exp(c.deeper, 700, 2600) * (0.55 + 0.45 * Math.sin(sweep));
    const a = 1 - Math.exp((-2 * Math.PI * Math.min(cutoff, sr * 0.45)) / sr);
    lp += a * (x * env - lp);
    out[i] = lp;
  }
  return normalize(fadeOut(out, sr, 50), 0.7);
}

/**
 * A knock. Dry, wooden, close, and with no ring at all.
 *
 * The one non-metallic thing here, and it works by contrast: everything else in
 * this palette rings for seconds in a large room, and a sound that stops dead
 * seems to be happening in the room you are actually in.
 */
export function renderKnock(sr, s) {
  const c = shape(s);
  const dur = lin(c.longer, 0.18, 0.42);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0x2b5f);
  const base = exp(c.deeper, 190, 78);
  let ph = 0, lp = 0, bp = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = Math.exp(-16 * (t / dur));
    ph += (2 * Math.PI * base * (1 + 0.9 * Math.exp(-t * 90))) / sr;
    const body = Math.sin(ph) * env;
    // The knuckle: a short burst of band-limited noise on the front.
    const rap = rnd() * Math.exp(-t * 260);
    bp += ((rap - bp) * 2 * Math.PI * 1400) / sr;
    const a = 1 - Math.exp((-2 * Math.PI * 2600) / sr);
    lp += a * (body + bp * 0.6 - lp);
    out[i] = lp * Math.min(1, t / 0.002);
  }
  return normalize(fadeOut(out, sr, 10), 0.62);
}

/**
 * The palette's tempo and room.
 *
 * SLOW, and the room is LARGE AND COLD: much less damping than the calm one, so
 * the tail keeps its high end instead of losing it the way a warm room does. A
 * bright tail is what a stone corridor sounds like, and what a living room
 * never does.
 */
export const HAUNTED = {
  bpm: 76,
  swing: 0,
  room: { size: 0.93, damp: 0.12, mix: 0.55 },
};

export const HAUNTED_VOICES = {
  glass: renderGlassHarmonica,
  wail: renderWail,
  dread: renderDread,
  knock: renderKnock,
  ...Object.fromEntries(
    Object.keys(HAUNTED_IDIOPHONES).map((name) => [
      name,
      (sr, hz, s, opts) => renderHauntedIdiophone(sr, hz, name, s, opts),
    ]),
  ),
};
