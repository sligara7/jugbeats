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
import {
  renderString, renderBongo, renderGuira, BACHATA as BACHATA_FEEL,
} from './bachata.js';
import {
  renderFeltPiano, renderChoir, renderRiff, renderRitualKick, renderRitualSnare,
  renderRitualGhost, renderRitualHat, RITUAL as RITUAL_FEEL,
} from './ritual.js';

/** Where the lead sits relative to the bass — two octaves up, out of its way. */
const LEAD_OCTAVES = 2;

// ---------------------------------------------------------------------------
// Phonk — what she already has. The default, and id 0 forever.
// ---------------------------------------------------------------------------

export const PHONK = {
  id: 0,
  key: 'phonk',
  blurb: 'Kick, snare, hats and an 808. Dark and shuffled.',
  accent: '#ff3d7f',
  /**
   * WHERE A TRACK IN THIS STYLE LIVES, relative to the site root.
   *
   * Phonk moved from the root to `/beats/` when the root became an index of all
   * the styles. Every link she has already sent is `/jugbeats/#...`, and those
   * still work: the index reads the palette out of the hash before it renders
   * anything and forwards to the right page, hash intact.
   */
  home: 'beats/',
  name: 'JugBeats',
  tagline: 'Turn your phone sideways, tap the blocks, make a phonk beat.',

  bpm: 138,
  swing: 0.32,
  room: null,           // no reverb: the phonk kit is dry and close on purpose
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * THE CHORDS SHE CAN STEP THROUGH, as semitone offsets from home.
   *
   * i, ♭VI, ♭VII, ♭III — about as phonk as four chords get, and every one of
   * them diatonic to the natural minor the pentatonic is cut from.
   *
   * CHORD 0 IS 0 AND MUST STAY 0. Every link already sent carries four zero
   * bytes for its chords, so index 0 is what an existing track decodes to. A
   * progression that did not start at home would transpose beats she has
   * already shared, which is the exact failure dec:idea-drop-the-auto-progression
   * was written about.
   *
   * Nothing moves on its own. She chooses, bar by bar, and the loop coming
   * round is the audition.
   */
  progression: [0, 8, 10, 3],
  chordNames: ['i', '♭VI', '♭VII', '♭III'],

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
    // THE 808 STATES THE CHORD AND THE LEAD DOES NOT, which is the arrangement
    // bachata already proved: the bass carries the harmony, the pentatonic lead
    // floats over all four unchanged. Transposing the lead too would hand each
    // chord its own parallel pentatonic and wander out of the key.
    bass: { render: (sr, hz, s, o) => render808(sr, hz, s, o), octaves: 0, transposes: true },
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
  blurb: 'Handpan, singing bowls and a wordless voice, in a big room.',
  accent: '#7fd4ff',
  home: 'ethereal/',
  name: 'JugCalm',
  tagline: 'Turn your phone sideways, tap the blocks, make something peaceful.',

  bpm: CALM_FEEL.bpm,      // 68
  swing: CALM_FEEL.swing,  // 0 — syncopation is the thing this idiom avoids
  room: CALM_FEEL.room,
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * i, ♭VII, ♭VI, iv — a modal loop with no leading tone anywhere in it, which
   * is most of why this idiom sounds like it is floating rather than resolving.
   *
   * Chord 0 is home and must stay home; see the phonk table for why.
   */
  progression: [0, 10, 8, 5],
  chordNames: ['i', '♭VII', '♭VI', 'iv'],

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
    // THE PAD IS THIS PALETTE'S BASS. There is no 808 here, and the pad is the
    // sustained voice underneath everything, so it is the one that states the
    // chord while the handpan, bowls and crotales float over it.
    //
    // It is also the most expensive voice here to render four times over — a
    // 0.7s attack means long buffers. The chord loop renders chord 0 for every
    // voice before it renders chord 1 for any, so the first sound she hears is
    // not waiting on the other three (ver:time-to-first-sound).
    pad: { render: (sr, hz, s, o) => renderPadVoice(sr, hz, s, o), octaves: 1, sampleRate: 22050, attack: 0.7, transposes: true },
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
  blurb: 'A music box that has gone wrong, and a glass harmonica.',
  accent: '#9d7bff',
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
   * EVERY OFFSET HERE IS EVEN, AND THAT IS THE WHOLE DESIGN OF IT.
   *
   * The whole-tone scale has only TWO transpositions. Move it by an even number
   * of semitones and it maps onto itself; move it by an odd number and you land
   * in the other collection, which shares not one note with this one. So even
   * offsets let the harmony move underneath her while every note she can press
   * stays inside the same six — the whole-tone equivalent of what the pentatonic
   * does for the other palettes.
   *
   * 4 and 8 are left out for a different reason: the augmented triad this scale
   * is built from maps onto itself at a major third, so those two would change
   * the label and not the sound. 2, 6 and 10 all move audibly.
   *
   * This palette gave up the REASSURING half of the no-wrong-notes promise on
   * purpose. It does not follow that it should give up the protective half by
   * accident, which an odd offset here would do.
   *
   * Chord 0 is home and must stay home; see the phonk table for why.
   */
  progression: [0, 2, 6, 10],
  chordNames: ['i', 'II', '♯IV', '♭VII'],

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
    // THE DREAD IS THIS PALETTE'S BASS — the low sustained voice the drone is
    // also cut from — so it is the one that states the chord while the music
    // box, the glass and the wail float over it, unmoved.
    dread: { render: (sr, hz, s, o) => renderDread(sr, hz, s, o), octaves: 1, sampleRate: 22050, attack: 1.1, transposes: true },
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
  blurb: 'The dembow. Tap near the beat and you land on it.',
  accent: '#ffb03d',
  home: 'reggaeton/',
  name: 'JugDembow',
  tagline: 'Turn your phone sideways, tap the blocks, and you cannot miss the beat.',

  bpm: 96,          // the genre sits around 88-100
  swing: 0,         // dead straight; phonk's shuffle would be badly wrong here
  room: null,       // close and dry, like the records
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * i, ♭VI, ♭III, ♭VII — the loop an enormous amount of this music is actually
   * built on, and it is the same four chords whichever record you pick up.
   *
   * Chord 0 is home and must stay home; see the phonk table for why.
   */
  progression: [0, 8, 3, 10],
  chordNames: ['i', '♭VI', '♭III', '♭VII'],

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
    // The 808 states the chord; the lead floats. Same arrangement as phonk, and
    // for the same reason.
    bass: { render: (sr, hz, s, o) => render808(sr, hz, s, o), octaves: 0, transposes: true },
    lead: { render: (sr, hz, s, o) => renderLead(sr, hz, s, o), octaves: LEAD_OCTAVES },
  },
  drone: (sr) => renderPad(sr, {}),
};

// ---------------------------------------------------------------------------
// Bachata — the plucked string, three ways. Id 4 forever.
// ---------------------------------------------------------------------------

export const BACHATA = {
  id: 4,
  key: 'bachata',
  blurb: 'Requinto, güira and bongó. The guitar leads.',
  accent: '#5ee6a8',
  home: 'bachata/',
  name: 'JugBachata',
  tagline: 'Turn your phone sideways, tap the blocks, and let the guitar answer.',

  bpm: BACHATA_FEEL.bpm,     // 128
  swing: BACHATA_FEEL.swing, // 0
  room: BACHATA_FEEL.room,   // small: these records are close and present
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * THE CHORDS SHE CAN STEP THROUGH, as semitone offsets from home.
   *
   * i, ♭VI, ♭VII, iv — in C minor that is Cm, A♭, B♭, Fm, which is the
   * progression an enormous amount of bachata is actually built on.
   *
   * AND THE PENTATONIC IS CONSONANT AGAINST EVERY ONE OF THEM, which is the
   * finding that survived the automatic version being taken back out
   * (dec:idea-drop-the-auto-progression) and is what makes the scale lock still
   * true once the harmony moves. Over A♭ her notes are the third, fifth, sixth,
   * seventh and ninth; over B♭ the ninth, eleventh, fifth, thirteenth and root;
   * over Fm the fifth, ♭seventh, root, ninth and eleventh. Every one an
   * extension, not a clash.
   */
  progression: [0, 8, 10, 5],
  chordNames: ['i', '♭VI', '♭VII', 'iv'],

  /**
   * NOTHING SUSTAINS HERE, and that is not an oversight. Every voice in this
   * palette is struck or plucked: a string rings for as long as it rings and
   * holding the key cannot make it longer, which is exactly the reasoning
   * dec:drums-do-not-sustain gives for the drums. The calm palette is the
   * opposite case — you do hold a singing bowl — and both are the same rule:
   * sustain belongs to the instrument.
   *
   * NO RHYTHM LOCK EITHER. Reggaetón locks because its identity IS one pattern.
   * Bachata's identity is the guitar, so locking the güira would take away the
   * one thing that makes a bachata percussion part somebody's rather than the
   * genre's.
   */
  rounds: [
    {
      id: 'r1', label: 'Ritmo', full: 'Bongó & Güira', sustains: false, click: true,
      lanes: [{ voice: 'bongo', name: 'BONGÓ' }, { voice: 'guira', name: 'GÜIRA' }],
    },
    {
      id: 'r2', label: 'Segunda', full: 'The Rhythm Guitar', sustains: false, click: false,
      lanes: [
        { voice: 'segunda', degree: 0, name: 'ROOT' },
        { voice: 'segunda', degree: 3, name: '5th' },
      ],
    },
    {
      id: 'r3', label: 'Bajo', full: 'The Bass', sustains: false, click: false,
      lanes: [
        { voice: 'bajo', degree: 0, name: 'ROOT' },
        { voice: 'bajo', degree: 2, name: '4th' },
        { voice: 'bajo', degree: 3, name: '5th' },
        { voice: 'bajo', degree: 4, name: '♭7' },
      ],
    },
    {
      id: 'r4', label: 'Requinto', full: 'The Requinto', sustains: false, click: false,
      lanes: [
        { voice: 'requinto', degree: 0, name: 'ROOT' },
        { voice: 'requinto', degree: 1, name: '♭3' },
        { voice: 'requinto', degree: 3, name: '5th' },
        { voice: 'requinto', degree: 5, name: '8ve' },
      ],
    },
  ],

  kit: null,
  pitched: {
    bongo: { render: (sr, hz, s, o) => renderBongo(sr, s, o), octaves: 0, sampleRate: 22050, attack: 0.002 },
    guira: { render: (sr, hz, s, o) => renderGuira(sr, s, o), octaves: 0, sampleRate: 22050, attack: 0.001 },
    segunda: { render: (sr, hz, s, o) => renderString(sr, hz, 'segunda', s, o), octaves: 2, sampleRate: 22050, attack: 0.002 },
    // THE BASS MOVES AND NOTHING ELSE DOES, which is how a band actually plays
    // this. The bass states the chord — that is what makes a change audible at
    // all — while the melody stays in one scale and floats over it, the way a
    // blues player uses one pentatonic over a whole tune. Transposing the
    // requinto too would give each chord its own parallel pentatonic, which
    // wanders outside the key.
    //
    // It is also why chords stay cheap: only a transposing voice needs a buffer
    // per chord, so four chords cost four bass renders and nothing else.
    bajo: { render: (sr, hz, s, o) => renderString(sr, hz, 'bajo', s, o), octaves: 0, sampleRate: 22050, attack: 0.002, transposes: true },
    requinto: { render: (sr, hz, s, o) => renderString(sr, hz, 'requinto', s, o), octaves: 3, sampleRate: 22050, attack: 0.002 },
  },
  // A held segunda chord, quietly, so round one is not played into silence.
  drone: (sr) => renderString(sr, ROOT_HZ * 4, 'segunda', {}, { seconds: 4 }),
  impulse: (sr) => impulseResponse(sr, { seconds: 2.0, ...BACHATA_FEEL.room }),
};

// ---------------------------------------------------------------------------
// Ritual — quiet, then crushing, in a very large room. Id 5 forever.
// ---------------------------------------------------------------------------

export const RITUAL = {
  id: 5,
  key: 'ritual',
  blurb: 'Felt piano and a choir, then a drop-tuned riff over the top.',
  accent: '#c8a86b',
  home: 'ritual/',
  name: 'JugRitual',
  tagline: 'Turn your phone sideways, tap the blocks, and let it get heavy.',

  bpm: RITUAL_FEEL.bpm,     // 72 — the median of the corpus's measured slow half
  swing: RITUAL_FEEL.swing, // 0 — the hats that define this are straight 16ths
  room: RITUAL_FEEL.room,   // very large; the room is the loudest thing here

  /**
   * MINOR PENTATONIC, AND THE CORPUS ARGUED FOR SOMETHING ELSE.
   *
   * Read on 2026-09-06 (chg:corpus-numbers-measured), the twenty MIDI files put
   * 82% of their notes inside the natural minor and only 68% inside the minor
   * pentatonic. On the evidence this palette should be natural minor, and that
   * is what the measurement was for.
   *
   * IT CANNOT BE, AND THE REASON IS THE PROMISE RATHER THAN A PREFERENCE. No
   * palette may put two reachable notes a semitone apart — that is the grinding
   * a player hears as a mistake, it is the half of the scale lock that makes
   * "you cannot play a wrong note" true, and test/scale.mjs enforces it on every
   * palette. Natural minor has exactly two such pairs, the 2nd against the ♭3
   * and the 5th against the ♭6.
   *
   * AND THOSE ARE PRECISELY THE TWO NOTES IT ADDS. Minor pentatonic is natural
   * minor with the 2nd and the ♭6 removed; putting either back creates a
   * semitone. So there is no six-note middle ground here — the missing 32% is
   * unreachable by construction, not by choice.
   *
   * WHICH MAKES THIS THE FIRST REAL CASE FOR cap:choose-key-and-scale. The
   * adult version's rule is that a guard rail becomes adjustable rather than
   * disappearing (req:guard-rails-are-adjustable): the default stays pentatonic
   * and safe, and a player who wants the other 32% chooses natural minor
   * deliberately and accepts what comes with it. The haunted palette gave up the
   * REASSURING half of the promise on purpose; this is the protective half, and
   * it is not the palette's to give up on the player's behalf.
   */
  scale: MINOR_PENTATONIC,
  scaleName: 'minor pentatonic',

  /**
   * A PROGRESSION AT LAST — the thing this palette was written without.
   *
   * This comment used to say "NO PROGRESSION, AND IT IS NOT AN OVERSIGHT
   * EITHER", on the grounds that the idiom is chord-loop music and should move,
   * but that the mechanism for moving it safely was not built. IT WAS BUILT.
   * She chooses the chord per bar, it travels in the link, and nothing ever
   * transposes a note after she has recorded it. The condition this palette was
   * waiting on is met (2026-09-21).
   *
   * i, ♭VI, iv, ♭VII — a heavy minor loop that stays inside the natural minor
   * the pentatonic is cut from.
   *
   * ⚠️ ASSERTED, NOT MEASURED, AND THAT IS A REAL EXCEPTION HERE.
   * req:palette-numbers-are-measured says this palette's numbers come off the
   * MIDI corpus rather than off an ear, and the tempo and the scale fit do. This
   * progression does NOT. The corpus read on 2026-09-06 could not determine the
   * KEY of these songs at all — two methods agreed on 10 of 18 files, and
   * chg:corpus-numbers-measured records that no key is recorded for this palette
   * on that evidence. A chord loop in scale degrees needs a key to be measured
   * against, so there is nothing to measure it from. This is a defensible loop
   * for the idiom, chosen by ear, and it should be replaced the day the key is
   * established.
   *
   * Chord 0 is home and must stay home; see the phonk table for why.
   */
  progression: [0, 8, 5, 10],
  chordNames: ['i', '♭VI', 'iv', '♭VII'],

  /**
   * FOUR ROUNDS, WHICH IS ALL THERE ARE — track.js throws at any other number.
   * The arc is the requirement's: piano, then voices, then the kit, and the
   * weight last (req:sleep-token-palette).
   *
   * WHAT DID NOT FIT, said plainly rather than left to be discovered: the
   * hi-hat's OPEN and PEDAL articulations. req:drums-in-the-gospel-idiom names
   * all three by name and the corpus uses all three — in the Summoning drum solo
   * they are near-balanced at 30 closed, 27 pedalled, 29 open. Four rounds of two
   * thumbs cannot hold them alongside a kick, a snare and a ghost, and the ghost
   * won because that requirement calls it the most identifying feature of the
   * idiom.
   */
  rounds: [
    {
      id: 'r1', label: 'Keys', full: 'The Felt Piano', sustains: true, click: true,
      lanes: [
        { voice: 'piano', degree: 0, name: 'ROOT' },
        { voice: 'piano', degree: 1, name: '♭3' },
        { voice: 'piano', degree: 3, name: '5th' },
        { voice: 'piano', degree: 5, name: '8ve' },
      ],
    },
    {
      id: 'r2', label: 'Choir', full: 'The Choir', sustains: true, click: false,
      lanes: [
        { voice: 'choir', degree: 0, name: 'ROOT' },
        { voice: 'choir', degree: 1, name: '♭3' },
        { voice: 'choir', degree: 3, name: '5th' },
        { voice: 'choir', degree: 4, name: '♭7' },
      ],
    },
    /**
     * FOUR DRUMS UNDER TWO THUMBS, which the phonk layout rejected — and the
     * rejection does not reach here.
     *
     * The loop-pedal rewrite replaced four drum keys with two, on the grounds
     * that four drums are four INSTRUMENTS to choose between while four notes
     * are four positions on ONE instrument. That reasoning stands, and
     * con:playable-by-four-limbs is what changes its answer: a kit is one
     * instrument, played by one person with four limbs. Four drum lanes are four
     * positions on it, exactly as four degrees are four positions on a piano.
     *
     * The original objection was also grounded in req:player-is-nine — four
     * decisions at once is too many for her — and that requirement governs
     * MusicJug, not proj:adult-version, which this palette belongs to.
     *
     * ⚠️ SNARE + GHOST + HAT NEEDS THREE HANDS, and snare + ghost is incoherent
     * anyway: one drum cannot be struck loudly and softly at the same instant.
     * ver:drums-are-playable is the check that should catch it and this is its
     * first real input. Left standing rather than designed away — narrowing the
     * lanes to make a planned check pass would be answering the check instead of
     * the music.
     */
    {
      id: 'r3', label: 'Kit', full: 'Kick, Snare & Hat', sustains: false, click: false,
      lanes: [
        { voice: 'kick', name: 'KICK' },
        { voice: 'snare', name: 'SNARE' },
        { voice: 'ghost', name: 'GHOST' },
        { voice: 'hat', name: 'HAT' },
      ],
    },
    {
      id: 'r4', label: 'Riff', full: 'The Riff', sustains: false, click: false,
      lanes: [
        { voice: 'riff', degree: 0, name: 'ROOT' },
        { voice: 'riff', degree: 2, name: '4th' },
        { voice: 'riff', degree: 3, name: '5th' },
        { voice: 'riff', degree: 4, name: '♭7' },
      ],
    },
  ],

  kit: null,
  /**
   * SAMPLE RATE IS NOT UNIFORM HERE, unlike every palette before it, and the
   * riff is why. Halving the rate puts Nyquist at 11 kHz, which is transparent
   * for a felt piano and a choir — both are dark by construction, the choir's
   * top formant sits at 3.4 kHz. It is NOT transparent for distortion, whose
   * whole job is to manufacture harmonics far above the fundamental: rendered
   * at half rate those fold back as aliasing, which sounds like cheap digital
   * clipping and is exactly the artefact renderRiff's cabinet stage exists to
   * avoid. The drums are broadband noise and want full rate for the same reason.
   */
  pitched: {
    piano: { render: (sr, hz, s, o) => renderFeltPiano(sr, hz, s, o), octaves: 2, sampleRate: 22050, attack: 0.003 },
    choir: { render: (sr, hz, s, o) => renderChoir(sr, hz, s, o), octaves: 2, sampleRate: 22050, attack: 0.9 },
    /**
     * AN OCTAVE BELOW EVERY OTHER BASS VOICE IN THIS PROJECT, and it is the
     * single thing that most makes this sound like the idiom rather than like a
     * distorted guitar. They tune to E1 or D#1 — a full octave under standard —
     * and the register is not a detail of the tone, it IS the tone: measured,
     * the same signal chain at C1 produces 1,355 harmonics above -40dB against
     * 728 at C2, because there is simply twice as much room under Nyquist for a
     * fundamental that low to put them.
     */
    /**
     * AND IT IS THE VOICE THAT STATES THE CHORD. In this idiom the drop-tuned
     * riff IS the harmony — the piano and the choir float above it — so it
     * carries `transposes` while they do not.
     *
     * IT IS ALSO THE MOST EXPENSIVE VOICE IN THE PROJECT TO RENDER FOUR TIMES.
     * It runs at the full context rate rather than 22050 (see above: halving it
     * would alias the cabinet stage), and a four-chord progression means four
     * renders of it instead of one. Chord 0 is rendered for every voice before
     * chord 1 is rendered for any, so the gate still opens on time — but this is
     * the voice to watch if load ever becomes the complaint.
     */
    riff: { render: (sr, hz, s, o) => renderRiff(sr, hz, s, o), octaves: -1, attack: 0.002, transposes: true },
    kick: { render: (sr) => renderRitualKick(sr), octaves: 0, attack: 0.002 },
    snare: { render: (sr) => renderRitualSnare(sr), octaves: 0, attack: 0.002 },
    ghost: { render: (sr) => renderRitualGhost(sr), octaves: 0, attack: 0.002 },
    hat: { render: (sr) => renderRitualHat(sr), octaves: 0, attack: 0.001 },
  },
  // A held choir on the root, voiced up two octaves so a phone can reproduce it
  // (dec:drone-voiced-up). Round one is a piano played into a held chord.
  drone: (sr) => renderChoir(sr, ROOT_HZ * 4, {}, { seconds: 8 }),
  impulse: (sr) => impulseResponse(sr, { seconds: 5.0, ...RITUAL_FEEL.room }),
};

// ---------------------------------------------------------------------------

export const PALETTES = [PHONK, CALM, HAUNTED, REGGAETON, BACHATA, RITUAL];

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
