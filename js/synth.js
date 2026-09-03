// The synthesis toolkit — what every palette is built out of.
//
// Pure, like js/dsp.js: sample rate in, Float32Array out, no Web Audio and no
// DOM, so the forge renders WAVs with it and the browser fills buffers with it
// (dec:two-speed-synthesis).
//
// WHY THIS FILE EXISTS. The calm and haunted palettes were built one after the
// other and independently, and by the second one there were eight helper
// functions copy-pasted verbatim between them and one synthesis MODEL written
// out twice with small differences. A third palette would have made it three.
// dec:styles-are-palettes says a style is data; this is the other half of that
// claim — if a style is data, the code it is data FOR has to live somewhere.
//
// WHAT BELONGS HERE AND WHAT DOES NOT. A model belongs here when two palettes
// genuinely want the same thing with different numbers. A voice that is only
// shaped like another one does NOT: forcing the calm pad and the haunted dread
// into a single function would need a handful of behaviour flags, and a shared
// function full of conditionals is worse than two honest ones. So the primitives
// and the struck-body model are here, and the voices that merely rhyme stay in
// their own palettes.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Map a 0..1 control onto a range. Linear where the ear hears linearly. */
export const lin = (v, lo, hi) => lo + (hi - lo) * v;

/** And exponential where it hears ratios — pitch, time, cutoff. */
export const exp = (v, lo, hi) => lo * Math.pow(hi / lo, v);

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The four shaping controls, with anything unset left in the middle. */
export const NEUTRAL = { deeper: 0.5, punchier: 0.5, dirtier: 0.5, longer: 0.5 };
export const shape = (s) => ({ ...NEUTRAL, ...(s || {}) });

export const alloc = (sr, seconds) =>
  new Float32Array(Math.max(1, Math.ceil(sr * seconds)));

/** Deterministic noise, seeded, so the forge renders byte-identically. */
export function noiseSource(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/** Scale to a target peak, so palettes stay balanced without a mixdown stage. */
export function normalize(buf, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / max;
  return buf;
}

/** Fade the tail so a truncated buffer never clicks. */
export function fadeOut(buf, sr, ms = 30) {
  const n = Math.min(buf.length, Math.floor((ms / 1000) * sr));
  for (let i = 0; i < n; i++) buf[buf.length - n + i] *= 1 - i / n;
  return buf;
}

/** One-pole lowpass coefficient for a cutoff in Hz. */
export const onePole = (hz, sr) =>
  1 - Math.exp((-2 * Math.PI * Math.min(hz, sr * 0.45)) / sr);

/**
 * A swell rather than a strike: `attack` in, hold, `release` out.
 *
 * Raised cosine on both edges, because a linear ramp has a corner and a corner
 * is a transient — which is the thing a sustained voice exists to avoid.
 */
export function swell(t, seconds, attack, release) {
  if (t >= seconds) return 0;
  const up = t < attack ? t / attack : 1;
  const left = seconds - t;
  const down = left < release ? left / release : 1;
  const g = up * down;
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, g));
}

/**
 * Normalise partial ratios so the FIRST ONE IS THE NOTE ASKED FOR.
 *
 * Load-bearing, not tidiness. Used raw, the textbook bell ratios start at 0.56
 * and put the perceived pitch nine semitones below the note requested — measured
 * that way, and it would have broken the scale lock in the one voice nobody
 * would think to check. Dividing by the first term keeps the inharmonic RATIOS,
 * which is what the ear reads as metal or glass, and moves the pitch home.
 */
export const ratios = (arr) => arr.map((v) => v / arr[0]);

// ---------------------------------------------------------------------------
// The struck-body model
// ---------------------------------------------------------------------------

/**
 * Anything struck or rubbed that rings: handpan, bell, vibraphone, celesta,
 * crotale, singing bowl, music box, a length of pipe.
 *
 * A sum of exponentially decaying partials. What separates a handpan from a
 * cracked bell is not a different program, it is three numbers — WHERE the
 * partials sit, HOW FAST each dies, and HOW HARD the thing is hit.
 *
 * @param spec.m       partial ratios, first normalised to 1 (see `ratios`)
 * @param spec.g       relative level of each
 * @param spec.d       decay multiplier per partial; higher dies sooner, which is
 *                     what real bars do — they lose brightness before they go quiet
 * @param spec.attack  seconds; struck is milliseconds, rubbed is a swell
 * @param spec.decay   overall decay rate
 * @param spec.beat    detune of each partial's twin, as a fraction. 0 is clean;
 *                     around 0.4% shimmers; 2% is a sound with something wrong
 *                     with it. THIS IS THE WHOLE DIFFERENCE between the calm
 *                     palette's instruments and the haunted one's.
 * @param spec.trem    amplitude tremolo in Hz, or 0 — the vibraphone's motor
 * @param spec.dur     [lo, hi] seconds, selected by the `longer` control
 * @param spec.norm    divisor before normalising, kept per palette
 */
export function struck(sr, hz, spec, s, { seconds } = {}) {
  const c = shape(s);
  const [lo, hi] = spec.dur ?? [2.2, 7.0];
  const dur = seconds ?? lin(c.longer, lo, hi);
  const out = alloc(sr, dur);
  const beat = spec.beat ?? 0;
  const trem = spec.trem ?? 0;
  const attack = spec.attack * lin(c.punchier, 1.8, 0.5);
  // Two phases per partial: the note, and its slightly wrong twin. With beat 0
  // the twin advances identically and the pair sums back to the plain partial,
  // which is why one model covers both palettes exactly.
  const ph = new Float64Array(spec.m.length * 2);
  let tph = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let x = 0;
    for (let k = 0; k < spec.m.length; k++) {
      const env = spec.g[k] * Math.exp((-spec.decay * spec.d[k] * t) / dur);
      ph[k * 2] += (2 * Math.PI * hz * spec.m[k]) / sr;
      ph[k * 2 + 1] += (2 * Math.PI * hz * spec.m[k] * (1 + beat)) / sr;
      x += (Math.sin(ph[k * 2]) + Math.sin(ph[k * 2 + 1])) * 0.5 * env;
    }
    let a = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    if (trem) {
      tph += (2 * Math.PI * trem) / sr;
      a *= 0.78 + 0.22 * Math.sin(tph);
    }
    out[i] = (x / (spec.norm ?? 2.6)) * a;
  }
  return normalize(fadeOut(out, sr, 40), spec.peak ?? 0.6);
}

// ---------------------------------------------------------------------------
// Formants — the part of a sound the ear reads as a voice
// ---------------------------------------------------------------------------

/**
 * A bank of two-pole resonators, run direct.
 *
 * What makes a sound read as a VOICE is not its waveform, it is a handful of
 * fixed resonances the throat and mouth impose on whatever the vocal folds are
 * doing. Move them and the same source becomes a different vowel; narrow them
 * and raise them and a choir becomes a scream.
 */
export function formantBank(formants) {
  const st = formants.map(() => ({ b0: 0, b1: 0 }));
  return (src, sr) => {
    let x = 0;
    for (let k = 0; k < formants.length; k++) {
      const f = formants[k], q = st[k];
      const w = (2 * Math.PI * f.hz) / sr;
      const hp = src - q.b0 - (1 / f.q) * q.b1;
      q.b1 += 2 * Math.sin(w / 2) * hp;
      q.b0 += 2 * Math.sin(w / 2) * q.b1;
      x += q.b1 * f.g;
    }
    return x;
  };
}

/** A detuned saw pair — rich enough for formants to have something to select. */
export function sawPair(detune = 1.002) {
  let p1 = 0, p2 = 0;
  const saw = (ph) => 2 * ((ph / (2 * Math.PI)) % 1) - 1;
  return (hz, sr) => {
    p1 += (2 * Math.PI * hz) / sr;
    p2 += (2 * Math.PI * hz * detune) / sr;
    return (saw(p1) + saw(p2)) * 0.5;
  };
}
