// The shell (comp:shell) — the page itself, and the composition root.
//
// Governed by dec:shell-is-the-composition-root: this is the only part that
// knows about all the others. It constructs them, wires them together, and
// depends on every one of them — and nothing depends on it.
//
// It also owns the two things that are the page's problem rather than the
// game's: the first-tap gate that starts audio (dec:beat-the-silent-switch) and
// asking her to turn the phone, which iOS Safari will not do for us.

import { Clock, STEPS_PER_BAR } from './clock.js';
import { Voices } from './voices.js';
import { Track, ROUNDS, GRID, quantise } from './track.js';
import { Stage } from './stage.js';
import { Session, COUNT_IN_BARS } from './session.js';
import { trackFromLocation, share } from './link.js';

const el = (id) => document.getElementById(id);

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const voices = new Voices(ctx);

// A track may already be in the address bar, because someone sent one. If so it
// is hers to hear and take apart, so every round is open from the start.
const incoming = trackFromLocation();
const track = incoming ?? new Track();
const clock = new Clock(ctx, { bpm: track.bpm });
const session = new Session(track);
if (incoming) session.openEverything();

/** Notes she has just played live, which the scheduler must not repeat. */
const alreadySounded = new Set();
/** Lanes held right now, mapped to the last absolute step written for each. */
const holding = new Map();
/** Clicks already scheduled, so a re-entered window cannot double them. */
let clickedTo = 0;

const stage = new Stage(el('stage'), clock, { onHit, onRelease });

// ---------------------------------------------------------------------------
// The hot path. Sound first, recording after — never the other way round.
// ---------------------------------------------------------------------------

function voiceFor(round, lane) {
  const l = round.lanes[lane];
  return { voice: l.voice, degree: l.degree ?? 0 };
}

function onHit(lane) {
  if (!voices.ready) return;

  // Before the tempo exists, the keys are how she taps it out. She is still
  // hearing the sound she will be playing, so setting the tempo already sounds
  // like the instrument rather than like a settings screen.
  if (session.state === 'tempo' && !session.tempoIsSet) {
    voices.play(voiceFor(session.round, lane).voice, { degree: 0 });
    const bpm = session.tapTempo();
    if (bpm !== null) clock.setTempo(bpm);
    return;
  }

  const round = session.round;
  const { voice, degree } = voiceFor(round, lane);

  // 1. Sound. Now, with no time argument, so it goes at the earliest moment the
  //    audio thread will take it.
  voices.play(voice, { degree });

  // 2. Recording, afterwards — and only while she is actually recording.
  if (!session.recording) return;
  const at = clock.now();
  if (at === null) return;
  track.record(round.id, lane, at);

  // The SAME quantiser the track uses. These were once two different roundings
  // and where they disagreed a note sounded twice.
  const absStep = quantise(at);
  if (clock.timeOf(absStep) > ctx.currentTime) {
    alreadySounded.add(`${round.id}:${lane}:${absStep}`);
  }
  holding.set(lane, absStep);
  refresh();
}

function onRelease(lane) {
  holding.delete(lane);
}

/**
 * Extend held lanes into the step the playhead has reached.
 *
 * FLOOR, not nearest, unlike the initial press: a press snaps to whichever step
 * it is closest to, but a hold may only fill steps she has actually reached.
 * Rounding here would write a note slightly ahead of her thumb.
 */
function extendHeld() {
  if (!holding.size || !session.recording || !session.round.sustains) return;
  const at = clock.now();
  if (at === null) return;
  const reached = Math.floor(at / GRID) * GRID;

  for (const [lane, lastStep] of holding) {
    if (reached <= lastStep) continue;
    // Fill every step crossed, so a stall cannot leave a gap mid-note.
    for (let s = lastStep + GRID; s <= reached; s += GRID) {
      track.record(session.round.id, lane, s);
      alreadySounded.add(`${session.round.id}:${lane}:${s}`);
    }
    holding.set(lane, reached);
  }
}

clock.onSchedule((from, to, timeOf) => {
  // The tick is the only heartbeat anything needs — there is one clock.
  extendHeld();
  session.tick(clock.now() ?? 0);
  if (!voices.ready) return;

  const loop = track.loopSteps;

  for (let step = from; step < to; step++) {
    // The click, on every beat, while it is still earning its place.
    if (step % 4 === 0 && step >= clickedTo && session.clickAudible) {
      voices.playClick(timeOf(step), { accent: step % STEPS_PER_BAR === 0 });
      clickedTo = step + 1;
    }

    const slot = ((step % loop) + loop) % loop;
    for (const round of ROUNDS) {
      // Only rounds she has KEPT play back. The one in her hands is heard live.
      if (!track.accepted.has(round.id) && round.id !== session.round.id) continue;

      for (const lane of track.lanesAt(round.id, slot)) {
        // A held block sounds once, where it begins, and rings for its length.
        if (!track.isRunStart(round.id, lane, slot)) continue;
        const key = `${round.id}:${lane}:${step}`;
        if (alreadySounded.delete(key)) continue;
        const { voice, degree } = voiceFor(round, lane);
        const gain = round.id === session.round.id ? 1 : 0.8;
        voices.play(voice, { degree, time: timeOf(step), gain });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The transport. One big button in the middle, where neither thumb rests.
// ---------------------------------------------------------------------------

function transportLabel() {
  if (session.state === 'recording') return 'STOP';
  if (session.state === 'counting') return '…';
  if (session.state === 'done') return 'DONE';
  if (!session.tempoIsSet) return `TAP ${session.tapsSoFar}/4`;
  return 'START';
}

/**
 * One reset button, labelled with whatever it would actually do right now.
 *
 * Deliberately one control rather than several. This screen's virtue is that
 * almost nothing is on it, and four separate undo buttons on a two-key game is
 * how it stops being a two-key game. Naming the round it would clear — "clear
 * hats" — also beats "reset layer", which makes her work out what a layer is
 * and which one she is on.
 *
 * Returns null when there is nothing to undo, and the button hides.
 */
function resetAction() {
  if (track.count(session.round?.id) > 0) {
    return { label: `clear ${session.round.label.toLowerCase()}`, kind: 'round' };
  }
  if (session.canRetapTempo) return { label: 'new tempo', kind: 'tempo' };
  return null;
}

function refresh() {
  el('transport').textContent = transportLabel();
  el('transport').dataset.state = session.state;
  el('round').textContent = session.round?.full ?? '';
  el('bpm').textContent = session.tempoIsSet ? `${track.bpm} bpm` : '';

  const undo = resetAction();
  el('reset').hidden = undo === null;
  if (undo) {
    el('reset').textContent = undo.label;
    el('reset').dataset.kind = undo.kind;
  }

  const strip = el('rounds');
  strip.innerHTML = '';
  ROUNDS.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = r.label;
    b.disabled = i > session.furthestReachable();
    b.setAttribute('aria-current', i === session.roundIndex ? 'true' : 'false');
    if (track.accepted.has(r.id)) b.classList.add('kept');
    b.addEventListener('click', (e) => { e.stopPropagation(); session.goTo(i); });
    strip.appendChild(b);
  });

  stage.setRound(session.round);
  stage.setArmed(session.recording);
}

el('transport').addEventListener('click', (e) => {
  e.stopPropagation();
  if (session.state === 'recording') {
    session.stop();
  } else if (session.state === 'tempo' && session.tempoIsSet) {
    // Count her in from the top of the next bar, so the count-in itself lands
    // musically rather than wherever she happened to press.
    if (!clock.running) clock.start();
    const now = clock.now() ?? 0;
    const nextBar = (Math.floor(now / STEPS_PER_BAR) + 1) * STEPS_PER_BAR;
    session.begin(nextBar + COUNT_IN_BARS * STEPS_PER_BAR);
  }
  refresh();
});

el('reset').addEventListener('click', (e) => {
  e.stopPropagation();
  const undo = resetAction();
  if (!undo) return;

  if (undo.kind === 'tempo') {
    // Stop the clock too. It refuses to retune while running, on purpose —
    // every scheduled time and every block on screen is derived from it — so
    // going back to tapping means going back to not running.
    clock.stop();
    session.clearTempo();
  } else {
    session.reset();
  }
  holding.clear();
  refresh();
});

el('share').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (track.isEmpty()) { flash('play something first'); return; }
  const how = await share(track);
  if (how === 'shared') flash('sent');
  else if (how === 'copied') flash('link copied — paste it to someone');
  else flash('could not share, sorry');
});

// ---------------------------------------------------------------------------
// What the session says, and how the page shows it
// ---------------------------------------------------------------------------

session.onNudge((n) => {
  switch (n.kind) {
    case 'tempo-set':
      clock.setTempo(track.bpm);
      flash(`${track.bpm} — that's your speed`);
      break;
    case 'counting-in':
      voices.setClickLevel(0.9, 0.15);
      break;
    case 'recording':
      flash(`play the ${session.round.full.toLowerCase()}`);
      break;
    case 'round-kept':
      // The click retires here: from now on her own beat is the click.
      if (ROUNDS[n.index]?.click) voices.setClickLevel(0, 1.2);
      flash('kept');
      break;
    case 'next-round':
      flash(`now the ${session.round.full.toLowerCase()}`);
      break;
    case 'round-reset': flash('cleared — go again'); break;
    case 'tempo-cleared': flash('tap the keys four times for a new speed'); break;
    case 'round-changed': flash(`back on the ${session.round.full.toLowerCase()}`); break;
    case 'nothing-to-keep': flash('play something first'); break;
    case 'all-done': flash('you made a whole track'); break;
    default: break;
  }
  refresh();
});

let flashTimer = null;
function flash(text) {
  const n = el('nudge');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => n.classList.remove('show'), 2400);
}

/** The count-in, shown as a number counting down the empty middle. */
setInterval(() => {
  if (session.state !== 'counting') { stage.setCountdown(null); return; }
  const now = clock.now();
  if (now === null) return;
  const beatsLeft = Math.ceil((session.countInEndsAtStep - now) / 4);
  stage.setCountdown(Math.max(1, beatsLeft));
}, 60);

// ---------------------------------------------------------------------------
// Starting the sound. All of this happens inside the first gesture.
// ---------------------------------------------------------------------------

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

async function startAudio() {
  // Layer 1: ask iOS for a playback session outright — the only non-hack way
  // through the ringer switch.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
  // Layer 2: the older trick, still inside the gesture.
  try {
    const a = new Audio(SILENT_WAV);
    a.loop = true; a.volume = 0; a.setAttribute('playsinline', '');
    await a.play();
    window.__mjKeepAlive = a; // hold a reference or it is collected and stops
  } catch { /* best effort */ }

  await ctx.resume();
  voices.startDrone();
  refresh();
}

el('gate').addEventListener('click', async () => {
  el('gate').classList.add('gone');
  await startAudio();
}, { once: true });

// iOS suspends the context on background. Silent after a phone call is the same
// failure as the silent switch, by another route.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ctx.resume();
});

// ---------------------------------------------------------------------------
// Orientation. Safari on iOS will not lock it, so we ask.
// ---------------------------------------------------------------------------

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('portrait', portrait);
  if (!portrait) stage.resize();
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250));

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

checkOrientation();
stage.mount(track);
refresh();

if (incoming) el('gate-title').textContent = 'someone made you a beat';

voices.load().then(() => {
  for (const inst of ['bass', 'lead']) {
    if (track.shaping[inst] && Object.keys(track.shaping[inst]).length) {
      voices.setShaping(inst, track.shaping[inst]);
    }
  }
  el('gate-label').textContent = incoming ? 'tap to hear it' : 'tap to start';
  el('gate').classList.add('loaded');
  // Say what the first move is. The transport reads "TAP 0/4", which is only
  // obvious once you already know what it means.
  if (!incoming) setTimeout(() => flash('tap the two keys four times to set your speed'), 700);
}).catch((err) => {
  el('gate-label').textContent = 'could not load the sounds';
  console.error(err);
});
