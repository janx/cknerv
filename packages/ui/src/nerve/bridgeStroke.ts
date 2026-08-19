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
// screen accumulation — carrying three deliberate departures, all of them the
// register boundary showing up as drawing rules:
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
//   * **Colour runs vein → `tissueRose`, at MATCHED luma.** The near end is
//     the resting Cell vein family; the far end is the halo's one emitted
//     colour, so the stroke arrives already speaking the halo's hue. Allowed
//     here and banned inside the halo field itself because these are sparse
//     strokes, not an accumulating field: the desaturation trap that killed
//     the halo's own ramp (cab0d7b) needs thousands of overlapping ramps to
//     bite. ⚠️ The luma match is not decoration — see
//     {@link BRIDGE_SYMBOLIC_DIM}.

import type { BridgeEdge } from '../geometry/bridgeEdges';
import { bezierAtInto, bezierControlInto, fnv1a } from '../geometry/edgeBezier';
import { consensusRouteColors } from '../derives/consensusFlow.derive';
import { CELL_GALAXY_PALETTE } from '../visualPalette';
import { populationFibreTaper } from '../materials/populationFieldMaterial';
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
 * The ladder the design asks for is 3.4 px (pulse) / 2.5 (mesh) / ~1.7
 * (bridge) / 1 (halo terminal), and `1.7 / 2.5 = 0.68`. Stored as the ratio
 * rather than as 1.7 because `cell.fabricWidth` is a live knob: a fixed
 * 1.7 stops being the mid rung the moment the mesh moves, and a constant that
 * was calibrated against another constant has to follow it.
 */
export const BRIDGE_WIDTH_RATIO = 0.68;

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
 */
export const BRIDGE_FAR_END_ENERGY = TWIG_MIN;

/** Rec. 709 relative luma. Only ever used to compare two colours' brightness
 *  against each other, which is what it is exact for. */
function luma(color: readonly [number, number, number]): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/**
 * How far `tissueRose` is dimmed before it becomes the stroke's far-end
 * colour: exactly enough to match the luma of that stroke's own vein colour.
 *
 * ⚠️ This is load-bearing, and the arithmetic says so. `tissueRose`
 * (1.0, 0.40, 0.44) has luma 0.531; the vein family sits near 0.151 — three
 * and a half times darker. Ramping raw between them puts a rising factor on
 * the stroke that the taper has to fight, and it LOSES: with the far end at
 * TWIG_MIN the product peaks 16% ABOVE the knot at t = 0.25. The stroke would
 * brighten on its way into the halo, which is the one thing this class may
 * not do.
 *
 * Matching the luma makes the ramp carry HUE only, and leaves
 * {@link bridgeTaper} as the sole energy axis — so "monotone, no brightening
 * at the last vertex" is true by construction instead of by luck, in every
 * channel and for every vein the hash draws.
 */
export function bridgeSymbolicDim(
  vein: readonly [number, number, number],
): number {
  const roseLuma = luma(CELL_GALAXY_PALETTE.tissueRose);
  return roseLuma > 0 ? luma(vein) / roseLuma : 0;
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
  /** Symbolic end: the halo's one emitted colour. */
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
  const rose = CELL_GALAXY_PALETTE.tissueRose;
  const dim = bridgeSymbolicDim(vein);
  return {
    cellId: bridge.cellId,
    anchorIndex: bridge.anchorIndex,
    fromX: bridge.fromX, fromY: bridge.fromY, fromZ: bridge.fromZ,
    ctrlX: ctrl[0], ctrlY: ctrl[1], ctrlZ: ctrl[2],
    toX: bridge.toX, toY: bridge.toY, toZ: bridge.toZ,
    fromR: vein[0], fromG: vein[1], fromB: vein[2],
    toR: rose[0] * dim, toG: rose[1] * dim, toB: rose[2] * dim,
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
 * `sample` is a caller-owned 3-float scratch (see `bezierAtInto`).
 */
export function writeBridgeStroke(
  positions: Float32Array,
  colors: Float32Array,
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
    written += 1;

    prevX = sample[0];
    prevY = sample[1];
    prevZ = sample[2];
    prevR = endR;
    prevG = endG;
    prevB = endB;
    if (t >= tEnd) break;
  }
  return written;
}
