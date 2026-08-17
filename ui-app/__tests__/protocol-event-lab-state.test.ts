import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Cell, CellGalaxySnapshot } from '@cknerv/types';
import { fromCellsSnapshot } from '@cknerv/cache';
import {
  advanceProtocolEventLab,
  PROTOCOL_EVENT_MEMORY_TRACE_AT_S,
  PROTOCOL_EVENT_MEMORY_TRACE_PULSES,
  PROTOCOL_EVENT_STAGE_TIME_S,
  protocolEventMemoryTraceRequest,
  protocolEventMemoryTraceTemplates,
  protocolEventLabSnapshot,
  protocolEventMemoryTraceFrame,
  protocolEventReviewNonce,
  protocolEventReviewTarget,
  protocolEventStage,
} from '../src/protocol-event-lab-state';

const LAB_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/ProtocolEventLab.tsx'),
  'utf8',
);

function cell(id: number, alive = true): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: alive ? null : 2,
    birth_block: 1,
    tag: id === 4 ? 'data' : null,
    pos_seed: [id, 0, -id],
    out_point: { tx_hash: `0x${String(id).padStart(64, '0')}`, index: 0 },
    capacity: 61e8,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

const cellTxHash = (id: number): string => `0x${String(id).padStart(64, '0')}`;

const snapshot = (cells: Cell[]): CellGalaxySnapshot => ({
  cells,
  last_pulse_at_ms: 123,
  recent_links: [{
    tx_hash: `0x${'ab'.repeat(32)}`,
    block: 9,
    from_ids: [1],
    to_ids: [4],
    parents: [cellTxHash(3)],
    tag: 'data',
    at_ms: 90,
  }],
});

describe('protocol event lab state', () => {
  it('keeps diagnostic write history separate from the consumed render queue', () => {
    expect(LAB_SOURCE).toContain('const writtenCellIdsRef = useRef<Set<number>>');
    expect(LAB_SOURCE).toContain('consumedCellIdsRef={writtenCellIdsRef}');
    expect(LAB_SOURCE).toContain('writtenCellIdsRef.current.clear()');
    expect(LAB_SOURCE).not.toContain('[...burstArrivalRef.current.keys()]');
  });

  it('keeps a bounded real live-Cell field and resets only the review clock', () => {
    const selected = protocolEventLabSnapshot(
      snapshot([cell(1, false), cell(2), cell(3), cell(4)]),
      2,
    );
    expect(selected.cells.map((item) => item.id)).toEqual([3, 4]);
    expect(selected.last_pulse_at_ms).toBe(0);
    expect(selected.recent_links?.[0]?.tx_hash).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('advances one pulse by replaying an observed causal link over the existing Cell Map', () => {
    const field = protocolEventLabSnapshot(snapshot([
      cell(1), cell(2), cell(3), cell(4), cell(5),
    ]));
    const cache = fromCellsSnapshot(1, { ...field, recent_links: [] });
    const next = advanceProtocolEventLab(cache, 10_000, field.recent_links);

    expect(next.cells).toBe(cache.cells);
    expect(next.lastPulseAtMs).toBe(10_000);
    expect(next.linksSeq).toBe(cache.linksSeq + 1);
    expect(next.recentLinks.at(-1)?.at_ms).toBe(10_000);
    expect(next.recentLinks.at(-1)?.tx_hash).toBe(`0x${'ab'.repeat(32)}`);
    expect(next.recentLinks.at(-1)?.from_ids).toEqual([1]);
    expect(next.recentLinks.at(-1)?.to_ids).toEqual([4]);
    expect(next.pulseLinks).toEqual(next.recentLinks);
    expect(cache.recentLinks).toEqual([]);
    expect(cache.pulseLinks).toEqual([]);
    expect(next.cellsToken).toBe(cache.cellsToken);
    expect(next.cellChanges).toMatchObject({ reset: false, baseToken: null });
  });

  it('labels the network, carrier, commit, and settled review windows', () => {
    expect(protocolEventStage(0.2)).toBe('network');
    expect(protocolEventStage(1.4)).toBe('carrier');
    expect(protocolEventStage(1.6)).toBe('commit');
    expect(protocolEventStage(3.4)).toBe('commit');
    expect(protocolEventStage(6.2)).toBe('settled');
  });

  it('provides stable direct-link times inside every review stage', () => {
    for (const [stage, at] of Object.entries(PROTOCOL_EVENT_STAGE_TIME_S)) {
      expect(protocolEventStage(at)).toBe(stage);
      expect(protocolEventReviewTarget(`?stage=${stage}`)).toBe(at);
    }
    expect(protocolEventReviewTarget('?at=2.75&stage=network')).toBe(2.75);
    expect(protocolEventReviewTarget('?at=-1')).toBe(0);
    expect(protocolEventReviewTarget('?at=99')).toBe(7.95);
    expect(protocolEventReviewTarget('?at=nope&stage=commit')).toBe(3.4);
    expect(protocolEventReviewTarget('?stage=nope')).toBeNull();
  });

  it('uses deterministic monotonic block identities for review cycles', () => {
    expect(protocolEventReviewNonce(1)).toBe(protocolEventReviewNonce(0));
    expect(protocolEventReviewNonce(2) - protocolEventReviewNonce(1)).toBe(8_000);
    expect(protocolEventReviewNonce(12)).toBe(protocolEventReviewNonce(12));
  });

  it('arms one stable production memory replay only after the write settles', () => {
    const field = protocolEventLabSnapshot(snapshot([
      cell(1), cell(2), cell(3), cell(4), cell(5),
    ]));
    const cache = fromCellsSnapshot(1, { ...field, recent_links: [] });
    const advanced = advanceProtocolEventLab(cache, 10_000, field.recent_links);

    expect(protocolEventMemoryTraceRequest(
      true,
      PROTOCOL_EVENT_MEMORY_TRACE_AT_S - 0.01,
      2,
      advanced.recentLinks,
    )).toBeNull();
    expect(protocolEventMemoryTraceRequest(
      false,
      PROTOCOL_EVENT_MEMORY_TRACE_AT_S,
      2,
      advanced.recentLinks,
    )).toBeNull();
    expect(protocolEventMemoryTraceRequest(
      true,
      PROTOCOL_EVENT_MEMORY_TRACE_AT_S,
      2,
      advanced.recentLinks,
    )).toEqual({
      linkSeq: advanced.recentLinks.at(-1)?.seq,
      nonce: 2,
    });
  });

  it('keeps the lab recall on one real, graph-routable observed template', () => {
    const field = protocolEventLabSnapshot(snapshot([
      cell(1), cell(2), cell(3), cell(4), cell(5),
    ]));
    const cache = fromCellsSnapshot(1, { ...field, recent_links: [] });
    const templates = protocolEventMemoryTraceTemplates(
      cache,
      field.recent_links ?? [],
    );

    expect(templates).toHaveLength(1);
    expect(templates[0]).toBe(field.recent_links?.[0]);
    expect(templates[0].tx_hash).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('prefers a real multi-witness record for deterministic visual review', () => {
    const cells = [cell(2), cell(3), cell(4), cell(5)];
    const cache = fromCellsSnapshot(1, { cells, last_pulse_at_ms: 0 });
    const single = {
      tx_hash: `0x${'aa'.repeat(32)}`,
      block: 10,
      from_ids: [99],
      to_ids: [5],
      parents: [cellTxHash(2)],
      tag: null,
      at_ms: 100,
    };
    const multiple = {
      tx_hash: `0x${'bb'.repeat(32)}`,
      block: 11,
      from_ids: [98],
      to_ids: [4],
      parents: [cellTxHash(2), cellTxHash(3)],
      tag: null,
      at_ms: 110,
    };

    const templates = protocolEventMemoryTraceTemplates(cache, [multiple, single]);

    expect(templates).toEqual([multiple]);
  });

  it('frames the exact routed witnesses and shared record without invented points', () => {
    const record = {
      tx_hash: `0x${'cc'.repeat(32)}`,
      block: 12,
      from_ids: [97],
      to_ids: [4],
      parents: [cellTxHash(2), cellTxHash(3)],
      tag: null,
      at_ms: 120,
    };
    const cache = fromCellsSnapshot(1, {
      cells: [cell(2), cell(3), cell(4)],
      last_pulse_at_ms: 0,
      recent_links: [record],
    });

    const frame = protocolEventMemoryTraceFrame(cache);

    expect(PROTOCOL_EVENT_MEMORY_TRACE_PULSES).toBe(2);
    expect(frame?.sourceIds).toEqual([2, 3]);
    expect(frame?.targetIds).toEqual([4]);
    expect(frame?.center).toEqual([3, 0, -3]);
    expect(frame?.radius).toBeCloseTo(Math.SQRT2 * 1.12);
  });
});
