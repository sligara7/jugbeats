// The stage (comp:stage) — the highway and the two keys, together.
//
// Provides iface:the-page-surface. Rendering and input live in one part on
// purpose: they share a surface and a coordinate system, and a boundary between
// them would add a hop on the one path where latency is felt directly.
//
// Governed by dec:one-clock — every block's position is COMPUTED from the clock,
// never advanced per frame, so a dropped frame loses a frame and not the beat —
// and by dec:two-thumbs-loop-pedal, which keeps her thumbs where they rest and
// leaves the middle of the screen free. Two lanes on the drums, four on the
// pitched rounds — always split evenly between the two thumbs.
//
// This part never calls back into the shell (dec:shell-is-the-composition-root).

import { STEPS_PER_BAR } from './track.js';

/** How long a block takes to fall, matched to the game she already plays. */
const FALL_SECONDS = 2.0;

/**
 * Keyboard fallback, for testing without a phone. Not a target.
 * Ordered so a two-lane round uses the outer pair, which is what her thumbs do.
 */
const KEYS_BY_COUNT = { 2: ['f', 'j'], 4: ['d', 'f', 'j', 'k'] };

/** One colour per lane, left to right. Far apart in hue so nothing is ambiguous. */
const LANE_COLOURS = ['#ff3d7f', '#ffb03a', '#3ddbd9', '#b46cff'];
const BG = '#0d0a14';

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./clock.js').Clock} clock
   * @param {{onHit:(lane:number)=>void, onRelease:(lane:number)=>void}} opts
   */
  constructor(canvas, clock, { onHit, onRelease }) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.clock = clock;
    this.onHit = onHit;
    this.onRelease = onRelease;

    this.track = null;
    this.roundId = null;
    this.round = null;
    this.armed = false;      // are her taps being recorded right now
    this.countdown = null;   // beats remaining in the count-in, or null

    this._raf = null;
    this._flash = [0, 0, 0, 0];
    this._holding = [false, false, false, false];
    this._byPointer = new Map();
    this._w = 0;
    this._h = 0;

    this._bindInput();
  }

  mount(track) {
    this.track = track;
    this.resize();
    if (this._raf === null) this._raf = requestAnimationFrame(this._frame);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w;
    this._h = h;
  }

  setRound(round) {
    this.round = round;
    this.roundId = round?.id ?? null;
  }

  setArmed(armed) {
    this.armed = armed;
  }

  setCountdown(n) {
    this.countdown = n;
  }

  destroy() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  // -------------------------------------------------------------------------
  // Layout. Lanes hugging the edges, and the middle left empty — which is
  // where the transport goes, because the middle of a landscape phone is the
  // one place neither thumb is.
  // -------------------------------------------------------------------------

  _layout() {
    const w = this._w;
    const h = this._h;
    const keyH = Math.min(h * 0.34, 190);
    const hitY = h - keyH - 12;

    // Half the lanes under each thumb, both groups hugging the edges. The middle
    // stays empty whatever the count, because that is where the transport lives
    // and where neither thumb rests.
    const n = this.lanes();
    const perSide = n / 2;
    const pad = Math.max(w * 0.025, 12);
    const gap = Math.max(w * 0.012, 7);
    const groupW = Math.min(w * (perSide === 1 ? 0.33 : 0.37), perSide === 1 ? 320 : 360);
    const keyW = (groupW - gap * (perSide - 1)) / perSide;

    const keys = [];
    for (let i = 0; i < n; i++) {
      const side = i < perSide ? 0 : 1;
      const withinSide = i % perSide;
      const groupX = side === 0 ? pad : w - pad - groupW;
      keys.push({ x: groupX + withinSide * (keyW + gap), y: hitY + 12, w: keyW, h: keyH });
    }
    const lanes = keys.map((k) => ({ x: k.x, w: k.w, cx: k.x + k.w / 2 }));
    return { keys, lanes, hitY, keyH };
  }

  /** How many keys this round puts on screen. Two on drums, four when pitched. */
  lanes() {
    return this.round?.lanes?.length ?? 2;
  }

  // -------------------------------------------------------------------------
  // Input. The sound leaves before anything else happens (dec:one-clock).
  // -------------------------------------------------------------------------

  _bindInput() {
    const press = (lane) => {
      if (lane < 0 || lane >= this.lanes() || this._holding[lane]) return;
      this._holding[lane] = true;
      this.onHit(lane);
      this._flash[lane] = performance.now();
    };
    const release = (lane) => {
      if (lane < 0 || lane >= this.lanes() || !this._holding[lane]) return;
      this._holding[lane] = false;
      this.onRelease(lane);
    };

    const laneAt = (clientX, clientY) => {
      const r = this.canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      const { keys } = this._layout();
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        // Generous vertically: everything below the line belongs to the key
        // under it, so a thumb landing slightly high still counts.
        if (x >= k.x && x <= k.x + k.w && y >= k.y - 28) return i;
      }
      return -1;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const lane = laneAt(e.clientX, e.clientY);
      if (lane < 0) return;
      this._byPointer.set(e.pointerId, lane);
      // Keep the hold alive when her thumb slides off, which on a phone it does.
      this.canvas.setPointerCapture?.(e.pointerId);
      press(lane);
    }, { passive: false });

    const up = (e) => {
      const lane = this._byPointer.get(e.pointerId);
      if (lane === undefined) return;
      this._byPointer.delete(e.pointerId);
      release(lane);
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    window.addEventListener('blur', () => {
      this._byPointer.clear();
      for (let i = 0; i < this._holding.length; i++) release(i);
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      const lane = (KEYS_BY_COUNT[this.lanes()] ?? []).indexOf(e.key.toLowerCase());
      if (lane < 0) return;
      e.preventDefault();
      press(lane);
    });
    window.addEventListener('keyup', (e) => {
      const lane = (KEYS_BY_COUNT[this.lanes()] ?? []).indexOf(e.key.toLowerCase());
      if (lane >= 0) release(lane);
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

    for (let i = 0; i < lanes.length; i++) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(lanes[i].x, 0, lanes[i].w, hitY);
    }

    const nowStep = this.clock.now();
    if (nowStep !== null && this.track) {
      this._drawBeatGrid(g, hitY, nowStep);
      // Rounds she has already kept, drawn faintly in their own lanes so she can
      // see the thing she is building rather than only the part in her hands.
      for (const id of this.track.accepted) {
        if (id !== this.roundId) this._drawRuns(g, lanes, hitY, nowStep, id, 0.16);
      }
      if (this.roundId) this._drawRuns(g, lanes, hitY, nowStep, this.roundId, 1);
    }

    // The line. Brighter on the beat, so the pulse is visible even with nothing
    // falling — which is most of round one.
    const onBeat = nowStep === null ? 0 : 1 - Math.min(1, (((nowStep % 4) + 4) % 4) / 1.2);
    g.strokeStyle = this.armed
      ? `rgba(255,61,127,${0.5 + 0.5 * onBeat})`
      : `rgba(255,255,255,${0.2 + 0.45 * onBeat})`;
    g.lineWidth = 2 + 3 * onBeat;
    g.beginPath();
    g.moveTo(0, hitY);
    g.lineTo(this._w, hitY);
    g.stroke();

    this._drawKeys(g, keys);
    if (this.countdown !== null) this._drawCountdown(g, hitY);
  };

  _drawBeatGrid(g, hitY, nowStep) {
    const first = Math.floor(nowStep / STEPS_PER_BAR) * STEPS_PER_BAR;
    for (let bar = 0; bar < 3; bar++) {
      const y = this._yFor(first + bar * STEPS_PER_BAR, hitY);
      if (y === null || y < -4 || y > hitY) continue;
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(this._w, y);
      g.stroke();
    }
  }

  _drawRuns(g, lanes, hitY, nowStep, roundId, alpha) {
    // This round's own loop, not the track's — rounds may be different lengths
    // and each repeats on its own cycle.
    const loop = this.track.loopStepsFor(roundId);
    const horizon = nowStep + FALL_SECONDS / this.clock.stepSeconds;
    const minH = Math.max(18, hitY * 0.055);

    for (const { lane, start, length } of this.track.runs(roundId)) {
      let step = start + Math.ceil((nowStep - length - 1 - start) / loop) * loop;
      for (; step < horizon; step += loop) {
        const yEnd = this._yFor(step, hitY);
        const yStart = this._yFor(step + length, hitY);
        if (yEnd === null || yEnd < -minH) continue;

        const h = Math.max(minH, yEnd - yStart);
        const L = lanes[lane];
        if (!L) continue;
        g.globalAlpha = alpha * (yEnd > hitY ? Math.max(0, 1 - (yEnd - hitY) / 40) : 1);
        g.fillStyle = LANE_COLOURS[lane];
        roundRect(g, L.x + 6, yEnd - h, L.w - 12, h, Math.min(12, h / 2));
        g.fill();
        if (h > minH * 1.6 && alpha === 1) {
          g.fillStyle = '#ffffff';
          g.globalAlpha *= 0.5;
          roundRect(g, L.x + 6, yEnd - minH * 0.45, L.w - 12, minH * 0.45, 6);
          g.fill();
        }
        g.globalAlpha = 1;
      }
    }
  }

  /** Screen y for an absolute step — derived from time, never accumulated. */
  _yFor(step, hitY) {
    const t = this.clock.timeOf(step);
    if (t === null) return null;
    return hitY - ((t - this.clock.ctx.currentTime) / FALL_SECONDS) * hitY;
  }

  _drawKeys(g, keys) {
    const now = performance.now();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const hot = this._holding[i] ? 1 : Math.max(0, 1 - (now - this._flash[i]) / 180);

      g.fillStyle = LANE_COLOURS[i];
      g.globalAlpha = (this.armed ? 0.3 : 0.16) + 0.7 * hot;
      roundRect(g, k.x, k.y, k.w, k.h, 22);
      g.fill();
      g.globalAlpha = 1;

      g.strokeStyle = LANE_COLOURS[i];
      g.lineWidth = 2.5;
      roundRect(g, k.x, k.y, k.w, k.h, 22);
      g.stroke();

      const name = this.round?.lanes?.[i]?.name;
      if (name) {
        g.fillStyle = 'rgba(255,255,255,0.82)';
        g.font = `600 ${k.w > 150 ? 15 : 13}px ui-rounded, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name, k.x + k.w / 2, k.y + k.h / 2);
      }
    }
  }

  /** The count-in, straight down the empty middle where nothing else lives. */
  _drawCountdown(g, hitY) {
    g.fillStyle = '#ff3d7f';
    g.font = '700 84px ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(this.countdown), this._w / 2, hitY * 0.55);
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
