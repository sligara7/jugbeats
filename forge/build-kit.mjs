// The kit forge — the offline sound bakery (comp:kit-forge).
//
// Renders the drum one-shots the browser loads, using the same DSP the runtime
// uses for its pitched voices. Nothing in here ships; its output is the kit.
//
// Run:  node forge/build-kit.mjs
//
// Governed by dec:two-speed-synthesis. The drums are baked because their pitch
// never changes and this is where realism is won — offline there is no latency
// budget, so the sound design can be as expensive as it needs to be.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICES, NEUTRAL } from '../js/dsp.js';
import { encodeWav } from './wav.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'kit');

// 22050 mono. Drums have almost nothing above 8kHz that survives a phone
// speaker, and halving the rate halves the kit. The whole point of the baked
// half is that it costs nothing on first load (ver:time-to-first-sound).
const SAMPLE_RATE = 22050;

// The kit as shipped. These are the sounds before she touches anything — her
// shaping numbers are applied at runtime, on the pitched voices, so these stay
// at neutral. A drum she reshapes would have to be re-rendered, and that is the
// price of baking them; it is the right trade for the sounds where realism
// matters most.
const KIT = ['kick', 'snare', 'hat', 'openhat', 'cowbell', 'clap'];

mkdirSync(OUT, { recursive: true });

const manifest = { sampleRate: SAMPLE_RATE, voices: {} };
let total = 0;

for (const name of KIT) {
  const render = VOICES[name];
  if (!render) throw new Error(`no recipe for voice "${name}"`);

  const samples = render(SAMPLE_RATE, NEUTRAL);
  const wav = encodeWav(samples, SAMPLE_RATE);
  const file = `${name}.wav`;
  writeFileSync(join(OUT, file), wav);

  manifest.voices[name] = file;
  total += wav.length;
  const ms = ((samples.length / SAMPLE_RATE) * 1000).toFixed(0);
  console.log(`  ${name.padEnd(8)} ${ms.padStart(4)}ms  ${(wav.length / 1024).toFixed(1).padStart(6)} KB`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n  kit total: ${(total / 1024).toFixed(1)} KB across ${KIT.length} voices`);
if (total > 200 * 1024) {
  // Not fatal, but say so loudly: the load budget is a real requirement and
  // nothing else in the build would notice it slipping.
  console.warn('  WARNING: kit is over 200 KB — check ver:time-to-first-sound');
}
