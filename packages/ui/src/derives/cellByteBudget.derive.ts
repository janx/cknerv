import type { CommonKnowledgeBreakdown } from '@cknerv/types';

export type ByteBudgetSegmentKey = 'cap' | 'lock' | 'type' | 'data';

export interface ByteBudgetSegment {
  key: ByteBudgetSegmentKey;
  label: string;
  bytes: number;
  /** Share of the OCCUPIED total (never of capacity), 0..1 — tiny occupancy
   *  must still fill the composition bar. */
  share: number;
}

export interface CellByteBudgetModel {
  totalBytes: number;
  /** Zero-byte components carry no segment. */
  segments: ByteBudgetSegment[];
  /** Occupied bytes over the capacity's byte budget (1 CKB of capacity buys
   *  1 byte of state), clamped [0,1]. */
  utilization: number;
}

const SHANNONS_PER_CKB = 100_000_000;

export function deriveCellByteBudget(
  knowledge: CommonKnowledgeBreakdown | null | undefined,
  capacityShannons: number | bigint,
): CellByteBudgetModel | null {
  if (!knowledge || knowledge.total_bytes <= 0) return null;
  const total = knowledge.total_bytes;
  const segments = ([
    ['cap', 'CAP', knowledge.capacity_field_bytes],
    ['lock', 'LOCK', knowledge.lock_script_bytes],
    ['type', 'TYPE', knowledge.type_script_bytes],
    ['data', 'DATA', knowledge.data_bytes],
  ] as const)
    .filter(([, , bytes]) => bytes > 0)
    .map(([key, label, bytes]) => ({ key, label, bytes, share: bytes / total }));
  const capacityBytes = Number(capacityShannons) / SHANNONS_PER_CKB;
  const utilization = capacityBytes > 0
    ? Math.min(1, Math.max(0, total / capacityBytes))
    : 0;
  return { totalBytes: total, segments, utilization };
}

/** Byte totals in the `formatDataSize` family (`102 B`), grouping pinned so
 *  it cannot drift with the viewer's locale. */
export function formatByteCount(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} B`;
}

/** Occupancy percentage at honest precision: anything real but under one
 *  percent says `<1%` instead of rounding to a flat zero; above that, at
 *  most one decimal. Input is clamped to [0,1]. */
export function formatUtilizationPercent(ratio: number): string {
  const pct = Math.min(1, Math.max(0, ratio)) * 100;
  if (pct === 0) return '0%';
  if (pct < 1) return '<1%';
  const text = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1).replace(/\.0$/, '');
  return `${text}%`;
}
