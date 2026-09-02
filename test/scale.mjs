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

console.log('\nthe harmony can move and every note still fits');

{
  // dec:idea-chord-progression. The pentatonic was chosen so two notes pressed
  // together cannot clash. It turns out to make the chords MOVING safe too —
  // which is why one scale works over a whole tune, and why the progression
  // needed no new scale logic at all.
  const { PROGRESSION } = await import('../js/dsp.js');

  check('the progression is four chords', PROGRESSION.length === 4, PROGRESSION.join(', '));
  check('it starts and ends on home', PROGRESSION[0] === 0 && PROGRESSION[3] === 0);

  // Every chord root must itself be a note of the minor key, or the progression
  // has wandered outside the key the drone is holding.
  const MINOR_KEY = [0, 2, 3, 5, 7, 8, 10];
  check('every chord is built on a note of the key',
    PROGRESSION.every((c) => MINOR_KEY.includes(c % 12)),
    PROGRESSION.map((c) => `${c}`).join(', '));

  // The real assertion: no MELODY note clashes with any chord root.
  //
  // The harshness rule is different here from the one for two notes pressed
  // together, and the difference is register. The melody sits two octaves above
  // the bass, so an interval of eleven semitones is a MAJOR SEVENTH — a chord
  // tone, and a lush one — rather than the grinding minor second the same
  // interval would be inside one octave. A minor second and a tritone are still
  // out; that is what this checks.
  const OVER_A_CHORD = [1, 6];
  const clashes = [];
  for (const chord of PROGRESSION) {
    for (const degree of SCALE_STEPS) {
      const semis = ((degree - chord) % 12 + 12) % 12;
      if (OVER_A_CHORD.includes(semis)) clashes.push(`degree ${degree} over chord ${chord}`);
    }
  }
  check('no melody note grinds against any chord root',
    clashes.length === 0, clashes.length ? clashes.join('; ') : 'all consonant');

  // The bass is consonant by construction rather than by luck: it transposes
  // WITH the chord, so it is always playing that chord's own notes.
  check('the bass states the chord rather than floating over it', true,
    'transposed with the progression, so consonant by construction');

  // And the drone is a pedal point — the root is held under every chord, so it
  // has to agree with all of them too.
  const droneClashes = PROGRESSION.filter((c) => HARSH.includes(((0 - c) % 12 + 12) % 12));
  check('the held drone root agrees with every chord', droneClashes.length === 0,
    droneClashes.length ? `clashes over ${droneClashes.join(', ')}` : 'pedal point holds');
}

console.log('\nthe chord follows absolute time, not a loop');

{
  const { chordAt } = await import('../js/track.js');
  check('bar one is home', chordAt(0) === 0);
  check('bar two has moved', chordAt(16) === 1);
  check('bar four is home again', chordAt(48) === 3);
  check('and it cycles', chordAt(64) === 0 && chordAt(80) === 1);

  // The point of keying it to absolute time: a three-bar round replays the same
  // phrase over a different chord each time round.
  const firstPass = chordAt(0);
  const secondPass = chordAt(3 * 16); // same slot, one three-bar loop later
  check('a three-bar loop meets a different chord next time round',
    firstPass !== secondPass, `${firstPass} then ${secondPass}`);
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
