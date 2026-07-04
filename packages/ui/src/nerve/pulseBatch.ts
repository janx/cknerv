// Pure batch helpers extracted from NeuralNetwork's pulse-planning + block-tick
// effects. Kept free of React / simClock / window so the wiring logic is
// unit-testable (the effects themselves can't be observed in the jsdom
// <Canvas> harness — r3f v8 never mounts Canvas children at 0×0). The effects
// call these and stamp the clock; these decide WHICH links fire and WHEN the
// per-block counter ticks.

import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { advanceLinkCursor } from './linkCursor';
import { planPulses, type Pulse, type PulsePlanningOptions } from './pulseRunner';
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
  recentLinks: CellLink[],
  lastSeq: number,
  backfillActive: boolean,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborGraph,
  opts: PulsePlanningOptions,
  stats: PulseBatchStats,
): { planned: Pulse[]; nextSeq: number } {
  const { toFire, nextSeq, suppressed } = advanceLinkCursor(
    recentLinks,
    lastSeq,
    backfillActive,
  );
  if (suppressed > 0) stats.bump('backfill', suppressed);
  const planned: Pulse[] = [];
  for (const link of toFire) {
    const p = planPulses(link, cells, graph, opts, link.at_ms, stats);
    stats.observeLink(link.block, p.length > 0);
    for (const pulse of p) planned.push(pulse);
  }
  return { planned, nextSeq };
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
