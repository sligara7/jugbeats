// The loop pedal behaves like a loop pedal.
//
// Run:  node test/session.mjs
//
// Guards dec:two-thumbs-loop-pedal and dec:she-sets-the-tempo. The state
// machine is small on purpose, and small things are exactly what quietly break.

import { Track, ROUNDS } from '../js/track.js';
import { Session } from '../js/session.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Tap out a steady tempo, with optional jitter on each tap. */
function tapOut(session, bpm, { taps = 4, jitter = 0, wild = null } = {}) {
  const gap = 60000 / bpm;
  let t = 1000;
  let bpmOut = null;
  for (let i = 0; i < taps; i++) {
    bpmOut = session.tapTempo(t);
    const wobble = jitter ? (Math.sin(i * 12.9898) * jitter) : 0;
    t += gap + wobble + (wild !== null && i === wild ? gap * 1.6 : 0);
  }
  return bpmOut;
}

// ---------------------------------------------------------------------------

console.log('\nshe taps her own tempo');

{
  const s = new Session(new Track());
  check('it takes four taps', tapOut(s, 100, { taps: 3 }) === null && s.tapsSoFar === 3);

  const s2 = new Session(new Track());
  const bpm = tapOut(s2, 100);
  check('four steady taps give that tempo', bpm === 100, `${bpm} bpm`);

  // The reason for a median rather than a mean: a child's fourth tap is exactly
  // where a wild one turns up, and one wild tap ruins an average.
  const s3 = new Session(new Track());
  const wild = tapOut(s3, 100, { taps: 5, wild: 3 });
  check('one wild tap in five barely moves it', Math.abs(wild - 100) <= 6, `${wild} bpm`);

  // A tempo no child is going to play at should never come out of this.
  const s4 = new Session(new Track());
  const silly = tapOut(s4, 400);
  check('an impossibly fast tapping is clamped', silly <= 170, `${silly} bpm`);
  // 40bpm is 1.5s between taps — slow, but still inside the window that counts
  // as one continuous tapping. Slower than about 25bpm and the gaps exceed the
  // timeout, which correctly reads as her having stopped and started again
  // rather than as a very slow tempo.
  const s5 = new Session(new Track());
  const slow = tapOut(s5, 40);
  check('an impossibly slow one is clamped up', slow === 60, `${slow} bpm`);

  const s5b = new Session(new Track());
  check('and gaps longer than the timeout are not a tempo at all',
    tapOut(s5b, 15) === null);

  // A long pause means she started again, not that she kept going.
  const s6 = new Session(new Track());
  s6.tapTempo(0); s6.tapTempo(600); s6.tapTempo(1200);
  s6.tapTempo(9000); // ages later
  check('a long pause starts the count again', s6.tapsSoFar === 1, `${s6.tapsSoFar} taps`);
}

console.log('\nthe transport does what its buttons say');

{
  const track = new Track();
  const s = new Session(track);
  tapOut(s, 110);

  check('nothing records before START', !s.recording);
  s.begin(16);
  check('START counts her in first', s.state === 'counting');
  s.tick(8);
  check('still counting halfway through', s.state === 'counting');
  s.tick(16);
  check('recording begins when the count-in ends', s.recording);

  // STOP on an empty round would advance her past a round she never played.
  check('STOP refuses an empty round', s.stop() === false && s.recording);

  track.record('r1', 0, 0);
  track.record('r1', 1, 8);
  check('STOP keeps a round that has something in it', s.stop() === true);
  check('the kept round is marked kept', track.accepted.has('r1'));
  check('and she has moved on to the next one', s.round.id === 'r2');
  check('which is not recording until she says so', !s.recording);
}

console.log('\nRESET throws away this round and nothing else');

{
  const track = new Track();
  const s = new Session(track);
  tapOut(s, 110);
  s.begin(0); s.tick(0);
  track.record('r1', 0, 0);
  s.stop();

  s.begin(0); s.tick(0);
  track.record('r2', 0, 4);
  track.record('r2', 1, 8);
  s.reset();

  check('the current round is emptied', track.count('r2') === 0);
  check('the round she already kept is untouched', track.count('r1') === 1);
  check('and it is still marked kept', track.accepted.has('r1'));
  check('she is back to waiting, not recording', !s.recording);
}

console.log('\nthe click retires when her beat takes over');

{
  const s = new Session(new Track());
  check('it ticks while she sets the tempo', s.clickAudible);
  tapOut(s, 110);
  s.begin(0);
  check('it ticks through the count-in', s.clickAudible);
  s.tick(0);
  check('it ticks through round one', s.clickAudible);

  s.track.record('r1', 0, 0);
  s.stop();
  s.begin(0); s.tick(0);
  check('and it is gone from round two onward', !s.clickAudible, `round ${s.round.id}`);
}

console.log('\nshe can only reach rounds she has earned');

{
  const track = new Track();
  const s = new Session(track);
  check('only the first is reachable at the start', s.furthestReachable() === 0);

  track.record('r1', 0, 0);
  track.accept('r1');
  check('keeping one opens the next', s.furthestReachable() === 1);
  check('she can go back to a kept round', s.goTo(0) === true);
  check('but not skip ahead to an unearned one', s.goTo(3) === false);

  // A shared track arrives finished, so all of it is hers to take apart.
  const shared = new Track();
  for (const r of ROUNDS) shared.record(r.id, 0, 0);
  const s2 = new Session(shared);
  s2.openEverything();
  check('a shared track opens every round', s2.furthestReachable() === ROUNDS.length - 1);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
