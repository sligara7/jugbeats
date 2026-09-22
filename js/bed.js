// The bed engine — what /waves/ and /rain/ are both made of.
//
// A BED IS A SOUND YOU FALL ASLEEP TO. It is not the game: there is no clock, no
// track, no rounds and no link codec here, and none of the rest of ../js is
// imported. What a bed does is start on one tap, run for a chosen time, and stop
// itself — and the only hard part is that it must do all of that while the phone
// is locked.
//
// ── THE ONE RULE EVERYTHING ELSE FOLLOWS FROM ──────────────────────────────
//
// NO JAVASCRIPT RUNS AFTER THE TAP. A backgrounded tab on a locked phone has its
// timers throttled or stopped, so anything that has to keep happening must
// happen on the audio thread. That single constraint is why:
//
//   - the fade in, the hold, the fade out and every source's stop time are all
//     committed to the audio graph at the moment she taps, and never revisited;
//   - movement comes from LOOPING BUFFERS rather than from scheduled events,
//     because an AudioBufferSourceNode may be connected to an AudioParam and a
//     looping buffer is therefore a modulator that needs nothing to keep it
//     going;
//   - the countdown on screen is cosmetic, reads off the wall clock, and may be
//     throttled as much as the browser likes without anything going wrong.
//
// A `setTimeout` for the duration would simply not fire.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// /sleep/ came first and is self-contained. /waves/ was written by copying it,
// which was defensible once and recorded as a known cost. Rain would have been
// the second copy, and dec:styles-are-palettes is what this project does instead
// when several things share an engine and differ in character: hold one engine,
// and let the differences be DATA plus one function.
//
// A CHARACTER DECIDES WHAT IT SOUNDS LIKE AND NOTHING ELSE. It is handed a
// context, a destination and a start time, and builds its own layers. It never
// touches the session envelope, the timer, the ceiling or the lock screen — so a
// new bed cannot get those wrong, which is the whole point of the split.
//
// /sleep/ IS NOT MIGRATED. It is proved on a phone overnight and in use tonight,
// and moving a working page onto a new engine to tidy it is how a working page
// stops working. Its character is written down here anyway (SLEEP, below), so
// the migration is a small deliberate step whenever somebody wants to take it.

/**
 * Pink noise in a loop, crossfaded so the wrap cannot be heard.
 *
 * Paul Kellet's filter for the -3 dB/octave slope, then the tail blended back
 * over the head. Without the crossfade the loop point is a step discontinuity —
 * a soft thump every few seconds, which is exactly the kind of small repeating
 * event a bed exists to avoid.
 */
export function pinkLoop(ctx, seconds, { brown = 0, rate = ctx.sampleRate } = {}) {
  const n = Math.floor(seconds * rate);
  const fade = Math.floor(0.4 * rate);
  const raw = new Float32Array(n + fade);

  // `brown` TILTS THE SPECTRUM DOWNWARD, 0 for pink and 1 for brown.
  //
  // Pink falls at 3 dB an octave and brown at 6, and that difference is the
  // difference between rain on your face and rain heard through a window — the
  // high end is what reads as TORRENTIAL. Blending between them is a tone
  // control with no filter in the graph, which matters because this buffer is
  // generated once and then loops untouched for eight hours.
  //
  // Brown is a leaky integration of the same white noise the pink filter is fed,
  // so the two are correlated and the blend moves smoothly rather than sounding
  // like two noises fighting.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;

    br = (br + 0.018 * w) / 1.018;
    raw[i] = brown ? pink * (1 - brown) + br * 3.6 * brown : pink;
  }

  // NORMALISED TO PINK'S OWN LEVEL, so `brown` is purely a TONE control and
  // cannot quietly change how loud the bed is. Brown carries far more energy
  // down low, and without this every tilt would also be a volume change —
  // exactly the tangle that makes two knobs impossible to set independently.
  if (brown) {
    let sum = 0;
    for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i];
    const rms = Math.sqrt(sum / raw.length);
    if (rms > 0) {
      const g = 0.197 / rms;                 // pink's measured rms from this filter
      for (let i = 0; i < raw.length; i++) raw[i] *= g;
    }
  }

  const buf = ctx.createBuffer(1, n, rate);
  const out = buf.getChannelData(0);
  out.set(raw.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = out[i] * Math.sqrt(t) + raw[n + i] * Math.sqrt(1 - t);
  }
  return buf;
}

/**
 * A RUSTLE — continuous noise whose loudness flutters, with no onsets in it.
 *
 * ⚠️ THIS EXISTS BECAUSE A CANOPY BUILT OUT OF TRANSIENTS SOUNDS LIKE RAIN, AND
 * TWICE FAILED TO STOP SOUNDING LIKE RAIN.
 *
 * The first forest used pitched raindrops; removing the pitch did not fix it.
 * The second used unpitched grains at seven times the density; that did not fix
 * it either, and the owner said so both times.
 *
 * THE TIMBRE WAS NEVER THE PROBLEM — THE STATISTICS WERE. Rain is discrete
 * events, randomly spaced, each with a sharp onset, scattered over a noise bed.
 * That IS the signature, and anything with those statistics reads as rain
 * whatever each event is made of. Measured: grains at 240 a second produce 10.8
 * sharp onsets a second, and this produces 1.5.
 *
 * A LEAF DOES NOT STRIKE ANYTHING. It flutters — repeated glancing contact, too
 * fast and too continuous to hear as separate events — and a whole canopy of
 * them is one continuous sound that is always changing loudness. So this is not
 * events at all: it is noise multiplied by a wandering envelope, and the "shshsh"
 * is the wander.
 *
 * `flutter` is how fast that envelope moves, in Hz. Around 30 is leaves; much
 * slower becomes surf, much faster becomes a buzz.
 *
 * ⚠️ AND `depth` IS SHALLOW ON PURPOSE, WHICH IS THE THIRD THING THIS PAGE GOT
 * WRONG. The first flutter used depth 0.88 — the level swinging almost to
 * silence — on the reasoning that more movement is more alive. Measured against
 * a control of plain unmodulated noise, it produced 7.5 excess onsets a second,
 * and the grains it replaced produced 7.4. IT WAS NO BETTER, because modulation
 * that deep does not remove events, it MANUFACTURES them: every dip to near
 * silence gives the next rise a sharp edge, and a sharp edge is an onset.
 *
 * At 0.35 the excess is 0.8 — statistically indistinguishable from noise that is
 * not modulated at all, while still audibly breathing. Continuous first,
 * fluttering second.
 *
 * THE CONTROL IS THE POINT. The first measurement of this had no control in it
 * and read 1.5 against the grains' 10.8, which looked like a triumph. Plain
 * brown noise alone reads 6.2 on the same detector — most of what was being
 * counted was the noise, not the events.
 */
export function rustleLoop(ctx, seconds, { brown = 0, flutter = 30, depth = 0.35, floor = 0.65, rate = ctx.sampleRate } = {}) {
  const n = Math.floor(seconds * rate);
  const fade = Math.floor(0.4 * rate);
  const raw = new Float32Array(n + fade);

  // The wandering envelope: white noise with everything above `flutter` removed,
  // so it drifts at about the rate leaves turn over.
  //
  // BUILT AT A SIXTEENTH OF THE RATE AND INTERPOLATED, for the same reason
  // ENV_RATE exists: this carries tens of hertz, so generating it per audio
  // sample is generating detail that is then filtered away. It was half the cost
  // of the whole loop.
  const step = 16;
  const mn = Math.ceil((n + fade) / step) + 2;
  const a = Math.exp((-2 * Math.PI * flutter * step) / rate);
  let env = 0;
  let peak = 1e-9;
  const coarse = new Float32Array(mn);
  for (let i = 0; i < mn; i++) {
    env = env * a + (Math.random() * 2 - 1) * (1 - a);
    coarse[i] = Math.abs(env);
    if (coarse[i] > peak) peak = coarse[i];
  }

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    br = (br + 0.018 * w) / 1.018;
    const src = brown ? pink * (1 - brown) + br * 3.6 * brown : pink;
    const k = i / step;
    const k0 = k | 0;
    const f = k - k0;
    const m = (coarse[k0] * (1 - f) + coarse[k0 + 1] * f) / peak;
    raw[i] = src * (floor + depth * m);
  }

  // Normalised so `flutter` and `depth` are shape controls and not volume ones,
  // which is the same discipline pinkLoop's brown tilt follows.
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i];
  const rms = Math.sqrt(sum / raw.length);
  if (rms > 0) {
    const g = 0.197 / rms;
    for (let i = 0; i < raw.length; i++) raw[i] *= g;
  }

  const buf = ctx.createBuffer(1, n, rate);
  const out = buf.getChannelData(0);
  out.set(raw.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = out[i] * Math.sqrt(t) + raw[n + i] * Math.sqrt(1 - t);
  }
  return buf;
}

/** Envelope buffers are slower than anything audible, so they are built at a low
 *  rate to keep them small. The browser resamples, which for a slow curve is
 *  exactly what you want. */
export const ENV_RATE = 8000;

/**
 * A looping envelope, as a buffer, from a shape function over 0..1.
 *
 * This is the mechanism the whole family rests on: connected to an AudioParam it
 * is a modulator that runs on the audio thread and survives the screen going
 * off. Several at COPRIME lengths drift in and out of phase and never repeat the
 * same way, which is how a bed gets weather without anybody scheduling it.
 */
export function envelopeLoop(ctx, seconds, shape) {
  const n = Math.floor(seconds * ENV_RATE);
  const buf = ctx.createBuffer(1, n, ENV_RATE);
  const out = buf.getChannelData(0);
  for (let i = 0; i < n; i++) out[i] = shape(i / n);
  return buf;
}

/**
 * Start a looping buffer as modulation on one or more AudioParams.
 *
 * It ADDS to whatever the param already holds, so a param set to the bottom of
 * its travel and modulated upwards gives a real floor and a real ceiling.
 */
export function modulate(ctx, sources, buffer, amount, startAt, ...params) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = amount;
  src.connect(g);
  for (const p of params) g.connect(p);
  src.start(startAt);
  sources.push(src);
  return g;
}

/** A looping noise layer through a lowpass, which is most of what a bed is. */
export function noiseLayer(ctx, sources, { seconds, cut, q = 0.7, gain = 1, brown = 0 }, dest, startAt) {
  const src = ctx.createBufferSource();
  src.buffer = pinkLoop(ctx, seconds, { brown });
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = q;
  lp.frequency.setValueAtTime(cut, startAt);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(lp).connect(g).connect(dest);
  src.start(startAt);
  sources.push(src);
  return { src, lp, gain: g };
}

/**
 * Two real seconds of silence, so the OS files the page under playback rather
 * than under "a page is open".
 *
 * BUILT RATHER THAN PASTED IN. The data URI this family started with was 44
 * bytes — a WAV header with a zero-length data chunk and no audio in it at all
 * (fact:the-silent-wav-has-no-audio-in-it). There is nothing for a zero-length
 * resource to loop, so the element never durably played, and an element that is
 * not playing earns none of the treatment it exists to ask for.
 */
export function silenceUrl(seconds = 2, rate = 8000) {
  const frames = seconds * rate;
  const bytes = new Uint8Array(44 + frames);
  const view = new DataView(bytes.buffer);
  const ascii = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };

  ascii(0, 'RIFF');       view.setUint32(4, 36 + frames, true);
  ascii(8, 'WAVEfmt ');   view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');      view.setUint32(40, frames, true);
  bytes.fill(128, 44);                  // 8-bit silence is 128, not 0
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * Run a bed. Wires the page up and returns nothing — everything after the tap
 * belongs to the audio thread.
 *
 * @param {{
 *   ceiling:number, fadeIn:number, fadeOut:number, title:string,
 *   build:(ctx:AudioContext, dest:AudioNode, t0:number, sources:AudioNode[])=>void
 * }} character
 */
export function runBed(character) {
  let ctx = null;
  let sources = [];
  let keepAlive = null;
  let silence = null;
  let endsAtMs = 0;
  let ticker = 0;

  const el = (id) => document.getElementById(id);

  function start(minutes) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { el('err').textContent = 'This browser cannot play sound.'; return; }

    // Safari lets a page say outright that it is playback audio rather than
    // leaving the OS to infer it from a silent element.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}

    ctx = new Ctx();
    ctx.resume();
    sources = [];

    const total = minutes * 60;
    const t0 = ctx.currentTime + 0.05;
    const end = t0 + total;

    // The ceiling: fixed, the only thing touching destination, and the reason
    // there is no volume control. A page knows its own gain and nothing about
    // the room — not the phone, not the slider, not the distance — so a control
    // here would be a guess dressed as a setting (dec:idea-how-loud-and-for-how-long).
    const ceiling = ctx.createGain();
    ceiling.gain.value = character.ceiling;
    ceiling.connect(ctx.destination);

    // The session envelope. Scheduled ONCE, here, and never touched again: this
    // is the part that has to survive the screen going off.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(1, t0 + Math.min(character.fadeIn, total / 4));
    env.gain.setValueAtTime(1, Math.max(t0 + character.fadeIn, end - character.fadeOut));
    env.gain.linearRampToValueAtTime(0.0001, end);
    env.connect(ceiling);

    character.build(ctx, env, t0, sources);

    // Every source is told when to stop NOW, for the same reason the envelope is
    // scheduled now: nothing may depend on this page still running later.
    sources.forEach((s) => { try { s.stop(end + 0.5); } catch (e) {} });

    keepAlive = startKeepAlive(character.title, minutes);
    endsAtMs = Date.now() + total * 1000;
    document.body.classList.add('playing');
    tick();
    ticker = setInterval(tick, 1000);
  }

  function startKeepAlive(title, minutes) {
    const a = document.createElement('audio');
    a.loop = true;
    silence = silenceUrl();
    a.src = silence;
    a.volume = 0.001;
    a.setAttribute('playsinline', '');
    document.body.appendChild(a);
    a.play().catch(() => {});
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist: `${minutes} minutes` });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('pause', stop);
        navigator.mediaSession.setActionHandler('stop', stop);
      } catch (e) {}
    }
    return a;
  }

  function stop() {
    clearInterval(ticker);
    sources.forEach((s) => { try { s.stop(); } catch (e) {} });
    sources = [];
    if (keepAlive) { keepAlive.pause(); keepAlive.remove(); keepAlive = null; }
    if (silence) { URL.revokeObjectURL(silence); silence = null; }
    if (ctx) { ctx.close(); ctx = null; }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'none'; } catch (e) {}
    }
    document.body.classList.remove('playing');
  }

  /** Cosmetic only, and read off the WALL clock so a throttled tab catches up
   *  the moment the screen comes back rather than believing it is early. */
  function tick() {
    const left = Math.max(0, Math.round((endsAtMs - Date.now()) / 1000));
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    el('clock').textContent = h
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
    if (left === 0) stop();
  }

  document.querySelectorAll('.times button').forEach((b) => {
    b.addEventListener('click', () => start(Number(b.dataset.min)));
  });
  el('stop').addEventListener('click', stop);

  // A safety net rather than a mechanism: if the OS suspended the context
  // anyway, coming back to the page resumes it rather than leaving it dead.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state === 'suspended') ctx.resume();
  });
}

// ---------------------------------------------------------------------------
// TRANSIENTS — the small struck sounds a bed is speckled with
// ---------------------------------------------------------------------------
//
// Raindrops on an awning, leaves turning over in a gust, a bubble leaving the
// silt. All the same thing: a very short excitation through a resonator, baked
// into a looping buffer because a bed may not schedule anything after the tap.
//
// LIFTED OUT OF /rain/ WHEN A THIRD BED WANTED THEM, which was the threshold
// written down when /waves/ was first copied: one copy is defensible, two is the
// point at which the common part comes out. Nothing below changed in the move —
// the numbers rain was tuned to are the numbers it still passes in.
//
// THE TWO HARD-WON LESSONS ARE IN THE COMMENTS BELOW AND ARE NOT TIDY DETAIL:
// a resonator held past about 100ms stops being a strike and becomes a PITCH,
// which sounds like metal; and `level` does not survive a change of sample rate,
// so it is measured against a probe rather than trusted.

/**
 * A loop of rain, with the drops already in it.
 *
 * Density is the thing to get right: too few and it is a dripping tap, too many
 * and the drops merge into the hiss they are supposed to sit on top of. These
 * are only the ones an ear picks out individually — the mass of rain is the
 * noise layer underneath.
 *
 * `level` IS SET AGAINST THE HISS RATHER THAN CHOSEN, and these numbers are all
 * stated BEFORE the NOISE and DROPS multipliers. Raw, the two drop loops sit at
 * about 0.48 of the hiss. As the bed stands — noise at 0.45, band narrowed,
 * drops at 0.65 — the hiss reaches the mix at about 0.023 rms and the drops at
 * about 0.012, which is 0.51 of it. Peaks stay near 0.46 and 0.31 before their
 * multiplier, so nothing clips before the ceiling.
 */
/**
 * THE DROP LOOPS RUN AT A LOWER SAMPLE RATE THAN THE CONTEXT, which is what pays
 * for them being minutes long instead of seconds.
 *
 * Everything these feed is lowpassed at AWNING_TOP, so nothing above about 4 kHz
 * survives to be heard and storing it at 48 kHz is storing silence at great
 * expense. 12 kHz leaves headroom over the highest resonance any drop is given
 * and costs a quarter as much. It is the same trade the baked drum kit already
 * makes at 22050, for the same reason.
 */
export const DROP_RATE = 12000;

/** The rate the drops were tuned at, and the level they are held to. */
const TUNED_AT = 48000;
/**
 * HOW LONG THE PROBE IS, AND IT IS NOT ARBITRARY. Drop levels are drawn from a
 * heavy-tailed distribution — mostly quiet with an occasional near one — so a
 * short measurement of their rms is noisy. Measured over eight runs: an 8-second
 * probe varies by 19%, 20s by 6.6%, 40s by 5.5% and 80s by 5.1%. 40 is where it
 * stops being worth more time.
 *
 * WORTH KNOWING ALONGSIDE IT: the loops this is matching were 19.7 and 23.3
 * seconds, which carry about 7% of that same variance themselves. The level his
 * ear approved was never precise to better than that, so "parity" here means
 * inside the noise the original already had.
 */
const PROBE_SECONDS = 40;

/**
 * ONE DROP, WRITTEN STRAIGHT INTO A BUFFER.
 *
 * A short noise burst through a two-pole resonator, which is about the cheapest
 * thing that sounds struck rather than clicked. The resonance is what gives a
 * drop its pitch — a small drop on glass pings high, a big one on a sill thuds —
 * and randomising it across drops is most of why a loop of them reads as rain
 * rather than as a machine ticking.
 *
 * `at` may run past the end: the caller writes modulo the length, so a drop that
 * starts near the end finishes at the beginning and the loop has no seam.
 */
/**
 * THE GRAIN ENVELOPE, PRECOMPUTED.
 *
 * ⚠️ A LOOKUP RATHER THAN MATH, AND IT IS NOT MICRO-OPTIMISATION. A canopy runs
 * hundreds of grains a second over loops minutes long, so the envelope is
 * evaluated about ten million times per buffer. Computed inline with `Math.pow`
 * that measured 2.6 SECONDS for one layer — five seconds for a forest, all of it
 * between the tap and the first sound. A 256-point table is inaudibly different
 * and costs nothing.
 */
const GRAIN_STEPS = 256;
const GRAIN_ENV = new Float32Array(GRAIN_STEPS);
for (let k = 0; k < GRAIN_STEPS; k++) {
  const t = k / GRAIN_STEPS;
  GRAIN_ENV[k] = Math.pow(1 - t, 2.2) * Math.min(1, t * 12);
}

function addTransient(out, at, { hz, decay, level, rate, tone = 1 }) {
  // `tone` IS WHAT SEPARATES A RAINDROP FROM A LEAF, and getting it wrong is how
  // the forest first came out sounding like rain.
  //
  // At 1 the excitation goes through a RESONATOR and comes out PITCHED: a drop
  // striking something has a note, because the thing it struck has a note. At 0
  // there is no resonator at all, just a short burst of noise under a falling
  // envelope — a crinkle with no pitch anywhere in it.
  //
  // A LEAF IS NOT A RESONATOR. Nothing about a leaf turning over rings; it is a
  // scrape. Built out of raindrops, a canopy is a rain sound whatever else is
  // done to it, because the ear hears the pitch and knows what made it.
  if (!tone) {
    const len = Math.max(3, Math.floor(decay * rate * 4));
    for (let i = 0; i < len; i++) {
      // Fast in, fast out. The shape is the whole character: a leaf is over
      // before it has begun, and a slow one would be a brush on a drum.
      out[(at + i) % out.length] +=
        (Math.random() * 2 - 1) * GRAIN_ENV[((i * GRAIN_STEPS) / len) | 0] * level;
    }
    return;
  }

  const w = (2 * Math.PI * hz) / rate;
  const r = Math.exp(-1 / (decay * rate));
  const c = 2 * r * Math.cos(w);
  const r2 = r * r;
  const burst = Math.max(2, Math.floor(rate * 0.0015));   // the impact itself
  const tail = Math.floor(decay * rate * 5);              // what rings after it

  // NORMALISED BY (1 - r), AND IT IS NOT OPTIONAL. A two-pole resonator has a
  // gain at resonance of roughly 1/(1 - r), which at these decay times is about
  // 290x. Measured before this line existed: peaks of 16 and 43 against a full
  // scale of 1, which is not a rain sound, it is destruction. Normalising here
  // also makes `level` mean the same thing whatever `decay` is, so a long drop
  // and a short one are equally loud rather than wildly not.
  const norm = (1 - r) * level;

  let y1 = 0, y2 = 0;
  for (let i = 0; i < burst + tail; i++) {
    const x = i < burst ? (Math.random() * 2 - 1) : 0;
    const y = x + c * y1 - r2 * y2;
    y2 = y1; y1 = y;
    out[(at + i) % out.length] += y * norm;
  }
}

function fillTransients(out, rate, { perSecond, hzLow, hzHigh, decay, level, tone = 1 }) {
  // COUNTED FROM THE BUFFER'S OWN DURATION, not from the config's `seconds`.
  // The probe below is a different length from the loop it measures, and taking
  // the count from the config packed a whole loop's drops into eight seconds —
  // which read as 310% too loud and would have been scaled INTO the mix.
  const count = Math.round((out.length / rate) * perSecond);
  for (let i = 0; i < count; i++) {
    addTransient(out, Math.floor(Math.random() * out.length), {
      // Log-spaced, so the ear hears the range as even rather than crowded high.
      hz: hzLow * Math.pow(hzHigh / hzLow, Math.random()),
      decay: decay * (0.6 + Math.random() * 0.8),
      // Mostly quiet with an occasional near one, which is what stops a loop of
      // drops sounding like a drum machine.
      level: level * Math.pow(Math.random(), 1.8),
      rate,
      tone,
    });
  }
}

const rmsOf = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
};

/**
 * A loop of rain, with the drops already in it.
 *
 * Density is the thing to get right: too few and it is a dripping tap, too many
 * and the drops merge into the hiss they are supposed to sit on top of. These
 * are only the ones an ear picks out individually — the mass of rain is the
 * noise layer underneath.
 *
 * `level` IS SET AGAINST THE HISS RATHER THAN CHOSEN, and the ratio his ear
 * settled on is 0.57. See DROPS for how that is held.
 *
 * ⚠️ AND THE LEVEL IS MEASURED AGAINST A PROBE RATHER THAN TRUSTED, because
 * `level` does NOT survive a change of sample rate on its own. The excitation is
 * 1.5 MILLISECONDS of noise, so at 12 kHz it is 18 samples where at 48 kHz it is
 * 72, and a quarter of the energy goes into the resonator. Measured when
 * DROP_RATE arrived: the same configuration came out 44% quieter.
 *
 * Two analytic corrections were tried and both were wrong — sqrt of the rate
 * ratio overshot by 17%, and a peak-matched probe by 110% — because peak and rms
 * do not scale the same way with burst length. So the buffer is simply compared
 * against a short probe generated at the rate these were TUNED at, and scaled to
 * match. It costs a few milliseconds once, it is exact, and it cannot be wrong
 * again the next time one of these numbers moves.
 */
export function transientLoop(ctx, cfg) {
  // A layer may ask for a lower rate still. The rule is the same one DROP_RATE
  // follows: store nothing the lowpass downstream is going to throw away. A
  // canopy stops at 2.4 kHz, so 6 kHz is transparent for it and costs half.
  const rate = cfg.rate ?? DROP_RATE;
  const n = Math.floor(cfg.seconds * rate);
  const buf = ctx.createBuffer(1, n, rate);
  const out = buf.getChannelData(0);
  fillTransients(out, rate, cfg);

  // ⚠️ THE PROBE IS ONLY NEEDED FOR THE RESONATOR PATH, and skipping it for
  // grains is a real saving rather than a shortcut.
  //
  // A struck transient is excited by a fixed 1.5 MILLISECONDS of noise, so how
  // many SAMPLES that is depends on the rate, and the energy reaching the
  // resonator changes with it. That is the whole reason the probe exists.
  //
  // A grain has no such fixed window: its length is `decay * rate * 4`, so it
  // scales WITH the rate and the mean square works out to `density * decay * 4 *
  // level^2` — with no rate term in it at all. Nothing to correct, and a probe
  // here would cost a second of dense grain generation at 48 kHz to discover a
  // ratio of one.
  if (cfg.tone !== 0) {
    const probe = new Float32Array(Math.floor(PROBE_SECONDS * TUNED_AT));
    fillTransients(probe, TUNED_AT, cfg);

    const want = rmsOf(probe);
    const got = rmsOf(out);
    if (got > 0) for (let i = 0; i < n; i++) out[i] *= want / got;
  }

  return buf;
}
