// The coach (comp:coach) — the teaching, hidden inside the play.
//
// Provides iface:the-nudge. It emits INTENTIONS — "open the next layer",
// "celebrate" — and never learns what any of them looks like. The shell
// subscribes and decides how they are shown. That direction is what keeps this
// out of a cycle with the shell (dec:shell-is-the-composition-root).
//
// Governed by dec:layers-advance-the-keys: handing the four keys from drums to
// 808 to lead as her track fills up is this part's main job, and the main way
// the game teaches that a track is layered (req:learn-layering) without telling
// her so (req:learn-by-doing).
//
// It reads the track and never sits on the audio path.

import { LAYERS } from './track.js';

/**
 * How full a layer has to be before the keys move on.
 *
 * Deliberately low. The goal is not a finished drum part — it is that she has
 * clearly understood what the keys do and would rather be surprised than drilled.
 * Four notes is roughly "a beat that repeats".
 */
const ENOUGH = 4;

export class Coach {
  constructor(track) {
    this.track = track;
    this.layerIndex = 0;
    this.unlocked = 1;              // how many layers she has reached
    this._listeners = new Set();
    this._celebrated = new Set();
  }

  get layer() {
    return LAYERS[this.layerIndex];
  }

  /** @param {(nudge: {kind: string, layerId?: string, index?: number}) => void} fn */
  onNudge(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(nudge) {
    // Fire and forget. A teaching hint that queues up and arrives late is worse
    // than one that never arrives (iface:the-nudge).
    for (const fn of this._listeners) fn(nudge);
  }

  /**
   * Called after every recorded tap. The only input this part has.
   *
   * Note what it does NOT do: it never moves her on the instant she qualifies.
   * It celebrates, and offers. Yanking the keys out from under a child
   * mid-phrase would be the fastest way to make the game feel like it is playing
   * itself.
   */
  noteRecorded(layerId) {
    const layer = LAYERS.findIndex((l) => l.id === layerId);
    if (layer !== this.layerIndex) return;

    const count = this.track.count(layerId);
    if (count < ENOUGH) return;

    if (!this._celebrated.has(layerId)) {
      this._celebrated.add(layerId);
      this._emit({ kind: 'layer-full', layerId });

      if (this.layerIndex + 1 < LAYERS.length) {
        this.unlocked = Math.max(this.unlocked, this.layerIndex + 2);
        this._emit({ kind: 'layer-offered', layerId: LAYERS[this.layerIndex + 1].id, index: this.layerIndex + 1 });
      } else {
        this._emit({ kind: 'track-done' });
      }
    }
  }

  /** She chose a layer from the strip — the only navigation in the game. */
  goTo(index) {
    if (index < 0 || index >= this.unlocked) return false;
    this.layerIndex = index;
    this._emit({ kind: 'layer-changed', layerId: LAYERS[index].id, index });
    return true;
  }

  /** Take the offer that was just made. */
  advance() {
    return this.goTo(this.layerIndex + 1);
  }

  /** Reopen everything — used when a shared track is loaded, since she should
   *  be able to reach every layer of music she has just been handed. */
  unlockAll() {
    this.unlocked = LAYERS.length;
  }
}
