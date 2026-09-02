// Render a short phonk loop to a WAV, so a human can hear the kit before any
// of the game exists.
//
// Run:  node forge/demo.mjs [out.wav]
//
// This is not part of the game and never ships. It exists because the owner's
// binding condition on dec:two-speed-synthesis is that the sounds must not
// sound cheap, and the only way to check that is to listen.

import { writeFileSync } from 'node:fs';
import { VOICES, render808, renderLead, degreeToHz, NEUTRAL } from '../js/dsp.js';
import { encodeWav } from './wav.mjs';

const SR = 44100;
const BPM = 138;            // phonk sits around 130-150
const SWING = 0.16;         // how far the off-16ths lean late; 0 is a drum machine
const BARS = 4;
const STEPS = 16;           // sixteenths per bar

const stepSec = 60 / BPM / 4;
const out = new Float32Array(Math.ceil(SR * stepSec * STEPS * BARS + SR * 1.5));

/** Mix `buf` into the output at `atSec`, at `gain`. */
function place(buf, atSec, gain = 1) {
  const start = Math.floor(atSec * SR);
  for (let i = 0; i < buf.length; i++) {
    const j = start + i;
    if (j >= 0 && j < out.length) out[j] += buf[i] * gain;
  }
}

/** When step `s` of bar `b` lands, with swing applied to the off-beats. */
function timeOf(bar, s) {
  const swung = s % 2 === 1 ? SWING * stepSec : 0;
  return (bar * STEPS + s) * stepSec + swung;
}

// Pre-render each drum once and reuse it. This is exactly what the browser will
// do: a one-shot is rendered or loaded once, then placed many times.
const kit = Object.fromEntries(
  Object.entries(VOICES).map(([name, render]) => [name, render(SR, NEUTRAL)])
);

// A plain phonk pattern. Kick on 1 and the "and" of 3, snare on 3, hats on the
// eighths with the odd open one, and the cowbell carrying the hook.
const KICK    = [0, 6, 10];
const SNARE   = [8];
const HAT     = [0, 2, 4, 6, 8, 10, 12, 14];
const OPENHAT = [14];
const CLAP    = [8];
const COWBELL = [0, 3, 6, 8, 11, 14];

// An 808 line in the minor scale — the same degrees the lanes will offer her.
const BASS = [
  [0, 0], [0, 10], [0, 3],
  [1, 0], [1, 8],
  [2, 0], [2, 5],
  [3, 0], [3, 2], [3, 12],
];
const BASS_DEGREE = { 0: 0, 10: 0, 3: 2, 8: 4, 5: 3, 2: 5, 12: 1 };

// A sparse lead hook, an octave and a half up.
const LEAD = [[0, 12, 4], [0, 14, 3], [1, 4, 2], [2, 12, 4], [3, 6, 5], [3, 12, 7]];

for (let bar = 0; bar < BARS; bar++) {
  for (const s of KICK)    place(kit.kick,    timeOf(bar, s), 1.0);
  for (const s of SNARE)   place(kit.snare,   timeOf(bar, s), 0.75);
  for (const s of CLAP)    place(kit.clap,    timeOf(bar, s), 0.5);
  for (const s of HAT)     place(kit.hat,     timeOf(bar, s), 0.45);
  for (const s of OPENHAT) place(kit.openhat, timeOf(bar, s), 0.4);
  for (const s of COWBELL) place(kit.cowbell, timeOf(bar, s), bar % 2 === 0 ? 0.5 : 0.34);

  for (const [b, s] of BASS) {
    if (b !== bar % 4) continue;
    const hz = degreeToHz(BASS_DEGREE[s] ?? 0);
    place(render808(SR, hz, NEUTRAL, { seconds: 0.7 }), timeOf(bar, s), 0.95);
  }
  for (const [b, s, deg] of LEAD) {
    if (b !== bar) continue;
    place(renderLead(SR, degreeToHz(deg, 2), NEUTRAL, { seconds: 0.35 }), timeOf(bar, s), 0.3);
  }
}

// Gentle bus saturation, then normalize. Glueing the whole loop through one
// soft-clip is a lot of what makes a set of separate hits sound like a track.
let peak = 0;
for (let i = 0; i < out.length; i++) {
  out[i] = Math.tanh(out[i] * 1.15) / Math.tanh(1.15);
  peak = Math.max(peak, Math.abs(out[i]));
}
if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.92 / peak;

const file = process.argv[2] || 'demo.wav';
writeFileSync(file, encodeWav(out, SR));
console.log(`  wrote ${file} — ${BARS} bars at ${BPM}bpm, ${(out.length / SR).toFixed(1)}s`);
