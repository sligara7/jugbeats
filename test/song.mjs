// ver:a-song-is-an-order-list — segments, an order, and a link that survives it.
//
// Run:  node test/song.mjs
//
// Guards dec:a-segment-is-a-whole-track. The owner chose the expensive shape —
// every segment is a complete recording rather than a mask over one — on the
// grounds that only that shape can give a chorus a different MELODY. These
// assertions are the parts of that promise a later change could quietly break.

import { Song } from '../js/song.js';
import { Track } from '../js/track.js';
import { encode, encodeSong, decode, decodeSong } from '../js/link.js';
import { PHONK, CALM } from '../js/palettes.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const seg = (palette, notes) => {
  const t = new Track({ palette });
  for (const [round, lane, step] of notes) { t.record(round, lane, step); t.accept(round); }
  return t;
};

console.log('\nan order list, not a list of copies');

{
  const verse = seg(PHONK, [['r1', 0, 0]]);
  const chorus = seg(PHONK, [['r1', 0, 0], ['r1', 1, 8], ['r3', 0, 0]]);
  const song = new Song({ segments: [verse, chorus], order: [0, 1, 0, 1, 2 - 1, 1] });

  check('ABABBB is two recordings, six references',
    song.segments.length === 2 && song.order.length === 6);
  check('and the song is as long as the references, not the recordings',
    song.totalSteps === song.order.reduce((n, i) => n + song.lengthOf(i), 0));
}

console.log('\nwhich segment is sounding');

{
  const a = seg(PHONK, [['r1', 0, 0]]);
  const b = seg(PHONK, [['r1', 0, 0]]);
  const song = new Song({ segments: [a, b], order: [0, 1] });
  const len = song.lengthOf(0);

  check('step 0 is the first segment, at its own beginning', song.at(0).index === 0 && song.at(0).localStep === 0);
  check('the last step of the first is still the first', song.at(len - 1).index === 0);
  check('the boundary lands on the second, at ITS beginning',
    song.at(len).index === 1 && song.at(len).localStep === 0,
    `local=${song.at(len).localStep}`);

  // THE LOCAL STEP IS THE WHOLE POINT. Each round wraps at its own length, so a
  // segment fed an absolute step would have its polymeter depend on what played
  // before it — the same segment would drift differently in different songs.
  check('the song loops, and the second time round is identical to the first',
    song.at(song.totalSteps).index === song.at(0).index
    && song.at(song.totalSteps).localStep === song.at(0).localStep);
  check('and it reads backwards without going negative', song.at(-1).index === 1);
}

console.log('\nthe link carries the arrangement');

{
  const verse = seg(PHONK, [['r1', 0, 0], ['r1', 1, 8]]);
  const chorus = seg(PHONK, [['r1', 0, 0], ['r1', 0, 4], ['r3', 0, 0]]);
  const song = new Song({ segments: [verse, chorus], order: [0, 1, 0, 1, 0] });
  const back = decodeSong(encodeSong(song), PHONK);

  check('the segments come back', back.segments.length === 2);
  check('the order comes back', back.order.join('') === '01010');
  check('and each segment keeps its own notes',
    back.segments[0].count('r1') === 2
    && back.segments[1].count('r1') === 2 && back.segments[1].count('r3') === 1,
    `${back.segments[0].count('r1')} / ${back.segments[1].count('r1')} / ${back.segments[1].count('r3')}`);
  check('a chorus really can differ from its verse, which is why this shape was chosen',
    back.segments[0].count('r3') === 0 && back.segments[1].count('r3') === 1);
}

console.log('\nnobody pays for a feature they do not use');

{
  const only = seg(PHONK, [['r1', 0, 0]]);
  check('a song of one encodes byte-identically to a plain track',
    encodeSong(Song.of(only)) === encode(only));

  // EVERY LINK ALREADY SENT IS v1..v7 AND MUST STILL OPEN. The song codec has to
  // read them as what they always were: one segment, played once.
  const old = encode(only);
  const asSong = decodeSong(old, PHONK);
  check('an old link opens as a song of one', asSong && asSong.isSingle === true);
  check('with its notes intact', asSong.segments[0].count('r1') === 1);
  check('and the plain decoder is untouched by any of this',
    decode(old, PHONK)?.count('r1') === 1);
}

console.log('\nit does not fall over');

{
  const one = seg(PHONK, [['r1', 0, 0]]);
  const song = new Song({ segments: [one], order: [0, 5, 0] });
  const back = decodeSong(encodeSong(song), PHONK);
  check('an order naming a segment that is not there drops that slot, rather than playing silence',
    back.order.every((i) => i < back.segments.length), back.order.join(','));

  check('an empty song answers nothing rather than a fake segment',
    new Song().at(0) === null);
  check('rubbish decodes to nothing rather than throwing', decodeSong('!!!!', PHONK) === null);

  // A song made in one palette must not be read with another's rounds.
  const two = new Song({ segments: [seg(CALM, [['r1', 0, 0]]), seg(CALM, [['r2', 0, 0]])], order: [0, 1] });
  const backCalm = decodeSong(encodeSong(two), CALM);
  check('a two-segment calm song survives its own palette',
    backCalm.segments.length === 2 && backCalm.segments[1].count('r2') === 1);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\\n`);
process.exit(failures === 0 ? 0 : 1);
