import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import DaoStatePanel from '../../../src/components/hud/DaoStatePanel';
import { STALE_OPACITY } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

const NOW_MS = 1_700_000_038_000;

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
  updated_at_ms: NOW_MS - 38_000,
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
      <DaoStatePanel source={source} record={record} nowMs={NOW_MS} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('NERVOS DAO');
    expect(text).toContain('道');
    expect(text).toContain('DAO·05');
    // ⚠️ NO LAMP AND NO WORD ON A GOOD DAY. The record's freshness used to open
    // the panel as a lit `nominal` line saying LIVE; a record being recent is
    // not a health verdict, and four other records on this rail say nothing
    // until something is wrong (report A, A-8).
    expect(text).not.toContain('LIVE');
    expect(container.querySelector('[data-dao-freshness]')).toBeNull();
    expect(container.querySelector('[data-dao-stale]')).toBeNull();
    expect(text).toContain('Total deposited');
    expect(text).toContain('8.38 G·CKB');
    expect(text).toContain('+1.42 M·CKB · +0.017% / 24H');
    expect(text).toContain('Est. APC');
    expect(text).toContain('2.01%');
    expect(text).toContain('annualized');
    expect(text).toContain('Withdrawing');
    expect(text).toContain('775.23 M·CKB');
    expect(text).toContain('Unclaimed comp.');
    expect(text).toContain('813.46 M·CKB');
    expect(text).toContain('Active depositors');
    expect(text).toContain('16,740+5 / 24H');
    expect(text).toContain('Live DAO cells');
    expect(text).toContain('22,659');
    // …and the age is a fact about the two blocks, so it stands with them.
    expect(text).toContain('STAT #99 · ANCHOR #100 · 38S AGO');
    expect(text).not.toContain('DAO locked');
    expect(text).not.toContain('Active deposits');
    expect(container.querySelector('[data-dao-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-dao-hero]')).not.toBeNull();
    expect(container.querySelector('[data-dao-capacity-metrics]')).not.toBeNull();
    expect(container.querySelector('[data-dao-participation]')).not.toBeNull();
    expect(container.querySelector('[title="8,377,037,380.02110308 CKB"]')).not.toBeNull();
    expect(container.querySelector('[data-fill]')).toBeNull();
  });

  it('puts the exact figure a tap away, not only a hover away', () => {
    // The panel prints `8.38 G·CKB` and the twenty significant digits existed
    // NOWHERE else — a `title` is a mouse affordance, so on a tablet the
    // exact number was not in the application at all. Three figures here are
    // the only ones in the HUD with that property.
    const { container } = render(<DaoStatePanel source={source} record={record} nowMs={record.updated_at_ms} />);
    const toggles = container.querySelectorAll('[data-exact-toggle]');
    expect(toggles.length).toBe(3);
    expect(container.querySelector('[data-exact-reading]')).toBeNull();

    const hero = container.querySelector('[data-dao-hero] [data-exact-toggle]') as HTMLElement;
    expect(hero.tagName).toBe('BUTTON');
    // The mouse keeps what it had.
    expect(hero.getAttribute('title')).toBe('8,377,037,380.02110308 CKB');
    expect(hero.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(hero);
    const reading = container.querySelector('[data-exact-reading]') as HTMLElement;
    expect(reading.textContent).toBe('8,377,037,380.02110308 CKB');
    expect(hero.getAttribute('aria-expanded')).toBe('true');
    // It opens DOWNWARD and does not replace: the hero's own compact reading
    // is still there, which is what keeps a composed column from blowing
    // apart when twenty digits arrive.
    expect(container.textContent).toContain('8.38 G·CKB');

    fireEvent.click(hero);
    expect(container.querySelector('[data-exact-reading]')).toBeNull();
  });

  it('makes a stale DAO record explicit instead of relying on opacity alone', () => {
    const { container } = render(
      <DaoStatePanel
        source={source}
        record={record}
        nowMs={record.updated_at_ms + 4 * 60_000}
      />,
    );

    // Staleness speaks — in the rail's own `· STALE` token, on the line that
    // carries the anchor it has gone stale against.
    expect(container.textContent).toContain('STAT #99 · ANCHOR #100 · 4M 0S AGO · STALE');
    expect(container.querySelector('[data-dao-state="stale"]')).not.toBeNull();
    expect(container.querySelector('[data-dao-stale]')?.textContent).toBe(' · STALE');
    expect((container.querySelector('[data-dao-content]') as HTMLElement).style.opacity)
      .toBe(String(STALE_OPACITY));
  });

  it('keeps optional movement honest and formats a negative relative change', () => {
    const { container, rerender } = render(
      <DaoStatePanel
        source={source}
        record={{
          ...record,
          deposit_change_24h_shannons: undefined,
          depositors_change_24h: undefined,
        }}
        nowMs={NOW_MS}
      />,
    );

    expect(container.querySelector('[data-dao-deposit-change]')?.textContent)
      .toBe('24H CHANGE · —');
    expect(container.querySelector('[data-dao-depositor-change]')).toBeNull();

    rerender(
      <DaoStatePanel
        source={source}
        record={{
          ...record,
          total_deposited_shannons: '10000000000',
          deposit_change_24h_shannons: '-100000000',
          depositors_change_24h: -1,
        }}
        nowMs={NOW_MS}
      />,
    );

    expect(container.querySelector('[data-dao-deposit-change]')?.textContent)
      .toBe('−1 CKB · −0.99% / 24H');
    expect(container.querySelector('[data-dao-depositor-change]')?.textContent)
      .toBe('−1 / 24H');
  });

  it('names the two blocks once when they are the same block', () => {
    // `STAT #20,359,745 · ANCHOR #20,359,745` makes a reader compare twelve
    // digits to find out they agree. Where they differ, both print, because
    // then the difference is the reading.
    const { container, rerender } = render(
      <DaoStatePanel
        source={{ ...source, validated_anchor: { block: 99, hash: '0xblock99' } }}
        record={{ ...record, as_of: { block: 99, hash: '0xblock99' } }}
        nowMs={NOW_MS}
      />,
    );
    const proof = () => container.querySelector('[data-dao-proof]') as HTMLElement;
    expect(proof().dataset.daoAnchorShape).toBe('one');
    expect(proof().textContent).toContain('STAT · ANCHOR #99');
    expect(proof().textContent).not.toContain('#99 · ANCHOR #99');

    rerender(<DaoStatePanel source={source} record={record} nowMs={NOW_MS} />);
    expect(proof().dataset.daoAnchorShape).toBe('two');
    expect(proof().textContent).toContain('STAT #99 · ANCHOR #100');
  });

  it('writes a change under the resolution as an inequality, not a signed one', () => {
    // `+<0.001%` is a plus and a less-than jammed together and is not a number
    // in any notation; the CKB figure beside it carries the direction.
    const { container } = render(
      <DaoStatePanel
        source={source}
        record={{
          ...record,
          total_deposited_shannons: '1000000000000000',
          deposit_change_24h_shannons: '1000000',
        }}
        nowMs={NOW_MS}
      />,
    );
    const change = container.querySelector('[data-dao-deposit-change]')?.textContent ?? '';
    expect(change).toContain('<0.001%');
    expect(change).not.toContain('+<');
  });

  it('does not render without validated DAO capability', () => {
    const { container } = render(
      <DaoStatePanel
        source={{ ...source, capabilities: [] }}
        record={record}
        nowMs={NOW_MS}
      />,
    );

    expect(container.firstElementChild).toBeNull();
  });
});
