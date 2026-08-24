// How much of CKB's live Cell set this dashboard has individualized, and how
// much it has not.
//
// The Galaxy does not look like a sample. `tissueField` fills a 60×54 ellipse
// as a solid irregular body, so 12,000 drawn Cells read as a whole organism —
// and a viewer reasonably concludes that this is CKB's Cell set. On mainnet it
// is roughly one Cell in 123.
//
// This derive states the gap in numbers. It answers three separate questions
// that are easy to conflate and wrong to merge:
//
//   - how many Cells are individually addressable right now (`rendered*`);
//   - how many the SERVER staged, before any client-side overlay (`staged*`);
//   - what the widest scope the browser can currently PROVE is, and how far
//     the stage falls short of it (`scope`, `ratio`, `gain`).
//
// It is a pure function of immutable cache inputs. Nothing here reads a frame
// clock, and nothing here may be called per frame: it walks the staged
// membership, which is the display budget in size.

import type { ChainCensus } from '@cknerv/types';
import type { CellGalaxyCache, CellStatsScope } from '@cknerv/cache';

/** The exact cache surface this derive consumes. */
export type CellPopulationCache = Pick<
  CellGalaxyCache,
  | 'cells'
  | 'displayMembers'
  | 'displayResidents'
  | 'displayBudget'
  | 'displayProvenance'
  | 'stats'
  | 'statsScope'
>;

/** Scope the medium's amount is measured against. `chain` requires a
 *  validated census; everything else falls back to the retained window,
 *  which under-claims rather than guessing. */
export type CellPopulationScope = 'chain' | 'retained';

/** The three disjoint bins the chain census reports, measured over a local
 *  Cell set so the stage's curation can be shown beside the chain's real
 *  composition. A DAO Cell always carries a type script, so testing DAO
 *  first is what keeps these bins disjoint. */
export interface CellPopulationClasses {
  dao: number;
  typedNonDao: number;
  plain: number;
}

export interface CellPopulationFieldModel {
  /** Alive Cell records individualized by the current render set. */
  renderedLive: number;
  renderedRetainedLive: number;
  renderedResidentLive: number;
  /** Alive server-stage members, before the client-only overlay. */
  stagedLive: number;
  stagedRetainedLive: number;
  stagedResidentLive: number;
  /** Measured composition of the staged set. Never inherited by the medium;
   *  it exists so the curation can be DISCLOSED next to the chain's. */
  stagedClasses: CellPopulationClasses;
  /** True when the stage was authored by a composition policy rather than by
   *  canonical insertion order — i.e. when `stagedClasses` is a curation
   *  choice rather than an accident of ordering. */
  stagedCurated: boolean;
  /** True while the presentation clamp makes the render set smaller than the
   *  server stage. Both numbers are then disclosed, because continuing to
   *  call the whole stage addressable would be false. */
  clamped: boolean;
  /** The display plane's Cell budget, or null without a plane. Disclosed so
   *  the boot tail can say how full the stage is against what the server
   *  intends to fill (`stageFill.ts`). */
  stageBudget: number | null;

  /** Alive count in the canonical retained window. */
  retainedLive: number;
  /** Whether `retainedLive` covers the full retained set or only the rows
   *  this cache received. */
  retainedScope: CellStatsScope;
  /** Observation/rebuild-window counter. Displayed only with that scope —
   *  it is not a live-chain total and must never be labeled as one. */
  observedLive: number;

  /** The validated census, or null. Never synthesized, never zero-filled. */
  chainCensus: ChainCensus | null;
  /** Blocks between the census anchor and the chain tip, or null without a
   *  census. Negative is impossible for an admitted record (its anchor is
   *  canonical evidence), so this is clamped at zero. */
  censusAgeBlocks: number | null;
  /** A census whose anchor is still canonical but has fallen behind. Kept and
   *  labeled rather than dropped: the count was exact where it says it was. */
  censusStale: boolean;

  /** Widest scope the browser can prove right now. */
  scope: CellPopulationScope;
  /** R — unresolved-per-resolved within `scope`. 1 means nothing is hidden. */
  ratio: number;
  /** Compressed optical-depth multiplier. Never printed; the HUD prints the
   *  counts and the scope, and the renderer consumes this. */
  gain: number;
}

/**
 * Reference ratio for the amount curve.
 *
 * A LINEAR response is forbidden: at the measured mainnet R of 123 the medium
 * would carry 122/123 of the light and erase the Cells it exists to give
 * context to. Figure and ground are carried by KIND — crisp, chromatic,
 * shaped versus soft, achromatic, formless — never by amount.
 *
 * 4,000 is calibration, not taste. At 1,000 testnet's R of 1,574 pins at
 * exactly 1.0 and the whole mainnet-versus-testnet difference vanishes behind
 * a saturated constant. Re-derive if a profile ever exceeds R ≈ 3,000.
 */
export const POPULATION_GAIN_REFERENCE_RATIO = 4000;

/**
 * Floor applied once there IS something unresolved.
 *
 * Without it the response is continuous through R = 1, so a stage covering
 * almost-but-not-quite its scope would be told to render a medium too faint
 * to see — which states "nothing is hidden" while something is. Sized below
 * the retained-scope value (0.17) so it never clamps a profile we run.
 */
export const POPULATION_GAIN_MIN = 0.08;

/**
 * How far a census anchor may fall behind the tip before it is labeled stale.
 *
 * The capability refreshes every 30 s, which is three to four mainnet blocks,
 * so this is roughly eight refresh periods: long enough that ordinary jitter
 * never trips it, short enough that a silently wedged capability is visible
 * rather than quietly presented as current.
 */
export const CENSUS_STALE_BLOCKS = 24;

const EMPTY_OVERLAY_IDS: readonly number[] = [];

function normalizeDisplayLimit(limit: number): number {
  if (Number.isFinite(limit)) return Math.max(0, Math.floor(limit));
  return limit === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : 0;
}

/**
 * The compressed amount curve. `log1p(R - 1)` is `ln(R)`, so this is a plain
 * log ratio; it is written as `log1p` because the quantity being compressed is
 * the number of UNRESOLVED Cells per resolved one, which is `R - 1`.
 */
export function cellPopulationGain(
  ratio: number,
  referenceRatio = POPULATION_GAIN_REFERENCE_RATIO,
  minimum = POPULATION_GAIN_MIN,
): number {
  if (!Number.isFinite(ratio) || ratio <= 1) return 0;
  const raw = Math.log1p(ratio - 1) / Math.log1p(referenceRatio - 1);
  return Math.max(minimum, Math.min(1, raw));
}

/** True when a census record is usable as a whole-chain claim. The server
 *  already proved its anchor against canonical evidence; this is the
 *  browser's own guard against a value it could not render honestly. */
export function chainCensusIsUsable(census: ChainCensus | null): boolean {
  return (
    census !== null
    && Number.isFinite(census.live_cells)
    && Number.isInteger(census.live_cells)
    && census.live_cells >= 0
    && census.live_cells <= Number.MAX_SAFE_INTEGER
  );
}

interface ClassTally {
  dao: number;
  typedNonDao: number;
  plain: number;
}

function tallyClass(tally: ClassTally, cell: {
  asset_kind?: string;
  type_shape_seed: unknown;
}): void {
  if (cell.asset_kind === 'dao') {
    tally.dao += 1;
    return;
  }
  // `type_shape_seed` is explicitly null for a Cell with no type script, and
  // is always present — unlike the optional `type_script`, which older
  // persisted records can lack.
  if (cell.type_shape_seed !== null) {
    tally.typedNonDao += 1;
    return;
  }
  tally.plain += 1;
}

export interface CellPopulationFieldInput {
  cache: CellPopulationCache;
  /** Resolved presentation clamp — the number of staged Cells the renderer
   *  is currently allowed to draw. */
  displayLimit: number;
  /** Validated census from the semantics plane, or null. */
  census?: ChainCensus | null;
  /** Current canonical chain tip, for census staleness. */
  chainTip?: number;
  /** Client-transient overlay ids (selected Cell and its inspection field).
   *  They count as rendered, deduplicated, and never as staged. */
  overlayCellIds?: readonly number[];
}

/**
 * Derive the population model. Runs on cache/clamp/census identity changes,
 * never per frame.
 */
export function deriveCellPopulationField(
  input: CellPopulationFieldInput,
): CellPopulationFieldModel {
  const { cache, displayLimit } = input;
  const census = input.census ?? null;
  const chainTip = input.chainTip ?? 0;
  const overlayCellIds = input.overlayCellIds ?? EMPTY_OVERLAY_IDS;

  const limit = normalizeDisplayLimit(displayLimit);
  const displayPlaneActive = cache.displayBudget !== null;

  let stagedRetainedLive = 0;
  let stagedResidentLive = 0;
  let renderedRetainedLive = 0;
  let renderedResidentLive = 0;
  const stagedClasses: ClassTally = { dao: 0, typedNonDao: 0, plain: 0 };
  const renderedIds = new Set<number>();

  if (displayPlaneActive) {
    // Mirror `rebuildCellRenderSet` exactly: staged members in enter order,
    // resolved canonical-first, the first `limit` of which are drawn. A
    // divergence here would report a coverage the renderer does not have.
    const renderCount = Math.min(cache.displayMembers.size, limit);
    let resolved = 0;
    for (const id of cache.displayMembers) {
      const canonical = cache.cells.get(id);
      const cell = canonical ?? cache.displayResidents.get(id);
      if (!cell) continue;
      const alive = cell.death_at_ms === null;
      const inRenderSet = resolved < renderCount;
      resolved += 1;
      if (alive) {
        if (canonical) stagedRetainedLive += 1;
        else stagedResidentLive += 1;
        tallyClass(stagedClasses, cell);
      }
      if (inRenderSet) {
        renderedIds.add(id);
        if (alive) {
          if (canonical) renderedRetainedLive += 1;
          else renderedResidentLive += 1;
        }
      }
    }
  } else {
    // No display plane: the renderer falls back to the canonical
    // insertion-order prefix, and there is no server stage to speak of.
    let drawn = 0;
    for (const cell of cache.cells.values()) {
      if (drawn >= limit) break;
      drawn += 1;
      renderedIds.add(cell.id);
      if (cell.death_at_ms === null) renderedRetainedLive += 1;
    }
  }

  // Client inspection overlays are rendered records the server did not stage.
  // They count once, in `rendered*` only — counting them as staged would
  // report a membership the display plane never published.
  for (const id of overlayCellIds) {
    if (renderedIds.has(id)) continue;
    const canonical = cache.cells.get(id);
    const cell = canonical ?? cache.displayResidents.get(id);
    if (!cell) continue;
    renderedIds.add(id);
    if (cell.death_at_ms !== null) continue;
    if (canonical) renderedRetainedLive += 1;
    else renderedResidentLive += 1;
  }

  const stagedLive = stagedRetainedLive + stagedResidentLive;
  const renderedLive = renderedRetainedLive + renderedResidentLive;
  const retainedLive = cache.stats.inView;
  const usableCensus = chainCensusIsUsable(census) ? census : null;
  const scope: CellPopulationScope = usableCensus ? 'chain' : 'retained';
  const population = usableCensus ? usableCensus.live_cells : retainedLive;

  // The denominator is the SERVER stage, not the render set. Under a manual
  // clamp the two differ, and using the stage makes the medium under-claim
  // rather than over-claim — the safe direction for every judgement call in
  // this layer. The HUD discloses both numbers so the difference is visible
  // instead of merely absorbed.
  const ratio = population / Math.max(stagedLive, 1);
  const gain = cellPopulationGain(ratio);

  const censusAgeBlocks = usableCensus
    ? Math.max(0, chainTip - usableCensus.as_of.block)
    : null;

  return {
    renderedLive,
    renderedRetainedLive,
    renderedResidentLive,
    stagedLive,
    stagedRetainedLive,
    stagedResidentLive,
    stagedClasses: {
      dao: stagedClasses.dao,
      typedNonDao: stagedClasses.typedNonDao,
      plain: stagedClasses.plain,
    },
    stagedCurated: cache.displayProvenance?.mode === 'composed',
    clamped: displayPlaneActive && limit < cache.displayMembers.size,
    stageBudget: cache.displayBudget?.cells ?? null,
    retainedLive,
    retainedScope: cache.statsScope,
    observedLive: cache.stats.live,
    chainCensus: usableCensus,
    censusAgeBlocks,
    censusStale: censusAgeBlocks !== null && censusAgeBlocks > CENSUS_STALE_BLOCKS,
    scope,
    ratio,
    gain,
  };
}
