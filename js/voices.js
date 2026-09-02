// The voices (comp:voices) — the sound engine.
//
// Provides iface:play-a-voice. Governed by dec:two-speed-synthesis: the drums
// are loaded from files the forge baked, and the pitched voices are generated
// here — but generated ONCE, at load, into buffers. Nothing is synthesized on
// the hot path.
//
// That is a stronger reading of the timing decision than the design asked for.
// A live oscillator graph per note is the obvious way to build a pitched voice
// and it puts node construction between her thumb and the sound; pre-rendering
// every note she can possibly play turns that into a buffer lookup. Seven scale
// degrees at under a second each costs a few milliseconds and a couple of
// megabytes, which is nothing, and it means the expensive path runs while she is
// still reading the first screen.
//
// This part never reads her track and never reads the screen.

import { render808, renderLead, degreeToHz, MINOR_STEPS, NEUTRAL } from './dsp.js';

/** Degrees we pre-render. One octave of the scale is more than four lanes need. */
const DEGREES = MINOR_STEPS.map((_, i) => i);

/**
 * Per-voice level, applied on top of whatever the caller asks for.
 *
 * The drums sit a quarter down from where they were. Each one is normalised to
 * near full scale on its own, which is right for a one-shot heard alone and too
 * loud for four of them landing together over an 808 — the owner's verdict on
 * playing it was simply that the drums were too much. Pulling them back here
 * rather than at the master keeps the 808 and the lead where they are.
 */
const VOICE_GAIN = {
  kick: 0.75,
  snare: 0.75,
  hat: 0.75,
  openhat: 0.75,
  cowbell: 0.75,
  clap: 0.75,
};

/** Where the lead sits relative to the 808 — two octaves up, out of its way. */
const LEAD_OCTAVES = 2;

export class Voices {
  /**
   * @param {AudioContext} ctx
   * @param {{kitUrl?: string}} opts
   */
  constructor(ctx, { kitUrl = 'kit/manifest.json' } = {}) {
    this.ctx = ctx;
    this.kitUrl = kitUrl;

    /** @type {Map<string, AudioBuffer>} baked drums, by voice name */
    this.drums = new Map();
    /** @type {Map<string, AudioBuffer>} pitched, keyed `${voice}:${degree}` */
    this.pitched = new Map();

    this.ready = false;
    this.shaping = { bass: { ...NEUTRAL }, lead: { ...NEUTRAL } };

    // Master chain: gain into a soft-clipper into the speakers.
    //
    // The clipper is not protection, it is the sound. Running the whole mix
    // through one shared saturation is a lot of what makes a set of separate
    // hits read as a track rather than as a list of noises — it is the single
    // biggest difference between the demo render and a naive playback.
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.clipper = ctx.createWaveShaper();
    this.clipper.curve = softClipCurve(1.15);
    this.clipper.oversample = '2x';
    this.master.connect(this.clipper).connect(ctx.destination);
  }

  /**
   * Load the baked kit and render the pitched voices.
   * Safe to call before the first tap — decoding does not need a running context.
   */
  async load() {
    const manifest = await fetch(this.kitUrl).then((r) => {
      if (!r.ok) throw new Error(`kit manifest ${r.status}`);
      return r.json();
    });
    const base = this.kitUrl.replace(/[^/]*$/, '');

    await Promise.all(
      Object.entries(manifest.voices).map(async ([name, file]) => {
        const bytes = await fetch(base + file).then((r) => r.arrayBuffer());
        // decodeAudioData resamples to the context rate for us, which is why
        // the forge is free to bake at 22050 to keep the kit small.
        this.drums.set(name, await this.ctx.decodeAudioData(bytes));
      })
    );

    this.renderPitched();
    this.ready = true;
  }

  /**
   * (Re)render every pitched note from the current shaping numbers.
   *
   * Called at load, and again when she turns a control. It is synchronous and
   * takes a few milliseconds — acceptable while she is dragging a slider, and
   * deliberately never called while a note is starting.
   */
  renderPitched() {
    const sr = this.ctx.sampleRate;
    for (const degree of DEGREES) {
      this.pitched.set(
        `bass:${degree}`,
        toBuffer(this.ctx, render808(sr, degreeToHz(degree), this.shaping.bass), sr)
      );
      this.pitched.set(
        `lead:${degree}`,
        toBuffer(this.ctx, renderLead(sr, degreeToHz(degree, LEAD_OCTAVES), this.shaping.lead), sr)
      );
    }
  }

  /** Set one instrument's shaping numbers and re-render it. */
  setShaping(instrument, values) {
    if (!this.shaping[instrument]) return;
    Object.assign(this.shaping[instrument], values);
    this.renderPitched();
  }

  /**
   * Play one voice, at one pitch, at one audio time.
   *
   * A voice that is not loaded is silent rather than throwing (iface:play-a-voice).
   * The one thing this must never do is make a sound late in order to be correct,
   * so there is no awaiting and no lazy loading here.
   *
   * @param {string} voice  'kick' | 'snare' | ... | 'bass' | 'lead'
   * @param {{degree?: number, time?: number, gain?: number}} opts
   */
  play(voice, { degree = 0, time, gain = 1 } = {}) {
    const at = time ?? this.ctx.currentTime;
    const buf =
      this.drums.get(voice) ??
      this.pitched.get(`${voice}:${((degree % DEGREES.length) + DEGREES.length) % DEGREES.length}`);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const level = gain * (VOICE_GAIN[voice] ?? 1);
    if (level === 1) {
      src.connect(this.master);
    } else {
      const g = this.ctx.createGain();
      g.gain.value = level;
      src.connect(g).connect(this.master);
    }
    // Never schedule into the past: iOS treats a negative start time as an
    // error on some versions rather than clamping it.
    src.start(Math.max(at, this.ctx.currentTime));
  }
}

/** Wrap a Float32Array of samples as a mono AudioBuffer. */
function toBuffer(ctx, samples, sampleRate) {
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  return buf;
}

/** tanh curve for the master WaveShaper — same shape as the forge's bus glue. */
function softClipCurve(drive, n = 2048) {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}
