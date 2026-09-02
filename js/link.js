// The link codec (comp:link) — packs a track into a URL and back out.
//
// Provides iface:track-format, the ONE published boundary in this design. Once a
// link is sitting in somebody's chat it is a promise to the outside world, not
// an internal detail — which is why the version marker comes first and why every
// decoder we have ever shipped has to stay here.
//
// Governed by dec:track-in-the-url: the track travels inside the link, so there
// is no server, no database and no account anywhere in this game.

import { Track, LAYERS, STEPS_PER_BAR } from './track.js';

/** Current format version. Bump when the layout below changes; never reuse. */
const VERSION = 1;

/** Order the shaping controls are packed in. Fixed forever within a version. */
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
// v1 — a fixed-size bitfield per layer, then the shaping numbers
//
// A bitfield rather than a note list because it is constant-size: the URL for a
// track she has filled in completely is exactly as long as one with two notes in
// it, so a link can never grow past what a chat app will carry. At four bars
// that is 32 bytes a layer, and the whole thing lands around 140 characters.
// ---------------------------------------------------------------------------

function encodeV1(track) {
  const bits = track.loopSteps * 4;
  const bytesPerLayer = Math.ceil(bits / 8);
  const out = new Uint8Array(2 + LAYERS.length * bytesPerLayer + SHAPED.length * CONTROLS.length);

  let p = 0;
  out[p++] = VERSION;
  out[p++] = track.bars;

  for (const layer of LAYERS) {
    for (const { slot, lane } of track.notes(layer.id)) {
      const bit = slot * 4 + lane;
      out[p + (bit >> 3)] |= 1 << (bit & 7);
    }
    p += bytesPerLayer;
  }

  for (const inst of SHAPED) {
    for (const c of CONTROLS) {
      const v = track.shaping[inst]?.[c];
      // 0..1 to a byte. Unset stays at the neutral middle rather than at zero —
      // zero is a real value here and would arrive as "turned all the way down".
      out[p++] = Math.round((v === undefined ? 0.5 : Math.min(1, Math.max(0, v))) * 255);
    }
  }
  return out;
}

function decodeV1(bytes) {
  let p = 1;
  const bars = bytes[p++] || 4;
  const track = new Track({ bars });
  const bytesPerLayer = Math.ceil((track.loopSteps * 4) / 8);

  for (const layer of LAYERS) {
    for (let bit = 0; bit < track.loopSteps * 4; bit++) {
      if (bytes[p + (bit >> 3)] & (1 << (bit & 7))) {
        track.events[layer.id].add(bit);
      }
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
  return track;
}

/** Every decoder we have ever shipped lives here, keyed by version. */
const DECODERS = { 1: decodeV1 };

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/** Pack a track into a URL-safe string. */
export function encode(track) {
  return toB64Url(encodeV1(track));
}

/**
 * Unpack a track, or null.
 *
 * A string that cannot be decoded returns null and the game opens empty. She is
 * never handed a broken-link screen (iface:track-format), and an unknown FUTURE
 * version is treated exactly the same way — a link from a newer build should
 * degrade to "make your own" rather than to an error.
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

/** The full shareable URL for a track, against wherever the game is served. */
export function urlFor(track, base = location.href) {
  const u = new URL(base);
  u.hash = encode(track);
  return u.toString();
}

/** The track in the current address bar, if there is one. */
export function trackFromLocation() {
  return decode(location.hash.replace(/^#/, ''));
}

/**
 * Hand a track to the phone's share sheet, falling back to the clipboard.
 * Must be called from inside a user gesture or iOS will refuse the sheet.
 *
 * @returns {Promise<'shared'|'copied'|'failed'>}
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

export const _internal = { encodeV1, decodeV1, toB64Url, fromB64Url, VERSION, STEPS_PER_BAR };
