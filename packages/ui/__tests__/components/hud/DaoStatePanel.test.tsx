import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import DaoStatePanel from '../../../src/components/hud/DaoStatePanel';

afterEach(cleanup);

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['dao_state'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};

const record: DaoStateRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  statistics_block: 99,
  updated_at_ms: Date.now(),
  total_deposited_shannons: '837703738002110308',
  total_depositors: 16_740,
  active_deposits: 22_659,
  pending_withdrawal_shannons: '77523020877862416',
  unclaimed_compensation_shannons: '81345902996799859',
  estimated_apc_bps: 201,
  deposit_change_24h_shannons: '141530599353229',
  depositors_change_24h: 5,
};

describe('DaoStatePanel', () => {
  it('renders DAO context as a complete standalone panel', () => {
    const { container } = render(
      <DaoStatePanel source={source} record={record} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('NERVOS DAO');
    expect(text).toContain('DAO·05');
    expect(text).toContain('SNAPSHOT #99 · VALIDATED AT #100');
    expect(text).toContain('8.38 B CKB');
    expect(text).toContain('22,659');
    expect(text).toContain('2.01%');
    expect(text).toContain('+1.42 M CKB');
    expect(text).toContain('+5');
    expect(container.querySelector('[data-dao-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-fill]')).toBeNull();
  });

  it('does not render without validated DAO capability', () => {
    const { container } = render(
      <DaoStatePanel
        source={{ ...source, capabilities: [] }}
        record={record}
      />,
    );

    expect(container.firstElementChild).toBeNull();
  });
});
