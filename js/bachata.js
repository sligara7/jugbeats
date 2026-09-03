// The bachata palette (dec:idea-bachata-palette) — for his Dominican friends.
//
// Pure like the rest: sample rate in, Float32Array out, no Web Audio and no DOM
// (dec:two-speed-synthesis).
//
// ITS IDENTITY IS THE GUITAR, NOT THE RHYTHM, and that is what separates it from
// the reggaetón palette next door. Reggaetón you recognise from the beat, which
// is why that one locks its grid. Bachata you recognise from the REQUINTO — the
// nylon-string lead sitting on top of everything — and you can get the
// percussion perfect and the guitar wrong and nobody will call it bachata.
//
// SO THIS PALETTE IS THE PLUCKED STRING, three ways. The requinto leads, the
// segunda answers it underneath, and the bass is the same model with the
// brightness taken out and a box put under it. Everything that makes them
// different instruments is four numbers: how fast the highs die, how much is
// lost each pass, where along the string the finger sits, and how dark the pluck
// itself is.
//
// THE HALF THAT IS MISSING, AND IT IS NOT THE SOUND. Bachata moves
// harmonically — real progressions, with the melody moving over them — and this
// engine holds one chord that never moves, deliberately, because an automatic
// progression once transposed notes she had already recorded
// (dec:idea-drop-the-auto-progression). So this palette has the right timbre and
// the right feel and a harmony that stays home. Chords she changes herself
// (dec:idea-manual-chords-with-a-pause) are what would finish it.

import {
  lin, exp, shape, alloc, noiseSource, normalize, fadeOut, onePole, pluck,
} from './synth.js';

// ---------------------------------------------------------------------------
// The strings
// ---------------------------------------------------------------------------

/**
 * Three guitars, as four numbers each.
 *
 * `pick` is the one worth knowing about: it is where along the string the finger
 * sits, and it comb-filters the excitation. Near the bridge — a small number —
 * cancels the low harmonics and leaves the thin nasal tone a requinto lead is
 * played with. Nearer the middle rounds it out, which is where a rhythm part
 * lives.
 */
export const STRINGS = {
  // The lead. Bright, plucked close to the bridge, and left to ring.
  requinto: { damp: 0.54, decay: 0.9977, pick: 0.12, tone: 0.66, body: 0.10,
              dur: [1.4, 4.0], peak: 0.72, seed: 0x9e1a },

  // The rhythm guitar underneath, damper and rounder so it never competes.
  segunda:  { damp: 0.44, decay: 0.9938, pick: 0.30, tone: 0.42, body: 0.16,
              dur: [0.8, 2.4], peak: 0.6, seed: 0x2c47 },

  // The bass is the same string with the brightness taken out and a box under
  // it — which is most of what a bass guitar is.
  bajo:     { damp: 0.34, decay: 0.9985, pick: 0.24, tone: 0.20, body: 0.55,
              bodyHz: 0.25, dur: [1.0, 3.0], peak: 0.8, seed: 0x71b3 },
};

export function renderString(sr, hz, name, s, opts) {
  const spec = STRINGS[name];
  if (!spec) throw new Error(`no string named "${name}"`);
  return pluck(sr, hz, spec, s, opts);
}

// ---------------------------------------------------------------------------
// The percussion
// ---------------------------------------------------------------------------

/**
 * The bongó — two small hand drums, and in bachata the one that improvises.
 *
 * A struck membrane rather than a struck bar: a pitch that falls quickly as the
 * head relaxes, plus a burst of noise for the hand. `slap` is the difference
 * between the open tone of the large drum and the sharp crack of the small one,
 * and it is the same renderer with a shorter, brighter everything.
 */
export function renderBongo(sr, s, { slap = false } = {}) {
  const c = shape(s);
  const dur = slap ? lin(c.longer, 0.12, 0.26) : lin(c.longer, 0.24, 0.5);
  const out = alloc(sr, dur);
  const rnd = noiseSource(slap ? 0x4a11 : 0x1f60);
  const base = slap ? exp(c.deeper, 420, 250) : exp(c.deeper, 250, 140);
  let ph = 0, lp = 0, hp = 0, prev = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = Math.exp(-(slap ? 26 : 13) * (t / dur));
    // The head tightens under the hand and lets go — a fast downward bend, which
    // is what makes a hand drum sound struck rather than plucked.
    ph += (2 * Math.PI * base * (1 + 1.1 * Math.exp(-t * (slap ? 150 : 70)))) / sr;
    const body = Math.sin(ph) * env;

    // The hand itself: noise, brief, and high on a slap.
    const hand = rnd() * Math.exp(-t * (slap ? 220 : 130));
    const a = onePole(slap ? 5200 : 2600, sr);
    lp += a * (hand - lp);
    // Take the rumble out so two of these do not muddy each other.
    const x = body + lp * (slap ? 0.9 : 0.5);
    hp = 0.985 * (hp + x - prev);
    prev = x;
    out[i] = hp * Math.min(1, t / 0.0015);
  }
  return normalize(fadeOut(out, sr, 8), slap ? 0.62 : 0.7);
}

/**
 * The güira — a metal cylinder scraped with a stiff brush, and the sound that
 * keeps bachata moving.
 *
 * Not a hit and not a tone: a RASP. Bandpassed noise with a fast attack and a
 * short tail, and the length is the whole expression — a short flick and a long
 * drag are the two things it says.
 */
export function renderGuira(sr, s, { long = false } = {}) {
  const c = shape(s);
  const dur = long ? lin(c.longer, 0.16, 0.34) : lin(c.longer, 0.05, 0.12);
  const out = alloc(sr, dur);
  const rnd = noiseSource(long ? 0x6d22 : 0x3b81);
  let bp = 0, lp = 0;
  const centre = exp(c.deeper, 4200, 8000);

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // A drag builds and then stops; a flick is all front.
    const env = long
      ? Math.min(1, t / (dur * 0.35)) * Math.exp(-3.2 * (t / dur))
      : Math.exp(-16 * (t / dur));
    // The teeth of the brush, as a fast tremolo on the noise.
    const teeth = 0.72 + 0.28 * Math.sin((2 * Math.PI * 2400 * t));
    const a = onePole(centre, sr);
    lp += a * (rnd() - lp);
    bp = lp - bp * 0.12;
    out[i] = bp * env * teeth * 0.5;
  }
  return normalize(fadeOut(out, sr, 4), long ? 0.42 : 0.36);
}

/**
 * The feel.
 *
 * Around 128, straight, and only a little room — bachata records are close and
 * present, and the guitars need to stay in front rather than wash back.
 */
export const BACHATA = {
  bpm: 128,
  swing: 0,
  room: { size: 0.62, damp: 0.5, mix: 0.22 },
};

export const BACHATA_VOICES = {
  bongo: (sr, hz, s, o) => renderBongo(sr, s, o),
  guira: (sr, hz, s, o) => renderGuira(sr, s, o),
  ...Object.fromEntries(
    Object.keys(STRINGS).map((name) => [
      name,
      (sr, hz, s, opts) => renderString(sr, hz, name, s, opts),
    ]),
  ),
};
