// The palettes (dec:styles-are-palettes) — a style, as data.
//
// The owner's destination is N styles on one engine: phonk for his daughter,
// ethereal for himself, a haunting one for Halloween, and others. What separates
// them turns out to be entirely data — which voices exist, which two arrive in
// which round, the tempo, the swing, the room, how long a note takes to speak.
// None of it is control flow, so none of it belongs in an `if`.
//
// A PALETTE ID IS PART OF THE PUBLISHED FORMAT. Round ids are positional in the
// link (iface:track-format), so a track made in one palette and decoded in
// another would play her drums as bells. The id therefore travels inside the
// link, and every id here is permanent: NEVER REUSE A NUMBER, for the same
// reason a format version is never reused.

import { render808, renderLead, renderPad, ROOT_HZ, MINOR_PENTATONIC, WHOLE_TONE } from './dsp.js';
import { DEFAULT_ROUNDS } from './track.js';
import {
  renderPadVoice, renderBreath, renderIdiophone, CALM as CALM_FEEL, impulseResponse,
} from './ethereal.js';
import {
  renderGlassHarmonica, renderWail, renderDread, renderKnock,
  renderHauntedIdiophone, HAUNTED as HAUNTED_FEEL,
} from './haunted.js';

/** Where the lead sits relative to the bass — two octaves up, out of its way. */
const LEAD_OCTAVES = 2;

// ---------------------------------------------------------------------------
// Phonk — what she already has. The default, and id 0 forever.
// ---------------------------------------------------------------------------

export const PHONK = {
  id: 0,
  key: 'phonk',
  /**
   * WHERE A TRACK IN THIS STYLE LIVES, relative to the site root.
   *
   * Phonk's home is the ROOT and always will be, not `/beats/`: every link she
   * has already sent is `/jugbeats/#...` and those have to keep working.
   */
  home: '',
  name: 'JugBeats',
  tagline: 'Turn your phone sideways, tap the blocks, make a phonk beat.',

  bpm: 138,
  swing: 0.32,
  room: null,           // no reverb: the phonk kit is dry and close on purpose
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * The rounds she has always had. Taken from track.js rather than restated
   * here, so there is exactly one copy of the phonk round list in the project.
   */
  rounds: DEFAULT_ROUNDS,

  /**
   * Drums come from the baked kit.
   *
   * Relative to THIS MODULE rather than to the page, because a palette can be
   * served from a subdirectory — /jugbeats/ethereal/ — and a page-relative path
   * would look for the kit underneath it and find nothing.
   */
  kit: new URL('../kit/manifest.json', import.meta.url).pathname,
  pitched: {
    bass: { render: (sr, hz, s, o) => render808(sr, hz, s, o), octaves: 0 },
    lead: { render: (sr, hz, s, o) => renderLead(sr, hz, s, o), octaves: LEAD_OCTAVES },
  },
  drone: (sr) => renderPad(sr, {}),
};

// ---------------------------------------------------------------------------
// Calm — the ethereal one (dec:ethereal-not-a-sleep-lab). Id 1 forever.
// ---------------------------------------------------------------------------

export const CALM = {
  id: 1,
  key: 'calm',
  home: 'ethereal/',
  name: 'JugCalm',
  tagline: 'Turn your phone sideways, tap the blocks, make something peaceful.',

  bpm: CALM_FEEL.bpm,      // 68
  swing: CALM_FEEL.swing,  // 0 — syncopation is the thing this idiom avoids
  room: CALM_FEEL.room,
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * The same four rounds, doing the same jobs, with the instruments the owner
   * chose. Handpan first because it is the one that carries a piece on its own —
   * its overtones are tuned to an octave and a twelfth, so it agrees with itself.
   *
   * SUSTAINS IS TRUE ON EVERY ROUND HERE, and that is the collision the design
   * predicted: you do not hold a drum, but you DO hold a singing bowl. Sustain
   * is a property of the instrument, and in this palette every instrument rings.
   */
  rounds: [
    {
      id: 'r1', label: 'Pan', full: 'Handpan & Bowl', sustains: true, click: true,
      lanes: [
        { voice: 'handpan', degree: 0, name: 'PAN' },
        { voice: 'bowl', degree: 0, name: 'BOWL' },
      ],
    },
    {
      id: 'r2', label: 'Bells', full: 'Vibes & Crotales', sustains: true, click: false,
      lanes: [
        { voice: 'vibes', degree: 0, name: 'VIBES' },
        { voice: 'crotale', degree: 3, name: 'SHINE' },
      ],
    },
    {
      id: 'r3', label: 'Pad', full: 'The Pad', sustains: true, click: false,
      lanes: [
        { voice: 'pad', degree: 0, name: 'ROOT' },
        { voice: 'pad', degree: 2, name: '4th' },
        { voice: 'pad', degree: 3, name: '5th' },
        { voice: 'pad', degree: 4, name: '♭7' },
      ],
    },
    {
      id: 'r4', label: 'Voice', full: 'The Voice', sustains: true, click: false,
      lanes: [
        { voice: 'breath', degree: 0, name: 'ROOT' },
        { voice: 'breath', degree: 1, name: '♭3' },
        { voice: 'breath', degree: 3, name: '5th' },
        { voice: 'breath', degree: 5, name: '8ve' },
      ],
    },
  ],

  // No baked kit: everything in this palette is pitched and rendered at load.
  kit: null,

  /**
   * `sampleRate` — RENDERED AT HALF RATE, DELIBERATELY. Measured: the highest
   * frequency any of these voices can produce at its top note is the
   * vibraphone's eighteenth partial at 8.4 kHz, and Nyquist at 22050 is 11 kHz.
   * So 22050 is transparent here and halves both the render time and the
   * memory. The same trade the drum kit already makes, for the same reason —
   * Web Audio resamples on playback.
   *
   * `attack` — how long the voice takes to speak, so js/voices.js can skip
   * rendering lengths shorter than it. A pad that swells over 0.7s rendered as
   * a 0.25s note is a buffer that costs time to make and then makes no sound.
   */
  pitched: {
    handpan: { render: (sr, hz, s, o) => renderIdiophone(sr, hz, 'handpan', s, o), octaves: 1, sampleRate: 22050, attack: 0.004 },
    bowl: { render: (sr, hz, s, o) => renderIdiophone(sr, hz, 'bowl', s, o), octaves: 0, sampleRate: 22050, attack: 1.0 },
    vibes: { render: (sr, hz, s, o) => renderIdiophone(sr, hz, 'vibes', s, o), octaves: 2, sampleRate: 22050, attack: 0.003 },
    crotale: { render: (sr, hz, s, o) => renderIdiophone(sr, hz, 'crotale', s, o), octaves: 3, sampleRate: 22050, attack: 0.002 },
    pad: { render: (sr, hz, s, o) => renderPadVoice(sr, hz, s, o), octaves: 1, sampleRate: 22050, attack: 0.7 },
    breath: { render: (sr, hz, s, o) => renderBreath(sr, hz, s, o), octaves: 2, sampleRate: 22050, attack: 0.6 },
  },
  // The drone is the pad voice held long, on the root, voiced up so a phone can
  // reproduce it (dec:drone-voiced-up).
  drone: (sr) => renderPadVoice(sr, ROOT_HZ * 4, {}, { seconds: 8 }),
  impulse: (sr) => impulseResponse(sr, { seconds: 3.5, ...CALM_FEEL.room }),
};

// ---------------------------------------------------------------------------
// Haunted — for Halloween (dec:idea-haunting-palette). Id 2 forever.
// ---------------------------------------------------------------------------

export const HAUNTED = {
  id: 2,
  key: 'haunted',
  home: 'haunted/',
  name: 'JugHaunt',
  tagline: 'Turn your phone sideways, tap the blocks, make something that is not quite right.',

  bpm: HAUNTED_FEEL.bpm,     // 76 — slow enough that each sound is heard alone
  swing: HAUNTED_FEEL.swing, // 0
  room: HAUNTED_FEEL.room,   // large, and COLD: barely damped, so the tail stays bright

  /**
   * WHOLE TONE, AND IT IS THE ONE THING THAT DID NOT INVERT CHEAPLY.
   *
   * The pentatonic exists so that no two notes she can reach can clash, and it
   * excludes the tritone specifically. This palette WANTS the tritone — that is
   * most of what "haunting" means harmonically.
   *
   * Whole tone is the way through: six notes, every step the same size, so there
   * is no leading tone and nothing resolves anywhere. It contains the tritone
   * and contains NO semitone, which means the half of the promise that protects
   * her — nothing grinds, nothing sounds like a mistake — is kept, while the
   * half that reassures is deliberately given up. It is also, historically, the
   * sound of dreams and ghosts, so it is doing the work honestly.
   */
  scale: WHOLE_TONE,
  scaleName: 'whole tone',

  /**
   * SIX LANES OF SCALE BUT STILL FOUR PER ROUND, because the thumbs did not get
   * bigger. Degrees 0, 2, 3 and 5 spread the six notes out and put a tritone
   * under one thumb, which is the interval the palette is built on.
   */
  rounds: [
    {
      id: 'r1', label: 'Knock', full: 'Knock & Clang', sustains: false, click: true,
      lanes: [
        { voice: 'knock', degree: 0, name: 'KNOCK' },
        { voice: 'clang', degree: 0, name: 'CLANG' },
      ],
    },
    {
      id: 'r2', label: 'Box', full: 'Music Box & Bell', sustains: true, click: false,
      lanes: [
        { voice: 'musicbox', degree: 0, name: 'BOX' },
        { voice: 'tollbell', degree: 3, name: 'BELL' },
      ],
    },
    {
      id: 'r3', label: 'Dread', full: 'The Dread', sustains: true, click: false,
      lanes: [
        { voice: 'dread', degree: 0, name: 'ROOT' },
        { voice: 'dread', degree: 2, name: '3rd' },
        { voice: 'dread', degree: 3, name: '♭5' },
        { voice: 'dread', degree: 5, name: '♭7' },
      ],
    },
    {
      id: 'r4', label: 'Voice', full: 'Glass & Voice', sustains: true, click: false,
      lanes: [
        { voice: 'glass', degree: 0, name: 'GLASS' },
        { voice: 'glass', degree: 3, name: '♭5' },
        { voice: 'wail', degree: 2, name: 'WAIL' },
        { voice: 'shard', degree: 5, name: 'SHARD' },
      ],
    },
  ],

  kit: null,
  pitched: {
    knock: { render: (sr, hz, s, o) => renderKnock(sr, s, o), octaves: 0, sampleRate: 22050, attack: 0.002 },
    clang: { render: (sr, hz, s, o) => renderHauntedIdiophone(sr, hz, 'clang', s, o), octaves: 1, sampleRate: 22050, attack: 0.001 },
    musicbox: { render: (sr, hz, s, o) => renderHauntedIdiophone(sr, hz, 'musicbox', s, o), octaves: 3, sampleRate: 22050, attack: 0.002 },
    tollbell: { render: (sr, hz, s, o) => renderHauntedIdiophone(sr, hz, 'tollbell', s, o), octaves: 1, sampleRate: 22050, attack: 0.005 },
    shard: { render: (sr, hz, s, o) => renderHauntedIdiophone(sr, hz, 'shard', s, o), octaves: 3, sampleRate: 22050, attack: 0.001 },
    dread: { render: (sr, hz, s, o) => renderDread(sr, hz, s, o), octaves: 1, sampleRate: 22050, attack: 1.1 },
    glass: { render: (sr, hz, s, o) => renderGlassHarmonica(sr, hz, s, o), octaves: 2, sampleRate: 22050, attack: 0.95 },
    wail: { render: (sr, hz, s, o) => renderWail(sr, hz, s, o), octaves: 3, sampleRate: 22050, attack: 0.5 },
  },
  drone: (sr) => renderDread(sr, ROOT_HZ * 4, {}, { seconds: 8 }),
  impulse: (sr) => impulseResponse(sr, { seconds: 4.5, ...HAUNTED_FEEL.room }),
};

// ---------------------------------------------------------------------------
// Reggaetón — the first palette whose identity is a RHYTHM. Id 3 forever.
// ---------------------------------------------------------------------------

/**
 * THE DEMBOW, as positions in a sixteen-step bar.
 *
 * A tresillo — 3+3+2 — laid twice across the bar: 0, 3, 6, 8, 11, 14. It is the
 * one pattern the whole genre is built on, and STEPS 3 AND 11 ARE NOT ON THE
 * EIGHTH GRID, which is why the beat was literally unreachable in this game
 * until the grid learned to be a list of positions rather than a spacing.
 */
const DEMBOW = [0, 3, 6, 8, 11, 14];

export const REGGAETON = {
  id: 3,
  key: 'reggaeton',
  home: 'reggaeton/',
  name: 'JugDembow',
  tagline: 'Turn your phone sideways, tap the blocks, and you cannot miss the beat.',

  bpm: 96,          // the genre sits around 88-100
  swing: 0,         // dead straight; phonk's shuffle would be badly wrong here
  room: null,       // close and dry, like the records
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * THE FIRST PALETTE TO LOCK A RHYTHM, and it is the scale lock's idea applied
   * to time (dec:idea-reggaeton-palette).
   *
   * Reggaetón is a RHYTHM identity rather than a sound identity: phonk is
   * whatever she plays played with those sounds, but there is only one dembow
   * and everyone plays it. Left free, a nine-year-old would miss it and missing
   * it produces "not reggaetón" rather than her own take on it.
   *
   * So round one's grid IS the dembow. Whatever she taps lands where the pattern
   * wants, and she cannot play a wrong beat — the same promise the pentatonic
   * makes about notes, kept the same way: by not offering the wrong answer.
   *
   * ONLY THE DRUMS ARE LOCKED. The hats stay on eighths so she can choose a
   * straight or sparse pattern, and the bass and melody are free, because
   * reggaetón basslines are syncopated in their own way and locking them would
   * turn a groove into a template.
   */
  rounds: [
    {
      id: 'r1', label: 'Dembow', full: 'Kick & Snare', sustains: false, click: true,
      grid: DEMBOW, gridName: 'dembow',
      lanes: [{ voice: 'kick', name: 'KICK' }, { voice: 'snare', name: 'SNARE' }],
    },
    {
      id: 'r2', label: 'Hats', full: 'Hats & Clap', sustains: false, click: false,
      lanes: [{ voice: 'hat', name: 'HAT' }, { voice: 'clap', name: 'CLAP' }],
    },
    {
      id: 'r3', label: 'Bass', full: 'The Bass', sustains: true, click: false,
      lanes: [
        { voice: 'bass', degree: 0, name: 'ROOT' },
        { voice: 'bass', degree: 2, name: '4th' },
        { voice: 'bass', degree: 3, name: '5th' },
        { voice: 'bass', degree: 4, name: '♭7' },
      ],
    },
    {
      id: 'r4', label: 'Melody', full: 'The Melody', sustains: true, click: false,
      lanes: [
        { voice: 'lead', degree: 0, name: 'ROOT' },
        { voice: 'lead', degree: 1, name: '♭3' },
        { voice: 'lead', degree: 3, name: '5th' },
        { voice: 'lead', degree: 5, name: '8ve' },
      ],
    },
  ],

  /**
   * IT REUSES THE BAKED KIT AND THE PITCHED VOICES SHE ALREADY HAS, which makes
   * this the cheapest palette in the project by a distance — the owner's
   * instinct that reggaetón would be straightforward, and correct as far as the
   * SOUNDS go. Everything that makes it a different genre is in the table above:
   * the tempo, the absence of swing, and the lock.
   *
   * A dedicated kit would be better — these drums are voiced for phonk and want
   * to be drier and rounder here — and that is a row of work, not a rewrite.
   */
  kit: new URL('../kit/manifest.json', import.meta.url).pathname,
  pitched: {
    bass: { render: (sr, hz, s, o) => render808(sr, hz, s, o), octaves: 0 },
    lead: { render: (sr, hz, s, o) => renderLead(sr, hz, s, o), octaves: LEAD_OCTAVES },
  },
  drone: (sr) => renderPad(sr, {}),
};

// ---------------------------------------------------------------------------

export const PALETTES = [PHONK, CALM, HAUNTED, REGGAETON];

/** By permanent id, for the link. Unknown ids fall back to phonk rather than
 *  failing — a link from a future build should degrade, never break. */
export const byId = (id) => PALETTES.find((p) => p.id === id) ?? PHONK;

/** By url key, for `?p=calm`. */
export const byKey = (key) => PALETTES.find((p) => p.key === key) ?? PHONK;

/** Which palette the page was asked for. */
export function paletteFromLocation(search = location.search) {
  return byKey(new URLSearchParams(search).get('p') || 'phonk');
}

/** Every directory a palette can live in, longest first so stripping is greedy. */
const HOMES = PALETTES.map((p) => p.home).filter(Boolean).sort((a, b) => b.length - a.length);

/**
 * The site root, whichever palette's page you are standing on.
 *
 * `/jugbeats/ethereal/` and `/jugbeats/` both answer `/jugbeats/`, which is what
 * lets a link be addressed to the palette it belongs to rather than to the page
 * that happened to make it.
 */
export function siteRoot(href = location.href) {
  const u = new URL(href);
  u.hash = '';
  u.search = '';
  for (const home of [...HOMES, 'beats/']) {
    if (u.pathname.endsWith('/' + home)) {
      u.pathname = u.pathname.slice(0, -home.length);
      break;
    }
  }
  return u.toString();
}

/**
 * WHERE A TRACK OF THIS STYLE SHOULD BE SENT.
 *
 * A calm track always shares as `.../ethereal/`, even if it was made at
 * `/?p=calm` or anywhere else. The palette byte inside the link already makes it
 * PLAY correctly wherever it lands, but the owner's ask was that it also ARRIVE
 * in the right place — and a link that names its own home is one that survives a
 * share sheet or a chat app doing something unhelpful to the fragment.
 */
export function homeFor(palette, href = location.href) {
  return new URL(palette.home, siteRoot(href)).toString();
}
