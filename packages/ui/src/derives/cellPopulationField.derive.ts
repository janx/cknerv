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
// clock. The staged counts are read off the reducer's `stagePopulation`
// tally, which the cells reducer keeps in the same O(touched ids) pass as the
// stage script census — this derive no longer walks the membership, and the
// only two regimes in which it walks anything are the manual presentation
// clamp (a prefix, the same one the render set rebuilds under a clamp) and
// the no-display-plane fallback of a server that predates the stage. Still
// never per frame: the overlay resolution alone is a handful of Map reads.

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
  | 'stagePopulation'
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
 *  first is what keeps these bins disjoint (`cellPopulationClass` in
 *  `@cknerv/cache`, where the reducer counts them). */
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
  /** When the current membership's provenance was stamped, or null without a
   *  display plane. A NEW stamp is the server publishing another composition —
   *  the one movement that can leave both the seat count and the curated share
   *  reading exactly what they read a moment ago (`boot/stageCompose.ts`). */
  stageComposedAtMs: number | null;
  /** True while the presentation clamp makes the render set smaller than the
   *  server stage. Both numbers are then disclosed, because continuing to
   *  call the whole stage addressable would be false. */
  clamped: boolean;
  /** The display plane's Cell budget, or null without a plane. Disclosed so
   *  the boot tail can say how full the stage is against what the server
   *  intends to fill (`boot/stageCompose.ts`). */
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
   *  They count as rendered, deduplicated, and never as staged. A handful at
   *  most — this list is tested by linear scan, never materialized. */
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
  // The presentation clamp bites: the render set draws only the first `limit`
  // resolved members. AUTO never enters this regime — the server keeps the
  // membership within its own budget — so it is the manual knob's regime, and
  // the one in which the render set itself falls back to a full rebuild.
  const clamped = displayPlaneActive && limit < cache.displayMembers.size;

  let stagedRetainedLive = 0;
  let stagedResidentLive = 0;
  let stagedDao = 0;
  let stagedTypedNonDao = 0;
  let stagedPlain = 0;
  let renderedRetainedLive = 0;
  let renderedResidentLive = 0;
  // Overlay ids the rendered prefix was found to cover, in the two regimes
  // that walk a prefix. Allocated only on a hit; the prefix's own ids are
  // never materialized — the overlay is the short list, so each visited slot
  // is tested against it, not the other way round.
  let prefixOverlayHits: number[] | null = null;

  if (displayPlaneActive) {
    // The reducer counts the stage where it lives, in the same pass that
    // keeps the stage script census: alive members by resolving home and by
    // census bin, over exactly the payloads `rebuildCellRenderSet` resolves
    // (canonical-first, unresolvable members skipped). Reading it here is
    // what keeps this derive off the 12,000-member walk it used to make on
    // every Cell-bearing batch.
    const staged = cache.stagePopulation;
    stagedRetainedLive = staged.retainedLive;
    stagedResidentLive = staged.residentLive;
    stagedDao = staged.dao;
    stagedTypedNonDao = staged.typedNonDao;
    stagedPlain = staged.plain;

    if (!clamped) {
      // Unclamped, every resolved member is drawn: the render set IS the
      // stage, so its live coverage is the stage's.
      renderedRetainedLive = stagedRetainedLive;
      renderedResidentLive = stagedResidentLive;
    } else if (limit > 0) {
      // Mirror `rebuildCellRenderSet` exactly: staged members in enter order,
      // resolved canonical-first, the first `limit` of which are drawn. A
      // divergence here would report a coverage the renderer does not have.
      let resolved = 0;
      for (const id of cache.displayMembers) {
        const canonical = cache.cells.get(id);
        const cell = canonical ?? cache.displayResidents.get(id);
        if (!cell) continue;
        if (overlayCellIds.length > 0 && overlayCellIds.includes(id)) {
          (prefixOverlayHits ??= []).push(id);
        }
        if (cell.death_at_ms === null) {
          if (canonical) renderedRetainedLive += 1;
          else renderedResidentLive += 1;
        }
        resolved += 1;
        if (resolved >= limit) break;
      }
    }
  } else {
    // No display plane: the renderer falls back to the canonical
    // insertion-order prefix, and there is no server stage to speak of.
    let drawn = 0;
    for (const cell of cache.cells.values()) {
      if (drawn >= limit) break;
      drawn += 1;
      if (overlayCellIds.length > 0 && overlayCellIds.includes(cell.id)) {
        (prefixOverlayHits ??= []).push(cell.id);
      }
      if (cell.death_at_ms === null) renderedRetainedLive += 1;
    }
  }

  // Client inspection overlays are rendered records the server did not stage.
  // They count once, in `rendered*` only — counting them as staged would
  // report a membership the display plane never published. An overlay id the
  // render set already draws is not a second body: unclamped, that is any
  // staged member (a member with no record is drawn by neither, and resolves
  // to nothing below either way); under a clamp or without a plane, it is
  // whatever the prefix walk above met.
  for (let index = 0; index < overlayCellIds.length; index += 1) {
    const id = overlayCellIds[index];
    // Named twice by the inspection field: counted once.
    if (overlayCellIds.indexOf(id) !== index) continue;
    const drawnByPrefix = displayPlaneActive && !clamped
      ? cache.displayMembers.has(id)
      : prefixOverlayHits !== null && prefixOverlayHits.includes(id);
    if (drawnByPrefix) continue;
    const canonical = cache.cells.get(id);
    const cell = canonical ?? cache.displayResidents.get(id);
    if (!cell) continue;
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
      dao: stagedDao,
      typedNonDao: stagedTypedNonDao,
      plain: stagedPlain,
    },
    stagedCurated: cache.displayProvenance?.mode === 'composed',
    stageComposedAtMs: cache.displayProvenance?.updated_at_ms ?? null,
    clamped,
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
