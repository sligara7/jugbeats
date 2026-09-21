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
