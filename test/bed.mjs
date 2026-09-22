// The bed engine's hard edges — the ones a browser enforces and node does not.
//
// Run:  node test/bed.mjs
//
// THIS EXISTS BECAUSE THREE BEDS SHIPPED BROKEN ON THE SAME DAY. /stream/,
// /forest/ and /underwater/ each asked createBuffer for a 400 Hz envelope, on
// the correct reasoning that a curve carrying a fraction of a hertz does not
// need audio resolution. The Web Audio spec only guarantees 8000 Hz and up, so
// createBuffer threw — inside build(), before anything was connected or the page
// marked itself playing. Tapping a duration did nothing at all: no sound, no
// error on screen, nothing to see.
//
// Every one of them passed every test in this project, because nothing here
// runs Web Audio. So this file stubs the one rule that matters.

import { readFileSync, readdirSync } from 'node:fs';
import { envelopeLoop, pinkLoop, ENV_RATE } from '../js/bed.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** The browser's contract, as far as this matters: a buffer below the guaranteed
 *  minimum rate is refused. */
const MIN_RATE = 8000;
function stubCtx(sampleRate = 48000) {
  return {
    sampleRate,
    createBuffer(channels, length, rate) {
      if (rate < MIN_RATE) {
        throw new Error(`NotSupportedError: sample rate ${rate} below ${MIN_RATE}`);
      }
      const data = new Float32Array(length);
      return { length, sampleRate: rate, getChannelData: () => data };
    },
  };
}

console.log('a buffer is never asked for at an illegal rate');

{
  const ctx = stubCtx();
  let threw = null;
  try {
    envelopeLoop(ctx, 2, (t) => t, 400);
  } catch (e) { threw = e; }
  check('envelopeLoop survives being asked for 400 Hz', threw === null,
    threw ? threw.message : `clamped to at least ${ENV_RATE}`);

  const buf = envelopeLoop(ctx, 2, (t) => t, 400);
  check('and clamps up rather than silently shrinking', buf.sampleRate >= MIN_RATE,
    `${buf.sampleRate} Hz`);

  // The shape must still be right after clamping — more samples, same curve.
  const ramp = envelopeLoop(ctx, 1, (t) => t, 400);
  const d = ramp.getChannelData(0);
  check('the curve it holds is still the shape it was given',
    d[0] < 0.01 && d[d.length - 1] > 0.98, `${d[0].toFixed(3)}..${d[d.length - 1].toFixed(3)}`);
}

{
  const ctx = stubCtx();
  let ok = true;
  try { pinkLoop(ctx, 1, { rate: 12000 }); } catch (e) { ok = false; }
  check('pinkLoop at a legal rate is fine', ok);
}

console.log('\nand no bed page asks for one');

{
  // The pages are the things that actually ship, so read what they declare.
  for (const dir of readdirSync('.', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    let html;
    try { html = readFileSync(`${dir}/index.html`, 'utf8'); } catch { continue; }
    if (!html.includes('js/bed.js')) continue;
    const bad = [...html.matchAll(/(?:RATE|rate)\s*[:=]\s*(\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n < MIN_RATE);
    check(`/${dir}/ declares no rate under ${MIN_RATE}`, bad.length === 0,
      bad.length ? `found ${bad.join(', ')}` : 'clean');
  }
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
