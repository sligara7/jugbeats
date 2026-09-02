// The sound design. One pass, run at two speeds.
//
// Everything here is pure: sample rate in, Float32Array out. Nothing touches
// Web Audio, the DOM, or the filesystem, which is what lets the same code run
// offline in the forge (rendering drum one-shots with no latency budget) and
// in the browser (filling buffers for the pitched voices at load time).
//
// Governed by dec:two-speed-synthesis. The owner's condition on that decision
// is the bar here: this has to sound like the phonk she listens to, not like
// oscillators. That means saturation, noise layers, pitch envelopes and filter
// movement — the actual work — rather than a sine with a fade on it.

// ---------------------------------------------------------------------------
// Shaping — the four controls she gets, as numbers between 0 and 1.
//
// Named the way a nine-year-old names things (dec:shaping-controls). Each one
// is deliberately a single number so her sound fits inside a shared link.
// ---------------------------------------------------------------------------

export const NEUTRAL = { deeper: 0.5, punchier: 0.5, dirtier: 0.5, longer: 0.5 };

// Map a 0..1 control onto a useful range. Linear where it should feel linear,
// exponential where the ear hears ratios (pitch, time).
const lin = (v, lo, hi) => lo + (hi - lo) * v;
const exp = (v, lo, hi) => lo * Math.pow(hi / lo, v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const shape = (s) => ({ ...NEUTRAL, ...(s || {}) });

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Exponential decay from 1 to ~0 over `seconds`. The shape drums actually have. */
function decayAt(t, seconds, curve = 4) {
  if (t >= seconds) return 0;
  const x = t / seconds;
  return Math.exp(-curve * x) - Math.exp(-curve) * x;
}

/** A short attack ramp, so nothing starts with a click we did not ask for. */
function attackAt(t, seconds) {
  return t >= seconds ? 1 : t / seconds;
}

/**
 * Soft saturation. This is most of what makes a synthesized drum sound like a
 * record rather than a signal generator: tanh rounds the peaks the way tape and
 * an overdriven preamp do, and `drive` above ~3 starts audibly crunching, which
 * is exactly the phonk 808 sound.
 */
function saturate(x, drive) {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/** Deterministic noise. Seeded so the forge produces byte-identical output. */
function noiseSource(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

/**
 * Chamberlin state-variable filter — one struct, three outputs, cheap enough to
 * run per sample with a moving cutoff. We need the movement: a static filter on
 * a drum sounds like a drum with a blanket over it.
 */
function svf() {
  return { lp: 0, bp: 0 };
}
function svfStep(s, x, cutoffHz, q, sr) {
  const f = 2 * Math.sin((Math.PI * Math.min(cutoffHz, sr * 0.45)) / sr);
  const damp = 1 / Math.max(q, 0.5);
  const hp = x - s.lp - damp * s.bp;
  s.bp += f * hp;
  s.lp += f * s.bp;
  return { lp: s.lp, bp: s.bp, hp };
}

/** One-pole high-pass, for getting rid of sub rumble we did not intend. */
function hpf(buf, cutoffHz, sr) {
  const a = 1 / (1 + (2 * Math.PI * cutoffHz) / sr);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = a * (prevOut + x - prevIn);
    buf[i] = y;
    prevIn = x;
    prevOut = y;
  }
  return buf;
}

/** Fade the last few milliseconds to zero so a truncated tail never clicks. */
function fadeOut(buf, sr, ms = 4) {
  const n = Math.min(buf.length, Math.floor((ms / 1000) * sr));
  for (let i = 0; i < n; i++) buf[buf.length - n + i] *= 1 - i / n;
  return buf;
}

/** Scale to a target peak. Keeps the kit balanced without a mixdown stage. */
function normalize(buf, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max > 0) {
    const g = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

const alloc = (sr, seconds) => new Float32Array(Math.ceil(sr * seconds));

// ---------------------------------------------------------------------------
// The drums. Rendered ahead of time by the forge — their pitch never changes,
// and this is where the realism is won or lost.
// ---------------------------------------------------------------------------

/**
 * Kick. A phonk kick is really two things stacked: a click at the very front
 * that gives it presence on a phone speaker, and a sine whose pitch collapses
 * from the click into the sub. The pitch collapse is the whole trick — a static
 * sine reads as a hum, and the same sine with a 30ms drop reads as a drum.
 */
export function renderKick(sr, s) {
  const c = shape(s);
  const dur = lin(c.longer, 0.28, 0.65);
  const startHz = lin(c.punchier, 120, 260);
  const endHz = exp(c.deeper, 62, 36);
  const drive = exp(c.dirtier, 1.4, 7);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0x1234);
  const click = svf();
  let phase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // Pitch collapses fast, then settles. 25ms is the sweet spot: shorter reads
    // as a click, longer reads as a slide-whistle.
    const hz = endHz + (startHz - endHz) * Math.exp(-t / 0.025);
    phase += (2 * Math.PI * hz) / sr;
    const body = Math.sin(phase) * decayAt(t, dur, 3.2);

    // The click: a very short burst of band-passed noise sitting on the attack.
    const clickEnv = decayAt(t, 0.012, 9);
    const clicked = svfStep(click, rnd() * clickEnv, 2200, 1.1, sr).bp;

    out[i] = saturate(body * 0.95 + clicked * 0.35 * lin(c.punchier, 0.4, 1.3), drive);
  }
  return normalize(fadeOut(out, sr), 0.98);
}

/**
 * Snare. Noise for the wires, two detuned sines for the shell. Phonk snares are
 * short and dry — a long tail turns the beat to mush at 140bpm with an 808
 * underneath it, so `longer` tops out well before it becomes a reverb.
 */
export function renderSnare(sr, s) {
  const c = shape(s);
  const dur = lin(c.longer, 0.11, 0.3);
  const drive = exp(c.dirtier, 1.3, 5);
  const tone = lin(c.deeper, 1.25, 0.75); // shifts the shell down as it deepens
  const out = alloc(sr, dur);
  const rnd = noiseSource(0xbeef);
  const band = svf();
  let p1 = 0, p2 = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    p1 += (2 * Math.PI * 185 * tone) / sr;
    p2 += (2 * Math.PI * 247 * tone) / sr;
    const shell = (Math.sin(p1) + Math.sin(p2) * 0.7) * decayAt(t, dur * 0.55, 5);

    // The wires: broad noise, band-passed and opened up on the attack so the
    // hit has a bright front edge without being bright all the way through.
    const sweep = lin(c.punchier, 1400, 3200) * (1 + 1.4 * Math.exp(-t / 0.008));
    const wires = svfStep(band, rnd(), sweep, 0.9, sr).bp * decayAt(t, dur, 4.5);

    out[i] = saturate(shell * 0.5 + wires * 0.85, drive);
  }
  return normalize(fadeOut(hpf(out, 160, sr), sr), 0.85);
}

/**
 * The six inharmonic square waves the TR-808 uses for its hats.
 *
 * This is the whole reason a real hi-hat sounds like metal and filtered noise
 * sounds like a click: metal rings at frequencies that are not multiples of each
 * other, and the ear hears that clash as "struck object" rather than "hiss". The
 * frequencies themselves are low — what survives the high-pass below is the
 * dense, clashing cluster of their upper harmonics.
 */
const HAT_PARTIALS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

/**
 * Hats. Six squares through a high-pass, plus a little noise for air.
 *
 * The first version of this was band-passed white noise with a 50ms envelope,
 * and the owner's verdict on hearing it was that it sounded like a click rather
 * than a hat. That was correct and it was a synthesis problem, not an envelope
 * one: noise has no pitch structure at all, so shortening or lengthening it just
 * gives you a shorter or longer hiss. The partials are what was missing.
 */
export function renderHat(sr, s, { open = false } = {}) {
  const c = shape(s);
  // Longer than before even at the short end. A closed hat still has a body;
  // below about 45ms the ear stops hearing the metal and hears the transient.
  const dur = open ? lin(c.longer, 0.16, 0.4) : lin(c.longer, 0.05, 0.115);
  const drive = exp(c.dirtier, 1.2, 3.6);
  const cutoff = lin(c.deeper, 8200, 5000);
  const out = alloc(sr, dur);
  const rnd = noiseSource(open ? 0xcafe : 0xf00d);
  const hi = svf();
  const band = svf();
  const phases = new Float64Array(HAT_PARTIALS.length);

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;

    let metal = 0;
    for (let k = 0; k < HAT_PARTIALS.length; k++) {
      phases[k] += (2 * Math.PI * HAT_PARTIALS[k]) / sr;
      metal += Math.sin(phases[k]) >= 0 ? 1 : -1;
    }
    metal /= HAT_PARTIALS.length;

    // Two envelopes again, as with the cowbell: a hard tick on the front and a
    // slower shimmer behind it. One envelope is what made this a click.
    const env = decayAt(t, 0.006, 10) * 0.45 + decayAt(t, dur, open ? 3 : 6) * 0.85;

    // A touch of noise so it breathes; the metal alone is too clean and rings.
    const air = svfStep(band, rnd(), 11000, 0.7, sr).hp * 0.28;

    out[i] = saturate((svfStep(hi, metal, cutoff, 0.9, sr).hp + air) * env, drive);
  }
  return normalize(fadeOut(hpf(out, 3800, sr), sr), 0.58);
}

/**
 * Cowbell. THE Memphis phonk sound, and the one thing here that has to be right
 * or the whole kit stops being phonk. Two pulse waves a specific interval apart
 * (the 808's own ratio, roughly 540 and 800Hz), band-passed hard, with a fast
 * front and a woody tail.
 */
export function renderCowbell(sr, s) {
  const c = shape(s);
  const dur = lin(c.longer, 0.18, 0.42);
  const drive = exp(c.dirtier, 1.6, 5.5);
  const base = exp(c.deeper, 620, 470);
  const out = alloc(sr, dur);
  const band = svf();
  let p1 = 0, p2 = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    p1 += (2 * Math.PI * base) / sr;
    p2 += (2 * Math.PI * base * 1.48) / sr;
    // Square-ish rather than sine: the metallic edge lives in the harmonics.
    const sq = (ph) => (Math.sin(ph) >= 0 ? 1 : -1) * 0.6 + Math.sin(ph) * 0.4;
    const raw = sq(p1) + sq(p2) * 0.85;

    // Two-stage envelope: a hard front, then a slower body. One envelope sounds
    // like a beep; two sounds like something was struck.
    const env = decayAt(t, 0.02, 8) * 0.6 + decayAt(t, dur, 4) * 0.75;
    out[i] = saturate(svfStep(band, raw * env, base * 2.1, 2.2, sr).bp, drive);
  }
  return normalize(fadeOut(hpf(out, 300, sr), sr), 0.7);
}

/**
 * Clap. Not strictly required, but a phonk beat without one sounds thin, and it
 * costs three retriggered noise bursts. The tiny offsets are what make it read
 * as several hands rather than one noise hit.
 */
export function renderClap(sr, s) {
  const c = shape(s);
  const dur = lin(c.longer, 0.13, 0.3);
  const drive = exp(c.dirtier, 1.2, 4);
  const out = alloc(sr, dur);
  const rnd = noiseSource(0x5eed);
  const band = svf();
  const taps = [0, 0.009, 0.019, 0.03];

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let env = 0;
    for (const tap of taps) if (t >= tap) env = Math.max(env, decayAt(t - tap, 0.022, 8) * 0.8);
    env += decayAt(t, dur, 5) * 0.35; // the room behind the hands
    const n = svfStep(band, rnd(), lin(c.punchier, 1100, 2100), 1.0, sr).bp;
    out[i] = saturate(n * env, drive);
  }
  return normalize(fadeOut(hpf(out, 400, sr), sr), 0.75);
}

// ---------------------------------------------------------------------------
// The pitched voices. Generated in the browser, because their pitch has to move
// across the lanes and a rendered file cannot.
// ---------------------------------------------------------------------------

/**
 * The 808. A sine with a pitch envelope and a lot of drive — the same bones as
 * the kick, held far longer and pushed harder, so the distortion becomes the
 * instrument rather than a finish on it.
 */
export function render808(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 0.45, 1.5);
  const drive = exp(c.dirtier, 1.5, 9);
  const out = alloc(sr, dur);
  const body = svf();
  let phase = 0;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    // A short upward bend into the note. Every phonk 808 has this; without it
    // the note arrives already there and sounds inert.
    const glide = 1 + lin(c.punchier, 0.15, 0.9) * Math.exp(-t / 0.03);
    phase += (2 * Math.PI * hz * glide) / sr;
    const env = attackAt(t, 0.004) * decayAt(t, dur, 2.6);
    const raw = saturate(Math.sin(phase) * env * 1.1, drive);
    // Tame the harmonics the drive just created, or it eats the whole mix.
    out[i] = svfStep(body, raw, exp(c.deeper, 3000, 900), 0.8, sr).lp;
  }
  return normalize(fadeOut(out, sr, 8), 0.95);
}

/**
 * The lead. Two saws a few cents apart through a moving low-pass — the detune is
 * what makes it sound wide rather than thin, and the filter sweep is what makes
 * a held note interesting enough for a child to want to hear it again.
 */
export function renderLead(sr, hz, s, { seconds } = {}) {
  const c = shape(s);
  const dur = seconds ?? lin(c.longer, 0.22, 0.7);
  const drive = exp(c.dirtier, 1.2, 4.5);
  const detune = lin(c.punchier, 1.004, 1.014);
  const out = alloc(sr, dur);
  const filt = svf();
  let p1 = 0, p2 = 0;
  const saw = (ph) => 2 * ((ph / (2 * Math.PI)) % 1) - 1;

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    p1 += (2 * Math.PI * hz) / sr;
    p2 += (2 * Math.PI * hz * detune) / sr;
    const env = attackAt(t, 0.006) * decayAt(t, dur, 3);
    const cutoff = exp(c.deeper, 5200, 1400) * (0.35 + 0.65 * Math.exp(-t / 0.12));
    const raw = (saw(p1) + saw(p2)) * 0.5 * env;
    out[i] = saturate(svfStep(filt, raw, cutoff, 1.6, sr).lp, drive);
  }
  return normalize(fadeOut(out, sr, 6), 0.6);
}

// ---------------------------------------------------------------------------
// The click, and the floor. Neither is an instrument she plays — they are what
// make playing into an empty loop possible at all.
// ---------------------------------------------------------------------------

/**
 * The click (dec:she-sets-the-tempo).
 *
 * A short pitched blip rather than filtered noise, because a click has to be
 * unmistakable underneath drums without being loud — pitch cuts through where
 * level would just add to the noise. The accent marks beat one, which is the
 * whole job of a count-in: not "here is the tempo" but "here is where ONE is".
 */
export function renderClick(sr, { accent = false } = {}) {
  const dur = 0.035;
  const hz = accent ? 1600 : 1050;
  const out = alloc(sr, dur);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * hz) / sr;
    out[i] = Math.sin(phase) * decayAt(t, dur, 9);
  }
  return normalize(fadeOut(out, sr, 3), accent ? 0.5 : 0.34);
}

/**
 * The drone (dec:drone-voiced-up).
 *
 * An open fifth — root and fifth, no third — so it agrees with anything she
 * plays later. A third would commit to major or minor and start arguing with
 * her melody.
 *
 * VOICED UP TWO OCTAVES from where a drone musically belongs. At the C2 root a
 * phone speaker reproduces essentially nothing while the drone still eats
 * headroom and muddies the 808, which is the one voice that genuinely lives
 * down there. Up here it is audible on the speaker she actually has.
 *
 * Rendered to loop seamlessly: the filter movement completes a whole number of
 * cycles across the buffer, so the end meets the beginning exactly.
 */
export function renderPad(sr, { rootHz = ROOT_HZ, seconds = 4, octaves = 2 } = {}) {
  const out = alloc(sr, seconds);
  const root = rootHz * Math.pow(2, octaves);
  const fifth = root * 1.5;
  // Three voices per note, slightly detuned. The beating between them is what
  // makes a pad sound wide and alive rather than like a held organ note.
  const partials = [
    { hz: root, gain: 1.0 }, { hz: root * 1.004, gain: 0.7 }, { hz: root * 0.997, gain: 0.7 },
    { hz: fifth, gain: 0.55 }, { hz: fifth * 1.003, gain: 0.4 },
    { hz: root * 0.5, gain: 0.35 }, // a touch of the lower octave for body
  ];
  const phases = new Float64Array(partials.length);
  const filt = svf();
  const LFO_CYCLES = 2; // integer cycles across the buffer, so the loop is seamless

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let x = 0;
    for (let k = 0; k < partials.length; k++) {
      phases[k] += (2 * Math.PI * partials[k].hz) / sr;
      // Saw, for harmonics a small speaker can actually reproduce.
      x += (2 * ((phases[k] / (2 * Math.PI)) % 1) - 1) * partials[k].gain;
    }
    x /= partials.length;
    const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * LFO_CYCLES * t) / seconds);
    out[i] = svfStep(filt, x, 700 + 900 * lfo, 0.8, sr).lp;
  }
  return normalize(hpf(out, 120, sr), 0.5);
}

// ---------------------------------------------------------------------------
// Pitch. The lanes are locked to a minor scale (dec:minor-scale-lanes), so the
// engine takes a scale degree and owns the mapping. Nothing outside this file
// ever handles a frequency, which is what makes "she cannot play a wrong note"
// a property of the design rather than a rule someone has to remember.
// ---------------------------------------------------------------------------

/** Natural minor, as semitone offsets. Phonk lives here almost exclusively. */
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** Root note. C2 for the 808, which is where phonk sub sits on a phone. */
export const ROOT_HZ = 65.41;

/**
 * Scale degree to frequency. Degree 0 is the root; degrees run off the top of
 * the scale into the next octave rather than stopping, so more lanes is always
 * a legal thing to ask for.
 */
export function degreeToHz(degree, octaves = 0) {
  const n = MINOR_STEPS.length;
  const idx = ((degree % n) + n) % n;
  const oct = Math.floor(degree / n) + octaves;
  return ROOT_HZ * Math.pow(2, oct + MINOR_STEPS[idx] / 12);
}

export const VOICES = {
  kick: renderKick,
  snare: renderSnare,
  hat: (sr, s) => renderHat(sr, s, { open: false }),
  openhat: (sr, s) => renderHat(sr, s, { open: true }),
  cowbell: renderCowbell,
  clap: renderClap,
};

export const _internal = { saturate, decayAt, svf, svfStep, normalize, lin, exp, clamp01 };
