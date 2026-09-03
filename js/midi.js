// The MIDI exporter (comp:export) — her track, in a format other software takes
// seriously.
//
// Satisfies req:her-track-as-a-midi-file. Governed by dec:idea-midi-out, which
// is also the reason this is a quiet button and not a loud one: a nine-year-old
// does not open a DAW unprompted, so this is for the grown-up who wants to take
// her beat, produce it properly, and hand it back. It must never displace
// anything she touches.
//
// DELIBERATELY NOT THE LINK CODEC, though they look like neighbours. The link is
// the game's own loop — a track goes out and comes back in, still editable, and
// iface:track-format is a promise kept forever. This is a ONE-WAY bridge to
// somebody else's software: nothing here ever has to be read back, so there is
// no version marker, no decoder, and no obligation to anyone.
//
// A MIDI file is a small, uncompressed, well-documented binary format, and her
// track is already what it wants: quantised notes on a grid, at a stated tempo,
// grouped by instrument. This is closer to a re-serialisation than a conversion.

import { ROUNDS, STEPS_PER_BAR, roundById, laneCount } from './track.js';
import { SCALE_STEPS } from './dsp.js';
import { SWING } from './clock.js';

/**
 * Ticks per quarter note. 96 divides by 4 (into sixteenths) and by 3 (into
 * triplets), and the swing offset below lands on a whole number of ticks, so
 * nothing in this file ever has to round her groove.
 */
const PPQ = 96;

/** One of her steps is a sixteenth, so a quarter is four of them. */
const TICKS_PER_STEP = PPQ / 4;

/**
 * How late the "and" of the beat sits, in ticks.
 *
 * THE GROOVE TRAVELS WITH THE FILE. Straightening it on the way out would be
 * easier to read in a DAW's piano roll and would be the wrong file: the shuffled
 * lean is the phonk feel she actually played, not a rendering artefact, and a
 * producer can always re-quantise. Losing it is not recoverable.
 */
const SWING_TICKS = Math.round(SWING * TICKS_PER_STEP);

/** Where the lead sits relative to the 808 — two octaves up, matching js/voices.js. */
const LEAD_OCTAVES = 2;

/**
 * Where each round lands in General MIDI.
 *
 * The drums map exactly onto the GM percussion channel — kick 36, snare 38,
 * closed hat 42, cowbell 56 — so her beat opens anywhere on earth as a drum part
 * rather than as four mystery notes. Channel 9 is percussion by convention in
 * every piece of software that reads this format.
 *
 * `note` on a drum lane is the GM percussion key. `program` on a pitched round
 * is a GM patch chosen to sound like what she heard: a synth bass for the 808,
 * a sawtooth lead for the melody, which is what js/dsp.js actually renders.
 */
const CHANNELS = {
  r1: { channel: 9, notes: [36, 38] },                    // kick, snare
  r2: { channel: 9, notes: [42, 56] },                    // closed hat, cowbell
  r3: { channel: 0, program: 38, octaves: 0 },            // Synth Bass 1
  r4: { channel: 1, program: 81, octaves: LEAD_OCTAVES }, // Lead 2 (sawtooth)
};

/**
 * The root of the scale, as a MIDI note number.
 *
 * dsp.js states the root as a frequency — 65.41 Hz, which is C2 — because the
 * synth needs Hz and nothing outside that file ever handles one. MIDI needs a
 * note number for the same pitch, and C2 is 36. The two must agree, so the
 * relationship is written down rather than left as two independent constants
 * that happen to match today.
 */
const ROOT_MIDI = 36; // C2 === ROOT_HZ (65.41)

const VELOCITY = 100;

/** A drum's note-off. GM percussion ignores it, but a well-formed file has one. */
const DRUM_TICKS = TICKS_PER_STEP / 2;

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

/**
 * A scale degree as a MIDI note number — the integer twin of dsp.js's
 * degreeToHz, and it must stay one.
 *
 * Degrees index the minor pentatonic and run off the top of the scale into the
 * next octave rather than stopping, exactly as degreeToHz does, so the four
 * lanes of the melody (root, flat third, fifth, octave) come out as the four
 * pitches she heard.
 */
export function degreeToMidi(degree, octaves = 0) {
  const n = SCALE_STEPS.length;
  const idx = ((degree % n) + n) % n;
  const oct = Math.floor(degree / n) + octaves;
  return ROOT_MIDI + 12 * oct + SCALE_STEPS[idx];
}

// ---------------------------------------------------------------------------
// The byte level
// ---------------------------------------------------------------------------

/** MIDI's variable-length quantity: seven bits per byte, high bit means more. */
function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

const str = (s) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

const u32 = (n) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];

/** Wrap a run of events as an MTrk, with the end-of-track meta every file needs. */
function chunk(name, bytes) {
  return [...str(name), ...u32(bytes.length), ...bytes];
}

function trackChunk(events) {
  return chunk('MTrk', [...events, ...vlq(0), 0xff, 0x2f, 0x00]);
}

/** FF 03 — the track name a DAW shows in its channel strip. */
function trackName(name) {
  const s = str(name);
  return [...vlq(0), 0xff, 0x03, ...vlq(s.length), ...s];
}

// ---------------------------------------------------------------------------
// Laying her track out in time
// ---------------------------------------------------------------------------

/**
 * When an absolute step sounds, in ticks — the same question clock.timeOf answers
 * in seconds, and it must answer it the same way.
 */
function tickOf(step) {
  return step * TICKS_PER_STEP + (((step % 4) + 4) % 4 === 2 ? SWING_TICKS : 0);
}

/**
 * Every note of one round, over `totalSteps` of absolute time.
 *
 * The round wraps at ITS OWN length, which is the whole of polymeter
 * (dec:layers-of-different-lengths): a three-bar bass under a four-bar drum part
 * plays a different alignment each time round. Exporting the composite length
 * means the file contains the pattern rather than a slice of it — open it in a
 * DAW and loop the whole thing and it repeats exactly, which is what she hears.
 */
function notesOf(track, round, totalSteps) {
  const spec = CHANNELS[round.id];
  const loop = track.loopStepsFor(round.id);
  const grid = track.gridFor(round.id);
  const out = [];

  for (let step = 0; step < totalSteps; step += grid) {
    const slot = ((step % loop) + loop) % loop;
    for (let lane = 0; lane < laneCount(round.id); lane++) {
      const length = track.runLengthAt(round.id, lane, slot);
      if (length === 0) continue;

      const note = spec.notes
        ? spec.notes[lane]
        : degreeToMidi(round.lanes[lane].degree ?? 0, spec.octaves);

      // A drum is a struck object and its length is its own; a pitched note is
      // as long as she held it (dec:drums-do-not-sustain).
      const on = tickOf(step);
      const off = round.sustains
        ? Math.min(tickOf(step + length), totalSteps * TICKS_PER_STEP)
        : on + DRUM_TICKS;

      out.push({ tick: on, on: true, channel: spec.channel, note });
      out.push({ tick: off, on: false, channel: spec.channel, note });
    }
  }
  return out;
}

/**
 * One round as an MTrk — named for the round, so a producer opening the file
 * sees "Kick & Snare" and "The 808" rather than four numbered channels.
 */
function roundTrack(track, round, totalSteps) {
  const spec = CHANNELS[round.id];
  const notes = notesOf(track, round, totalSteps);
  if (notes.length === 0) return null;

  // Note-offs before note-ons at the same tick, so a note re-struck exactly
  // where the previous one ends is not cut short by its own predecessor.
  notes.sort((a, b) => a.tick - b.tick || (a.on === b.on ? 0 : a.on ? 1 : -1));

  const events = [...trackName(round.full)];
  if (spec.program !== undefined) {
    events.push(...vlq(0), 0xc0 | spec.channel, spec.program);
  }

  let at = 0;
  for (const n of notes) {
    events.push(
      ...vlq(Math.max(0, Math.round(n.tick - at))),
      (n.on ? 0x90 : 0x80) | n.channel,
      n.note & 0x7f,
      n.on ? VELOCITY : 0,
    );
    at = n.tick;
  }
  return trackChunk(events);
}

/** The tempo map — her tempo, and the 4/4 the whole game is built on. */
function tempoTrack(bpm) {
  const usPerQuarter = Math.round(60000000 / bpm);
  return trackChunk([
    ...trackName('JugBeats'),
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff,
    ...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8,
  ]);
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * Her finished track as a standard MIDI file.
 *
 * Format 1 — one tempo map plus a track per round — because that is what gives a
 * DAW named, separately editable parts. Only rounds she ACCEPTED are written,
 * which is the same set that plays back and the same set the link carries; a
 * round she is still in the middle of is not part of the track yet.
 *
 * Mutes are ignored on purpose. Muting is a performance choice made while
 * playing and is not part of the composition (dec:arrangement-breathes), so it
 * no more belongs in the file than it belongs in the link.
 */
export function encodeMidi(track) {
  const rounds = ROUNDS.filter((r) => track.accepted.has(r.id) && track.count(r.id) > 0);
  const totalSteps = track.compositeBars * STEPS_PER_BAR;

  const tracks = [tempoTrack(track.bpm)];
  for (const round of rounds) {
    const t = roundTrack(track, round, totalSteps);
    if (t) tracks.push(t);
  }

  // MThd: format 1 (one tempo map plus a track each), how many tracks, and the
  // tick resolution everything above is measured in.
  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  return Uint8Array.from([...header, ...tracks.flat()]);
}

/** Something recognisable in a Downloads folder six months from now. */
export function filenameFor(track) {
  return `jugbeats-${track.bpm}bpm.mid`;
}

/**
 * Hand the file to the device.
 *
 * The share sheet FIRST, and not for tidiness. dec:audio-waits-for-a-real-app
 * records why a generated file is awkward here: on Safari on iOS a download link
 * tends to open a viewer rather than land anywhere findable. Sharing a File goes
 * through the same sheet as the link and offers "Save to Files", which is the
 * one route that actually works on the phone this game is played on. The
 * download link is the fallback for desktop, where it is the better answer.
 *
 * Must be called from inside a user gesture or iOS refuses the sheet.
 */
export async function saveMidi(track) {
  const bytes = encodeMidi(track);
  const name = filenameFor(track);
  const blob = new Blob([bytes], { type: 'audio/midi' });

  try {
    const file = new File([blob], name, { type: 'audio/midi' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My beat' });
      return 'shared';
    }
  } catch (err) {
    // She changed her mind. Not a failure, and not something to fall through to
    // a silent download for — that would save a file she just cancelled.
    if (err && err.name === 'AbortError') return 'shared';
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a later turn of the event loop: revoking synchronously races
    // the navigation the click just started, and loses on some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export const _internal = { vlq, tickOf, notesOf, PPQ, TICKS_PER_STEP, SWING_TICKS, CHANNELS, ROOT_MIDI };
