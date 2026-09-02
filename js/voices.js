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

import {
  render808, renderLead, renderClick, renderPad, degreeToHz, SCALE_STEPS, PROGRESSION, NEUTRAL,
} from './dsp.js';

/** Degrees we pre-render. One octave of the scale is more than four lanes need. */
const DEGREES = SCALE_STEPS.map((_, i) => i);

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

/**
 * The note lengths pitched voices are rendered at, in seconds.
 *
 * A held key already drew a longer block on screen and made exactly the same
 * sound, because the amplitude envelope is baked into the sample. That left the
 * decision "a pitched note has a length the player chooses" only half built.
 *
 * Rendering a few lengths rather than moving the envelope onto a gain node is
 * the cheaper of the two answers, and it keeps the character: each length is
 * rendered with its OWN proper envelope, so a long 808 decays like a long 808
 * rather than like a short one stretched. The steps are coarse and the ear does
 * not notice — what it notices is a two-bar note that stops after a beat.
 *
 * Seconds rather than beats, deliberately: tempo is set after these are built,
 * and tying them to it would mean re-rendering every time she retaps.
 */
const LENGTHS = [0.25, 0.5, 1.0, 2.0];

/** Which rendered length is closest to what she actually held. */
function nearestLength(seconds) {
  if (!(seconds > 0)) return 0;
  let best = 0;
  for (let i = 1; i < LENGTHS.length; i++) {
    if (Math.abs(LENGTHS[i] - seconds) < Math.abs(LENGTHS[best] - seconds)) best = i;
  }
  return best;
}

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

    // The click sits OUTSIDE the master clipper. It is not part of the music and
    // must not be squashed by, or contribute to, the mix glue — it has to stay
    // legible under drums at a level that never competes with them.
    this.clickBus = ctx.createGain();
    this.clickBus.gain.value = 0;
    this.clickBus.connect(ctx.destination);

    // The drone is a floor, not a layer: through the glue, well down.
    this.droneBus = ctx.createGain();
    this.droneBus.gain.value = 0;
    this.droneBus.connect(this.master);
    this._drone = null;
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

    const sr = this.ctx.sampleRate;
    this.click = toBuffer(this.ctx, renderClick(sr, {}), sr);
    this.clickAccent = toBuffer(this.ctx, renderClick(sr, { accent: true }), sr);
    this.pad = toBuffer(this.ctx, renderPad(sr, {}), sr);

    this.renderPitched();
    this.ready = true;
  }

  // -------------------------------------------------------------------------
  // The click and the drone
  // -------------------------------------------------------------------------

  /** One tick of the metronome. `accent` marks beat one. */
  playClick(time, { accent = false } = {}) {
    const buf = accent ? this.clickAccent : this.click;
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.clickBus);
    src.start(Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime));
  }

  /**
   * Fade the click in or out over `seconds`.
   *
   * Fading rather than switching because the click RETIRES once her beat can
   * keep time for her (dec:she-sets-the-tempo), and a metronome that vanishes
   * between one beat and the next reads as a fault rather than as a handover.
   */
  setClickLevel(level, seconds = 0.6) {
    const g = this.clickBus.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(level, this.ctx.currentTime + seconds);
  }

  /** Start the pedal point. Loops forever; only its level ever changes. */
  startDrone(level = 0.18) {
    if (this._drone || !this.pad) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.pad;
    src.loop = true;
    src.connect(this.droneBus);
    src.start();
    this._drone = src;
    this.setDroneLevel(level, 2.5); // in slowly: a pad that arrives suddenly is a noise
  }

  setDroneLevel(level, seconds = 1.5) {
    const g = this.droneBus.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.linearRampToValueAtTime(level, this.ctx.currentTime + seconds);
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
    // THE BASS MOVES AND THE MELODY DOES NOT, which is how a band actually does
    // this. The bass states the chord — that is what makes the harmony audible
    // at all — while the melody stays in one scale and floats over the changes.
    // It is why a blues player uses a single pentatonic over a whole tune, and
    // it is what keeps every note she can press consonant against every chord.
    //
    // Transposing the melody too would give each chord its own parallel
    // pentatonic, which wanders outside the key: shifting C minor pentatonic up
    // to the flat sixth introduces a note the key does not contain, and the
    // drone holding the root underneath would be arguing with it.
    // Every note she can press, at every length she can hold it for. The chord
    // dimension collapsed to one when the automatic progression came out, so
    // this costs no more buffers than it did before.
    for (let chord = 0; chord < PROGRESSION.length; chord++) {
      const shift = Math.pow(2, PROGRESSION[chord] / 12);
      for (const degree of DEGREES) {
        for (let len = 0; len < LENGTHS.length; len++) {
          const seconds = LENGTHS[len];
          this.pitched.set(
            `bass:${degree}:${chord}:${len}`,
            toBuffer(this.ctx,
              render808(sr, degreeToHz(degree) * shift, this.shaping.bass, { seconds }), sr)
          );
          this.pitched.set(
            `lead:${degree}:${chord}:${len}`,
            toBuffer(this.ctx,
              renderLead(sr, degreeToHz(degree, LEAD_OCTAVES) * shift, this.shaping.lead,
                { seconds }), sr)
          );
        }
      }
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
   * @param {{degree?, time?, gain?, chord?, seconds?}} opts
   *   chord   — which chord is sounding. Drums ignore it; a kick does not transpose.
   *   seconds — how long the note should last. Ignored by drums, which have a
   *             length of their own; rounded to the nearest rendered length for
   *             pitched voices, which is how a held note finally sounds held.
   */
  play(voice, { degree = 0, time, gain = 1, chord = 0, seconds } = {}) {
    const at = time ?? this.ctx.currentTime;
    const n = DEGREES.length;
    const c = ((chord % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length;
    const len = nearestLength(seconds ?? LENGTHS[1]);
    const buf =
      this.drums.get(voice) ??
      this.pitched.get(`${voice}:${((degree % n) + n) % n}:${c}:${len}`);
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

/**
 * Start a note that lasts as long as she holds the key, and hand back the way
 * to end it.
 *
 * The longest rendered length is started, and release ramps it down over a few
 * tens of milliseconds — long enough not to click, short enough to feel like
 * letting go. This is the LIVE half of holding: at the moment she presses,
 * nothing knows how long the note will be, so it cannot be chosen in advance.
 * The recorded half picks a rendered length once the run is known.
 */
Voices.prototype.startHeld = function startHeld(voice, { degree = 0, chord = 0, gain = 1 } = {}) {
  const n = DEGREES.length;
  const c = ((chord % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length;
  const buf = this.pitched.get(`${voice}:${((degree % n) + n) % n}:${c}:${LENGTHS.length - 1}`);
  if (!buf) return { release() {} };

  const src = this.ctx.createBufferSource();
  const g = this.ctx.createGain();
  src.buffer = buf;
  g.gain.value = gain * (VOICE_GAIN[voice] ?? 1);
  src.connect(g).connect(this.master);
  src.start();

  let done = false;
  return {
    release: () => {
      if (done) return;
      done = true;
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.06);
      try { src.stop(t + 0.08); } catch { /* already stopped */ }
    },
  };
};

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
