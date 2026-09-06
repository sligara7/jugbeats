// Every voice makes a sound, and no voice makes a NaN.
//
// Run:  node test/voices.mjs
//
// WRITTEN BEFORE THE FIX AND OBSERVED TO FAIL, which is the point of it
// (rule:find-the-cause-before-the-fix). On 2026-09-06 renderHat produced NaN
// from about 20ms in, at every sample rate, and the offline bake wrote that
// NaN out as digital silence — so kit/openhat.wav has been 93% silence for the
// entire life of this project and nothing anywhere noticed.
//
// IT PINS THE CLASS RATHER THAN THE INSTANCE. The instance is one filter stage
// in one drum. The class is that a diverged filter is INDISTINGUISHABLE from a
// short sound: js/dsp.js has no isFinite check, forge/wav.mjs clamps with
// Math.max(-1, Math.min(1, v)) which passes NaN straight through, and
// Number.prototype conversion then writes it as a zero sample. Any future voice
// that picks a high cutoff with a low Q fails the same way, silently, and ships.
//
// So this asserts the invariant every renderer owes, for all of them at once:
// finite everywhere, audible somewhere, and ringing for most of the buffer it
// asked to be given.

import * as dsp from '../js/dsp.js';
import * as ritual from '../js/ritual.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** What a rendered buffer actually contains. */
function inspect(buf) {
  let nan = 0, peak = 0, last = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a > 0.005) last = i;
  }
  return { nan, peak, last, len: buf.length, fill: buf.length ? last / buf.length : 0 };
}

// 22050 is the rate the drum kit is BAKED at (forge/build-kit.mjs), and it is
// the worst case: the Chamberlin filter's stability bound tightens as the
// sample rate falls, so a voice can be clean at 48k and diverge in the shipped
// kit. Testing only at 48k would have missed half of this.
const RATES = [22050, 44100, 48000];

const VOICES = [
  ['kick', (sr) => dsp.renderKick(sr)],
  ['snare', (sr) => dsp.renderSnare(sr)],
  ['hat', (sr) => dsp.renderHat(sr, undefined, { open: false })],
  ['openhat', (sr) => dsp.renderHat(sr, undefined, { open: true })],
  ['cowbell', (sr) => dsp.renderCowbell(sr)],
  ['clap', (sr) => dsp.renderClap(sr)],
  ['808', (sr) => dsp.render808(sr, 65.41, {})],
  ['lead', (sr) => dsp.renderLead(sr, 261.6, {})],
  ['ritual piano', (sr) => ritual.renderFeltPiano(sr, 261.6, {})],
  ['ritual choir', (sr) => ritual.renderChoir(sr, 261.6, {})],
  ['ritual riff', (sr) => ritual.renderRiff(sr, 65.41, {})],
  ['ritual kick', (sr) => ritual.renderRitualKick(sr)],
  ['ritual snare', (sr) => ritual.renderRitualSnare(sr)],
  ['ritual ghost', (sr) => ritual.renderRitualGhost(sr)],
  ['ritual hat', (sr) => ritual.renderRitualHat(sr)],
];

console.log('\nno voice renders a NaN, at any rate the project uses');

for (const [name, render] of VOICES) {
  for (const sr of RATES) {
    const r = inspect(render(sr));
    check(`${name} @ ${sr}`, r.nan === 0,
      r.nan ? `${r.nan} of ${r.len} samples are NaN or Infinity` : '');
  }
}

console.log('\nand every voice actually makes a sound');

for (const [name, render] of VOICES) {
  const r = inspect(render(48000));
  check(`${name} is audible`, r.peak > 0.01, `peak ${r.peak.toFixed(3)}`);
}

console.log('\nand rings for most of the buffer it asked for');

// A renderer chooses its own length. A sound that stops in the first third of
// the buffer it allocated is either wrong or wasting memory, and in this
// project it has meant wrong: the NaN tail is written out as silence, so a
// broken voice looks exactly like a short one.
for (const [name, render] of VOICES) {
  for (const sr of RATES) {
    const r = inspect(render(sr));
    check(`${name} @ ${sr} fills its buffer`, r.fill > 0.4,
      `audible to ${(r.fill * 100).toFixed(0)}%`);
  }
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
