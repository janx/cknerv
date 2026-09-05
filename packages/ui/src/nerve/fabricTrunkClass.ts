// 中央神经 — the passive fabric's trunk tier, spoken in WIDTH.
//
// The fabric's hierarchy has only ever lived in brightness and hue, and at the
// centre both are already spent: the de-glare ramp floors the core at
// `centerDim² = 0.09` and lets trunkness reclaim no further than 0.40. That
// ceiling was expensive and is not re-litigated here, which leaves WIDTH as
// the one free channel at the centre. This module is the selection that
// spends it — which edges belong to the wide capsule class, and how wide that
// class is allowed to get.
//
// ## The partition rule — the trap this file exists to avoid
//
// The passive layers blend with bounded screen accumulation (`SrcAlpha /
// OneMinusSrcColor`), which is very nearly additive at the fabric's alphas.
// Drawing a promoted edge in BOTH the mesh pass and the wide pass would
// therefore roughly DOUBLE its light and hand the figure straight back to
// brightness — the exact channel the de-glare work closed. So the tier is a
// PARTITION, not an overlay: every drawn edge is rasterized by exactly one of
// the two passes, at exactly the energy it carries today, and the only thing
// that changes is how many pixels that energy is spread across. Peak
// per-pixel energy is untouched; the figure is area, not brightness.
//
// {@link fabricTrunkPassDraws} is that obligation in one line. Its GLSL twin
// in `fabricLifecycleShader` is the same comparison against the same two
// uniforms, so the partition is enforced in the vertex stage — where both
// passes read ONE bake and therefore cannot disagree about an edge's
// lifecycle, inspection weight, or recall aperture.
//
// ## Selection rides `w`, never brightness
//
// `brightnessMul` cannot carry this. A cross-link's textured band reaches
// `TWIG_MIN + 0.10 = 0.44`, while the measured 12.5% arbor threshold below
// sits at `w = 0.1651`, i.e. `arborBrightness = 0.416` — BELOW the cross-link
// ceiling. Thresholding the drawn colour would have promoted cross-links,
// which have no arbor and no subtree to be the trunk of. So the raw
// normalized subtree size travels instead, in the lifecycle record's one
// reserved lane, with a negative sentinel for every edge that has no `w`.

/** Cross-links and not-yet-weighted incremental edges carry no arbor weight.
 *  The negative sentinel keeps them out of the wide pass structurally rather
 *  than by tuning: every threshold this module derives is strictly positive,
 *  and so is the zero a never-written slot record holds. */
export const FABRIC_TRUNK_NO_ARBOR = -1;

/** Above every attainable `w` (subtree ratios are ≤ 1), so a layer that has
 *  not yet been handed a selection draws exactly today's picture: everything
 *  in the mesh pass, nothing in the wide one. Also the resting value of the
 *  threshold uniform, which makes "the tier failed to arrive" a no-op rather
 *  than a mis-partition. */
export const FABRIC_TRUNK_THRESHOLD_DISABLED = 2;

/** Share of the DRAWN passive selection the wide class takes — the middle of
 *  the 10–15% the design allows. Measured on the AUTO composition (12,000
 *  Cells → 8,000 drawn edges: 5,907 arbor + 2,093 cross-links): the threshold
 *  lands at `w = 0.1651` and promotes 1,014 edges = 12.7% of the selection =
 *  4,056 capsule segments, inside the ≤ 5K subset budget. */
export const FABRIC_TRUNK_SHARE = 0.125;

/** The two halves of the partition, as the shader's `fabricTrunkPass`
 *  uniform reads them. */
export const FABRIC_TRUNK_PASS_MESH = 0;
export const FABRIC_TRUNK_PASS_TRUNK = 1;

/**
 * The wide rung against the passive 2.5 px: **4.4 px** at the overview camera,
 * where the whole width ladder (pulse 4.6, mesh 2.5, bridge 2.4 → 1.8 tapered,
 * halo backbone 1.8, halo hairline 1 device px) is composed and judged.
 *
 * ⭐ **1.28 → 1.76 on 2026-08-20, by live review.** The verdict was that the
 * three nerve classes do not read as different enough from each other and that
 * *the central nerves may be thicker*; the diagnosis was that the ladder had
 * been cut one pair at a time and had settled into ~1.25x adjacent steps,
 * which is below at-a-glance discriminability for two strokes that are not
 * side by side. This rung took the largest single move because it is the one
 * with the most room: the centre's OTHER two channels are already spent (the
 * de-glare ramp floors the core at `centerDim² = 0.09` and trunkness reclaims
 * no further than 0.40), which is the argument this whole module was built on.
 *
 * ## Why 1.76 and not 1.60 or 1.92
 *
 * Swept {4.0, 4.4, 4.8} against the ONE ordering rule that is not a matter of
 * taste — the rung has to stay discriminable at EVERY camera, not only at the
 * overview the ladder is composed at. The mesh takes `cellDetailFabricWidthScale`
 * and this class takes it too until {@link FABRIC_TRUNK_WIDTH_CEILING_PX}
 * bites, after which the mesh keeps growing and the ratio falls. So the number
 * that decides is the ratio at the CLOSEST camera, where the mesh is 3.05 px:
 *
 * | overview | ceiling | trunk : mesh, overview | trunk : mesh, closest | pulse |
 * |---:|---:|---:|---:|---:|
 * | 4.0 | 4.1 | 1.60 | **1.34** | 4.2 |
 * | **4.4** | **4.5** | **1.76** | **1.48** | **4.6** |
 * | 4.8 | 4.9 | 1.92 | 1.61 | 5.0 |
 *
 * 4.0 collapses to 1.34 at the near camera — a seventh above the 1.25 the
 * verdict called indistinguishable, which is not a fix. 4.4 is the smallest of
 * the three that holds above 1.4 through the whole camera range. 4.8 holds
 * more, and pays for it at the top of the ladder: the pulse has to clear the
 * ceiling, so it would go to 5.0 and drag the route-hop lock to 6.5 px — a
 * transient additive stroke at 2.6x the mesh, for 0.13 more of a ratio that is
 * already past the bar.
 *
 * The fill it costs, at the production camera on the AUTO composition (12,000
 * Cells → 8,000 drawn edges, 1,014 of them promoted, mean 34.5 px of screen
 * length each): 111,869 → 153,820 device px², against a halo point pass that
 * covers 4,785,305 px² of sprite in the same frame. **2.3% → 3.2% of it.** The
 * light rises with the area, because the tier is a partition and the promoted
 * edges' per-pixel energy is untouched: the fabric class as a whole emits
 * about 8.5% more, all of it in 12.7% of its edges.
 */
export const FABRIC_TRUNK_WIDTH_RATIO = 1.76;

/** Hard ceiling for the wide class, in CSS px. Live pulses draw at 4.6 px and
 *  the route-hop lock at 5.98 px, and NEITHER takes the close-camera focus
 *  scale — so a trunk rung that kept scaling would overtake the pulse the
 *  moment the camera came in (2.5 × 1.76 × 1.22 = 5.368 px). The ratio
 *  therefore holds until it would collide and then stops: 4.4 px at the
 *  overview, 4.5 px at the closest camera, always strictly under the pulse.
 *
 *  ⚠️ 3.3 → 4.5 on 2026-08-20, moved WITH the rung and with the pulse rather
 *  than after them: this constant is a function of `LIVE.cell.activeWidth`'s
 *  default, and the margin discipline is the one it shipped with — the ceiling
 *  sits one tenth of a CSS pixel under the pulse, so `wide < activeWidth` is
 *  strict at every camera by construction and not by luck. Move the pulse and
 *  this has to move; `fabricTrunkClass.test.ts` samples 41 cameras to say so. */
export const FABRIC_TRUNK_WIDTH_CEILING_PX = 4.5;

/**
 * Line width for the wide pass, in CSS px.
 *
 * `focusWidthScale` is the SAME `cellDetailFabricWidthScale(focus)` the mesh
 * pass multiplies by — passing it in rather than re-deriving it is what keeps
 * the two rungs on one camera curve. The ceiling never pushes the wide class
 * below the mesh class, so the ladder stays monotone even when the width knob
 * is dragged past the ceiling (fabricWidth tops out at 8 px, where the whole
 * ladder is off-scale anyway and only the ORDER still has to survive).
 */
export function fabricTrunkLineWidth(
  fabricWidthPx: number,
  focusWidthScale: number,
): number {
  const mesh = fabricWidthPx * focusWidthScale;
  const wide = mesh * FABRIC_TRUNK_WIDTH_RATIO;
  return Math.min(wide, Math.max(FABRIC_TRUNK_WIDTH_CEILING_PX, mesh));
}

/** The lane value one edge carries for its whole lifetime: its arbor weight,
 *  or the no-arbor sentinel. Stable per edge exactly as `brightnessMul` is —
 *  membership changes only when the THRESHOLD moves, never when an edge's
 *  neighbourhood does. */
export function fabricEdgeTrunkness(w: number | undefined): number {
  return w !== undefined && Number.isFinite(w) && w > 0
    ? w
    : FABRIC_TRUNK_NO_ARBOR;
}

/**
 * The partition, as one predicate. `trunkness >= threshold` selects the wide
 * half; the mesh pass takes the complement. Exactly one of the two passes
 * returns true for any (trunkness, threshold) pair, which is the whole light
 * argument: summed over both passes, an edge's contribution factor is 1.0.
 */
export function fabricTrunkPassDraws(
  trunkness: number,
  threshold: number,
  pass: number,
): boolean {
  const isTrunk = trunkness >= threshold;
  return isTrunk === (pass === FABRIC_TRUNK_PASS_TRUNK);
}

/** The resolved tier: one uniform value, plus what it actually promoted on
 *  the selection it was derived from (a gauge, not an input). */
export interface FabricTrunkTier {
  /** Trunkness at or above which an edge draws in the wide pass. */
  threshold: number;
  /** Edges the threshold promotes. */
  edges: number;
  /** `edges` as a share of the drawn selection. */
  share: number;
  /** Edges carrying a finite arbor weight (`w > 0`) — the forest the
   *  threshold partitions; the rest of the drawn selection is arbor-less
   *  cross-links that always fall to the mesh pass. A gauge, not an input:
   *  live it exposes how much of the drawn fabric the arbor actually reached
   *  (the "wool" measure — ~21 today against a ~1,014 target). */
  weighted: number;
}

const DISABLED_TIER: FabricTrunkTier = {
  threshold: FABRIC_TRUNK_THRESHOLD_DISABLED,
  edges: 0,
  share: 0,
  weighted: 0,
};

/** Only `w` is read, so this accepts anything edge-shaped — the passive
 *  selection, a delta, or a synthetic list in a test. */
export interface FabricTrunkCandidate {
  readonly w?: number;
}

/**
 * Derive the wide class from a completed passive selection.
 *
 * Deterministic and order-independent: the result is a pure function of the
 * multiset of arbor weights, so two rebuilds that select the same edges get
 * the same threshold no matter what order the builder emitted them in.
 *
 * `w = sqrt(subtreeSize / maxSubtreeSize)` over integer subtree sizes, so the
 * weights arrive in tied runs and a `>=` threshold cannot split one. Where a
 * run straddles the target the tier takes whichever of the two neighbouring
 * distinct values lands closer to it, preferring the smaller promoted set on
 * a tie — on the AUTO profile that is 1,014 promoted against a 1,000 target
 * (+1.4%), where the run's other side would have given 971 (−2.9%).
 *
 * O(arbor edges) plus one typed-array sort, on the graph-rebuild path. Never
 * per frame: the shader re-reads the resulting uniform, it does not re-run
 * this.
 */
export function fabricTrunkTier(
  edges: readonly FabricTrunkCandidate[],
  share: number = FABRIC_TRUNK_SHARE,
): FabricTrunkTier {
  const drawn = edges.length;
  const wanted = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  const target = Math.round(drawn * wanted);
  if (drawn === 0 || target <= 0) return DISABLED_TIER;

  const weights = new Float64Array(drawn);
  let count = 0;
  for (const edge of edges) {
    const trunkness = fabricEdgeTrunkness(edge.w);
    if (trunkness > 0) {
      weights[count] = trunkness;
      count += 1;
    }
  }
  if (count === 0) return DISABLED_TIER;
  // Typed-array sort is numeric ascending with no comparator and no
  // per-element allocation — this runs on every completed build.
  const arbor = weights.subarray(0, count);
  arbor.sort();
  if (target >= count) {
    // The budget wants more than the forest has: promote all of it.
    return {
      threshold: arbor[0],
      edges: count,
      share: count / drawn,
      weighted: count,
    };
  }

  // Ascending, so the target-th largest sits at `count - target`.
  const pivot = arbor[count - target];
  let low = count - target;
  while (low > 0 && arbor[low - 1] === pivot) low -= 1;
  const lowCount = count - low;
  let high = count - target;
  while (high < count && arbor[high] === pivot) high += 1;
  if (
    high < count
    && Math.abs(count - high - target) < Math.abs(lowCount - target)
  ) {
    return {
      threshold: arbor[high],
      edges: count - high,
      share: (count - high) / drawn,
      weighted: count,
    };
  }
  return {
    threshold: pivot,
    edges: lowCount,
    share: lowCount / drawn,
    weighted: count,
  };
}
