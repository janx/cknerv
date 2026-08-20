// How one bridge is drawn: its persistent record, and the segment writer that
// turns it into capsule geometry.
//
// Split out of the layer for the usual reason — an R3F layer cannot be tested,
// and everything here can. It writes into plain interleaved Float32Arrays
// (`makeFatLineLayer`'s `positions` / `colors`), so nothing in this file
// touches three, React, or a clock.
//
// The stroke is the fabric's primitive and the fabric's curve — a quadratic
// Bezier at `FABRIC_SAMPLES_PER_EDGE` samples, screen-space capsules, bounded
// screen accumulation — carrying four deliberate departures, all of them the
// register boundary showing up as drawing rules:
//
//   * **The WIDTH varies along the stroke**, which nothing else in this scene
//     does. 2.4 CSS px at the Cell, 1.8 at the symbolic end — the halo
//     backbone's own rung, so the merge has no width step in it. See
//     {@link BRIDGE_TIP_WIDTH_RATIO} for why a class would want this and why
//     a wider RUNG was not available to it, and
//     `enableTaperedCapsuleWidthMaterial` for the two attributes that carry
//     it.
//
//   * **The taper is {@link bridgeTaper}, not `fabricTaper`.** The fabric is
//     bright at both endpoints because both endpoints are Cells. A bridge's
//     far endpoint is symbolic, so the curve falls monotonically and never
//     brightens at the last vertex.
//   * **`render.flash` is read and discarded.** The fabric's retirement flash
//     lifts the WHOLE stroke, and half of this stroke is in the halo — a
//     death flash there would light the unresolved mass for an event that
//     happened to one named Cell. The retract GEOMETRY is the fabric's; the
//     flash is not.
//   * **Colour runs vein → the halo's STROKE hue, at MATCHED luma.** The near
//     end is the resting Cell vein family; the far end is what the halo's own
//     filaments emit, so the stroke arrives already speaking the hue of the
//     thing it merges into. Since 2026-08-20 that is
//     `POPULATION_STROKE_COLOR` — the vein family at the halo's red ceiling —
//     rather than `tissueRose`, which is now the halo's BEAD colour: a bridge
//     merges into a STRAND, not into a bead chain, and its far end has to land
//     where it lands. The two ends are consequently near-identical in hue and
//     the ramp is almost a pure taper, which is the register boundary reading
//     as a change of LEVEL alone. Allowed here and banned inside the halo
//     field itself because these are sparse strokes, not an accumulating
//     field: the desaturation trap that killed the halo's own ramp (cab0d7b)
//     needs thousands of overlapping ramps to bite. ⚠️ The luma match is not
//     decoration — see {@link bridgeSymbolicDim}.

import type { BridgeEdge } from '../geometry/bridgeEdges';
import { bezierAtInto, bezierControlInto, fnv1a } from '../geometry/edgeBezier';
import { consensusRouteColors } from '../derives/consensusFlow.derive';
import {
  POPULATION_STROKE_COLOR,
  populationFibreTaper,
} from '../materials/populationFieldMaterial';
import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';
import {
  fabricEdgeRenderState,
  type EdgeLifecycle,
  type EdgeRender,
} from './fabricEdgeRender';
import {
  arborBrightness,
  bridgeTaper,
  passiveFabricEnergyScale,
  TWIG_MIN,
} from './fabricLuminance';

/**
 * Screen width of a bridge, as a RATIO of the fabric's.
 *
 * The ladder now reads 4.6 px (pulse) / 4.4 (trunk) / 2.5 (mesh) / **2.4
 * (bridge)** / 1.8 (halo backbone) / 1 device px (halo hairline), and
 * `2.4 / 2.5 = 0.96`. Stored as the ratio rather than as 2.4 because
 * `cell.fabricWidth` is a live knob: a fixed 2.4 stops being the mid rung the
 * moment the mesh moves, and a constant that was calibrated against another
 * constant has to follow it.
 *
 * ⭐ **1.7 → 2.0 → 2.4 CSS px across 2026-08-20, both steps by live review
 * rather than by drift.** The first verdict was that the secondary nerves do
 * not read at the operating camera — in its honest form, that it was not clear
 * whether this class was rendering at all — and this class is the mixed band's
 * headline stroke. It gained width here and hue at its symbolic end (see
 * {@link bridgeSymbolicDim}). The second verdict is milder and different: the
 * class reads now, and what it does not do is read as ITS OWN class. That is a
 * problem width alone cannot fix, because the rung above it (the mesh, 2.5) is
 * fixed by the fabric and the rung below it (the halo backbone, 1.8) is where
 * this stroke has to LAND — a bridge merges into a halo strand, so its far end
 * arriving at the strand's own width is the point, not a coincidence.
 *
 * ⚠️ So this is the KNOT's width — the widest point of a stroke that is not
 * one width at all. 2.4 sits deliberately close to the mesh, 0.1 CSS px under
 * it, because a ladder is not what separates this class: {@link
 * BRIDGE_TIP_WIDTH_RATIO} is. It stays under the mesh at every camera, since
 * both ride the same `cellDetailFabricWidthScale`.
 */
export const BRIDGE_WIDTH_RATIO = 0.96;

/**
 * The SYMBOLIC end's width, as a ratio of the fabric's: 1.8 CSS px, which is
 * `POPULATION_BACKBONE_WIDTH_PX` exactly.
 *
 * ## The bridge is the scene's only stroke that changes width along its length
 *
 * Every other screen-space stroke in this frame is one width from end to end,
 * because `LineMaterial` states width in a uniform and because for every other
 * class that is correct — a fabric edge is an edge for its whole length, a
 * pulse is a pulse. This class is the exception by construction: it starts on
 * a real staged Cell and ends part-way along a fibre of the unresolved-
 * population halo, and the two ends are not the same KIND of thing. That is
 * the entire reason the class exists. It already says so in energy
 * ({@link bridgeTaper}) and in hue ({@link bridgeSymbolicDim}); this is it
 * saying so in the one channel a viewer reads without having to find a second
 * stroke to compare against.
 *
 * ⭐ **And it is the answer to a problem the width ladder could not solve.**
 * The 2026-08-20 verdict was that the three nerve classes do not read as
 * different enough from each other. For the other two the answer was a wider
 * step — the trunk went 3.2 → 4.4, the halo backbone 1.6 → 1.8. There is no
 * such move available here: the rung above is the fabric mesh at 2.5, fixed,
 * and the rung below is where this stroke has to LAND. A bridge merges into a
 * halo strand, so arriving at the strand's own width is the point of it, and a
 * width step at the merge would be exactly the junction emphasis the halo's
 * whole design forbids. Between 2.5 and 1.8 there is no rung to take. So the
 * class stops competing for one: a stroke that VARIES is not a rung, it is a
 * different kind of mark, and there is nothing else like it in the frame.
 *
 * ## What it costs, which is deliberately almost nothing
 *
 * The taper is the signature, not a brightness raise. Measured over the 1,600
 * selected bridges at the production camera (86,903 px of screen length, mean
 * 54.3 px a stroke): flat 2.0 covered 173,807 device px², the 2.4 → 1.8 taper
 * covers 182,497, **+5.0%**. Weighted by the energy each part of the stroke
 * actually carries — `bridgeTaper` falls from the knot, so the wide half is
 * also the bright half — the light-weighted mean width is 2.18 px against 2.0,
 * +8.9%. Both are recorded rather than rounded away: this class is a little
 * heavier than it was, and that is the cost of the knot being legible.
 *
 * ⚠️ The far end is pinned to the backbone's rung rather than solved for a
 * light-neutral mean, and that is a choice. Solving for neutrality would put
 * the knot at 2.12 and leave a 1.18x range along the stroke — too subtle to be
 * a signature, which would be paying the whole implementation cost for nothing.
 * The merge width is the load-bearing number; the mean follows it.
 */
export const BRIDGE_TIP_WIDTH_RATIO = 0.72;

/**
 * The taper as the shader takes it: a factor on the material's own width.
 *
 * `LineMaterial.linewidth` carries the KNOT ({@link BRIDGE_WIDTH_RATIO} of the
 * live `cell.fabricWidth`, times the camera focus scale), so the per-instance
 * lane only has to say how much of it each endpoint keeps. Expressed as the
 * ratio of the two ratios rather than as 0.75 written out, so the taper follows
 * both ends if either constant moves.
 */
export const BRIDGE_TIP_WIDTH_SCALE =
  BRIDGE_TIP_WIDTH_RATIO / BRIDGE_WIDTH_RATIO;

/**
 * Width factor at Bezier parameter `t`, from 1 at the knot to
 * {@link BRIDGE_TIP_WIDTH_SCALE} at the symbolic end.
 *
 * Linear, where {@link bridgeTaper} is parabolic — on purpose. The energy curve
 * is the fabric's own parabola with its rising half removed, so it is steep
 * near the knot and flat at the far end; a width that copied it would put the
 * whole width change in the first quarter of the stroke and read as a blob with
 * a hairline off it. A linear width against a parabolic energy is what makes
 * the two channels legible as two things.
 *
 * ⚠️ A function of the CURVE parameter, never of the drawn fragment. A
 * retracting bridge is a tapered object being withdrawn into its Cell, so its
 * visible far end gets WIDER as it shortens; a growing one is a short fat stub
 * that extends and thins. Keying on the drawn extent instead would re-taper the
 * remaining stub each frame, which is an animation nobody asked for.
 */
export function bridgeWidthScale(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 + (BRIDGE_TIP_WIDTH_SCALE - 1) * u;
}

/**
 * The far end's energy, as a fraction of the knot, before the anchor's own
 * weight scales it.
 *
 * {@link TWIG_MIN} — the dimmest energy the fabric class ever draws. The
 * bridge is the fabric's faintest member by construction, and using the
 * fabric's own floor keeps the ladder expressible in one number instead of a
 * new one. Scaled per bridge by `populationFibreTaper(anchorWeight)`
 * (measured range 0.43–1.0 over the placement), so a stroke landing on a thin
 * part of the halo ends thinner than one landing on a thick part — the
 * halo's own taper law, reaching across the register boundary.
 *
 * ⚠️ It is the BEAD's half of that law, on purpose, and the divergence is
 * deliberate rather than missed. On 2026-08-20 the halo's own two stroke
 * classes gained `POPULATION_STROKE_TAPER_FLOOR`, which lifts a thin-tissue
 * stroke to 0.75 where this reads 0.43 — a visibility floor for marks the
 * fringe was losing under the eye's threshold. This class is not in that
 * regime: it is 2.4 CSS px at the knot in the MIXED band, the widest rung
 * below the mesh, and it is the one stroke here that must arrive at the halo
 * looking like it is thinning INTO it — in width now as well as in level, see
 * {@link BRIDGE_TIP_WIDTH_RATIO}. Flooring the far end would flatten exactly
 * the ramp this constant exists to draw.
 */
export const BRIDGE_FAR_END_ENERGY = TWIG_MIN;

/** Rec. 709 relative luma. Only ever used to compare two colours' brightness
 *  against each other, which is what it is exact for. */
function luma(color: readonly [number, number, number]): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/**
 * How far the halo's stroke colour is dimmed before it becomes this stroke's
 * far-end colour: exactly enough to match the luma of the stroke's own vein.
 *
 * ⚠️ The trap it was installed against, kept because it is what the technique
 * is FOR. Against the old endpoint — `tissueRose` (1.0, 0.40, 0.44), luma
 * 0.531, against a vein family near 0.151, three and a half times darker —
 * ramping raw puts a rising factor on the stroke that the taper has to fight,
 * and it loses: with the far end at TWIG_MIN the product reads 16% ABOVE the
 * knot at t = 0.25 (re-derived: 15.7% for the darkest vein the hash draws,
 * 19% at the last vertex). The stroke would brighten on its way into the halo,
 * which is the one thing this class may not do.
 *
 * ⭐ **Re-derived for the new endpoint on 2026-08-20.**
 * `POPULATION_STROKE_COLOR` is (1, 0.125, 0.333) at luma 0.3261, so the gap to
 * the vein is 1.94–2.16x rather than 3.16–3.51x, and the factor lands at
 * **0.464–0.515** (0.489 at the middle of the hash range) where it used to be
 * 0.285–0.316. That is a real change of behaviour and worth stating: the raw
 * ramp to THIS endpoint no longer peaks at all — its worst product is 0.917 of
 * the knot at t = 0.25 and 0.733 at the last vertex — so the match is no
 * longer the only thing standing between this class and a brightening far end.
 * It is kept because a margin is not a construction: `farEnd` moves with the
 * anchor's own halo weight, and the whole point of the technique is that
 * {@link bridgeTaper} is the SOLE energy axis rather than the winner of a
 * fight. The match also now leaves the ramp nearly colour-constant — vein
 * (0.479, 0.065, 0.160) to far end (0.489, 0.061, 0.163) — because both
 * registers finally speak the same vessel hue; where the old endpoint sent
 * green UP by 86% along a falling stroke, this sends it down by 5%.
 *
 * Matching the luma makes the ramp carry HUE only, and leaves
 * {@link bridgeTaper} as the sole energy axis — so "monotone, no brightening
 * at the last vertex" is true by construction instead of by luck, in every
 * channel and for every vein the hash draws.
 */
export function bridgeSymbolicDim(
  vein: readonly [number, number, number],
): number {
  const strokeLuma = luma(POPULATION_STROKE_COLOR);
  return strokeLuma > 0 ? luma(vein) / strokeLuma : 0;
}

/** One bridge, as the layer keeps it across frames. Endpoints and control
 *  point are snapshotted at birth exactly as `EdgeState` does, so a retracting
 *  bridge outlives the host Cell that is gone from the stage. */
export interface BridgeStrokeState {
  cellId: number;
  anchorIndex: number;
  fromX: number; fromY: number; fromZ: number;
  ctrlX: number; ctrlY: number; ctrlZ: number;
  toX: number; toY: number; toZ: number;
  /** Actual end: the resting Cell vein family. */
  fromR: number; fromG: number; fromB: number;
  /** Symbolic end: the halo's stroke colour, at the vein's luma. */
  toR: number; toG: number; toB: number;
  /** Where {@link bridgeTaper} bottoms out for this stroke. */
  farEnd: number;
  /** The fabric's non-forest brightness band — faint tissue, no faked trunk. */
  brightnessMul: number;
  /** Sim seconds the stroke started growing out of its host. */
  bornAt: number;
  /** Sim seconds the host stopped being a host, or null while it is one. */
  dyingAt: number | null;
}

export function makeBridgeStrokeState(
  bridge: BridgeEdge,
  bornAt: number,
): BridgeStrokeState {
  // Seeded off the decimal id, never a 32-bit pack of it: Cell ids reach the
  // 2^52 range and `fabricEdgeSeed`'s `>>> 0` would collapse two of them.
  const seed = fnv1a(`${bridge.cellId}#${bridge.anchorIndex}`);
  const ctrl = new Float32Array(3);
  bezierControlInto(
    ctrl,
    bridge.fromX, bridge.fromY, bridge.fromZ,
    bridge.toX, bridge.toY, bridge.toZ,
    seed,
  );
  const vein = consensusRouteColors(seed).from;
  // The halo's STROKE hue, which is what this end merges into — the beads'
  // `tissueRose` would land a strand's tip on the wrong class's colour.
  const halo = POPULATION_STROKE_COLOR;
  const dim = bridgeSymbolicDim(vein);
  return {
    cellId: bridge.cellId,
    anchorIndex: bridge.anchorIndex,
    fromX: bridge.fromX, fromY: bridge.fromY, fromZ: bridge.fromZ,
    ctrlX: ctrl[0], ctrlY: ctrl[1], ctrlZ: ctrl[2],
    toX: bridge.toX, toY: bridge.toY, toZ: bridge.toZ,
    fromR: vein[0], fromG: vein[1], fromB: vein[2],
    toR: halo[0] * dim, toG: halo[1] * dim, toB: halo[2] * dim,
    farEnd: BRIDGE_FAR_END_ENERGY
      * populationFibreTaper(bridge.anchorWeight),
    brightnessMul: arborBrightness(undefined, seed),
    bornAt,
    dyingAt: null,
  };
}

/** Reused so the per-frame walk allocates nothing. Two of its five fields are
 *  fixed for the whole class — see {@link bridgeRenderState}. */
const BRIDGE_LIFECYCLE: EdgeLifecycle = {
  bornAt: 0,
  dyingAt: null,
  deathKind: 'death',
  deadEnd: 'to',
  growDir: 1,
};

/**
 * The fabric's grow/retract machinery, driving a bridge.
 *
 * `growDir: 1` extends the tip from the Cell outward, so the stroke visibly
 * originates at the real end. `deadEnd: 'to'` retracts the SYMBOLIC end back
 * toward the Cell, so the last thing on screen is the actual end and the
 * withdrawal never leaves a lit mark in the halo. Both exits use the same
 * direction — a host that died and a host the budget displaced both withdraw
 * their stroke — because the difference is a fact about a Cell and the halo
 * end is not entitled to report it.
 *
 * `'death'` rather than `'gc'` for the same reason: `'gc'` fades at full
 * length, which would leave the symbolic end lit and dimming in place;
 * `'death'` shortens. The retirement FLASH that comes with it is discarded by
 * {@link writeBridgeStroke}.
 */
export function bridgeRenderState(
  st: BridgeStrokeState,
  nowSec: number,
): EdgeRender {
  BRIDGE_LIFECYCLE.bornAt = st.bornAt;
  BRIDGE_LIFECYCLE.dyingAt = st.dyingAt;
  return fabricEdgeRenderState(BRIDGE_LIFECYCLE, nowSec);
}

/**
 * Write one bridge's sub-segments into a fat-line layer's arrays.
 *
 * Returns how many segments were written, which is zero for an invisible
 * stroke and short of `FABRIC_SAMPLES_PER_EDGE` when the allocation runs out.
 * The caller draws living strokes before retracting ones, so an overflow can
 * only clip an afterimage — the fabric's own rule.
 *
 * `widths` is the per-endpoint width lane ({@link bridgeWidthScale}), stride 2
 * against the stride-6 position and colour arrays. It is the only one of the
 * three that is optional: the layer allocates it only when it was built for a
 * tapered class, and a caller that does not pass it draws the material's flat
 * width, which is what every other consumer of `makeFatLineLayer` wants.
 *
 * `sample` is a caller-owned 3-float scratch (see `bezierAtInto`).
 */
export function writeBridgeStroke(
  positions: Float32Array,
  colors: Float32Array,
  widths: Float32Array | undefined,
  atSegment: number,
  maxSegments: number,
  st: BridgeStrokeState,
  render: EdgeRender,
  baseEnergy: number,
  centerDim: number,
  sample: Float32Array,
): number {
  if (!render.visible || render.alphaMul <= 0 || baseEnergy <= 0) return 0;
  const energy = baseEnergy * render.alphaMul * st.brightnessMul;
  const tStart = render.tStart;
  const tEnd = render.tEnd;

  bezierAtInto(
    sample,
    st.fromX, st.fromY, st.fromZ,
    st.ctrlX, st.ctrlY, st.ctrlZ,
    st.toX, st.toY, st.toZ,
    tStart,
  );
  let prevX = sample[0];
  let prevY = sample[1];
  let prevZ = sample[2];
  // The core de-glare applies unchanged. Hierarchy, usage and flash are all
  // zero: a bridge is never a trunk, is never reinforced, and never flashes,
  // so it reclaims no headroom the dense centre gives up. At the rim, where
  // bridges live, this is exactly 1 and the term is inert — it is here so the
  // one bridge that does land near the centre cannot bypass the ceiling.
  let prevEnergy = energy
    * bridgeTaper(tStart, st.farEnd)
    * passiveFabricEnergyScale(prevX, prevZ, 0, 0, 0, centerDim);
  let prevR = (st.fromR + (st.toR - st.fromR) * tStart) * prevEnergy;
  let prevG = (st.fromG + (st.toG - st.fromG) * tStart) * prevEnergy;
  let prevB = (st.fromB + (st.toB - st.fromB) * tStart) * prevEnergy;
  // Off the CURVE parameter, exactly as the colour and the energy above are,
  // so the three channels agree about where along the stroke a vertex is even
  // while it is growing or retracting.
  let prevWidth = bridgeWidthScale(tStart);

  let written = 0;
  for (let index = 1; index <= FABRIC_SAMPLES_PER_EDGE; index += 1) {
    if (atSegment + written >= maxSegments) break;
    const rawT = tStart
      + (tEnd - tStart) * (index / FABRIC_SAMPLES_PER_EDGE);
    const t = rawT > tEnd ? tEnd : rawT;
    bezierAtInto(
      sample,
      st.fromX, st.fromY, st.fromZ,
      st.ctrlX, st.ctrlY, st.ctrlZ,
      st.toX, st.toY, st.toZ,
      t,
    );
    const endEnergy = energy
      * bridgeTaper(t, st.farEnd)
      * passiveFabricEnergyScale(sample[0], sample[2], 0, 0, 0, centerDim);
    const endR = (st.fromR + (st.toR - st.fromR) * t) * endEnergy;
    const endG = (st.fromG + (st.toG - st.fromG) * t) * endEnergy;
    const endB = (st.fromB + (st.toB - st.fromB) * t) * endEnergy;
    const endWidth = bridgeWidthScale(t);

    const offset = (atSegment + written) * 6;
    positions[offset + 0] = prevX;
    positions[offset + 1] = prevY;
    positions[offset + 2] = prevZ;
    positions[offset + 3] = sample[0];
    positions[offset + 4] = sample[1];
    positions[offset + 5] = sample[2];
    colors[offset + 0] = prevR;
    colors[offset + 1] = prevG;
    colors[offset + 2] = prevB;
    colors[offset + 3] = endR;
    colors[offset + 4] = endG;
    colors[offset + 5] = endB;
    if (widths !== undefined) {
      const widthOffset = (atSegment + written) * 2;
      widths[widthOffset] = prevWidth;
      widths[widthOffset + 1] = endWidth;
    }
    written += 1;

    prevX = sample[0];
    prevY = sample[1];
    prevZ = sample[2];
    prevR = endR;
    prevG = endG;
    prevB = endB;
    prevWidth = endWidth;
    if (t >= tEnd) break;
  }
  return written;
}
