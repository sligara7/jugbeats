// The link codec (comp:link) — packs a track into a URL and back out.
//
// Provides iface:track-format, the ONE published boundary in this design. Once a
// link is sitting in somebody's chat it is a promise to the outside world, not
// an internal detail — which is why the version marker comes first and why every
// decoder we have ever shipped stays here forever.
//
// Governed by dec:track-in-the-url: the track travels inside the link, so there
// is no server, no database and no account anywhere in this game.

import { Track, ROUNDS, LANE_STRIDE, STEPS_PER_BAR } from './track.js';

/** Current format version. Bump when the layout changes; NEVER reuse a number. */
const VERSION = 4;

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
// v4 — every round carries its own loop length
//
// New in v4 over v3: each round stores how many bars it loops over, so a
// three-bar bass can sit under a four-bar drum part and drift apart and back
// together every twelve bars. Every round's bitfield is sized by the LONGEST
// round, which wastes a little space on the short ones and buys one code path.
// ---------------------------------------------------------------------------

function encodeV4(track) {
  const maxSteps = track.maxLoopSteps;
  const bytesPerRound = Math.ceil((maxSteps * LANE_STRIDE) / 8);
  const out = new Uint8Array(
    4 + ROUNDS.length + ROUNDS.length * bytesPerRound + 1 + SHAPED.length * CONTROLS.length
  );

  let p = 0;
  out[p++] = VERSION;
  out[p++] = maxSteps / STEPS_PER_BAR; // the longest round, for sizing on the way back in
  out[p++] = Math.max(0, Math.min(255, track.bpm));
  out[p++] = 0; // reserved

  for (const round of ROUNDS) out[p++] = track.barsFor(round.id);

  for (const round of ROUNDS) {
    for (const { slot, lane } of track.notes(round.id)) {
      const bit = slot * LANE_STRIDE + lane;
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
      out[p++] = Math.round((v === undefined ? 0.5 : Math.min(1, Math.max(0, v))) * 255);
    }
  }
  return out;
}

function decodeV4(bytes) {
  let p = 1;
  const maxBars = bytes[p++] || 4;
  const bpm = bytes[p++] || 100;
  p++; // reserved

  const track = new Track({ bars: maxBars });
  track.bpm = bpm;
  for (const round of ROUNDS) track.setBars(round.id, bytes[p++] || maxBars);

  const maxSteps = maxBars * STEPS_PER_BAR;
  const bytesPerRound = Math.ceil((maxSteps * LANE_STRIDE) / 8);

  for (const round of ROUNDS) {
    for (let bit = 0; bit < maxSteps * LANE_STRIDE; bit++) {
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
// v3 — four rounds, up to four lanes each, one loop length for all of them
//
// KEPT FOREVER. Decoding is a widening: every round simply gets the one length
// the whole track used to share.
//
// A fixed-size bitfield per round, because it is constant-size: the URL for a
// track she has filled completely is exactly as long as one with two notes in
// it, so a link can never grow past what a chat app will carry.
//
// New in v3 over v2: the pitched rounds have FOUR lanes rather than two, two
// under each thumb, so she can play a real bass line and press two notes
// together as a chord. Every round packs at the same stride whatever it
// actually uses, which keeps one code path and one format.
// ---------------------------------------------------------------------------

// NOTE: there is no encodeV3. Only DECODERS are kept forever — a version is a
// promise to read what was written, not to keep writing it. The v3 encoder was
// removed the moment v4 replaced it; a frozen v3 string in the test corpus is
// what proves this decoder still works, and a live encoder would only have been
// a second thing to keep correct.

function decodeV3(bytes) {
  let p = 1;
  const bars = bytes[p++] || 4;
  const bpm = bytes[p++] || 100;
  p++; // reserved

  const track = new Track({ bars });
  track.bpm = bpm;
  const steps = bars * STEPS_PER_BAR;
  const bytesPerRound = Math.ceil((steps * LANE_STRIDE) / 8);

  for (const round of ROUNDS) {
    for (let bit = 0; bit < steps * LANE_STRIDE; bit++) {
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
// v2 — four rounds of TWO lanes each
//
// KEPT FOREVER. Short-lived as a shipped format, but the rule is the rule: a
// version number is a promise, and promises do not get withdrawn because the
// window was narrow. Decoding is a widening — the two old lanes keep their
// positions, and the two new ones on the pitched rounds are simply empty.
// ---------------------------------------------------------------------------

const V2_LANES = 2;

function decodeV2(bytes) {
  let p = 1;
  const bars = bytes[p++] || 2;
  const bpm = bytes[p++] || 100;
  p++; // reserved

  const track = new Track({ bars });
  track.bpm = bpm;
  const bytesPerRound = Math.ceil((bars * STEPS_PER_BAR * V2_LANES) / 8);

  for (const round of ROUNDS) {
    for (let bit = 0; bit < bars * STEPS_PER_BAR * V2_LANES; bit++) {
      if (!(bytes[p + (bit >> 3)] & (1 << (bit & 7)))) continue;
      const slot = Math.floor(bit / V2_LANES);
      const lane = bit % V2_LANES;
      track.events[round.id].add(slot * LANE_STRIDE + lane);
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
// than a read: the four drum lanes split across the first two rounds, and the
// pitched layers carry across whole.
// ---------------------------------------------------------------------------

const V1_LAYERS = ['drums', 'bass', 'lead'];
const V1_LANES = 4;

/**
 * Where each v1 (layer, lane) ends up now.
 *
 * The old drum layer's lanes 2 and 3 were hat and cowbell, which are exactly
 * round two — so the four drum lanes split cleanly across the first two rounds.
 *
 * The pitched layers now map WHOLE. Under v2 the pitched rounds had only two
 * lanes, so lanes 2 and 3 of an old melody had nowhere to go and were dropped —
 * an honest loss, but a loss. Widening the pitched rounds to four lanes closes
 * that hole: a v1 link decoded today keeps every note it was written with.
 */
function v1Destination(layer, lane) {
  if (layer === 'drums') return lane < 2 ? { round: 'r1', lane } : { round: 'r2', lane: lane - 2 };
  if (layer === 'bass') return { round: 'r3', lane };
  if (layer === 'lead') return { round: 'r4', lane };
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
      if (dest) track.events[dest.round].add(slot * LANE_STRIDE + dest.lane);
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
const DECODERS = { 1: decodeV1, 2: decodeV2, 3: decodeV3, 4: decodeV4 };

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

export function encode(track) {
  return toB64Url(encodeV4(track));
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

export const _internal = { encodeV4, decodeV4, decodeV3, decodeV2, decodeV1, toB64Url, fromB64Url, VERSION };
