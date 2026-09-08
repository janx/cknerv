import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ActivityFeedItem,
  ActivityFeedRecord,
  ActivityKindSummary,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import ActivityFeedReadout from '../../../src/components/hud/ActivityFeedReadout';
import { ACTIVITY_CATEGORY_COLORS } from '../../../src/derives/activityFeed.derive';
import { STALE_OPACITY } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['activity_feed'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};

function kind(
  name: string,
  in_window: number,
  latest?: ActivityFeedItem,
  in_window_capped = false,
): ActivityKindSummary {
  return { kind: name, in_window, in_window_capped, latest };
}

/** The rates the adapter measured on the user's own index: CKB and SCRIPT
 *  running, the DAO at six an hour, and four kinds whose newest event is hours
 *  to days old — the four the eight-row sample could never show. Ages are
 *  taken against `Date.now()` at render, so the fixture is written as offsets
 *  from it. */
function feed(over: Partial<ActivityFeedRecord> = {}): ActivityFeedRecord {
  const now = Date.now();
  const at = (ago: number, over2: Partial<ActivityFeedItem> & { category: string }): ActivityFeedItem => ({
    tx_hash: `0x${'11'.repeat(32)}`,
    block: 100,
    timestamp_ms: now - ago,
    participant_count: 1,
    ...over2,
  });
  return {
    source: 'ckbadger',
    as_of: { block: 100, hash: '0xblock100' },
    updated_at_ms: now,
    window_ms: 3_600_000,
    kinds: [
      kind('transfer', 42, at(0, {
        category: 'transfer',
        tx_hash: `0x${'44'.repeat(32)}`,
        participant_count: 2,
        amount_shannons: '52668983337',
      })),
      kind('dao', 6, at(60_000, {
        category: 'dao',
        tx_hash: `0x${'55'.repeat(32)}`,
        block: 99,
        label: 'withdraw complete',
        amount_shannons: '1000000000000',
      })),
      kind('token', 0, at(5 * 86_400_000, {
        category: 'token',
        tx_hash: `0x${'66'.repeat(32)}`,
        block: 91,
        label: '0.0005 BTC',
        participant_count: 2,
      })),
      kind('object', 0, at(4 * 86_400_000, {
        category: 'object',
        tx_hash: `0x${'77'.repeat(32)}`,
        block: 93,
        label: 'burn',
      })),
      kind('identity', 0, at(2 * 86_400_000, {
        category: 'identity',
        tx_hash: `0x${'88'.repeat(32)}`,
        block: 94,
        label: 'release',
      })),
      kind('protocol', 0, at(23 * 3_600_000, {
        category: 'protocol',
        tx_hash: `0x${'99'.repeat(32)}`,
        block: 96,
        label: 'fiber · channel close',
        participant_count: 2,
      })),
      kind('script', 100, at(0, {
        category: 'script',
        tx_hash: `0x${'aa'.repeat(32)}`,
        label: '.bit Time Index State',
      }), true),
    ],
    ...over,
  };
}

/** jsdom normalises an inline hex to `rgb(...)`, so the assertion has to meet
 *  it there rather than compare the token's own spelling. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function rowsOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-activity-kind]'))
    .map((row) => ({
      kind: row.dataset.activityKind,
      cells: Array.from(row.children).map((cell) => cell.textContent),
    }));
}

describe('ACTIVITY · seven kinds, not eight transactions', () => {
  it('prints one row per kind, in the order a reader learns once', () => {
    // ⚠️ The section used to print the newest eight transactions and the
    // chain's newest eight are two keepers writing state every block, so it
    // said `SCRIPT 8` and nothing else, every time. Here is what those eight
    // rows could never say: the DAO's six an hour, and four kinds whose last
    // event was hours to days ago.
    const { container } = render(<ActivityFeedReadout source={source} record={feed()} />);

    expect(rowsOf(container)).toEqual([
      { kind: 'transfer', cells: ['CKB', '42', 'now', '526.69 CKB'] },
      { kind: 'dao', cells: ['DAO', '6', '1 min', 'withdraw complete · 10 K·CKB'] },
      { kind: 'token', cells: ['TOKEN', '0', '5 d', '0.0005 BTC'] },
      { kind: 'object', cells: ['OBJECT', '0', '4 d', 'burn'] },
      { kind: 'identity', cells: ['IDENTITY', '0', '2 d', 'release'] },
      { kind: 'protocol', cells: ['PROTOCOL', '0', '23 h', 'fiber · channel close'] },
      { kind: 'script', cells: ['SCRIPT', '100+', 'now', '.bit Time Index State'] },
    ]);
  });

  it('says LAST HOUR and prints no anchor', () => {
    const { container } = render(<ActivityFeedReadout source={source} record={feed()} />);
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.textContent).toContain('ACTIVITY');
    expect(section.textContent).toContain('LAST HOUR');
    // The header's anchor went with every other `AS OF #n` on CKB·01.
    expect(section.textContent).not.toContain('AS OF');
  });

  it('marks the count that is a floor rather than a count', () => {
    // SCRIPT runs at 240 an hour and the index serves 100 rows a page, so the
    // honest reading is "at least a hundred" — a bare `100` would be a lie
    // about a page that ran out.
    const { container } = render(<ActivityFeedReadout source={source} record={feed()} />);
    const script = container.querySelector<HTMLElement>('[data-activity-kind="script"]');
    expect(script?.children[1].textContent).toBe('100+');
    const transfer = container.querySelector<HTMLElement>('[data-activity-kind="transfer"]');
    expect(transfer?.children[1].textContent).toBe('42');
  });

  it('paints each kind word in the colour the rest of the HUD gives it', () => {
    // The colour IS the mapping now that the legend is gone: a reader picks
    // TOKEN out of seven rows by the word's hue, and it has to be the hue the
    // CELLS asset bar gives the same word one panel over.
    const { container } = render(<ActivityFeedReadout source={source} record={feed()} />);
    for (const [word, hex] of Object.entries(ACTIVITY_CATEGORY_COLORS)) {
      const row = container.querySelector<HTMLElement>(`[data-activity-kind="${word}"]`);
      expect(row, `${word} lost its row`).not.toBeNull();
      expect((row?.children[0] as HTMLElement).style.color).toBe(rgb(hex));
    }
  });

  it('names the transaction behind each row on the hover and nowhere else', () => {
    // The row prints what happened; the proof of it is the hash, and a hash in
    // a 70px column is not a reading.
    const { container } = render(<ActivityFeedReadout source={source} record={feed()} />);
    const dao = container.querySelector<HTMLElement>('[data-activity-kind="dao"]');
    expect(dao?.getAttribute('title'))
      .toBe(`#99 · 0x${'55'.repeat(32)} · 1 participants`);
    expect(container.textContent).not.toContain('0x55');
  });

  it('holds a row whose kind the index has never seen', () => {
    const record = feed();
    record.kinds[2] = kind('token', 0);
    const { container } = render(<ActivityFeedReadout source={source} record={record} />);
    const token = container.querySelector<HTMLElement>('[data-activity-kind="token"]');

    expect(token?.getAttribute('title')).toBe('never seen');
    expect(Array.from(token?.children ?? []).map((cell) => cell.textContent))
      .toEqual(['TOKEN', '0', '—', '']);
    // …and the table is still seven rows: a kind that has never happened is a
    // reading, and dropping the row would make the table's length the reading
    // instead.
    expect(container.querySelectorAll('[data-activity-kind]')).toHaveLength(7);
  });

  it('says NO ACTIVITY SEEN when the index has never seen one of anything', () => {
    const record = feed({
      kinds: [
        kind('transfer', 0), kind('dao', 0), kind('token', 0), kind('object', 0),
        kind('identity', 0), kind('protocol', 0), kind('script', 0),
      ],
    });
    const { container } = render(<ActivityFeedReadout source={source} record={record} />);

    // Not "no RECENT activity": the rows carry the newest event of every kind
    // at any age, so an empty table is a statement about the index.
    expect(container.textContent).toContain('NO ACTIVITY SEEN');
    expect(container.querySelectorAll('[data-activity-kind]')).toHaveLength(0);
  });

  it('is a table and nothing else — no fingerprint bar, no legend', () => {
    // The bar and its legend were the section for a year, and the reason they
    // are gone is that a stacked bar of a sample of eight can only ever say
    // which keeper ran last.
    const { container } = render(<ActivityFeedReadout source={source} record={feed()} />);

    expect(container.querySelector('[data-activity-category]')).toBeNull();
    expect(container.querySelector('[data-activity-legend]')).toBeNull();
    expect(container.querySelector('[data-activity-row]')).toBeNull();
  });

  it('folds to the hour\'s whole traffic and the floor mark on it', () => {
    const { container } = render(
      <ActivityFeedReadout source={source} record={feed()} folded />,
    );
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.dataset.activityFeedFolded).toBe('true');
    // 42 + 6 + 100, and the `+` because one of those hundred is a floor.
    expect(section.textContent).toContain('148+/H');
    expect(section.textContent).not.toContain('LAST HOUR');
    expect(container.querySelectorAll('[data-activity-kind]')).toHaveLength(0);
  });

  it('keeps every row on a short viewport', () => {
    // `compact` used to drop the rows and keep the bar. There is no bar left,
    // and the rows are the reading.
    const { container } = render(
      <ActivityFeedReadout source={source} record={feed()} compact />,
    );

    expect(container.querySelector('[data-activity-feed-compact="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-activity-kind]')).toHaveLength(7);
  });

  it('dims to the one weight, and says the word beside it', () => {
    const { container } = render(
      <ActivityFeedReadout source={{ ...source, status: 'stale' }} record={feed()} />,
    );
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.dataset.activityFeedState).toBe('stale');
    expect(section.style.opacity).toBe(String(STALE_OPACITY));
    expect(section.querySelector('[data-readout-stale]')?.textContent).toBe('· STALE');
  });

  it('draws nothing from a record it cannot prove', () => {
    const { container } = render(
      <ActivityFeedReadout source={source} record={feed({ kinds: [] })} />,
    );
    expect(container.querySelector('[data-activity-feed-state]')).toBeNull();
  });
});
