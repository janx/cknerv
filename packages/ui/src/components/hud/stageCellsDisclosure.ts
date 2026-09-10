import { useSyncExternalStore } from 'react';
import type { CellDisplayMode } from '../../tweaks/cellDisplay';

/** WHETHER THE STAGE-CELLS CAP STANDS IN THE TOP BAR, AND WHY IT DOES NOT AT REST.
 *
 *  `STAGE CELLS` is 279 px of a 1,079 px row — better than a quarter of the
 *  whole bar — and it is the one module up there that is not a reading. It is
 *  a control: a shown/available count wrapped around a cap the reader may
 *  drag. What it caps is decided one module to its right, because AUTO's
 *  number IS the quality tier's (`resolveCellDisplayLimit` reads the tier),
 *  so the slider is a REFINEMENT of the quality decision rather than a peer of
 *  it — and a refinement nobody has asked for is chrome standing where the
 *  stage could be.
 *
 *  So the bar boots without it and the QUALITY rail is the door: picking a
 *  tier — any of the four — brings the cap up beside it, and picking the tier
 *  already under the diamond puts it away again. That second click is the one
 *  gesture in the rail that changes nothing today, which is exactly why it can
 *  carry this without taking anything away from anybody
 *  (user ruling, 2026-09-10).
 *
 *  ⚠️ A MODULE STORE, NOT COMPONENT STATE, and the reason is the probe. The
 *  top bar is rendered TWICE — once for the reader and once, hidden and at its
 *  natural width, as the box the fold is measured on
 *  (`useStatusStripFold.ts`). A disclosure only one copy could see would leave
 *  the probe measuring a row nobody is looking at, and the fold would answer
 *  for content that is not there: the precise failure the probe exists to
 *  prevent. One store, both copies, one width. */
const listeners = new Set<() => void>();
let disclosed = false;

/** The cap control stands when the reader has asked for it — AND whenever the
 *  cap is manual, asked for or not. A cap that is not the automatic one is a
 *  live divergence, and this control is the only thing in the bar that says
 *  so; tidying it away would leave the stage clamped with nothing on screen
 *  admitting it. What the gesture can put away is therefore an AUTO cap, whose
 *  number the tier beside it already names. */
export function stageCellsControlStands(
  asked: boolean,
  cap: CellDisplayMode,
): boolean {
  return asked || cap === 'manual';
}

export function setStageCellsDisclosed(next: boolean): void {
  if (next === disclosed) return;
  disclosed = next;
  for (const listener of listeners) listener();
}

export function getStageCellsDisclosed(): boolean {
  return disclosed;
}

export function subscribeStageCellsDisclosed(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One click every few minutes at the very most, so a plain external-store
 *  hook is the whole of it — the same bargain `useQualityRuntime` makes. */
export function useStageCellsDisclosed(): boolean {
  return useSyncExternalStore(
    subscribeStageCellsDisclosed,
    getStageCellsDisclosed,
    getStageCellsDisclosed,
  );
}
