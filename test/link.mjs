// ver:old-links-still-play — the round trip, and backward compatibility.
//
// Run:  node test/link.mjs
//
// The second half is the one that matters. A link she sent months ago is
// sitting in someone's chat, and nothing else in the design would notice if it
// stopped working. iface:track-format is the one PUBLISHED boundary here.

import { Track, ROUNDS, LANE_STRIDE, laneCount } from '../js/track.js';

// The codec is browser code and reaches for btoa/atob. Supply them rather than
// changing the shipping code to suit a test.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.location ??= { href: 'https://sligara7.github.io/jugbeats/', hash: '' };

const { encode, decode, urlFor } = await import('../js/link.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const sameNotes = (a, b) =>
  ROUNDS.every((r) => {
    const x = [...a.events[r.id]].sort((p, q) => p - q).join(',');
    const y = [...b.events[r.id]].sort((p, q) => p - q).join(',');
    return x === y;
  });

// ---------------------------------------------------------------------------

console.log('\nround trip');

{
  const t = new Track({ bars: 2 });
  t.bpm = 112;
  t.record('r1', 0, 0); t.record('r1', 1, 8);
  t.record('r2', 0, 4); t.record('r2', 0, 12);
  t.record('r3', 0, 0); t.record('r3', 1, 20);
  t.record('r4', 1, 16);
  t.accept('r1'); t.accept('r2');
  t.shaping.bass = { deeper: 0.25, punchier: 1, dirtier: 0, longer: 0.5 };

  const back = decode(encode(t));
  check('a track survives encode and decode', back !== null && sameNotes(t, back));
  check('the bar count survives', back?.bars === 2);

  // Her tempo is part of the track now: she tapped it, so it is as much hers as
  // the notes are, and a shared beat has to arrive at the speed she made it.
  check('her tempo survives', back?.bpm === 112, `${back?.bpm} bpm`);

  check('which rounds she kept survives',
    back.accepted.has('r1') && back.accepted.has('r2') && !back.accepted.has('r3'));

  const near = (a, b) => Math.abs(a - b) < 0.005;
  check('shaping numbers survive', near(back.shaping.bass.deeper, 0.25));
  check('a control turned fully down stays fully down', near(back.shaping.bass.dirtier, 0));
}

console.log('\nthe link is short enough to paste into a chat');

{
  const full = new Track({ bars: 2 });
  for (const r of ROUNDS) {
    for (let s = 0; s < full.loopSteps; s += 2) {
      for (let n = 0; n < laneCount(r.id); n++) full.record(r.id, n, s);
    }
  }
  const sparse = new Track({ bars: 2 });
  sparse.record('r1', 0, 0);

  const long = urlFor(full).length;
  const short = urlFor(sparse).length;
  check('a completely full track still fits comfortably', long < 400, `${long} chars`);
  check('length does not depend on how much she played', Math.abs(long - short) < 4,
    `full ${long}, sparse ${short}`);
}

console.log('\na bad link opens the game empty, never an error');

{
  check('empty string', decode('') === null);
  check('nonsense', decode('!!!not-base64!!!') === null);

  // A link from a FUTURE build must degrade to "make your own", not crash.
  const bytes = Buffer.from(
    encode(new Track()).replace(/-/g, '+').replace(/_/g, '/'), 'base64'
  );
  bytes[0] = 99;
  const fromFuture = bytes.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('an unknown future version', decode(fromFuture) === null);
}

console.log('\nevery version we have ever shipped still decodes');

{
  // FROZEN. This string was produced by the v1 encoder as it actually shipped,
  // and is hardcoded rather than regenerated ON PURPOSE — a corpus the current
  // code can rebuild tests nothing, because it would follow the code wherever
  // the code went. Links in this exact format are in real chats.
  //
  // NOTHING MAY EVER BE REMOVED FROM THIS LIST.
  const CORPUS = [
    {
      version: 1,
      note: 'four-bar beat with 808 and melody, from the four-lane era',
      bars: 4,
      encoded:
        'AQQFAAQABgAMAAUABAAGAAQABQAEAAYADAAFAAQABgAEAAEAAAAAAAAAAAABAAAAAAABAAAA' +
        'AgAAAAAAAAAAAAAAAAAAAAAAAAABAAAACAAAAAAAAAAAAAAAAQAAAAAAAABAgICAgICAgA',
    },
    {
      version: 2,
      note: 'two-bar loop-pedal track at 96bpm, from the two-lane era',
      bars: 2,
      bpm: 96,
      encoded: 'AgJgAAEAAgEBAAIBASEBAQEhAQERASAAEQAgAAAAAQAAAQAAD4CAgICAgICA',
    },
    {
      version: 3,
      note: 'four-bar track at 108bpm, from before rounds had their own lengths',
      bars: 4,
      bpm: 108,
      encoded:
        'AwRsAAEAAAACAAEAAQAAAAIAAQABAAAAAgABAAEAAAACAAEAAQABAgEAAQABAAECAQABAAEA' +
        'AQIBAAEAAQABAgEAAQABAQEAAAAAAAgAAAAAAAAAAQAAAAAAAAAIAAAAAAAAAAAAAAACAAAA' +
        'AAAAAAgAAAAAAAAAAgAAAAAAAAAAAAAAD4CAgICAgICA',
    },
    {
      version: 4,
      note: 'four-bar track at 116bpm with a three-bar 808, before per-round grids',
      bars: 4,
      bpm: 116,
      encoded:
        'BAR0AAQEAwQBAAAAAgABAAEAAAACAAEAAQAAAAIAAQABAAAAAgABAAEAAQIBAAEAAQABAgEA' +
        'AQABAAECAQABAAEAAQIBAAEAAQEBAQAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AgAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAA-AgICAgICAgA',
    },
  ];

  for (const c of CORPUS) {
    const t = decode(c.encoded);
    check(`v${c.version} still decodes: ${c.note}`, t !== null && !t.isEmpty());
    if (!t) continue;

    check('  kick and snare land in round one', t.count('r1') > 0, `${t.count('r1')} notes`);
    check('  hats and cowbell land in round two', t.count('r2') > 0, `${t.count('r2')} notes`);
    check('  the 808 lands in round three', t.count('r3') > 0, `${t.count('r3')} notes`);
    check('  the melody lands in round four', t.count('r4') > 0, `${t.count('r4')} notes`);

    // Its original length is kept rather than forced to today's default. That is
    // the difference between replaying her music and cropping it.
    check('  its own length is kept, not forced', t.bars === c.bars, `${t.bars} bars`);

    check('  every note sits on a lane the round still has',
      t.notes(ROUNDS[0].id).every((n) => n.lane < laneCount('r1')) &&
      t.notes(ROUNDS[2].id).every((n) => n.lane < laneCount('r3')));

    check('  it plays at a sensible tempo', t.bpm >= 60 && t.bpm <= 170, `${t.bpm} bpm`);
    if (c.bpm) check('  at exactly the tempo it was made at', t.bpm === c.bpm);

    // Nothing before v5 knew about grids, so every round must widen to eighths.
    check('  every round comes back on the eighth grid',
      ROUNDS.every((r) => t.gridFor(r.id) === 2),
      ROUNDS.map((r) => t.gridFor(r.id)).join(','));

    if (c.version < 4) {
      // Before v4 one loop length covered the whole track.
      check('  all its rounds get the one length it had',
        ROUNDS.every((r) => t.barsFor(r.id) === c.bars));
    } else {
      check('  its per-round lengths survive',
        t.barsFor('r3') === 3 && t.barsFor('r1') === 4,
        ROUNDS.map((r) => t.barsFor(r.id)).join(','));
    }
  }

  // v1 lost notes under v2, because the pitched rounds only had two lanes then
  // and an old melody had four. Widening to four closed that hole, and this is
  // the assertion that says so rather than the comment.
  const v1 = decode(CORPUS[0].encoded);
  check('a v1 melody now carries across whole, with nothing dropped',
    v1.notes('r4').some((n) => n.lane >= 2),
    `lanes present: ${[...new Set(v1.notes('r4').map((n) => n.lane))].sort().join(', ')}`);
}

console.log('\nchords survive the round trip');

{
  // Two notes in the same slot IS a chord — the grid gives it away free, so
  // there is nothing special to encode. This asserts nothing quietly drops one.
  const t = new Track({ bars: 2 });
  t.record('r4', 0, 8);
  t.record('r4', 2, 8); // root and fifth, together
  t.record('r3', 0, 0);
  t.record('r3', 3, 0); // root and flat seventh, together

  const back = decode(encode(t));
  check('both notes of a melody chord come back',
    back.lanesAt('r4', 8).length === 2, `${back.lanesAt('r4', 8).length} notes`);
  check('both notes of an 808 chord come back',
    back.lanesAt('r3', 0).length === 2, `${back.lanesAt('r3', 0).length} notes`);
  check('and they are the same two notes',
    back.lanesAt('r4', 8).join(',') === '0,2' && back.lanesAt('r3', 0).join(',') === '0,3');
}

console.log('\nper-round grids survive the round trip');

{
  // If the grid did not travel, a sixteenth-note snare run would come back
  // quantised to eighths on someone else's phone — half her notes silently
  // gone, and the beat she sent not the beat they hear.
  const t = new Track();
  t.setGrid('r1', 1);
  t.record('r1', 1, 0);
  t.record('r1', 1, 1);   // an off-sixteenth, only reachable on the fine grid
  t.record('r1', 1, 2);
  t.record('r1', 1, 3);
  t.accept('r1');

  check('the round is on sixteenths before sending', t.gridFor('r1') === 1);
  check('and it recorded the in-between notes', t.count('r1') === 4, `${t.count('r1')}`);

  const back = decode(encode(t));
  check('the grid survives', back.gridFor('r1') === 1, `${back.gridFor('r1')}`);
  check('and so do the off-sixteenths', back.count('r1') === 4, `${back.count('r1')}`);
  check('other rounds stay on eighths', back.gridFor('r3') === 2);
}

console.log('\ndifferent loop lengths survive the round trip');

{
  // If the lengths did not travel, a shared track would realign differently
  // from the one she made — same notes, wrong music.
  const t = new Track();
  t.setBars('r3', 3);
  t.setBars('r2', 2);
  t.record('r1', 0, 0);
  t.record('r3', 0, 32);   // inside a three-bar loop
  t.accept('r1'); t.accept('r3');

  const back = decode(encode(t));
  check('each round keeps its own length',
    back.barsFor('r1') === 4 && back.barsFor('r2') === 2 && back.barsFor('r3') === 3,
    `${ROUNDS.map((r) => back.barsFor(r.id)).join(',')}`);
  check('so it meets on the same cycle she heard',
    back.compositeBars === t.compositeBars, `${back.compositeBars} bars`);
  check('and a note inside a short round survives',
    back.lanesAt('r3', 32).length === 1);

  // Sizing is by the LONGEST round, so a note near the end of the long one must
  // not be truncated by a shorter neighbour.
  const t2 = new Track();
  t2.setBars('r1', 6);
  t2.setBars('r3', 2);
  t2.record('r1', 1, 88); // late in a six-bar loop
  const b2 = decode(encode(t2));
  check('a note late in the longest round is not cut off',
    b2.lanesAt('r1', 88).length === 1, `bars ${b2.barsFor('r1')}`);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
