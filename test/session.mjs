// ver:loop-pedal-behaves — the loop pedal behaves like a loop pedal.
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

console.log('\nthe tempo is not a dead end');

{
  // THE TRAP THAT SHIPPED. Once four taps landed there was no route back to
  // tapping, so a child who set something too fast could only escape by
  // reloading the page. The first thing she does was the one thing she could
  // not undo.
  const track = new Track();
  const s = new Session(track);
  tapOut(s, 150);
  check('a tempo she does not like is set', s.tempoIsSet && track.bpm === 150);
  check('and she is offered a way out of it', s.canRetapTempo);

  s.clearTempo();
  check('clearing it puts her back to tapping', !s.tempoIsSet && s.tapsSoFar === 0);
  check('and nothing else was thrown away', track.isEmpty());

  const second = tapOut(s, 96);
  check('she can tap a different one', second === 96 && track.bpm === 96);
}

console.log('\nbut the tempo cannot move once music depends on it');

{
  // The offer is withdrawn rather than the request refused after she makes it.
  // Retuning mid-track would move notes already recorded against the old tempo,
  // which is the same reason the clock refuses to retune while running.
  const track = new Track();
  const s = new Session(track);
  tapOut(s, 110);
  s.begin(0); s.tick(0);
  track.record('r1', 0, 0);
  s.stop();

  check('once a round is kept, retapping is no longer offered', !s.canRetapTempo);
  check('and the kept round is still there', track.count('r1') === 1);
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

console.log('\nstopping the music keeps everything she made');

{
  // Without an off switch the loop plays until the tab is closed. The point of
  // this one is that it is NOT the other two: STOP keeps a round and moves on,
  // RESET empties one, and this just makes it quiet.
  const track = new Track();
  const s = new Session(track);
  tapOut(s, 110);
  s.begin(0); s.tick(0);
  track.record('r1', 0, 0);
  track.record('r1', 1, 8);
  check('she is recording', s.recording);

  s.halt();
  check('halting stops the recording', !s.recording);
  check('but keeps every note she played', track.count('r1') === 2, `${track.count('r1')}`);
  check('and does not accept the round behind her back', !track.accepted.has('r1'));
  check('nor advance her past it', s.round.id === 'r1');
  check('and her tempo is still hers', track.bpm === 110 && s.tempoIsSet);

  // She can pick straight back up.
  s.begin(0); s.tick(0);
  check('she can start again where she was', s.recording && s.round.id === 'r1');
  track.record('r1', 0, 16);
  check('and add to what was already there', track.count('r1') === 3);
}

console.log('\nmuting silences a layer without losing it');

{
  // The distinction that matters: CLEAR deletes, MUTE silences. Dropping the
  // drums out for four bars and bringing them back is what a producer does, and
  // it is the cheapest way a fixed loop gets an arrangement.
  const track = new Track();
  track.record('r1', 0, 0);
  track.record('r1', 1, 8);
  track.accept('r1');

  check('a kept round starts audible', !track.isMuted('r1'));
  check('muting it reports that it is muted', track.toggleMute('r1') === true);
  check('and it is', track.isMuted('r1'));
  check('but its notes are all still there', track.count('r1') === 2);
  check('unmuting brings it back', track.toggleMute('r1') === false && !track.isMuted('r1'));

  // Nothing to silence in a round she has not finished.
  check('a round she has not kept cannot be muted', track.toggleMute('r2') === false);
  check('and does not become muted by trying', !track.isMuted('r2'));

  // Clearing a muted round must not leave it silent, or she rebuilds it and
  // hears nothing and has no idea why.
  track.toggleMute('r1');
  track.clear('r1');
  check('clearing a muted round unmutes it too', !track.isMuted('r1'));
}

console.log('\nthe loop is four bars again');

{
  const track = new Track();
  check('a new track is four bars', track.bars === 4, `${track.bars}`);
  check('which is 32 places to put a note in a lane',
    track.loopSteps / 2 === 32, `${track.loopSteps / 2}`);

  // Muting is a performance choice, not part of the composition, so it must not
  // be in the snapshot the link is built from.
  track.record('r1', 0, 0); track.accept('r1'); track.toggleMute('r1');
  check('muting is not part of what gets saved',
    JSON.stringify(track.toJSON()).includes('muted') === false);
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

console.log('\nLISTEN punches out of recording without ending anything');

{
  // The owner's ask: stop KEEPING what she plays, keep the music going, then
  // punch back in knowing where the note should sit
  // (dec:idea-pause-stops-recording-not-music).
  const track = new Track({ bars: 2 });
  const s = new Session(track);
  for (let i = 0; i < 4; i++) s.tapTempo();
  s.begin(0);
  s.tick(0);
  check('recording after the count-in', s.recording === true);

  track.record('r1', 0, 0);
  track.record('r1', 1, 8);
  const before = track.count('r1');

  s.halt();

  check('no longer recording', s.recording === false);
  check('but not thrown back to the tempo tap', s.tempoIsSet === true);
  check('everything she played is still there', track.count('r1') === before, `${track.count('r1')}`);
  check('still on the same round', s.round.id === 'r1');
  check('and the round is not accepted behind her back', track.accepted.has('r1') === false);

  // Punching back in is just START again — the same call the button already makes.
  check('she can start recording again', s.begin(0) === true);
  s.tick(0);
  check('and is recording once more', s.recording === true);
  track.record('r1', 0, 4);
  check('the new note joins the old ones', track.count('r1') === before + 1);
}

console.log('\na track somebody SENT arrives with its tempo already set');

{
  // The owner's report: to hear a track you were sent, you had to tap out a
  // tempo four times first — a tempo the track already carried in the link.
  const track = new Track({ bars: 4 });
  track.bpm = 68;
  track.record('r1', 0, 0);
  track.record('r3', 0, 8);
  const s = new Session(track);

  check('a fresh session has no tempo yet', s.tempoIsSet === false);

  s.openEverything();

  check('a received track HAS its tempo', s.tempoIsSet === true);
  check('and it is the one that was sent', track.bpm === 68);
  check('without pretending anyone tapped', s.tapsSoFar === 0);
  check('so it is ready to start immediately', s.begin(0) === true);

  // And she must not be able to retune somebody else's finished track, because
  // that would move notes already recorded against the old tempo.
  const s2 = new Session(track);
  s2.openEverything();
  check('but she cannot retap over what she was sent', s2.canRetapTempo === false);
}

console.log('\ntempo, once set, stays set');

{
  const track = new Track({ bars: 4 });
  const s = new Session(track);
  for (let i = 0; i < 4; i++) s.tapTempo();
  check('four taps set it', s.tempoIsSet === true);

  s.nudgeTempo(5);
  // This used to send her back to "TAP 0/4" with a perfectly good tempo in hand,
  // because the flag WAS the tap count and nudging clears the taps.
  check('nudging does not un-set it', s.tempoIsSet === true);

  s.clearTempo();
  check('but clearing does', s.tempoIsSet === false);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
