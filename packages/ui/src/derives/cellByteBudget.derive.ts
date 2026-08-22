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
  /** Occupied capacity over total capacity (1 CKB of capacity buys 1 byte of
   *  state), clamped [0,1]. Measured against `occupiedShannons`, so an exact
   *  figure sets the percentage even where the itemized bytes cannot. */
  utilization: number;
  /** Capacity exactly as the Cell carries it. */
  capacityShannons: bigint;
  /** Occupied capacity: the source's own exact figure when it stated one,
   *  else the itemized bytes priced at 1 CKB each. */
  occupiedShannons: bigint;
  /** True when `occupiedShannons` is the source's figure rather than our sum
   *  of the bytes it itemized. */
  occupiedExact: boolean;
  /** Capacity nobody is occupying — the third figure of the triple, and the
   *  only one that answers "how much more could this Cell hold". Negative
   *  would mean capacity and occupancy disagree; it is not hidden. */
  freeShannons: bigint;
  /** Whole bytes of occupied capacity the breakdown never itemized — script
   *  args, in practice. Zero when there is no exact figure to disagree, or
   *  when it does not outrun the bytes. */
  residualBytes: number;
}

const SHANNONS_PER_BYTE = 100_000_000n;

/** The exact occupied figure, or null when the source stated none — or
 *  stated something that is not a plain decimal shannon count. A malformed
 *  string falls back to the bytes we can add up ourselves; it never becomes
 *  NaN, and never throws out of a render. */
function parseExactShannons(value: string | undefined): bigint | null {
  if (typeof value !== 'string') return null;
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return null;
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

function toShannons(capacity: number | bigint): bigint {
  if (typeof capacity === 'bigint') return capacity;
  return Number.isFinite(capacity) ? BigInt(Math.round(capacity)) : 0n;
}

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
  const capacity = toShannons(capacityShannons);
  // The two occupancy figures answer different questions and are allowed to
  // disagree: the bytes itemize what the breakdown can name, the exact figure
  // counts everything the Cell actually pays for. Where they differ the
  // difference IS the evidence — unindexed script args — so it is carried out
  // of here as its own number rather than averaged away.
  const byteDerived = BigInt(total) * SHANNONS_PER_BYTE;
  const exact = parseExactShannons(knowledge.occupied_shannons);
  const occupiedShannons = exact ?? byteDerived;
  const residual = exact !== null && exact > byteDerived
    ? exact - byteDerived
    : 0n;
  const utilization = capacity > 0n
    ? Math.min(1, Math.max(0, Number(occupiedShannons) / Number(capacity)))
    : 0;
  return {
    totalBytes: total,
    segments,
    utilization,
    capacityShannons: capacity,
    occupiedShannons,
    occupiedExact: exact !== null,
    freeShannons: capacity - occupiedShannons,
    residualBytes: Number(residual / SHANNONS_PER_BYTE),
  };
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
