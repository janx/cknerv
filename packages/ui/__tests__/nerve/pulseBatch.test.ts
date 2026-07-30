// Pure unit tests for the pulse-batch helpers extracted from NeuralNetwork's
// effects. These cover the wiring logic that cannot be observed through the
// jsdom <Canvas> harness (r3f v8 never mounts Canvas children at 0×0), using
// the REAL pulseStats singleton + resetPulseStats() — same idiom as
// pulseRunner.test.ts (Tasks 1-3).

import { beforeEach, describe, expect, it } from 'vitest';
import { fromCellsSnapshot } from '@cknerv/cache';
import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import type { PulsePlanningOptions } from '../../src/nerve/pulseRunner';
import {
  planLinkBatch,
  prunePulsesFromBlock,
  scheduleLivePulseStartSec,
  tickBlockIfAdvanced,
} from '../../src/nerve/pulseBatch';
import { pulseStats, resetPulseStats, snapshotPulseStats } from '../../src/nerve/pulseStats';

beforeEach(() => resetPulseStats());

function mkCell(id: number, txHash: string): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: txHash, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: '0x' + '00'.repeat(32),
  };
}
function mkLink(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 1,
    tx_hash: '0xtx',
    block: 1,
    from_ids: [],
    to_ids: [2],
    endpoint_anchors: [],
    parents: ['0xparent'],
    tag: null,
    at_ms: 0,
    ...over,
  };
}
function mkGraph(edges: [number, number][]): NeighborGraph {
  const adjacency = new Map<number, Set<number>>();
  const add = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const [a, b] of edges) add(a, b);
  return {
    adjacency,
    edges: edges.map(([a, b]) => ({ from: Math.min(a, b), to: Math.max(a, b), d: 1 })),
  };
}

const OPTS: PulsePlanningOptions = {};

describe('planLinkBatch', () => {
  it('does not replay snapshot evidence as live pulse traffic', () => {
    const { seq: _seq, ...record } = mkLink({ seq: 9, at_ms: 9000 });
    const cache = fromCellsSnapshot(12, {
      cells: [mkCell(1, '0xparent'), mkCell(2, '0xtx')],
      last_pulse_at_ms: 9000,
      recent_links: [record],
    });

    const { planned, nextSeq } = planLinkBatch(
      cache.pulseLinks,
      0,
      false,
      cache.cells,
      mkGraph([[1, 2]]),
      OPTS,
      pulseStats,
    );

    expect(cache.recentLinks).toHaveLength(1);
    expect(cache.pulseLinks).toEqual([]);
    expect(planned).toEqual([]);
    expect(nextSeq).toBe(0);
    expect(snapshotPulseStats().blocksWithLinks).toBe(0);
  });

  it('suppresses every link during backfill: no pulses, cursor still advances, backfill bumped by the SUPPRESSED count, block excluded from the rollup', () => {
    const { planned, nextSeq } = planLinkBatch(
      [mkLink({ seq: 1 }), mkLink({ seq: 2 })],
      0,
      true, // backfillActive
      new Map<number, Cell>(),
      mkGraph([]),
      OPTS,
      pulseStats,
    );
    expect(planned).toEqual([]);
    expect(nextSeq).toBe(2); // cursor advanced past both links
    const snap = snapshotPulseStats();
    // Proves the bump uses `suppressed` (2) — not 1, not toFire.length (0).
    expect(snap.linkReasons.backfill).toBe(2);
    // Loop skipped → observeLink NOT called → backfilled block excluded.
    expect(snap.blocksWithLinks).toBe(0);
  });

  it('plans a pulse for a routable link and folds the open lit block into the rollup', () => {
    // Source cell born from 0xparent + a direct graph edge to the output id.
    const cells = new Map<number, Cell>([[1, mkCell(1, '0xparent')]]);
    const graph = mkGraph([[1, 2]]);
    const { planned, nextSeq } = planLinkBatch(
      [mkLink({ seq: 1, block: 7, parents: ['0xparent'], to_ids: [2] })],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
    );
    expect(planned.length).toBe(1);
    expect(planned[0]).toMatchObject({ linkSeq: 1, linkBlock: 7 });
    expect(nextSeq).toBe(1);
    const snap = snapshotPulseStats();
    expect(snap.linkReasons.fired).toBe(1);
    expect(snap.blocksWithLinks).toBe(1); // open block folded in
    expect(snap.blocksLit).toBe(1);
  });

  it('records observeLink for a DROPPED (no-source) link too — lit=false, so the block is with-links but dark', () => {
    // Parent tx (0xparent) has no alive cell → planPulses drops with no-source.
    const cells = new Map<number, Cell>([[9, mkCell(9, '0xother')]]);
    const { planned } = planLinkBatch(
      [mkLink({ seq: 1, block: 7, parents: ['0xparent'], to_ids: [2] })],
      0,
      false,
      cells,
      mkGraph([]),
      OPTS,
      pulseStats,
    );
    expect(planned.length).toBe(0);
    const snap = snapshotPulseStats();
    expect(snap.linkReasons['no-source']).toBe(1);
    // observeLink fires for EVERY link, incl. the dropped/empty one (lit=false).
    expect(snap.blocksWithLinks).toBe(1);
    expect(snap.blocksLit).toBe(0);
  });

  it('removes already-planned pulses from orphaned blocks only', () => {
    const cells = new Map<number, Cell>([[1, mkCell(1, '0xparent')]]);
    const graph = mkGraph([[1, 2]]);
    const canonical = planLinkBatch(
      [mkLink({ seq: 1, block: 6 })],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
    ).planned;
    const orphaned = planLinkBatch(
      [mkLink({ seq: 2, block: 7 })],
      1,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
    ).planned;

    expect(prunePulsesFromBlock([...canonical, ...orphaned], 7))
      .toEqual(canonical);
  });
});

describe('tickBlockIfAdvanced', () => {
  it('seeds without ticking on the bootstrap value (lastSeen === 0)', () => {
    const next = tickBlockIfAdvanced(1000, 0, pulseStats);
    expect(next).toBe(1000);
    expect(snapshotPulseStats().blocksTotal).toBe(0);
  });

  it('ticks when the value strictly advances past a non-zero lastSeen', () => {
    const next = tickBlockIfAdvanced(1001, 1000, pulseStats);
    expect(next).toBe(1001);
    expect(snapshotPulseStats().blocksTotal).toBe(1);
  });

  it('does not tick and returns lastSeen unchanged when the value does not advance', () => {
    expect(tickBlockIfAdvanced(1000, 1000, pulseStats)).toBe(1000);
    expect(tickBlockIfAdvanced(999, 1000, pulseStats)).toBe(1000);
    expect(snapshotPulseStats().blocksTotal).toBe(0);
  });
});

describe('scheduleLivePulseStartSec', () => {
  it('keeps live nerve traffic behind the caller-supplied protocol delay', () => {
    expect(scheduleLivePulseStartSec(10, 1.6)).toBeCloseTo(11.6, 9);
  });

  it('does not let invalid or negative delays move traffic before now', () => {
    expect(scheduleLivePulseStartSec(10, -1)).toBe(10);
    expect(scheduleLivePulseStartSec(10, Number.NaN)).toBe(10);
  });
});
