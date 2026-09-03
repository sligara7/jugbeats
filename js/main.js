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
import { Track, ROUNDS, GRID, FINE_GRID, quantise, chordAt, setRounds } from './track.js';
import { Stage } from './stage.js';
import { Session, COUNT_IN_BARS } from './session.js';
import { trackFromLocation, share, paletteIdFromLocation } from './link.js';
import { saveMidi } from './midi.js';
import { byId, byKey, PHONK, paletteFromLocation, homeFor, siteRoot } from './palettes.js';

const el = (id) => document.getElementById(id);

/**
 * WHICH STYLE THIS PAGE IS (dec:styles-are-palettes), settled before anything
 * else exists because the round list depends on it and everything depends on
 * the round list.
 *
 * A LINK WINS OVER THE QUERY STRING. If someone sends a calm track, opening it
 * has to give you the calm game whatever `?p=` says — otherwise her handpan
 * comes out as a kick, which is exactly the failure the palette byte was added
 * to prevent. The id is read straight out of the link's fourth byte, because
 * decoding it properly would need the rounds that are not chosen yet.
 */
function whichPalette() {
  // 1. A LINK WINS OVER EVERYTHING. If someone sends a calm track, opening it
  //    has to give the calm game whatever page it lands on — otherwise the
  //    handpan comes out as a kick, which is the failure the palette byte was
  //    added to prevent. Read straight from the link's fourth byte, because
  //    decoding it properly would need the rounds that are not chosen yet.
  if (location.hash) return byId(paletteIdFromLocation());
  // 2. THE PAGE ITSELF. /jugbeats/ethereal/ declares data-palette on <html>,
  //    which is what makes a clean URL possible without a query string.
  const declared = document.documentElement.dataset.palette;
  if (declared) return byKey(declared);
  // 3. ?p=calm, kept as an alias so one deployment can serve either way.
  return paletteFromLocation();
}

const palette = whichPalette();
setRounds(palette.rounds);

/**
 * A SHARED TRACK ARRIVES AT ITS OWN PALETTE'S PAGE, even if the link pointed
 * somewhere else.
 *
 * The palette byte already makes it PLAY correctly wherever it lands, so this is
 * not about sound. It is about the address bar being right afterwards: if she
 * opens a calm link that landed on the phonk page and then sends it on, the
 * second link should not be one hop further from home. Replacing rather than
 * pushing, so the back button still leaves rather than looping.
 *
 * Guarded on the path actually differing, which is what stops this bouncing.
 */
if (location.hash && palette.home !== undefined) {
  const want = new URL(homeFor(palette)).pathname;
  if (location.pathname !== want) {
    location.replace(new URL(palette.home, siteRoot()).toString() + location.hash);
  }
}

/**
 * Ask iOS for a playback audio session BEFORE the AudioContext is built.
 *
 * This used to be done inside the first-tap handler, which is far too late: on
 * iOS the session category is bound as the context is created, so asking
 * afterwards can leave the context on the ambient category — the one the ringer
 * silences. It is asked for again inside the gesture, because the platform is
 * inconsistent about which of the two moments it honours.
 */
function requestPlaybackSession() {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = 'playback';
      return true;
    }
  } catch { /* not available */ }
  return false;
}
const sessionAsked = requestPlaybackSession();

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const voices = new Voices(ctx, { palette });

// A track may already be in the address bar, because someone sent one. If so it
// is hers to hear and take apart, so every round is open from the start.
const incoming = trackFromLocation();
const track = incoming ?? new Track();
track.paletteId = palette.id;
const clock = new Clock(ctx, { bpm: track.bpm, swing: palette.swing });
const session = new Session(track);
if (incoming) session.openEverything();

/** Notes she has just played live, which the scheduler must not repeat. */
const alreadySounded = new Set();
/** Lanes held right now, mapped to the last absolute step written for each. */
const holding = new Map();
/** The live sounding note under each thumb, so it can be let go on release. */
const held = new Map();

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
  //
  //    On a sustaining round the note is HELD: at the moment she presses,
  //    nothing knows how long it will be, so it cannot be chosen in advance.
  //    It rings until she lets go, which is what the long block on screen has
  //    been promising and not delivering.
  const now = clock.now();
  const chord = chordAt(now ?? 0);
  if (round.sustains) {
    held.get(lane)?.release();
    held.set(lane, voices.startHeld(voice, { degree, chord }));
  } else {
    voices.play(voice, { degree, chord });
  }

  // 2. Recording, afterwards — and only while she is actually recording.
  if (!session.recording) return;
  const at = now;
  if (at === null) return;
  track.record(round.id, lane, at);

  // The SAME quantiser the track uses, at the SAME grid. These were once two
  // different roundings, and where they disagreed a note sounded twice.
  const absStep = quantise(at, track.gridFor(round.id));
  if (clock.timeOf(absStep) > ctx.currentTime) {
    alreadySounded.add(`${round.id}:${lane}:${absStep}`);
  }
  holding.set(lane, absStep);
  refresh();
}

function onRelease(lane) {
  holding.delete(lane);
  // Let the sounding note go with her thumb.
  held.get(lane)?.release();
  held.delete(lane);
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
  const grid = track.gridFor(session.round.id);
  const reached = Math.floor(at / grid) * grid;

  for (const [lane, lastStep] of holding) {
    if (reached <= lastStep) continue;
    // Fill every step crossed, so a stall cannot leave a gap mid-note.
    for (let s = lastStep + grid; s <= reached; s += grid) {
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

  for (let step = from; step < to; step++) {
    // The click, on every beat, while it is still earning its place.
    //
    // There is deliberately NO extra guard against scheduling the same beat
    // twice. There used to be — a high-water mark of the last step clicked —
    // and it was the bug that silenced the metronome for half a minute after
    // she reset her tempo: the clock's step counter goes back to zero on a
    // restart and the high-water mark did not, so every click was suppressed
    // until absolute time caught up with the previous attempt.
    //
    // The clock already promises each step exactly once, in order, with no
    // gaps, and there is a test asserting it across a stop and a restart. A
    // second guard on top of a guaranteed property does not add safety; it adds
    // a second thing that can be wrong, and here it was.
    if (step % 4 === 0 && session.clickAudible) {
      voices.playClick(timeOf(step), { accent: step % STEPS_PER_BAR === 0 });
    }

    for (const round of ROUNDS) {
      // Only rounds she has KEPT play back. The one in her hands is heard live.
      if (!track.accepted.has(round.id) && round.id !== session.round.id) continue;
      // A silenced round stops looping. Her LIVE taps are unaffected — they go
      // out through onHit and never come near this — so she can mute a layer
      // and still play it, which is how you find out what it was doing.
      if (track.isMuted(round.id)) continue;

      // Each round wraps at its OWN length, which is the whole of polymeter:
      // a three-bar bass under a four-bar drum part drifts and comes back
      // together every twelve bars (dec:layers-of-different-lengths).
      const loop = track.loopStepsFor(round.id);
      const slot = ((step % loop) + loop) % loop;

      for (const lane of track.lanesAt(round.id, slot)) {
        // A held block sounds once, where it begins, and rings for its length.
        if (!track.isRunStart(round.id, lane, slot)) continue;
        const key = `${round.id}:${lane}:${step}`;
        if (alreadySounded.delete(key)) continue;
        const { voice, degree } = voiceFor(round, lane);
        const gain = round.id === session.round.id ? 1 : 0.8;
        // Sound it for as long as she held it. A drum ignores this and keeps
        // its own length; a pitched note takes the nearest rendered one.
        const steps = track.runLengthAt(round.id, lane, slot);
        voices.play(voice, {
          degree, time: timeOf(step), gain, chord: chordAt(step),
          seconds: steps * clock.stepSeconds,
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The transport. One big button in the middle, where neither thumb rests.
// ---------------------------------------------------------------------------

/**
 * What the big button says right now.
 *
 * It used to say STOP while recording, and the owner's objection was exact: it
 * does not stop anything. It keeps the round and moves her to the next one, and
 * the music carries on either way. PAUSE is the thing that stops, and two
 * buttons saying stop while meaning different things is how a child learns to
 * trust neither.
 */
function transportLabel() {
  if (session.state === 'recording') return 'NEXT ▸';
  if (session.state === 'counting') return '…';
  // It used to say DONE, and pressing it did nothing at all — the label knew
  // about a state the handler did not. What the end of a whole track is FOR is
  // sending it: the game arrived over WhatsApp and what she made goes back the
  // same way (dec:track-in-the-url), so the last press is the one that does it.
  //
  // It shares a word with the strip's "send ▸", which rule:one-word-one-meaning
  // exists to prevent. The rule's harm is two controls saying one word and
  // MEANING different things; these are one meaning reachable from two places,
  // which is the opposite problem.
  if (session.state === 'done') return 'SEND ▸';
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
/**
 * The left-hand button, labelled with whatever it would actually do right now.
 *
 * THREE THINGS, ONE CONTROL, and the same reasoning the reset button already
 * uses: this screen's virtue is that almost nothing is on it, and a fourth
 * permanent button on a two-key game is how it stops being a two-key game.
 * Only one of these is ever true, and the label always names it.
 *
 *   LISTEN — while recording. Stops KEEPING what she plays and lets the loop run
 *            on, so she can find where the note wants to sit before committing
 *            it. The owner's word, and the thing a loop pedal calls punching out.
 *   STOP   — while the music runs and nothing is being recorded. Ends everything.
 *   PLAY   — once it has been stopped.
 *
 * LISTEN AND STOP ARE DELIBERATELY NOT BOTH PRESENT AT ONCE. Two buttons that
 * both end something, on one screen, is how a child learns to trust neither
 * (rule:one-word-one-meaning) — the same reason the big button stopped saying
 * STOP and started saying NEXT. From a recording round, silence is two taps:
 * listen, then stop. That is the right cost for the rarer thing.
 */
function transportAction() {
  if (session.recording) return { label: 'listen', kind: 'listen' };
  if (clock.running) return { label: 'stop', kind: 'stop' };
  if (session.tempoIsSet) return { label: 'play', kind: 'play' };
  return null;
}

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

  // How long this round loops for, and — once they differ — when everything
  // lines up again. That second number is what turns drifting layers from a
  // fault into a pattern she can hear coming.
  const lenBtn = el('length');
  const gridBtn = el('grid');
  const round = session.round;
  const busy = !round || session.recording || session.state === 'counting';
  lenBtn.hidden = busy;
  gridBtn.hidden = busy;
  if (!busy) {
    const bars = track.barsFor(round.id);
    const composite = track.compositeBars;
    lenBtn.textContent = composite === bars
      ? `${bars} bars`
      : `${bars} bars · meets every ${composite}`;
    gridBtn.textContent = track.gridFor(round.id) === FINE_GRID ? '1/16 notes' : '1/8 notes';
  }

  const pp = el('playpause');
  const action = transportAction();
  pp.hidden = action === null;
  if (action) {
    pp.textContent = action.label;
    pp.dataset.state = action.kind;
  }

  // Only once the whole track is finished, and it stays out of the way until
  // then. A shared link arrives with every round already accepted, so the
  // grown-up who opens her beat on a laptop has it immediately.
  el('midi').hidden = !ROUNDS.every((r) => track.accepted.has(r.id));

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
    if (track.isMuted(r.id)) b.classList.add('muted');

    // One chip, two jobs, and which one you get depends on where you already
    // are: tap another round to GO there, tap the one you are on to SILENCE it.
    // Once she has built everything, playing with the arrangement is the more
    // common action, and it lands on the chip already under her attention.
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (i === session.roundIndex && track.accepted.has(r.id)) {
        const nowMuted = track.toggleMute(r.id);
        flash(nowMuted ? `${r.label.toLowerCase()} off` : `${r.label.toLowerCase()} back on`);
      } else {
        session.goTo(i);
      }
      refresh();
    });
    strip.appendChild(b);
  });

  stage.setRound(session.round);
  stage.setArmed(session.recording);
}

el('transport').addEventListener('click', (e) => {
  e.stopPropagation();
  if (session.state === 'recording') {
    session.stop();
  } else if (session.state === 'done') {
    // Not awaited, and it must not be: the share sheet has to be opened from
    // inside this gesture or iOS refuses it, and sendTrack calls share() before
    // its first await.
    sendTrack();
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
    // Absolute step numbers start again from zero, so anything remembered
    // against them is now about a different moment. This is the same class of
    // staleness that silenced the click for half a minute.
    alreadySounded.clear();
    for (const h of held.values()) h.release();
    held.clear();
    session.clearTempo();
  } else {
    session.reset();
  }
  holding.clear();
  refresh();
});

/**
 * Cycle this round's length.
 *
 * 2, 3, 4, 6 — small numbers on purpose. Two layers line up again after the
 * lowest common multiple of their lengths, so three against four meet every
 * twelve bars, which a listener hears as a pattern coming round. Seven against
 * eight would take fifty-six, which a listener hears as the game being broken.
 */
const LENGTHS = [2, 3, 4, 6];

el('length').addEventListener('click', (e) => {
  e.stopPropagation();
  const round = session.round;
  if (!round) return;
  const next = LENGTHS[(LENGTHS.indexOf(track.barsFor(round.id)) + 1) % LENGTHS.length];
  track.setBars(round.id, next);

  const composite = track.compositeBars;
  flash(composite === next
    ? `${round.label.toLowerCase()}: ${next} bars`
    : `${round.label.toLowerCase()}: ${next} bars — everything meets every ${composite}`);
  refresh();
});

/**
 * Coarse or fine, for this round.
 *
 * Eighths are the forgiving grid and stay the default. Sixteenths are here for
 * one reason: a sixteenth-note snare or hat run is a signature of the genre and
 * is unreachable at eighths. The cost is that a tap snaps within about 54ms
 * instead of 108, so her timing is recorded rather than tidied — which is why
 * this is per round and off unless she asks.
 */
/**
 * Stop the music, and start it again.
 *
 * Deliberately NOT called stop: the big button already says STOP and means
 * "keep this round and move on". Two stops meaning different things on one
 * screen is how a child learns to distrust both.
 *
 * Pausing releases anything still ringing and forgets which steps have already
 * sounded, because the clock's step numbers begin again from zero on the next
 * start — the same staleness that once silenced the metronome for half a
 * minute. The drone goes with it: silence should mean silence.
 */
/**
 * Punch out of recording, and let the loop keep going.
 *
 * The session has modelled this state since the loop pedal was built — `halt()`
 * puts it back to `tempo`, which is "playing, not recording, everything kept".
 * The only thing that used to stop the music was main.js calling clock.stop()
 * alongside it, and that call is deliberately absent here. That is the whole
 * difference between this and stopping (dec:idea-pause-stops-recording-not-music).
 *
 * Held notes are released because her thumb is no longer recording them, and the
 * hold map is cleared so nothing gets extended into a round she has left. What
 * is NOT cleared is `alreadySounded`: the clock keeps running, so the guard
 * against re-sounding a note she just played by hand is still live and still
 * needed.
 */
function listenOnly() {
  for (const h of held.values()) h.release();
  held.clear();
  holding.clear();
  session.halt();
  refresh();
}

function pauseAll() {
  clock.stop();
  for (const h of held.values()) h.release();
  held.clear();
  holding.clear();
  alreadySounded.clear();
  voices.setDroneLevel(0, 0.4);
  session.halt();
  refresh();
}

function resumeAll() {
  if (!session.tempoIsSet) return;
  clock.start();
  voices.startDrone();
  voices.setDroneLevel(0.18, 1.2);
  refresh();
}

el('playpause').addEventListener('click', (e) => {
  e.stopPropagation();
  const action = transportAction();
  if (!action) return;
  if (action.kind === 'listen') {
    listenOnly();
    flash('just listening — play along, nothing is being kept');
  } else if (action.kind === 'stop') {
    pauseAll();
    flash('stopped — everything you made is still here');
  } else {
    resumeAll();
    flash('off we go');
  }
});

el('grid').addEventListener('click', (e) => {
  e.stopPropagation();
  const round = session.round;
  if (!round) return;
  const fine = track.gridFor(round.id) !== FINE_GRID;
  track.setGrid(round.id, fine ? FINE_GRID : GRID);
  flash(fine
    ? `${round.label.toLowerCase()}: 1/16 notes — twice as fine, half as forgiving`
    : `${round.label.toLowerCase()}: back to 1/8 notes`);
  refresh();
});

/**
 * Send her track on. Reachable from the strip at any time, and from the big
 * button once the whole track is finished — one act, two doors.
 */
async function sendTrack() {
  if (track.isEmpty()) { flash('play something first'); return; }
  // Addressed to the palette's own page, not to whatever page made it.
  const how = await share(track, { base: homeFor(palette) });
  if (how === 'shared') flash('sent');
  else if (how === 'copied') flash('link copied — paste it to someone');
  else flash('could not share, sorry');
}

el('share').addEventListener('click', (e) => {
  e.stopPropagation();
  sendTrack();
});

/**
 * The quiet one (dec:idea-midi-out). Her music leaves the game and enters
 * software that takes it seriously — which is the strongest available version of
 * what this whole thing is for, and is almost certainly pressed by a parent.
 */
el('midi').addEventListener('click', (e) => {
  e.stopPropagation();
  saveMidi(track).then((how) => {
    if (how === 'shared' || how === 'saved') flash('midi file saved');
    else flash('could not save the midi, sorry');
  });
});

// ---------------------------------------------------------------------------
// What the session says, and how the page shows it
// ---------------------------------------------------------------------------

session.onNudge((n) => {
  switch (n.kind) {
    case 'tempo-set':
      clock.setTempo(track.bpm);
      flash(`${track.bpm} — that's your speed. have a play; nothing is kept yet`);
      break;
    case 'counting-in':
      voices.setClickLevel(0.9, 0.15);
      break;
    case 'recording':
      flash(`play the ${session.round.full.toLowerCase()}`);
      break;
    case 'free':
      // The state she was asking for a pause button to reach. It has always
      // been the default between rounds; nothing ever said so.
      flash('have a play — nothing is kept until you press start');
      break;
    case 'round-kept':
      // The click retires here: from now on her own beat is the click.
      if (ROUNDS[n.index]?.click) voices.setClickLevel(0, 1.2);
      flash('kept — it keeps playing underneath');
      break;
    case 'next-round':
      flash(`now the ${session.round.full.toLowerCase()} — have a play first, nothing is kept`);
      break;
    case 'round-reset': flash('cleared — go again'); break;
    case 'tempo-cleared': flash('tap the keys four times for a new speed'); break;
    case 'round-changed': flash(`back on the ${session.round.full.toLowerCase()} — nothing is kept until you press start`); break;
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

/**
 * A quarter-second of real silence — two thousand zero samples, not an empty
 * file. The clip shipped before this had a data chunk of length ZERO, so there
 * was nothing for iOS to play and the trick it exists for never fired once.
 *
 * Played at full volume, deliberately. The content is silent; MUTING it would
 * defeat the point, because what shifts the audio session is media actually
 * playing, and a muted element may not count as playing at all.
 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRsQPAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** What actually happened when we tried to start the sound, for the panel. */
const audioReport = { sessionAsked, sessionType: null, silentClip: 'not tried', ctxState: null };

async function startAudio() {
  // Layer 1 again, inside the gesture. Asked at load too; the platform is
  // inconsistent about which moment it honours, so do both.
  requestPlaybackSession();
  try { audioReport.sessionType = navigator.audioSession?.type ?? 'unsupported'; } catch { /* ignore */ }

  // Layer 2: real silent media, at full volume, inside the gesture.
  //
  // DELIBERATELY NOT AWAITED. It is a belt-and-braces trick for one platform,
  // and its promise can sit pending forever where there is no audio device at
  // all — which used to hold up everything after it, including starting a track
  // somebody sent. Best-effort work should not be able to block the gate.
  try {
    const a = new Audio(SILENT_WAV);
    a.loop = true;
    a.setAttribute('playsinline', '');
    window.__mjKeepAlive = a; // hold a reference or it is collected and stops
    a.play().then(
      () => { audioReport.silentClip = 'playing'; },
      (err) => { audioReport.silentClip = `refused (${err?.name ?? 'unknown'})`; },
    );
  } catch (err) {
    audioReport.silentClip = `refused (${err?.name ?? 'unknown'})`;
  }

  // Resuming CAN hang where the platform never grants audio, so it does not get
  // to hold up the music either — the clock reads the context's own clock and
  // the scheduler already carries a guard for waking to find it far ahead.
  ctx.resume().then(() => { audioReport.ctxState = ctx.state; });
  voices.startDrone();
  refresh();
}

/**
 * A TRACK SOMEBODY SENT HER JUST PLAYS.
 *
 * The gate says "tap to hear it", so that tap is the whole transaction — she
 * should not then have to find START to make good on a promise the screen
 * already made. Her own empty track still waits for START, because there is
 * nothing to hear yet.
 *
 * TWO THINGS HAVE TO HAVE HAPPENED and they can finish in either order: the
 * gate has to have been tapped, because that gesture is the only moment audio
 * may begin (dec:beat-the-silent-switch), and the voices have to be loaded,
 * because starting the clock into an empty voice table means the music arrives
 * halfway through the first loop. So this is called from both and does nothing
 * until both are true.
 */
let gateDismissed = false;
function maybeAutoPlay() {
  if (!incoming || !gateDismissed || !voices.ready || clock.running) return;
  resumeAll();
  flash('this is what they made you — press a key to play along');
}

el('gate').addEventListener('click', async () => {
  el('gate').classList.add('gone');
  await startAudio();

  gateDismissed = true;
  maybeAutoPlay();
}, { once: true });

// ---------------------------------------------------------------------------
// "No sound?" — reachable at any time, because the gate's hint disappears at
// exactly the moment she discovers she needs it.
// ---------------------------------------------------------------------------

/** A short, honest account of what the browser told us, for a grown-up to read. */
function diagnostics() {
  const bits = [
    `audio: ${ctx.state}`,
    `session: ${audioReport.sessionType ?? (audioReport.sessionAsked ? 'asked' : 'unsupported')}`,
    `silent clip: ${audioReport.silentClip}`,
    `sounds loaded: ${voices.ready ? 'yes' : 'no'}`,
    `output rate: ${ctx.sampleRate}Hz`,
  ];
  return bits.join(' · ');
}

/**
 * Show and hide the panel with an INLINE STYLE, not with the `hidden`
 * attribute and not by a class alone.
 *
 * THE CAUSE THIS IS ANSWERING. Visibility was expressed twice by two mechanisms
 * that could not see each other: JavaScript set the `hidden` attribute, and the
 * stylesheet independently declared `display: grid` on the same element. An
 * author display rule beats the user agent's `[hidden] { display: none }`, so
 * the hide silently lost — measured, not assumed: hidden=true, computed display
 * still grid.
 *
 * It was worse than a stuck close button. Because `hidden` never worked, the
 * panel was on screen from page load. A nine-year-old did not open a help
 * screen and get trapped; she was handed one and could not get rid of it.
 *
 * An inline style is used rather than a class because the failure survives a
 * STALE STYLESHEET. The html, css and js are cached independently for ten
 * minutes each, so a phone can run any mixture of builds — and it did: new
 * markup with the old stylesheet is exactly the combination that was broken.
 * Inline beats any stylesheet, fresh or stale, so this cannot be undone by a
 * file that has not arrived yet.
 */
function showPanel(show) {
  const p = el('silentpanel');
  p.style.display = show ? 'block' : 'none';
  p.classList.toggle('open', show);
  p.hidden = !show;
}

function openPanel(e) {
  e?.stopPropagation();
  el('diag').textContent = diagnostics();
  showPanel(true);
}
el('help').addEventListener('click', openPanel);

function closePanel(e) {
  e?.preventDefault();
  e?.stopPropagation();
  showPanel(false);
}

/**
 * TAP ANYWHERE TO LEAVE, except the one button that does something else.
 *
 * She got stuck on this screen twice. The first time the exit was off the
 * bottom of a landscape phone; the second time the exit was visible and a tap
 * on it did nothing, for a reason I could not reproduce from here. So the exit
 * stopped being a target: the whole screen is now the way out, listening on
 * pointerup AND click because whichever of those was failing, both failing is
 * far less likely than one.
 *
 * A help screen a child opened by accident must be impossible to be trapped in.
 * That is worth more than knowing precisely which event was being swallowed.
 */
function maybeClose(e) {
  if (e.target.closest('#retry')) return; // the one thing that is not "leave"
  closePanel(e);
}
for (const type of ['pointerup', 'click']) {
  el('silentpanel').addEventListener(type, maybeClose);
}

// And the keyboard reflex, for testing on a laptop.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel(e);
});

el('retry').addEventListener('click', async (e) => {
  e.stopPropagation();
  // Re-run the whole unlock from inside a fresh gesture. iOS will sometimes
  // grant on a second attempt what it refused on the first, particularly if
  // she has changed a setting in between.
  await startAudio();
  // A sound she can immediately check against, rather than "it should work now".
  voices.play('kick', {});
  setTimeout(() => voices.play('snare', {}), 220);
  el('diag').textContent = diagnostics();
  flash('did you hear two drums?');
});

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

// Whatever stylesheet reached this device, the panel starts shut.
showPanel(false);

checkOrientation();
stage.mount(track);
refresh();

// Say which game this is — but only when the PAGE does not already know.
// /jugbeats/ethereal/ ships with its own title and gate heading, which is what
// a scraper and the tab both see before any of this runs; overwriting them here
// would make the generated page's own metadata pointless.
if (!document.documentElement.dataset.palette) {
  document.title = `${palette.name} — ${palette.tagline}`;
}
if (!incoming && !document.documentElement.dataset.palette) {
  el('gate-title').textContent = palette.name;
}
else el('gate-title').textContent = palette.id === 0
  ? 'someone made you a beat'
  : 'someone made you something';

voices.load().then(() => {
  // The palette's own voices, not a hardcoded pair.
  //
  // KNOWN LIMIT: the link's shaping slots are still named `bass` and `lead`
  // (SHAPED in js/link.js), so only a palette that uses those names round-trips
  // its shaping numbers. The calm palette's controls work in the session and are
  // dropped by the link. Fixing it means shaping travelling by INDEX rather than
  // by name, which is another format version and is not worth one on its own.
  for (const inst of Object.keys(palette.pitched)) {
    if (track.shaping[inst] && Object.keys(track.shaping[inst]).length) {
      voices.setShaping(inst, track.shaping[inst]);
    }
  }
  el('gate-label').textContent = incoming ? 'tap to hear it' : 'tap to start';
  el('gate').classList.add('loaded');
  maybeAutoPlay();
  // Say what the first move is. The transport reads "TAP 0/4", which is only
  // obvious once you already know what it means.
  if (!incoming) setTimeout(() => flash('tap the two keys four times to set your speed'), 700);
}).catch((err) => {
  el('gate-label').textContent = 'could not load the sounds';
  console.error(err);
});
