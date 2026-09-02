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
 * Hats. Filtered noise, and almost entirely about the envelope: a closed hat is
 * 30ms and an open one is 200ms of the identical sound. Phonk hats also get
 * rolled off at the very top so they sit behind the cowbell instead of fighting
 * it on a phone speaker.
 */
export function renderHat(sr, s, { open = false } = {}) {
  const c = shape(s);
  const dur = open ? lin(c.longer, 0.14, 0.34) : lin(c.longer, 0.028, 0.075);
  const drive = exp(c.dirtier, 1.1, 3.2);
  const out = alloc(sr, dur);
  const rnd = noiseSource(open ? 0xcafe : 0xf00d);
  const hi = svf();

  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = decayAt(t, dur, open ? 3.5 : 7);
    const n = svfStep(hi, rnd(), lin(c.deeper, 9000, 5200), 0.8, sr).hp;
    out[i] = saturate(n * env, drive);
  }
  return normalize(fadeOut(hpf(out, 4000, sr), sr), 0.55);
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
