import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ActivityFeedRecord,
  EnrichmentSourceStatus,
  TransactionHorizonRecord,
} from '@cknerv/types';
import ActivityFeedReadout from '../../../src/components/hud/ActivityFeedReadout';
import TransactionHorizonReadout from '../../../src/components/hud/TransactionHorizonReadout';
import { PanelHeader } from '../../../src/components/hud/primitives';

afterEach(cleanup);

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['transaction_horizon', 'activity_feed'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};

const horizon: TransactionHorizonRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  current_hour: 512,
  current_day: 11_204,
  hourly_counts: Array.from({ length: 24 }, (_, index) => 400 + index * 11),
  daily_counts: Array.from({ length: 7 }, (_, index) => 9_000 + index * 120),
};

const activity: ActivityFeedRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  activities: [
    { tx_hash: `0x${'aa'.repeat(32)}`, block: 100, timestamp_ms: 2, category: 'dao', label: 'Deposit', participant_count: 3 },
    { tx_hash: `0x${'bb'.repeat(32)}`, block: 99, timestamp_ms: 1, category: 'tokens', label: 'xUDT', participant_count: 2 },
  ],
};

/**
 * The two sections that already had a `compact` form and now have a `folded`
 * one. They are different shortages: `compact` is a SHORT viewport keeping what
 * it can still afford, `folded` is a NARROW one keeping only the header and the
 * count. A section that answered both with one form would be guessing at one.
 */
describe('rail collapse · folded sections', () => {
  it('leaves TX HORIZON its header and its two counts', () => {
    const { container } = render(
      <TransactionHorizonReadout source={source} record={horizon} folded />,
    );
    const section = container.querySelector('[data-transaction-horizon-state]') as HTMLElement;

    expect(section.textContent).toContain('TX HORIZON');
    expect(section.textContent).toContain('AS OF #100');
    // No bar: the twenty-four hour columns are the section's body.
    expect(section.querySelector('[data-transaction-hour-count]')).toBeNull();
    expect(section.textContent).not.toContain('PEAK/H');
  });

  it('draws the whole horizon without it', () => {
    const { container } = render(
      <TransactionHorizonReadout source={source} record={horizon} />,
    );
    const section = container.querySelector('[data-transaction-horizon-state]') as HTMLElement;

    expect(section.querySelectorAll('[data-transaction-hour-count]')).toHaveLength(24);
    expect(section.textContent).toContain('PEAK/H');
  });

  it('leaves ACTIVITY its header and its count', () => {
    const { container } = render(
      <ActivityFeedReadout source={source} record={activity} folded />,
    );
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.dataset.activityFeedFolded).toBe('true');
    expect(section.textContent).toContain('ACTIVITY');
    expect(section.textContent).toContain('LATEST 2');
    // Neither the category fingerprint nor the rows under it.
    expect(section.querySelector('[data-activity-category]')).toBeNull();
    expect(section.textContent).not.toContain('Deposit');
  });

  it('draws the fingerprint and the rows without it', () => {
    const { container } = render(
      <ActivityFeedReadout source={source} record={activity} />,
    );
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.querySelectorAll('[data-activity-category]').length).toBeGreaterThan(0);
    expect(section.textContent).toContain('Deposit');
  });
});

describe('rail collapse · the panel header at a narrow measure', () => {
  it('never breaks a CJK companion across lines', () => {
    // At CKB·01's folded 268px measure the English title takes two lines, and
    // a flex line out of room squeezes the companion to a column: 共识基 broke
    // mid-word. A name does not break; the English words beside it may.
    const { container } = render(
      <PanelHeader en="COMMON KNOWLEDGE BASE" cjk="共识基" idx="CKB·01" />,
    );
    const spans = Array.from(container.querySelectorAll('span')) as HTMLElement[];
    const cjk = spans.find((el) => el.textContent === '共识基') as HTMLElement;
    const tag = spans.find((el) => el.textContent === 'CKB·01') as HTMLElement;

    expect(cjk.style.whiteSpace).toBe('nowrap');
    expect(cjk.style.flex).toBe('0 0 auto');
    expect(tag.style.whiteSpace).toBe('nowrap');
  });
});
