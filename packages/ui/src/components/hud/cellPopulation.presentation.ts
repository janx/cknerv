// What the population readouts are allowed to say, separated from how they look.
//
// The medium on screen implies millions. Every row here is therefore a claim
// about scope as much as about a number, and the failure mode is not a wrong
// digit — it is a right digit under a label that widens it.

import type { ChainCensus } from '@cknerv/types';
import type {
  CellPopulationFieldModel,
} from '../../derives/cellPopulationField.derive';
import {
  AUTO_CELL_DISPLAY_BUDGET,
  DISPLAY_ACTIVITY_QUOTA,
  DISPLAY_TIP_WINDOW,
} from '../../tweaks/cellDisplay';

/**
 * The three scopes a live-Cell count can be true in, named ONCE.
 *
 * ⚠️ There were three counts on screen with the word "live" in them and three
 * different vocabularies qualifying them: `LIVE CELLS … · AS OF #` on CKB·01
 * (the validated chain census), `OBSERVED LIVE` on CELL·03 (the backend's
 * observation window), `STAGE CELLS` in the strip (what this dashboard drew),
 * and STAGE·07 calling the SAME window as CELL·03 `REPLAY WINDOW` (report A,
 * A-13). Four words for three scopes, and two of them for one scope.
 *
 * The three labels stay — each one reads correctly where it stands — but the
 * SCOPE WORD inside them comes from here, so a reader who learns `OBSERVED` on
 * one panel meets the same word on the other, and no surface can invent a
 * fourth name for a scope that already has one.
 *
 * The stage funnel's other scopes (`ADDRESSABLE`, `MEMBERS`, `RECEIVED ROWS`,
 * `LOCAL WINDOW`) are distinctions INSIDE the stage rather than one of these
 * three, and they keep their own words.
 */
export const POPULATION_SCOPE = {
  /** The chain itself, under a validated census anchor. */
  chain: 'CHAIN',
  /** Births minus deaths in the backend's observation window. */
  observed: 'OBSERVED',
  /** What this dashboard is drawing right now. */
  stage: 'STAGE',
} as const;

const NUMBER = new Intl.NumberFormat('en-US');

export function formatPopulationCount(value: number): string {
  return NUMBER.format(Math.max(0, Math.round(value)));
}

/** `1 : N` with the precision the magnitude deserves. A ratio of 4.2 loses
 *  its meaning rounded to 4; one of 1,574 gains nothing from a decimal. */
export function formatPopulationRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '—';
  if (ratio < 10) return `1 : ${ratio.toFixed(1)}`;
  return `1 : ${NUMBER.format(Math.round(ratio))}`;
}

export interface PopulationRow {
  label: string;
  value: string;
  /** Raw count behind `value`, for the funnel bar. Same rounding. */
  count: number;
  /** The scope the value is true in. Never optional: an unqualified count is
   *  the specific mistake these readouts exist to stop making. */
  scope: string;
}

/**
 * The stage-side funnel, in widening order. Local windows only — the chain
 * census is chain truth and renders in the chain block, under its own anchor.
 *
 * `RENDERED` and `SERVER STAGE` separate only under a manual clamp, and then
 * they must BOTH appear: continuing to call the whole stage addressable while
 * drawing part of it is the same class of error as calling a window a chain.
 */
export function populationRows(
  model: CellPopulationFieldModel,
): PopulationRow[] {
  const rows: PopulationRow[] = [{
    label: 'Rendered',
    value: formatPopulationCount(model.renderedLive),
    count: model.renderedLive,
    scope: 'ADDRESSABLE',
  }];

  if (model.clamped) {
    rows.push({
      label: 'Server stage',
      value: formatPopulationCount(model.stagedLive),
      count: model.stagedLive,
      scope: 'MEMBERS',
    });
  }

  rows.push({
    label: 'Retained',
    value: formatPopulationCount(model.retainedLive),
    count: model.retainedLive,
    // A fallback scan counts the rows that arrived, which under staged-only
    // snapshots is a fraction of the window. It must not borrow the window's
    // label.
    scope: model.retainedScope === 'full_retained'
      ? 'LOCAL WINDOW'
      : 'RECEIVED ROWS',
  });

  rows.push({
    label: 'Observed',
    value: formatPopulationCount(model.observedLive),
    count: model.observedLive,
    // Births minus deaths in the backend's observation window. It is not a
    // live-chain total and has never been one — and it is the SAME window
    // CELL·03's `OBSERVED LIVE` counts, so it wears the same word.
    scope: POPULATION_SCOPE.observed,
  });

  return rows;
}

export interface ChainLiveRow {
  value: string;
  /** Anchor tag the row must carry itself, or null when the block header's
   *  anchor already covers it (same block, not stale). Null is not an
   *  unqualified count — it is a count qualified once, at the block level. */
  tag: string | null;
  dim: boolean;
}

/** The chain's own live-Cell count for the chain block.
 *
 *  `headerAnchorBlock` is the anchor the surrounding block already states.
 *  The census is an independent measurement and may anchor to a different
 *  block; when it does, the row says so rather than inheriting a header that
 *  is not its own. Without a census the row says UNAVAILABLE — never a number
 *  the dashboard cannot prove, and never the retained count wearing the
 *  chain's label. */
export function chainLiveRow(
  census: ChainCensus | null,
  censusStale: boolean,
  headerAnchorBlock?: number,
): ChainLiveRow {
  if (!census) {
    return { value: 'UNAVAILABLE', tag: 'NO VALIDATED CENSUS', dim: true };
  }
  // The scope first, then the provenance: `CHAIN · AS OF #n`. The anchor is
  // dropped when the section header already states it (the panel says it once),
  // but the SCOPE is never dropped — an unqualified count is the mistake this
  // module exists to stop making.
  const anchored = `${POPULATION_SCOPE.chain} · AS OF #${formatPopulationCount(census.as_of.block)}`;
  if (censusStale) {
    // Kept and labeled rather than dropped: the count was exact where it
    // says it was.
    return {
      value: formatPopulationCount(census.live_cells),
      tag: `${anchored} · STALE`,
      dim: true,
    };
  }
  return {
    value: formatPopulationCount(census.live_cells),
    tag: headerAnchorBlock === census.as_of.block ? POPULATION_SCOPE.chain : anchored,
    dim: false,
  };
}

export interface CompositionMix {
  label: string;
  scope: string;
  dao: string;
  typed: string;
  plain: string;
  /** Raw counts behind the labels, for the tri-segment bar. */
  counts: { dao: number; typed: number; plain: number };
  dim?: boolean;
}

function share(count: number, total: number): string {
  if (total <= 0) return '—';
  const pct = (count / total) * 100;
  // A bin holding real Cells never rounds to a claim of absence.
  if (pct > 0 && pct < 0.5) return '<1%';
  return `${Math.round(pct)}%`;
}

/**
 * The stage's composition beside the chain's.
 *
 * The stage is a deliberately biased sample — mainnet DAO is over-represented
 * about thirteenfold — and that is a curation choice, not a defect. But it
 * means the medium must never inherit the stage's mix, and it means showing
 * the two side by side is the sharpest single thing this feature can say.
 * Never one presented as the other, and never one without the other.
 */
export function populationCompositionMixes(
  model: CellPopulationFieldModel,
): CompositionMix[] {
  const classes = model.chainCensus?.classes;
  if (!classes || model.stagedLive <= 0) return [];

  const stageTotal = model.stagedClasses.dao
    + model.stagedClasses.typedNonDao
    + model.stagedClasses.plain;
  const chainTotal = classes.dao + classes.typed_non_dao + classes.plain;

  return [
    {
      label: 'Stage mix',
      // A curated stage now samples its typed class in the inventory's own
      // capacity ranking — most-occupied contract or collection first,
      // proportionally. The tag says which law produced the mix, because
      // "curated" alone no longer distinguishes it from any other choice.
      scope: model.stagedCurated ? 'CURATED · CAP-RANKED' : 'INSERTION ORDER',
      dao: share(model.stagedClasses.dao, stageTotal),
      typed: share(model.stagedClasses.typedNonDao, stageTotal),
      plain: share(model.stagedClasses.plain, stageTotal),
      counts: {
        dao: model.stagedClasses.dao,
        typed: model.stagedClasses.typedNonDao,
        plain: model.stagedClasses.plain,
      },
    },
    {
      label: 'Chain mix',
      scope: `AS OF #${formatPopulationCount(model.chainCensus!.as_of.block)}`,
      dao: share(classes.dao, chainTotal),
      typed: share(classes.typed_non_dao, chainTotal),
      plain: share(classes.plain, chainTotal),
      counts: {
        dao: classes.dao,
        typed: classes.typed_non_dao,
        plain: classes.plain,
      },
      dim: model.censusStale,
    },
  ];
}

export interface StageReserveRow {
  label: string;
  value: string;
  /** The scope the reserve is true in — same rule as every other row here. */
  scope: string;
}

/**
 * The stage's other standing law, beside the class mix.
 *
 * The mix rows say what the composition SAMPLED; this says what the stage
 * holds no matter what the composition wants — the newest live Cells on the
 * chain, refilled from the next-youngest when one dies rather than from
 * whatever the server has been holding longest. Without it a reader has no
 * way to tell a stage that follows the tip from one that froze at boot, and
 * the two look identical on screen.
 *
 * Deliberately NOT a funnel row: the funnel is a narrowing chain from the
 * observed window down to the addressable bodies, and this is a reserve
 * inside one of its steps. Putting it on that staircase would rescale the
 * bars and make it look like a scope.
 *
 * The size is a server constant mirrored in `tweaks/cellDisplay`, not a wire
 * field — see the MUST-MATCH note there.
 */
export function stageTipWindowRow(
  model: CellPopulationFieldModel,
): StageReserveRow {
  // Without a composition the whole resting field is the window: everything
  // the transient activity FIFO is not.
  const seats = model.stagedCurated
    ? DISPLAY_TIP_WINDOW
    : AUTO_CELL_DISPLAY_BUDGET - DISPLAY_ACTIVITY_QUOTA;
  return {
    label: 'Tip window',
    value: formatPopulationCount(seats),
    scope: model.stagedCurated ? 'NEWEST BIRTHS' : 'WHOLE STAGE',
  };
}

export interface MediumRow {
  term: string;
  meaning: string;
}

/** The two channels the picture actually uses, explained BEFORE a reader
 *  tries to click the field.
 *
 *  The faint swarm IS the unresolved population, so its row carries the
 *  field's whole claim — not clickable, the scope it stands in for, and how
 *  many live Cells each bright body answers for. The renderer's `gain` is
 *  never printed; the ratio and the scope are what a reader can check. */
export function populationMediumRows(
  model: CellPopulationFieldModel,
): MediumRow[] {
  const swarm = model.gain <= 0
    // R ≤ 1: the stage covers its scope and there is no medium to explain.
    ? 'NOTHING UNRESOLVED AT THIS SCOPE'
    : `NON-ADDRESSABLE · ${
      model.scope === 'chain' ? 'CHAIN SCOPE' : 'RETAINED SCOPE'
    } · ${formatPopulationRatio(model.ratio)}`;
  return [
    { term: 'Bright bodies', meaning: 'INTERACTIVE CELLS' },
    { term: 'Faint swarm', meaning: swarm },
  ];
}
