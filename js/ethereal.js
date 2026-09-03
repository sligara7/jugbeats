// The calm palette (proj:sleep) — the same engine, making Enya instead of phonk.
//
// Governed by dec:ethereal-not-a-sleep-lab: the owner wants the loop pedal his
// daughter already has, with an ethereal, peaceful sound. So this file changes
// only what SOUNDS, and nothing about how the game works.
//
// Everything here is pure in the same way js/dsp.js is: sample rate in,
// Float32Array out, no Web Audio and no DOM. That is what lets the forge render
// a WAV to listen to and the browser fill the same buffers at load time
// (dec:two-speed-synthesis).
//
// WHAT MAKES THIS SOUND DIFFERENT FROM THE PHONK KIT, in order of how much it
// matters. Measured against the code on 2026-09-02:
//
//   1. REVERB. There was none anywhere in this project. It is most of the
//      identity of the genre — the notes are ordinary, the SPACE is the sound.
//   2. ATTACKS. The phonk voices attack in 4-6ms because they are struck. These
//      swell over hundreds of milliseconds because they are bowed, blown or rung.
//   3. NO SWING and a slow tempo. Around 60-80bpm and straight, which is also
//      where the sleep-music evidence lands (dec:idea-evidence-led-sleep-design).
//   4. INHARMONIC PARTIALS on the struck sounds. A bell is not a harmonic series,
//      and that is why a bell sounds like a bell and not like a soft organ.
//
// The SCALE does not change. That music is overwhelmingly modal and minor, and
// the engine is already locked to a minor pentatonic (dec:pentatonic-for-chords)
// with a passing check behind it. Only the voicing opens out.

import { NEUTRAL } from './dsp.js';

const lin = (v, lo, hi) => lo + (hi - lo) * v;
const exp = (v, lo, hi) => lo * Math.pow(hi / lo, v);
const shape = (s) => ({ ...NEUTRAL, ...(s || {}) });
const alloc = (sr, seconds) => new Float32Array(Math.max(1, Math.ceil(sr * seconds)));

/** Deterministic noise, seeded, so the forge renders byte-identically. */
function noiseSource(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function normalize(buf, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / max;
  return buf;
}

function fadeOut(buf, sr, ms = 30) {
  const n = Math.min(buf.length, Math.floor((ms / 1000) * sr));
  for (let i = 0; i < n; i++) buf[buf.length - n + i] *= 1 - i / n;
  return buf;
}

/**
 * A swell rather than a strike. `attack` is how long it takes to arrive and
 * `release` how long it takes to leave; in between it simply holds.
 *
 * This is the single envelope difference between the two palettes. A 6ms attack
 * says something was hit; a 700ms attack says something is being bowed, and the
 * ear decides which instrument it is hearing largely on that basis.
 */
function swellAt(t, seconds, attack, release) {
  if (t >= seconds) return 0;
  const up = t < attack ? t / attack : 1;
  const left = seconds - t;
  const down = left < release ? left / release : 1;
  // Raised cosine on both edges: a linear ramp has a corner, and a corner is a
  // transient, which is the thing this palette exists to avoid.
  const g = up * down;
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, g));
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * A Schroeder/Freeverb-style reverb: parallel comb filters build the density,
 * series allpasses smear it so it stops sounding like distinct echoes.
 *
 * ALGORITHMIC RATHER THAN CONVOLUTION, and the reason is this project's own
 * constraints. There is no FFT in this codebase and convolving a four-second
 * tail over a whole loop sample-by-sample is hopeless offline; an impulse
 * response file would be hundreds of kilobytes on a project that ships static
 * files with no build step. This runs streaming, in both places, from nothing.
 *
 * THE BROWSER STILL GETS A ConvolverNode, and gets it from HERE: run one impulse
 * through this and the result IS an impulse response (see `impulseResponse`).
 * One implementation, one sound, both speeds — the same rule dec:two-speed-
 * synthesis applies to the voices.
 */
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];

export function makeRoom(sr, { size = 0.85, damp = 0.35, spread = 23 } = {}) {
  // The classic tunings are quoted at 44.1k; scale them so a 48k context gets
  // the same room rather than a slightly smaller one.
  const k = sr / 44100;
  const mk = (n, off) => ({ buf: new Float32Array(Math.max(1, Math.round(n * k) + off)), i: 0, store: 0 });

  const combs = COMBS.map((n) => mk(n, 0));
  const combsR = COMBS.map((n) => mk(n, spread));
  const aps = ALLPASS.map((n) => mk(n, 0));
  const apsR = ALLPASS.map((n) => mk(n, spread));

  const feedback = 0.28 + 0.7 * size;   // 0.98 at size 1 — a long, slow tail
  const d1 = damp, d2 = 1 - damp;

  const comb = (c, x) => {
    const out = c.buf[c.i];
    c.store = out * d2 + c.store * d1;          // lowpass in the loop: air absorbs highs
    c.buf[c.i] = x + c.store * feedback;
    if (++c.i >= c.buf.length) c.i = 0;
    return out;
  };
  const allpass = (a, x) => {
    const bufout = a.buf[a.i];
    const out = -x + bufout;
    a.buf[a.i] = x + bufout * 0.5;
    if (++a.i >= a.buf.length) a.i = 0;
    return out;
  };

  const run = (x, cs, as) => {
    let y = 0;
    for (const c of cs) y += comb(c, x * 0.015);
    for (const a of as) y = allpass(a, y);
    return y;
  };

  return {
    /** One sample in, a stereo pair out. */
    step(x) {
      return [run(x, combs, aps), run(x, combsR, apsR)];
    },
  };
}

/**
 * Wet/dry a mono buffer into a stereo pair. `mix` of 1 is all reverb.
 *
 * The tail is allowed to run past the end of the input — `tailSeconds` of extra
 * room — because cutting a reverb off at the last note is the one thing that
 * makes a big space sound fake.
 */
export function reverb(mono, sr, { mix = 0.45, tailSeconds = 3.5, ...room } = {}) {
  const n = mono.length + Math.floor(sr * tailSeconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = makeRoom(sr, room);
  for (let i = 0; i < n; i++) {
    const x = i < mono.length ? mono[i] : 0;
    const [wl, wr] = r.step(x);
    L[i] = x * (1 - mix) + wl * mix;
    R[i] = x * (1 - mix) + wr * mix;
  }
  return [fadeOut(L, sr, 200), fadeOut(R, sr, 200)];
}

/**
 * The room as an impulse response, for a browser ConvolverNode.
 *
 * Feeding one impulse through the same filters gives exactly the tail those
 * filters produce, so the page and the forge cannot drift apart into two
 * different-sounding rooms.
 */
export function impulseResponse(sr, { seconds = 3.5, ...room } = {}) {
  const n = Math.ceil(sr * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = makeRoom(sr, room);
  for (let i = 0; i < n; i++) {
    const [wl, wr] = r.step(i === 0 ? 1 : 0);
    L[i] = wl;
    R[i] = wr;
  }
  // Taper the very end so the convolution tail cannot end on a step.
  const t = Math.floor(n * 0.25);
  for (let i = 0; i < t; i++) {
    const g = 1 - i / t;
    L[n - t + i] *= g;
    R[n - t + i] *= g;
  }
  return [L, R];
}

// ---------------------------------------------------------------------------
// The voices
// ---------------------------------------------------------------------------

/**
 * The pad. What the 808 slot becomes in this palette.
 *
 * Bowed rather than struck: a long swell, many detuned partials, and a filter
 * that opens as the note arrives so it seems to come from somewhere rather than
 * to switch on. The detuning is the whole trick — three voices a few cents apart
 * beat slowly against each other, and that slow beating is what a listener hears
 * as "warm" rather than "synthetic".
 */
export function renderPadVoice(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 1.6, 6.0);
  const attack = lin(c.punchier, 1.1, 0.25);      // punchier = arrives sooner
  const out = alloc(sr, dur);

  // An open voicing: root, octave, fifth above, and a soft twelfth. No third —
  // the same reasoning as the drone (dec:drone-voiced-up): a third commits to a
  // mode and starts arguing with whatever melody gets played over it.
  const partials = [
    { m: 0.5,   g: 0.30, d: 1.0000 },
    { m: 1.0,   g: 1.00, d: 1.0000 },
    { m: 1.0,   g: 0.65, d: 1.0027 },   // detuned twin — the slow beat
    { m: 1.0,   g: 0.60, d: 0.9971 },
    { m: 1.5,   g: 0.42, d: 1.0019 },
    { m: 2.0,   g: 0.26, d: 1.0000 },
    { m: 3.0,   g: 0.10, d: 1.0031 },
    // AIR. Measured without these, the pad had nothing at all above 2 kHz —
    // 111 dB down — because no partial reached that far. Warm became muffled.
    // These sit far up and very quiet: not heard as pitch, only as the sheen
    // that separates a pad in a big room from a pad under a blanket.
    { m: 4.0,   g: 0.055, d: 1.0043 },
    { m: 6.0,   g: 0.030, d: 0.9963 },
    { m: 8.0,   g: 0.018, d: 1.0051 },
  ];
  const ph = new Float64Array(partials.length);
  let lp = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let x = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += (2 * Math.PI * hz * partials[k].m * partials[k].d) / sr;
      x += Math.sin(ph[k]) * partials[k].g;
    }
    x /= 3.3;
    const env = swellAt(t, dur, attack, dur * 0.45);
    // The filter opens with the swell, so the sound brightens as it arrives.
    const cutoff = exp(c.deeper, 1200, 5000) * (0.4 + 0.6 * env);
    const a = 1 - Math.exp((-2 * Math.PI * Math.min(cutoff, sr * 0.45)) / sr);
    lp += a * (x * env - lp);
    out[i] = lp;
  }
  return normalize(fadeOut(out, sr, 40), 0.72);
}

/**
 * The bell. What the melody slot becomes.
 *
 * INHARMONIC ON PURPOSE, and this is what makes it a bell rather than a soft
 * organ. A struck metal bar does not vibrate in a harmonic series — its partials
 * sit at irregular ratios, and the ear reads exactly that irregularity as
 * "metal". The ratios below are the classic tubular-bell-ish set.
 *
 * Each partial also decays at its own rate, faster the higher it is, which is
 * the other half: a real bell loses its brightness long before it goes quiet.
 */
/**
 * THE IDIOPHONE TABLE — the whole metallic and crystalline palette, as data.
 *
 * The owner supplied a list: handpan, steel tongue drum, celesta, vibraphone,
 * crotales, quartz singing bowls, glass harmonica, bell and bar trees. Almost
 * every one of them is THE SAME SYNTHESIS MODEL — a struck or rubbed rigid body,
 * which is a sum of exponentially decaying partials. What makes a handpan a
 * handpan and a vibraphone a vibraphone is only three things: WHERE the partials
 * sit, HOW FAST each one dies, and HOW HARD the thing is hit.
 *
 * So the palette is a table rather than a file of near-identical functions, and
 * adding the next instrument costs a row.
 *
 * `m` — partial ratios. THE FIRST ONE IS ALWAYS 1, and that is load-bearing:
 *   used raw, the textbook bell ratios start at 0.56 and put the perceived pitch
 *   nine semitones below the note requested, which measured that way and would
 *   have silently broken the scale lock (dec:pentatonic-for-chords) in the one
 *   voice nobody would think to check. Every set here is divided by its own
 *   first term, keeping the inharmonic RATIOS — which is what the ear reads as
 *   metal or glass — while putting the fundamental where the caller asked.
 * `g` — relative level of each partial.
 * `d` — decay multiplier: higher dies sooner. Real bars lose brightness long
 *   before they go quiet, which is why these rise with the partial number.
 * `attack` — seconds. Struck is milliseconds; rubbed and bowed is a swell.
 * `trem` — Hz of amplitude tremolo, or 0. The vibraphone's motorised resonators
 *   are its entire signature and cost one multiply.
 */
const RATIOS = (arr) => arr.map((v) => v / arr[0]);

export const IDIOPHONES = {
  // Tuned so the first overtones are an octave and a twelfth — 1:2:3, nearly
  // harmonic. THAT is why a handpan sounds consonant and hypnotic where a bell
  // sounds ominous: it is the one struck metal instrument deliberately tuned to
  // agree with itself. Long decay, soft hand strike.
  handpan: { m: RATIOS([1, 2, 3, 4.1, 5.2, 6.9]), g: [1, 0.5, 0.34, 0.12, 0.07, 0.04],
             d: [1, 1.5, 1.9, 2.8, 3.4, 4.2], attack: 0.004, decay: 3.0, peak: 0.66 },

  // The handpan's smaller cousin: the tongues are shorter so the overtones are
  // less perfectly tuned and it rings drier and more self-contained.
  tongue:  { m: RATIOS([1, 2.02, 3.06, 4.4, 6.1]), g: [1, 0.42, 0.26, 0.1, 0.05],
             d: [1, 1.7, 2.3, 3.2, 4.0], attack: 0.003, decay: 3.6, peak: 0.62 },

  // Felt hammers on steel plates: bright, delicate, short. The music box.
  celesta: { m: RATIOS([1, 4.05, 9.6, 16.2]), g: [1, 0.26, 0.09, 0.03],
             d: [1, 2.4, 3.6, 5.0], attack: 0.002, decay: 5.5, peak: 0.55 },

  // Aluminium bar modes sit near 1:4:10. The motor is the signature — without
  // the tremolo this is just a dull marimba.
  vibes:   { m: RATIOS([1, 4, 10, 18]), g: [1, 0.3, 0.1, 0.03],
             d: [1, 2.0, 3.0, 4.5], attack: 0.003, decay: 3.2, trem: 5.5, peak: 0.6 },

  // Small thick bronze discs. Very high, very pure, very long — the ringing
  // that hangs over everything after the note has gone.
  crotale: { m: RATIOS([1, 2.66, 5.43, 8.9]), g: [1, 0.28, 0.11, 0.04],
             d: [1, 1.8, 2.6, 3.4], attack: 0.002, decay: 1.6, peak: 0.45 },

  // Quartz. Struck it rings for a very long time; RUBBED it swells in, which is
  // what the slow attack is for. The near-unison second partial gives the slow
  // beating that makes a bowl sound like it is breathing.
  bowl:    { m: RATIOS([1, 1.004, 2.32, 4.25]), g: [1, 0.8, 0.22, 0.07],
             d: [1, 1.02, 1.9, 2.8], attack: 0.9, decay: 0.9, peak: 0.6 },

  // The classic inharmonic bell set. Kept because it is genuinely a different
  // colour from everything above — darker, stranger, less obliging.
  bell:    { m: RATIOS([0.56, 0.92, 1.19, 1.71, 2.0, 2.74, 3.76]),
             g: [1, 0.68, 0.5, 0.28, 0.22, 0.14, 0.08],
             d: [1, 1.25, 1.55, 2.1, 2.4, 3.1, 4.0], attack: 0.004, decay: 3.2, peak: 0.66 },
};

/**
 * Any of them. `name` indexes the table above.
 *
 * One function for the whole family, because the difference between these
 * instruments is data and pretending otherwise would be seven copies of this
 * loop drifting apart.
 */
export function renderIdiophone(sr, hz, name, s, { seconds } = {}) {
  const inst = IDIOPHONES[name];
  if (!inst) throw new Error(`no idiophone named "${name}"`);
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 2.2, 7.0);
  const out = alloc(sr, dur);
  const ph = new Float64Array(inst.m.length);
  const attack = inst.attack * lin(c.punchier, 1.8, 0.5);
  const trem = inst.trem || 0;
  let tph = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let x = 0;
    for (let k = 0; k < inst.m.length; k++) {
      ph[k] += (2 * Math.PI * hz * inst.m[k]) / sr;
      x += Math.sin(ph[k]) * inst.g[k] * Math.exp((-inst.decay * inst.d[k] * t) / dur);
    }
    let a = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    if (trem) {
      tph += (2 * Math.PI * trem) / sr;
      a *= 0.78 + 0.22 * Math.sin(tph);
    }
    out[i] = (x / 2.6) * a;
  }
  return normalize(fadeOut(out, sr, 40), inst.peak);
}

/** The bell, kept as a named door onto the table so callers need not change. */
export function renderBell(sr, hz, s, opts) {
  return renderIdiophone(sr, hz, 'bell', s, opts);
}

/**
 * A mark tree — the glittering cascade, which is a GESTURE rather than a note.
 *
 * The one thing in the owner's list that does not fit the table, because it is
 * not an instrument being played, it is many tiny instruments being brushed in
 * sequence. So it belongs here as a phrase: crotales at rising scale degrees, a
 * few tens of milliseconds apart, each quieter than the last.
 *
 * Use it once. Twice is a jingle.
 */
export function renderMarkTree(sr, hz, s, { count = 14, spacing = 0.035, up = true } = {}) {
  const total = count * spacing + 3.2;
  const out = alloc(sr, total);
  for (let k = 0; k < count; k++) {
    // Rising in roughly minor thirds and fourths so the cascade stays inside
    // something scale-shaped rather than being a chromatic run.
    const step = up ? k : count - 1 - k;
    const f = hz * Math.pow(2, (step * 3.5) / 12);
    const one = renderIdiophone(sr, f, 'crotale', s, { seconds: 2.6 });
    const at = Math.floor(k * spacing * sr);
    const g = 0.55 * (1 - (0.5 * k) / count);
    for (let i = 0; i < one.length && at + i < out.length; i++) out[at + i] += one[i] * g;
  }
  return normalize(fadeOut(out, sr, 60), 0.6);
}

/**
 * Breath — the wordless voice this genre is actually built on.
 *
 * Enya's signature is hundreds of layered vocal takes, which is not reachable
 * here. What IS reachable is the part the ear uses to identify a voice: a
 * handful of formant resonances over a slightly unsteady tone. Three bandpasses
 * at vowel frequencies over a detuned pair, with a little breath noise, gets
 * most of the way for very little.
 */
export function renderBreath(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 2.0, 6.5);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0x51ee9);

  // An "ooh"-ish vowel: low first formant, low second. Warmer than "ah", which
  // would be brighter and more present than this palette wants.
  const formants = [
    { hz: 320, q: 9, g: 1.00 },
    { hz: 800, q: 11, g: 0.42 },
    { hz: 2600, q: 14, g: 0.10 },
  ];
  const st = formants.map(() => ({ b0: 0, b1: 0 }));
  let p1 = 0, p2 = 0, vib = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = swellAt(t, dur, lin(c.punchier, 0.9, 0.3), dur * 0.4);

    // A slow, shallow vibrato that arrives late — a held human note is never
    // perfectly steady, and steadiness is the tell for a synthesiser.
    vib += (2 * Math.PI * 4.6) / sr;
    const drift = 1 + Math.sin(vib) * 0.0035 * Math.min(1, t / (dur * 0.5));

    p1 += (2 * Math.PI * hz * drift) / sr;
    p2 += (2 * Math.PI * hz * drift * 1.0016) / sr;
    // A sawtooth-ish source, because a voice is rich and a sine has nothing for
    // the formants to select from.
    const saw = (ph) => 2 * ((ph / (2 * Math.PI)) % 1) - 1;
    const src = (saw(p1) + saw(p2)) * 0.5 + rnd() * 0.035;

    let x = 0;
    for (let k = 0; k < formants.length; k++) {
      const f = formants[k], s2 = st[k];
      const w = (2 * Math.PI * f.hz) / sr;
      const a = Math.sin(w) / (2 * f.q);
      // A two-pole resonator, run direct — cheap and stable at these Qs.
      const hp = src - s2.b0 - (1 / f.q) * s2.b1;
      s2.b1 += 2 * Math.sin(w / 2) * hp;
      s2.b0 += 2 * Math.sin(w / 2) * s2.b1;
      x += s2.b1 * f.g * (1 + a * 0);
    }
    out[i] = x * env * 0.34;
  }
  return normalize(fadeOut(out, sr, 60), 0.6);
}

/**
 * A soft mallet — the only percussive thing in the palette, and barely that.
 *
 * The sleep-music evidence says to avoid accented beats and percussive
 * character, and the phonk kit is all attack. This keeps a pulse available
 * without a transient: a wooden, rounded thud with no click on the front and no
 * ring on the back. Use it sparingly or not at all.
 */
export function renderMallet(sr, s) {
  const c = shape(s);
  const dur = lin(c.longer, 0.28, 0.7);
  const out = alloc(sr, dur);
  const base = exp(c.deeper, 300, 130);
  let ph = 0, lp = 0;
  const rnd = noiseSource(0x9a13);

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = Math.exp(-7 * (t / dur));
    // A small downward pitch move — struck wood drops as the strike relaxes.
    ph += (2 * Math.PI * base * (1 + 0.5 * Math.exp(-t * 60))) / sr;
    const body = Math.sin(ph) * env;
    const knock = rnd() * Math.exp(-t * 320) * 0.25;
    // Lowpass everything: the click lives above 4k and this palette does not
    // want it. 5ms of attack ramp so even the mallet does not start at full.
    const a = 1 - Math.exp((-2 * Math.PI * 1700) / sr);
    lp += a * (body + knock - lp);
    out[i] = lp * Math.min(1, t / 0.005);
  }
  return normalize(fadeOut(out, sr, 15), 0.55);
}

/**
 * The calm palette's tempo and feel.
 *
 * 60-80bpm and STRAIGHT. The engine's 0.32 swing is the shuffled feel phonk is
 * built on and is the opposite of what this wants — and the sleep-music review
 * names syncopation explicitly among the things that keep a listener processing.
 */
export const CALM = {
  bpm: 68,
  swing: 0,
  room: { size: 0.88, damp: 0.32, mix: 0.5 },
};

/** The palette, in the shape the game's voice table expects. */
export const CALM_VOICES = {
  pad: renderPadVoice,
  breath: renderBreath,
  mallet: renderMallet,
  // The whole idiophone table, each as its own voice name. Adding an instrument
  // to IDIOPHONES adds it here too, which is the point of the table.
  ...Object.fromEntries(
    Object.keys(IDIOPHONES).map((name) => [
      name,
      (sr, hz, s, opts) => renderIdiophone(sr, hz, name, s, opts),
    ]),
  ),
};
