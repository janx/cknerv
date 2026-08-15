import type {
  Cell,
  CellLink,
  CellLinkEndpointAnchor,
} from '@cknerv/types';
import type { CellById } from '../types';
import { findCellOriginLink } from './cellConsensusIdentity.derive';

/** Anchor completeness of one selected Cell's retained origin transaction. */
export type CellCausalLensStatus = 'exact' | 'partial' | 'unavailable';

export type CellCausalEndpointRole = 'input' | 'selected' | 'sibling';

export interface CellCausalEndpoint {
  /** Projection Cell id recorded by the causal link. */
  id: number;
  /** Stable order inside the recorded transaction endpoint list. */
  ordinal: number;
  role: CellCausalEndpointRole;
  /**
   * Immutable evidence position/content captured by the transaction link.
   * Unlike the full record, this survives live-cache GC.
   */
  anchor: CellLinkEndpointAnchor | null;
  /**
   * Full projection record when it is still retained. A null record makes the
   * anchored endpoint non-navigable; it does not erase its evidence geometry.
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
  /**
   * The retained origin record itself. Published so callers that need the raw
   * link — recall planning reads its parents and endpoint anchors — reuse this
   * lookup instead of scanning the causal ring a second time.
   */
  originLink: CellLink | null;
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

function anchorFromCell(cell: Cell): CellLinkEndpointAnchor {
  return {
    id: cell.id,
    pos_seed: [...cell.pos_seed],
    content_hash: cell.content_hash,
  };
}

function anchorsById(
  anchors: readonly CellLinkEndpointAnchor[],
): ReadonlyMap<number, CellLinkEndpointAnchor> {
  const byId = new Map<number, CellLinkEndpointAnchor>();
  for (const anchor of anchors) {
    if (!byId.has(anchor.id)) byId.set(anchor.id, anchor);
  }
  return byId;
}

function endpoint(
  id: number,
  ordinal: number,
  role: CellCausalEndpointRole,
  selectedCell: Cell,
  cells: CellById,
  linkAnchors: ReadonlyMap<number, CellLinkEndpointAnchor>,
): CellCausalEndpoint {
  const record = role === 'selected' ? selectedCell : cells.get(id) ?? null;
  return {
    id,
    ordinal,
    role,
    anchor: linkAnchors.get(id) ?? (record ? anchorFromCell(record) : null),
    record,
  };
}

/**
 * Resolve the selected Cell's real transaction neighbourhood.
 *
 * `exact` means the exact origin link and every endpoint evidence anchor remain
 * available, even when full spent-Cell records have left the live cache.
 * `partial` means the link is authoritative but one or more anchors are absent.
 * `unavailable` means only the selected Cell's immutable tx/block identity
 * remains; no relationship is inferred from a hash-only, block-only, or
 * spatial match.
 */
export function deriveCellCausalLens(
  selectedCell: Cell,
  recentLinks: readonly CellLink[],
  cells: CellById,
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
      originLink: null,
      observedAtMs: null,
      inputCount: null,
      outputCount: null,
      inputs: [],
      outputs: [{
        id: selectedCell.id,
        ordinal: selectedCell.out_point.index,
        role: 'selected',
        anchor: anchorFromCell(selectedCell),
        record: selectedCell,
      }],
      missingInputIds: [],
      missingOutputIds: [],
    };
  }

  const inputIds = uniqueIds(origin.from_ids);
  const outputIds = uniqueIds(origin.to_ids);
  const linkAnchors = anchorsById(origin.endpoint_anchors);
  const inputs = inputIds.map((id, ordinal) => endpoint(
    id,
    ordinal,
    'input',
    selectedCell,
    cells,
    linkAnchors,
  ));
  const outputs = outputIds.map((id, ordinal) => endpoint(
    id,
    ordinal,
    id === selectedCell.id ? 'selected' : 'sibling',
    selectedCell,
    cells,
    linkAnchors,
  ));
  const missingInputIds = inputs.flatMap((item) => (
    item.anchor ? [] : [item.id]
  ));
  const missingOutputIds = outputs.flatMap((item) => (
    item.anchor ? [] : [item.id]
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
    originLink: origin,
    observedAtMs: origin.at_ms,
    inputCount: inputs.length,
    outputCount: outputs.length,
    inputs,
    outputs,
    missingInputIds,
    missingOutputIds,
  };
}
