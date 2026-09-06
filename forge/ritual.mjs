// Render a Ritual loop to a WAV, so a human can hear the palette.
//
// Run:  node forge/ritual.mjs [out.wav]
//
// The sibling of forge/bachata.mjs, forge/haunted.mjs and forge/calm.mjs, for
// the same reason all of them exist: the owner's binding condition is that the
// sounds must not sound cheap, and the only way to check that is to listen
// (dec:two-speed-synthesis). It is the missing half of ver:ritual-sounds-right,
// whose mechanical half — finite, audible, fills its buffer — already passes in
// test/voices.mjs and cannot tell you whether any of it sounds like the idiom.
//
// ⭐ THIS DEMO DOES ONE THING THE GAME CANNOT, AND THAT IS THE POINT OF IT.
// req:sleep-token-palette says the identity of this idiom is CONTRAST — the same
// few chords hushed and then crushing — and the engine has no sections, so the
// palette can be quiet and can be heavy and cannot yet move between them. A
// linear render has no such limit. So this arranges the drop the palette is
// built for and cannot yet perform: four bars of piano alone, four that build,
// four that land. What you are hearing in bar nine is what
// dec:a-segment-is-a-whole-track would buy once it is built.
//
// Governed by dec:what-the-sleep-token-palette-is-called.

import { writeFileSync } from 'node:fs';
import { encodeWav } from './wav.mjs';
import { MINOR_PENTATONIC as SCALE, ROOT_HZ } from '../js/dsp.js';
import { reverb } from '../js/ethereal.js';
import {
  renderFeltPiano, renderChoir, renderRiff,
  renderRitualKick, renderRitualSnare, renderRitualGhost, renderRitualHat,
  RITUAL, RITUAL_LIMBS,
} from '../js/ritual.js';

const SR = 44100;
const BPM = RITUAL.bpm;                 // 72
const BARS = 12;
const STEPS = 16;
const stepSec = 60 / BPM / 4;
const NEUTRAL = { deeper: 0.5, punchier: 0.5, dirtier: 0.5, longer: 0.5 };

// Dry first; the room goes on at the end over everything at once. In this
// palette that matters more than in any other — a hall is what makes a quiet
// piano and a wall of guitar sound like they are in the same building.
const LEN = Math.ceil(SR * stepSec * STEPS * BARS + SR * 6);
// TWO BUSES, so the kick can duck the music without ducking itself.
const drums = new Float32Array(LEN);
const music = new Float32Array(LEN);

function into(bus, buf, atSec, gain = 1) {
  const start = Math.floor(atSec * SR);
  for (let i = 0; i < buf.length; i++) {
    const j = start + i;
    if (j >= 0 && j < bus.length) bus[j] += buf[i] * gain;
  }
}
const place = (buf, atSec, gain = 1) => into(music, buf, atSec, gain);

const timeOf = (bar, s) => (bar * STEPS + s) * stepSec;   // straight, no swing

function hz(degree, oct = 0) {
  const n = SCALE.length;
  const idx = ((degree % n) + n) % n;
  return ROOT_HZ * Math.pow(2, Math.floor(degree / n) + oct + SCALE[idx] / 12);
}

// ---------------------------------------------------------------------------
// The drums, written as one list so they can be CHECKED before they are heard
// ---------------------------------------------------------------------------

/**
 * Every drum hit in the piece, as [bar, step, voice, gain].
 *
 * WRITTEN LINEARLY ON PURPOSE. The corpus measurement (chg:corpus-numbers-
 * measured) found 91% of the onsets in the Summoning drum solo are a SINGLE
 * note, and 69% in the other two drum files. That is what gospel phrasing is,
 * and it is the thing a programmed part gets wrong by stacking everything on
 * the downbeat.
 *
 * The ghosts are the point of the pattern rather than decoration: quiet strokes
 * on the odd sixteenths, between the accents, which is what makes the groove
 * breathe (req:drums-in-the-gospel-idiom).
 */
const DRUMS = [];
for (let bar = 4; bar < BARS; bar++) {
  const heavy = bar >= 8;

  // Half-time: the backbeat lands once a bar, not twice. That slowness under
  // fast hats is most of what this idiom sounds like.
  DRUMS.push([bar, 0, 'kick', 0.95]);
  DRUMS.push([bar, 8, 'snare', 0.85]);
  if (heavy) DRUMS.push([bar, 6, 'kick', 0.8], [bar, 10, 'kick', 0.72]);
  else DRUMS.push([bar, 10, 'kick', 0.6]);

  // Ghosts, on the odd sixteenths, never on the beat and never with the snare.
  for (const s of heavy ? [3, 5, 11, 13, 15] : [5, 13]) {
    DRUMS.push([bar, s, 'ghost', 0.55]);
  }

  // Hats: eighths while it builds, straight sixteenths once it lands, which is
  // the double-time-over-half-time the requirement names.
  for (let s = 0; s < STEPS; s += heavy ? 1 : 2) {
    DRUMS.push([bar, s, 'hat', s % 4 === 0 ? 0.42 : 0.26]);
  }
}

/**
 * 🛑 CHECK THE ARRANGEMENT BEFORE RENDERING IT — con:playable-by-four-limbs.
 *
 * A small standing version of ver:drums-are-playable, run over the notes
 * actually written rather than over the lane table. Two feet, two hands, and
 * the kit's own physical truths: a foot plays the kick, hands play everything
 * else, and the snare cannot be struck loudly and softly at the same instant.
 *
 * It throws rather than warns. A demo that quietly contains a pattern no person
 * could play would be arguing against the palette's own constraint while
 * claiming to demonstrate it.
 */
function assertPlayable(events) {
  const byStep = new Map();
  for (const [bar, step, voice] of events) {
    const k = `${bar}:${step}`;
    if (!byStep.has(k)) byStep.set(k, new Set());
    byStep.get(k).add(voice);
  }
  for (const [where, voices] of byStep) {
    const v = [...voices];
    const feet = v.filter((n) => RITUAL_LIMBS[n] === 'foot');
    const hands = v.filter((n) => RITUAL_LIMBS[n] !== 'foot');
    if (voices.has('snare') && voices.has('ghost')) {
      throw new Error(`bar:step ${where} strikes the snare loudly and softly at once`);
    }
    if (feet.length > 2 || hands.length > 2) {
      throw new Error(`bar:step ${where} needs ${feet.length} feet and ${hands.length} hands: ${v.join('+')}`);
    }
  }
  const most = Math.max(...[...byStep.values()].map((s) => s.size));
  const solo = [...byStep.values()].filter((s) => s.size === 1).length;
  return { onsets: byStep.size, most, linear: Math.round((100 * solo) / byStep.size) };
}

const shape = assertPlayable(DRUMS);

const DRUM_VOICES = {
  kick: renderRitualKick, snare: renderRitualSnare,
  ghost: renderRitualGhost, hat: renderRitualHat,
};
// Each drum is rendered ONCE and placed many times, which is what the game does
// too — a struck sound has no pitch to vary, so there is nothing to re-render.
const baked = Object.fromEntries(
  Object.entries(DRUM_VOICES).map(([n, f]) => [n, f(SR)]),
);
for (const [bar, step, voice, gain] of DRUMS) {
  into(drums, baked[voice], timeOf(bar, step), gain);
}

// ---------------------------------------------------------------------------
// The quiet half: piano from the first beat, choir arriving under it
// ---------------------------------------------------------------------------

// Root, ♭3, 5th, octave — the lanes round one actually offers. Sparse, because
// a felt piano in a five-second hall turns to porridge if it is busy.
const PIANO = [
  [0, 0, 0, 2.6], [0, 6, 3, 2.0], [0, 12, 1, 2.2],
  [1, 0, 5, 2.8], [1, 8, 3, 2.0],
  [2, 0, 0, 2.6], [2, 6, 1, 1.8], [2, 10, 3, 2.2],
  [3, 0, 5, 3.2], [3, 8, 4, 2.4],
  [4, 0, 0, 2.4], [4, 8, 3, 2.0],
  [5, 0, 1, 2.4], [5, 8, 5, 2.4],
  [6, 0, 0, 2.4], [6, 10, 3, 2.0],
  [7, 0, 5, 3.0], [7, 8, 4, 2.2],
  // Under the drop the piano keeps going and is mostly buried, which is exactly
  // what happens on the records — you feel it rather than hear it.
  [8, 0, 0, 2.4], [9, 0, 1, 2.4], [10, 0, 3, 2.4], [11, 0, 0, 3.4],
];
for (const [bar, step, degree, secs] of PIANO) {
  place(renderFeltPiano(SR, hz(degree, 2), NEUTRAL, { seconds: secs }),
    timeOf(bar, step), bar >= 8 ? 0.30 : 0.52);
}

// The choir enters at bar two — a line that was there from the first beat has
// nothing to arrive from. It holds long, which is the whole reason a voice
// round sustains.
const CHOIR = [
  [2, 0, 0, 5.0, 0.30], [4, 0, 3, 5.0, 0.34], [6, 0, 1, 5.0, 0.36],
  [8, 0, 0, 6.0, 0.40], [10, 0, 4, 6.0, 0.40],
];
for (const [bar, step, degree, secs, g] of CHOIR) {
  place(renderChoir(SR, hz(degree, 2), NEUTRAL, { seconds: secs }), timeOf(bar, step), g);
}

// ---------------------------------------------------------------------------
// The drop: the riff, from bar eight, and nothing else new
// ---------------------------------------------------------------------------

// Low, short and repetitive. A riff is a rhythm that happens to have pitches;
// the palm mute is what makes it articulate instead of a smear, and it is why
// these notes are a third of a second long.
const RIFF = [
  [8, 0, 0], [8, 3, 0], [8, 6, 0], [8, 8, 2], [8, 10, 0], [8, 14, 3],
  [9, 0, 0], [9, 3, 0], [9, 6, 0], [9, 8, 4], [9, 12, 3], [9, 14, 2],
  [10, 0, 0], [10, 3, 0], [10, 6, 0], [10, 8, 2], [10, 10, 0], [10, 14, 3],
  [11, 0, 0], [11, 4, 3], [11, 8, 2], [11, 12, 0],
];
for (const [bar, step, degree] of RIFF) {
  // OCTAVE -1, matching the palette's own `riff` entry. The register is most of
  // what makes this idiom sound like itself, so a demo an octave up would be
  // demonstrating a different instrument.
  place(renderRiff(SR, hz(degree, -1), NEUTRAL, { seconds: 0.34 }), timeOf(bar, step), 0.5);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sidechain: the kick ducks everything else
// ---------------------------------------------------------------------------
//
// Every kick pulls the music down by about 2.5dB for a fraction of a second and
// lets it back in. It costs no frequencies and it is most of why a programmed
// kick reads as a physical event rather than as a click on top of a mix — the
// ear hears the room getting out of the way. Keyed to the kick alone rather
// than the whole kit, which is what makes it feel like weight rather than pumping.
const DUCK_DB = 2.5;
const duckFloor = Math.pow(10, -DUCK_DB / 20);
const release = Math.exp(-1 / (SR * 0.11));
const gain = new Float32Array(LEN).fill(1);
{
  let g = 1;
  const kicks = new Set(
    DRUMS.filter(([, , v]) => v === 'kick').map(([b, s]) => Math.floor(timeOf(b, s) * SR)),
  );
  for (let i = 0; i < LEN; i++) {
    if (kicks.has(i)) g = duckFloor;
    g = 1 - (1 - g) * release;
    gain[i] = g;
  }
}

const dry = new Float32Array(LEN);
for (let i = 0; i < LEN; i++) dry[i] = drums[i] + music[i] * gain[i];

const [L, R] = reverb(dry, SR, {
  mix: RITUAL.room.mix, size: RITUAL.room.size, damp: RITUAL.room.damp,
  spread: RITUAL.room.spread, tailSeconds: 5.0,
});

const out = new Float32Array(L.length * 2);
let peak = 0;
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak > 0 ? 0.82 / peak : 1;
for (let i = 0; i < L.length; i++) { out[i * 2] = L[i] * g; out[i * 2 + 1] = R[i] * g; }

const path = process.argv[2] || 'ritual.wav';
writeFileSync(path, Buffer.from(encodeWav(out, SR, 2)));
console.log(`wrote ${path} — ${(L.length / SR).toFixed(1)}s, ${BPM}bpm, straight, ${BARS} bars`);
console.log(`  bars 1-4 piano alone, 5-8 build, 9-12 the drop`);
console.log(`  drums: ${shape.onsets} onsets, ${shape.linear}% of them a single note, never more than ${shape.most} at once`);
console.log(`  riff at octave -1; the kick ducks the music by ${DUCK_DB}dB`);
