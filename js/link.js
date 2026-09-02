// The link codec (comp:link) — packs a track into a URL and back out.
//
// Provides iface:track-format, the ONE published boundary in this design. Once a
// link is sitting in somebody's chat it is a promise to the outside world, not
// an internal detail — which is why the version marker comes first and why every
// decoder we have ever shipped stays here forever.
//
// Governed by dec:track-in-the-url: the track travels inside the link, so there
// is no server, no database and no account anywhere in this game.

import { Track, ROUNDS, LANES, STEPS_PER_BAR } from './track.js';

/** Current format version. Bump when the layout changes; NEVER reuse a number. */
const VERSION = 2;

const CONTROLS = ['deeper', 'punchier', 'dirtier', 'longer'];
const SHAPED = ['bass', 'lead'];

// ---------------------------------------------------------------------------
// base64url — URL-safe, no padding, survives being pasted into a chat
// ---------------------------------------------------------------------------

function toB64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// v2 — four rounds of two lanes, plus her tempo
//
// A fixed-size bitfield per round, because it is constant-size: the URL for a
// track she has filled completely is exactly as long as one with two notes in
// it, so a link can never grow past what a chat app will carry.
//
// New in v2 over v1: two lanes per round instead of four per layer, a fourth
// round, which rounds she has ACCEPTED, and HER TEMPO — which now belongs to
// the track, because she tapped it and it is as much hers as the notes are.
// ---------------------------------------------------------------------------

function encodeV2(track) {
  const bytesPerRound = Math.ceil((track.loopSteps * LANES) / 8);
  const out = new Uint8Array(
    4 + ROUNDS.length * bytesPerRound + 1 + SHAPED.length * CONTROLS.length
  );

  let p = 0;
  out[p++] = VERSION;
  out[p++] = track.bars;
  out[p++] = Math.max(0, Math.min(255, track.bpm));
  out[p++] = 0; // reserved, so a later field costs no version bump

  for (const round of ROUNDS) {
    for (const { slot, lane } of track.notes(round.id)) {
      const bit = slot * LANES + lane;
      out[p + (bit >> 3)] |= 1 << (bit & 7);
    }
    p += bytesPerRound;
  }

  let acceptedBits = 0;
  ROUNDS.forEach((r, i) => { if (track.accepted.has(r.id)) acceptedBits |= 1 << i; });
  out[p++] = acceptedBits;

  for (const inst of SHAPED) {
    for (const c of CONTROLS) {
      const v = track.shaping[inst]?.[c];
      // Unset sits at the neutral middle, not at zero — zero is a real value
      // here and would arrive as "turned all the way down".
      out[p++] = Math.round((v === undefined ? 0.5 : Math.min(1, Math.max(0, v))) * 255);
    }
  }
  return out;
}

function decodeV2(bytes) {
  let p = 1;
  const bars = bytes[p++] || 2;
  const bpm = bytes[p++] || 100;
  p++; // reserved

  const track = new Track({ bars });
  track.bpm = bpm;
  const bytesPerRound = Math.ceil((track.loopSteps * LANES) / 8);

  for (const round of ROUNDS) {
    for (let bit = 0; bit < track.loopSteps * LANES; bit++) {
      if (bytes[p + (bit >> 3)] & (1 << (bit & 7))) track.events[round.id].add(bit);
    }
    p += bytesPerRound;
  }

  const acceptedBits = bytes[p++] ?? 0;
  ROUNDS.forEach((r, i) => { if (acceptedBits & (1 << i)) track.accepted.add(r.id); });

  for (const inst of SHAPED) {
    track.shaping[inst] = {};
    for (const c of CONTROLS) {
      const b = bytes[p++];
      if (b !== undefined) track.shaping[inst][c] = b / 255;
    }
  }
  return track;
}

// ---------------------------------------------------------------------------
// v1 — three layers of four lanes, no tempo, no accepted set
//
// KEPT FOREVER. Links in this format are sitting in real chats, and the promise
// that they still play is the whole reason the format carries a version marker.
// The game's shape changed underneath them, so decoding is a MIGRATION rather
// than a read: four drum lanes become two rounds of two, and the two pitched
// layers keep their first two lanes each.
// ---------------------------------------------------------------------------

const V1_LAYERS = ['drums', 'bass', 'lead'];
const V1_LANES = 4;

/** Where each v1 (layer, lane) ends up in v2. Lanes 2 and 3 of the old drum
 *  layer were hat and cowbell, which are exactly round two. */
function v1Destination(layer, lane) {
  if (layer === 'drums') return lane < 2 ? { round: 'r1', lane } : { round: 'r2', lane: lane - 2 };
  if (layer === 'bass') return lane < 2 ? { round: 'r3', lane } : null;
  if (layer === 'lead') return lane < 2 ? { round: 'r4', lane } : null;
  return null;
}

function decodeV1(bytes) {
  let p = 1;
  const bars = bytes[p++] || 4;
  const loopSteps = bars * STEPS_PER_BAR;
  const bytesPerLayer = Math.ceil((loopSteps * V1_LANES) / 8);

  // v1 tracks were four bars; the game is two now. Keep the original length so
  // her music is not silently cropped in half.
  const track = new Track({ bars });

  for (const layer of V1_LAYERS) {
    for (let bit = 0; bit < loopSteps * V1_LANES; bit++) {
      if (!(bytes[p + (bit >> 3)] & (1 << (bit & 7)))) continue;
      const slot = Math.floor(bit / V1_LANES);
      const dest = v1Destination(layer, bit % V1_LANES);
      // Lanes 2 and 3 of the old pitched layers have nowhere to go. Dropping
      // them loses two notes of a melody; inventing a home for them would
      // change what she wrote. Losing them is the honest failure.
      if (dest) track.events[dest.round].add(slot * LANES + dest.lane);
    }
    p += bytesPerLayer;
  }

  for (const inst of SHAPED) {
    track.shaping[inst] = {};
    for (const c of CONTROLS) {
      const b = bytes[p++];
      if (b !== undefined) track.shaping[inst][c] = b / 255;
    }
  }

  // v1 had no tempo and no notion of accepting a round. Everything she made is
  // finished by definition — it arrived as a shared link.
  track.bpm = 138;
  for (const r of ROUNDS) if (track.count(r.id) > 0) track.accepted.add(r.id);
  return track;
}

/** Every decoder we have ever shipped, keyed by version. Nothing leaves. */
const DECODERS = { 1: decodeV1, 2: decodeV2 };

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

export function encode(track) {
  return toB64Url(encodeV2(track));
}

/**
 * Unpack a track, or null.
 *
 * A string that cannot be decoded returns null and the game opens empty. She is
 * never handed a broken-link screen, and an unknown FUTURE version is treated
 * the same way — a link from a newer build should degrade to "make your own"
 * rather than to an error.
 */
export function decode(str) {
  if (!str) return null;
  try {
    const bytes = fromB64Url(str);
    const decoder = DECODERS[bytes[0]];
    return decoder ? decoder(bytes) : null;
  } catch {
    return null;
  }
}

export function urlFor(track, base = location.href) {
  const u = new URL(base);
  u.hash = encode(track);
  return u.toString();
}

export function trackFromLocation() {
  return decode(location.hash.replace(/^#/, ''));
}

/**
 * Hand a track to the phone's share sheet, falling back to the clipboard.
 * Must be called from inside a user gesture or iOS refuses the sheet.
 */
export async function share(track, { title = 'Listen to my beat' } = {}) {
  const url = urlFor(track);
  try {
    if (navigator.share) {
      await navigator.share({ title, text: 'I made this beat', url });
      return 'shared';
    }
  } catch (err) {
    // A cancelled share sheet is not a failure — she changed her mind.
    if (err && err.name === 'AbortError') return 'shared';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export const _internal = { encodeV2, decodeV2, decodeV1, toB64Url, fromB64Url, VERSION };
