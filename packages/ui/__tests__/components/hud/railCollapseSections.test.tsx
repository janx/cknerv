import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ActivityFeedRecord,
  EnrichmentSourceStatus,
  TransactionHorizonRecord,
} from '@cknerv/types';
import ActivityFeedReadout from '../../../src/components/hud/ActivityFeedReadout';
import TransactionHorizonReadout from '../../../src/components/hud/TransactionHorizonReadout';
import { HudPanel, PanelHeader } from '../../../src/components/hud/primitives';
import { CHAIN_PANEL_WIDTH_PX } from '../../../src/components/hud/BlockchainReadout';
import {
  HUD_PANEL_FRAME_PX,
  MESH_PANEL_WIDTH_PX,
  RAILS_COLLAPSE_HOLE_PX,
  RAILS_COLLAPSE_MARGIN_PX,
  RAILS_COLLAPSE_MAX_WIDTH_PX,
  RAILS_FULL_WIDTH_PX,
} from '../../../src/components/hud/HudOverlay';
import { CONSTELLATION_WIDTH } from '../../../src/components/hud/cellConstellationFrame';
import { CONSTELLATION_MIN_GAP_PX } from '../../../src/derives/cellConstellation.derive';
import { INSPECTOR_GAP_PX } from '../../../src/components/sceneInspection';

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
  window_ms: 3_600_000,
  kinds: [
    { kind: 'transfer', in_window: 42, in_window_capped: false },
    {
      kind: 'dao',
      in_window: 6,
      in_window_capped: false,
      latest: {
        tx_hash: `0x${'aa'.repeat(32)}`,
        block: 100,
        timestamp_ms: Date.now(),
        category: 'dao',
        label: 'Deposit',
        participant_count: 3,
      },
    },
    { kind: 'token', in_window: 0, in_window_capped: false },
    { kind: 'object', in_window: 0, in_window_capped: false },
    { kind: 'identity', in_window: 0, in_window_capped: false },
    { kind: 'protocol', in_window: 0, in_window_capped: false },
    { kind: 'script', in_window: 100, in_window_capped: true },
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
    // The header's anchor went with every other `AS OF #n` on CKB·01.
    expect(section.textContent).not.toContain('AS OF');
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

  it('leaves ACTIVITY its header and the hour\'s whole traffic', () => {
    const { container } = render(
      <ActivityFeedReadout source={source} record={activity} folded />,
    );
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.dataset.activityFeedFolded).toBe('true');
    expect(section.textContent).toContain('ACTIVITY');
    // 42 + 6 + 100, and the `+` because the busiest kind's count is a floor.
    expect(section.textContent).toContain('148+/H');
    // Not the table: seven rows are what a collapsed rail has no room for.
    expect(section.querySelector('[data-activity-kind]')).toBeNull();
    expect(section.textContent).not.toContain('Deposit');
  });

  it('draws the seven rows without it', () => {
    const { container } = render(
      <ActivityFeedReadout source={source} record={activity} />,
    );
    const section = container.querySelector('[data-activity-feed-state]') as HTMLElement;

    expect(section.querySelectorAll('[data-activity-kind]')).toHaveLength(7);
    expect(section.textContent).toContain('LAST HOUR');
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

/**
 * The collapse threshold is arithmetic, and every number in it belongs to
 * somebody else. `HudOverlay` restates four of them — a panel's frame, the mesh
 * rail's measure, the card's measure and the tether under it — because the two
 * modules that own the last pair drag a 2,400-line panel and `@react-three/
 * fiber` behind them, and the DOM-only HUD root takes neither. A restatement
 * without a toll is a second definition, so here are the tolls: this file
 * imports both card authorities and reads the primitive's own frame, and
 * `HudOverlay.test.tsx` renders the rails and fails if the measure they set is
 * not the one the threshold is stated from.
 */
describe('rail collapse · the threshold is derived, and every term is tolled', () => {
  it('states a panel frame the primitive actually draws', () => {
    const { container } = render(<HudPanel>{null}</HudPanel>);
    const panel = container.querySelector('[data-hud-occlusion="true"]') as HTMLElement;

    expect(panel.style.padding).toBe('13px 15px');
    const padX = Number.parseFloat(panel.style.padding.split(' ')[1]);
    expect(padX * 2).toBe(HUD_PANEL_FRAME_PX);
  });

  it('needs the pair that shares a side of the cell, its tether and a margin', () => {
    // The requirement the rule exists to protect, read from the modules that
    // own it rather than from the HUD's own restatement. Not a card any more,
    // and not the widest single instrument either: the register and the
    // specimen share a side of the cell and the reader takes the other, so the
    // pair is what a hole has to hold.
    expect(RAILS_COLLAPSE_HOLE_PX).toBe(
      CONSTELLATION_WIDTH.analysis
      + CONSTELLATION_MIN_GAP_PX
      + CONSTELLATION_WIDTH.specimen
      + INSPECTOR_GAP_PX
      + RAILS_COLLAPSE_MARGIN_PX,
    );
  });

  it('collapses at the width where two full rails stop leaving it', () => {
    expect(RAILS_FULL_WIDTH_PX).toBe(
      14 * 2 + (CHAIN_PANEL_WIDTH_PX + HUD_PANEL_FRAME_PX)
      + (MESH_PANEL_WIDTH_PX + HUD_PANEL_FRAME_PX),
    );
    // One pixel of stage short is the whole rule: the widest page that
    // collapses is the widest one whose full-railed stage cannot hold the
    // widest instrument beside its cell.
    expect(RAILS_COLLAPSE_MAX_WIDTH_PX - RAILS_FULL_WIDTH_PX)
      .toBe(RAILS_COLLAPSE_HOLE_PX - 1);
    // …and the 1,440 stage this rule exists for is still inside it. The
    // constellation is spread differently from the card it replaced, not
    // smaller: the pair that shares a side of a cell measures 736 where the
    // card measured 728, so the threshold moved eight pixels.
    expect(RAILS_COLLAPSE_MAX_WIDTH_PX).toBeGreaterThanOrEqual(1440);
  });
});
