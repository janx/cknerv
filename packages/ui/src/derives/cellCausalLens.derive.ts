import type { Cell, CellLink } from '@cknerv/types';
import { findCellOriginLink } from './cellConsensusIdentity.derive';

/** Endpoint completeness of one selected Cell's retained origin transaction. */
export type CellCausalLensStatus = 'exact' | 'partial' | 'unavailable';

export type CellCausalEndpointRole = 'input' | 'selected' | 'sibling';

export interface CellCausalEndpoint {
  /** Projection Cell id recorded by the causal link. */
  id: number;
  /** Stable order inside the recorded transaction endpoint list. */
  ordinal: number;
  role: CellCausalEndpointRole;
  /**
   * Exact projection record when it is still retained. Missing records stay
   * explicit instead of being replaced by a spatial neighbour or sibling.
   */
  record: Cell | null;
}

export interface CellCausalLens {
  /** Stable scene/remount identity for one selected origin observation. */
  key: string;
  selectedCell: Cell;
  status: CellCausalLensStatus;
  /** Immutable coordinates known from the selected Cell even without history. */
  txHash: string;
  block: number;
  /** Present only when the exact creating link remains in the causal ring. */
  linkSeq: number | null;
  observedAtMs: number | null;
  /** Unknown when the exact link has left the retained history window. */
  inputCount: number | null;
  outputCount: number | null;
  inputs: readonly CellCausalEndpoint[];
  /** Includes the selected output and every recorded sibling output. */
  outputs: readonly CellCausalEndpoint[];
  missingInputIds: readonly number[];
  missingOutputIds: readonly number[];
}

function uniqueIds(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function endpoint(
  id: number,
  ordinal: number,
  role: CellCausalEndpointRole,
  selectedCell: Cell,
  cells: ReadonlyMap<number, Cell>,
): CellCausalEndpoint {
  return {
    id,
    ordinal,
    role,
    record: role === 'selected' ? selectedCell : cells.get(id) ?? null,
  };
}

/**
 * Resolve the selected Cell's real transaction neighbourhood.
 *
 * `exact` means the exact origin link and all recorded endpoint Cell records
 * remain available. `partial` means the link is authoritative but one or more
 * endpoint records have left the live projection cache. `unavailable` means
 * only the selected Cell's immutable tx/block identity remains; no relationship
 * is inferred from a hash-only, block-only, or spatial match.
 */
export function deriveCellCausalLens(
  selectedCell: Cell,
  recentLinks: readonly CellLink[],
  cells: ReadonlyMap<number, Cell>,
): CellCausalLens {
  const origin = findCellOriginLink(selectedCell, recentLinks);
  const canonicalTxHash = selectedCell.out_point.tx_hash.toLowerCase();

  if (!origin) {
    return {
      key: `${selectedCell.id}:${canonicalTxHash}:${selectedCell.birth_block}:identity`,
      selectedCell,
      status: 'unavailable',
      txHash: selectedCell.out_point.tx_hash,
      block: selectedCell.birth_block,
      linkSeq: null,
      observedAtMs: null,
      inputCount: null,
      outputCount: null,
      inputs: [],
      outputs: [{
        id: selectedCell.id,
        ordinal: selectedCell.out_point.index,
        role: 'selected',
        record: selectedCell,
      }],
      missingInputIds: [],
      missingOutputIds: [],
    };
  }

  const inputIds = uniqueIds(origin.from_ids);
  const outputIds = uniqueIds(origin.to_ids);
  const inputs = inputIds.map((id, ordinal) => endpoint(
    id,
    ordinal,
    'input',
    selectedCell,
    cells,
  ));
  const outputs = outputIds.map((id, ordinal) => endpoint(
    id,
    ordinal,
    id === selectedCell.id ? 'selected' : 'sibling',
    selectedCell,
    cells,
  ));
  const missingInputIds = inputs.flatMap((item) => (
    item.record ? [] : [item.id]
  ));
  const missingOutputIds = outputs.flatMap((item) => (
    item.record ? [] : [item.id]
  ));
  const status: CellCausalLensStatus =
    missingInputIds.length === 0 && missingOutputIds.length === 0
      ? 'exact'
      : 'partial';

  return {
    key: `${selectedCell.id}:${canonicalTxHash}:${selectedCell.birth_block}:${origin.seq}`,
    selectedCell,
    status,
    txHash: origin.tx_hash,
    block: origin.block,
    linkSeq: origin.seq,
    observedAtMs: origin.at_ms,
    inputCount: inputs.length,
    outputCount: outputs.length,
    inputs,
    outputs,
    missingInputIds,
    missingOutputIds,
  };
}
