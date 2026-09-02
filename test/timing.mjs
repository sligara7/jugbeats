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
import { Track, quantise, GRID, ROUNDS } from '../js/track.js';

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

console.log('\nstopping and starting again begins cleanly');

{
  // THE BUG THIS GUARDS. Resetting the tempo stops the clock, and its step
  // counter goes back to zero. Anything else that remembered a step number was
  // then talking about a different moment — which silenced the metronome for
  // about thirty seconds, until absolute time caught up with the previous
  // attempt. The fix was to delete the thing that remembered, and the reason
  // that was safe is asserted here.
  const ctx = new FakeContext();
  const clock = new Clock(ctx, { bpm: 120, swing: 0 });

  // Subscribe BEFORE starting, the way the shell does. start() runs a tick
  // synchronously so that the first beat is committed immediately, which means
  // a listener attached afterwards misses that first window — worth knowing,
  // and the reason the shell subscribes at load and starts on a button press.
  let seen = [];
  clock.onSchedule((from, to) => { for (let s = from; s < to; s++) seen.push(s); });

  const run = () => {
    for (let i = 0; i < 60; i++) { ctx.advance(0.025); clock._tick(); }
    const got = seen;
    seen = [];
    return got;
  };

  clock.start();
  const first = run();
  clock.stop();
  clock.start();
  const second = run();

  check('the first run starts at step zero', first[0] === 0, `${first[0]}`);
  check('and so does the second, after a stop', second[0] === 0, `${second[0]}`);
  check('the second run is not skipped or shortened',
    Math.abs(second.length - first.length) <= 1, `${first.length} then ${second.length}`);
  check('every step still arrives exactly once, in order',
    second.every((s, i) => i === 0 || s === second[i - 1] + 1));

  // The property that made the extra guard unnecessary: no listener needs to
  // remember which steps it has already handled.
  check('no step is ever delivered twice', new Set(second).size === second.length);

  // And the shape of the bug itself: a high-water mark taken from the first run
  // would suppress the whole of the second, because the numbers start again.
  const highWater = Math.max(...first) + 1;
  const suppressed = second.filter((s) => s < highWater).length;
  check('a remembered step number from the first run would have silenced the second',
    suppressed === second.length,
    `${suppressed} of ${second.length} steps below the old high-water mark`);
}

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

  for (let i = 0; i < 200; i++) t.record('r1', 0, i * 0.37); // ragged taps
  const slots = t.notes('r1').map((n) => n.slot).sort((a, b) => a - b);
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
  for (const s of [0, 2, 4, 6]) t.record('r3', 0, s);   // a held 808 note
  t.record('r3', 0, 12);                                 // and a separate one
  t.record('r3', 1, 4);                                  // another lane

  const runs = t.runs('r3');
  const lane0 = runs.filter((r) => r.lane === 0).sort((a, b) => a.start - b.start);

  check('four in a row are one block, not four', lane0.length === 2, `${lane0.length} block(s)`);
  check('the held block spans all four', lane0[0]?.start === 0 && lane0[0]?.length === 8,
    `start ${lane0[0]?.start}, length ${lane0[0]?.length}`);
  check('a lone press stays one step long', lane0[1]?.length === 2);
  check('a different lane is its own block', runs.some((r) => r.lane === 1 && r.length === 2));

  check('a held block sounds only where it begins',
    t.isRunStart('r3', 0, 0) &&
    !t.isRunStart('r3', 0, 2) &&
    !t.isRunStart('r3', 0, 6) &&
    t.isRunStart('r3', 0, 12));

  // Drums: a kick is a struck object with a length of its own.
  const d = new Track({ bars: 4 });
  for (const s of [0, 2, 4, 6]) d.record('r1', 0, s);
  const kicks = d.runs('r1').filter((r) => r.lane === 0);
  check('four kicks in a row stay four kicks', kicks.length === 4, `${kicks.length} block(s)`);
  check('no drum block is ever longer than one step', kicks.every((r) => r.length === 2));
  check('every kick sounds', [0, 2, 4, 6].every((s) => d.isRunStart('r1', 0, s)));

  // A sustaining lane filled the whole way round has no gap to start after.
  // Without a special case it would be occupied everywhere and sound nowhere.
  const full = new Track({ bars: 4 });
  for (let s = 0; s < full.loopSteps; s += 2) full.record('r3', 2, s);
  const starts = [];
  for (let s = 0; s < full.loopSteps; s += 2) if (full.isRunStart('r3', 2, s)) starts.push(s);
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
    const slotFromTrack = t.record('r1', 0, at);
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

console.log('\nlayers can be different lengths, and they meet again');

{
  // dec:layers-of-different-lengths. A three-bar bass under a four-bar drum
  // part drifts apart and comes back together every twelve bars — the Kashmir
  // effect, reached with no notion of a time signature anywhere in the code.
  const t = new Track();
  check('every round starts the same length', ROUNDS.every((r) => t.barsFor(r.id) === 4));
  check('so everything meets every four bars', t.compositeBars === 4, `${t.compositeBars}`);

  t.setBars('r3', 3);
  check('a round can be made shorter', t.barsFor('r3') === 3);
  check('and the others are untouched', t.barsFor('r1') === 4 && t.barsFor('r4') === 4);
  check('three against four meet every twelve bars', t.compositeBars === 12,
    `${t.compositeBars}`);

  t.setBars('r4', 6);
  check('three, four and six meet every twelve', t.compositeBars === 12, `${t.compositeBars}`);
  t.setBars('r4', 4);

  // The wrap is per round, which is the whole mechanism.
  check('a short round wraps sooner', t.loopStepsFor('r3') === 48);
  check('a long one does not', t.loopStepsFor('r1') === 64);
  check('a note past a short round\'s end folds back into it',
    t.record('r3', 0, 50) === 2, `landed on ${t.record('r3', 1, 50)}`);
}

console.log('\nshortening a round does not destroy what is past the end');

{
  // She has to be able to try three bars, dislike it, and go back without
  // losing anything. Otherwise the control is a commitment rather than an
  // experiment, and she will not touch it.
  const t = new Track();
  for (const s of [0, 16, 32, 48]) t.record('r3', 0, s); // one note per bar
  check('four notes at four bars', t.count('r3') === 4);

  t.setBars('r3', 2);
  check('at two bars only the first half is audible', t.count('r3') === 2, `${t.count('r3')}`);
  check('and nothing past the end is drawn',
    t.runs('r3').every((r) => r.start < t.loopStepsFor('r3')));

  t.setBars('r3', 4);
  check('lengthening brings them all back, exactly', t.count('r3') === 4, `${t.count('r3')}`);
  check('on the same beats they were on',
    t.notes('r3').map((n) => n.slot).sort((a, b) => a - b).join(',') === '0,16,32,48');
}

console.log('\na held note sounds for as long as she held it');

{
  // The defect this fixes: holding a pitched key already drew ONE long block on
  // screen and made exactly the same sound as a tap, because the amplitude
  // envelope is baked into the sample. The picture lengthened; the note did not.
  const t = new Track();
  for (const s of [0, 2, 4, 6]) t.record('r3', 0, s);   // held across four steps
  t.record('r3', 1, 16);                                 // a single tap

  check('a held run reports its whole length', t.runLengthAt('r3', 0, 0) === 8,
    `${t.runLengthAt('r3', 0, 0)} steps`);
  check('a tap reports one grid step', t.runLengthAt('r3', 1, 16) === 2,
    `${t.runLengthAt('r3', 1, 16)} steps`);
  check('nothing is reported where no run begins', t.runLengthAt('r3', 0, 4) === 0);

  // A drum has a length of its own; holding one must not lengthen it.
  const d = new Track();
  for (const s of [0, 2, 4]) d.record('r1', 0, s);
  check('a drum stays one step however long she leans on it',
    d.runLengthAt('r1', 0, 0) === 2 && d.runLengthAt('r1', 0, 2) === 2);

  // And the length must survive being shortened out of range.
  const short = new Track();
  for (const s of [0, 2, 4, 6]) short.record('r3', 0, s);
  short.setBars('r3', 1);
  check('a run clipped by a shorter loop reports only what is inside it',
    short.runLengthAt('r3', 0, 0) === 8, `${short.runLengthAt('r3', 0, 0)} steps`);
}

console.log('\nquantising is symmetric');

{
  const track = new Track({ bars: 4 });
  // Slightly early and slightly late must land on the same step. Quantising
  // late-only would teach her to rush.
  check('a hair early lands on the beat', track.record('r1', 0, 7.6) === 8);
  check('a hair late lands on the same beat', track.record('r1', 1, 8.4) === 8);
  check('it wraps around the loop', track.record('r1', 2, 64.2) === 0);
  check('the same slot twice is one note', (() => {
    const t = new Track();
    t.record('r1', 0, 4); t.record('r1', 0, 4.1);
    return t.count('r1') === 1;
  })());
  check('erasing outside the loop is refused, not clamped', (() => {
    try { new Track().erase('r1', 0, 999); return false; } catch { return true; }
  })());
}

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
