// Render a short haunted loop to a WAV, so a human can hear the palette.
//
// Run:  node forge/haunted.mjs [out.wav]
//
// The sibling of forge/demo.mjs, which does the same job for the phonk kit. Same
// reasoning: the owner's binding condition is that the sounds must not sound
// cheap, and the only way to check that is to listen (dec:two-speed-synthesis).
//
// Governed by dec:ethereal-not-a-sleep-lab.

import { writeFileSync } from 'node:fs';
import { encodeWav } from './wav.mjs';
import { WHOLE_TONE, ROOT_HZ } from '../js/dsp.js';
import { reverb } from '../js/ethereal.js';
import {
  renderGlassHarmonica, renderWail, renderDread, renderKnock,
  renderHauntedIdiophone, HAUNTED,
} from '../js/haunted.js';

const SR = 44100;
const BPM = HAUNTED.bpm;
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
  const n = WHOLE_TONE.length;
  const idx = ((degree % n) + n) % n;
  return ROOT_HZ * Math.pow(2, Math.floor(degree / n) + oct + WHOLE_TONE[idx] / 12);
}

// ---------------------------------------------------------------------------
// The arrangement. Deliberately almost nothing: a held open fifth underneath, a
// slow bell figure over it, a breath line arriving late, and a mallet pulse so
// quiet it is felt rather than heard.
//
// Sparse ON PURPOSE. The failure mode of a pad palette is porridge — everything
// sustaining at once until nothing is audible. Long notes need room.
// ---------------------------------------------------------------------------

// The dread underneath: the root and the TRITONE, held, re-struck every four
// bars. That interval is the palette's entire harmonic idea, stated once and
// left sitting there.
for (let bar = 0; bar < BARS; bar += 4) {
  place(renderDread(SR, hz(0, 2), NEUTRAL, { seconds: stepSec * STEPS * 4.6 }), timeOf(bar, 0), 0.5);
  place(renderDread(SR, hz(3, 2), NEUTRAL, { seconds: stepSec * STEPS * 4.6 }), timeOf(bar, 0), 0.24);
}

// The music box, sparse and high. Sparse ON PURPOSE — in a room this reverberant
// a busy part turns to porridge, and a single note left alone is worse than a
// tune anyway.
const BOX = [
  [0, 0, 0], [0, 10, 2],
  [1, 4, 5], [1, 12, 3],
  [2, 0, 0], [2, 6, 2], [2, 12, 4],
  [3, 8, 1],
  [4, 0, 3], [4, 10, 5],
  [5, 4, 2], [5, 12, 0],
  [6, 0, 4], [6, 8, 2],
  [7, 0, 0],
];
for (const [bar, step, degree] of BOX) {
  place(renderHauntedIdiophone(SR, hz(degree, 3), 'musicbox', NEUTRAL, { seconds: 4 }), timeOf(bar, step), 0.3);
}

// A bell tolling on the bar, every other bar. Slow enough to be an event.
for (let bar = 1; bar < BARS; bar += 2) {
  place(renderHauntedIdiophone(SR, hz(0, 1), 'tollbell', NEUTRAL, { seconds: 6 }), timeOf(bar, 0), 0.22);
}

// Knocks — dry, close, and unrelated to the beat, which is why they unsettle.
for (const [bar, step] of [[2, 2], [2, 5], [3, 11], [5, 6], [5, 9], [6, 14]]) {
  place(renderKnock(SR, NEUTRAL), timeOf(bar, step), 0.5);
}

// The glass arrives late and stays.
for (const [bar, step, degree, beats] of [[3, 0, 2, 5], [5, 8, 5, 4], [7, 0, 3, 5]]) {
  place(renderGlassHarmonica(SR, hz(degree, 3), NEUTRAL, { seconds: stepSec * 4 * beats }), timeOf(bar, step), 0.26);
}

// One wail, once, near the end. Twice would be a haunted house ride.
place(renderWail(SR, hz(2, 3), NEUTRAL, { seconds: stepSec * 4 * 6 }), timeOf(6, 0), 0.2);

// A single clang to finish, left to ring out into the room.
place(renderHauntedIdiophone(SR, hz(0, 2), 'clang', NEUTRAL, { seconds: 7 }), timeOf(7, 8), 0.24);

// ---------------------------------------------------------------------------

const [L, R] = reverb(dry, SR, { mix: HAUNTED.room.mix, size: HAUNTED.room.size, damp: HAUNTED.room.damp, tailSeconds: 6 });

// Interleave to stereo, and leave headroom rather than normalising to the ceiling
// — this palette should sit quietly.
const out = new Float32Array(L.length * 2);
let peak = 0;
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak > 0 ? 0.72 / peak : 1;
for (let i = 0; i < L.length; i++) { out[i * 2] = L[i] * g; out[i * 2 + 1] = R[i] * g; }

const path = process.argv[2] || 'haunted.wav';
writeFileSync(path, Buffer.from(encodeWav(out, SR, 2)));
console.log(`wrote ${path} — ${(L.length / SR).toFixed(1)}s, ${BPM}bpm, straight, whole tone, ${BARS} bars + tail`);
