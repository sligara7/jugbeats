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
import { Track, quantise, GRID } from '../js/track.js';

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
  const clock = new Clock(ctx, { bpm: 138 }); // whatever the shipping default is
  clock.start();
  const stepSec = clock.stepSeconds;

  const beat = clock.timeOf(4) - clock.timeOf(0);
  const toTheAnd = clock.timeOf(2) - clock.timeOf(0);
  check('the beats themselves stay exactly on the grid',
    Math.abs(beat - 4 * stepSec) < 1e-12);
  // Asserted against the clock's own swing rather than a copy of the number,
  // so retuning the feel can never silently break this.
  check('the "and" of the beat leans late',
    Math.abs(toTheAnd - stepSec * (2 + clock.swing)) < 1e-12 && clock.swing > 0.2,
    `${(toTheAnd / stepSec).toFixed(3)} steps, swing ${clock.swing}`);

  // The bug this guards: swing used to sit on the odd sixteenths. The moment
  // notes were quantised to eighths every note landed on an unswung step, and
  // the groove vanished with nothing failing.
  const playable = [0, 2, 4, 6, 8, 10, 12, 14];
  const swungCount = playable.filter(
    (s) => Math.abs(clock.timeOf(s) - (clock.timeOf(0) + s * stepSec)) > 1e-9
  ).length;
  check('swing is audible on the grid she can actually play',
    swungCount === 4, `${swungCount} of 8 eighths swung`);

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

console.log('\nnothing she records can be too fast to play');

{
  // The bug the owner found by playing it: at 138bpm two adjacent sixteenths are
  // 108ms apart, and blocks arriving that close are impossible for a child to
  // hit. Quantising to eighths makes the tightest possible spacing ~217ms.
  const t = new Track({ bars: 4 });
  const stepMs = (60 / 138 / 4) * 1000;

  for (let i = 0; i < 200; i++) t.record('drums', 0, i * 0.37); // ragged taps
  const slots = t.notes('drums').map((n) => n.slot).sort((a, b) => a - b);
  const closest = slots.slice(1).reduce((m, s, i) => Math.min(m, s - slots[i]), Infinity);

  check('no two notes in a lane land closer than an eighth', closest >= 2,
    `closest ${closest} steps = ${(closest * stepMs).toFixed(0)}ms`);
  check('the tightest gap is playable by a child', closest * stepMs > 180,
    `${(closest * stepMs).toFixed(0)}ms apart`);
  check('every note sits on the eighth grid', slots.every((s) => s % 2 === 0));
}

console.log('\nnotes you can hold become one block; drums never do');

{
  // The owner's finding from the screenshot: runs of notes read as several
  // things to hit. On a layer with sustain they are one block, pressed once and
  // held. On drums they are not — you do not hold a drum.
  const t = new Track({ bars: 4 });
  for (const s of [0, 2, 4, 6]) t.record('bass', 0, s);   // a held 808 note
  t.record('bass', 0, 12);                                 // and a separate one
  t.record('bass', 1, 4);                                  // another lane

  const runs = t.runs('bass');
  const lane0 = runs.filter((r) => r.lane === 0).sort((a, b) => a.start - b.start);

  check('four in a row are one block, not four', lane0.length === 2, `${lane0.length} block(s)`);
  check('the held block spans all four', lane0[0]?.start === 0 && lane0[0]?.length === 8,
    `start ${lane0[0]?.start}, length ${lane0[0]?.length}`);
  check('a lone press stays one step long', lane0[1]?.length === 2);
  check('a different lane is its own block', runs.some((r) => r.lane === 1 && r.length === 2));

  check('a held block sounds only where it begins',
    t.isRunStart('bass', 0, 0) &&
    !t.isRunStart('bass', 0, 2) &&
    !t.isRunStart('bass', 0, 6) &&
    t.isRunStart('bass', 0, 12));

  // Drums: a kick is a struck object with a length of its own.
  const d = new Track({ bars: 4 });
  for (const s of [0, 2, 4, 6]) d.record('drums', 0, s);
  const kicks = d.runs('drums').filter((r) => r.lane === 0);
  check('four kicks in a row stay four kicks', kicks.length === 4, `${kicks.length} block(s)`);
  check('no drum block is ever longer than one step', kicks.every((r) => r.length === 2));
  check('every kick sounds', [0, 2, 4, 6].every((s) => d.isRunStart('drums', 0, s)));

  // A sustaining lane filled the whole way round has no gap to start after.
  // Without a special case it would be occupied everywhere and sound nowhere.
  const full = new Track({ bars: 4 });
  for (let s = 0; s < full.loopSteps; s += 2) full.record('bass', 2, s);
  const starts = [];
  for (let s = 0; s < full.loopSteps; s += 2) if (full.isRunStart('bass', 2, s)) starts.push(s);
  check('a lane held all the way round still sounds, once', starts.length === 1 && starts[0] === 0,
    `${starts.length} start(s)`);
}

console.log('\na tap sounds once, never twice');

{
  // THE BUG THAT SHIPPED. The shell suppresses the scheduled copy of a note she
  // has just played live, keyed by the step the note lands on. It computed that
  // step with its own rounding — nearest sixteenth — while the track used
  // nearest eighth. Where they disagreed the guard missed and the note sounded a
  // second time about a tenth of a beat later. Every other tap, across four
  // lanes: a room full of slot machines.
  const t = new Track({ bars: 2 });
  let disagreements = 0;

  for (let i = 0; i < 4000; i++) {
    const at = (i * 0.017) % (t.loopSteps * 2);
    const slotFromTrack = t.record('drums', 0, at);
    const slotFromGuard = ((quantise(at) % t.loopSteps) + t.loopSteps) % t.loopSteps;
    if (slotFromTrack !== slotFromGuard) disagreements++;
  }

  check('the guard and the track agree on every position', disagreements === 0,
    `${disagreements} of 4000 would have doubled`);

  // The old rounding, kept as the thing that must stay broken-if-reintroduced.
  let oldWayDisagreements = 0;
  for (let i = 0; i < 4000; i++) {
    const at = (i * 0.017) % (t.loopSteps * 2);
    if (Math.round(at) !== quantise(at)) oldWayDisagreements++;
  }
  check('the old rounding really did disagree, so this test has teeth',
    oldWayDisagreements > 0, `${oldWayDisagreements} of 4000`);

  check('quantise always lands on the playable grid',
    Array.from({ length: 500 }, (_, i) => quantise(i * 0.13)).every((s) => s % GRID === 0));
}

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
