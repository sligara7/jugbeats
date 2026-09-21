// The stage's geometry — the arrows must not sit on the keys.
//
// Run:  node test/stage.mjs
//
// THIS EXISTS BECAUSE THE FAULT HAPPENED. The first version of the arrow strip
// put it at the same y the keys started at, so all four arrows sat on top of the
// keys her thumbs land on. Every unit test passed, the code read correctly, and
// it would have been discovered by a nine-year-old pressing a key and hearing
// the wrong thing.
//
// Geometry is the one part of a canvas interface that can be checked without a
// browser, so it is, and layoutFor is pure for that reason.

import { layoutFor } from '../js/stage.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Real landscape phones, small to large, plus a square-ish one.
const SIZES = [[667, 375], [740, 360], [844, 390], [932, 430], [1024, 500]];

console.log('the arrows sit above the keys, never on them');

for (const [w, h] of SIZES) {
  const L = layoutFor({ w, h, lanes: 4, pitched: true });
  const keyTop = Math.min(...L.keys.map((k) => k.y));
  const arrowBottom = Math.max(...L.arrows.map((a) => a.y + a.h));
  check(`${w}x${h}: a clear gap between them`, arrowBottom < keyTop,
    `${(keyTop - arrowBottom).toFixed(0)}px`);

  // Nothing may hang off the bottom of the screen.
  const keyBottom = Math.max(...L.keys.map((k) => k.y + k.h));
  check(`${w}x${h}: the keys end at the screen edge`, keyBottom <= h + 0.5,
    `${keyBottom.toFixed(0)} of ${h}`);

  // A control too small to hit is not a control. 44px is the usual floor for a
  // touch target; these are wide and shorter, so the WIDTH carries it and the
  // height is checked separately against something a thumb can still find.
  check(`${w}x${h}: the arrows are big enough to hit`,
    L.arrows.every((a) => a.w >= 90 && a.h >= 24),
    `${L.arrows[0].w.toFixed(0)}x${L.arrows[0].h.toFixed(0)}`);

  // Each arrow must sit over the group it moves, or the relationship it relies
  // on — being directly above what it controls — is not there.
  for (const thumb of [0, 1]) {
    const group = L.keys.slice(thumb * 2, thumb * 2 + 2);
    const gx = group[0].x;
    const gw = group[1].x + group[1].w - gx;
    const mine = L.arrows.filter((a) => a.thumb === thumb);
    check(`${w}x${h}: thumb ${thumb}'s arrows are over its keys`,
      mine.length === 2 && mine.every((a) => a.x >= gx - 1 && a.x + a.w <= gx + gw + 1),
      `${mine.length} arrow(s)`);
  }
}

console.log('\nand a round with nothing to pitch has none');

for (const [w, h] of SIZES) {
  const L = layoutFor({ w, h, lanes: 2, pitched: false });
  check(`${w}x${h}: the drums get no arrows`, L.arrows.length === 0, `${L.arrows.length}`);
  // And give their keys the room back rather than leaving a gap.
  const withArrows = layoutFor({ w, h, lanes: 2, pitched: true });
  check(`${w}x${h}: and a taller highway for it`, L.hitY > withArrows.hitY,
    `${L.hitY.toFixed(0)} vs ${withArrows.hitY.toFixed(0)}`);
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
