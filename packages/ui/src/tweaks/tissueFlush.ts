/** Module-level mutable singleton — the tissue's flush ring, in the same
 *  idiom as `galaxyFrame`: written by `BlockDeliveryLayer` once per delivery
 *  at its contact instant, read by the fabric lifecycle vertex stage
 *  (`fabricFlushGl`, nerve/fabricLifecycleShader.ts) through uniform arrays
 *  that are bound to THESE typed arrays by reference. There is exactly one
 *  galaxy, so there is exactly one flush ring; no React state, no per-frame
 *  copy, and a stamp is visible to both passive fabric passes on their next
 *  draw.
 *
 *  Each slot is one released front: when it left (sim seconds), where (the
 *  landing in the galaxy group's rotating LOCAL frame — the frame the fabric
 *  geometry lives in, so the shader needs no world projection), its colour
 *  (the block's carrier hue; the shader resolves it into tissue rose over the
 *  window, exactly as the annulus front does), its reach, and its amplitude
 *  (the hero's 1 or the peer punch). The shader runs the ONE radius function
 *  every medium of a block event shares (`contactFrontState`, peers.derive)
 *  from these five numbers and the live knobs.
 *
 *  Slots are overwritten round-robin. Sixteen is generous: a mainnet block
 *  lands ≤ ~13 deliveries spread over ~3.4 s, each flush lives one ingest
 *  window (1.2 s), so far fewer than sixteen are ever alive at once. */

/** Ring-buffer size; also the size of every flush uniform array. */
export const TISSUE_FLUSH_SLOTS = 16;

/** "No flush." Sim seconds: anything alive sits ~1e9 s past it, so the
 *  shader's age early-out skips the slot with no branch on a flag — the same
 *  sentinel idiom the peer launch lane uses. */
export const TISSUE_FLUSH_SENTINEL = -1e9;

export const tissueFlush = {
  /** Contact instant per slot (sim seconds); sentinel = empty. */
  at: new Float32Array(TISSUE_FLUSH_SLOTS).fill(TISSUE_FLUSH_SENTINEL),
  /** Landing per slot in the galaxy's local frame, packed (x, z). */
  originXZ: new Float32Array(TISSUE_FLUSH_SLOTS * 2),
  /** Carrier hue per slot, packed (r, g, b). */
  color: new Float32Array(TISSUE_FLUSH_SLOTS * 3),
  /** The front's reach per slot (world units), before the window clamp. */
  reach: new Float32Array(TISSUE_FLUSH_SLOTS),
  /** Amplitude per slot: the hero's 1, a peer's punch. */
  amp: new Float32Array(TISSUE_FLUSH_SLOTS),
  /** The next slot to write. */
  cursor: 0,
};

/** Stamp one released front into the next slot (round-robin). Returns the
 *  slot written. Pure bookkeeping — no allocation, no validation of its
 *  inputs: the delivery layer already planned the front it describes. */
export function stampTissueFlush(
  atSec: number,
  originLocalXZ: readonly [number, number],
  color: readonly [number, number, number],
  reach: number,
  amp: number,
): number {
  const slot = tissueFlush.cursor;
  tissueFlush.cursor = (slot + 1) % TISSUE_FLUSH_SLOTS;
  tissueFlush.at[slot] = atSec;
  tissueFlush.originXZ[slot * 2] = originLocalXZ[0];
  tissueFlush.originXZ[slot * 2 + 1] = originLocalXZ[1];
  tissueFlush.color[slot * 3] = color[0];
  tissueFlush.color[slot * 3 + 1] = color[1];
  tissueFlush.color[slot * 3 + 2] = color[2];
  tissueFlush.reach[slot] = reach;
  tissueFlush.amp[slot] = amp;
  return slot;
}

/** Empty every slot IN PLACE (the arrays are bound into materials by
 *  reference, so they must never be reallocated) and rewind the cursor.
 *  For tests. */
export function resetTissueFlush(): void {
  tissueFlush.at.fill(TISSUE_FLUSH_SENTINEL);
  tissueFlush.originXZ.fill(0);
  tissueFlush.color.fill(0);
  tissueFlush.reach.fill(0);
  tissueFlush.amp.fill(0);
  tissueFlush.cursor = 0;
}
