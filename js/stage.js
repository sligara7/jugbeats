// The stage (comp:stage) — the highway and the keys, together.
//
// Provides iface:the-page-surface. Rendering and input live in one part on
// purpose: they share a surface and a coordinate system, and a boundary between
// them would add a hop on the one path where latency is felt directly.
//
// Governed by dec:one-clock — every block's position is COMPUTED from the clock,
// never advanced per frame, so a dropped frame loses a frame and not the beat —
// and by dec:four-keys-two-thumbs, which fixes the landscape layout and the
// grouping of the keys.
//
// This part never calls back into the shell (dec:shell-is-the-composition-root).

import { STEPS_PER_BAR } from './track.js';

/**
 * How long a block takes to fall the full height.
 *
 * Two seconds, matched to the game she already plays — the owner recalled that
 * as roughly its fall time, and her hands are already trained on it. Borrowing
 * the number is the same move as borrowing the note-highway idiom itself
 * (req:vertical-note-highway): the less she has to relearn, the sooner she is
 * making music instead of learning an interface.
 */
const FALL_SECONDS = 2.0;

/** Keyboard fallback, for testing without a phone. Not a target (req:phone-touch-first). */
const KEYS = ['d', 'f', 'j', 'k'];

/** One colour per lane. Dark ground, hot accents — the phonk end of the crayon box. */
const LANE_COLOURS = ['#ff3d7f', '#ffb03a', '#3ddbd9', '#b46cff'];
const BG = '#0d0a14';
const DIM = 'rgba(255,255,255,0.06)';

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./clock.js').Clock} clock
   * @param {{onHit: (lane:number)=>void}} opts
   *   onHit fires the instant a key goes down, before anything is drawn or
   *   recorded. The shell wires it straight to the sound.
   */
  constructor(canvas, clock, { onHit }) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.clock = clock;
    this.onHit = onHit;

    this.track = null;
    this.layerId = 'drums';
    this.audioLive = false;

    this._raf = null;
    this._flash = [0, 0, 0, 0];     // audio time each lane was last struck
    this._down = new Set();          // pointer ids / key names currently held
    this._w = 0;
    this._h = 0;
    this._dpr = 1;

    this._bindInput();
  }

  /** Mount into the surface at its current size. */
  mount(track) {
    this.track = track;
    this.resize();
    if (this._raf === null) this._raf = requestAnimationFrame(this._frame);
  }

  /** The surface has resized. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w;
    this._h = h;
    this._dpr = dpr;
  }

  /** The audio engine is now live. */
  setAudioLive(live) {
    this.audioLive = live;
  }

  setLayer(layerId) {
    this.layerId = layerId;
  }

  destroy() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  // -------------------------------------------------------------------------
  // Layout. Derived from the surface size every frame rather than cached, so a
  // rotation or a keyboard appearing cannot leave the keys somewhere stale.
  // -------------------------------------------------------------------------

  _layout() {
    const w = this._w;
    const h = this._h;
    const keyH = Math.min(h * 0.28, 150);
    const hitY = h - keyH - 10;

    // Two keys under each thumb, grouped at the edges rather than spread —
    // the middle of a landscape phone is where thumbs are not.
    const pad = Math.max(w * 0.02, 10);
    const gap = Math.max(w * 0.012, 6);
    const groupW = Math.min(w * 0.34, 300);
    const keyW = (groupW - gap) / 2;

    const keys = [
      { x: pad, y: hitY + 10, w: keyW, h: keyH },
      { x: pad + keyW + gap, y: hitY + 10, w: keyW, h: keyH },
      { x: w - pad - groupW, y: hitY + 10, w: keyW, h: keyH },
      { x: w - pad - keyW, y: hitY + 10, w: keyW, h: keyH },
    ];

    // The lanes on the highway sit above their own keys, so a block visibly
    // falls into the key she has to press.
    const lanes = keys.map((k) => ({ x: k.x, w: k.w, cx: k.x + k.w / 2 }));

    return { keys, lanes, hitY, keyH };
  }

  // -------------------------------------------------------------------------
  // Input. The whole point of this section is that the sound leaves before
  // anything else happens (dec:one-clock).
  // -------------------------------------------------------------------------

  _bindInput() {
    const press = (lane) => {
      if (lane < 0 || lane > 3) return;
      // 1. Sound. Immediately, synchronously, first.
      this.onHit(lane);
      // 2. Then the flash, which is only a drawing hint.
      this._flash[lane] = performance.now();
    };

    const laneAt = (clientX, clientY) => {
      const r = this.canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      const { keys } = this._layout();
      for (let i = 0; i < 4; i++) {
        const k = keys[i];
        // Generous vertically: everything below the hit line belongs to the key
        // under it, so a thumb landing slightly high still counts.
        if (x >= k.x && x <= k.x + k.w && y >= k.y - 24) return i;
      }
      return -1;
    };

    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        const lane = laneAt(e.clientX, e.clientY);
        if (lane < 0) return;
        this._down.add(e.pointerId);
        press(lane);
      },
      { passive: false }
    );
    const up = (e) => this._down.delete(e.pointerId);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      const lane = KEYS.indexOf(e.key.toLowerCase());
      if (lane < 0) return;
      e.preventDefault();
      press(lane);
    });
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  _frame = () => {
    this._raf = requestAnimationFrame(this._frame);
    const g = this.ctx2d;
    const { keys, lanes, hitY } = this._layout();

    g.fillStyle = BG;
    g.fillRect(0, 0, this._w, this._h);

    for (let i = 0; i < 4; i++) {
      g.fillStyle = DIM;
      g.fillRect(lanes[i].x, 0, lanes[i].w, hitY);
    }

    const nowStep = this.clock.now();
    if (nowStep !== null && this.track) {
      this._drawBeatGrid(g, lanes, hitY, nowStep);
      this._drawNotes(g, lanes, hitY, nowStep);
    }

    // The hit line. Brighter on the beat, so the pulse is visible even when
    // nothing is falling — this is where a steady beat is actually taught.
    const onBeat = nowStep === null ? 0 : 1 - Math.min(1, (((nowStep % 4) + 4) % 4) / 1.2);
    g.strokeStyle = `rgba(255,255,255,${0.25 + 0.5 * onBeat})`;
    g.lineWidth = 2 + 2 * onBeat;
    g.beginPath();
    g.moveTo(0, hitY);
    g.lineTo(this._w, hitY);
    g.stroke();

    this._drawKeys(g, keys);
  };

  /** Faint bar lines falling with the music — free rhythmic scaffolding. */
  _drawBeatGrid(g, lanes, hitY, nowStep) {
    const first = Math.floor(nowStep / STEPS_PER_BAR) * STEPS_PER_BAR;
    for (let bar = 0; bar < 3; bar++) {
      const y = this._yFor(first + bar * STEPS_PER_BAR, hitY);
      if (y === null || y < -4 || y > hitY) continue;
      g.strokeStyle = 'rgba(255,255,255,0.13)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(this._w, y);
      g.stroke();
    }
  }

  _drawNotes(g, lanes, hitY, nowStep) {
    const loop = this.track.loopSteps;
    const horizon = nowStep + (FALL_SECONDS / this.clock.stepSeconds);
    const blockH = Math.max(14, hitY * 0.045);

    for (const { slot, lane } of this.track.notes(this.layerId)) {
      // The nearest repeat of this note that has not already passed the line.
      let step = slot + Math.ceil((nowStep - 1 - slot) / loop) * loop;
      for (; step < horizon; step += loop) {
        const y = this._yFor(step, hitY);
        if (y === null || y < -blockH) continue;

        const L = lanes[lane];
        const past = y > hitY;
        g.globalAlpha = past ? Math.max(0, 1 - (y - hitY) / 40) : 1;
        g.fillStyle = LANE_COLOURS[lane];
        roundRect(g, L.x + 4, y - blockH / 2, L.w - 8, blockH, 6);
        g.fill();
        g.globalAlpha = 1;
      }
    }
  }

  /**
   * Screen y for an absolute step. THE one place position is derived, and it is
   * derived from time rather than accumulated per frame — which is the whole of
   * dec:one-clock in four lines.
   */
  _yFor(step, hitY) {
    const t = this.clock.timeOf(step);
    if (t === null) return null;
    const ahead = t - this.clock.ctx.currentTime;
    return hitY - (ahead / FALL_SECONDS) * hitY;
  }

  _drawKeys(g, keys) {
    const now = performance.now();
    for (let i = 0; i < 4; i++) {
      const k = keys[i];
      const since = now - this._flash[i];
      const hot = Math.max(0, 1 - since / 180);

      g.fillStyle = LANE_COLOURS[i];
      g.globalAlpha = 0.25 + 0.75 * hot;
      roundRect(g, k.x, k.y, k.w, k.h, 18);
      g.fill();
      g.globalAlpha = 1;

      g.strokeStyle = LANE_COLOURS[i];
      g.lineWidth = 2;
      roundRect(g, k.x, k.y, k.w, k.h, 18);
      g.stroke();
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}
