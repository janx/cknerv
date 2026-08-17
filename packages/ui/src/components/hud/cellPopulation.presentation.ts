// What the population panel is allowed to say, separated from how it looks.
//
// The medium on screen implies millions. Every row here is therefore a claim
// about scope as much as about a number, and the failure mode is not a wrong
// digit — it is a right digit under a label that widens it.

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
  /** The scope the value is true in. Never optional: an unqualified count is
   *  the specific mistake this panel exists to stop making. */
  scope: string;
  dim?: boolean;
}

/**
 * The count rows, in widening order.
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
    scope: 'ADDRESSABLE',
  }];

  if (model.clamped) {
    rows.push({
      label: 'Server stage',
      value: formatPopulationCount(model.stagedLive),
      scope: 'MEMBERS',
    });
  }

  rows.push({
    label: 'Retained',
    value: formatPopulationCount(model.retainedLive),
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
    // Births minus deaths in the backend's observation window. It is not a
    // live-chain total and has never been one.
    scope: 'REPLAY WINDOW',
  });

  rows.push(model.chainCensus
    ? {
      label: 'Chain live',
      value: formatPopulationCount(model.chainCensus.live_cells),
      scope: model.censusStale
        ? `AS OF #${formatPopulationCount(model.chainCensus.as_of.block)} · STALE`
        : `AS OF #${formatPopulationCount(model.chainCensus.as_of.block)}`,
      dim: model.censusStale,
    }
    : {
      label: 'Chain live',
      value: 'UNAVAILABLE',
      // No census: the source is absent, initializing, or withheld. The
      // dashboard says so rather than substituting a number it can prove.
      scope: 'NO VALIDATED CENSUS',
      dim: true,
    });

  return rows;
}

/** The field's own line: what kind of thing it is, what scope it claims, and
 *  how far the stage falls short of it. The renderer's `gain` is never
 *  printed — the counts and the scope are what a reader can check. */
export function populationFieldSummary(
  model: CellPopulationFieldModel,
): string {
  if (model.gain <= 0) {
    // R ≤ 1: the stage covers its scope and there is no medium to explain.
    return 'RESOLVED · NOTHING UNRESOLVED AT THIS SCOPE';
  }
  const scope = model.scope === 'chain' ? 'CHAIN SCOPE' : 'RETAINED SCOPE';
  return `UNRESOLVED · ${scope} · ${formatPopulationRatio(model.ratio)}`;
}

export interface CompositionMix {
  label: string;
  scope: string;
  dao: string;
  typed: string;
  plain: string;
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
 * about nineteenfold — and that is a curation choice, not a defect. But it
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
      scope: model.stagedCurated ? 'CURATED' : 'INSERTION ORDER',
      dao: share(model.stagedClasses.dao, stageTotal),
      typed: share(model.stagedClasses.typedNonDao, stageTotal),
      plain: share(model.stagedClasses.plain, stageTotal),
    },
    {
      label: 'Chain mix',
      scope: `AS OF #${formatPopulationCount(model.chainCensus!.as_of.block)}`,
      dao: share(classes.dao, chainTotal),
      typed: share(classes.typed_non_dao, chainTotal),
      plain: share(classes.plain, chainTotal),
      dim: model.censusStale,
    },
  ];
}

/** Scope has to be explained BEFORE a reader tries to click the medium. */
export const POPULATION_LEGEND: ReadonlyArray<{ term: string; meaning: string }> = [
  { term: 'Sharp bodies', meaning: 'INTERACTIVE CELLS' },
  { term: 'Ambient field', meaning: 'AGGREGATED / NON-ADDRESSABLE' },
];
