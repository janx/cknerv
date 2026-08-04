import { describe, expect, it } from 'vitest';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  DAO_STATE_STALE_AFTER_MS,
  daoStateVisualState,
  deriveDaoStateVisual,
} from '../../src/derives/daoState.derive';

const record: DaoStateRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  statistics_block: 99,
  updated_at_ms: 1,
  total_deposited_shannons: '837703738002110308',
  total_depositors: 16_740,
  active_deposits: 22_659,
  pending_withdrawal_shannons: '77523020877862416',
  unclaimed_compensation_shannons: '81345902996799859',
  estimated_apc_bps: 201,
  deposit_change_24h_shannons: '-125000000',
  depositors_change_24h: -1,
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['dao_state'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('DAO state visual derivation', () => {
  it('keeps exact indexed shannons and signed daily movement', () => {
    const visual = deriveDaoStateVisual(record);
    expect(visual).toEqual({
      totalDepositedShannons: 837703738002110308n,
      pendingWithdrawalShannons: 77523020877862416n,
      unclaimedCompensationShannons: 81345902996799859n,
      depositChange24hShannons: -125000000n,
    });
  });

  it('rejects invalid exact values and statistics ahead of their anchor', () => {
    expect(deriveDaoStateVisual({
      ...record,
      total_deposited_shannons: '-1',
    })).toBeNull();
    expect(deriveDaoStateVisual({
      ...record,
      estimated_apc_bps: 10_001,
    })).toBeNull();
    expect(deriveDaoStateVisual({
      ...record,
      statistics_block: 101,
    })).toBeNull();
    expect(deriveDaoStateVisual({
      ...record,
      deposit_change_24h_shannons: '1'.repeat(40),
    })).toBeNull();
  });

  it('requires the capability, usable source, and compatible anchor', () => {
    expect(daoStateVisualState(source, record, 1)).toBe('ready');
    expect(daoStateVisualState({ ...source, capabilities: [] }, record, 1))
      .toBeNull();
    expect(daoStateVisualState({ ...source, status: 'error' }, record, 1))
      .toBeNull();
    expect(daoStateVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record, 1)).toBeNull();
  });

  it('dims the DAO snapshot when its minute refresh stops', () => {
    expect(daoStateVisualState(
      source,
      record,
      record.updated_at_ms + DAO_STATE_STALE_AFTER_MS + 1,
    )).toBe('stale');
  });
});
