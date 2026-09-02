// ver:no-timing-drift — the beat does not drift.
//
// Exists to catch the failure that would kill this quietly: everything works,
// it just feels slightly off, and nobody can say why. Guards dec:one-clock and
// dec:built-for-tight-timing.
//
// Run:  node test/timing.mjs
//
// The clock is driven by an AudioContext's currentTime, so a fake context lets
// us run two minutes of music in milliseconds AND simulate the thing that
// actually breaks schedulers in the wild: a wake-up that arrives late.

import { Clock, STEPS_PER_BAR } from '../js/clock.js';
import { Track } from '../js/track.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A clock we drive by hand. */
class FakeContext {
  constructor() { this.currentTime = 0; }
  advance(seconds) { this.currentTime += seconds; }
}

// ---------------------------------------------------------------------------

console.log('\nthe beat does not drift');

{
  const ctx = new FakeContext();
  const clock = new Clock(ctx, { bpm: 138, swing: 0 });
  clock.start();

  // Two minutes, stepped in irregular chunks with occasional long stalls —
  // a garbage collection, a rotation, a notification sliding in.
  const MINUTES = 2;
  const scheduled = [];
  clock.onSchedule((from, to, timeOf) => {
    for (let s = from; s < to; s++) scheduled.push({ step: s, time: timeOf(s) });
  });

  let elapsed = 0;
  let n = 0;
  while (elapsed < MINUTES * 60) {
    const stall = n % 37 === 0 ? 0.09 : 0.025; // ~90ms hiccup every ~37 ticks
    ctx.advance(stall);
    elapsed += stall;
    clock._tick();
    n++;
  }

  // Every step must be committed exactly once, in order, with no gaps. A gap is
  // a dropped note; a repeat is a flam.
  let ordered = true;
  let gaps = 0;
  for (let i = 1; i < scheduled.length; i++) {
    if (scheduled[i].step !== scheduled[i - 1].step + 1) { ordered = false; gaps++; }
  }
  check('every sixteenth scheduled exactly once, in order', ordered, gaps ? `${gaps} gap(s)` : '');

  // The time given for step N must be exactly N steps after step 0. This is the
  // drift test proper: accumulated error would show here and nowhere else.
  const stepSec = 60 / 138 / 4;
  let worst = 0;
  for (const { step, time } of scheduled) {
    worst = Math.max(worst, Math.abs(time - (scheduled[0].time + (step - scheduled[0].step) * stepSec)));
  }
  check('no accumulated drift over 2 minutes', worst < 1e-9, `worst ${(worst * 1000).toFixed(6)}ms`);

  // Nothing may be committed after the moment it should sound.
  const lateAt = [];
  {
    const c2 = new FakeContext();
    const k2 = new Clock(c2, { bpm: 138, swing: 0.16 });
    k2.start();
    k2.onSchedule((from, to, timeOf) => {
      for (let s = from; s < to; s++) if (timeOf(s) < c2.currentTime) lateAt.push(s);
    });
    for (let i = 0; i < 2000; i++) {
      c2.advance(i % 37 === 0 ? 0.09 : 0.025);
      k2._tick();
    }
  }
  check('no note is ever committed after its own time', lateAt.length === 0, `${lateAt.length} late`);

  check('two minutes is the right number of sixteenths',
    Math.abs(scheduled.length - (MINUTES * 60) / stepSec) < 12,
    `${scheduled.length} steps`);
}

// ---------------------------------------------------------------------------

console.log('\nswing lands where it should');

{
  const ctx = new FakeContext();
  const clock = new Clock(ctx, { bpm: 138, swing: 0.16 });
  clock.start();
  const stepSec = clock.stepSeconds;

  const even = clock.timeOf(4) - clock.timeOf(0);
  const odd = clock.timeOf(5) - clock.timeOf(4);
  check('on-beats stay exactly on the grid', Math.abs(even - 4 * stepSec) < 1e-12);
  check('off-beats lean late by the swing amount',
    Math.abs(odd - stepSec * 1.16) < 1e-12, `${(odd / stepSec).toFixed(3)} steps`);

  // Fractional positions must interpolate rather than snapping, or the highway
  // stutters between steps.
  const mid = clock.timeOf(4.5);
  check('a fractional step interpolates', mid > clock.timeOf(4) && mid < clock.timeOf(5));
}

// ---------------------------------------------------------------------------

console.log('\nnot-running is not the same as at-the-beginning');

{
  const clock = new Clock(new FakeContext());
  check('position is null before the first tap', clock.now() === null && clock.position() === null);
  check('timeOf is null before the first tap', clock.timeOf(0) === null);
  clock.start();
  check('position is a number once started', typeof clock.now() === 'number');
}

// ---------------------------------------------------------------------------

console.log('\nquantising is symmetric');

{
  const track = new Track({ bars: 4 });
  // Slightly early and slightly late must land on the same step. Quantising
  // late-only would teach her to rush.
  check('a hair early lands on the beat', track.record('drums', 0, 7.6) === 8);
  check('a hair late lands on the same beat', track.record('drums', 1, 8.4) === 8);
  check('it wraps around the loop', track.record('drums', 2, 64.2) === 0);
  check('the same slot twice is one note', (() => {
    const t = new Track();
    t.record('drums', 0, 4); t.record('drums', 0, 4.1);
    return t.count('drums') === 1;
  })());
  check('erasing outside the loop is refused, not clamped', (() => {
    try { new Track().erase('drums', 0, 999); return false; } catch { return true; }
  })());
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
