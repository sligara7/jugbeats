// ver:midi-file-is-well-formed — her track leaves as a file other software reads.
//
// Run:  node test/midi.mjs
//
// The point of this export is that her music enters software that takes it
// seriously (req:her-track-as-a-midi-file). A file that a DAW refuses, or that
// opens with her kick as a mystery pitch, fails at exactly the moment it was
// supposed to matter — so this parses the bytes back rather than trusting them.

import { Track, ROUNDS } from '../js/track.js';
import { encodeMidi, degreeToMidi, _internal } from '../js/midi.js';

const { PPQ, TICKS_PER_STEP, SWING_TICKS } = _internal;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------------------
// A reader, written independently of the writer. If both share a bug they share
// it deliberately, which is the only way this test says anything.
// ---------------------------------------------------------------------------

function parse(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);

  if (tag(0) !== 'MThd') throw new Error('not a MIDI file');
  const format = dv.getUint16(8);
  const ntrks = dv.getUint16(10);
  const division = dv.getUint16(12);

  const tracks = [];
  let p = 14;
  while (p < bytes.length) {
    if (tag(p) !== 'MTrk') throw new Error(`expected MTrk at ${p}, got ${tag(p)}`);
    const len = dv.getUint32(p + 4);
    tracks.push(readTrack(bytes.subarray(p + 8, p + 8 + len)));
    p += 8 + len;
  }
  return { format, ntrks, division, tracks };
}

function readTrack(b) {
  const events = [];
  let p = 0;
  let tick = 0;
  let running = null;
  let name = null;
  let tempo = null;
  let program = null;
  let ended = false;

  const vlq = () => {
    let v = 0;
    for (;;) {
      const byte = b[p++];
      v = (v << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return v;
    }
  };

  while (p < b.length) {
    tick += vlq();
    let status = b[p];
    if (status & 0x80) { p++; running = status; } else { status = running; }
    if (status === undefined) throw new Error('running status with no status byte');

    if (status === 0xff) {
      const type = b[p++];
      const len = vlq();
      const data = b.subarray(p, p + len);
      p += len;
      if (type === 0x03) name = String.fromCharCode(...data);
      if (type === 0x51) tempo = (data[0] << 16) | (data[1] << 8) | data[2];
      if (type === 0x2f) { ended = true; if (p !== b.length) throw new Error('bytes after end of track'); }
      continue;
    }

    const hi = status & 0xf0;
    const channel = status & 0x0f;
    if (hi === 0xc0) { program = b[p++]; continue; }
    if (hi === 0x90 || hi === 0x80) {
      const note = b[p++];
      const vel = b[p++];
      events.push({ tick, channel, note, on: hi === 0x90 && vel > 0 });
      continue;
    }
    throw new Error(`unexpected status 0x${status.toString(16)}`);
  }
  return { name, tempo, program, events, ended };
}

// A track with something on every round, so every code path is exercised.
function fullTrack() {
  const t = new Track({ bars: 2 });
  t.bpm = 120;
  t.record('r1', 0, 0);  t.record('r1', 1, 8);   // kick, snare
  t.record('r2', 0, 4);  t.record('r2', 1, 12);  // hat, cowbell
  t.record('r3', 0, 0);  t.record('r3', 0, 2);   // a held root on the 808
  t.record('r4', 1, 16);                          // one flat third on the melody
  for (const r of ROUNDS) t.accept(r.id);
  return t;
}

// ---------------------------------------------------------------------------

console.log('\nthe file itself');

{
  const f = parse(encodeMidi(fullTrack()));
  check('format 1, so each round is its own editable part', f.format === 1);
  check('the header track count matches the chunks that follow',
    f.ntrks === f.tracks.length, `${f.ntrks} vs ${f.tracks.length}`);
  check('division is the stated resolution', f.division === PPQ, `${f.division}`);
  check('every track ends with an end-of-track meta', f.tracks.every((t) => t.ended));
  check('one tempo map plus one track per round', f.tracks.length === 1 + ROUNDS.length,
    `${f.tracks.length}`);
}

console.log('\nher tempo');

{
  const t = fullTrack();
  t.bpm = 138;
  const f = parse(encodeMidi(t));
  const us = f.tracks[0].tempo;
  check('the tempo she tapped is the tempo in the file',
    Math.abs(60000000 / us - 138) < 0.01, `${(60000000 / us).toFixed(2)} bpm`);
}

console.log('\nthe drums read as drums');

{
  const f = parse(encodeMidi(fullTrack()));
  const beat = f.tracks.find((t) => t.name === 'Kick & Snare');
  const hats = f.tracks.find((t) => t.name === 'Hats & Cowbell');

  check('rounds are named, not numbered', !!beat && !!hats);
  check('the drums are on the General MIDI percussion channel',
    [...beat.events, ...hats.events].every((e) => e.channel === 9));

  const onNotes = (t) => [...new Set(t.events.filter((e) => e.on).map((e) => e.note))].sort((a, b) => a - b);
  // A kick reads as a kick anywhere. These four numbers are the whole reason
  // this export is worth more than a private format.
  check('kick 36 and snare 38', onNotes(beat).join(',') === '36,38', onNotes(beat).join(','));
  check('closed hat 42 and cowbell 56', onNotes(hats).join(',') === '42,56', onNotes(hats).join(','));

  const pitched = f.tracks.filter((t) => t.program !== null);
  check('the pitched rounds carry a GM patch and are not on the drum channel',
    pitched.length === 2 && pitched.every((t) => t.events.every((e) => e.channel !== 9)));
}

console.log('\nthe pitches are the ones she heard');

{
  // The 808's lanes are root, fourth, fifth, flat seventh from C2 (MIDI 36).
  check('808 root is C2', degreeToMidi(0, 0) === 36, `${degreeToMidi(0, 0)}`);
  check('808 fourth is F2', degreeToMidi(2, 0) === 41, `${degreeToMidi(2, 0)}`);
  check('808 fifth is G2', degreeToMidi(3, 0) === 43, `${degreeToMidi(3, 0)}`);
  check('808 flat seventh is A#2', degreeToMidi(4, 0) === 46, `${degreeToMidi(4, 0)}`);

  // The melody sits two octaves up, and its top lane is the octave above ITS root.
  check('melody root is C4', degreeToMidi(0, 2) === 60, `${degreeToMidi(0, 2)}`);
  check('melody flat third is D#4', degreeToMidi(1, 2) === 63, `${degreeToMidi(1, 2)}`);
  check('melody octave lane is C5', degreeToMidi(5, 2) === 72, `${degreeToMidi(5, 2)}`);
}

console.log('\nevery note is closed');

{
  const f = parse(encodeMidi(fullTrack()));
  for (const t of f.tracks) {
    if (t.events.length === 0) continue;
    const open = new Map();
    let bad = 0;
    for (const e of t.events) {
      const key = `${e.channel}:${e.note}`;
      if (e.on) open.set(key, (open.get(key) ?? 0) + 1);
      else {
        const n = open.get(key) ?? 0;
        if (n === 0) bad++; else open.set(key, n - 1);
      }
    }
    const leftOpen = [...open.values()].reduce((a, b) => a + b, 0);
    check(`${t.name}: every note-on is matched by a note-off`,
      leftOpen === 0 && bad === 0, `${leftOpen} left ringing, ${bad} orphan offs`);
  }
}

console.log('\nthe groove travels with it');

{
  const t = new Track({ bars: 1 });
  t.bpm = 100;
  // A kick on the downbeat and a snare on the "and" of beat one — the swung one.
  t.record('r1', 0, 0);
  t.record('r1', 1, 2);
  t.accept('r1');

  const f = parse(encodeMidi(t));
  const beat = f.tracks.find((t2) => t2.name === 'Kick & Snare');
  const kick = beat.events.find((e) => e.on && e.note === 36);
  const snare = beat.events.find((e) => e.on && e.note === 38);

  check('the downbeat is exactly on the grid', kick.tick === 0, `${kick.tick}`);
  check('the "and" leans late, as the player sounds it',
    snare.tick === 2 * TICKS_PER_STEP + SWING_TICKS,
    `${snare.tick} vs ${2 * TICKS_PER_STEP + SWING_TICKS}`);
  check('the lean is a real shuffle, not a rounding wobble', SWING_TICKS >= 4, `${SWING_TICKS} ticks`);
}

console.log('\npolymeter comes out as a pattern, not a slice');

{
  const t = new Track({ bars: 4 });
  t.bpm = 100;
  t.setBars('r1', 4);
  t.setBars('r3', 3);          // three against four: they meet every twelve bars
  t.record('r1', 0, 0);
  t.record('r3', 0, 0);
  t.accept('r1'); t.accept('r3');

  check('the composite length is the lowest common multiple', t.compositeBars === 12, `${t.compositeBars}`);

  const f = parse(encodeMidi(t));
  const drums = f.tracks.find((x) => x.name === 'Kick & Snare');
  const bass = f.tracks.find((x) => x.name === 'The 808');
  const ons = (x) => x.events.filter((e) => e.on).length;

  // Twelve bars holds three of the drum loop and four of the bass loop, so the
  // file loops seamlessly instead of stopping mid-pattern.
  check('the four-bar drum loop repeats three times', ons(drums) === 3, `${ons(drums)}`);
  check('the three-bar bass loop repeats four times', ons(bass) === 4, `${ons(bass)}`);
}

console.log('\nwhat is not hers is not in the file');

{
  const t = fullTrack();
  t.toggleMute('r2');
  const f = parse(encodeMidi(t));
  // Muting is a performance choice, not part of the composition
  // (dec:arrangement-breathes) — the link does not carry it and neither does this.
  check('a muted round still exports', !!f.tracks.find((x) => x.name === 'Hats & Cowbell'));

  const u = new Track({ bars: 2 });
  u.bpm = 100;
  u.record('r1', 0, 0);        // played but never accepted with STOP
  const g = parse(encodeMidi(u));
  check('a round she never kept is not in the file', g.tracks.length === 1, `${g.tracks.length} track(s)`);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
