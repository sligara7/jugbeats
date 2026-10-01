// Llamachant — her own bedtime sound (dec:idea-her-own-heavenly-bed).
//
// Monks, a choir and singing bowls, all grown out of a pink-to-brown noise
// bed. Two pages use it: /llamachant/ is the bed she falls asleep to, and
// /llamachant/desk.html is the listening desk where the mix is chosen by ear.
//
// EVERY LAYER RUNS ON THE AUDIO THREAD ONCE STARTED: looping buffers,
// oscillators, and looping envelopes wired to AudioParams. The bed obeys
// runBed's rule that no JavaScript runs after the tap. The desk moves faders,
// and that is the only difference between the two pages.
//
// It is pure Web Audio and takes its context as an argument. That means an
// OfflineAudioContext can render it to measure levels, which is how the LEVEL
// table below was set.

import { pinkLoop, envelopeLoop, ENV_RATE } from './bed.js';
import { impulseResponse } from './ethereal.js';

/**
 * THE SETTINGS, which are also what both pages carry in their URL.
 *
 * Every fader is 0..1. `dark` runs pink (0) to brown (1). `clear` runs the
 * melody from noise (0) to note (1), and `slow` runs from three seconds a beat
 * (0) to fourteen (1). `vowel`, `tune` and `key` are ids from VOWEL_CHOICES,
 * TUNES and KEYS. `normalise` is the only door into this shape, so a
 * hand-edited link cannot hand the graph a NaN.
 *
 * THE DEFAULTS ARE THE OWNER'S FAVOURITE MIX, sent from the desk on
 * 2026-09-30. The melody is off because it did not exist yet when he chose.
 */
export const DEFAULTS = Object.freeze({
  bed: 0.43, dark: 0.94,
  choir: 0.89, vowel: 'oo',
  om: 0.73,
  chant: 0.82,
  bowl: 0.43, strike: 0.61,
  melody: 0, tune: 'emmanuel', clear: 0.5, slow: 0.5,
  breathe: 0.12, room: 0.24,
  key: 'C',
});

/** Semitones above C. Pentatonic-friendly roots only. */
export const KEYS = Object.freeze({ C: 0, D: 2, Eb: 3, F: 5, G: 7, A: 9 });

export const VOWEL_CHOICES = Object.freeze(['oo', 'oh', 'ah', 'drift']);

export const FADERS = Object.freeze([
  'bed', 'dark', 'choir', 'om', 'chant', 'bowl', 'strike',
  'melody', 'clear', 'slow', 'breathe', 'room',
]);

export function normalise(raw = {}) {
  const s = { ...DEFAULTS };
  for (const k of FADERS) {
    const v = Number(raw[k]);
    if (raw[k] !== undefined && raw[k] !== '' && Number.isFinite(v)) s[k] = Math.min(1, Math.max(0, v));
  }
  if (VOWEL_CHOICES.includes(raw.vowel)) s.vowel = raw.vowel;
  if (Object.hasOwn(TUNES, raw.tune)) s.tune = raw.tune;
  if (Object.hasOwn(KEYS, raw.key)) s.key = raw.key;
  return s;
}

/**
 * Settings to and from a URL's parameters. Faders travel as whole
 * percentages, because "bed=43" is something a person can read and type, and
 * 0.4300000001 is not.
 */
export function fromParams(params) {
  const raw = Object.fromEntries(params);
  for (const k of FADERS) if (raw[k] !== undefined) raw[k] = Number(raw[k]) / 100;
  return normalise(raw);
}

export function toParams(s) {
  const p = new URLSearchParams();
  for (const k of FADERS) p.set(k, String(Math.round(s[k] * 100)));
  for (const k of ['vowel', 'tune', 'key']) p.set(k, s[k]);
  return p;
}

/**
 * HOW LOUD EACH LAYER IS WITH ITS FADER AT THE TOP, set so every layer at full
 * measures the same RMS. Then the faders compare like with like, and a layer
 * that sounds louder IS louder rather than miscalibrated.
 *
 * MEASURED, NOT CHOSEN: each layer rendered alone, offline, for twelve seconds,
 * with breathing and room off, in C. Each figure is TARGET_RMS over that
 * layer's raw RMS. The raw values were bed 0.190, choir 0.0693, om 0.0099,
 * chant 0.205, bowl 0.509 and strike 0.325. The melody was 0.0216, measured
 * over 22 seconds of the Emmanuel tune at the middle of `clear` and `slow`,
 * including its dips.
 *
 * The om needs twenty times the gain because narrow filtering is quiet,
 * exactly as dec:idea-drone-from-noise warned ("about a twentieth the RMS").
 *
 * THE STRIKE IS MATCHED OVER THE TEN SECONDS AFTER A STRIKE, not over its
 * loop. An accent's average across a whole minute says nothing about how
 * loud it is when it lands.
 */
const TARGET_RMS = 0.2;
const LEVEL = Object.freeze({
  bed: TARGET_RMS / 0.190,
  choir: TARGET_RMS / 0.0693,
  om: TARGET_RMS / 0.0099,
  chant: TARGET_RMS / 0.205,
  bowl: TARGET_RMS / 0.509,
  strike: TARGET_RMS / 0.325,
  melody: TARGET_RMS / 0.0216,
});

/** Noise buffers stop at 8 kHz. Nothing in this bed wants more, and the beds
 *  already make the same trade. */
const NOISE_RATE = 16000;

/** Faders move gently rather than jumping, so moving one never pops. */
const GLIDE = 0.35;

const hz = (key, octave) => 440 * 2 ** ((KEYS[key] + 12 * (octave - 4) - 9) / 12);

/**
 * A looping envelope that is seamless at its wrap: every component completes
 * a whole number of cycles inside the loop. Non-integer periods put a step in
 * the curve at the wrap, which is harmless on a level and audible on a
 * filter sweep.
 */
const cycles = (parts, power = 1) => (t) => {
  let g = 0, max = 0;
  for (const [n, amount] of parts) {
    g += amount * (0.5 - 0.5 * Math.cos(2 * Math.PI * n * t));
    max += amount;
  }
  return (g / max) ** power;
};

/**
 * A looping envelope, evaluated at a FEW POINTS A SECOND and interpolated.
 *
 * ⚠️ THIS IS WHERE THE SPIKE'S START-UP TIME WENT. envelopeLoop evaluates its
 * shape once per sample at ENV_RATE, which cannot go lower (createBuffer
 * refuses lower rates). Over a two-minute loop that is about a million trig
 * evaluations for a curve that changes a few times a minute. Measured on this
 * machine: 1.3 seconds for the chant's sweep alone, out of 2.5 to 5 seconds
 * for the whole desk.
 *
 * Twenty points a second is still finer than anything these curves do, and
 * the buffer comes out at the same rate and length as before.
 */
function slowLoop(ctx, seconds, shape, perSecond = 20) {
  const points = Math.max(2, Math.round(seconds * perSecond));
  const coarse = new Float32Array(points + 1);
  for (let i = 0; i <= points; i++) coarse[i] = shape(i / points);
  return envelopeLoop(ctx, seconds, (t) => {
    const x = t * points;
    const i = x | 0;
    const f = x - i;
    return coarse[i] * (1 - f) + coarse[i + 1] * f;
  });
}

function loopSource(ctx, sources, buffer, t0) {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.start(t0);
  sources.push(s);
  return s;
}

function gain(ctx, value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(ctx, type, frequency, Q, extra = {}) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  if (extra.gain !== undefined) f.gain.value = extra.gain;
  return f;
}

/**
 * For a filter whose frequency follows a slow curve: recompute its
 * coefficients once per 128-sample block rather than once per sample. A
 * connected modulator otherwise makes the browser redo the filter's trig on
 * every sample, which is the costliest thing in this graph. These curves
 * move over seconds, so 375 updates a second is far more than they need.
 * Where a browser lacks automationRate, the assignment does nothing.
 */
function slowParam(param) {
  try { param.automationRate = 'k-rate'; } catch (e) { /* not supported: stays a-rate */ }
  return param;
}

const fader = (x) => x * x;

// ---------------------------------------------------------------------------
// The layers. Each one is a function of (ctx, sources, t0) that returns
// { out, set(settings, put) }. That is the whole protocol: `out` is where its
// sound comes from, and `set` moves its parameters through `put`, which either
// assigns (at build) or glides (live).
// ---------------------------------------------------------------------------

/**
 * THE BED: pink and brown noise, crossfaded at equal power.
 *
 * Both loops leave pinkLoop at the same RMS, and they are uncorrelated, so an
 * equal-power crossfade keeps the level constant across the whole knob. `dark`
 * changes the colour and nothing else, which is the same discipline pinkLoop's
 * own tilt follows.
 */
function bedLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const pink = gain(ctx), brown = gain(ctx);
  loopSource(ctx, sources, pinkLoop(ctx, 47, { rate: NOISE_RATE }), t0).connect(pink).connect(out);
  loopSource(ctx, sources, pinkLoop(ctx, 53, { brown: 1, rate: NOISE_RATE }), t0).connect(brown).connect(out);
  return {
    out,
    set(s, put) {
      put(out.gain, LEVEL.bed * fader(s.bed));
      put(pink.gain, Math.cos((s.dark * Math.PI) / 2));
      put(brown.gain, Math.sin((s.dark * Math.PI) / 2));
    },
  };
}

/**
 * Formants for a light, high choir, F1 / F2 / F3 in Hz. These are roughly
 * adult female averages, chosen because "heavenly" is a high choir, not a low
 * one. The drift glides in a straight line from oo to ah, and passes close to
 * oh on the way.
 */
const VOWELS = Object.freeze({
  oo: [350, 900, 2700],
  oh: [520, 950, 2700],
  ah: [800, 1200, 2800],
});
const FORMANT_GAIN = [1, 0.6, 0.25];
/** Broad on purpose: a whisper has no vocal folds behind it, so its formants
 *  are more heavily damped than a sung vowel's. */
const FORMANT_Q = [5, 7, 9];
/**
 * Three vocal tracts of different lengths, spread across the stereo field. A
 * single formant set on noise is one whisper; staggering the formants is what
 * makes it read as several people.
 */
const VOICES = [
  { scale: 0.92, pan: -0.6 },
  { scale: 1.0, pan: 0 },
  { scale: 1.1, pan: 0.6 },
];
/** oo to ah and back, wandering. 150 seconds, cycles at 50 and 30. */
const vowelDrift = cycles([[3, 1], [5, 0.6]]);

/**
 * THE WHISPERED CHOIR: noise through vowel formants, so it has no pitch and
 * is still a noise bed, but the ear hears breath through a choir.
 */
function choirLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const src = loopSource(ctx, sources, pinkLoop(ctx, 41, { rate: NOISE_RATE }), t0);
  const morph = loopSource(ctx, sources, slowLoop(ctx, 150, vowelDrift), t0);

  const formants = [];
  for (const { scale, pan } of VOICES) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : gain(ctx);
    if (p.pan) p.pan.value = pan;
    p.connect(out);
    for (let i = 0; i < 3; i++) {
      const bp = filter(ctx, 'bandpass', VOWELS.oo[i] * scale, FORMANT_Q[i]);
      src.connect(bp).connect(gain(ctx, FORMANT_GAIN[i])).connect(p);
      const span = gain(ctx, 0);
      morph.connect(span).connect(slowParam(bp.frequency));
      formants.push({ bp, span, scale, i });
    }
  }

  return {
    out,
    set(s, put) {
      put(out.gain, LEVEL.choir * fader(s.choir));
      const drifting = s.vowel === 'drift';
      const base = VOWELS[drifting ? 'oo' : s.vowel];
      for (const { bp, span, scale, i } of formants) {
        put(bp.frequency, base[i] * scale);
        put(span.gain, drifting ? (VOWELS.ah[i] - VOWELS.oo[i]) * scale : 0);
      }
    },
  };
}

/**
 * The om's partials, as multiples of its root: the harmonic series up to the
 * eighth, plus the FIFTH's odd harmonics (1.5, 4.5, 7.5). Its even harmonics
 * land on the root's own and would duplicate them.
 */
const OM_PARTIALS = [1, 2, 3, 4, 5, 6, 7, 8, 1.5, 4.5, 7.5];
/** Measured in dec:idea-drone-from-noise: Q 60 states a clear pitch out of
 *  pink noise, +17.7 dB against the neighbouring bins at C3. */
const OM_Q = 60;
/** The "oh" the om is sung on: where its formants sit, how wide, how strong. */
const OM_FORMANTS = [[520, 160, 1], [950, 220, 0.6]];

/** How much of each partial, before normalising. Higher harmonics fall away,
 *  the fifth sits under the root, and anything near a formant is lifted. */
function omWeights(f0) {
  const w = OM_PARTIALS.map((m) => {
    const f = m * f0;
    const k = m % 1 ? m / 1.5 : m;
    let lift = 0.35;
    for (const [F, B, g] of OM_FORMANTS) lift += g / (1 + ((f - F) / (B / 2)) ** 2);
    return (m % 1 ? 0.6 : 1) * lift / Math.sqrt(k);
  });
  const norm = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
  return w.map((x) => x / norm);
}

/**
 * THE OM: a drone made of noise. Pink through a narrow resonance at each
 * partial of root and fifth, weighted onto an "oh".
 *
 * VOICED FROM ITS HARMONICS, because a phone speaker plays almost nothing at
 * C3. The ear hears the root anyway from the partials above it, the same
 * reasoning as dec:drone-voiced-up.
 */
function omLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const src = loopSource(ctx, sources, pinkLoop(ctx, 59, { rate: NOISE_RATE }), t0);
  const bands = OM_PARTIALS.map((m) => {
    const bp = filter(ctx, 'bandpass', m * 130.81, OM_Q);
    const g = gain(ctx, 0);
    src.connect(bp).connect(g).connect(out);
    return { bp, g, m };
  });
  return {
    out,
    set(s, put) {
      put(out.gain, LEVEL.om * fader(s.om));
      const f0 = hz(s.key, 3);
      const w = omWeights(f0);
      bands.forEach(({ bp, g, m }, i) => {
        put(bp.frequency, m * f0);
        put(g.gain, w[i]);
      });
    },
  };
}

/** The whistle's slow path from the sixth harmonic to the twelfth. 120 s,
 *  with cycles at 40, 30 and about 17, and dwelling low. */
const chantSweep = cycles([[3, 1], [4, 0.7], [7, 0.4]], 1.3);
/** Two voices a fraction apart, so they beat slowly against each other. */
const CHANT_DETUNE = 0.002;
const CHANT_BODY = 0.5;
const CHANT_WHISTLE = 2.5;

/**
 * OVERTONE CHANT: a low buzzing drone, with a narrow resonance gliding across
 * its harmonics so single overtones whistle out one at a time.
 *
 * Its root is an octave under the om's, at C2, which is where the game's
 * own root sits. The phone will not play that note, but it plays harmonics
 * six to twelve, and those are what the chant is made of.
 */
function chantLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const sum = gain(ctx, 0.5);
  const oscs = [1 - CHANT_DETUNE, 1 + CHANT_DETUNE].map((d) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.connect(sum);
    o.start(t0);
    sources.push(o);
    return { o, d };
  });

  // The body: the buzz with its top taken off and an "oh" pushed forward.
  sum.connect(filter(ctx, 'lowpass', 650, 0.7))
    .connect(filter(ctx, 'peaking', 480, 1.5, { gain: 6 }))
    .connect(gain(ctx, CHANT_BODY)).connect(out);

  // The whistle: narrow enough to pass one harmonic at a time.
  const bp = filter(ctx, 'bandpass', 6 * 65.41, 28);
  sum.connect(bp).connect(gain(ctx, CHANT_WHISTLE)).connect(out);
  const span = gain(ctx, 0);
  loopSource(ctx, sources, slowLoop(ctx, 120, chantSweep), t0).connect(span).connect(slowParam(bp.frequency));

  return {
    out,
    set(s, put) {
      put(out.gain, LEVEL.chant * fader(s.chant));
      const f0 = hz(s.key, 2);
      for (const { o, d } of oscs) put(o.frequency, f0 * d);
      put(bp.frequency, 6 * f0);
      put(span.gain, 6 * f0);
    },
  };
}

/**
 * A singing bowl's modes: ratio to the fundamental, strength when rubbed,
 * strength and decay when struck, and how fast its pair of near-twin modes
 * beat against each other. The beating is the bowl's "wah-wah" and the
 * reason a bowl does not sound like a sine.
 */
const BOWL = [
  { ratio: 1, rubbed: 1, struck: 1, decay: 12, beat: 0.8 },
  { ratio: 2.76, rubbed: 0.45, struck: 0.55, decay: 7, beat: 1.6 },
  { ratio: 5.18, rubbed: 0.2, struck: 0.3, decay: 3.5, beat: 2.4 },
  { ratio: 8.3, rubbed: 0.08, struck: 0.15, decay: 1.8, beat: 3.1 },
];
/** The rim being rubbed: a slow swell under the ringing. 60 s, cycles at
 *  15 and about 8.6. */
const rubSwell = cycles([[4, 1], [7, 0.5]]);

/** THE BOWL, RUBBED: its modes held, beating, and swelling as the rim turns. */
function bowlLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const swell = gain(ctx, 0.75);
  swell.connect(out);
  loopSource(ctx, sources, slowLoop(ctx, 60, rubSwell), t0).connect(gain(ctx, 0.25)).connect(swell.gain);

  const oscs = [];
  for (const mode of BOWL) {
    for (const side of [-1, 1]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.connect(gain(ctx, mode.rubbed / 2)).connect(swell);
      o.start(t0);
      sources.push(o);
      oscs.push({ o, mode, side });
    }
  }
  return {
    out,
    set(s, put) {
      put(out.gain, LEVEL.bowl * fader(s.bowl));
      const f0 = hz(s.key, 4);
      for (const { o, mode, side } of oscs) put(o.frequency, f0 * mode.ratio + (side * mode.beat) / 2);
    },
  };
}

/** Struck bowls, baked into one loop: strikes at irregular gaps of 37, 34
 *  and 30 seconds, so the ear cannot learn when the next one is due. */
const STRIKE_LOOP = 101;
const STRIKES_AT = [0, 37, 71];
const STRIKE_RATE = 22050;
const STRIKE_TAIL = 40;
/** The pitch the strike is baked at. A different key replays it faster or
 *  slower rather than baking it again. */
const STRIKE_KEY = 'C';

/** One strike: every mode decaying at its own rate, after a soft-mallet onset. */
function renderStrike(rate) {
  const n = Math.floor(STRIKE_TAIL * rate);
  const out = new Float32Array(n);
  const f0 = hz(STRIKE_KEY, 4);
  const attack = 0.006 * rate;
  for (const mode of BOWL) {
    for (const side of [-1, 1]) {
      const w = (2 * Math.PI * (f0 * mode.ratio + (side * mode.beat) / 2)) / rate;
      const fall = Math.exp(-1 / (mode.decay * rate));
      // A sine by recurrence, sin(n w) = 2 cos(w) sin((n-1) w) - sin((n-2) w),
      // rather than a Math.sin per sample: eight modes over forty seconds is
      // seven million of them otherwise. Run in doubles, it holds its amplitude
      // over the whole tail.
      const c = 2 * Math.cos(w);
      let s1 = 0, s2 = -Math.sin(w);
      let amp = mode.struck / 2;
      for (let i = 0; i < n; i++) {
        const s = c * s1 - s2;
        s2 = s1; s1 = s;
        out[i] += amp * (i < attack ? i / attack : 1) * s2;
        amp *= fall;
      }
    }
  }
  return out;
}

/**
 * THE BOWL, STRUCK. These are the only accents anywhere in this bed. They are
 * allowed because the listener is her and not the baby. They are also the
 * layer most likely to wake her, which is why they default to off.
 */
function strikeLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const n = STRIKE_LOOP * STRIKE_RATE;
  const buf = ctx.createBuffer(1, n, STRIKE_RATE);
  const data = buf.getChannelData(0);
  const one = renderStrike(STRIKE_RATE);
  // Written modulo the loop, so a strike near the end rings on into the start.
  for (const at of STRIKES_AT) {
    const o = at * STRIKE_RATE;
    for (let i = 0; i < one.length; i++) data[(o + i) % n] += one[i];
  }
  const src = loopSource(ctx, sources, buf, t0);
  src.connect(out);
  return {
    out,
    set(s, put) {
      put(out.gain, LEVEL.strike * fader(s.strike));
      put(src.playbackRate, 2 ** ((KEYS[s.key] - KEYS[STRIKE_KEY]) / 12));
    },
  };
}

// ---------------------------------------------------------------------------
// The melody, sung by noise — dec:idea-a-melody-sung-by-noise
// ---------------------------------------------------------------------------

/**
 * The tunes, as [semitones above the tonic, length in beats]. Major or minor
 * follows from the intervals, so either one sits in whatever key the desk is
 * in. Both sit over the om's open fifth, which has no third to clash with.
 *
 * PUBLIC DOMAIN ONLY (dec:public-domain-only), each with its provenance.
 * Transcribed from the melody itself rather than from any modern arrangement.
 */
export const TUNES = Object.freeze({
  emmanuel: {
    name: 'O come, O come, Emmanuel',
    // Veni Emmanuel: a 15th-century French processional, published with these
    // words in 1851. The first two lines, which make one whole phrase ending on
    // the tonic. Chant-like and modal, which is why it stands in for plainchant
    // until a true Gregorian chant is transcribed from a score.
    notes: [
      [0, 1], [3, 1], [7, 1], [7, 1], [7, 1], [5, 1], [8, 1], [7, 1], [5, 1], [3, 2],
      [5, 1], [7, 1], [3, 1], [0, 1], [3, 1], [5, 1], [2, 1], [0, 1], [-2, 1], [0, 3],
    ],
  },
  lullaby: {
    name: "Brahms' Lullaby",
    // Wiegenlied, Op. 49 No. 4, Brahms, 1868. Brahms' pitches throughout. The
    // rhythm is evened out to a beat a note, longer at phrase ends, because at
    // several seconds a beat the score's own rhythm cannot be heard anyway.
    notes: [
      [4, 1], [4, 1], [7, 2], [4, 1], [4, 1], [7, 2],
      [4, 1], [7, 1], [12, 1], [11, 1], [9, 1], [9, 1], [7, 2],
      [2, 1], [4, 1], [5, 1], [2, 1], [2, 1], [4, 1], [5, 2],
      [2, 1], [5, 1], [11, 1], [9, 1], [7, 1], [11, 1], [12, 2],
      [-5, 1], [-5, 1], [7, 2], [4, 1], [0, 1], [2, 2],
      [4, 1], [0, 1], [5, 1], [7, 1], [9, 1], [7, 2],
      [-5, 1], [-5, 1], [7, 2], [4, 1], [0, 1], [2, 2],
      [4, 1], [0, 1], [5, 1], [4, 1], [2, 1], [0, 3],
    ],
  },
});

/**
 * WHERE THE MELODY SITS: as near as the key allows to 527 Hz, the octave
 * midpoint of the 440 to 630 Hz band the owner asked for. The tune's median
 * note is placed in whichever octave lands closest.
 */
const MELODY_CENTRE = Math.sqrt(440 * 630);

function tonicFor(tune, key) {
  const pitches = tune.notes.map(([st]) => st).sort((a, b) => a - b);
  const median = pitches[pitches.length >> 1];
  let best = 0, bestMiss = Infinity;
  for (const octave of [3, 4, 5]) {
    const tonic = hz(key, octave);
    const miss = Math.abs(Math.log2((tonic * 2 ** (median / 12)) / MELODY_CENTRE));
    if (miss < bestMiss) { best = tonic; bestMiss = miss; }
  }
  return best;
}

/**
 * HOW NARROW EACH NOTE'S BAND IS, from the `clear` fader: Q 4 at noise, Q 40
 * at note. A band has to be narrower than the step the melody takes for the
 * step to be heard. A whole tone is about 12% in frequency and needs Q 8 or
 * more; a semitone is about 6% and needs about Q 20.
 */
export const qFor = (clear) => 4 * 10 ** clear;
const Q_REF = qFor(0.5);

/** Seconds a beat, from the `slow` fader: 3 at the bottom, 14 at the top. */
export const secondsPerBeat = (slow) => 3 * (14 / 3) ** slow;

/** The note's own band, and fainter bands at its 2nd and 3rd harmonics. One
 *  band on its own is a whistle; the harmonics make it closer to a voice. */
const HARMONICS = [[1, 1], [2, 0.3], [3, 0.12]];

/** How the notes join: the last 18% of a beat glides to the next pitch, and
 *  the level dips to 40% across a quarter beat at each join. Without the dip,
 *  a repeated note (the lullaby opens on three) would be one long note. */
const GLIDE_BEATS = 0.18;
const DIP_BEATS = 0.25;
const DIP_TO = 0.4;
/** A breath of silence before the tune comes round again. */
const REST_BEATS = 2;

const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * THE TUNE AS A CURVE, at one second a beat, in two channels: pitch as a
 * ratio to the tonic, and level.
 *
 * ONE BUFFER FOR BOTH, so the two can never drift apart however long it
 * loops. It is built at one second a beat and replayed slower through
 * playbackRate. That keeps a 60-beat tune to about four megabytes, makes the
 * `slow` fader free to move live, and stretches the glides and dips with the
 * notes.
 */
function tuneCurve(ctx, notes) {
  const starts = [];
  let beats = 0;
  for (const [, len] of notes) { starts.push(beats); beats += len; }
  const tuneEnd = beats;
  const total = tuneEnd + REST_BEATS;
  const n = Math.round(total * ENV_RATE);
  const buf = ctx.createBuffer(2, n, ENV_RATE);
  const pitch = buf.getChannelData(0);
  const level = buf.getChannelData(1);
  const last = notes.length - 1;

  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / ENV_RATE;
    while (k < last && t >= starts[k + 1]) k++;

    // Pitch: hold, then glide into the next note. In the rest it waits on the
    // first note, while the level is at zero, so the jump is never heard.
    let st;
    if (t >= tuneEnd) st = notes[0][0];
    else {
      const end = starts[k] + notes[k][1];
      const g = k < last ? smoothstep((t - (end - GLIDE_BEATS)) / GLIDE_BEATS) : 0;
      st = notes[k][0] + g * ((k < last ? notes[k + 1][0] : notes[k][0]) - notes[k][0]);
    }
    pitch[i] = 2 ** (st / 12);

    // Level: in over half a beat, a dip at every join, out over the last beat,
    // then the rest.
    let a = 0;
    if (t < tuneEnd) {
      a = smoothstep(t / 0.5) * (1 - smoothstep((t - (tuneEnd - 1)) / 1));
      for (const b of [starts[k], k < last ? starts[k + 1] : -1]) {
        if (b <= 0) continue;
        const d = Math.abs(t - b) / (DIP_BEATS / 2);
        if (d < 1) a *= 1 - (1 - DIP_TO) * (0.5 + 0.5 * Math.cos(Math.PI * d));
      }
    }
    level[i] = a;
  }
  return buf;
}

/**
 * THE MELODY: pink noise through a band that follows the tune. Pink noise
 * carries equal energy per octave, and a bandpass is symmetric by octave,
 * so the energy median of each note sits exactly on its pitch. That is the
 * owner's "noise centred on 440", built literally.
 *
 * Every tune is built and running, and the `tune` choice crossfades between
 * them, so switching never restarts anything.
 */
function melodyLayer(ctx, sources, t0) {
  const out = gain(ctx, 0);
  const src = loopSource(ctx, sources, pinkLoop(ctx, 37, { rate: NOISE_RATE }), t0);

  const voices = Object.entries(TUNES).map(([id, tune]) => {
    const curve = loopSource(ctx, sources, tuneCurve(ctx, tune.notes), t0);
    const split = ctx.createChannelSplitter(2);
    curve.connect(split);
    const level = gain(ctx, 0);
    split.connect(level.gain, 1);

    const bands = HARMONICS.map(([h, strength]) => {
      // Frequency rests at zero and the curve, scaled to the tonic, adds the
      // whole of it.
      const bp = filter(ctx, 'bandpass', 0, Q_REF);
      const scale = gain(ctx, 0);
      split.connect(scale, 0);
      scale.connect(slowParam(bp.frequency));
      src.connect(bp).connect(gain(ctx, strength)).connect(level);
      return { bp, scale, h };
    });

    const pick = gain(ctx, 0);
    level.connect(pick).connect(out);
    return { id, tune, curve, bands, pick };
  });

  return {
    out,
    set(s, put) {
      const q = qFor(s.clear);
      // A narrower band passes less noise, by the square root of Q, so this
      // keeps "clearer" from also meaning "quieter".
      put(out.gain, LEVEL.melody * fader(s.melody) * Math.sqrt(q / Q_REF));
      for (const { id, tune, curve, bands, pick } of voices) {
        put(pick.gain, id === s.tune ? 1 : 0);
        put(curve.playbackRate, 1 / secondsPerBeat(s.slow));
        const tonic = tonicFor(tune, s.key);
        for (const { bp, scale, h } of bands) {
          put(scale.gain, tonic * h);
          put(bp.Q, q);
        }
      }
    },
  };
}

/**
 * Six breaths a minute: in for four seconds, out for six. Exactly periodic
 * on purpose, because she is meant to be able to breathe along with it.
 */
const breathShape = (t) => (t < 0.4
  ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.4)
  : 0.5 + 0.5 * Math.cos((Math.PI * (t - 0.4)) / 0.6));
/** At full, the swell goes from 30% to 100%. It never goes quiet, so it
 *  cannot come back in with an edge. */
const BREATH_DEPTH = 0.7;
const ROOM_WET = 0.6;

/**
 * WHAT EACH LAYER IS BUILT FROM. A fixed bed skips any layer whose fader is
 * at zero, and that is not tidiness: a layer at zero gain is still computed
 * in full. Measured offline on this machine, the whole graph renders at
 * about realtime with every fader at zero, so a layer nobody hears still
 * costs a phone as much as one everybody does.
 */
const LAYERS = Object.freeze({
  bed: bedLayer, choir: choirLayer, om: omLayer, chant: chantLayer,
  bowl: bowlLayer, strike: strikeLayer, melody: melodyLayer,
});

/**
 * The gain both pages put in front of the limiter, so the bed sounds exactly
 * like the desk it was chosen on. At the owner's mix the layers peak near 1.3,
 * so the limiter really works: it is part of the sound he chose, not a
 * safety net that never fires.
 */
export const OUTPUT_GAIN = 0.8;

/** The limiter both pages end in. Returns its input. */
export function limiter(ctx, dest) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -6;
  c.knee.value = 6;
  c.ratio.value = 20;
  c.attack.value = 0.003;
  c.release.value = 0.25;
  c.connect(dest);
  return c;
}

/**
 * Build the layers into `dest`, starting at `t0`.
 *
 * The bed goes straight out, steady and dry, because it is the floor. The
 * choir, om, chant, rubbed bowl and melody share a bus that breathes and feeds
 * the room. The strikes go to the room without breathing, since breath on a
 * decaying strike would only make its tail lurch.
 *
 * `live: true` (the desk) builds every layer so any fader can move.
 * `live: false` (the bed) builds only what the settings can be heard to use.
 *
 * Returns { set(settings) } for live changes. Every source it started is
 * pushed onto `sources`, for the caller to stop.
 */
export function buildDesk(ctx, dest, t0, sources, settings, { live = true } = {}) {
  const first = normalise(settings);
  const layers = {};
  for (const [k, make] of Object.entries(LAYERS)) {
    if (live || first[k] > 0) layers[k] = make(ctx, sources, t0);
  }

  // The room is built only if something will be heard in it.
  //
  // ⚠️ IT IS THE MOST EXPENSIVE THING IN THIS GRAPH. Measured offline at the
  // owner's mix: 10 seconds rendered in 3.1 to 4.2 s with the room and 0.7 to
  // 2.0 s without it. A plain bed renders the same 10 seconds in about 0.13 s.
  // Offline rendering runs every stage of the convolution inline, which a live
  // browser spreads onto a background thread, so this overstates the live
  // cost. If a phone ever struggles, `room=0` is the fix, and a fixed bed then
  // builds no convolver at all.
  let room = null;
  const wet = gain(ctx, 0);
  if (live || first.room > 0) {
    room = ctx.createConvolver();
    const [L, R] = impulseResponse(ctx.sampleRate, { seconds: 4, size: 0.9 });
    const ir = ctx.createBuffer(2, L.length, ctx.sampleRate);
    ir.getChannelData(0).set(L);
    ir.getChannelData(1).set(R);
    room.buffer = ir;
    room.connect(wet).connect(dest);
  }

  const breath = gain(ctx, 1);
  const breathSpan = gain(ctx, 0);
  loopSource(ctx, sources, slowLoop(ctx, 10, breathShape), t0).connect(breathSpan).connect(breath.gain);
  breath.connect(dest);
  if (room) breath.connect(room);

  layers.bed?.out.connect(dest);
  for (const k of ['choir', 'om', 'chant', 'bowl', 'melody']) layers[k]?.out.connect(breath);
  if (layers.strike) {
    layers.strike.out.connect(dest);
    if (room) layers.strike.out.connect(room);
  }

  function apply(s, put) {
    for (const layer of Object.values(layers)) layer.set(s, put);
    put(breath.gain, 1 - BREATH_DEPTH * s.breathe);
    put(breathSpan.gain, BREATH_DEPTH * s.breathe);
    put(wet.gain, ROOM_WET * s.room);
  }

  apply(first, (param, v) => { param.value = v; });

  return {
    set(next) {
      apply(normalise(next), (param, v) => param.setTargetAtTime(v, ctx.currentTime, GLIDE));
    },
  };
}
