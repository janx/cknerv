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
  evictPulseOverflow,
  planLinkBatch,
  prunePulsesFromBlock,
  scheduleLivePulseStartSec,
  tickBlockIfAdvanced,
} from '../../src/nerve/pulseBatch';
import { pulseStats, resetPulseStats, snapshotPulseStats } from '../../src/nerve/pulseStats';

beforeEach(() => resetPulseStats());

function mkCell(
  id: number,
  txHash: string,
  pos: [number, number, number] = [0, 0, 0],
): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: pos,
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
      0,
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
      0,
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
      0,
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
      0,
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
      0,
    ).planned;
    const orphaned = planLinkBatch(
      [mkLink({ seq: 2, block: 7 })],
      1,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      0,
    ).planned;

    expect(prunePulsesFromBlock([...canonical, ...orphaned], 7))
      .toEqual(canonical);
  });
});

describe('planLinkBatch — block-guarantee rescue', () => {
  const CH = '0x' + '00'.repeat(32);
  /** Chain 2—3—4—5 strung centre → rim along +x. Cells born of unrelated
   *  txs so a cold link (`parents: ['0xcold']`) drops with no-source. */
  function rimFixture() {
    const cells = new Map<number, Cell>([
      [2, mkCell(2, '0xu2', [10, 0, 0])],
      [3, mkCell(3, '0xu3', [20, 0, 0])],
      [4, mkCell(4, '0xu4', [30, 0, 0])],
      [5, mkCell(5, '0xu5', [40, 0, 0])],
    ]);
    return { cells, graph: mkGraph([[2, 3], [3, 4], [4, 5]]) };
  }
  const outAnchor = { id: 2, pos_seed: [10, 0, 0] as [number, number, number], content_hash: CH };

  it('rescues a dark non-empty block with a rim-entry pulse', () => {
    const { cells, graph } = rimFixture();
    const { planned, lastGuaranteedBlock } = planLinkBatch(
      [mkLink({
        seq: 1, block: 7, parents: ['0xcold'], to_ids: [2],
        endpoint_anchors: [outAnchor],
      })],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      0,
    );
    expect(planned.length).toBe(1);
    expect(planned[0]).toMatchObject({
      linkSeq: 1,
      linkBlock: 7,
      rescue: 'rim',
      path: [5, 4, 3, 2], // most rim-ward node on the dst radial, real edges in
    });
    expect(lastGuaranteedBlock).toBe(7);
    const snap = snapshotPulseStats();
    expect(snap.linkReasons['no-source']).toBe(1);
    expect(snap.linkReasons.fired).toBe(0); // rescue never inflates fired
    expect(snap.rescues.rim).toBe(1);
    expect(snap.blocksWithLinks).toBe(1);
    expect(snap.blocksLit).toBe(1); // rescued counts as lit …
    expect(snap.blocksLinksButDark).toBe(0); // … so the acceptance metric holds
  });

  it('departs from beside the consumed coin when the link carries input anchors', () => {
    const { cells: base } = rimFixture();
    const cells = new Map(base);
    cells.set(8, mkCell(8, '0xu8', [0, 0, 15]));
    cells.set(9, mkCell(9, '0xu9', [0, 0, 25]));
    cells.set(10, mkCell(10, '0xu10', [0, 0, 38]));
    const graph = mkGraph([[2, 3], [3, 4], [4, 5], [2, 8], [8, 9], [9, 10]]);
    const { planned } = planLinkBatch(
      [mkLink({
        seq: 1, block: 7, parents: ['0xcold'], from_ids: [77], to_ids: [2],
        endpoint_anchors: [
          { id: 77, pos_seed: [0, 0, 40], content_hash: CH }, // consumed coin
          outAnchor,
        ],
      })],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      0,
    );
    // Two nodes sit ≥3 hops out (5 and 10); the anchor pulls the origin to 10.
    expect(planned.length).toBe(1);
    expect(planned[0]).toMatchObject({ rescue: 'anchored', path: [10, 9, 8, 2] });
    expect(snapshotPulseStats().rescues.anchored).toBe(1);
  });

  it('never rescues a block that already lit — plans exactly the normal pulses', () => {
    const cells = new Map<number, Cell>([
      [1, mkCell(1, '0xparent')],
      [2, mkCell(2, '0xout')],
    ]);
    const graph = mkGraph([[1, 2]]);
    const { planned, lastGuaranteedBlock } = planLinkBatch(
      [
        mkLink({ seq: 1, block: 7, parents: ['0xparent'], to_ids: [2] }),
        mkLink({ seq: 2, block: 7, tx_hash: '0xtx2', parents: ['0xcold'], to_ids: [2], endpoint_anchors: [outAnchor] }),
      ],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      0,
    );
    expect(planned.length).toBe(1); // the fired link's pulse only
    expect(planned[0].rescue).toBeUndefined();
    expect(lastGuaranteedBlock).toBe(7);
    const snap = snapshotPulseStats();
    expect(snap.rescues).toEqual({ anchored: 0, rim: 0, 'dst-substituted': 0, failed: 0 });
  });

  it('a later batch slice of an already-guaranteed block never re-rescues', () => {
    const { cells, graph } = rimFixture();
    const cold = (seq: number, block: number) => mkLink({
      seq, block, tx_hash: `0xtx${seq}`, parents: ['0xcold'], to_ids: [2],
      endpoint_anchors: [outAnchor],
    });
    const first = planLinkBatch(
      [cold(1, 7)], 0, false, cells, graph, OPTS, pulseStats, 0,
    );
    expect(first.planned.length).toBe(1);
    expect(first.lastGuaranteedBlock).toBe(7);
    // Second slice: another dark block-7 link + a dark block-8 link.
    const second = planLinkBatch(
      [cold(2, 7), cold(3, 8)],
      first.planned.length ? 1 : 0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      first.lastGuaranteedBlock,
    );
    expect(second.planned.length).toBe(1); // block 8's rescue only
    expect(second.planned[0]).toMatchObject({ linkBlock: 8, rescue: 'rim' });
    expect(second.lastGuaranteedBlock).toBe(8);
    expect(snapshotPulseStats().rescues.rim).toBe(2);
  });

  it('cellbase-only dark blocks stay silent (2026-07-03 ruling upheld)', () => {
    const { cells, graph } = rimFixture();
    const { planned, lastGuaranteedBlock } = planLinkBatch(
      [mkLink({ seq: 1, block: 7, parents: [], to_ids: [2], endpoint_anchors: [outAnchor] })],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      0,
    );
    expect(planned).toEqual([]);
    expect(lastGuaranteedBlock).toBe(0);
    const snap = snapshotPulseStats();
    expect(snap.linkReasons['no-parents']).toBe(1);
    expect(snap.rescues).toEqual({ anchored: 0, rim: 0, 'dst-substituted': 0, failed: 0 });
    expect(snap.blocksLit).toBe(0);
  });

  it('a block starved by the batch budget still lights through its rescue', () => {
    const cells = new Map<number, Cell>([
      [1, mkCell(1, '0xparent')],
      [2, mkCell(2, '0xout')],
    ]);
    const graph = mkGraph([[1, 2]]);
    // 130 firing links in block 7 exhaust the 128-pulse budget…
    const links: CellLink[] = [];
    for (let i = 1; i <= 130; i++) {
      links.push(mkLink({ seq: i, block: 7, tx_hash: `0xtx${i}`, parents: ['0xparent'], to_ids: [2] }));
    }
    // …then block 8 arrives dark in the same batch.
    links.push(mkLink({
      seq: 131, block: 8, tx_hash: '0xcoldtx', parents: ['0xcold'], to_ids: [2],
      endpoint_anchors: [{ id: 2, pos_seed: [0, 0, 0], content_hash: CH }],
    }));
    const { planned } = planLinkBatch(
      links, 0, false, cells, graph, OPTS, pulseStats, 0,
    );
    expect(planned.length).toBe(129); // 128 budgeted + 1 exempt rescue
    expect(planned[128]).toMatchObject({ linkBlock: 8, rescue: 'rim' });
    const snap = snapshotPulseStats();
    // Links 129/130 of block 7 AND block 8's link all hit the budget —
    // the rescue is what lights block 8 anyway.
    expect(snap.linkReasons['batch-budget']).toBe(3);
    expect(snap.blocksLit).toBe(2);
    expect(snap.blocksLinksButDark).toBe(0);
  });

  it('a rescue is budget-NEUTRAL: it never steals the next block\'s last slot', () => {
    const cells = new Map<number, Cell>([
      [1, mkCell(1, '0xparent')],
      [2, mkCell(2, '0xu2', [10, 0, 0])],
      [3, mkCell(3, '0xu3', [20, 0, 0])],
      [4, mkCell(4, '0xu4', [30, 0, 0])],
      [5, mkCell(5, '0xu5', [40, 0, 0])],
    ]);
    const graph = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5]]);
    const links: CellLink[] = [
      // Block 7: one dark cold link → one rescue at its boundary.
      mkLink({
        seq: 1, block: 7, tx_hash: '0xcold7', parents: ['0xcold'], to_ids: [5],
        endpoint_anchors: [{ id: 5, pos_seed: [40, 0, 0], content_hash: CH }],
      }),
    ];
    // Block 8: exactly MAX_PULSES_PER_BATCH routable links — all must fire.
    for (let i = 0; i < 128; i++) {
      links.push(mkLink({
        seq: 2 + i, block: 8, tx_hash: `0xtx${i}`, parents: ['0xparent'], to_ids: [2],
      }));
    }
    const { planned } = planLinkBatch(
      links, 0, false, cells, graph, OPTS, pulseStats, 0,
    );
    expect(planned.length).toBe(129); // 1 rescue + the full 128 budget
    expect(planned[0]).toMatchObject({ linkBlock: 7, rescue: 'rim' });
    const snap = snapshotPulseStats();
    expect(snap.linkReasons['batch-budget']).toBe(0);
    expect(snap.blocksLit).toBe(2);
  });

  it('lands beside the newborn when none of the outputs are routable', () => {
    const { cells, graph } = rimFixture();
    const { planned } = planLinkBatch(
      [mkLink({
        seq: 1, block: 7, parents: ['0xcold'], to_ids: [99],
        endpoint_anchors: [{ id: 99, pos_seed: [9, 0, 0], content_hash: CH }],
      })],
      0,
      false,
      cells,
      graph,
      OPTS,
      pulseStats,
      0,
    );
    expect(planned.length).toBe(1);
    // Nearest in-graph node to the newborn's anchor (9,0,0) is 2 at (10,0,0).
    expect(planned[0]).toMatchObject({ rescue: 'rim', path: [5, 4, 3, 2] });
    const snap = snapshotPulseStats();
    expect(snap.rescues.rim).toBe(1);
    expect(snap.rescues['dst-substituted']).toBe(1);
  });

  it('counts live links evicted from the ring before the cursor saw them', () => {
    const { cells, graph } = rimFixture();
    const link = mkLink({ seq: 5, block: 9, parents: ['0xcold'], to_ids: [2], endpoint_anchors: [outAnchor] });
    // Ring head at seq 5 while the cursor sits at 2: seqs 3-4 are gone.
    planLinkBatch([link], 2, false, cells, graph, OPTS, pulseStats, 0);
    expect(snapshotPulseStats().ringEvicted).toBe(2);
    // During backfill the same gap is storm churn, not guarantee loss.
    resetPulseStats();
    planLinkBatch([link], 2, true, cells, graph, OPTS, pulseStats, 0);
    expect(snapshotPulseStats().ringEvicted).toBe(0);
  });

  it('counts an unrescuable dark block instead of inventing geometry', () => {
    // Empty graph, no anchors: nothing honest to route — stay dark, count it.
    const { planned } = planLinkBatch(
      [mkLink({ seq: 1, block: 7, parents: ['0xcold'], to_ids: [2] })],
      0,
      false,
      new Map<number, Cell>(),
      mkGraph([]),
      OPTS,
      pulseStats,
      0,
    );
    expect(planned).toEqual([]);
    const snap = snapshotPulseStats();
    expect(snap.rescues.failed).toBe(1);
    expect(snap.blocksLit).toBe(0);
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

describe('evictPulseOverflow', () => {
  function mkPulse(linkSeq: number, rescue?: 'anchored' | 'rim') {
    return {
      linkSeq,
      linkBlock: 1,
      path: [1, 2],
      bornAtMs: 0,
      color: [1, 1, 1] as [number, number, number],
      startDelayMs: 0,
      hopMs: 73,
      ...(rescue ? { rescue } : {}),
    };
  }

  it('returns the same array reference when under the cap', () => {
    const pool = [mkPulse(1), mkPulse(2)];
    expect(evictPulseOverflow(pool, 2)).toBe(pool);
  });

  it('sheds the oldest non-rescue pulses first', () => {
    const pool = [mkPulse(1, 'rim'), mkPulse(2), mkPulse(3), mkPulse(4, 'anchored'), mkPulse(5)];
    const kept = evictPulseOverflow(pool, 3);
    expect(kept.map((p) => p.linkSeq)).toEqual([1, 4, 5]);
  });

  it('sheds oldest rescues only once nothing else is left', () => {
    const pool = [mkPulse(1, 'rim'), mkPulse(2, 'rim'), mkPulse(3), mkPulse(4, 'anchored')];
    const kept = evictPulseOverflow(pool, 2);
    expect(kept.map((p) => p.linkSeq)).toEqual([2, 4]);
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
