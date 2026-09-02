// She cannot play a wrong note — and now that holds for chords too.
//
// Run:  node test/scale.mjs
//
// Guards dec:pentatonic-for-chords. The scale lock's promise was always that
// nothing she can reach sounds like a mistake. That promise silently only ever
// covered notes played ONE AFTER ANOTHER: natural minor contains semitones, and
// the moment two keys could be pressed together those became reachable as
// chords. This test is the promise, written down.

import { SCALE_STEPS, NATURAL_MINOR_STEPS, SCALE_NAME, degreeToHz, ROOT_HZ } from '../js/dsp.js';
import { ROUNDS } from '../js/track.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/**
 * Every interval available between two notes of a scale, in semitones, folded
 * into an octave — including pairs that span octaves, since the lanes do.
 */
function intervals(steps, octaves = 2) {
  const notes = [];
  for (let o = 0; o < octaves; o++) for (const s of steps) notes.push(s + o * 12);
  const out = new Set();
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const semis = (notes[j] - notes[i]) % 12;
      if (semis !== 0) out.add(semis);
    }
  }
  return out;
}

// A semitone and a tritone are the two intervals a child would hear as a
// mistake. A whole tone is fine — it is a large part of why pentatonic works.
const HARSH = [1, 6, 11];

console.log(`\nthe scale is ${SCALE_NAME}`);

{
  const found = intervals(SCALE_STEPS);
  const harsh = HARSH.filter((h) => found.has(h));
  check('no two notes she can reach form a semitone or a tritone',
    harsh.length === 0,
    harsh.length ? `found ${harsh.join(', ')} semitones apart` : `intervals: ${[...found].sort((a, b) => a - b).join(', ')}`);

  check('it has five notes', SCALE_STEPS.length === 5, `${SCALE_STEPS.length}`);
  check('it is a subset of the natural minor it replaced',
    SCALE_STEPS.every((s) => NATURAL_MINOR_STEPS.includes(s)));
}

console.log('\nand the scale it replaced really did have the problem');

{
  // Without this the test above proves nothing: a scale with no clashes is only
  // interesting if the previous one had some.
  const found = intervals(NATURAL_MINOR_STEPS);
  const harsh = HARSH.filter((h) => found.has(h));
  check('natural minor DID contain a harsh interval', harsh.length > 0,
    `${harsh.join(', ')} semitones — the clash chords would have exposed`);

  const removed = NATURAL_MINOR_STEPS.filter((s) => !SCALE_STEPS.includes(s));
  check('exactly the two clashing degrees were removed', removed.length === 2,
    `dropped ${removed.join(' and ')} semitones above the root`);
}

console.log('\nevery pair of lanes she can press together is consonant');

{
  // The real test: not the abstract scale, but the notes actually under her
  // thumbs. A safe scale wired to unsafe lanes would still sound wrong.
  for (const round of ROUNDS) {
    const degrees = round.lanes.map((l) => l.degree).filter((d) => d !== undefined);
    if (degrees.length < 2) continue;

    let worst = null;
    for (let i = 0; i < degrees.length; i++) {
      for (let j = i + 1; j < degrees.length; j++) {
        const a = Math.log2(degreeToHz(degrees[i]) / ROOT_HZ) * 12;
        const b = Math.log2(degreeToHz(degrees[j]) / ROOT_HZ) * 12;
        const semis = Math.round(Math.abs(b - a)) % 12;
        if (semis !== 0 && HARSH.includes(semis)) worst = semis;
      }
    }
    check(`${round.full}: its lanes agree with each other`, worst === null,
      worst === null ? `degrees ${degrees.join(', ')}` : `${worst} semitones apart`);
  }
}

console.log('\npitches come out where they should');

{
  check('degree 0 is the root', Math.abs(degreeToHz(0) - ROOT_HZ) < 0.01);
  check('a whole scale up is an octave', Math.abs(degreeToHz(5) - ROOT_HZ * 2) < 0.01,
    `${degreeToHz(5).toFixed(2)}Hz vs ${(ROOT_HZ * 2).toFixed(2)}Hz`);
  check('degrees run off the top rather than stopping', degreeToHz(9) > degreeToHz(4));
  check('and off the bottom too', degreeToHz(-1) < ROOT_HZ);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
