// The Ritual palette (dec:what-the-sleep-token-palette-is-called) — quiet, then
// crushing, in a very large room.
//
// Pure like the rest: sample rate in, Float32Array out, no Web Audio and no DOM
// (dec:two-speed-synthesis).
//
// NAMED FOR THE SOUND RATHER THAN THE BAND, deliberately and on the record. The
// design says openly where this came from — req:sleep-token-palette,
// cap:sleep-token-sound, art:sleep-token-midi-corpus all name them — and the
// shipped site does not. Nothing here copies a recording, a melody or a
// composition; it is synthesis in a style, and a style is not owned.
//
// EVERY NUMBER IN THIS FILE TRACES TO A MEASUREMENT, which is what
// req:palette-numbers-are-measured asks for. The corpus of 20 MIDI files was
// read on 2026-09-06 (chg:corpus-numbers-measured) and it said: 19 of 20 in
// 4/4, tempo in two clusters with the slow one at 58-73, and notes fitting the
// natural minor 82% of the time against the minor pentatonic's 68%.
//
// WHAT THE IDIOM ACTUALLY IS, and it is not a timbre set. It is CONTRAST — the
// same few chords played hushed and then played crushing. This palette supplies
// both ends and cannot yet supply the change between them, because the engine
// has no sections. That is dec:a-segment-is-a-whole-track's job and it is not
// built. Until it is, this is the two halves without the hinge.

import {
  lin, exp, shape, alloc, noiseSource, normalize, fadeOut, onePole,
  pluck, formantBank, sawPair, clamp01,
} from './synth.js';
import { renderKick, renderSnare } from './dsp.js';

// ---------------------------------------------------------------------------
// The feel
// ---------------------------------------------------------------------------

/**
 * 72 bpm, straight, and a very large room.
 *
 * TEMPO IS MEASURED, NOT CHOSEN. The corpus splits cleanly in two: a slow
 * cluster at 58-73 and a driving one at 120-135. 72 is the slow cluster's
 * median and two songs sit exactly on it. At 72 a backbeat lands slowly while
 * sixteenths run underneath at 288 a minute, which is the half-time-with-
 * double-time-hats feel req:drums-in-the-gospel-idiom names.
 *
 * SWING IS ZERO, and that is a decision rather than a default. Phonk's shuffle
 * would be badly wrong here: the hats that define these heavy sections are dead
 * straight sixteenths. The triplet feel gospel drumming also carries belongs to
 * FILLS, which a fixed grid cannot express — and the corpus backs the choice,
 * with 19 of 20 files in 4/4 and exactly one in 12/8.
 *
 * THE ROOM IS THE LOUDEST THING IN THE PALETTE. Big, long and only lightly
 * damped, so the tail stays present rather than turning to mud. It is the one
 * setting that has to be right for a quiet piano and a wall of guitar to sound
 * like they are in the same place, which is most of what this production is.
 */
export const RITUAL = {
  bpm: 72,
  swing: 0,
  room: { size: 0.93, damp: 0.32, spread: 31, mix: 0.42 },
};

// ---------------------------------------------------------------------------
// The felt piano
// ---------------------------------------------------------------------------

/**
 * A piano with felt over the hammers — the sound the quiet half is built on.
 *
 * Karplus-Strong rather than an additive model, for the reason js/synth.js gives
 * about the requinto: what the ear hears as a string is the top harmonics dying
 * first, and that falls out of the feedback loop for free.
 *
 * `pick` IS PHYSICALLY TRUE HERE RATHER THAN A TASTE SETTING. A real piano
 * hammer strikes at about an eighth of the string's length, which cancels the
 * eighth harmonic and is a large part of why a piano sounds like a piano rather
 * than like a harpsichord. 0.125 is that number, not a number that sounded nice.
 *
 * Felt is then the rest of it: `tone` low, because the cloth absorbs the top of
 * the strike before it ever reaches the string, and `body` high, because a
 * quiet close-mic'd piano is mostly the case resonating.
 */
const FELT_PIANO = {
  damp: 0.44, decay: 0.99885, pick: 0.125, tone: 0.26,
  body: 0.34, bodyHz: 0.30, dur: [1.8, 5.2], peak: 0.62, seed: 0x5f17,
};

export function renderFeltPiano(sr, hz, s, opts) {
  return pluck(sr, hz, FELT_PIANO, s, opts);
}

// ---------------------------------------------------------------------------
// The choir
// ---------------------------------------------------------------------------

/**
 * The wordless line, and it is a CHOIR rather than a singer — which is a
 * constraint decision, not a stylistic one.
 *
 * con:playable-by-two-hands says a voice has one note. A single wordless singer
 * given four lanes could be made to sing a chord, which no person can do, and
 * the constraint would be broken by the palette's own lane table. A stacked
 * choir is several people, so polyphony is legal, and it is also what these
 * records actually do — the vocal is layered many times over.
 *
 * A dark rounded vowel between /o/ and /u/. Bright enough to carry over the
 * piano, dark enough that it never turns into a synth pad.
 */
const CHOIR_VOWEL = [
  { hz: 400, q: 11, g: 1.0 },
  { hz: 830, q: 13, g: 0.55 },
  { hz: 2600, q: 16, g: 0.16 },
  { hz: 3400, q: 18, g: 0.07 },
];

/** Three singers, each a little out of tune with the others. Perfectly tuned
 *  unison sounds like one synthetic voice; this is what a section sounds like. */
const CHOIR_STACK = [
  { mul: 1.0, det: 1.0016, g: 1.0 },
  { mul: 1.0, det: 1.0037, g: 0.72 },
  { mul: 0.5, det: 0.9971, g: 0.34 },   // one voice an octave below
];

export function renderChoir(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 2.4, 6.5);
  const out = alloc(sr, dur);

  // A voice does not start instantly and does not stop instantly.
  const attack = lin(c.punchier, 1.1, 0.35);
  const release = 0.55;

  const oscs = CHOIR_STACK.map((v) => sawPair(v.det));
  const bank = formantBank(CHOIR_VOWEL);
  const rnd = noiseSource(0xc401);
  const breathA = onePole(2400, sr);
  const vibA = exp(clamp01(c.dirtier), 4.4, 5.4);
  let breath = 0, vph = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;

    // Vibrato arrives rather than being present from the first sample, which is
    // what a held human note does and what makes it read as sung.
    vph += (2 * Math.PI * vibA) / sr;
    const depth = 0.0035 * Math.min(1, t / 0.9);
    const bend = 1 + Math.sin(vph) * depth;

    let src = 0;
    for (let k = 0; k < CHOIR_STACK.length; k++) {
      src += oscs[k](hz * CHOIR_STACK[k].mul * bend, sr) * CHOIR_STACK[k].g;
    }

    // A little air over the top. Without it the formants read as a filter sweep
    // rather than as a throat.
    breath += breathA * (rnd() - breath);
    let x = bank(src * 0.42 + breath * 0.16, sr);

    const up = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const left = dur - t;
    const down = left < release ? left / release : 1;
    out[i] = x * up * down;
  }
  return normalize(fadeOut(out, sr, 40), 0.55);
}

// ---------------------------------------------------------------------------
// The riff
// ---------------------------------------------------------------------------

/**
 * The drop-tuned, palm-muted eight-string that arrives in the last round.
 *
 * THE HARD ONE, and the part of the palette with no precedent in this project.
 * Everything else here is a variation on something js/synth.js already does; a
 * distorted guitar is genuinely different, and the difference is that
 * distortion is not an effect applied to a note — it IS the instrument.
 *
 * Three stages, in the order a real signal chain has them:
 *
 * 1. THE STRING, palm-muted. A mute is not a quieter pluck, it is a much faster
 *    decay: the heel of the hand loads the string and it dies in a few hundred
 *    milliseconds instead of ringing. That is `decay` well below the requinto's
 *    and a short `dur`, and it is what makes a riff articulate rather than
 *    smear.
 *
 * 2. THE AMP. A hard asymmetric saturation. Asymmetric matters — a symmetric
 *    curve makes only odd harmonics and sounds like a fuzz pedal; letting the
 *    two halves clip differently adds the even harmonics that read as a valve
 *    amp being pushed.
 *
 * 3. THE CABINET, and SKIPPING THIS IS WHY AMATEUR DISTORTION SOUNDS LIKE
 *    CLIPPING. A speaker in a box is a fierce bandpass: nothing above about
 *    5 kHz and nothing below about 80 Hz leaves it. Raw saturation without it
 *    is all fizz, which is the single most audible difference between a guitar
 *    and a waveshaper.
 */
const RIFF_STRING = {
  // Brighter and drier than the first attempt. Active pickups (Fishman Fluence
  // on the real thing) are high-output and low-noise with very little of the
  // guitar's own box in the signal, so `body` is near zero and `damp` is up:
  // what reaches the amp is the string, not the room around it. `pick` stays
  // near the bridge, which is where a chug is played.
  damp: 0.47, decay: 0.9869, pick: 0.085, tone: 0.52,
  body: 0.02, dur: [0.40, 1.4], peak: 0.95, seed: 0x8b22,
};

export function renderRiff(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, RIFF_STRING.dur[0], RIFF_STRING.dur[1]);
  const raw = pluck(sr, hz, RIFF_STRING, s, { seconds: dur });
  const out = alloc(sr, dur);

  // ── the screamer ────────────────────────────────────────────────────────
  // Highpass BEFORE the gain, which is the whole trick and the thing the first
  // version of this function got backwards. A drop-tuned fundamental pushed
  // into a clipper intermodulates with everything above it and the result is
  // mud; take the bottom out first and the SAME clipper produces an articulate
  // chug. That is what a Tube Screamer in front of an amp is for, and it is why
  // these records stay legible at this tuning.
  const tsHpA = onePole(230, sr);
  const tsMidA = onePole(760, sr);
  const tsBoost = lin(c.punchier, 2.2, 5.0);
  let tsHp = 0, tsMid = 0;

  // ── the amp ─────────────────────────────────────────────────────────────
  // Asymmetric: a symmetric curve makes only odd harmonics and reads as a fuzz
  // pedal, and letting the halves clip differently adds the even ones that read
  // as a valve amp being pushed.
  const drive = lin(c.dirtier, 9, 34);

  // ── the cabinet ─────────────────────────────────────────────────────────
  // A speaker in a box is a fierce bandpass, and skipping it is why amateur
  // distortion sounds like clipping. Two poles on the top rather than one,
  // because a single pole leaves fizz a real cone cannot produce; a presence
  // bump where a Mesa lives; and a cut at 250Hz, which is the boxiness these
  // productions carve out — NOT a mid scoop, which would take the riff's
  // articulation with it.
  const cabA = onePole(exp(clamp01(c.deeper), 6400, 4700), sr);
  const cabB = onePole(exp(clamp01(c.deeper), 6400, 4700), sr);
  const lowA = onePole(94, sr);
  const boxA = onePole(250, sr);
  const boxB = onePole(430, sr);
  const presA = onePole(2100, sr);
  const presB = onePole(4200, sr);
  let cab1 = 0, cab2 = 0, low = 0, box1 = 0, box2 = 0, pres1 = 0, pres2 = 0;

  // ── the sub ─────────────────────────────────────────────────────────────
  // SYNTHESIZED, NOT FILTERED OFF THE STRING, and that correction came from a
  // measurement: only 4.5% of this string's energy survives a 118Hz lowpass.
  // Plucked near the bridge a Karplus-Strong string has almost no fundamental,
  // so the first version of this "clean sub" was routing something that was not
  // there.
  //
  // Generating it is what these productions actually do — the guitar is layered
  // with a synth sub so the guitar carries the clack and the sub carries the
  // weight, and neither has to do both. It is the same split as running a bass
  // through a sub amp and a dirty top amp at once.
  //
  // LIGHTLY SATURATED ON PURPOSE. A pure sine at 65Hz is inaudible on a phone.
  // Bending it gives harmonics the ear reconstructs the fundamental from, which
  // is the missing-fundamental trick dec:idea-the-drop and dec:drone-voiced-up
  // both already rely on: the weight is FELT where it cannot be heard.
  const subDecay = Math.exp(-1 / (sr * dur * 0.42));
  let subPh = 0, subEnv = 0;

  for (let i = 0; i < raw.length && i < out.length; i++) {
    const x = raw[i];

    // Screamer: highpass, then a hump around 760Hz, then a soft first clip.
    tsHp += tsHpA * (x - tsHp);
    const hp = x - tsHp;
    tsMid += tsMidA * (hp - tsMid);
    const boosted = (hp + tsMid * 0.9) * tsBoost;
    const stage1 = Math.tanh(boosted);

    // Amp, asymmetric.
    const v = stage1 * drive;
    let a = v >= 0 ? Math.tanh(v) : Math.tanh(v * 0.74) * 0.88;

    // Cabinet: two-pole top, low cut, presence bump, boxiness cut.
    cab1 += cabA * (a - cab1);
    cab2 += cabB * (cab1 - cab2);
    low += lowA * (cab2 - low);
    let y = cab2 - low;

    box1 += boxA * (y - box1);
    box2 += boxB * (y - box2);
    // A bandpass from two lowpasses is lp(HIGHER) - lp(lower); written the other
    // way round it changes sign and the dip becomes a boost. Measured that
    // mistake here first: raising the coefficient made 250-800Hz grow.
    y -= (box2 - box1) * 0.85;                 // dip around 250-430Hz

    pres1 += presA * (y - pres1);
    pres2 += presB * (y - pres2);
    y += (pres2 - pres1) * 0.85;               // bump around 2-4kHz

    // The sub: a sine at the fundamental, following the note rather than the
    // string. Its attack is a couple of milliseconds so it arrives WITH the
    // pick rather than swelling in behind it.
    subPh += (2 * Math.PI * hz) / sr;
    const target = i < sr * 0.002 ? i / (sr * 0.002) : 1;
    subEnv = subEnv * subDecay + (1 - subDecay) * 0;
    if (i === 0) subEnv = 1;
    const sub = Math.tanh(Math.sin(subPh) * 1.9) * 0.72 * subEnv * target;

    out[i] = y * 0.86 + sub * 0.62;
  }
  return normalize(fadeOut(out, sr, 20), 0.86);
}

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

/**
 * FOUR DRUMS, AND THE GHOST IS ONE OF THEM (dec:two-samples-per-drum).
 *
 * A ghost note is a quiet snare stroke between the loud ones, and
 * req:drums-in-the-gospel-idiom calls it the single most identifying feature of
 * the idiom. The engine has no velocity — measured, there is none anywhere in
 * js/ — so a ghost has to be a SOUND rather than a level.
 *
 * THAT IS WHY IT IS A SECOND RENDER AND NOT A GAIN. The decision rejected the
 * cheap option on the grounds that a drum struck softly is duller, shorter and
 * has less shell in it than the same drum struck hard and turned down. Those
 * three differences are exactly what `punchier`, `longer` and `dirtier` control,
 * so the honest version costs one more table entry and no engine change at all.
 *
 * THE CORPUS AGREES, for what a transcription is worth: the Summoning drum solo
 * notates its snare down to velocity 32 against a median of 80, and caramel puts
 * 26% of its kicks at least 20 below median. Ghosts are deliberately written,
 * even by a transcriber reducing everything to four levels.
 */
const KIT_SHAPE = {
  // Big and long. These records have an enormous kick and a snare with a room
  // on it, which is the opposite of the phonk kit's dry close crack.
  kick: { deeper: 0.88, punchier: 0.38, dirtier: 0.30, longer: 0.82 },
  snare: { deeper: 0.55, punchier: 0.78, dirtier: 0.42, longer: 0.62 },
  // The ghost: duller, shorter, less shell. Not the snare turned down.
  ghost: { deeper: 0.60, punchier: 0.12, dirtier: 0.18, longer: 0.22 },
  hat: { deeper: 0.42, punchier: 0.70, dirtier: 0.35, longer: 0.18 },
};

/** The ghost is quieter as WELL as duller — both, not either. */
const GHOST_LEVEL = 0.34;

export function renderRitualKick(sr) { return renderKick(sr, KIT_SHAPE.kick); }
export function renderRitualSnare(sr) { return renderSnare(sr, KIT_SHAPE.snare); }
/**
 * THE HAT IS OURS RATHER THAN THE SHARED ONE, AND THAT IS A BUG REPORT.
 *
 * js/dsp.js's renderHat produces NaN from about 20ms in, at every sample rate
 * and with the neutral shape — its "air" stage runs the Chamberlin filter at
 * 11 kHz with q 0.7, and that combination is unconditionally unstable, so the
 * state runs away to infinity. Measured 2026-09-06 in the SHIPPED KIT, where
 * the NaN was written out as silence: kit/hat.wav is audible for 19.8ms of
 * 82.5ms, and kit/openhat.wav for 19.8ms of 280ms. The open hat is not open.
 *
 * THAT DEFECT IS NOW FIXED (dec:fix-the-hat-filter): svfStep clamps against the
 * real stability bound and the kit has been rebaked. This hat stays its own
 * anyway, and not out of momentum — it has its own partials and its own shape,
 * tuned for a big room rather than for a dry phonk kit, and the shared renderHat
 * is phonk's sound by design. Reaching for it here would make Ritual's hat the
 * same hat as hers, which is the one thing a palette is supposed not to be.
 *
 * It also avoids the unstable path by construction rather than by clamp. A one-pole is stable at any
 * cutoff and any rate, and a highpass is just the signal minus its own
 * lowpass — which is all the shared version needed the state-variable filter
 * for. Same construction otherwise: inharmonic square partials for the metal,
 * a little noise so it breathes, a hard tick over a shorter shimmer.
 */
const HAT_METAL = [418, 587, 719, 843, 1071, 1268];

export function renderRitualHat(sr) {
  const c = shape(KIT_SHAPE.hat);
  const dur = lin(c.longer, 0.05, 0.115);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0xf00d);
  const drive = exp(c.dirtier, 1.2, 3.6);
  const cutoff = lin(c.deeper, 8200, 5000);

  // Two one-poles, used as highpasses by subtraction. Stable everywhere.
  const bodyA = onePole(Math.min(cutoff, sr * 0.45), sr);
  const airA = onePole(Math.min(11000, sr * 0.45), sr);
  const phases = new Float64Array(HAT_METAL.length);
  let bodyLp = 0, airLp = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;

    let metal = 0;
    for (let k = 0; k < HAT_METAL.length; k++) {
      phases[k] += (2 * Math.PI * HAT_METAL[k]) / sr;
      metal += Math.sin(phases[k]) >= 0 ? 1 : -1;
    }
    metal /= HAT_METAL.length;

    bodyLp += bodyA * (metal - bodyLp);
    const n = rnd();
    airLp += airA * (n - airLp);

    // A hard tick on the front, a shorter shimmer behind it.
    const env = Math.exp(-t / 0.004) * 0.5 + Math.exp(-t / (dur * 0.30)) * 0.85;
    const x = ((metal - bodyLp) + (n - airLp) * 0.28) * env;
    out[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return normalize(fadeOut(out, sr, 3), 0.58);
}

export function renderRitualGhost(sr) {
  const buf = renderSnare(sr, KIT_SHAPE.ghost);
  for (let i = 0; i < buf.length; i++) buf[i] *= GHOST_LEVEL;
  return buf;
}

/**
 * WHICH LIMB PLAYS WHAT, for con:playable-by-four-limbs and the check that
 * enforces it (ver:drums-are-playable).
 *
 * ⚠️ THIS LANE SET HAS A KNOWN ILLEGAL COMBINATION AND IT IS RECORDED RATHER
 * THAN DESIGNED AWAY. Kick is a foot; snare, ghost and hat are all hands. So:
 *
 *   kick + snare + hat          fine — one foot, two hands
 *   kick + ghost + hat          fine — the same, quietly
 *   snare + ghost               INCOHERENT — one drum cannot be struck loudly
 *                               and softly at the same instant
 *   snare + ghost + hat         needs three hands
 *
 * The check is the right place to catch it, not the lane table: narrowing the
 * lanes to make a planned check pass would be answering the check instead of
 * the music, and these four are the four drums the corpus actually uses most.
 */
export const RITUAL_LIMBS = {
  kick: 'foot', snare: 'hand', ghost: 'hand', hat: 'hand',
};

export const RITUAL_VOICES = {
  piano: (sr, hz, s, o) => renderFeltPiano(sr, hz, s, o),
  choir: (sr, hz, s, o) => renderChoir(sr, hz, s, o),
  riff: (sr, hz, s, o) => renderRiff(sr, hz, s, o),
  kick: (sr) => renderRitualKick(sr),
  snare: (sr) => renderRitualSnare(sr),
  ghost: (sr) => renderRitualGhost(sr),
  hat: (sr) => renderRitualHat(sr),
};
