// What the population readouts are allowed to say, separated from how they look.
//
// The medium on screen implies millions. Every row here is therefore a claim
// about scope as much as about a number, and the failure mode is not a wrong
// digit — it is a right digit under a label that widens it.

import type { ChainCensus } from '@cknerv/types';
import type {
  CellPopulationFieldModel,
} from '../../derives/cellPopulationField.derive';

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
    // live-chain total and has never been one.
    scope: 'REPLAY WINDOW',
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
  const anchored = `AS OF #${formatPopulationCount(census.as_of.block)}`;
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
    tag: headerAnchorBlock === census.as_of.block ? null : anchored,
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
