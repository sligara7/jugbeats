// ver:palettes-do-not-cross-wires — a track knows which style it was made with.
//
// Run:  node test/palette.mjs
//
// Guards dec:styles-are-palettes and the promise iface:track-format makes.
//
// THE FAILURE THIS EXISTS TO PREVENT is not a crash. Round ids are POSITIONAL in
// the link: `r1` is whatever the first round of the current palette is. A calm
// track carries handpan and bowl in r1; decoded by a build that thinks it is
// looking at phonk, those notes come out as kick and snare. The bytes parse
// perfectly, nothing errors, and the music is wrong — which is exactly the class
// of silent-wrong-answer the version marker exists to stop.

import { Track, ROUNDS, DEFAULT_ROUNDS, setRounds } from '../js/track.js';

globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
globalThis.location ??= { href: 'https://sligara7.github.io/jugbeats/', hash: '' };

const { encode, decode, paletteIdOf, _internal } = await import('../js/link.js');
const { PHONK, CALM, PALETTES, byId, byKey } = await import('../js/palettes.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------------------

console.log('\nthe palettes themselves');

{
  const ids = PALETTES.map((p) => p.id);
  check('every palette id is unique', new Set(ids).size === ids.length, ids.join(','));
  check('phonk is id 0, so every pre-v6 link is a phonk link', PHONK.id === 0);
  check('every palette has the same number of rounds',
    PALETTES.every((p) => p.rounds.length === DEFAULT_ROUNDS.length));
  check('every palette declares a renderer for every voice it uses',
    PALETTES.every((p) => p.rounds.every((r) => r.lanes.every(
      (l) => p.pitched[l.voice] || p.kit))),
    'a lane naming a voice nothing renders would be silently silent');
  check('phonk reuses the one round list rather than restating it',
    PHONK.rounds === DEFAULT_ROUNDS);
  check('an unknown id falls back to phonk rather than throwing', byId(99) === PHONK);
  check('an unknown key falls back to phonk', byKey('nonsense') === PHONK);
}

console.log('\nthe palette travels in the link');

{
  setRounds(CALM.rounds);
  const t = new Track({ bars: 2 });
  t.bpm = 68;
  t.paletteId = CALM.id;
  t.record('r1', 0, 0);
  t.record('r1', 1, 8);
  t.accept('r1');
  const link = encode(t);

  check('the version byte says v6', _internal.decodeV6 && [...Buffer.from(
    link.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64')][0] === 6);
  check('the palette can be read without decoding', paletteIdOf(link) === CALM.id,
    `got ${paletteIdOf(link)}`);

  const back = decode(link);
  check('the decoded track remembers its palette', back.paletteId === CALM.id,
    `got ${back.paletteId}`);
  check('the notes survive', back.count('r1') === t.count('r1'));
  check('the tempo survives', back.bpm === 68);
}

console.log('\na phonk track still says phonk');

{
  setRounds(DEFAULT_ROUNDS);
  const t = new Track({ bars: 2 });
  t.record('r1', 0, 0);
  t.accept('r1');
  const link = encode(t);
  check('palette id 0 by default', paletteIdOf(link) === 0);
  check('and it round-trips', decode(link).paletteId === 0);
}

console.log('\nold links are phonk links, forever');

{
  // A frozen v5 string, written before palettes existed. Its fourth byte was
  // reserved and always zero, which is why v6 could put the palette there.
  setRounds(DEFAULT_ROUNDS);
  const v5 = (() => {
    const t = new Track({ bars: 2 });
    t.bpm = 138;
    t.record('r1', 0, 0);
    t.record('r2', 1, 4);
    t.accept('r1');
    // Build a v5 payload by hand: same bytes as v6 with version 5 and a zero
    // reserved byte. This is what a real shipped link looks like.
    const v6bytes = _internal.encodeV6(t);
    const b = Uint8Array.from(v6bytes);
    b[0] = 5;
    b[3] = 0;
    return _internal.toB64Url(b);
  })();

  const back = decode(v5);
  check('a v5 link still decodes', back !== null);
  check('it reads as phonk', paletteIdOf(v5) === 0);
  check('its notes are intact', back.count('r1') === 1 && back.count('r2') === 1);
}

console.log('\nthe rounds actually swap');

{
  setRounds(DEFAULT_ROUNDS);
  check('phonk round one is the drums', ROUNDS[0].lanes[0].voice === 'kick');
  check('and does not sustain', ROUNDS[0].sustains === false);

  setRounds(CALM.rounds);
  check('calm round one is the handpan', ROUNDS[0].lanes[0].voice === 'handpan');
  check('and DOES sustain — you hold a singing bowl', ROUNDS[0].sustains === true);

  setRounds(DEFAULT_ROUNDS);
  check('and it swaps back', ROUNDS[0].lanes[0].voice === 'kick');

  let threw = false;
  try { setRounds([{ id: 'r1' }]); } catch { threw = true; }
  check('a palette with the wrong number of rounds is refused', threw);
}

console.log('\na sent track is addressed to its own page');

{
  const { siteRoot, homeFor } = await import('../js/palettes.js');
  const site = 'https://sligara7.github.io/jugbeats/';

  for (const from of [site, site + 'beats/', site + 'ethereal/', site + '?p=calm']) {
    check(`site root from ${from.replace(site, '/') || '/'}`,
      siteRoot(from) === site, siteRoot(from));
  }

  check('a calm track goes to /ethereal/',
    homeFor(CALM, site) === site + 'ethereal/', homeFor(CALM, site));
  check('...even when made on the phonk page',
    homeFor(CALM, site + '?p=calm') === site + 'ethereal/', homeFor(CALM, site + '?p=calm'));
  check('a phonk track goes to the ROOT, where her old links live',
    homeFor(PHONK, site + 'ethereal/') === site, homeFor(PHONK, site + 'ethereal/'));

  // The whole round trip, as a share sheet would carry it.
  setRounds(CALM.rounds);
  const t = new Track({ bars: 2 });
  t.bpm = 68;
  t.paletteId = CALM.id;
  t.record('r1', 0, 0);
  t.accept('r1');
  const sent = homeFor(CALM, site + 'ethereal/') + '#' + encode(t);
  check('the sent URL names the ethereal page', sent.startsWith(site + 'ethereal/#'), sent.slice(0, 48));
  check('and still carries the palette in the link itself',
    paletteIdOf(sent.split('#')[1]) === CALM.id);
}

console.log('\nthe rhythm lock');

{
  const { onGrid, blockSteps, isLocked, quantise: q } = await import('../js/track.js');
  const { REGGAETON } = await import('../js/palettes.js');
  const dembow = REGGAETON.rounds[0].grid;

  check('reggaeton locks its first round', isLocked(dembow), dembow.join(','));
  check('it is a tresillo laid twice — 3+3+2, 3+3+2',
    dembow.join(',') === '0,3,6,8,11,14');

  // The whole reason the lock had to exist.
  check('steps 3 and 11 are NOT on the eighth grid',
    !onGrid(3, 2) && !onGrid(11, 2), 'which is why the dembow was unreachable');
  check('but they ARE on the dembow', onGrid(3, dembow) && onGrid(11, dembow));
  check('and step 4 is not', !onGrid(4, dembow));

  // Whatever she taps lands somewhere the pattern wants.
  for (let tap = 0; tap < 16; tap += 0.5) {
    const at = q(tap, dembow);
    if (!onGrid(at, dembow)) { check(`tap at ${tap} lands on the pattern`, false, `${at}`); break; }
  }
  check('every tap in a bar lands on the pattern', true, '32 positions checked');
  check('a tap past the last hit wraps into the next bar', q(15.6, dembow) === 16, `${q(15.6, dembow)}`);
  check('a spacing grid still behaves exactly as it did', q(7, 2) === 8 && q(6.4, 2) === 6);

  check('a locked round gets a readable block length', blockSteps(dembow) === 2);
  check('and a spacing round is unchanged', blockSteps(2) === 2 && blockSteps(1) === 1);

  // Only the drums. Locking the bass would turn a groove into a template.
  const locked = REGGAETON.rounds.filter((r) => isLocked(r.grid ?? 2));
  check('exactly one round is locked', locked.length === 1, locked.map((r) => r.id).join(','));
  check('and it is not a round that holds notes', locked.every((r) => !r.sustains));

  // Neither she nor a decoded link may talk it out of its rhythm.
  setRounds(REGGAETON.rounds);
  const t = new Track({ bars: 2 });
  check('the track picks the lock up from the palette', isLocked(t.gridFor('r1')));
  check('setGrid refuses to unlock it', t.setGrid('r1', 1) === false);
  check('and it is still locked afterwards', isLocked(t.gridFor('r1')));
  check('an unlocked round still toggles', t.setGrid('r2', 1) === true);

  // A tap anywhere near the beat is recorded ON the beat.
  const slot = t.record('r1', 0, 2.4);
  check('a sloppy tap is recorded on the pattern', onGrid(slot, dembow), `landed on ${slot}`);
  setRounds(DEFAULT_ROUNDS);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
