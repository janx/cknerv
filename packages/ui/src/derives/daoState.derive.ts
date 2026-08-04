import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';

export type DaoStateVisualState = 'ready' | 'stale';

export const DAO_STATE_STALE_AFTER_MS = 180_000;

const MAX_U128_DECIMAL_DIGITS = 39;
const MAX_U32 = 0xffff_ffff;
const MIN_I32 = -0x8000_0000;
const MAX_I32 = 0x7fff_ffff;

export interface DaoStateVisual {
  totalDepositedShannons: bigint;
  pendingWithdrawalShannons: bigint;
  unclaimedCompensationShannons: bigint;
  depositChange24hShannons: bigint | null;
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseUnsigned(value: string): bigint | null {
  if (!/^\d+$/.test(value) || value.length > MAX_U128_DECIMAL_DIGITS) return null;
  return BigInt(value);
}

function parseSigned(value: string): bigint | null {
  const magnitude = value.startsWith('-') ? value.slice(1) : value;
  if (!/^\d+$/.test(magnitude) || magnitude.length > MAX_U128_DECIMAL_DIGITS) {
    return null;
  }
  return BigInt(value);
}

/** Suppress DAO context whose optional source or canonical proof is unusable. */
export function daoStateVisualState(
  source: EnrichmentSourceStatus,
  record: DaoStateRecord,
  nowMs = Date.now(),
): DaoStateVisualState | null {
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  if (!source.capabilities.includes('dao_state')) return null;
  if (source.source !== record.source) return null;
  const anchor = source.validated_anchor;
  if (!anchor
    || !safeNonnegativeInteger(anchor.block)
    || !safeNonnegativeInteger(record.as_of.block)
    || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  if (!safeNonnegativeInteger(record.updated_at_ms)) return null;
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  return source.status === 'stale' || ageMs > DAO_STATE_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

/** Validate exact integer DAO values before they reach the HUD. */
export function deriveDaoStateVisual(record: DaoStateRecord): DaoStateVisual | null {
  if (!safeNonnegativeInteger(record.as_of.block)
    || !safeNonnegativeInteger(record.statistics_block)
    || record.statistics_block > record.as_of.block) return null;
  if (!safeNonnegativeInteger(record.total_depositors)
    || record.total_depositors > MAX_U32
    || !safeNonnegativeInteger(record.active_deposits)
    || record.active_deposits > MAX_U32
    || !safeNonnegativeInteger(record.estimated_apc_bps)
    || record.estimated_apc_bps > 10_000) return null;
  if (record.depositors_change_24h !== undefined
    && (!Number.isSafeInteger(record.depositors_change_24h)
      || record.depositors_change_24h < MIN_I32
      || record.depositors_change_24h > MAX_I32)) return null;

  const totalDepositedShannons = parseUnsigned(record.total_deposited_shannons);
  const pendingWithdrawalShannons = parseUnsigned(record.pending_withdrawal_shannons);
  const unclaimedCompensationShannons = parseUnsigned(
    record.unclaimed_compensation_shannons,
  );
  const depositChange24hShannons = record.deposit_change_24h_shannons === undefined
    ? null
    : parseSigned(record.deposit_change_24h_shannons);
  if (totalDepositedShannons === null
    || pendingWithdrawalShannons === null
    || unclaimedCompensationShannons === null
    || (record.deposit_change_24h_shannons !== undefined
      && depositChange24hShannons === null)) return null;

  return {
    totalDepositedShannons,
    pendingWithdrawalShannons,
    unclaimedCompensationShannons,
    depositChange24hShannons,
  };
}
