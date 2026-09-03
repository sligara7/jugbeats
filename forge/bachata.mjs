// Render a short bachata loop to a WAV, so a human can hear the palette.
//
// Run:  node forge/bachata.mjs [out.wav]
//
// The sibling of forge/demo.mjs, which does the same job for the phonk kit. Same
// reasoning: the owner's binding condition is that the sounds must not sound
// cheap, and the only way to check that is to listen (dec:two-speed-synthesis).
//
// Governed by dec:idea-bachata-palette.

import { writeFileSync } from 'node:fs';
import { encodeWav } from './wav.mjs';
import { MINOR_PENTATONIC as SCALE, ROOT_HZ } from '../js/dsp.js';
import { BACHATA as PALETTE } from '../js/palettes.js';
import { reverb } from '../js/ethereal.js';
import { renderString, renderBongo, renderGuira, BACHATA } from '../js/bachata.js';

const SR = 44100;
const BPM = BACHATA.bpm;
const BARS = 8;
const STEPS = 16;                       // sixteenths per bar, as the game counts
const stepSec = 60 / BPM / 4;
const NEUTRAL = { deeper: 0.5, punchier: 0.5, dirtier: 0.5, longer: 0.5 };

// Dry mix first; the room goes on at the end, over everything at once, because
// that is what makes separate voices sound like one performance in one place
// rather than four sounds with reverb on each.
// Room for the arrangement plus the longest voice tail. Was eight seconds, which
// left nine seconds of silence on the end of the file.
const dry = new Float32Array(Math.ceil(SR * stepSec * STEPS * BARS + SR * 4));

function place(buf, atSec, gain = 1) {
  const start = Math.floor(atSec * SR);
  for (let i = 0; i < buf.length; i++) {
    const j = start + i;
    if (j >= 0 && j < dry.length) dry[j] += buf[i] * gain;
  }
}

// STRAIGHT, not swung — the one rhythmic difference from the phonk demo.
const timeOf = (bar, s) => (bar * STEPS + s) * stepSec;

/** Scale degree to Hz, the same mapping the game uses. `oct` in octaves. */
function hz(degree, oct = 0) {
  const n = SCALE.length;
  const idx = ((degree % n) + n) % n;
  return ROOT_HZ * Math.pow(2, Math.floor(degree / n) + oct + SCALE[idx] / 12);
}

// ---------------------------------------------------------------------------
// The arrangement. Deliberately almost nothing: a held open fifth underneath, a
// slow bell figure over it, a breath line arriving late, and a mallet pulse so
// quiet it is felt rather than heard.
//
// Sparse ON PURPOSE. The failure mode of a pad palette is porridge — everything
// sustaining at once until nothing is audible. Long notes need room.
// ---------------------------------------------------------------------------

// THE HARMONY MOVES, and only the bass says so.
//
// i - ♭VI - ♭VII - i, which is what an enormous amount of bachata is built on.
// The bass transposes with it and states the change; the requinto stays in one
// pentatonic and floats over the top, the way a blues player uses one scale over
// a whole tune. Transposing the lead too would give each chord its own parallel
// pentatonic and wander outside the key.
const CHORDS = [0, 1, 2, 0];
const chordAt = (bar) => PALETTE.progression[CHORDS[bar % CHORDS.length]];
const shiftAt = (bar) => Math.pow(2, chordAt(bar) / 12);

// THE GÜIRA IS THE ENGINE. It runs all the way through on the eighths, with a
// long drag on the back half of every beat — that alternation of flick and drag
// is the sound that keeps bachata moving, and without it the guitars just hang.
for (let bar = 0; bar < BARS; bar++) {
  for (let s = 0; s < STEPS; s += 2) {
    place(renderGuira(SR, NEUTRAL, { long: s % 4 === 2 }), timeOf(bar, s), s % 4 === 2 ? 0.5 : 0.34);
  }
}

// The bongó marks, and answers itself. The slap on the fourth beat is the accent
// the whole bar leans towards.
for (let bar = 0; bar < BARS; bar++) {
  place(renderBongo(SR, NEUTRAL), timeOf(bar, 0), 0.5);
  place(renderBongo(SR, NEUTRAL, { slap: true }), timeOf(bar, 12), 0.55);
  if (bar % 2 === 1) place(renderBongo(SR, NEUTRAL, { slap: true }), timeOf(bar, 14), 0.34);
}

// The bass, on the root and the fifth, anticipating the bar the way it does.
const BASS = [
  [0, 0, 0], [0, 8, 3], [0, 14, 0],
  [1, 0, 0], [1, 8, 2], [1, 14, 0],
  [2, 0, 3], [2, 8, 0], [2, 14, 3],
  [3, 0, 0], [3, 8, 3], [3, 14, 4],
];
for (const pass of [0, 4]) {
  for (const [bar, step, degree] of BASS) {
    const b = bar + pass;
    place(renderString(SR, hz(degree, 0) * shiftAt(b), 'bajo', NEUTRAL, { seconds: 1.4 }),
      timeOf(b, step), 0.5);
  }
}

// The segunda: a short answering figure, plucked and immediately damped, which
// is what a rhythm guitar in this music actually does.
for (let bar = 0; bar < BARS; bar++) {
  for (const [s, d] of [[4, 0], [6, 3], [12, 0], [14, 3]]) {
    // The rhythm guitar follows the bass, because a chord needs more than one
    // voice to read as a chord.
    place(renderString(SR, hz(d, 2) * shiftAt(bar), 'segunda', NEUTRAL, { seconds: 0.7 }),
      timeOf(bar, s), 0.3);
  }
}

// THE REQUINTO, which is the whole identity. It enters at bar two, because a
// lead that was there from the first beat has nothing to arrive from.
const LEAD = [
  [1, 0, 3, 1.2], [1, 4, 4, 0.8], [1, 6, 5, 1.6], [1, 12, 4, 1.0],
  [2, 0, 3, 1.4], [2, 6, 2, 0.9], [2, 10, 3, 1.2],
  [3, 2, 5, 1.0], [3, 6, 4, 0.9], [3, 8, 3, 1.8],
  [4, 0, 0, 1.6], [4, 8, 2, 1.0], [4, 12, 3, 1.2],
  [5, 0, 4, 1.1], [5, 4, 5, 0.9], [5, 8, 7, 1.8],
  [6, 0, 5, 1.2], [6, 6, 4, 1.0], [6, 10, 3, 1.4],
  [7, 0, 2, 1.2], [7, 6, 1, 1.0], [7, 8, 0, 2.6],
];
for (const [bar, step, degree, secs] of LEAD) {
  place(renderString(SR, hz(degree, 1), 'requinto', NEUTRAL, { seconds: secs }), timeOf(bar, step), 0.42);
}

// ---------------------------------------------------------------------------

const [L, R] = reverb(dry, SR, { mix: BACHATA.room.mix, size: BACHATA.room.size, damp: BACHATA.room.damp, tailSeconds: 2.5 });

// Interleave to stereo, and leave headroom rather than normalising to the ceiling
// — this palette should sit quietly.
const out = new Float32Array(L.length * 2);
let peak = 0;
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak > 0 ? 0.72 / peak : 1;
for (let i = 0; i < L.length; i++) { out[i * 2] = L[i] * g; out[i * 2 + 1] = R[i] * g; }

const path = process.argv[2] || 'bachata.wav';
writeFileSync(path, Buffer.from(encodeWav(out, SR, 2)));
console.log(`wrote ${path} — ${(L.length / SR).toFixed(1)}s, ${BPM}bpm, straight, i-♭VI-♭VII-i, ${BARS} bars + tail`);
