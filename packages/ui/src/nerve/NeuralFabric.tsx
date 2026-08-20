// Persistent renderer for the spatial consensus graph + separate per-frame
// layers for sparse warm routes, live writes, explicitly recalled historical
// routes, and the bounded optical acknowledgement of one click-locked route
// Cell.
//
// Each logical edge is a quadratic Bezier with a perpendicular xz
// offset on the control point (deterministic per edge), so the
// fabric reads as a layered contribution field rather than a wireframe. The
// activity layers draw sub-segments of the same curve with a brightness
// gradient — the wavefront end is bright, the wake fades exponentially
// behind it. Every layer shares the same Bezier control points so the pulse
// always rides on the visible line; recall gets independent screen weight.
//
// Fabric edges are not rebuilt as a single atomic wipe; they live in
// a persistent `edgeStates` map keyed by canonical (lo|hi) ids. A
// graph-set diff marks new entries as growing (length + alpha ramp
// over GROWTH_MS) and missing entries as dying (alpha ramp over
// DECAY_MS, length stays). Endpoint positions + control point are
// snapshotted at birth, so a dying edge can outlive its endpoint cell.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import type { NeighborGraph, NeighborEdge } from '../geometry/neighborGraph';
import { bezierAtInto, bezierControlInto, fabricEdgeSeed } from '../geometry/edgeBezier';
import { fabricEdgeKey, orderFabricStateKeys } from './fabricOrder';
import {
  FABRIC_SAMPLES_PER_EDGE,
  FABRIC_ALLOCATION_EDGE_CLASSES,
  fabricSegmentAllocation,
  warmSegmentAllocation,
} from './fabricCapacity';
import {
  FABRIC_SLOT_FILLER_Y,
  FABRIC_SLOT_SEGMENTS,
  mergeFabricSlotRanges,
  type FabricSlotRange,
} from './fabricSlots';
import { planFabricCohorts, type FabricCohortSlice } from './fabricCohorts';
import {
  enableFabricLifecycleMaterial,
  setFabricTrunkThreshold,
  syncFabricLifecycleUniforms,
} from './fabricLifecycleShader';
import {
  FABRIC_LIFE_APERTURE_END_OFFSET,
  FABRIC_LIFE_APERTURE_START_OFFSET,
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
  fabricLifecycleEndSec,
  makeFabricLifecycleArrays,
  writeFabricLifecycleSlot,
  type FabricLifecycleArrays,
} from './fabricLifecycleSlots';
import {
  fabricEdgeRenderState,
  GROWTH_MS,
  type DeathKind,
  type EdgeRender,
} from './fabricEdgeRender';
import {
  drainFabricReapQueue,
  evictDeadFabricEdges,
  fabricEdgeStateCeiling,
  startHiddenFabricReaper,
  FOREGROUND_CATCH_UP_BATCH,
  type FabricReapQueue,
  type FabricReapTargets,
} from './fabricHiddenReap';
import {
  reinforceUsage,
  decayUsage,
  warmRouteBrightnessGain,
} from './fabricReinforce';
import {
  arborBrightness,
  passiveFabricEnergyScale,
  TWIG_MIN,
  fabricTaper as taper,
} from './fabricLuminance';
import {
  FABRIC_TRUNK_PASS_TRUNK,
  fabricEdgeTrunkness,
  fabricTrunkLineWidth,
  fabricTrunkTier,
} from './fabricTrunkClass';
import {
  fabricStats,
  fabricUploadBytes,
  type FabricFullWalkReason,
} from './fabricStats';
import {
  enableLineInspectionTransitionMaterial,
  makeScreenSpaceCapsuleGeometry,
  enableTaperedCapsuleWidthMaterial,
  optimizeScreenSpaceCapsuleMaterial,
  syncScreenSpaceCapsuleViewport,
} from '../geometry/screenSpaceCapsuleLine';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import {
  consensusChromaIntensity,
  consensusRouteColors,
  consensusRouteGoldMix,
} from '../derives/consensusFlow.derive';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import type { Vec3 } from '../types';
import {
  consensusMemoryApertureAnimating,
  consensusMemoryApertureScale,
  type ConsensusMemoryAperture,
} from './consensusMemoryAperture';
import {
  cellInspectionEdgeScaleAt,
  type CellInspectionField,
} from './cellInspectionField';
import {
  cellDetailFabricEnergyGain,
  cellDetailFabricWidthScale,
} from '../derives/sceneView.derive';
import { neverRaycast } from '../components/CellPopulationField';

// Dense-mesh baseline energy (the `cell.fabricAlpha` tweak, default 0.15).
// Passive fibres use bounded screen accumulation plus spatial compression;
// active writes keep additive blending in a separate layer. The per-edge
// brightness hierarchy and taper still multiply this baseline. Read live as
// `LIVE.cell.fabricAlpha` in `emitFabric`.
// Every edge receives a deterministic crimson vascular endpoint pair from
// consensusRouteColors. Hierarchy and observed traffic warm those veins toward
// gold, restoring the visual rhythm of tissue at rest and synapses under load.

/** Hard segment cap for the active layer. Active: ~12 hops × 12
 *  sub-segments = 144 per pulse, × ~32 active pulses = 4600. (The
 *  fabric cap lives in fabricCapacity.ts.) */
const MAX_ACTIVE_SEGMENTS = 6000;
/** Recall routes use their own layer so distance compensation cannot thicken
 * live protocol writes that happen behind an explicit historical inspection. */
const MAX_MEMORY_SEGMENTS = 6000;
/** Reaped-in-place keys tolerated in renderOrder before a lazy filter pass.
 *  Tombstones cost only iteration time (every consumer skips missing
 *  states), so the threshold just bounds slow growth between full walks. */
const RENDER_ORDER_TOMBSTONE_MAX = 4096;

/** One lock response can touch at most two route edges. */
const ROUTE_HOP_PULSE_SAMPLES_PER_HOP = 24;
const MAX_ROUTE_HOP_PULSE_SEGMENTS = ROUTE_HOP_PULSE_SAMPLES_PER_HOP * 2;
const ROUTE_HOP_PULSE_WIDTH_SCALE = 1.3;

// Line widths in px (now the `cell.fabricWidth` / `cell.activeWidth`
// tweaks, defaults 2.5 / 4.6): visibly substantial crisp lines that read
// against post-bloom cells, the fabric staying clearly thinner than the
// active wavefront. Read live — `LIVE.cell.fabricWidth/activeWidth` seed
// the layers at build time (useMemo below). Historical recall scales only its
// own material from the same active-width baseline.
//
// ⚠️ The mesh rung is 2.5 and the WIDE half of the same selection is 4.4
// (`fabricTrunkLineWidth`), so "the fabric" is two widths and the active
// wavefront has to clear the larger one. That is why the active default is
// 4.6 rather than the 3.4 it carried before 2026-08-20 — see
// `FABRIC_TRUNK_WIDTH_CEILING_PX`, which is derived from this number.

// Fabric edge lifecycle timings (GROWTH_MS growth window, DECAY_MS quiet
// gc fade, DEATH_RETRACT_MS/DEATH_FLASH_MS real-death retract+flash) now
// live in ./fabricEdgeRender as the single source of truth, shared with
// the pure `fabricEdgeRenderState` render-math this layer draws from.

/** Per-frame request to draw one active hop. The renderer samples
 *  the same Bezier the fabric uses, then emits the active quality budget's
 *  sub-segments with a brightness gradient peaking at `frontT`
 *  (the wavefront's normalised position along this hop). */
export interface ActiveHop {
  fromCellId: number;
  toCellId: number;
  /** Historical recall and lock response do not share live-write buffers. */
  mode: 'live' | 'memory' | 'lock';
  /** Wavefront position in [0, 1] along the hop's Bezier. */
  frontT: number;
  /** Optional travel direction without swapping the route-order Bezier. */
  direction?: 1 | -1;
  /** Overall brightness multiplier for this hop. Older trail hops
   *  get smaller values so the cascade reads as a fading wake. */
  brightness: number;
  /** Exponential falloff behind frontT. Recall afterimages lower this so the
   *  full proven route remains legible; live wavefronts use the tight default. */
  tailDecay?: number;
  /** Route chroma identity; lock echoes retain the recalled route's colour. */
  color: Vec3;
}

export interface NeuralFabricHandles {
  /** Grade passive structure by bounded real adjacency around one inspected
   * Cell. Active writes and recalled routes keep their independent layers. */
  setInspectionField(field: CellInspectionField | null): void;
  /** Clear passive noise only behind exact recalled-route wavefronts. */
  setRecallAperture(
    active: ConsensusMemoryAperture | null,
    activeStrength: number,
    departing: ConsensusMemoryAperture | null,
    departingStrength: number,
  ): void;
  /** Maintain recalled-route screen weight as broad framing moves away. */
  setMemoryRouteWidthScale(scale: number): void;
  /** Push one active hop's worth of curve sub-segments into this
   *  frame's buffer. Driven from the orchestrator's per-frame loop. */
  pushActiveHop(hop: ActiveHop, cells: ReadonlyMap<number, Cell>): void;
  /** Commit both live and recalled activity buffers at end of frame. */
  flushActive(): void;
  /** Commit the raw-clock lock response without touching sim-clock traffic. */
  flushRouteHopPulse(): void;
  /** Re-derive the WIDTH tier (中央神经) from a completed passive selection.
   *  Its own entry point because the tier is a property of the whole DRAWN
   *  selection and the delta path — the one ordinary per-block churn takes —
   *  never hands this layer that selection; `setFabric` calls it internally so
   *  the boot and remount paths need no extra call. Publishes ONE threshold to
   *  both passive passes: they must agree, or an edge is drawn twice or not at
   *  all. */
  setTrunkTier(graph: NeighborGraph): void;
  /** Diff a new neighbour graph into the persistent edge map. New
   *  edges enter growing phase (bornAt=now); missing edges enter
   *  dying phase (dyingAt=now); stable edges are untouched. Does
   *  NOT emit — the actual draw happens in `emitFabric` so that
   *  growth/decay can animate frame-by-frame. */
  setFabric(graph: NeighborGraph, cells: ReadonlyMap<number, Cell>, now: number): void;
  /** Emit the fabric layer for the current frame. Walks the edge
   *  state map, applies growth/decay math, commits the buffer.
   *  Gated internally: returns immediately when nothing is dirty
   *  and no edge is animating. */
  emitFabric(now: number): void;
  /** Live per-edge births, driving the same grow-in engine `setFabric`
   *  uses. `bornAtByKey` gives each edge an absolute sim-second birth
   *  time (the driver spreads these for a ripple stagger — a future
   *  value keeps the tendril hidden until its turn); `dirByKey` roots
   *  each tendril's grow direction. Re-adding a dying edge revives it.
   *  Appends new keys to the render order (emitFabric reaps). */
  growEdges(
    edges: NeighborEdge[],
    cells: ReadonlyMap<number, Cell>,
    bornAtByKey: Map<string, number>,
    dirByKey: Map<string, 1 | -1>,
  ): void;
  /** Live per-edge deaths. `kind` selects the exit: `'death'` retracts
   *  the dead end (from `deadEndByKey`, default `'from'`) with a
   *  purple-red retirement flash; `'gc'` is a quiet full-length fade. `dyingAt` is
   *  the absolute sim-second death time (staggerable). Already-dying
   *  edges are skipped so the clock never resets mid-death. */
  killEdges(
    keys: string[],
    dyingAt: number,
    kind: DeathKind,
    deadEndByKey?: Map<string, 'from' | 'to'>,
  ): void;
  /** ② Reinforce the fabric edge a pulse is traversing (self-organization).
   *  One call per edge-crossing; bumps that edge's usage weight so a
   *  frequently-travelled vein glows and persists. No-op for an unknown edge. */
  reinforce(fromCellId: number, toCellId: number): void;
  /** Keys of edges not currently dying — the periodic prune-only reconcile
   *  diffs these against the authoritative selection. O(live edges), called
   *  every 16th build, never per frame. */
  collectLiveEdgeKeys(): string[];
}

export interface NeuralFabricProps {
  onReady: (handles: NeuralFabricHandles) => void;
  /** Shared camera-distance focus. Optional keeps standalone scenes unchanged. */
  cellDetailViewFocusRef?: { readonly current: number };
  /** Edge-allocation class sizing the passive/warm GPU buffers (see
   * `fabricAllocationEdges`). The owner remounts this component (React key)
   * when the class changes, so one mount always holds one allocation.
   * Default = the smallest class, today's historical 8K field. */
  allocationEdges?: number;
}

/** Exported so sibling layers in the fabric family (the bridge class) can
 * build on `makeFatLineLayer` / `commitLayer` instead of standing up a second
 * line-rendering system. */
export interface FatLineLayer {
  positions: Float32Array;
  colors: Float32Array;
  inspectionFrom?: Float32Array;
  inspectionTo?: Float32Array;
  /** Per-endpoint width FACTOR on the material's own `linewidth`, present only
   *  on a layer built with `taperedWidth`. Two floats a segment, initialised to
   *  1 so an instance nobody writes draws at exactly the uniform width. See
   *  `enableTaperedCapsuleWidthMaterial` for why one class in this scene needs
   *  a stroke that is not one width from end to end. */
  widths?: Float32Array;
  posBuf: THREE.InstancedInterleavedBuffer;
  colBuf: THREE.InstancedInterleavedBuffer;
  inspectionFromBuf?: THREE.InstancedInterleavedBuffer;
  inspectionToBuf?: THREE.InstancedInterleavedBuffer;
  widthBuf?: THREE.InstancedInterleavedBuffer;
  geometry: LineSegmentsGeometry;
  material: LineMaterial;
  mesh: LineSegments2;
  count: number;
  /** GPU-parametric lifecycle mode (P1.7): static per-slot records the vertex
   * stage evaluates from sim time. Present only when the layer was built with
   * lifecycle=true; instanceStart/End + instanceColorStart/End become dead
   * inputs on such a layer. */
  lifecycle?: FabricLifecycleBuffers;
}

interface FabricLifecycleBuffers {
  arrays: FabricLifecycleArrays;
  curveBuf: THREE.InstancedInterleavedBuffer;
  colorBuf: THREE.InstancedInterleavedBuffer;
  scalarBuf: THREE.InstancedInterleavedBuffer;
}

/** One persistent fabric edge. Endpoint positions + control point
 *  are snapshotted at birth so the edge can keep rendering after
 *  its endpoint cell has been GC'd (dying phase). `bornAt` drives
 *  the growth window; `dyingAt` (when non-null) drives decay. The
 *  two phases are mutually exclusive — at any moment an edge is in
 *  growing (`dyingAt === null`, age < GROWTH_MS), stable
 *  (`dyingAt === null`, age >= GROWTH_MS), or dying. */
export interface EdgeState {
  fromCellId: number;
  toCellId: number;
  fromX: number; fromY: number; fromZ: number;
  toX: number; toY: number; toZ: number;
  ctrlX: number; ctrlY: number; ctrlZ: number;
  /** Sim seconds at which this edge entered the growing phase. */
  bornAt: number;
  /** Sim seconds at which this edge entered the dying phase, or
   *  null while alive. */
  dyingAt: number | null;
  /** How this edge dies (set when `dyingAt != null`): `'gc'` is a
   *  quiet full-length alpha fade (reconciliation / capacity eviction);
   *  `'death'` retracts the dead end toward the survivor with a
   *  retirement flash (a real chain cell death). */
  deathKind: DeathKind | null;
  /** For `'death'` only: which endpoint is the cell that died, so the
   *  fibre retracts from that end. `null` for gc / while alive. */
  deadEnd: 'from' | 'to' | null;
  /** Grow-in direction: `1` extends the tip from `from`→`to`, `-1` from
   *  `to`→`from`. Lets the driver root a new tendril at the surviving
   *  cell rather than always at the lower id. */
  growDir: 1 | -1;
  /** Per-edge brightness multiplier in [TWIG_MIN, 1.0] — today [0.34, 1.0],
   *  see `arborBrightness`. Derived from the edge's arbor weight, or from its
   *  deterministic seed where it has none. Stable across the edge's lifetime
   *  so the network has a fixed hierarchy of bright "trunks" and dim
   *  "branches" rather than uniform mesh. */
  brightnessMul: number;
  /** Raw arbor weight (or the no-arbor sentinel), for the WIDTH tier. Frozen
   *  at admission exactly as `brightnessMul` is, so an edge changes class only
   *  when the tier threshold moves — which happens at a rebuild boundary, the
   *  same discontinuity rebuilds already produce. `brightnessMul` cannot serve
   *  here: the measured 12.5% threshold maps to 0.416, below the 0.44 ceiling
   *  of the cross-link band. See `fabricTrunkClass`. */
  trunkness: number;
  /** A route transitions between two contributor colours along its length. */
  fromR: number; fromG: number; fromB: number;
  toR: number; toG: number; toB: number;
  /** ② Self-organization: activity weight in [0, USAGE_CAP]. Pulse
   *  traversals bump it (`reinforce`); while positive it lives in the sparse
   *  warm-route set, decays each frame, and adds brightness over
   *  `brightnessMul`. 0 in the resting state → no overlay → ① unchanged. */
  usage: number;
}

interface RecallApertureState {
  active: ConsensusMemoryAperture | null;
  activeStrength: number;
  departing: ConsensusMemoryAperture | null;
  departingStrength: number;
}

interface InspectionFieldTransition {
  from: CellInspectionField | null;
  to: CellInspectionField | null;
  progress: number;
}

/** One deferred add candidate of a staggered setFabric diff. */
interface PendingFabricAdd {
  key: string;
  edge: NeighborEdge;
}

/** Deferred remainder of ONE oversized setFabric diff (cohort staggering —
 *  see fabricCohorts.ts). At most one pending set ever exists: a newer
 *  authoritative graph flushes it before diffing, so diff semantics always
 *  run against complete edge states. Queued entries cost nothing per frame
 *  until admitted (unlike future-bornAt staggering, which would keep every
 *  key in the animating set from t0). */
interface PendingFabricCohorts {
  /** Cell snapshot from the queuing setFabric call, so a deferred
   *  admission runs the exact insertion maths the immediate path ran
   *  (pos_seed is a pure function of cell id — see memory: never
   *  32-bit-pack or freeze-derive a cell id). */
  cells: ReadonlyMap<number, Cell>;
  adds: PendingFabricAdd[];
  /** Keys still alive in edgeStates whose gc-fade is scheduled later.
   *  Until their slice comes due they stay untouched — alive. */
  kills: string[];
  cohorts: FabricCohortSlice[];
  /** Next unadmitted cohort index (slices before it are already in). */
  next: number;
}

/** Short enough to feel directly attached to selection, long enough that a
 * different Cell's graph-distance hierarchy never pops into existence. */
const INSPECTION_FIELD_TRANSITION_SECONDS = 0.34;

function inspectionFieldEndpointScaleAt(
  field: CellInspectionField | null,
  fromCellId: number,
  toCellId: number,
  edgeT: number,
  lifecycleFlash: number,
): number {
  const fieldScale = cellInspectionEdgeScaleAt(
    field,
    fromCellId,
    toCellId,
    edgeT,
  );
  // A real Cell retirement is an event, not passive context. Let its existing
  // semantic flash reclaim full energy even when it occurs outside inspection.
  return fieldScale + (1 - fieldScale) * lifecycleFlash;
}

function recallApertureScaleAt(
  state: RecallApertureState,
  x: number,
  z: number,
  lifecycleFlash: number,
  nowSec: number,
): number {
  if (state.active === state.departing) {
    return consensusMemoryApertureScale(
      state.active,
      x,
      z,
      Math.max(state.activeStrength, state.departingStrength),
      nowSec,
      lifecycleFlash,
    );
  }
  return Math.min(
    consensusMemoryApertureScale(
      state.active,
      x,
      z,
      state.activeStrength,
      nowSec,
      lifecycleFlash,
    ),
    consensusMemoryApertureScale(
      state.departing,
      x,
      z,
      state.departingStrength,
      nowSec,
      lifecycleFlash,
    ),
  );
}

// TAPER_MIN / taper / TWIG_MIN moved to fabricLuminance so the GLSL
// lifecycle port shares one definition with this CPU reference.
// arborBrightness followed them: the bridge class reads the same non-forest
// band, and a brightness band restated in two files is a band that drifts.

/** Park every remaining segment of a fixed slot: zero colours, endpoints far
 * outside the frustum, neutral inspection weights. Exported for the packed vs
 * slot-layout equivalence tests. */
export function fillFabricSlotRemainder(
  layer: Pick<
    FatLineLayer,
    'positions' | 'colors' | 'inspectionFrom' | 'inspectionTo' | 'count'
  >,
  slotEndSegments: number,
): void {
  while (layer.count < slotEndSegments) {
    const off = layer.count * 6;
    layer.positions[off + 0] = 0;
    layer.positions[off + 1] = FABRIC_SLOT_FILLER_Y;
    layer.positions[off + 2] = 0;
    layer.positions[off + 3] = 0;
    layer.positions[off + 4] = FABRIC_SLOT_FILLER_Y;
    layer.positions[off + 5] = 0;
    layer.colors[off + 0] = 0;
    layer.colors[off + 1] = 0;
    layer.colors[off + 2] = 0;
    layer.colors[off + 3] = 0;
    layer.colors[off + 4] = 0;
    layer.colors[off + 5] = 0;
    if (layer.inspectionFrom && layer.inspectionTo) {
      const inspectionOffset = layer.count * 2;
      layer.inspectionFrom[inspectionOffset] = 1;
      layer.inspectionFrom[inspectionOffset + 1] = 1;
      layer.inspectionTo[inspectionOffset] = 1;
      layer.inspectionTo[inspectionOffset + 1] = 1;
    }
    layer.count += 1;
  }
}

/** Inspection-only variant: touches nothing but the two inspection arrays. */
function fillInspectionSlotRemainder(
  layer: FatLineLayer,
  slotEndSegments: number,
): void {
  const inspectionFrom = layer.inspectionFrom;
  const inspectionTo = layer.inspectionTo;
  if (!inspectionFrom || !inspectionTo) {
    layer.count = slotEndSegments;
    return;
  }
  while (layer.count < slotEndSegments) {
    const inspectionOffset = layer.count * 2;
    inspectionFrom[inspectionOffset] = 1;
    inspectionFrom[inspectionOffset + 1] = 1;
    inspectionTo[inspectionOffset] = 1;
    inspectionTo[inspectionOffset + 1] = 1;
    layer.count += 1;
  }
}

/** Emit one passive-language edge into either the immutable resting fabric or
 * the sparse warm-route overlay. `usage` changes route colour/spatial energy;
 * `brightnessGain` selects the complete baseline (1) or only reinforcement's
 * incremental contribution (>0). Keeping one sampler prevents the overlay
 * from drifting away from lifecycle, aperture, inspection, or taper semantics.
 * Exported (with its EdgeState input) for the slot-equivalence tests. */
export function writeFabricEdgeSegments(
  layer: FatLineLayer,
  st: EdgeState,
  render: EdgeRender,
  sample: Float32Array,
  now: number,
  usage: number,
  brightnessGain: number,
  recallAperture: RecallApertureState,
  inspectionField: InspectionFieldTransition,
  writePositions = true,
): void {
  if (!render.visible || render.alphaMul <= 0 || brightnessGain <= 0) return;

  const hierarchy = Math.max(
    0,
    Math.min(1, (st.brightnessMul - TWIG_MIN) / (1 - TWIG_MIN)),
  );
  const goldMix = consensusRouteGoldMix(hierarchy, usage);
  const gold = CONSENSUS_BRAID_PALETTE.gold;
  const retire = CONSENSUS_BRAID_PALETTE.retire;
  const flash = render.flash;
  const fromSemanticR = (
    st.fromR + (gold[0] - st.fromR) * goldMix
  ) * (1 - flash) + retire[0] * flash;
  const fromSemanticG = (
    st.fromG + (gold[1] - st.fromG) * goldMix
  ) * (1 - flash) + retire[1] * flash;
  const fromSemanticB = (
    st.fromB + (gold[2] - st.fromB) * goldMix
  ) * (1 - flash) + retire[2] * flash;
  const toSemanticR = (
    st.toR + (gold[0] - st.toR) * goldMix
  ) * (1 - flash) + retire[0] * flash;
  const toSemanticG = (
    st.toG + (gold[1] - st.toG) * goldMix
  ) * (1 - flash) + retire[1] * flash;
  const toSemanticB = (
    st.toB + (gold[2] - st.toB) * goldMix
  ) * (1 - flash) + retire[2] * flash;
  const energy = LIVE.cell.fabricAlpha
    * render.alphaMul
    * st.brightnessMul
    * brightnessGain;

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
  const startTaper = taper(tStart);
  const prevSpatial = passiveFabricEnergyScale(
    prevX,
    prevZ,
    hierarchy,
    usage,
    flash,
    LIVE.cell.centerDim,
  );
  const prevAperture = recallApertureScaleAt(
    recallAperture,
    prevX,
    prevZ,
    flash,
    now,
  );
  let prevInspectionFrom = inspectionFieldEndpointScaleAt(
    inspectionField.from,
    st.fromCellId,
    st.toCellId,
    tStart,
    flash,
  );
  let prevInspectionTo = inspectionFieldEndpointScaleAt(
    inspectionField.to,
    st.fromCellId,
    st.toCellId,
    tStart,
    flash,
  );
  const startEnergy = energy
    * startTaper
    * prevSpatial
    * prevAperture;
  let prevR = (
    fromSemanticR + (toSemanticR - fromSemanticR) * tStart
  ) * startEnergy;
  let prevG = (
    fromSemanticG + (toSemanticG - fromSemanticG) * tStart
  ) * startEnergy;
  let prevB = (
    fromSemanticB + (toSemanticB - fromSemanticB) * tStart
  ) * startEnergy;

  for (let index = 1; index <= FABRIC_SAMPLES_PER_EDGE; index += 1) {
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
    const endTaper = taper(t);
    const endSpatial = passiveFabricEnergyScale(
      sample[0],
      sample[2],
      hierarchy,
      usage,
      flash,
      LIVE.cell.centerDim,
    );
    const endAperture = recallApertureScaleAt(
      recallAperture,
      sample[0],
      sample[2],
      flash,
      now,
    );
    const endInspectionFrom = inspectionFieldEndpointScaleAt(
      inspectionField.from,
      st.fromCellId,
      st.toCellId,
      t,
      flash,
    );
    const endInspectionTo = inspectionFieldEndpointScaleAt(
      inspectionField.to,
      st.fromCellId,
      st.toCellId,
      t,
      flash,
    );
    const endEnergy = energy
      * endTaper
      * endSpatial
      * endAperture;
    const endR = (
      fromSemanticR + (toSemanticR - fromSemanticR) * t
    ) * endEnergy;
    const endG = (
      fromSemanticG + (toSemanticG - fromSemanticG) * t
    ) * endEnergy;
    const endB = (
      fromSemanticB + (toSemanticB - fromSemanticB) * t
    ) * endEnergy;
    pushSegmentGradient(
      layer,
      prevX, prevY, prevZ,
      sample[0], sample[1], sample[2],
      prevR, prevG, prevB,
      endR, endG, endB,
      prevInspectionFrom, endInspectionFrom,
      prevInspectionTo, endInspectionTo,
      writePositions,
    );
    prevX = sample[0];
    prevY = sample[1];
    prevZ = sample[2];
    prevR = endR;
    prevG = endG;
    prevB = endB;
    prevInspectionFrom = endInspectionFrom;
    prevInspectionTo = endInspectionTo;
    if (t >= tEnd) break;
  }
}

/** Rewrite only the two inspection snapshots for stable passive geometry.
 * Selection does not change an edge, its Bezier, semantic colour, taper, or
 * aperture, so walking those paths again would be pure duplicate work. */
function writeFabricEdgeInspectionSegments(
  layer: FatLineLayer,
  st: EdgeState,
  render: EdgeRender,
  inspectionField: InspectionFieldTransition,
): void {
  if (!render.visible || render.alphaMul <= 0) return;
  const inspectionFrom = layer.inspectionFrom;
  const inspectionTo = layer.inspectionTo;
  if (!inspectionFrom || !inspectionTo) return;
  const tStart = render.tStart;
  const tEnd = render.tEnd;
  let startFrom = inspectionFieldEndpointScaleAt(
    inspectionField.from,
    st.fromCellId,
    st.toCellId,
    tStart,
    render.flash,
  );
  let startTo = inspectionFieldEndpointScaleAt(
    inspectionField.to,
    st.fromCellId,
    st.toCellId,
    tStart,
    render.flash,
  );
  for (let index = 1; index <= FABRIC_SAMPLES_PER_EDGE; index += 1) {
    if (layer.count >= layer.positions.length / 6) return;
    const rawT = tStart
      + (tEnd - tStart) * (index / FABRIC_SAMPLES_PER_EDGE);
    const t = rawT > tEnd ? tEnd : rawT;
    const endFrom = inspectionFieldEndpointScaleAt(
      inspectionField.from,
      st.fromCellId,
      st.toCellId,
      t,
      render.flash,
    );
    const endTo = inspectionFieldEndpointScaleAt(
      inspectionField.to,
      st.fromCellId,
      st.toCellId,
      t,
      render.flash,
    );
    const offset = layer.count * 2;
    inspectionFrom[offset] = startFrom;
    inspectionFrom[offset + 1] = endFrom;
    inspectionTo[offset] = startTo;
    inspectionTo[offset + 1] = endTo;
    layer.count += 1;
    startFrom = endFrom;
    startTo = endTo;
    if (t >= tEnd) break;
  }
}

/** One fat-line material, patched in the only order the three shader patches
 * tolerate: inspection first (it anchors on stock chunks), then the capsule
 * (it rewrites those chunks), then — at the caller — the lifecycle (it anchors
 * on the capsule's). Split out of `makeFatLineLayer` so a second pass over an
 * EXISTING geometry can be built from the same recipe rather than a copy of
 * it. */
function makeFatLineMaterial(
  widthPx: number,
  accumulation: 'screen' | 'additive',
  useScreenCapsule: boolean,
  inspectionTransition: boolean,
  taperedWidth = false,
): LineMaterial {
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: widthPx,
    transparent: true,
    depthWrite: false,
    blending: accumulation === 'screen'
      ? THREE.CustomBlending
      : THREE.AdditiveBlending,
    worldUnits: false,
    toneMapped: false,
  });
  if (inspectionTransition) {
    enableLineInspectionTransitionMaterial(material);
  }
  if (useScreenCapsule) {
    optimizeScreenSpaceCapsuleMaterial(material);
  }
  if (taperedWidth) {
    // After the capsule patch, whose output this one anchors on: `linewidth`
    // becomes the KNOT width and every instance scales it.
    enableTaperedCapsuleWidthMaterial(material);
  }
  if (accumulation === 'screen') {
    // Passive structure must approach the display ceiling asymptotically when
    // thousands of fibres overlap. Activity keeps ordinary additive blending
    // in its separate layer, so protocol writes retain headroom and urgency.
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneMinusSrcColorFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }
  return material;
}

/** The mesh plus the capsule shader's viewport bridge. */
function makeFatLineMesh(
  geometry: LineSegmentsGeometry,
  material: LineMaterial,
  useScreenCapsule: boolean,
): LineSegments2 {
  const mesh = new LineSegments2(geometry, material);
  if (useScreenCapsule) {
    const viewport = new THREE.Vector4();
    const updateLineResolution = mesh.onBeforeRender.bind(mesh);
    mesh.onBeforeRender = (renderer) => {
      updateLineResolution(renderer);
      renderer.getViewport(viewport);
      syncScreenSpaceCapsuleViewport(
        material,
        renderer.getPixelRatio(),
        viewport.x,
        viewport.y,
      );
    };
  }
  return mesh;
}

/** Exported for the lifecycle-layer construction tests. */
export function makeFatLineLayer(
  maxSegments: number,
  widthPx: number,
  accumulation: 'screen' | 'additive',
  optimizePassiveGeometry = false,
  inspectionTransition = false,
  lifecycle = false,
  taperedWidth = false,
): FatLineLayer {
  const positions = new Float32Array(maxSegments * 6);
  const colors = new Float32Array(maxSegments * 6);
  const inspectionFrom = inspectionTransition
    ? new Float32Array(maxSegments * 2).fill(1)
    : undefined;
  const inspectionTo = inspectionTransition
    ? new Float32Array(maxSegments * 2).fill(1)
    : undefined;
  // 1, not 0: an instance the emit never reaches draws the material's own
  // width rather than vanishing, which is the same failure discipline the
  // inspection lanes use.
  const widths = taperedWidth
    ? new Float32Array(maxSegments * 2).fill(1)
    : undefined;
  const posBuf = new THREE.InstancedInterleavedBuffer(positions, 6, 1);
  const colBuf = new THREE.InstancedInterleavedBuffer(colors, 6, 1);
  const inspectionFromBuf = inspectionFrom
    ? new THREE.InstancedInterleavedBuffer(inspectionFrom, 2, 1)
    : undefined;
  const inspectionToBuf = inspectionTo
    ? new THREE.InstancedInterleavedBuffer(inspectionTo, 2, 1)
    : undefined;
  const widthBuf = widths
    ? new THREE.InstancedInterleavedBuffer(widths, 2, 1)
    : undefined;
  posBuf.setUsage(THREE.DynamicDrawUsage);
  colBuf.setUsage(THREE.DynamicDrawUsage);
  inspectionFromBuf?.setUsage(THREE.DynamicDrawUsage);
  inspectionToBuf?.setUsage(THREE.DynamicDrawUsage);
  widthBuf?.setUsage(THREE.DynamicDrawUsage);
  const useScreenCapsule = accumulation === 'screen'
    && optimizePassiveGeometry;
  if (taperedWidth && !useScreenCapsule) {
    throw new Error('per-instance width requires the screen-capsule layer');
  }
  const geometry = useScreenCapsule
    ? makeScreenSpaceCapsuleGeometry()
    : new LineSegmentsGeometry();
  geometry.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(posBuf, 3, 0));
  geometry.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(posBuf, 3, 3));
  geometry.setAttribute('instanceColorStart', new THREE.InterleavedBufferAttribute(colBuf, 3, 0));
  geometry.setAttribute('instanceColorEnd', new THREE.InterleavedBufferAttribute(colBuf, 3, 3));
  if (inspectionFromBuf && inspectionToBuf) {
    geometry.setAttribute(
      'instanceInspectionFromStart',
      new THREE.InterleavedBufferAttribute(inspectionFromBuf, 1, 0),
    );
    geometry.setAttribute(
      'instanceInspectionFromEnd',
      new THREE.InterleavedBufferAttribute(inspectionFromBuf, 1, 1),
    );
    geometry.setAttribute(
      'instanceInspectionToStart',
      new THREE.InterleavedBufferAttribute(inspectionToBuf, 1, 0),
    );
    geometry.setAttribute(
      'instanceInspectionToEnd',
      new THREE.InterleavedBufferAttribute(inspectionToBuf, 1, 1),
    );
  }
  if (widthBuf) {
    geometry.setAttribute(
      'instanceWidthStart',
      new THREE.InterleavedBufferAttribute(widthBuf, 1, 0),
    );
    geometry.setAttribute(
      'instanceWidthEnd',
      new THREE.InterleavedBufferAttribute(widthBuf, 1, 1),
    );
  }
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
  geometry.instanceCount = 0;
  const material = makeFatLineMaterial(
    widthPx,
    accumulation,
    useScreenCapsule,
    inspectionTransition,
    taperedWidth,
  );
  let lifecycleBuffers: FabricLifecycleBuffers | undefined;
  if (lifecycle) {
    if (!useScreenCapsule) {
      throw new Error('fabric lifecycle mode requires the screen-capsule layer');
    }
    const arrays = makeFabricLifecycleArrays(maxSegments);
    const curveBuf = new THREE.InstancedInterleavedBuffer(
      arrays.curve, FABRIC_LIFE_CURVE_STRIDE, 1,
    );
    const colorBuf = new THREE.InstancedInterleavedBuffer(
      arrays.color, FABRIC_LIFE_COLOR_STRIDE, 1,
    );
    const scalarBuf = new THREE.InstancedInterleavedBuffer(
      arrays.scalar, FABRIC_LIFE_SCALAR_STRIDE, 1,
    );
    curveBuf.setUsage(THREE.DynamicDrawUsage);
    colorBuf.setUsage(THREE.DynamicDrawUsage);
    scalarBuf.setUsage(THREE.DynamicDrawUsage);
    // Six vec4 attributes — locations are a hard GPU budget; the segment
    // span rides the curve endpoints' .w and the recall-aperture scale
    // rides the endpoint colors' .w.
    geometry.setAttribute('fabricCurveFrom', new THREE.InterleavedBufferAttribute(curveBuf, 4, 0));
    geometry.setAttribute('fabricCurveCtrl', new THREE.InterleavedBufferAttribute(curveBuf, 4, 4));
    geometry.setAttribute('fabricCurveTo', new THREE.InterleavedBufferAttribute(curveBuf, 4, 8));
    geometry.setAttribute('fabricColorFrom', new THREE.InterleavedBufferAttribute(colorBuf, 4, 0));
    geometry.setAttribute('fabricColorTo', new THREE.InterleavedBufferAttribute(colorBuf, 4, 4));
    geometry.setAttribute('fabricLifecycle', new THREE.InterleavedBufferAttribute(scalarBuf, 4, 0));
    enableFabricLifecycleMaterial(material);
    lifecycleBuffers = { arrays, curveBuf, colorBuf, scalarBuf };
  }
  const mesh = makeFatLineMesh(geometry, material, useScreenCapsule);
  return {
    positions,
    colors,
    inspectionFrom,
    inspectionTo,
    widths,
    posBuf,
    colBuf,
    inspectionFromBuf,
    inspectionToBuf,
    widthBuf,
    geometry,
    material,
    mesh,
    count: 0,
    lifecycle: lifecycleBuffers,
  };
}

/** The wide half of the passive fabric's width partition — 中央神经. Owns no
 * buffers: the geometry, and everything in it, belongs to the layer it rides. */
export interface FabricTrunkPass {
  material: LineMaterial;
  mesh: LineSegments2;
}

/**
 * Build the wide pass over an EXISTING lifecycle layer.
 *
 * A second material and mesh over the passive layer's OWN geometry. Nothing is
 * copied: the two passes read the same interleaved buffers, the same lifecycle
 * records, the same inspection snapshots and the same recall-aperture lanes,
 * and differ only in `linewidth` and their `fabricTrunkPass` uniform. That is
 * the point — parity with the mesh pass is structural rather than maintained,
 * and the subset needs no bake, no slot space and no allocation of its own.
 *
 * The price is one extra draw call and one extra vertex pass over the
 * populated prefix, where the non-matching half exits on one lane fetch and
 * one compare (the gate is the first statement of `computeFabricLifecycle`)
 * and contributes no fragments. Total rasterized fragments are unchanged apart
 * from the promoted edges' own extra width, which is the figure.
 */
export function makeFabricTrunkPass(
  source: FatLineLayer,
  widthPx: number,
): FabricTrunkPass {
  if (!source.lifecycle) {
    throw new Error('the trunk pass requires a GPU-parametric lifecycle layer');
  }
  const material = makeFatLineMaterial(widthPx, 'screen', true, true);
  enableFabricLifecycleMaterial(material, FABRIC_TRUNK_PASS_TRUNK);
  const mesh = makeFatLineMesh(source.geometry, material, true);
  // The twin shares its geometry, so LineSegments2's real raycast would
  // report every edge a SECOND time — including the ones this pass does not
  // draw, since hiding happens in the vertex stage. Render-only, structurally.
  mesh.raycast = neverRaycast;
  return { material, mesh };
}

function pushSegment(
  layer: FatLineLayer,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number, g: number, b: number,
): void {
  if (layer.count >= layer.positions.length / 6) return;
  const off = layer.count * 6;
  layer.positions[off + 0] = ax;
  layer.positions[off + 1] = ay;
  layer.positions[off + 2] = az;
  layer.positions[off + 3] = bx;
  layer.positions[off + 4] = by;
  layer.positions[off + 5] = bz;
  layer.colors[off + 0] = r;
  layer.colors[off + 1] = g;
  layer.colors[off + 2] = b;
  layer.colors[off + 3] = r;
  layer.colors[off + 4] = g;
  layer.colors[off + 5] = b;
  layer.count += 1;
}

/** Like `pushSegment` but writes distinct colours at the two endpoints
 *  so the line shader interpolates a gradient along the segment. Used
 *  by the fabric layer to draw route taper: each sub-segment fades
 *  from its `start` colour at t_start to its `end` colour at t_end,
 *  and the colours come from a `taper` profile that's bright near the
 *  cell endpoints and dim at the shaft midpoint. */
function pushSegmentGradient(
  layer: FatLineLayer,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  rA: number, gA: number, bA: number,
  rB: number, gB: number, bB: number,
  inspectionFromA: number, inspectionFromB: number,
  inspectionToA: number, inspectionToB: number,
  writePositions: boolean,
): void {
  if (layer.count >= layer.positions.length / 6) return;
  const off = layer.count * 6;
  if (writePositions) {
    layer.positions[off + 0] = ax;
    layer.positions[off + 1] = ay;
    layer.positions[off + 2] = az;
    layer.positions[off + 3] = bx;
    layer.positions[off + 4] = by;
    layer.positions[off + 5] = bz;
  }
  layer.colors[off + 0] = rA;
  layer.colors[off + 1] = gA;
  layer.colors[off + 2] = bA;
  layer.colors[off + 3] = rB;
  layer.colors[off + 4] = gB;
  layer.colors[off + 5] = bB;
  const inspectionOffset = layer.count * 2;
  if (layer.inspectionFrom && layer.inspectionTo) {
    layer.inspectionFrom[inspectionOffset] = inspectionFromA;
    layer.inspectionFrom[inspectionOffset + 1] = inspectionFromB;
    layer.inspectionTo[inspectionOffset] = inspectionToA;
    layer.inspectionTo[inspectionOffset + 1] = inspectionToB;
  }
  layer.count += 1;
}

export function commitLayer(
  layer: FatLineLayer,
  updatePositions = true,
  updateColors = true,
  updateInspections = true,
): void {
  const usedFloats = layer.count * 6;
  layer.posBuf.clearUpdateRanges();
  layer.colBuf.clearUpdateRanges();
  layer.inspectionFromBuf?.clearUpdateRanges();
  layer.inspectionToBuf?.clearUpdateRanges();
  layer.widthBuf?.clearUpdateRanges();
  if (usedFloats > 0) {
    // Three uploads the complete backing array when no range is supplied.
    // Upload only each layer's populated prefix. The passive layer reserves
    // three edge generations, so the old full-range path moved 4.39 MiB per
    // dirty frame even when only one generation was drawn.
    if (updatePositions) {
      layer.posBuf.addUpdateRange(0, usedFloats);
      layer.posBuf.needsUpdate = true;
    }
    if (updateColors) {
      layer.colBuf.addUpdateRange(0, usedFloats);
      layer.colBuf.needsUpdate = true;
    }
    const usedInspectionFloats = layer.count * 2;
    if (
      updateInspections
      && layer.inspectionFromBuf
      && layer.inspectionToBuf
    ) {
      layer.inspectionFromBuf.addUpdateRange(0, usedInspectionFloats);
      layer.inspectionFromBuf.needsUpdate = true;
      layer.inspectionToBuf.addUpdateRange(0, usedInspectionFloats);
      layer.inspectionToBuf.needsUpdate = true;
    }
    // The width lane rides the POSITION gate, not the inspection one: a
    // tapered stroke's width is a function of where it is along its own curve,
    // so the two are dirty together and never separately.
    if (updatePositions && layer.widthBuf) {
      layer.widthBuf.addUpdateRange(0, usedInspectionFloats);
      layer.widthBuf.needsUpdate = true;
    }
  }
  layer.geometry.instanceCount = layer.count;
}

/** Upload only the given SEGMENT ranges (positions + colours + inspection).
 * The incremental animating-edge path rewrites fixed slots in place, so the
 * populated prefix and instanceCount are unchanged. */
function commitFabricSlotRanges(
  layer: FatLineLayer,
  ranges: readonly FabricSlotRange[],
): void {
  if (ranges.length === 0) return;
  layer.posBuf.clearUpdateRanges();
  layer.colBuf.clearUpdateRanges();
  layer.inspectionFromBuf?.clearUpdateRanges();
  layer.inspectionToBuf?.clearUpdateRanges();
  let rangeSegments = 0;
  for (const range of ranges) {
    rangeSegments += range.count;
    layer.posBuf.addUpdateRange(range.start * 6, range.count * 6);
    layer.colBuf.addUpdateRange(range.start * 6, range.count * 6);
    layer.inspectionFromBuf?.addUpdateRange(range.start * 2, range.count * 2);
    layer.inspectionToBuf?.addUpdateRange(range.start * 2, range.count * 2);
  }
  layer.posBuf.needsUpdate = true;
  layer.colBuf.needsUpdate = true;
  if (layer.inspectionFromBuf) layer.inspectionFromBuf.needsUpdate = true;
  if (layer.inspectionToBuf) layer.inspectionToBuf.needsUpdate = true;
  layer.geometry.instanceCount = layer.count;
  // This path serves only the passive fabric layer; its upload volume is
  // the number the range-governance and cohort staggering exist to bound.
  fabricStats.observeUpload(fabricUploadBytes(rangeSegments, {
    positions: true,
    colors: true,
    inspection: (layer.inspectionFromBuf ? 1 : 0)
      + (layer.inspectionToBuf ? 1 : 0),
  }));
}

/** Static-record bytes per segment across the four lifecycle buffers. */
const FABRIC_LIFECYCLE_BYTES_PER_SEGMENT = 4 * (
  FABRIC_LIFE_CURVE_STRIDE
  + FABRIC_LIFE_COLOR_STRIDE
  + FABRIC_LIFE_SCALAR_STRIDE
);

/** Upload only the given SLOT ranges of the static lifecycle records (curve,
 * colors, scalars — aperture has its own recall-window writer). Event-driven:
 * runs when an admit/kill/revival wrote slots, never per animated frame. */
function commitFabricLifecycleSlotRanges(
  layer: FatLineLayer,
  ranges: readonly FabricSlotRange[],
): void {
  const lifecycle = layer.lifecycle;
  if (!lifecycle || ranges.length === 0) return;
  lifecycle.curveBuf.clearUpdateRanges();
  lifecycle.colorBuf.clearUpdateRanges();
  lifecycle.scalarBuf.clearUpdateRanges();
  let rangeSegments = 0;
  // mergeFabricSlotRanges already returns SEGMENT-unit ranges.
  for (const range of ranges) {
    rangeSegments += range.count;
    lifecycle.curveBuf.addUpdateRange(
      range.start * FABRIC_LIFE_CURVE_STRIDE,
      range.count * FABRIC_LIFE_CURVE_STRIDE,
    );
    lifecycle.colorBuf.addUpdateRange(
      range.start * FABRIC_LIFE_COLOR_STRIDE,
      range.count * FABRIC_LIFE_COLOR_STRIDE,
    );
    lifecycle.scalarBuf.addUpdateRange(
      range.start * FABRIC_LIFE_SCALAR_STRIDE,
      range.count * FABRIC_LIFE_SCALAR_STRIDE,
    );
  }
  lifecycle.curveBuf.needsUpdate = true;
  lifecycle.colorBuf.needsUpdate = true;
  lifecycle.scalarBuf.needsUpdate = true;
  // Admits bake inspection snapshots into recycled slots alongside the
  // static record, so those two buffers ride the same event ranges.
  if (layer.inspectionFromBuf && layer.inspectionToBuf) {
    layer.inspectionFromBuf.clearUpdateRanges();
    layer.inspectionToBuf.clearUpdateRanges();
    for (const range of ranges) {
      layer.inspectionFromBuf.addUpdateRange(range.start * 2, range.count * 2);
      layer.inspectionToBuf.addUpdateRange(range.start * 2, range.count * 2);
    }
    layer.inspectionFromBuf.needsUpdate = true;
    layer.inspectionToBuf.needsUpdate = true;
  }
  layer.geometry.instanceCount = layer.count;
  fabricStats.observeUpload(
    rangeSegments * (FABRIC_LIFECYCLE_BYTES_PER_SEGMENT + 16),
  );
}

/** Full-population upload of the static records + inspection snapshots after
 * a compacting walk (boot / slot-space overflow / rare global repaint). */
function commitFabricLifecycleFull(layer: FatLineLayer): void {
  const lifecycle = layer.lifecycle;
  if (!lifecycle) return;
  const segments = layer.count;
  lifecycle.curveBuf.clearUpdateRanges();
  lifecycle.colorBuf.clearUpdateRanges();
  lifecycle.scalarBuf.clearUpdateRanges();
  layer.inspectionFromBuf?.clearUpdateRanges();
  layer.inspectionToBuf?.clearUpdateRanges();
  if (segments > 0) {
    lifecycle.curveBuf.addUpdateRange(0, segments * FABRIC_LIFE_CURVE_STRIDE);
    lifecycle.colorBuf.addUpdateRange(0, segments * FABRIC_LIFE_COLOR_STRIDE);
    lifecycle.scalarBuf.addUpdateRange(0, segments * FABRIC_LIFE_SCALAR_STRIDE);
    lifecycle.curveBuf.needsUpdate = true;
    lifecycle.colorBuf.needsUpdate = true;
    lifecycle.scalarBuf.needsUpdate = true;
    if (layer.inspectionFromBuf && layer.inspectionToBuf) {
      layer.inspectionFromBuf.addUpdateRange(0, segments * 2);
      layer.inspectionFromBuf.needsUpdate = true;
      layer.inspectionToBuf.addUpdateRange(0, segments * 2);
      layer.inspectionToBuf.needsUpdate = true;
    }
  }
  layer.geometry.instanceCount = segments;
  fabricStats.observeUpload(
    segments * (FABRIC_LIFECYCLE_BYTES_PER_SEGMENT + 16),
  );
}

/** Aperture-window upload: recall dims live in the color records' .w lanes,
 * so a recall frame re-uploads the populated color prefix (8 floats per
 * segment — bounded to the interaction window). */
function commitFabricApertureLanes(layer: FatLineLayer): void {
  const lifecycle = layer.lifecycle;
  if (!lifecycle) return;
  lifecycle.colorBuf.clearUpdateRanges();
  if (layer.count > 0) {
    lifecycle.colorBuf.addUpdateRange(0, layer.count * FABRIC_LIFE_COLOR_STRIDE);
    lifecycle.colorBuf.needsUpdate = true;
  }
  fabricStats.observeUpload(layer.count * 4 * FABRIC_LIFE_COLOR_STRIDE);
}

/** A settled lifecycle for static-span inspection/aperture baking: the shader
 * owns the real interval, alpha, and flash. */
const SETTLED_EDGE_RENDER: EdgeRender = {
  visible: true, alphaMul: 1, tStart: 0, tEnd: 1, flash: 0,
  reap: false, animating: false,
};

export default function NeuralFabric({
  onReady,
  cellDetailViewFocusRef,
  allocationEdges = FABRIC_ALLOCATION_EDGE_CLASSES[0],
}: NeuralFabricProps) {
  // Tier-pipeline gauge: which allocation class is actually mounted.
  fabricStats.allocationEdges = allocationEdges;
  const simClock = useSimClock();
  const { size } = useThree();
  const { effective: quality } = useQualityRuntime();
  const { activeSamplesPerHop } = QUALITY_PRESETS[quality];

  const fabric = useMemo(
    () => makeFatLineLayer(
      fabricSegmentAllocation(allocationEdges),
      LIVE.cell.fabricWidth,
      'screen',
      true,
      true,
      true, // GPU-parametric lifecycle: static slots, sim-time evaluation
    ),
    [allocationEdges],
  );
  // 中央神经 — the wide rung, over the passive layer's own geometry. Not a
  // sixth allocation: `makeFabricTrunkPass` binds a second material and mesh
  // to `fabric`'s buffers, so the subset costs one draw call and zero bytes.
  const trunk = useMemo(
    () => makeFabricTrunkPass(
      fabric,
      fabricTrunkLineWidth(LIVE.cell.fabricWidth, 1),
    ),
    [fabric],
  );
  // The reinforcement overlay stays at the MESH rung on purpose: it carries
  // observed traffic, not hierarchy, and the two are separate readings. On a
  // promoted edge it draws as a warm core inside the wider resting stroke —
  // traffic ON a trunk — which is the right picture and costs no third
  // material.
  const warmRoutes = useMemo(
    () => makeFatLineLayer(
      warmSegmentAllocation(allocationEdges),
      LIVE.cell.fabricWidth,
      'screen',
      false,
      true,
    ),
    [allocationEdges],
  );
  const active = useMemo(
    () => makeFatLineLayer(MAX_ACTIVE_SEGMENTS, LIVE.cell.activeWidth, 'additive'),
    [],
  );
  const memory = useMemo(
    () => makeFatLineLayer(MAX_MEMORY_SEGMENTS, LIVE.cell.activeWidth, 'additive'),
    [],
  );
  const routeHopPulse = useMemo(
    () => makeFatLineLayer(
      MAX_ROUTE_HOP_PULSE_SEGMENTS,
      LIVE.cell.activeWidth * ROUTE_HOP_PULSE_WIDTH_SCALE,
      'additive',
    ),
    [],
  );

  // (focus, width) value gate: the raw-frame reassertion below runs every
  // frame, but its outputs are pure functions of these two numbers, which
  // settle whenever the camera is idle and the width knob is untouched.
  const lastViewWeightRef = useRef({ focus: Number.NaN, width: Number.NaN });
  const applyPassiveViewWeight = useCallback(() => {
    const focus = cellDetailViewFocusRef?.current ?? 0;
    const width = LIVE.cell.fabricWidth;
    const last = lastViewWeightRef.current;
    if (last.focus === focus && last.width === width) return;
    last.focus = focus;
    last.width = width;
    const energyGain = cellDetailFabricEnergyGain(focus);
    const widthScale = cellDetailFabricWidthScale(focus);
    fabric.material.color.setRGB(energyGain, energyGain, energyGain);
    warmRoutes.material.color.setRGB(energyGain, energyGain, energyGain);
    trunk.material.color.setRGB(energyGain, energyGain, energyGain);
    fabric.material.linewidth = width * widthScale;
    warmRoutes.material.linewidth = width * widthScale;
    // Same camera curve, same energy gain — the wide rung differs from the
    // mesh rung in width alone, and stops widening where it would reach the
    // pulse (3.4 px, which takes no focus scale at all).
    trunk.material.linewidth = fabricTrunkLineWidth(width, widthScale);
  }, [
    cellDetailViewFocusRef,
    fabric.material,
    warmRoutes.material,
    trunk.material,
  ]);

  // Camera navigation is input, not simulation. Keep the passive Cell fabric's
  // close-view weight responsive even when the chain animation clock is paused.
  useFrame(applyPassiveViewWeight);

  // Persistent across handle re-creations so Canvas remounts and quality-view
  // reconciliation never drop an edge's growth/decay lifecycle state.
  const edgeStatesRef = useRef<Map<string, EdgeState>>(new Map());
  /** Only edges with positive usage live here. Reinforcement updates this
   * sparse set without dirtying the complete passive-fabric prefix. */
  const warmRouteKeysRef = useRef<Set<string>>(new Set());
  /** True when there's pending work to emit: either the edge map
   *  was just mutated by `setFabric`, or at least one edge is in
   *  growth/decay and its appearance changes per frame. Flipped
   *  off after a final emit settles everything into stable state. */
  const emitDirtyRef = useRef<boolean>(false);
  /** A field selection changes only the two static inspection snapshots. */
  const inspectionOnlyDirtyRef = useRef(false);
  /** STRUCTURAL changes (graph diff / per-edge grow-kill / reap compaction):
   * slot assignment and sampled endpoints are invalid → full rebuild. */
  const passivePositionsDirtyRef = useRef<boolean>(true);
  /** GLOBAL colour inputs changed (recall aperture / live tweaks): every
   * edge's colours need one full recompute, but slots stay in place. */
  const globalRepaintRef = useRef(false);
  const renderOrderRef = useRef<string[]>([]);
  /** Fixed-slot bookkeeping. Slots are PERSISTENT: a surviving edge keeps its
   * slot across graph diffs, fully-decayed edges free their slot in place
   * (parked as invisible fillers) for reuse by later births, and only a full
   * walk (boot, global repaint, capacity overflow) compacts the layout. The
   * animating set (grow / gc-fade / death-retract / future-staggered) drives
   * the incremental per-slot path in between. */
  const slotByKeyRef = useRef<Map<string, number>>(new Map());
  const usedSlotCountRef = useRef(0);
  /** Recycled slot indices from in-place reaps. Cleared by every full walk. */
  const freeSlotsRef = useRef<number[]>([]);
  /** renderOrder keys whose state has been reaped in place. Filtered lazily —
   * both renderOrder consumers skip missing states, so tombstones only cost
   * iteration time. */
  const renderOrderTombstonesRef = useRef(0);
  /** Deferred remainder of one oversized setFabric diff. The emitFabric
   * pump admits due cohorts; a newer setFabric flushes the rest first.
   * Persistent across handle re-creations, like the edge states. */
  const pendingCohortsRef = useRef<PendingFabricCohorts | null>(null);
  // Snapshot of the last-applied Cell-mesh tweak values, seeded from the
  // schema defaults so a closed/untouched panel matches on the first
  // frame and forces NO spurious redraw (zero-drift). The change-detector
  // at the top of `emitFabric` compares LIVE.cell.* against this every
  // frame and, on any change, forces exactly one dirty redraw so a knob
  // dragged in steady state (fabric not animating) still applies.
  const lastCellTweakRef = useRef({
    alpha: LIVE.cell.fabricAlpha, r: LIVE.cell.activeColorR, g: LIVE.cell.activeColorG,
    b: LIVE.cell.activeColorB, fw: LIVE.cell.fabricWidth, aw: LIVE.cell.activeWidth,
    cd: LIVE.cell.centerDim,
  });
  // Sim-seconds of the previous emitFabric, used by sparse warm-route decay and
  // lifecycle transitions. Advanced even when the passive base is clean.
  const prevEmitSecRef = useRef<number | null>(null);
  const recallApertureRef = useRef<RecallApertureState>({
    active: null,
    activeStrength: 0,
    departing: null,
    departingStrength: 0,
  });
  const apertureAnimationRef = useRef(false);
  const inspectionFieldRef = useRef<InspectionFieldTransition>({
    from: null,
    to: null,
    progress: 1,
  });

  useEffect(() => {
    fabric.material.resolution.set(size.width, size.height);
    trunk.material.resolution.set(size.width, size.height);
    warmRoutes.material.resolution.set(size.width, size.height);
    active.material.resolution.set(size.width, size.height);
    memory.material.resolution.set(size.width, size.height);
    routeHopPulse.material.resolution.set(size.width, size.height);
  }, [
    size,
    fabric.material,
    trunk.material,
    warmRoutes.material,
    active.material,
    memory.material,
    routeHopPulse.material,
  ]);

  useEffect(() => () => {
    fabric.geometry.dispose();
    fabric.material.dispose();
    // Geometry belongs to `fabric` and is disposed exactly once, above.
    trunk.material.dispose();
    warmRoutes.geometry.dispose();
    warmRoutes.material.dispose();
    active.geometry.dispose();
    active.material.dispose();
    memory.geometry.dispose();
    memory.material.dispose();
    routeHopPulse.geometry.dispose();
    routeHopPulse.material.dispose();
  }, [fabric, trunk, warmRoutes, active, memory, routeHopPulse]);

  useEffect(() => {
    // Reused 3-element scratch buffers — the hot-loop fabric/active
    // sample paths previously allocated a fresh tuple per Bezier
    // evaluation (~75k per rebuild at the full mesh's ~18k edges × 4
    // samples, plus ~400 per frame from active hop sampling).
    const ctrl = new Float32Array(3);
    const sample = new Float32Array(3);

    const fabricSlotCapacity = Math.floor(
      fabric.positions.length / 6 / FABRIC_SLOT_SEGMENTS,
    );

    // ——— GPU-parametric lifecycle plumbing (P1.7) ———
    const lifecycleArrays = fabric.lifecycle!.arrays;
    /** Slots whose static record changed since the last emit → ranged upload. */
    const lifeDirtySlots: number[] = [];
    /** Rewrite one edge's static record into its slot and mark it dirty.
     * Fabric-layer usage is deliberately 0 — reinforcement lives on the warm
     * overlay; the shader's gold/reclaim terms match the old CPU walk which
     * always passed usage=0 here. */
    const writeLifecycleSlot = (key: string, st: EdgeState): void => {
      const slot = slotByKeyRef.current.get(key);
      if (slot === undefined) return;
      writeFabricLifecycleSlot(lifecycleArrays, slot * FABRIC_SLOT_SEGMENTS, {
        fromX: st.fromX, fromY: st.fromY, fromZ: st.fromZ,
        ctrlX: st.ctrlX, ctrlY: st.ctrlY, ctrlZ: st.ctrlZ,
        toX: st.toX, toY: st.toY, toZ: st.toZ,
        fromR: st.fromR, fromG: st.fromG, fromB: st.fromB,
        toR: st.toR, toG: st.toG, toB: st.toB,
        bornAt: st.bornAt,
        dyingAt: st.dyingAt,
        deathKind: st.deathKind,
        deadEnd: st.deadEnd,
        growDir: st.growDir,
        brightnessMul: st.brightnessMul,
        trunkness: st.trunkness,
      });
      // Inspection snapshots bake at the STATIC span (flash = 0; the shader
      // owns interval and lift) — a recycled slot may hold stale values.
      fabric.count = slot * FABRIC_SLOT_SEGMENTS;
      writeFabricEdgeInspectionSegments(
        fabric,
        st,
        SETTLED_EDGE_RENDER,
        inspectionFieldRef.current,
      );
      fillInspectionSlotRemainder(fabric, (slot + 1) * FABRIC_SLOT_SEGMENTS);
      lifeDirtySlots.push(slot);
    };
    /** Two FIFO expiry queues (fixed windows per kind ⇒ each queue stays
     * time-ordered as kills arrive monotonically). Drained lazily each emit —
     * and on wall time while the tab is hidden, where there is no emit;
     * entries are re-validated against the CURRENT state so a revival between
     * queueing and expiry is never reaped. */
    const reapQueues: Record<DeathKind, FabricReapQueue> = {
      death: { entries: [], head: 0 },
      gc: { entries: [], head: 0 },
    };
    const queueReap = (key: string, st: EdgeState): void => {
      const endSec = fabricLifecycleEndSec(st.dyingAt, st.deathKind);
      if (!Number.isFinite(endSec) || st.deathKind === null) return;
      reapQueues[st.deathKind].entries.push({ key, endSec });
    };
    /** Everything one reap removes an edge from. The containers are refs
     * created once per component and never reassigned, so capturing them
     * here stays valid for the life of this handle set. */
    const reapTargets: FabricReapTargets<EdgeState> = {
      states: edgeStatesRef.current,
      slots: slotByKeyRef.current,
      freeSlots: freeSlotsRef.current,
      warmKeys: warmRouteKeysRef.current,
      onReap: () => {
        renderOrderTombstonesRef.current += 1;
        fabricStats.observeReapInPlace();
      },
    };

    // ——— Reaping without a frame behind it ———
    // Ingest is effect-fed and keeps running while the tab is hidden, but
    // every reap below rides the frame loop, and a hidden tab has neither
    // frames nor a moving sim clock. These three pieces bound that stretch:
    // a hard ceiling on retained states, a wall-clock drain the reaper's
    // interval fires, and a bounded per-frame catch-up on return. All of
    // them are inert while the tab is visible — the frame loop keeps the map
    // orders of magnitude under the ceiling and `catchUpUntilSec` stays null.
    const edgeStateCeiling = fabricEdgeStateCeiling(fabricSlotCapacity);
    /** Sim-second the foreground catch-up is still draining toward, or null
     *  when there is no backlog (always null if the tab never hid). */
    let catchUpUntilSec: number | null = null;
    /** One reap pass at an explicit sim-second. `frameless` marks the passes
     *  that run with no frame behind them: the slot records they leave
     *  pending can never upload (emitFabric is frame-driven), so dropping
     *  them silently would leave the GPU holding a reaped edge's record —
     *  they collapse into the compacting full walk the first visible frame
     *  runs instead. */
    const reapFabricBacklog = (now: number, frameless: boolean): void => {
      drainFabricReapQueue(reapQueues.death, reapTargets, now);
      drainFabricReapQueue(reapQueues.gc, reapTargets, now);
      evictDeadFabricEdges(reapTargets, now, edgeStateCeiling);
      if (renderOrderTombstonesRef.current > 0) {
        const reapStates = edgeStatesRef.current;
        renderOrderRef.current = renderOrderRef.current.filter(
          (key) => reapStates.has(key),
        );
        renderOrderTombstonesRef.current = 0;
      }
      if (frameless && lifeDirtySlots.length > 0) {
        lifeDirtySlots.length = 0;
        passivePositionsDirtyRef.current = true;
        emitDirtyRef.current = true;
      }
    };
    const hiddenReaper = startHiddenFabricReaper({
      wallNowMs: () => performance.now(),
      simNowSec: () => simClock.elapsedSec,
      reap: (bridgedSimSec) => reapFabricBacklog(bridgedSimSec, true),
      resume: (bridgedSimSec) => { catchUpUntilSec = bridgedSimSec; },
    });
    /** Hard ceiling on retained lifecycle states, checked from every ingest
     *  handle: with the frame loop suspended the lazy reap cannot be the only
     *  bound. Past the ceiling the oldest FULLY-DEAD states go immediately —
     *  no animation debt while nobody is watching — and a living edge is
     *  never evicted. Steady state pays one integer compare. */
    const enforceEdgeStateCeiling = (): void => {
      if (edgeStatesRef.current.size <= edgeStateCeiling) return;
      const framelessNow = hiddenReaper.framelessSimNow();
      reapFabricBacklog(
        framelessNow ?? simClock.elapsedSec,
        framelessNow !== null,
      );
    };
    /** Persistent slot allocation: recycle a hole from an in-place reap, else
     * grow the high-water mark. Newly claimed regions hold invisible content
     * (fillers, or zero colours on a fresh buffer) until the next emit writes
     * them — instanceCount only advances inside that same emit. Returns
     * undefined at capacity; callers fall back to a compacting full walk. */
    const allocateFabricSlot = (key: string): number | undefined => {
      const free = freeSlotsRef.current;
      let slot: number | undefined;
      if (free.length > 0) {
        slot = free.pop();
      } else if (usedSlotCountRef.current < fabricSlotCapacity) {
        slot = usedSlotCountRef.current;
        usedSlotCountRef.current += 1;
      }
      if (slot !== undefined) slotByKeyRef.current.set(key, slot);
      return slot;
    };

    /** Resolve and publish the width tier for a completed passive selection.
     * O(arbor edges) plus one typed-array sort, on the rebuild path only —
     * never per frame; the shader re-reads the uniform, it does not re-run
     * the selection. Both materials take the SAME threshold: that identity is
     * the partition, and with it each edge's summed light across the two
     * passes is exactly 1.0× of what it draws today. */
    const applyTrunkTier = (graph: NeighborGraph): void => {
      const tier = fabricTrunkTier(graph.edges);
      fabricStats.trunkTierEdges = tier.edges;
      fabricStats.trunkTierThreshold = tier.threshold;
      setFabricTrunkThreshold(fabric.material, tier.threshold);
      setFabricTrunkThreshold(trunk.material, tier.threshold);
    };

    /** Shared state-insertion body for a NEW fabric edge — the exact
     * historical setFabric pass-1 block: claim a slot, arm the animating
     * set, snapshot endpoints/control/colours, register the state. The
     * immediate diff path, the cohort pump, and the consistency flush all
     * run THIS, so a deferred admission cannot drift from an immediate
     * one. Returns 'missing-cell' (skipped — a caller `continue`),
     * 'slotted', or 'unslotted' (slot space exhausted; the caller
     * escalates to a compacting full walk). renderOrder membership is the
     * caller's job: the three call sites differ on it by design. */
    const admitFabricEdge = (
      key: string,
      e: NeighborEdge,
      cells: ReadonlyMap<number, Cell>,
      bornAt: number,
    ): 'missing-cell' | 'slotted' | 'unslotted' => {
      const a = cells.get(e.from);
      const c = cells.get(e.to);
      if (!a || !c) return 'missing-cell';
      const slotted = allocateFabricSlot(key) !== undefined;
      const seed = fabricEdgeSeed(e.from, e.to);
      const routeColors = consensusRouteColors(seed);
      bezierControlInto(
        ctrl,
        a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
        c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
        seed,
      );
      const state: EdgeState = {
        fromCellId: e.from,
        toCellId: e.to,
        fromX: a.pos_seed[0], fromY: a.pos_seed[1], fromZ: a.pos_seed[2],
        toX: c.pos_seed[0], toY: c.pos_seed[1], toZ: c.pos_seed[2],
        ctrlX: ctrl[0], ctrlY: ctrl[1], ctrlZ: ctrl[2],
        bornAt,
        dyingAt: null,
        deathKind: null,
        deadEnd: null,
        growDir: 1,
        brightnessMul: arborBrightness(e.w, seed),
        trunkness: fabricEdgeTrunkness(e.w),
        fromR: routeColors.from[0], fromG: routeColors.from[1], fromB: routeColors.from[2],
        toR: routeColors.to[0], toG: routeColors.to[1], toB: routeColors.to[2],
        usage: 0,
      };
      edgeStatesRef.current.set(key, state);
      // One static-record write; the shader grows it from bornAt onward.
      if (slotted) writeLifecycleSlot(key, state);
      return slotted ? 'slotted' : 'unslotted';
    };

    const handles: NeuralFabricHandles = {
      setTrunkTier(graph) {
        applyTrunkTier(graph);
      },
      setInspectionField(field) {
        const transition = inspectionFieldRef.current;
        if (transition.to === field) return;
        transition.from = transition.to;
        transition.to = field;
        transition.progress = 0;
        fabric.material.uniforms.inspectionTransitionProgress.value = 0;
        trunk.material.uniforms.inspectionTransitionProgress.value = 0;
        warmRoutes.material.uniforms.inspectionTransitionProgress.value = 0;
        inspectionOnlyDirtyRef.current = true;
        emitDirtyRef.current = true;
      },
      setRecallAperture(
        activeAperture,
        activeStrength,
        departingAperture,
        departingStrength,
      ) {
        const nextActiveStrength = Number.isFinite(activeStrength)
          ? Math.max(0, Math.min(1, activeStrength))
          : 0;
        const nextDepartingStrength = Number.isFinite(departingStrength)
          ? Math.max(0, Math.min(1, departingStrength))
          : 0;
        const previous = recallApertureRef.current;
        if (
          previous.active === activeAperture
          && previous.departing === departingAperture
          && Math.abs(previous.activeStrength - nextActiveStrength) < 1e-4
          && Math.abs(previous.departingStrength - nextDepartingStrength) < 1e-4
        ) return;
        previous.active = activeAperture;
        previous.activeStrength = nextActiveStrength;
        previous.departing = departingAperture;
        previous.departingStrength = nextDepartingStrength;
        // No repaint arm. Every consumer of this state re-reads the ref on
        // frames it draws: the pre-early-return aperture bake (including
        // its one release-to-baseline frame), the warm-route redraw, and
        // the active-pulse writes. Arming the global full walk here — a
        // leftover from the CPU-lifecycle era — rewrote the entire fabric
        // on every ramp frame AND reset the aperture lanes AFTER the same
        // frame's bake, so the recall dim snapped instead of fading.
      },
      setMemoryRouteWidthScale(scale) {
        const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
        memory.material.linewidth = LIVE.cell.activeWidth * safeScale;
        routeHopPulse.material.linewidth = LIVE.cell.activeWidth
          * ROUTE_HOP_PULSE_WIDTH_SCALE
          * safeScale;
      },
      setFabric(graph, cells, now) {
        // The tier belongs to the selection, not to the diff: it lands even
        // when nothing below moved an edge (a re-mount rehydration, or an
        // identical selection whose arbor weights were re-derived).
        applyTrunkTier(graph);
        const states = edgeStatesRef.current;
        // Boot guard for the stagger below: a first population from an
        // empty set applies in one pass instead of staggered cohorts.
        const wasPopulated = states.size > 0;
        let overflowed = false;
        // A NEW authoritative graph supersedes any still-queued cohorts of
        // the previous one, and the diff below must run against COMPLETE
        // states. Flush first: deferred adds are admitted as fully-grown
        // stable edges (their grow-in moment has passed — no animation
        // reset, just one incremental snap write each); deferred kills are
        // simply dropped, because every queued-kill edge is still alive in
        // `states`, so pass 2 re-derives its fate against the NEW graph —
        // it dies at `now` if still absent, or stays quietly stable if it
        // returned (better than a kill+revive alpha pop).
        let flushAdmitted = 0;
        const pendingFlush = pendingCohortsRef.current;
        if (pendingFlush) {
          pendingCohortsRef.current = null;
          const grownBornAt = now - GROWTH_MS / 1000;
          for (
            let cohortIdx = pendingFlush.next;
            cohortIdx < pendingFlush.cohorts.length;
            cohortIdx += 1
          ) {
            const slice = pendingFlush.cohorts[cohortIdx];
            for (let i = slice.addStart; i < slice.addEnd; i += 1) {
              const { key, edge } = pendingFlush.adds[i];
              // growEdges may have raced the key in; keep fresher state.
              if (states.has(key)) continue;
              const admitted = admitFabricEdge(
                key,
                edge,
                pendingFlush.cells,
                grownBornAt,
              );
              if (admitted === 'missing-cell') continue;
              flushAdmitted += 1;
              if (admitted === 'unslotted') overflowed = true;
              else renderOrderRef.current.push(key);
            }
          }
        }
        const liveKeys = new Set<string>();
        let statsAdded = 0;
        let statsRevived = 0;
        let statsStable = 0;
        let statsDying = 0;
        // Two-pass diff over PERSISTENT slots. Pass 1: walk new edges,
        // collecting fresh ones as ADD CANDIDATES (admitted below — all of
        // them synchronously on the historical path, or a threshold prefix
        // now + the rest in delayed cohorts), and revive any that were
        // dying. Surviving edges keep their slot untouched, so a per-block
        // reconciliation rides the incremental path — no structural full
        // walk, no slot reassignment.
        const addCandidates = new Map<string, NeighborEdge>();
        for (const e of graph.edges) {
          const key = fabricEdgeKey(e.from, e.to);
          liveKeys.add(key);
          const existing = states.get(key);
          if (existing) {
            // Stable edge: leave alone. Revival of a dying edge:
            // clear dyingAt and fast-forward bornAt to "growth done"
            // so length stays at full. Alpha snaps from
            // (1 - decayProgress) up to 1 — this is an upward pop on
            // a previously-faded edge, much less jarring than the
            // disappear/reappear it replaces. Revival is rare (only
            // happens when a cell membership oscillates within
            // DECAY_MS), so we don't bother smoothing it further.
            if (existing.dyingAt !== null) {
              existing.dyingAt = null;
              existing.deathKind = null;
              existing.deadEnd = null;
              existing.bornAt = now - GROWTH_MS / 1000;
              statsRevived += 1;
              // One static-record rewrite snaps the slot back to stable.
              writeLifecycleSlot(key, existing);
            } else {
              statsStable += 1;
            }
            continue;
          }
          // A duplicate graph edge would have found the state just created
          // by its first occurrence on the historical inline path — count
          // it stable exactly as before.
          if (addCandidates.has(key)) {
            statsStable += 1;
            continue;
          }
          const a = cells.get(e.from);
          const c = cells.get(e.to);
          if (!a || !c) continue;
          addCandidates.set(key, e);
        }
        // Pass 2: any state not in the new graph is a DYING CANDIDATE for
        // the 'gc' fade — reconciliation, NOT a real chain cell death
        // (those are driven per-edge via killEdges with kind 'death',
        // which retracts + flashes). Idempotent: already-dying edges keep
        // their original dyingAt/deathKind, so the clock doesn't reset on
        // repeated setFabric calls during the same death window.
        const dyingCandidates: { key: string; st: EdgeState }[] = [];
        for (const [key, st] of states) {
          if (liveKeys.has(key)) continue;
          if (st.dyingAt === null) dyingCandidates.push({ key, st });
        }
        // Oversized churn (composition/reorg whole-graph replacement) is
        // staggered: a threshold prefix applies now, the remainder queues
        // as delayed cohorts the emitFabric pump admits. At or below the
        // threshold `plan` is null and every candidate applies here,
        // byte-identical to the historical path.
        const plan = wasPopulated
          ? planFabricCohorts(
            addCandidates.size,
            dyingCandidates.length,
            now,
            {
              staggerThreshold: LIVE.cell.fabricStaggerThreshold,
              cohortSize: LIVE.cell.fabricCohortSize,
              cohortIntervalS: LIVE.cell.fabricCohortInterval,
            },
          )
          : null;
        const immediateAdds = plan ? plan.immediateAdds : addCandidates.size;
        const immediateKills = plan
          ? plan.immediateKills
          : dyingCandidates.length;
        let deferredAdds: PendingFabricAdd[] | null = null;
        let addIndex = 0;
        for (const [key, e] of addCandidates) {
          if (addIndex < immediateAdds) {
            const admitted = admitFabricEdge(key, e, cells, now);
            if (admitted !== 'missing-cell') {
              statsAdded += 1;
              if (admitted === 'unslotted') overflowed = true;
              else renderOrderRef.current.push(key);
            }
          } else {
            (deferredAdds ??= []).push({ key, edge: e });
            statsAdded += 1;
          }
          addIndex += 1;
        }
        let deferredKills: string[] | null = null;
        for (let i = 0; i < dyingCandidates.length; i += 1) {
          const { key, st } = dyingCandidates[i];
          if (i < immediateKills) {
            st.dyingAt = now;
            st.deathKind = 'gc';
            statsDying += 1;
            writeLifecycleSlot(key, st);
            queueReap(key, st);
          } else {
            (deferredKills ??= []).push(key);
            statsDying += 1;
          }
        }
        if (plan && (deferredAdds || deferredKills)) {
          pendingCohortsRef.current = {
            cells,
            adds: deferredAdds ?? [],
            kills: deferredKills ?? [],
            cohorts: plan.cohorts,
            next: 0,
          };
        }
        fabricStats.observeDiff({
          atSec: now,
          kind: 'setFabric',
          added: statsAdded,
          revived: statsRevived,
          dying: statsDying,
          stable: statsStable,
          totalStates: states.size,
        });
        // Identical selection over no pending backlog: nothing moved, the
        // settled buffer stays. (flushAdmitted is always 0 when no cohorts
        // were queued, so the historical guard is unchanged there.)
        if (
          statsAdded === 0 && statsRevived === 0 && statsDying === 0
          && flushAdmitted === 0
        ) return;
        emitDirtyRef.current = true;
        if (overflowed) {
          // The persistent slot space cannot absorb this diff. Re-establish
          // the clip-priority order (current edges first, afterimages last)
          // and let a compacting full walk reassign every slot. Deferred
          // candidates have no state yet — keep them out of the rebuilt
          // order (the pump pushes each key exactly once on admission;
          // including them here would leave a stateless entry that turns
          // into a permanent double-draw duplicate after admission).
          const orderEdges = deferredAdds
            ? graph.edges.filter(
              (e) => states.has(fabricEdgeKey(e.from, e.to)),
            )
            : graph.edges;
          const { order } = orderFabricStateKeys(orderEdges, states.keys());
          renderOrderRef.current = order;
          renderOrderTombstonesRef.current = 0;
          passivePositionsDirtyRef.current = true;
        }
        enforceEdgeStateCeiling();
      },
      growEdges(edges, cells, bornAtByKey, dirByKey) {
        // `now` is read from the shared sim clock so callers don't have
        // to thread it; the driver's bornAtByKey values are absolute
        // sim-seconds against the same clock (a future value staggers).
        const now = simClock.elapsedSec;
        const states = edgeStatesRef.current;
        let statsAdded = 0;
        let statsRevived = 0;
        let growOverflowed = false;
        for (const e of edges) {
          const key = fabricEdgeKey(e.from, e.to);
          const existing = states.get(key);
          if (existing) {
            // Re-adding a dying edge: revive it (clear death, snap to
            // fully-grown) rather than duplicating into a second state.
            existing.dyingAt = null;
            existing.deathKind = null;
            existing.deadEnd = null;
            existing.bornAt = now - GROWTH_MS / 1000;
            statsRevived += 1;
            // One static-record rewrite snaps the slot back to stable.
            writeLifecycleSlot(key, existing);
            continue;
          }
          const a = cells.get(e.from);
          const c = cells.get(e.to);
          if (!a || !c) continue;
          statsAdded += 1;
          if (allocateFabricSlot(key) === undefined) growOverflowed = true;
          const seed = fabricEdgeSeed(e.from, e.to);
          const routeColors = consensusRouteColors(seed);
          bezierControlInto(
            ctrl,
            a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
            c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
            seed,
          );
          const grown: EdgeState = {
            fromCellId: e.from,
            toCellId: e.to,
            fromX: a.pos_seed[0], fromY: a.pos_seed[1], fromZ: a.pos_seed[2],
            toX: c.pos_seed[0], toY: c.pos_seed[1], toZ: c.pos_seed[2],
            ctrlX: ctrl[0], ctrlY: ctrl[1], ctrlZ: ctrl[2],
            bornAt: bornAtByKey.get(key) ?? now,
            dyingAt: null,
            deathKind: null,
            deadEnd: null,
            growDir: dirByKey.get(key) ?? 1,
            brightnessMul: arborBrightness(e.w, seed),
            trunkness: fabricEdgeTrunkness(e.w),
            fromR: routeColors.from[0], fromG: routeColors.from[1], fromB: routeColors.from[2],
            toR: routeColors.to[0], toG: routeColors.to[1], toB: routeColors.to[2],
            usage: 0,
          };
          states.set(key, grown);
          writeLifecycleSlot(key, grown);
          renderOrderRef.current.push(key); // append; reaps clean up lazily
        }
        fabricStats.observeDiff({
          atSec: now,
          kind: 'growEdges',
          added: statsAdded,
          revived: statsRevived,
          dying: 0,
          stable: 0,
          totalStates: states.size,
        });
        // Every requested edge already existed as stable: no state moved, so
        // don't arm any redraw over the untouched fabric.
        if (statsAdded === 0 && statsRevived === 0) return;
        emitDirtyRef.current = true;
        // New tendrils ride their persistent slots through the incremental
        // path; only slot-space exhaustion needs a compacting full walk.
        if (growOverflowed) passivePositionsDirtyRef.current = true;
        enforceEdgeStateCeiling();
      },
      killEdges(keys, dyingAt, kind, deadEndByKey) {
        const states = edgeStatesRef.current;
        let statsDying = 0;
        for (const key of keys) {
          const st = states.get(key);
          // Skip unknown or already-dying edges — the latter keeps the
          // death clock from resetting if a kill is issued twice.
          if (!st || st.dyingAt !== null) continue;
          st.dyingAt = dyingAt;
          st.deathKind = kind;
          st.deadEnd = kind === 'death' ? (deadEndByKey?.get(key) ?? 'from') : null;
          statsDying += 1;
          writeLifecycleSlot(key, st);
          queueReap(key, st);
        }
        fabricStats.observeDiff({
          atSec: dyingAt,
          kind: 'killEdges',
          added: 0,
          revived: 0,
          dying: statsDying,
          stable: 0,
          totalStates: states.size,
        });
        // Every key was unknown or already dying: nothing changed, so don't
        // arm any redraw over the untouched fabric. (Live data shows
        // steady-state killEdges calls are usually exactly this no-op.)
        if (statsDying === 0) return;
        // Dying edges animate inside their persistent slots — no structural
        // walk; the retract/fade rides the incremental path until reap frees
        // the slot in place.
        emitDirtyRef.current = true;
        enforceEdgeStateCeiling();
      },
      reinforce(fromCellId, toCellId) {
        const key = fabricEdgeKey(fromCellId, toCellId);
        const st = edgeStatesRef.current.get(key);
        if (!st) return;
        st.usage = reinforceUsage(st.usage, LIVE.cell.reinforceAmount);
        if (st.usage > 0) warmRouteKeysRef.current.add(key);
      },
      collectLiveEdgeKeys() {
        const keys: string[] = [];
        for (const [key, st] of edgeStatesRef.current) {
          if (st.dyingAt === null) keys.push(key);
        }
        return keys;
      },
      emitFabric(now) {
        // The fabric animates entirely on the GPU: these three scalars are
        // its complete per-frame cost, and they must advance even on frames
        // the CPU otherwise skips.
        syncFabricLifecycleUniforms(fabric.material, now);
        // The wide pass animates from the same three scalars; six uniform
        // writes a frame is the whole CPU cost of the second draw.
        syncFabricLifecycleUniforms(trunk.material, now);
        fabricStats.liveEdges = edgeStatesRef.current.size;
        // Foreground catch-up. A frozen clock stamps every kill taken while
        // the tab was hidden with the SAME dyingAt, so the resuming sim clock
        // would retire the whole pile in one frame one death window from now.
        // Retire it against the wall-clock second the tab came back instead,
        // a bounded batch per queue per frame, until both queues run dry
        // inside their budget (or the sim clock catches up on its own).
        if (catchUpUntilSec !== null) {
          if (catchUpUntilSec <= now) {
            catchUpUntilSec = null;
          } else {
            const deathDrained = drainFabricReapQueue(
              reapQueues.death,
              reapTargets,
              catchUpUntilSec,
              FOREGROUND_CATCH_UP_BATCH,
            );
            const gcDrained = drainFabricReapQueue(
              reapQueues.gc,
              reapTargets,
              catchUpUntilSec,
              FOREGROUND_CATCH_UP_BATCH,
            );
            if (
              deathDrained < FOREGROUND_CATCH_UP_BATCH
              && gcDrained < FOREGROUND_CATCH_UP_BATCH
            ) catchUpUntilSec = null;
          }
        }
        // Lazy reap: expired lifecycles are already invisible analytically;
        // this only reclaims bookkeeping + slots, O(expired) per call.
        drainFabricReapQueue(reapQueues.death, reapTargets, now);
        drainFabricReapQueue(reapQueues.gc, reapTargets, now);
        if (renderOrderTombstonesRef.current > RENDER_ORDER_TOMBSTONE_MAX) {
          const reapStates = edgeStatesRef.current;
          renderOrderRef.current = renderOrderRef.current.filter(
            (key) => reapStates.has(key),
          );
          renderOrderTombstonesRef.current = 0;
        }
        // Deferred-cohort pump: admit any due slices of a staggered
        // oversized diff through the SAME insertion body the immediate
        // path uses. Runs before the dirty gate below so a due cohort
        // wakes the fabric by itself; a null queue costs one compare.
        const pendingCohorts = pendingCohortsRef.current;
        if (pendingCohorts) {
          const pumpStates = edgeStatesRef.current;
          let cohortChanged = false;
          let cohortOverflowed = false;
          while (
            pendingCohorts.next < pendingCohorts.cohorts.length
            && pendingCohorts.cohorts[pendingCohorts.next].startAt <= now
          ) {
            const slice = pendingCohorts.cohorts[pendingCohorts.next];
            pendingCohorts.next += 1;
            for (let i = slice.addStart; i < slice.addEnd; i += 1) {
              const { key, edge } = pendingCohorts.adds[i];
              // growEdges may have raced this key in — keep fresher state.
              if (pumpStates.has(key)) continue;
              // Admission time IS the birth time: a queued edge grows the
              // moment it enters, so no future-bornAt values exist on this
              // path (growEdges' documented future-stagger contract stays
              // its own).
              const admitted = admitFabricEdge(
                key,
                edge,
                pendingCohorts.cells,
                now,
              );
              if (admitted === 'missing-cell') continue;
              cohortChanged = true;
              // Always joined (even unslotted) so the compacting walk can
              // find — and eventually reap — the state.
              renderOrderRef.current.push(key);
              if (admitted === 'unslotted') cohortOverflowed = true;
            }
            for (let i = slice.killStart; i < slice.killEnd; i += 1) {
              const key = pendingCohorts.kills[i];
              const st = pumpStates.get(key);
              // Unknown or already dying (a real killEdges beat us):
              // keep the existing clock — killEdges idempotency.
              if (!st || st.dyingAt !== null) continue;
              st.dyingAt = now;
              st.deathKind = 'gc';
              writeLifecycleSlot(key, st);
              queueReap(key, st);
              cohortChanged = true;
            }
          }
          if (pendingCohorts.next >= pendingCohorts.cohorts.length) {
            pendingCohortsRef.current = null;
          }
          if (cohortChanged) emitDirtyRef.current = true;
          // Slot-space exhaustion mid-stagger follows the growEdges
          // convention: arm the compacting structural walk.
          if (cohortOverflowed) passivePositionsDirtyRef.current = true;
        }
        // The sparse warm-route layer and structural lifecycle share one
        // bounded simulation delta. The passive base may still early-return.
        const prevEmit = prevEmitSecRef.current;
        const dt = prevEmit === null ? 0 : Math.max(0, now - prevEmit);
        prevEmitSecRef.current = now;
        // Cell-mesh live-tune change-detector. Runs BEFORE the early-
        // return so a knob dragged while the fabric is idle still applies.
        // Purely ADDITIVE: it only ever FORCES a redraw (sets emitDirtyRef
        // true), never suppresses one, so it cannot regress the living-
        // mesh animation. Steady state with no change = six numeric
        // compares, then the existing early-return fires as before.
        // fabricAlpha / centerDim became per-frame uniforms with the GPU
        // lifecycle — a knob drag lands next frame with no repaint at all.
        // Width / active-colour changes still need one pass through
        // applyPassiveViewWeight + the material props below, but never a
        // fabric rewrite: arm the dirty gate only.
        const ct = LIVE.cell, lc = lastCellTweakRef.current;
        if (ct.activeColorR !== lc.r || ct.activeColorG !== lc.g ||
            ct.activeColorB !== lc.b || ct.fabricWidth !== lc.fw ||
            ct.activeWidth !== lc.aw) {
          lc.r = ct.activeColorR; lc.g = ct.activeColorG;
          lc.b = ct.activeColorB; lc.fw = ct.fabricWidth; lc.aw = ct.activeWidth;
          emitDirtyRef.current = true; // one pass applies the new values
        }
        const inspectionField = inspectionFieldRef.current;
        if (inspectionField.progress < 1) {
          inspectionField.progress = Math.min(
            1,
            inspectionField.progress
              + dt / INSPECTION_FIELD_TRANSITION_SECONDS,
          );
          fabric.material.uniforms.inspectionTransitionProgress.value =
            inspectionField.progress;
          trunk.material.uniforms.inspectionTransitionProgress.value =
            inspectionField.progress;
          warmRoutes.material.uniforms.inspectionTransitionProgress.value =
            inspectionField.progress;
          if (inspectionField.progress >= 1) {
            inspectionField.from = inspectionField.to;
          }
        }
        const recallAperture = recallApertureRef.current;
        // Recall apertures are the one lifecycle input the CPU still owns
        // (spatial-hash segment queries can't move to the vertex stage).
        // While a recall holds or releases, bake the aperture scale at each
        // slot's STATIC curve samples (flash = 0 — the shader lifts) and
        // upload just the 2-float-per-segment aperture prefix; one final
        // pass after release restores the exact 1.0 baseline everywhere.
        const apertureActive = recallAperture.activeStrength > 0.001
          || recallAperture.departingStrength > 0.001;
        if (apertureActive || apertureAnimationRef.current) {
          const colorArray = lifecycleArrays.color;
          const slots = slotByKeyRef.current;
          const apertureStates = edgeStatesRef.current;
          for (const [key, slot] of slots) {
            const st = apertureStates.get(key);
            if (!st) continue;
            const baseSegment = slot * FABRIC_SLOT_SEGMENTS;
            let prevScale = apertureActive
              ? recallApertureScaleAt(recallAperture, st.fromX, st.fromZ, 0, now)
              : 1;
            for (let seg = 0; seg < FABRIC_SLOT_SEGMENTS; seg += 1) {
              const t = (seg + 1) / FABRIC_SLOT_SEGMENTS;
              let endScale = 1;
              if (apertureActive) {
                bezierAtInto(
                  sample,
                  st.fromX, st.fromY, st.fromZ,
                  st.ctrlX, st.ctrlY, st.ctrlZ,
                  st.toX, st.toY, st.toZ,
                  t,
                );
                endScale = recallApertureScaleAt(
                  recallAperture, sample[0], sample[2], 0, now,
                );
              }
              const offset = (baseSegment + seg) * FABRIC_LIFE_COLOR_STRIDE;
              colorArray[offset + FABRIC_LIFE_APERTURE_START_OFFSET] = prevScale;
              colorArray[offset + FABRIC_LIFE_APERTURE_END_OFFSET] = endScale;
              prevScale = endScale;
            }
          }
          fabric.count = usedSlotCountRef.current * FABRIC_SLOT_SEGMENTS;
          commitFabricApertureLanes(fabric);
        }
        apertureAnimationRef.current = apertureActive;

        const states = edgeStatesRef.current;
        const warmRouteKeys = warmRouteKeysRef.current;
        const warmLayerWasVisible = warmRoutes.geometry.instanceCount > 0;
        if (
          warmRouteKeys.size > 0
          || warmLayerWasVisible
          || emitDirtyRef.current
        ) {
          applyPassiveViewWeight();
        }

        // ② Reinforcement is deliberately absent from the complete passive
        // walk below. Only recently traversed edges are sampled and uploaded;
        // when the last usage value settles, one empty commit hides the layer
        // and subsequent frames return to zero buffer work.
        if (warmRouteKeys.size > 0 || warmLayerWasVisible) {
          warmRoutes.count = 0;
          for (const key of warmRouteKeys) {
            const st = states.get(key);
            if (!st) {
              warmRouteKeys.delete(key);
              continue;
            }
            st.usage = decayUsage(
              st.usage,
              dt,
              LIVE.cell.reinforceHalfLife,
            );
            if (st.usage <= 0) {
              warmRouteKeys.delete(key);
              continue;
            }
            const render = fabricEdgeRenderState(st, now);
            if (render.reap) {
              st.usage = 0;
              warmRouteKeys.delete(key);
              continue;
            }
            writeFabricEdgeSegments(
              warmRoutes,
              st,
              render,
              sample,
              now,
              st.usage,
              warmRouteBrightnessGain(
                st.usage,
                LIVE.cell.reinforceGain,
              ),
              recallAperture,
              inspectionField,
            );
          }
          commitLayer(warmRoutes);
        }

        if (!emitDirtyRef.current) {
          fabricStats.observeSkipFrame();
          return;
        }
        if (
          inspectionOnlyDirtyRef.current
          && !passivePositionsDirtyRef.current
          && !globalRepaintRef.current
        ) {
          // Selection changed over a settled fabric: rewrite only the two
          // static inspection snapshots, slot-addressed so they stay aligned
          // with the fixed position/colour slots.
          const slots = slotByKeyRef.current;
          for (const key of renderOrderRef.current) {
            const st = states.get(key);
            if (!st) continue;
            const slot = slots.get(key);
            if (slot === undefined) continue;
            fabric.count = slot * FABRIC_SLOT_SEGMENTS;
            // Static-span bake: the shader owns interval and flash lift.
            writeFabricEdgeInspectionSegments(
              fabric,
              st,
              SETTLED_EDGE_RENDER,
              inspectionField,
            );
            fillInspectionSlotRemainder(
              fabric,
              (slot + 1) * FABRIC_SLOT_SEGMENTS,
            );
          }
          fabric.count = usedSlotCountRef.current * FABRIC_SLOT_SEGMENTS;
          // A selection change can land in the SAME frame as births/deaths —
          // the topology build issues both — and this branch clears the dirty
          // gate on the way out. Without flushing here those static records
          // stayed written in RAM but never uploaded, so a killed edge kept
          // rendering alive until some unrelated event happened to flush it.
          // The inspection ranges these add are a subset of the full prefix
          // the commit below re-adds.
          if (lifeDirtySlots.length > 0) {
            commitFabricLifecycleSlotRanges(
              fabric,
              mergeFabricSlotRanges(lifeDirtySlots),
            );
            lifeDirtySlots.length = 0;
          }
          fabricStats.observeUpload(fabricUploadBytes(fabric.count, {
            positions: false,
            colors: false,
            inspection: (fabric.inspectionFromBuf ? 1 : 0)
              + (fabric.inspectionToBuf ? 1 : 0),
          }));
          commitLayer(fabric, false, false, true);
          inspectionOnlyDirtyRef.current = false;
          emitDirtyRef.current = false;
          fabricStats.observeInspectionOnlyFrame();
          return;
        }
        // Live line widths. LineMaterial.linewidth is runtime-settable, so
        // pushing it on every real draw (after the early-return) picks up
        // any width-knob change — including on the forced redraw above.
        active.material.linewidth = LIVE.cell.activeWidth;

        // Event flush: lifecycle animation is GPU-owned, so the only per-emit
        // buffer work is uploading the static records that admits / kills /
        // revivals wrote since the last flush. A frame with no events and no
        // structural change uploads nothing.
        if (
          !passivePositionsDirtyRef.current
          && !globalRepaintRef.current
        ) {
          if (lifeDirtySlots.length > 0) {
            fabric.count = usedSlotCountRef.current * FABRIC_SLOT_SEGMENTS;
            commitFabricLifecycleSlotRanges(
              fabric,
              mergeFabricSlotRanges(lifeDirtySlots),
            );
            fabricStats.observeIncrementalFrame(lifeDirtySlots.length, 0);
            lifeDirtySlots.length = 0;
          }
          inspectionOnlyDirtyRef.current = false;
          emitDirtyRef.current = false;
          return;
        }

        // Full walk: compacting structural change (slot-space overflow /
        // boot) or a rare global repaint. Rewrites every static record into
        // freshly assigned slots plus the settled inspection snapshots.
        const fullWalkReason: FabricFullWalkReason = passivePositionsDirtyRef.current
          ? 'structural'
          : 'global-repaint';
        const slots = slotByKeyRef.current;
        slots.clear();
        const slotCapacity = Math.floor(
          fabric.positions.length / 6 / FABRIC_SLOT_SEGMENTS,
        );
        let slotIndex = 0;
        // Reap list deferred so we don't mutate the map mid-iteration.
        let toReap: string[] | null = null;

        for (const key of renderOrderRef.current) {
          const st = states.get(key);
          if (!st) continue;
          // Expired lifecycles compact away here; live and animating ones
          // just get their static record — the shader owns the animation.
          if (fabricLifecycleEndSec(st.dyingAt, st.deathKind) <= now) {
            (toReap ??= []).push(key);
            continue;
          }
          // Over the slot budget: drop trailing entries (renderOrder keeps
          // current edges first, so superseded afterimages clip before live
          // form — the same degradation direction as the packed layout).
          if (slotIndex >= slotCapacity) continue;
          writeFabricLifecycleSlot(
            lifecycleArrays,
            slotIndex * FABRIC_SLOT_SEGMENTS,
            {
              fromX: st.fromX, fromY: st.fromY, fromZ: st.fromZ,
              ctrlX: st.ctrlX, ctrlY: st.ctrlY, ctrlZ: st.ctrlZ,
              toX: st.toX, toY: st.toY, toZ: st.toZ,
              fromR: st.fromR, fromG: st.fromG, fromB: st.fromB,
              toR: st.toR, toG: st.toG, toB: st.toB,
              bornAt: st.bornAt,
              dyingAt: st.dyingAt,
              deathKind: st.deathKind,
              deadEnd: st.deadEnd,
              growDir: st.growDir,
              brightnessMul: st.brightnessMul,
              trunkness: st.trunkness,
            },
          );
          fabric.count = slotIndex * FABRIC_SLOT_SEGMENTS;
          writeFabricEdgeInspectionSegments(
            fabric,
            st,
            SETTLED_EDGE_RENDER,
            inspectionField,
          );
          fillInspectionSlotRemainder(
            fabric,
            (slotIndex + 1) * FABRIC_SLOT_SEGMENTS,
          );
          // The slot writer resets the aperture lanes to the 1.0 baseline;
          // the aperture pass re-bakes them next frame while a recall holds.
          slots.set(key, slotIndex);
          slotIndex += 1;
        }
        usedSlotCountRef.current = slotIndex;
        fabric.count = slotIndex * FABRIC_SLOT_SEGMENTS;
        lifeDirtySlots.length = 0; // superseded by the full upload below

        if (toReap) {
          for (const key of toReap) {
            states.delete(key);
            warmRouteKeys.delete(key);
          }
        }
        // A full walk compacts the slot space: every surviving key was just
        // reassigned sequentially, so recycled holes and renderOrder
        // tombstones reset together.
        freeSlotsRef.current.length = 0;
        if (toReap || renderOrderTombstonesRef.current > 0) {
          renderOrderRef.current = renderOrderRef.current.filter(
            (key) => states.has(key),
          );
        }
        renderOrderTombstonesRef.current = 0;

        commitFabricLifecycleFull(fabric);
        inspectionOnlyDirtyRef.current = false;
        globalRepaintRef.current = false;
        passivePositionsDirtyRef.current = false;
        emitDirtyRef.current = false;
        fabricStats.observeFullWalk(fullWalkReason, slotIndex, 0);
      },
      pushActiveHop(hop, cells) {
        const layer = hop.mode === 'memory'
          ? memory
          : hop.mode === 'lock'
            ? routeHopPulse
            : active;
        const layerCapacity = layer.positions.length / 6;
        // Once a per-frame layer is saturated, later low-priority trails must
        // not continue doing Cell lookups and Bezier sampling for data that
        // pushSegment would discard.
        if (layer.count >= layerCapacity) return;
        const a = cells.get(hop.fromCellId);
        const c = cells.get(hop.toCellId);
        if (!a || !c) return;
        const seed = fabricEdgeSeed(hop.fromCellId, hop.toCellId);
        bezierControlInto(
          ctrl,
          a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
          c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
          seed,
        );
        // Walk the hop's Bezier in N+1 sample points; for each pair
        // of consecutive samples emit one sub-segment. Per-segment
        // brightness peaks at the wavefront (frontT) and decays
        // exponentially behind it; segments AHEAD of the wavefront
        // are skipped entirely so the lit region grows smoothly.
        const direction = hop.direction ?? 1;
        const samplesPerHop = hop.mode === 'lock'
          ? ROUTE_HOP_PULSE_SAMPLES_PER_HOP
          : activeSamplesPerHop;
        let prevX = direction === 1 ? a.pos_seed[0] : c.pos_seed[0];
        let prevY = direction === 1 ? a.pos_seed[1] : c.pos_seed[1];
        let prevZ = direction === 1 ? a.pos_seed[2] : c.pos_seed[2];
        for (let i = 1; i <= samplesPerHop; i++) {
          if (layer.count >= layerCapacity) break;
          const travelT = i / samplesPerHop;
          const curveT = direction === 1 ? travelT : 1 - travelT;
          bezierAtInto(
            sample,
            a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
            ctrl[0], ctrl[1], ctrl[2],
            c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
            curveT,
          );
          // Midpoint in travel space, independent of Bezier sampling direction.
          const travelMid = (
            travelT + (i - 1) / samplesPerHop
          ) * 0.5;
          if (travelMid <= hop.frontT) {
            const distBehind = hop.frontT - travelMid;
            // Sharper decay = tighter wavefront. 7.5 makes the lit
            // band extend roughly 0.4 of one hop behind the front,
            // which reads as a definite wave rather than a static line.
            const tail = Math.exp(-distBehind * (hop.tailDecay ?? 7.5));
            // Preserve route chroma instead of letting additive energy rail
            // every channel to white. Live packets retain a separate pale-hot
            // head; lock echoes deliberately remain a headless phase sheath.
            const intensity = consensusChromaIntensity(hop.brightness * tail);
            const r = hop.color[0] * LIVE.cell.activeColorR * intensity;
            const g = hop.color[1] * LIVE.cell.activeColorG * intensity;
            const b = hop.color[2] * LIVE.cell.activeColorB * intensity;
            pushSegment(layer, prevX, prevY, prevZ, sample[0], sample[1], sample[2], r, g, b);
          }
          prevX = sample[0]; prevY = sample[1]; prevZ = sample[2];
        }
      },
      flushActive() {
        commitLayer(active);
        commitLayer(memory);
        active.count = 0;
        memory.count = 0;
      },
      flushRouteHopPulse() {
        if (
          routeHopPulse.count === 0
          && routeHopPulse.geometry.instanceCount === 0
        ) return;
        commitLayer(routeHopPulse);
        routeHopPulse.count = 0;
      },
    };
    onReady(handles);
    return () => hiddenReaper.stop();
  }, [
    fabric,
    trunk,
    warmRoutes,
    active,
    memory,
    routeHopPulse,
    applyPassiveViewWeight,
    onReady,
    activeSamplesPerHop,
  ]);

  return (
    <>
      <primitive object={fabric.mesh} />
      {/* 中央神经: the same records, drawn wide, over the top decile of the
          arbor. Immediately after the mesh pass because the two are one
          picture split by width — never a second copy of the same edge. */}
      <primitive object={trunk.mesh} />
      <primitive object={warmRoutes.mesh} />
      <primitive object={active.mesh} />
      <primitive object={memory.mesh} />
      <primitive object={routeHopPulse.mesh} />
    </>
  );
}
