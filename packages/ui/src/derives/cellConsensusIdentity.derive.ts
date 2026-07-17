import type { Cell, CellLink } from '@cknerv/types';

export interface CellWriteEvidence {
  /** Monotonic cache sequence of the retained causal link. */
  seq: number;
  txHash: string;
  block: number;
  atMs: number;
  inputCount: number;
  outputCount: number;
}

export interface CellConsensusIdentity {
  txHash: string;
  outPointIndex: number;
  contentHash: string;
  anchorBlock: number;
  lifecycle: 'live' | 'spent';
  /**
   * Present only when the retained causal-link ring contains the exact origin
   * of this Cell. A matching id alone is deliberately insufficient: the tx
   * hash and birth block must also agree with the canonical Cell record.
   */
  observedWrite: CellWriteEvidence | null;
}

const canonicalHash = (value: string): string => value.toLowerCase();

/** Find the newest retained causal link that exactly created this Cell. */
export function findCellOriginLink(
  cell: Cell,
  recentLinks: readonly CellLink[],
): CellLink | null {
  const cellTxHash = canonicalHash(cell.out_point.tx_hash);
  let origin: CellLink | null = null;

  for (const link of recentLinks) {
    const exactOrigin = link.to_ids.includes(cell.id)
      && canonicalHash(link.tx_hash) === cellTxHash
      && link.block === cell.birth_block;
    if (!exactOrigin) continue;
    if (
      origin === null
      || link.seq > origin.seq
      || (link.seq === origin.seq && link.at_ms > origin.at_ms)
    ) {
      origin = link;
    }
  }

  return origin;
}

/**
 * Shapes immutable Cell identity plus optional, retained origin evidence for
 * the detail HUD. This never upgrades a generic chain record into a "recent
 * write" unless all three canonical coordinates agree.
 */
export function deriveCellConsensusIdentity(
  cell: Cell,
  recentLinks: readonly CellLink[] = [],
): CellConsensusIdentity {
  const origin = findCellOriginLink(cell, recentLinks);

  return {
    txHash: cell.out_point.tx_hash,
    outPointIndex: cell.out_point.index,
    contentHash: cell.content_hash,
    anchorBlock: cell.birth_block,
    lifecycle: cell.death_at_ms === null ? 'live' : 'spent',
    observedWrite: origin === null
      ? null
      : {
          seq: origin.seq,
          txHash: origin.tx_hash,
          block: origin.block,
          atMs: origin.at_ms,
          inputCount: origin.from_ids.length,
          outputCount: origin.to_ids.length,
        },
  };
}
