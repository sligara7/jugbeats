// The shell (comp:shell) — the page itself, and the composition root.
//
// Governed by dec:shell-is-the-composition-root: this is the only part that
// knows about all the others. It constructs them, wires them together, and
// depends on every one of them — and nothing depends on it.
//
// It also owns the two things that are the page's problem rather than the
// game's: the first-tap gate that starts audio (dec:beat-the-silent-switch) and
// asking her to turn the phone, which iOS Safari will not let us do for her
// (req:works-on-her-iphone).

import { Clock } from './clock.js';
import { Voices } from './voices.js';
import { Track, LAYERS, GRID } from './track.js';
import { Stage } from './stage.js';
import { Coach } from './coach.js';
import { trackFromLocation, share } from './link.js';

const el = (id) => document.getElementById(id);

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const clock = new Clock(ctx);
const voices = new Voices(ctx);

// A track may already be in the address bar, because someone sent one
// (dec:track-in-the-url). If so it is hers to hear and to take apart, so every
// layer is open from the start rather than earned again.
const incoming = trackFromLocation();
const track = incoming ?? new Track();
const coach = new Coach(track);
if (incoming) coach.unlockAll();

/**
 * Notes she has just played live, which must not also be played by the
 * scheduler on this pass.
 *
 * Quantising rounds to the NEAREST sixteenth, so a tap slightly early lands on
 * a step that is still in the future — and the scheduler would then sound it
 * again a few tens of milliseconds later, as a flam. She heard it when she
 * pressed; that is the one that counts.
 */
const alreadySounded = new Set();

/**
 * Lanes she is holding right now, mapped to the last absolute step recorded for
 * each. Holding a key fills the steps it covers, and those adjacent steps are
 * merged back into one long block by the track — so pressing and holding writes
 * a held note, which is the same gesture as holding a piano key down.
 */
const holding = new Map();

const stage = new Stage(el('stage'), clock, { onHit, onRelease });

// ---------------------------------------------------------------------------
// The hot path. Sound first, recording after — never the other way round.
// ---------------------------------------------------------------------------

function voiceFor(layer, lane) {
  const slot = layer.lanes[lane];
  return typeof slot === 'string'
    ? { voice: slot, degree: 0 }
    : { voice: layer.id, degree: slot };
}

function onHit(lane) {
  if (!voices.ready) return;
  const layer = coach.layer;
  const { voice, degree } = voiceFor(layer, lane);

  // 1. Sound. Now, with no time argument, so it goes out at the earliest
  //    moment the audio thread can take it.
  voices.play(voice, { degree });

  // 2. Recording, afterwards.
  const at = clock.now();
  if (at === null) return;
  const slot = track.record(layer.id, lane, at);

  const absStep = Math.round(at);
  if (clock.timeOf(absStep) > ctx.currentTime) {
    alreadySounded.add(`${layer.id}:${lane}:${absStep}`);
  }

  holding.set(lane, absStep);

  // 3. And only then does the coach get to notice.
  coach.noteRecorded(layer.id);
  renderStrip();
  void slot;
}

function onRelease(lane) {
  holding.delete(lane);
}

/**
 * Extend every held lane into the step the playhead has now reached.
 *
 * Uses FLOOR rather than nearest, unlike the initial press: a press should snap
 * to whichever grid step it is closest to, but a hold should only ever fill
 * steps she has actually reached. Rounding here would write a note slightly
 * ahead of her thumb.
 */
function extendHeld() {
  if (!holding.size || !voices.ready) return;
  // Nothing to extend on a layer where holding means nothing. Holding a kick
  // would otherwise write a kick on every step she held it through, which is a
  // machine gun rather than a long note.
  if (!coach.layer.sustains) return;
  const at = clock.now();
  if (at === null) return;
  const reached = Math.floor(at / GRID) * GRID;

  for (const [lane, lastStep] of holding) {
    if (reached <= lastStep) continue;
    // Fill in every step crossed, so a stall cannot leave a gap in the middle
    // of a held note.
    for (let s = lastStep + GRID; s <= reached; s += GRID) {
      track.record(coach.layer.id, lane, s);
      alreadySounded.add(`${coach.layer.id}:${lane}:${s}`);
    }
    holding.set(lane, reached);
  }
}

clock.onSchedule((from, to, timeOf) => {
  // The tick is also the only heartbeat a held note needs — no second timer,
  // because there is only ever one clock (dec:one-clock).
  extendHeld();

  if (!voices.ready) return;
  const loop = track.loopSteps;

  for (let step = from; step < to; step++) {
    const slot = ((step % loop) + loop) % loop;
    for (const layer of LAYERS) {
      for (const lane of track.lanesAt(layer.id, slot)) {
        // A held block sounds ONCE, where it begins, and then rings for its
        // length. Firing on every step it covers would turn one long 808 note
        // into a machine-gun of retriggers.
        if (!track.isRunStart(layer.id, lane, slot)) continue;

        const key = `${layer.id}:${lane}:${step}`;
        if (alreadySounded.delete(key)) continue;
        const { voice, degree } = voiceFor(layer, lane);
        // Layers she is not currently playing sit back a little, so the one in
        // her hands is always the one she hears most clearly.
        const gain = layer.id === coach.layer.id ? 1 : 0.72;
        voices.play(voice, { degree, time: timeOf(step), gain });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The layer strip — the only navigation in the game.
// ---------------------------------------------------------------------------

function renderStrip() {
  const strip = el('layers');
  strip.innerHTML = '';
  LAYERS.forEach((layer, i) => {
    const b = document.createElement('button');
    b.className = 'layer';
    b.textContent = layer.label;
    b.disabled = i >= coach.unlocked;
    b.setAttribute('aria-current', i === coach.layerIndex ? 'true' : 'false');
    b.addEventListener('click', () => coach.goTo(i));
    strip.appendChild(b);
  });
}

coach.onNudge((n) => {
  if (n.kind === 'layer-changed') {
    stage.setLayer(n.layerId);
  } else if (n.kind === 'layer-offered') {
    flash(`nice — now try the ${LAYERS[n.index].label.toLowerCase()}`);
  } else if (n.kind === 'track-done') {
    flash('you made a whole track');
  }
  renderStrip();
});

let flashTimer = null;
function flash(text) {
  const n = el('nudge');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => n.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// Starting the sound. All of this must happen inside the first gesture.
// ---------------------------------------------------------------------------

/**
 * Silent one-sample WAV. Playing this inside the gesture shifts the iOS audio
 * session on versions without navigator.audioSession, which is what lets sound
 * through the ringer switch (dec:beat-the-silent-switch, layer 2).
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

async function startAudio() {
  // Layer 1: ask iOS for a playback session outright. Supported on recent
  // Safari and the only non-hack way through the switch.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* not available; fall through */ }

  // Layer 2: the older trick, still inside the gesture.
  try {
    const a = new Audio(SILENT_WAV);
    a.loop = true;
    a.volume = 0;
    a.setAttribute('playsinline', '');
    await a.play();
    window.__mjKeepAlive = a; // hold a reference or it is collected and stops
  } catch { /* best effort */ }

  await ctx.resume();
  stage.setAudioLive(true);
  clock.start();
}

el('gate').addEventListener(
  'click',
  async () => {
    el('gate').classList.add('gone');
    await startAudio();
  },
  { once: true }
);

// iOS suspends the context on background. A game that is silent after a phone
// call is the same failure as the silent switch, by another route.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && clock.running) ctx.resume();
});

// ---------------------------------------------------------------------------
// Orientation. Safari on iOS cannot be made to lock it, so we ask.
// ---------------------------------------------------------------------------

function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('portrait', portrait);
  if (!portrait) stage.resize();
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250));

// ---------------------------------------------------------------------------
// Sending it back. The round trip is the point (flow:round-trip).
// ---------------------------------------------------------------------------

el('share').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (track.isEmpty()) {
    flash('play something first');
    return;
  }
  // Inside the gesture, or iOS refuses the share sheet.
  const how = await share(track);
  if (how === 'shared') flash('sent');
  else if (how === 'copied') flash('link copied — paste it to someone');
  else flash('could not share, sorry');
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

checkOrientation();
renderStrip();
stage.mount(track);
stage.setLayer(coach.layer.id);

if (incoming) {
  el('gate-title').textContent = 'someone made you a beat';
}

voices
  .load()
  .then(() => {
    // Her shaping numbers arrived with the track, so the voices have to be
    // rebuilt from them before the first note sounds.
    for (const inst of ['bass', 'lead']) {
      if (track.shaping[inst] && Object.keys(track.shaping[inst]).length) {
        voices.setShaping(inst, track.shaping[inst]);
      }
    }
    el('gate-label').textContent = incoming ? 'tap to hear it' : 'tap to start';
    el('gate').classList.add('loaded');
  })
  .catch((err) => {
    el('gate-label').textContent = 'could not load the sounds';
    console.error(err);
  });
