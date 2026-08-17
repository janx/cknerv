import { describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import { deriveCellConsensusIdentity } from '../../src/derives/cellConsensusIdentity.derive';

const cell: Cell = {
  id: 42,
  born_at_ms: 1_000,
  death_at_ms: null,
  birth_block: 808,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 3 },
  capacity: 6_100_000_000,
  data_hex: '0x1234',
  data_bytes: 2,
  content_hash: `0x${'cd'.repeat(32)}`,
  lock_shape_seed: [1, 2],
  type_shape_seed: null,
  data_shape_seed: [3, 4],
};

const link = (over: Partial<CellLink> = {}): CellLink => ({
  seq: 1,
  tx_hash: cell.out_point.tx_hash,
  block: cell.birth_block,
  from_ids: [7, 8],
  to_ids: [cell.id, 43, 44],
  endpoint_anchors: [],
  parents: [],
  tag: null,
  at_ms: 1_200,
  ...over,
});

describe('deriveCellConsensusIdentity', () => {
  it('derives immutable address, fingerprint, anchor, and lifecycle from the Cell', () => {
    expect(deriveCellConsensusIdentity(cell)).toEqual({
      txHash: cell.out_point.tx_hash,
      outPointIndex: 3,
      contentHash: cell.content_hash,
      anchorBlock: 808,
      lifecycle: 'live',
      observedWrite: null,
    });

    expect(deriveCellConsensusIdentity({ ...cell, death_at_ms: 2_000 }).lifecycle)
      .toBe('spent');
  });

  it('retains exact origin evidence and chooses the newest matching cache sequence', () => {
    const identity = deriveCellConsensusIdentity(cell, [
      link(),
      link({ seq: 9, at_ms: 9_000, from_ids: [1], to_ids: [42] }),
    ]);

    expect(identity.observedWrite).toEqual({
      seq: 9,
      txHash: cell.out_point.tx_hash,
      block: 808,
      atMs: 9_000,
      inputCount: 1,
      outputCount: 1,
    });
  });

  it('does not claim a write from a partial or stale match', () => {
    const mismatches = [
      link({ to_ids: [99] }),
      link({ seq: 2, tx_hash: `0x${'ef'.repeat(32)}` }),
      link({ seq: 3, block: cell.birth_block + 1 }),
    ];

    expect(deriveCellConsensusIdentity(cell, mismatches).observedWrite).toBeNull();
  });

  it('matches canonical transaction hashes case-insensitively', () => {
    const upper = link({ tx_hash: cell.out_point.tx_hash.toUpperCase() });
    expect(deriveCellConsensusIdentity(cell, [upper]).observedWrite?.seq).toBe(1);
  });
});
