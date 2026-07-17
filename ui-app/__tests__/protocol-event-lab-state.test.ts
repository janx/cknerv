import { describe, expect, it } from 'vitest';
import type { Cell, CellGalaxySnapshot } from '@cknerv/types';
import { fromCellsSnapshot } from '@cknerv/cache';
import {
  advanceProtocolEventLab,
  PROTOCOL_EVENT_MEMORY_TRACE_AT_S,
  PROTOCOL_EVENT_STAGE_TIME_S,
  protocolEventMemoryTraceRequest,
  protocolEventMemoryTraceTemplates,
  protocolEventLabSnapshot,
  protocolEventReviewNonce,
  protocolEventReviewTarget,
  protocolEventStage,
} from '../src/protocol-event-lab-state';

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
    content_hash: `0x${String(id).padStart(64, '0')}`,
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
    expect(cache.recentLinks).toEqual([]);
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
});
