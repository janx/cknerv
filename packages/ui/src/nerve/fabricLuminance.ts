// Spatial energy compression for the passive Cell consensus fabric.
//
// Additive blending has no knowledge of how many routes overlap a pixel. The
// dense field centre therefore needs a lower per-route energy floor than the
// sparse rim. This pure helper shapes that floor while allowing semantically
// important structure (real arbor trunks, recently used routes, lifecycle
// flashes) to reclaim headroom. Active protocol writes use their own layer and
// intentionally bypass this function.

export const FABRIC_CORE_INNER_RADIUS = 3;
export const FABRIC_CORE_OUTER_RADIUS = 24;
export const FABRIC_TRUNK_RECLAIM = 0.34;
export const FABRIC_USAGE_RECLAIM = 0.52;

/** Floor brightness at the midpoint of a fabric edge, as a fraction of the
 *  endpoint brightness (art-direction baseline, see canvas-rendering.md).
 *  Moved here from NeuralFabric so the GLSL lifecycle port and the CPU
 *  reference share one definition. */
export const TAPER_MIN = 0.44;

/** Floor brightness for twig / non-forest cross-link edges — the bottom of
 *  the per-edge brightnessMul range and the zero point of the hierarchy
 *  normalization. Moved here from NeuralFabric with TAPER_MIN. */
export const TWIG_MIN = 0.34;

/** Per-edge brightness multiplier ∈ [TWIG_MIN, 1.0], the fabric's trunk/branch
 *  hierarchy. Forest edges scale by their arbor weight `w` (normalized subtree
 *  size), so REAL trunks (carrying many descendants) are bright and REAL twigs
 *  dim — grown venation rather than a uniform web. Non-forest cross-links and
 *  not-yet-weighted incremental edges (`w === undefined`) get a dim textured
 *  band off the deterministic edge seed, reading as faint tissue without faking
 *  trunks. Stable per edge across its lifetime.
 *
 *  Lives here rather than in NeuralFabric because the bridge class reads it
 *  too: a bridge has no arbor, so it takes exactly the `w === undefined`
 *  band — faint tissue, no faked trunk — and that band must be ONE law. */
export function arborBrightness(w: number | undefined, seed: number): number {
  if (w !== undefined) {
    return TWIG_MIN + (1 - TWIG_MIN) * Math.pow(w, 1.2);
  }
  return TWIG_MIN + 0.10 * (((seed >>> 16) & 0xff) / 0xff);
}

/** Per-vertex brightness multiplier along a fabric edge at t ∈ [0, 1].
 *  Parabolic in (2t − 1)² so it's exactly TAPER_MIN at the midpoint and 1.0
 *  at either endpoint, with smooth rise on both sides. */
export function fabricTaper(t: number): number {
  const k = 2 * t - 1;
  return TAPER_MIN + (1 - TAPER_MIN) * k * k;
}

/**
 * Per-vertex brightness along a BRIDGE — the mixed-register stroke that runs
 * from a real Cell (t = 0) into the unresolved-population halo (t = 1).
 *
 * A new curve for this class, because {@link fabricTaper} is exactly wrong
 * here: it is bright at BOTH endpoints, and a bridge's far endpoint is a
 * symbolic one. "A halo point must never look like a node with edges
 * radiating from it" — so the far end must not brighten at all, at any
 * vertex, ever.
 *
 * The shape is the fabric's own parabola with its rising half removed:
 * `fabricTaper` falls as `(1 − 2t)²` from 1.0 at the Cell to TAPER_MIN at
 * midpoint and then climbs back; this is the same parabola stretched across
 * the whole stroke, so the two classes are visibly the same family and the
 * bridge is legibly the fabric's curve, cut. Monotone non-increasing on
 * [0, 1] by construction — the knot is at the actual end and nowhere else.
 *
 * `farEnd` is the energy the stroke arrives with, as a fraction of the knot.
 * The caller sets it from the anchor's own placement taper weight so the
 * stroke lands at the LOCAL fibre brightness rather than at a constant.
 *
 * ⚠️ Read "fades to halo-fibre energy" as relative, not absolute. Measured,
 * the two layers' per-stroke contributions are not comparable: the halo fibre
 * emits ~0.29–0.66 alpha of `tissueRose` on its own, while a fabric twig at
 * the rim contributes ~0.02 — the fabric's light comes from thousands of
 * overlapping routes, the halo's from each stroke. Matching the halo's
 * ABSOLUTE per-stroke energy would mean brightening five-fold toward the
 * symbolic end, which is the one thing this curve exists to forbid.
 */
export function bridgeTaper(t: number, farEnd: number): number {
  const end = Math.max(0, Math.min(1, farEnd));
  const u = 1 - Math.max(0, Math.min(1, t));
  return end + (1 - end) * u * u;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Brightness scale for one passive route sample.
 *
 * `centerDim` is shared with the Cell body. Squaring it gives the much denser
 * fabric a stronger core floor without introducing a second art-direction
 * control. `hierarchy` is normalized arbor trunkness; `usage` is recent real
 * packet activity; `flash` is a lifecycle event envelope. All outputs remain
 * in [0, 1], and the sparse rim is exactly 1.
 */
export function passiveFabricEnergyScale(
  x: number,
  z: number,
  hierarchy: number,
  usage: number,
  flash: number,
  centerDim: number,
): number {
  const radius = Math.hypot(x, z);
  const radialMix = smoothstep(
    FABRIC_CORE_INNER_RADIUS,
    FABRIC_CORE_OUTER_RADIUS,
    radius,
  );
  const coreFloor = clamp01(centerDim) ** 2;
  const radial = coreFloor + (1 - coreFloor) * radialMix;
  const semanticReclaim = Math.max(
    clamp01(flash),
    clamp01(hierarchy) * FABRIC_TRUNK_RECLAIM,
    clamp01(usage) * FABRIC_USAGE_RECLAIM,
  );
  return radial + (1 - radial) * semanticReclaim;
}

/**
 * ⟨D-10 · knob a⟩ The mesh tier's share of its light at the OVERVIEW camera.
 *
 * ## The finding this exists to answer
 *
 * At the default pose the fabric reads as WOOL: report D measured the core's
 * structure-tensor orientation coherence at **0.164** against an
 * isotropic-noise floor of 0.111 — i.e. barely above noise — while the halo
 * band outside the rim reads 0.212. The trunk tier is a 1.76 width step on
 * strokes about 13 px long, laid over a carpet the mesh tier has already
 * covered its own ellipse with once. A width step cannot be a hierarchy when
 * the thing it is stepping over tiles the frame: hierarchy needs empty space
 * to be read against, and `FABRIC_TRUNK_WIDTH_RATIO`'s own argument — a
 * per-stroke discriminability sweep — is an argument about TWO strokes side by
 * side, not about eight thousand.
 *
 * ## What this changes and what it deliberately does not
 *
 * It spends ENERGY, not width, and only on the mesh tier: the trunks keep
 * every bit of their light at every camera, so the tier that carries the
 * structure is never the thing that dims. That is the one direction the
 * de-glare work leaves open — the ladder's other channels are spent (the core
 * floor is `centerDim² = 0.09`, trunkness reclaims to 0.40) and WIDTH is
 * already at its ceiling under the pulse.
 *
 * It is a knob because it is art direction, and **its default is 1 — today's
 * picture exactly.** Nothing moves until the eye has seen the A/B.
 *
 * ⚠️ NOT a partition change. `fabricTrunkPassDraws` still rasterizes every
 * edge in exactly one pass; this scales the mesh pass's material colour, which
 * is the same channel `cellDetailFabricEnergyGain` already rides. Two
 * multipliers on one uniform, not two passes on one edge.
 */
export function fabricTwigViewEnergy(
  overviewWeight: number,
  focus: number,
): number {
  const weight = clamp01(overviewWeight);
  const detail = clamp01(focus);
  // Full weight arrives with the DETAIL view — `cellDetailViewFocus` is 1
  // inside `CELL_DETAIL_VIEW_NEAR_DISTANCE` and 0 past the far distance — so
  // the twigs are at their quietest exactly where the report says they read as
  // wool, and at full where a reader is looking at one neighbourhood.
  return weight + (1 - weight) * detail;
}

/**
 * ⟨D-10 · knob b⟩ The halo's THREAD level at the overview camera.
 *
 * Report D-8: the halo band is 8.6 % of the visible area and 10.8 % of the
 * light, its projected mass spans 1,158 px against a rim of 850, and its
 * orientation coherence (0.212) is HIGHER than the core's (0.164). The
 * register ruling is that the halo is symbolic and matte and the core carries
 * the structure; per stroke that is honoured, and in aggregate it is
 * contradicted — the crimson strands of the corona are the most thread-like
 * marks on screen.
 *
 * D-8's own fix line is "state the halo's amount in LEVEL, not in reach", so
 * this rides the stroke classes' emission and nothing else: not the beads
 * (they are the same matter as a Cell body at lower resolution, which is the
 * seam this design exists to remove), not the placement, not the extent.
 *
 * Same shape as the twig knob and for the same reason: the cap is spent at the
 * overview and released as the camera comes in, because at reading distance
 * the halo is context and at the overview it is the figure. **Default 1 —
 * today's picture.**
 */
export function haloThreadViewLevel(
  overviewCap: number,
  focus: number,
): number {
  const cap = clamp01(overviewCap);
  const detail = clamp01(focus);
  return cap + (1 - cap) * detail;
}
