// Pure batch helpers extracted from NeuralNetwork's pulse-planning + block-tick
// effects. Kept free of React / simClock / window so the wiring logic is
// unit-testable (the effects themselves can't be observed in the jsdom
// <Canvas> harness — r3f v8 never mounts Canvas children at 0×0). The effects
// call these and stamp the clock; these decide WHICH links fire and WHEN the
// per-block counter ticks.

import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { advanceLinkCursor } from './linkCursor';
import {
  collectLinkSourceIndex,
  planPulses,
  type Pulse,
  type PulsePlanningOptions,
} from './pulseRunner';
import type { PulseStatsSink } from './pulseStats';

/** The stats surface `planLinkBatch` needs (superset of `PulseStatsSink`:
 *  `planPulses` writes drop reasons via the sink, and we roll each link's
 *  outcome up per block via `observeLink`). */
export interface PulseBatchStats extends PulseStatsSink {
  observeLink(block: number, lit: boolean): void;
}

/**
 * Plan pulses for all newly-arrived links since `lastSeq`, recording drop
 * reasons + per-block rollup into `stats`. Pure: returns the planned pulses
 * (flat, in link order) + the advanced cursor. During backfill this returns
 * no pulses (links suppressed) but still advances the cursor and bumps
 * `backfill` by the suppressed count — exactly the effect's behavior, minus
 * the per-pulse `startSec` stamp + ref push the caller applies.
 */
export function planLinkBatch(
  pulseLinks: CellLink[],
  lastSeq: number,
  backfillActive: boolean,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborGraph,
  opts: PulsePlanningOptions,
  stats: PulseBatchStats,
): { planned: Pulse[]; nextSeq: number } {
  const { toFire, nextSeq, suppressed } = advanceLinkCursor(
    pulseLinks,
    lastSeq,
    backfillActive,
  );
  if (suppressed > 0) stats.bump('backfill', suppressed);
  const planned: Pulse[] = [];
  if (toFire.length > 0) {
    // One shared Cell-map prescan for the whole batch replaces the full-map
    // walk planPulses used to run per link. Built only for links that will
    // actually fire (backfill-suppressed links never pay it).
    const batchOpts: PulsePlanningOptions = {
      ...opts,
      sourceIndex: collectLinkSourceIndex(toFire, cells),
    };
    for (const link of toFire) {
      const p = planPulses(link, cells, graph, batchOpts, link.at_ms, stats);
      stats.observeLink(link.block, p.length > 0);
      for (const pulse of p) planned.push(pulse);
    }
  }
  return { planned, nextSeq };
}

/**
 * Place a live nerve batch on the shared protocol-event clock. Generic
 * consumers keep the default zero delay; the dashboard supplies its
 * peer-network-to-Cell-field handoff delay.
 */
export function scheduleLivePulseStartSec(
  nowSec: number,
  livePulseDelayS: number,
): number {
  const safeDelayS = Number.isFinite(livePulseDelayS)
    ? Math.max(0, livePulseDelayS)
    : 0;
  return nowSec + safeDelayS;
}

/**
 * Remove already-planned packets whose source transaction was rolled back.
 * Generic over Pulse subtypes so the renderer can preserve its ActivePulse
 * timing fields while applying the same canonical block boundary.
 */
export function prunePulsesFromBlock<T extends Pulse>(
  pulses: readonly T[],
  fromBlock: number,
): T[] {
  return pulses.filter((pulse) => pulse.linkBlock < fromBlock);
}

/**
 * Tick the per-block counter when `at` strictly advances past `lastSeen`,
 * skipping the bootstrap value (`lastSeen === 0` — the initial pulse delta,
 * not a new block during this session). Returns the new `lastSeen`.
 */
export function tickBlockIfAdvanced(
  at: number,
  lastSeen: number,
  stats: { observeBlockTick(): void },
): number {
  if (at > lastSeen) {
    if (lastSeen !== 0) stats.observeBlockTick();
    return at;
  }
  return lastSeen;
}
