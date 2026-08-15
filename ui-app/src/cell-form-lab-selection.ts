import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type { Cell, CellGalaxySnapshot } from '@cknerv/types';

export function observedLabDataBytes(cell: Cell): number {
  const value = cell.data_hex.endsWith(DATA_HEX_TRUNCATION_MARKER)
    ? cell.data_hex.slice(0, -1)
    : cell.data_hex;
  return Math.floor((value.startsWith('0x') ? value.length - 2 : value.length) / 2);
}

/** Resolve a stable real Cell for direct-linked visual comparisons. */
export function selectInitialLabCell(
  snapshot: CellGalaxySnapshot,
  search: string,
): Cell | null {
  const params = new URLSearchParams(search);
  const requestedParam = params.get('cell');
  const requestedId = Number(requestedParam);
  if (requestedParam !== null && Number.isFinite(requestedId)) {
    const requested = snapshot.cells.find((cell) => cell.id === requestedId);
    if (requested) return requested;
  }
  if (params.get('sample') === 'content') {
    return snapshot.cells.reduce<Cell | null>((richest, cell) => (
      richest === null || observedLabDataBytes(cell) > observedLabDataBytes(richest)
        ? cell
        : richest
    ), null);
  }
  return snapshot.cells.find((cell) => (cell.asset_kind ?? 'other') === 'native')
    ?? snapshot.cells[0]
    ?? null;
}
