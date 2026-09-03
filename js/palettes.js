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

import { render808, renderLead, renderPad, ROOT_HZ } from './dsp.js';
import { DEFAULT_ROUNDS } from './track.js';
import {
  renderPadVoice, renderBreath, renderIdiophone, CALM as CALM_FEEL, impulseResponse,
} from './ethereal.js';

/** Where the lead sits relative to the bass — two octaves up, out of its way. */
const LEAD_OCTAVES = 2;

// ---------------------------------------------------------------------------
// Phonk — what she already has. The default, and id 0 forever.
// ---------------------------------------------------------------------------

export const PHONK = {
  id: 0,
  key: 'phonk',
  name: 'JugBeats',
  tagline: 'Turn your phone sideways, tap the blocks, make a phonk beat.',

  bpm: 138,
  swing: 0.32,
  room: null,           // no reverb: the phonk kit is dry and close on purpose

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
  name: 'JugCalm',
  tagline: 'Turn your phone sideways, tap the blocks, make something peaceful.',

  bpm: CALM_FEEL.bpm,      // 68
  swing: CALM_FEEL.swing,  // 0 — syncopation is the thing this idiom avoids
  room: CALM_FEEL.room,

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

export const PALETTES = [PHONK, CALM];

/** By permanent id, for the link. Unknown ids fall back to phonk rather than
 *  failing — a link from a future build should degrade, never break. */
export const byId = (id) => PALETTES.find((p) => p.id === id) ?? PHONK;

/** By url key, for `?p=calm`. */
export const byKey = (key) => PALETTES.find((p) => p.key === key) ?? PHONK;

/** Which palette the page was asked for. */
export function paletteFromLocation(search = location.search) {
  return byKey(new URLSearchParams(search).get('p') || 'phonk');
}
