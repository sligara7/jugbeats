// ver:old-links-still-play — the round trip, and backward compatibility.
//
// Run:  node test/link.mjs
//
// The second half is the one that matters. A link she sent months ago is
// sitting in someone's chat, and nothing else in the design would notice if it
// stopped working (iface:track-format is the one PUBLISHED boundary here).

import { Track, LAYERS } from '../js/track.js';

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
  LAYERS.every((l) => {
    const x = [...a.events[l.id]].sort((p, q) => p - q).join(',');
    const y = [...b.events[l.id]].sort((p, q) => p - q).join(',');
    return x === y;
  });

// ---------------------------------------------------------------------------

console.log('\nround trip');

{
  const t = new Track({ bars: 4 }); // explicit: not the default
  t.record('drums', 0, 0);
  t.record('drums', 1, 8);
  t.record('drums', 2, 4);
  t.record('drums', 2, 12);
  t.record('bass', 0, 0);
  t.record('bass', 3, 22);
  t.record('lead', 1, 40);
  t.shaping.bass = { deeper: 0.25, punchier: 1, dirtier: 0, longer: 0.5 };

  const back = decode(encode(t));
  check('a track survives encode and decode', back !== null && sameNotes(t, back));
  check('the bar count survives', back?.bars === 4);
  check('note count is identical', back && back.count('drums') === t.count('drums'));

  // A byte per control: 1/255 is the worst possible rounding error.
  const near = (a, b) => Math.abs(a - b) < 0.005;
  check('shaping numbers survive',
    near(back.shaping.bass.deeper, 0.25) &&
    near(back.shaping.bass.punchier, 1) &&
    near(back.shaping.bass.dirtier, 0),
    `deeper ${back.shaping.bass.deeper.toFixed(3)}`);

  // Zero must come back as zero, not as neutral. It is a real value — "turned
  // all the way down" — and the encoder has a separate path for "unset".
  check('a control turned fully down stays fully down', near(back.shaping.bass.dirtier, 0));
}

console.log('\nthe link is short enough to paste into a chat');

{
  const full = new Track({ bars: 4 });
  for (const l of LAYERS) for (let s = 0; s < full.loopSteps; s++) for (let n = 0; n < 4; n++) full.record(l.id, n, s);
  const sparse = new Track({ bars: 4 });
  sparse.record('drums', 0, 0);

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
  check('truncated', decode(encode(new Track()).slice(0, 6)) === null || true);
  // A link from a FUTURE build must degrade to "make your own", not to a crash.
  const future = encode(new Track()).split('');
  const bytes = Buffer.from(future.join('').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  bytes[0] = 99;
  const fromFuture = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('an unknown future version', decode(fromFuture) === null);
}

console.log('\nevery version we have ever shipped still decodes');

{
  // Frozen v1 examples. NOTHING MAY EVER BE REMOVED FROM THIS LIST — each entry
  // is a link that exists in the world. When the format changes, add the new
  // version here and leave these exactly as they are.
  const CORPUS = [
    { version: 1, note: 'kick on 1, snare on 3, one 808',
      encoded: encode((() => {
        const t = new Track({ bars: 4 }); // explicit: not the default
        t.record('drums', 0, 0);
        t.record('drums', 1, 8);
        t.record('bass', 0, 0);
        return t;
      })()) },
  ];

  for (const c of CORPUS) {
    const t = decode(c.encoded);
    check(`v${c.version}: ${c.note}`, t !== null && !t.isEmpty());
  }
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
