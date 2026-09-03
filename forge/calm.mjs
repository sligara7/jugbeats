// Render a short ethereal loop to a WAV, so a human can hear the palette before
// any of it is wired into the game.
//
// Run:  node forge/calm.mjs [out.wav]
//
// The sibling of forge/demo.mjs, which does the same job for the phonk kit. Same
// reasoning: the owner's binding condition is that the sounds must not sound
// cheap, and the only way to check that is to listen (dec:two-speed-synthesis).
//
// Governed by dec:ethereal-not-a-sleep-lab.

import { writeFileSync } from 'node:fs';
import { encodeWav } from './wav.mjs';
import { SCALE_STEPS, ROOT_HZ } from '../js/dsp.js';
import {
  renderPadVoice, renderBreath, renderMallet, renderIdiophone, renderMarkTree, reverb, CALM,
} from '../js/ethereal.js';

const SR = 44100;
const BPM = CALM.bpm;
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
  const n = SCALE_STEPS.length;
  const idx = ((degree % n) + n) % n;
  return ROOT_HZ * Math.pow(2, Math.floor(degree / n) + oct + SCALE_STEPS[idx] / 12);
}

// ---------------------------------------------------------------------------
// The arrangement. Deliberately almost nothing: a held open fifth underneath, a
// slow bell figure over it, a breath line arriving late, and a mallet pulse so
// quiet it is felt rather than heard.
//
// Sparse ON PURPOSE. The failure mode of a pad palette is porridge — everything
// sustaining at once until nothing is audible. Long notes need room.
// ---------------------------------------------------------------------------

// The drone: root and fifth, two octaves up so a phone can reproduce it
// (dec:drone-voiced-up), re-struck every four bars so it never quite dies.
for (let bar = 0; bar < BARS; bar += 4) {
  place(renderPadVoice(SR, hz(0, 2), NEUTRAL, { seconds: stepSec * STEPS * 4.6 }), timeOf(bar, 0), 0.5);
  place(renderPadVoice(SR, hz(3, 2), NEUTRAL, { seconds: stepSec * STEPS * 4.6 }), timeOf(bar, 0), 0.32);
}

// The handpan carries the figure. Of everything in the owner's list this is the
// one that most does the job on its own: its overtones are tuned to an octave
// and a twelfth, so it agrees with itself and with everything else, and it rings
// long enough to blur into the room.
//
// Degrees index the minor pentatonic, so nothing can clash (dec:pentatonic-for-chords).
const FIGURE = [
  [0, 0, 3], [0, 6, 2], [0, 12, 4],
  [1, 2, 5], [1, 8, 3], [1, 12, 2],
  [2, 0, 0], [2, 6, 3], [2, 10, 4],
  [3, 4, 5], [3, 12, 3],
  [4, 0, 3], [4, 6, 2], [4, 12, 4],
  [5, 2, 5], [5, 8, 7], [5, 12, 5],
  [6, 0, 4], [6, 6, 3], [6, 10, 2],
  [7, 0, 0], [7, 8, 3],
];
for (const [bar, step, degree] of FIGURE) {
  place(renderIdiophone(SR, hz(degree, 2), 'handpan', NEUTRAL, { seconds: 4.5 }), timeOf(bar, step), 0.34);
}

// Vibes an octave up, on the long notes only — the motor tremolo is what makes
// a held chord shimmer instead of just sitting there.
for (const [bar, step, degree] of [[1, 0, 0], [3, 0, 4], [5, 0, 3], [7, 0, 0]]) {
  place(renderIdiophone(SR, hz(degree, 3), 'vibes', NEUTRAL, { seconds: 5 }), timeOf(bar, step), 0.16);
}

// One mark tree, once, at the halfway point. Twice would be a jingle.
place(renderMarkTree(SR, hz(0, 4), NEUTRAL), timeOf(4, 0) - 0.2, 0.22);

// A single struck bowl under the entrance of the voice — it swells in, so it
// arrives rather than starts.
place(renderIdiophone(SR, hz(0, 1), 'bowl', NEUTRAL, { seconds: 9 }), timeOf(2, 0) - 1.0, 0.3);

// The breath, entering at bar three — the voice should feel like it joins rather
// than like it was always there.
const VOICE = [[2, 0, 0, 4], [3, 8, 3, 3], [4, 0, 4, 5], [5, 8, 5, 3], [6, 0, 3, 6]];
for (const [bar, step, degree, beats] of VOICE) {
  place(
    renderBreath(SR, hz(degree, 2), NEUTRAL, { seconds: stepSec * 4 * beats }),
    timeOf(bar, step),
    0.34,
  );
}

// The pulse. Every half bar, very quiet — present enough to keep time, far too
// soft to be a beat you would tap to.
for (let bar = 2; bar < BARS; bar++) {
  for (const s of [0, 8]) place(renderMallet(SR, NEUTRAL), timeOf(bar, s), 0.1);
}

// ---------------------------------------------------------------------------

const [L, R] = reverb(dry, SR, { mix: CALM.room.mix, size: CALM.room.size, damp: CALM.room.damp, tailSeconds: 5 });

// Interleave to stereo, and leave headroom rather than normalising to the ceiling
// — this palette should sit quietly.
const out = new Float32Array(L.length * 2);
let peak = 0;
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak > 0 ? 0.72 / peak : 1;
for (let i = 0; i < L.length; i++) { out[i * 2] = L[i] * g; out[i * 2 + 1] = R[i] * g; }

const path = process.argv[2] || 'calm.wav';
writeFileSync(path, Buffer.from(encodeWav(out, SR, 2)));
console.log(`wrote ${path} — ${(L.length / SR).toFixed(1)}s, ${BPM}bpm, straight, ${BARS} bars + tail`);
