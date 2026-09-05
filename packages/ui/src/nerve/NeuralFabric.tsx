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
// A numeric two-level index (`lo → hi → state`) mirrors that map for the
// one reader that runs per hop per frame — the active-hop curve lookup —
// so no frame builds a key string; every writer of the map writes both.
//
// Empty layers are invisible OBJECTS, not empty draws: a layer whose
// committed count is zero flips `mesh.visible = false` at the commit, so
// three's render walk never binds its program/VAO or runs its before-render
// hooks for nothing (the boot precompile walks with `traverse`, which ignores
// visibility, so every program is still linked at first light).

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import type { NeighborEdge, PassiveSelection } from '../geometry/neighborGraph';
import { bezierAtInto, bezierControlInto, fabricEdgeSeed } from '../geometry/edgeBezier';
import {
  canonicalizeFabricRenderOrder,
  fabricEdgeIndexDelete,
  fabricEdgeIndexSet,
  fabricEdgeKey,
  orderFabricStateKeys,
  type FabricEdgeIndex,
} from './fabricOrder';
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
  FABRIC_APERTURE_UPLOAD_POLICY,
  FABRIC_LIFE_APERTURE_END_OFFSET,
  FABRIC_LIFE_APERTURE_START_OFFSET,
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
  FABRIC_LIFECYCLE_CURVE_SCALAR_UPLOAD_POLICY,
  FABRIC_LIFECYCLE_UPLOAD_POLICY,
  fabricLifecycleEndSec,
  makeFabricLifecycleArrays,
  writeFabricLifecycleSlot,
  type FabricLifecycleArrays,
} from './fabricLifecycleSlots';
import {
  fabricEdgeRenderStateInto,
  GROWTH_MS,
  makeEdgeRenderScratch,
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
  WARM_TAIL_COMMIT_INTERVAL_S,
  WARM_TAIL_USAGE,
} from './fabricReinforce';
import {
  arborBrightness,
  fabricTwigViewEnergy,
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
  makeScreenSpaceCapsuleGeometry,
  enableTaperedCapsuleWidthMaterial,
  optimizeScreenSpaceCapsuleMaterial,
  syncScreenSpaceCapsuleViewport,
} from '../geometry/screenSpaceCapsuleLine';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import {
  PERFORMANCE_PROBE_LABELS,
  beginCpuProbe,
  endCpuProbe,
} from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import {
  consensusChromaIntensity,
  consensusRouteColorsInto,
  consensusRouteGoldMix,
  makeConsensusRouteColorsScratch,
} from '../derives/consensusFlow.derive';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import type { Vec3 } from '../types';
import {
  consensusMemoryApertureAnimating,
  consensusMemoryApertureBounds,
  consensusMemoryApertureScale,
  type ConsensusMemoryAperture,
} from './consensusMemoryAperture';
import {
  RecallApertureIndex,
  type RecallApertureIndexEntry,
  type RecallApertureQueryBounds,
} from './recallApertureIndex';
import {
  resolveActiveHopCurveInto,
  type ResolvedActiveHopCurve,
} from './activeHopCurve';
import { createNonEmptyInstanceGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';
import {
  cellDetailFabricEnergyGain,
  cellDetailFabricWidthScale,
} from '../derives/sceneView.derive';
import { neverRaycast } from '../components/CellPopulationField';
import { reportBootNerveGrowth } from '../boot/nerveRestGate';

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
  /** By-value endpoint overrides, used where an end has no live Cell to
   *  resolve: the ghost leg a metabolic packet departs on starts at the
   *  address of the cell that died. Supplying one is what makes that leg
   *  unextinguishable — the display map cannot take a value away. */
  fromPos?: Vec3;
  toPos?: Vec3;
  /** Overall brightness multiplier for this hop. Older trail hops
   *  get smaller values so the cascade reads as a fading wake. */
  brightness: number;
  /** Exponential falloff behind frontT. Recall afterimages lower this so the
   *  full proven route remains legible; live wavefronts use the tight default. */
  tailDecay?: number;
  /** Route chroma identity; lock echoes retain the recalled route's colour. */
  color: Vec3;
}

const ZERO_COLOR: Vec3 = [0, 0, 0];

/** One reusable hop record for a frame loop. `pushActiveHop` reads its
 *  argument synchronously and retains nothing, so a walk that pushes up to
 *  MAX_ACTIVE_PULSES × (head + TRAIL_HOPS) hops a frame can write them all
 *  through one object instead of allocating one per hop. Every lane —
 *  the optional ones included — is present from the start so the record
 *  keeps one shape. */
export function makeActiveHopScratch(): ActiveHop {
  return {
    fromCellId: 0,
    toCellId: 0,
    mode: 'live',
    frontT: 0,
    brightness: 0,
    color: ZERO_COLOR,
    direction: undefined,
    tailDecay: undefined,
    fromPos: undefined,
    toPos: undefined,
  };
}

/** Write one hop into the scratch and hand it back for the push. The
 *  optional lanes are assigned on every call (to `undefined` when absent), so
 *  a hop never inherits the previous one's direction, tail or ghost ends. */
export function writeActiveHop(
  out: ActiveHop,
  fromCellId: number,
  toCellId: number,
  mode: ActiveHop['mode'],
  frontT: number,
  brightness: number,
  color: Vec3,
  direction?: 1 | -1,
  tailDecay?: number,
  fromPos?: Vec3,
  toPos?: Vec3,
): ActiveHop {
  out.fromCellId = fromCellId;
  out.toCellId = toCellId;
  out.mode = mode;
  out.frontT = frontT;
  out.brightness = brightness;
  out.color = color;
  out.direction = direction;
  out.tailDecay = tailDecay;
  out.fromPos = fromPos;
  out.toPos = toPos;
  return out;
}

export interface NeuralFabricHandles {
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
  setTrunkTier(graph: PassiveSelection): void;
  /** Diff a new neighbour graph into the persistent edge map. New
   *  edges enter growing phase (bornAt=now); missing edges enter
   *  dying phase (dyingAt=now); stable edges are untouched. Does
   *  NOT emit — the actual draw happens in `emitFabric` so that
   *  growth/decay can animate frame-by-frame. */
  setFabric(graph: PassiveSelection, cells: ReadonlyMap<number, Cell>, now: number): void;
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
  /** Stock endpoint lanes. On a lifecycle layer these are a ONE-instance
   *  dummy: the patched program strips the stock attributes, three uploads
   *  every geometry attribute at the first draw regardless, and a
   *  full-capacity pair cost 4.6 MB of RAM and the same of VRAM at the 8K
   *  class (11.5 MB at 20K) for lanes nothing read. Capacity therefore comes
   *  from `fatLineLayerCapacity`, never from `positions.length`. */
  positions: Float32Array;
  colors: Float32Array;
  /** Per-endpoint width FACTOR on the material's own `linewidth`, present only
   *  on a layer built with `taperedWidth`. Two floats a segment, initialised to
   *  1 so an instance nobody writes draws at exactly the uniform width. See
   *  `enableTaperedCapsuleWidthMaterial` for why one class in this scene needs
   *  a stroke that is not one width from end to end. */
  widths?: Float32Array;
  posBuf: THREE.InstancedInterleavedBuffer;
  colBuf: THREE.InstancedInterleavedBuffer;
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

/** Segments a layer can hold. A lifecycle layer is sized by its static
 *  records (the stock lanes are a dummy); every other layer by its stock
 *  endpoint lane. Exported for the construction tests. */
export function fatLineLayerCapacity(
  layer: Pick<FatLineLayer, 'positions' | 'lifecycle'>,
): number {
  return layer.lifecycle
    ? layer.lifecycle.arrays.scalar.length / FABRIC_LIFE_SCALAR_STRIDE
    : layer.positions.length / 6;
}

/** Empty layers leave the render list entirely. three r169 binds the
 *  program, material state and VAO and runs the object's before-render hooks
 *  BEFORE its zero-count early-out (`WebGLRenderer.renderBufferDirect` →
 *  `WebGLBufferRenderer.renderInstances`), and `projectObject` drops an
 *  invisible object before any of that (`WebGLRenderer.js:1321`). The hooks
 *  this skips are per-draw uniform syncs — LineSegments2's resolution and the
 *  capsule viewport — whose only reader is the draw of this very object, and
 *  the first visible frame runs them again before it draws. Called at every
 *  commit, from the count the commit just published. */
function syncFatLineLayerVisibility(layer: FatLineLayer): void {
  layer.mesh.visible = layer.count > 0;
}

/** A freshly built layer holds nothing, so it enters the scene hidden. Only
 *  this component's own layers take this: the bridge class builds on
 *  `makeFatLineLayer` too, commits its slots on its own path, and keeps the
 *  default. */
function hiddenUntilCommitted(layer: FatLineLayer): FatLineLayer {
  syncFatLineLayerVisibility(layer);
  return layer;
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
 * outside the frustum. Exported for the packed vs slot-layout equivalence
 * tests. */
export function fillFabricSlotRemainder(
  layer: Pick<FatLineLayer, 'positions' | 'colors' | 'count'>,
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
    layer.count += 1;
  }
}

/** Emit one passive-language edge into either the immutable resting fabric or
 * the sparse warm-route overlay. `usage` changes route colour/spatial energy;
 * `brightnessGain` selects the complete baseline (1) or only reinforcement's
 * incremental contribution (>0). Keeping one sampler prevents the overlay
 * from drifting away from lifecycle, aperture, or taper semantics.
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
      writePositions,
    );
    prevX = sample[0];
    prevY = sample[1];
    prevZ = sample[2];
    prevR = endR;
    prevG = endG;
    prevB = endB;
    if (t >= tEnd) break;
  }
}

/** One fat-line material, patched in the only order the shader patches
 * tolerate: the capsule first (it rewrites stock chunks), then — at the
 * caller — the lifecycle (it anchors on the capsule's). Split out of
 * `makeFatLineLayer` so a second pass over an
 * EXISTING geometry can be built from the same recipe rather than a copy of
 * it. */
function makeFatLineMaterial(
  widthPx: number,
  accumulation: 'screen' | 'additive',
  useScreenCapsule: boolean,
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
  lifecycle = false,
  taperedWidth = false,
): FatLineLayer {
  // A lifecycle layer never reads its stock endpoint lanes (the patched
  // program declares neither `instanceStart/End` nor `instanceColorStart/End`,
  // see fabricLifecycleShader), so it binds a one-instance dummy parked at
  // the filler height with zero colour — enough for LineSegmentsGeometry's
  // plumbing to stay well-formed, and nothing for three to upload.
  const stockSegments = lifecycle ? 1 : maxSegments;
  const positions = new Float32Array(stockSegments * 6);
  const colors = new Float32Array(stockSegments * 6);
  if (lifecycle) {
    positions[1] = FABRIC_SLOT_FILLER_Y;
    positions[4] = FABRIC_SLOT_FILLER_Y;
  }
  // 1, not 0: an instance the emit never reaches draws the material's own
  // width rather than vanishing.
  const widths = taperedWidth
    ? new Float32Array(maxSegments * 2).fill(1)
    : undefined;
  const posBuf = new THREE.InstancedInterleavedBuffer(positions, 6, 1);
  const colBuf = new THREE.InstancedInterleavedBuffer(colors, 6, 1);
  const widthBuf = widths
    ? new THREE.InstancedInterleavedBuffer(widths, 2, 1)
    : undefined;
  posBuf.setUsage(THREE.DynamicDrawUsage);
  colBuf.setUsage(THREE.DynamicDrawUsage);
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
  if (lifecycle) {
    // Render-only, structurally: nothing in the scene raycasts the fabric
    // (r3f only casts at objects with pointer handlers, and the fabric has
    // none), and LineSegments2's own raycast would read the dummy stock
    // lanes. Same rule the trunk pass over this geometry already keeps.
    mesh.raycast = neverRaycast;
  }
  return {
    positions,
    colors,
    widths,
    posBuf,
    colBuf,
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
 * records and the same recall-aperture lanes, and differ only in `linewidth`
 * and their `fabricTrunkPass` uniform. That is
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
  const material = makeFatLineMaterial(widthPx, 'screen', true);
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
  if (layer.count >= fatLineLayerCapacity(layer)) return;
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
  writePositions: boolean,
): void {
  if (layer.count >= fatLineLayerCapacity(layer)) return;
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
  layer.count += 1;
}

export function commitLayer(
  layer: FatLineLayer,
  updatePositions = true,
  updateColors = true,
): void {
  const usedFloats = layer.count * 6;
  layer.posBuf.clearUpdateRanges();
  layer.colBuf.clearUpdateRanges();
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
    // The width lane rides the POSITION gate: a tapered stroke's width is a
    // function of where it is along its own curve, so the two are dirty
    // together and never separately.
    if (updatePositions && layer.widthBuf) {
      layer.widthBuf.addUpdateRange(0, layer.count * 2);
      layer.widthBuf.needsUpdate = true;
    }
  }
  layer.geometry.instanceCount = layer.count;
}

/** Static-record bytes per segment across the three lifecycle buffers — the
 * event flush's upload policy, per segment. */
const FABRIC_LIFECYCLE_BYTES_PER_SEGMENT = FABRIC_LIFECYCLE_UPLOAD_POLICY.bytesPerSlot
  / FABRIC_SLOT_SEGMENTS;

/** The same record minus its colours — what a slot commit actually uploads on
 * a frame the aperture bake already claimed the colour prefix. */
const FABRIC_LIFECYCLE_CURVE_SCALAR_BYTES_PER_SEGMENT =
  FABRIC_LIFECYCLE_CURVE_SCALAR_UPLOAD_POLICY.bytesPerSlot / FABRIC_SLOT_SEGMENTS;

/** Upload only the given SLOT ranges of the static lifecycle records (curve,
 * colors, scalars — aperture has its own recall-window writer). Event-driven:
 * runs when an admit/kill/revival wrote slots, never per animated frame.
 *
 * `colorClaimedByAperture` says the aperture bake already claimed the colour
 * buffer this frame. Its indexed ranges already merge THESE lifecycle slots
 * before marking, so this pass leaves that buffer alone rather than clearing
 * a wider upload than it can re-mark. Each buffer is still
 * cleared-and-marked exactly once per frame; on those frames the colour half
 * simply belongs to the aperture. */
function commitFabricLifecycleSlotRanges(
  layer: FatLineLayer,
  ranges: readonly FabricSlotRange[],
  colorClaimedByAperture = false,
): void {
  const lifecycle = layer.lifecycle;
  if (!lifecycle || ranges.length === 0) return;
  const colorBuf = colorClaimedByAperture ? null : lifecycle.colorBuf;
  lifecycle.curveBuf.clearUpdateRanges();
  colorBuf?.clearUpdateRanges();
  lifecycle.scalarBuf.clearUpdateRanges();
  let rangeSegments = 0;
  // mergeFabricSlotRanges already returns SEGMENT-unit ranges.
  for (const range of ranges) {
    rangeSegments += range.count;
    lifecycle.curveBuf.addUpdateRange(
      range.start * FABRIC_LIFE_CURVE_STRIDE,
      range.count * FABRIC_LIFE_CURVE_STRIDE,
    );
    colorBuf?.addUpdateRange(
      range.start * FABRIC_LIFE_COLOR_STRIDE,
      range.count * FABRIC_LIFE_COLOR_STRIDE,
    );
    lifecycle.scalarBuf.addUpdateRange(
      range.start * FABRIC_LIFE_SCALAR_STRIDE,
      range.count * FABRIC_LIFE_SCALAR_STRIDE,
    );
  }
  lifecycle.curveBuf.needsUpdate = true;
  if (colorBuf) colorBuf.needsUpdate = true;
  lifecycle.scalarBuf.needsUpdate = true;
  layer.geometry.instanceCount = layer.count;
  syncFatLineLayerVisibility(layer);
  fabricStats.observeUpload(
    rangeSegments * (colorClaimedByAperture
      ? FABRIC_LIFECYCLE_CURVE_SCALAR_BYTES_PER_SEGMENT
      : FABRIC_LIFECYCLE_BYTES_PER_SEGMENT),
  );
}

/** Full-population upload of the static records after a compacting walk
 * (boot / slot-space overflow / rare global repaint). */
function commitFabricLifecycleFull(layer: FatLineLayer): void {
  const lifecycle = layer.lifecycle;
  if (!lifecycle) return;
  const segments = layer.count;
  lifecycle.curveBuf.clearUpdateRanges();
  lifecycle.colorBuf.clearUpdateRanges();
  lifecycle.scalarBuf.clearUpdateRanges();
  if (segments > 0) {
    lifecycle.curveBuf.addUpdateRange(0, segments * FABRIC_LIFE_CURVE_STRIDE);
    lifecycle.colorBuf.addUpdateRange(0, segments * FABRIC_LIFE_COLOR_STRIDE);
    lifecycle.scalarBuf.addUpdateRange(0, segments * FABRIC_LIFE_SCALAR_STRIDE);
    lifecycle.curveBuf.needsUpdate = true;
    lifecycle.colorBuf.needsUpdate = true;
    lifecycle.scalarBuf.needsUpdate = true;
  }
  layer.geometry.instanceCount = segments;
  syncFatLineLayerVisibility(layer);
  fabricStats.observeUpload(
    segments * FABRIC_LIFECYCLE_BYTES_PER_SEGMENT,
  );
}

/** Aperture-window upload: recall dims live in the color records' .w lanes
 * (8 floats per segment), so an aperture frame is a colour-only upload.
 *
 * `ranges` are the SEGMENT ranges the bake actually rewrote — indexed curves
 * the union box reaches, slots the previous bake dimmed, plus any slot this
 * frame's event flush wrote. Together those are the only lanes that can differ
 * from what the GPU already holds; release therefore restores the previous
 * dim set rather than the whole populated prefix.
 *
 * Returns whether the colour buffer is now marked, i.e. whether this frame's
 * later commits must keep their hands off it. */
function commitFabricApertureLanes(
  layer: FatLineLayer,
  ranges: readonly FabricSlotRange[],
): boolean {
  const lifecycle = layer.lifecycle;
  if (!lifecycle) return false;
  // Nothing rewritten: claim nothing, so the event flush owns the colour
  // buffer exactly as on a frame with no recall at all.
  if (ranges.length === 0) return false;
  lifecycle.colorBuf.clearUpdateRanges();
  let rangeSegments = 0;
  for (const range of ranges) {
    rangeSegments += range.count;
    lifecycle.colorBuf.addUpdateRange(
      range.start * FABRIC_LIFE_COLOR_STRIDE,
      range.count * FABRIC_LIFE_COLOR_STRIDE,
    );
  }
  lifecycle.colorBuf.needsUpdate = true;
  fabricStats.observeUpload(rangeSegments * 4 * FABRIC_LIFE_COLOR_STRIDE);
  return true;
}

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

  // Every layer starts with nothing committed, so every mesh starts hidden;
  // the commit that first publishes a count is the one that shows it.
  const fabric = useMemo(
    () => hiddenUntilCommitted(makeFatLineLayer(
      fabricSegmentAllocation(allocationEdges),
      LIVE.cell.fabricWidth,
      'screen',
      true,
      true, // GPU-parametric lifecycle: static slots, sim-time evaluation
    )),
    [allocationEdges],
  );
  // 中央神经 — the wide rung, over the passive layer's own geometry. Not a
  // sixth allocation: `makeFabricTrunkPass` binds a second material and mesh
  // to `fabric`'s buffers, so the subset costs one draw call and zero bytes.
  const trunk = useMemo(
    () => {
      const pass = makeFabricTrunkPass(
        fabric,
        fabricTrunkLineWidth(LIVE.cell.fabricWidth, 1),
      );
      pass.mesh.visible = fabric.mesh.visible;
      return pass;
    },
    [fabric],
  );
  // The reinforcement overlay stays at the MESH rung on purpose: it carries
  // observed traffic, not hierarchy, and the two are separate readings. On a
  // promoted edge it draws as a warm core inside the wider resting stroke —
  // traffic ON a trunk — which is the right picture and costs no third
  // material.
  const warmRoutes = useMemo(
    () => hiddenUntilCommitted(makeFatLineLayer(
      warmSegmentAllocation(allocationEdges),
      LIVE.cell.fabricWidth,
      'screen',
    )),
    [allocationEdges],
  );
  const active = useMemo(
    () => hiddenUntilCommitted(
      makeFatLineLayer(MAX_ACTIVE_SEGMENTS, LIVE.cell.activeWidth, 'additive'),
    ),
    [],
  );
  const memory = useMemo(
    () => hiddenUntilCommitted(
      makeFatLineLayer(MAX_MEMORY_SEGMENTS, LIVE.cell.activeWidth, 'additive'),
    ),
    [],
  );
  const routeHopPulse = useMemo(
    () => hiddenUntilCommitted(makeFatLineLayer(
      MAX_ROUTE_HOP_PULSE_SEGMENTS,
      LIVE.cell.activeWidth * ROUTE_HOP_PULSE_WIDTH_SCALE,
      'additive',
    )),
    [],
  );
  // True per-draw GPU timings. Empty instanced passes do not enter the timer
  // stream, and the wrapper preserves LineSegments2's own uniform-sync hook.
  // Unsupported contexts stay empty; there is no CPU wall-time substitute.
  const nerveGpuProbes = useMemo(() => ({
    passiveBase: createNonEmptyInstanceGpuProbeCallbacks(
      fabric.mesh,
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.passiveFabricBase),
    ),
    passiveTrunk: createNonEmptyInstanceGpuProbeCallbacks(
      trunk.mesh,
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.passiveFabricTrunk),
    ),
    active: createNonEmptyInstanceGpuProbeCallbacks(
      active.mesh,
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.activeRoute),
    ),
    memory: createNonEmptyInstanceGpuProbeCallbacks(
      memory.mesh,
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.memoryRoute),
    ),
  }), [fabric, trunk, active, memory]);

  // (focus, width) value gate: the raw-frame reassertion below runs every
  // frame, but its outputs are pure functions of these two numbers, which
  // settle whenever the camera is idle and the width knob is untouched.
  const lastViewWeightRef = useRef({
    focus: Number.NaN,
    width: Number.NaN,
    twig: Number.NaN,
  });
  const applyPassiveViewWeight = useCallback(() => {
    const focus = cellDetailViewFocusRef?.current ?? 0;
    const width = LIVE.cell.fabricWidth;
    // ⟨D-10 · knob a⟩ In the value gate with the other two, so a live drag on
    // the knob reaches the material on the next frame rather than on the next
    // camera move.
    const twig = LIVE.cell.fabricTwigOverview;
    const last = lastViewWeightRef.current;
    if (last.focus === focus && last.width === width && last.twig === twig) return;
    last.focus = focus;
    last.width = width;
    last.twig = twig;
    const energyGain = cellDetailFabricEnergyGain(focus);
    const widthScale = cellDetailFabricWidthScale(focus);
    // ⟨D-10 · knob a⟩ THE MESH TIER ALONE SPENDS LIGHT AT THE OVERVIEW.
    // Report D measured the core's orientation coherence at 0.164 against a
    // 0.111 noise floor — the trunk:twig step cannot be read when the twigs
    // tile the ellipse — and WIDTH is already at its ceiling under the pulse,
    // so energy is the free channel. The trunks keep `energyGain` untouched at
    // every camera: the tier that carries the structure is never the one that
    // dims. Default 1 → this is exactly `energyGain`.
    const twigGain = energyGain * fabricTwigViewEnergy(twig, focus);
    fabric.material.color.setRGB(twigGain, twigGain, twigGain);
    warmRoutes.material.color.setRGB(twigGain, twigGain, twigGain);
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
  /** `lo → hi → state`, the same states under numeric keys, for the one
   * per-hop-per-frame reader (`pushActiveHop`'s curve lookup). Written
   * wherever `edgeStatesRef` is written: admission, live growth, and the
   * two reap paths. Persistent for the same reason the map is. */
  const edgeIndexRef = useRef<FabricEdgeIndex<EdgeState>>(new Map());
  /** Only edges with positive usage live here. Reinforcement updates this
   * sparse set without dirtying the complete passive-fabric prefix. */
  const warmRouteKeysRef = useRef<Set<string>>(new Set());
  /** Warm-set moves since the last warm commit: a reinforce that admitted a
   * NEW key, or a walk that dropped a settled one. The overlay is packed in
   * iteration order, so any move relocates segments and the position lane has
   * to go up with the colours; a pure decay leaves every endpoint where it
   * was. Starts armed so the first populated commit uploads both. */
  const warmMembershipMovedRef = useRef(true);
  /** Sim second of the last warm upload. Inside the deep decay tail the
   * overlay commits at WARM_TAIL_COMMIT_INTERVAL_S rather than per frame. */
  const warmCommittedSecRef = useRef(Number.NEGATIVE_INFINITY);
  /** True when there's pending work to emit: either the edge map
   *  was just mutated by `setFabric`, or at least one edge is in
   *  growth/decay and its appearance changes per frame. Flipped
   *  off after a final emit settles everything into stable state. */
  const emitDirtyRef = useRef<boolean>(false);
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
  /** What the previous COMPLETED bake read, so a frame whose recall state is
   *  identical can conclude its own output would be too. `dimmed` is the
   *  load-bearing member: false means that bake wrote the flat 1.0 baseline
   *  into every slot it visited, which is what lets a later quiet frame skip. */
  const apertureBakedRef = useRef({
    active: null as ConsensusMemoryAperture | null,
    activeStrength: 0,
    departing: null as ConsensusMemoryAperture | null,
    departingStrength: 0,
    dimmed: false,
  });
  /** Slots the previous bake actually dimmed. A slot outside the union box
   *  holds the flat baseline, so only these can need writing BACK — which is
   *  what lets a dimming frame upload the box's neighbourhood instead of the
   *  whole colour prefix. Persistent like `apertureBakedRef`: the effect
   *  below is rebuilt on a quality change while the buffers are not. */
  const apertureDimmedSlotsRef = useRef<Set<number>>(new Set());

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
    // Reused across both edge-emit loops (full build + growEdges); its colours
    // are copied straight into each EdgeState, so one scratch serves all edges.
    const routeColorsScratch = makeConsensusRouteColorsScratch();
    const activeCurve: ResolvedActiveHopCurve = {
      fromX: 0, fromY: 0, fromZ: 0,
      ctrlX: 0, ctrlY: 0, ctrlZ: 0,
      toX: 0, toY: 0, toZ: 0,
    };

    const fabricSlotCapacity = Math.floor(
      fatLineLayerCapacity(fabric) / FABRIC_SLOT_SEGMENTS,
    );
    const edgeIndex = edgeIndexRef.current;
    /** Stable-slot spatial index for recall aperture frames. It is rebuilt
     * from the persistent maps when this effect is recreated (for example on
     * a quality change), then maintained incrementally with slot ownership. */
    const apertureIndex = new RecallApertureIndex();
    const indexApertureSlot = (key: string, st: EdgeState): void => {
      const slot = slotByKeyRef.current.get(key);
      if (slot === undefined) return;
      apertureIndex.upsert(slot, key, st);
    };
    for (const [key, slot] of slotByKeyRef.current) {
      const st = edgeStatesRef.current.get(key);
      if (st) apertureIndex.upsert(slot, key, st);
    }

    // ——— GPU-parametric lifecycle plumbing (P1.7) ———
    const lifecycleArrays = fabric.lifecycle!.arrays;
    /** Slots whose static record changed since the last emit → ranged upload. */
    const lifeDirtySlots: number[] = [];
    /** One bake's outputs: the slots whose aperture lanes it rewrote, and the
     * subset it left dimmed. Reused across frames like the scratch buffers. */
    const apertureDirtySlots: number[] = [];
    const apertureDimmedNow: number[] = [];
    const apertureCandidates: RecallApertureIndexEntry[] = [];
    const apertureCandidateSlots = new Set<number>();
    const apertureUnionBounds: RecallApertureQueryBounds = {
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
    };
    /** Sample and write one indexed slot. Defined once per handle lifetime so
     * the animation path does not allocate a closure per frame. */
    const bakeApertureSlot = (
      entry: RecallApertureIndexEntry,
      reaches: boolean,
      recallAperture: RecallApertureState,
      now: number,
      dimmedSlots: ReadonlySet<number>,
    ): void => {
      const { key, slot } = entry;
      // Slot ownership changes only on event paths, which maintain the index
      // synchronously. Keep this guard nevertheless: a stale candidate must
      // never write a recycled edge's record.
      if (slotByKeyRef.current.get(key) !== slot) return;
      const st = edgeStatesRef.current.get(key);
      if (!st) return;
      const baseSegment = slot * FABRIC_SLOT_SEGMENTS;
      const wasDimmed = dimmedSlots.has(slot);
      let prevScale = reaches
        ? recallApertureScaleAt(recallAperture, st.fromX, st.fromZ, 0, now)
        : 1;
      let dimmed = prevScale < 1;
      for (let seg = 0; seg < FABRIC_SLOT_SEGMENTS; seg += 1) {
        let endScale = 1;
        if (reaches) {
          bezierAtInto(
            sample,
            st.fromX, st.fromY, st.fromZ,
            st.ctrlX, st.ctrlY, st.ctrlZ,
            st.toX, st.toY, st.toZ,
            (seg + 1) / FABRIC_SLOT_SEGMENTS,
          );
          endScale = recallApertureScaleAt(
            recallAperture, sample[0], sample[2], 0, now,
          );
          if (endScale < 1) dimmed = true;
        }
        const offset = (baseSegment + seg) * FABRIC_LIFE_COLOR_STRIDE;
        lifecycleArrays.color[
          offset + FABRIC_LIFE_APERTURE_START_OFFSET
        ] = prevScale;
        lifecycleArrays.color[
          offset + FABRIC_LIFE_APERTURE_END_OFFSET
        ] = endScale;
        prevScale = endScale;
      }
      if (dimmed) apertureDimmedNow.push(slot);
      // A reached slot that came out flat, and was flat before, wrote the
      // baseline over the baseline — no upload owed.
      if (dimmed || wasDimmed) apertureDirtySlots.push(slot);
    };
    /** Re-bake the current aperture through the spatial index. A normal
     * incremental frame restores slots dimmed by the previous bake; a full
     * walk passes `restorePrevious=false` because its static-record rewrite
     * has already reset every surviving lane to the 1.0 baseline and numeric
     * slots may now belong to different edges. */
    const bakeIndexedAperture = (
      recallAperture: RecallApertureState,
      now: number,
      activeDimming: boolean,
      departingDimming: boolean,
      restorePrevious: boolean,
    ): void => {
      const dimmedSlots = apertureDimmedSlotsRef.current;
      if (!restorePrevious) dimmedSlots.clear();
      apertureDirtySlots.length = 0;
      apertureDimmedNow.length = 0;
      apertureCandidateSlots.clear();

      // The dim is a bounded disc around one route inside a field ~4× wider,
      // so query the live fields' union rather than scanning passive edges.
      let boxMinX = Infinity;
      let boxMaxX = -Infinity;
      let boxMinZ = Infinity;
      let boxMaxZ = -Infinity;
      const activeBounds = activeDimming
        ? consensusMemoryApertureBounds(recallAperture.active)
        : null;
      if (activeBounds) {
        boxMinX = activeBounds.minX;
        boxMaxX = activeBounds.maxX;
        boxMinZ = activeBounds.minZ;
        boxMaxZ = activeBounds.maxZ;
      }
      const departingBounds = departingDimming
        ? consensusMemoryApertureBounds(recallAperture.departing)
        : null;
      if (departingBounds) {
        if (departingBounds.minX < boxMinX) boxMinX = departingBounds.minX;
        if (departingBounds.maxX > boxMaxX) boxMaxX = departingBounds.maxX;
        if (departingBounds.minZ < boxMinZ) boxMinZ = departingBounds.minZ;
        if (departingBounds.maxZ > boxMaxZ) boxMaxZ = departingBounds.maxZ;
      }
      if (boxMinX <= boxMaxX && boxMinZ <= boxMaxZ) {
        apertureUnionBounds.minX = boxMinX;
        apertureUnionBounds.maxX = boxMaxX;
        apertureUnionBounds.minZ = boxMinZ;
        apertureUnionBounds.maxZ = boxMaxZ;
        apertureIndex.query(apertureUnionBounds, apertureCandidates);
      } else {
        apertureCandidates.length = 0;
      }

      for (const entry of apertureCandidates) {
        apertureCandidateSlots.add(entry.slot);
        bakeApertureSlot(entry, true, recallAperture, now, dimmedSlots);
      }
      if (restorePrevious) {
        // A release or moving union owes work only to slots the previous bake
        // actually left below 1.0. A full walk needs no restore: every record
        // was just rewritten to baseline before this indexed pass.
        for (const slot of dimmedSlots) {
          if (apertureCandidateSlots.has(slot)) continue;
          const entry = apertureIndex.get(slot);
          if (entry) {
            bakeApertureSlot(entry, false, recallAperture, now, dimmedSlots);
          }
        }
      }
      dimmedSlots.clear();
      for (const slot of apertureDimmedNow) dimmedSlots.add(slot);
    };
    const completeApertureBake = (
      recallAperture: RecallApertureState,
    ): void => {
      const baked = apertureBakedRef.current;
      baked.active = recallAperture.active;
      baked.activeStrength = recallAperture.activeStrength;
      baked.departing = recallAperture.departing;
      baked.departingStrength = recallAperture.departingStrength;
      baked.dimmed = apertureDimmedSlotsRef.current.size > 0;
    };
    /** One warm walk's surviving members and their render state, so the
     * presentation pass never re-derives what the bookkeeping pass read.
     * The render records are a pool indexed like the keys — one scratch per
     * draw slot, written in place every frame, never reallocated. */
    const warmDrawKeys: string[] = [];
    const warmRenderPool: EdgeRender[] = [];
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
      onReap: (key, reaped) => {
        fabricEdgeIndexDelete(edgeIndex, reaped.fromCellId, reaped.toCellId);
        const removed = apertureIndex.removeKey(key);
        if (removed) apertureDimmedSlotsRef.current.delete(removed.slot);
        renderOrderTombstonesRef.current += 1;
        fabricStats.observeReapInPlace();
      },
    };
    /** Materialise the lazy order only at its existing cleanup/full-walk
     * boundaries. This removes tombstones and same-key re-entry duplicates,
     * fills any state omitted by an unslotted admission, and makes the clip
     * contract explicit: current form always precedes fading afterimages. */
    const canonicalizeRenderOrder = (): void => {
      renderOrderRef.current = canonicalizeFabricRenderOrder(
        renderOrderRef.current,
        edgeStatesRef.current,
      );
      renderOrderTombstonesRef.current = 0;
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
        canonicalizeRenderOrder();
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
    /** Recover an existing state that survived a capacity clip without a slot.
     * A recycled hole is enough for an incremental repair; if none exists the
     * caller arms a current-first compacting walk. */
    const recoverExistingFabricSlot = (
      key: string,
      st: EdgeState,
    ): boolean => {
      if (slotByKeyRef.current.has(key)) {
        writeLifecycleSlot(key, st);
        return true;
      }
      if (allocateFabricSlot(key) === undefined) return false;
      indexApertureSlot(key, st);
      writeLifecycleSlot(key, st);
      return true;
    };

    /** Resolve and publish the width tier for a completed passive selection.
     * O(arbor edges) plus one typed-array sort, on the rebuild path only —
     * never per frame; the shader re-reads the uniform, it does not re-run
     * the selection. Both materials take the SAME threshold: that identity is
     * the partition, and with it each edge's summed light across the two
     * passes is exactly 1.0× of what it draws today. */
    const applyTrunkTier = (graph: PassiveSelection): void => {
      const tier = fabricTrunkTier(graph.edges);
      fabricStats.trunkTierEdges = tier.edges;
      fabricStats.trunkTierThreshold = tier.threshold;
      fabricStats.weightedSelectionEdges = tier.weighted;
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
      const routeColors = consensusRouteColorsInto(seed, routeColorsScratch);
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
      fabricEdgeIndexSet(edgeIndex, state.fromCellId, state.toCellId, state);
      // One static-record write; the shader grows it from bornAt onward.
      if (slotted) {
        indexApertureSlot(key, state);
        writeLifecycleSlot(key, state);
      }
      return slotted ? 'slotted' : 'unslotted';
    };

    const handles: NeuralFabricHandles = {
      setTrunkTier(graph) {
        applyTrunkTier(graph);
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
        let existingSlotOwnershipChanged = false;
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
            const revived = existing.dyingAt !== null;
            if (revived) {
              existing.dyingAt = null;
              existing.deathKind = null;
              existing.deadEnd = null;
              existing.bornAt = now - GROWTH_MS / 1000;
              statsRevived += 1;
            } else {
              statsStable += 1;
            }
            if (!slotByKeyRef.current.has(key)) {
              existingSlotOwnershipChanged = true;
              if (!recoverExistingFabricSlot(key, existing)) overflowed = true;
            } else if (revived) {
              // One static-record rewrite snaps the slot back to stable.
              writeLifecycleSlot(key, existing);
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
        // The boot record's nerve-growth deadline: a first population from an
        // empty set is THE boot cohort — admitted in one pass just above, all
        // bornAt=now, fully grown one GROWTH_MS later. Later builds are the
        // organism living (block churn, a cold server's minutes of curated
        // refill) and must not stretch the boot readout; the gate is inert
        // once the line closes, and this report is scoped to keep it so.
        if (!wasPopulated && statsAdded > 0) {
          reportBootNerveGrowth(now + GROWTH_MS / 1000);
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
          && !existingSlotOwnershipChanged
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
            // One static-record rewrite snaps a slotted edge back to stable;
            // a previously clipped state first claims a recycled hole. If the
            // allocation is still full, the canonical full walk below promotes
            // every live state ahead of afterimages.
            if (!recoverExistingFabricSlot(key, existing)) growOverflowed = true;
            continue;
          }
          const a = cells.get(e.from);
          const c = cells.get(e.to);
          if (!a || !c) continue;
          statsAdded += 1;
          if (allocateFabricSlot(key) === undefined) growOverflowed = true;
          const seed = fabricEdgeSeed(e.from, e.to);
          const routeColors = consensusRouteColorsInto(seed, routeColorsScratch);
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
          fabricEdgeIndexSet(edgeIndex, grown.fromCellId, grown.toCellId, grown);
          indexApertureSlot(key, grown);
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
        if (st.usage > 0 && !warmRouteKeysRef.current.has(key)) {
          // A new member appends segments to the packed overlay; re-warming
          // one already in it moves no endpoint anywhere.
          warmRouteKeysRef.current.add(key);
          warmMembershipMovedRef.current = true;
        }
      },
      collectLiveEdgeKeys() {
        const keys: string[] = [];
        for (const [key, st] of edgeStatesRef.current) {
          if (st.dyingAt === null) keys.push(key);
        }
        return keys;
      },
      emitFabric(now) {
        const emitProbe = beginCpuProbe(
          PERFORMANCE_PROBE_LABELS.neuralFabricEmit,
        );
        // The fabric animates entirely on the GPU: these scalars (the sim
        // clock, the two fabric knobs, the block-impact flush knobs) are its
        // complete per-frame cost, and they must advance even on frames the
        // CPU otherwise skips. The flush's slot lanes cost nothing here: they
        // are the tissueFlush singleton's arrays, bound by reference.
        syncFabricLifecycleUniforms(fabric.material, now);
        // The wide pass animates from the same scalars; a few uniform writes
        // a frame is the whole CPU cost of the second draw.
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
          canonicalizeRenderOrder();
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
        const recallAperture = recallApertureRef.current;
        // Recall apertures are the one lifecycle input the CPU still owns
        // (spatial-hash segment queries can't move to the vertex stage).
        // While a recall holds or releases, bake the aperture scale at the
        // indexed STATIC curves its union bounds can reach (flash = 0 — the
        // shader lifts). The previous bake's genuinely dimmed slots join that
        // candidate set so moving/releasing the aperture restores them once.
        const apertureActive = recallAperture.activeStrength > 0.001
          || recallAperture.departingStrength > 0.001;
        // Most of a hold is a plateau: the recall is up, the trace clock has
        // left both fields' temporal windows, and the bake grinds the whole
        // population into the same answer it ground last frame. Two facts end
        // that. First, a field whose window `now` sits outside contributes
        // zero temporal strength at EVERY point — before its start nothing has
        // opened, after its end everything has collapsed — so the bake's
        // output degenerates to a flat 1.0 for every slot, present or future.
        // Second, the only other writer of these lanes is the slot-record
        // writer, and it writes exactly that same 1.0. So when neither field
        // can dim and the last bake could not either, every slot already holds
        // what a bake would write — including slots admitted, revived or
        // compacted since, which is why churn does not force a re-bake.
        //
        // Asked per field, the way recallApertureScaleAt dispatches: zero
        // strength returns 1 whatever the geometry, a closed window returns 1
        // whatever the strength. A resting fabric never reaches the question.
        const activeApertureDimming = apertureActive
          && recallAperture.activeStrength > 0
          && consensusMemoryApertureAnimating(recallAperture.active, now);
        const departingApertureDimming = apertureActive
          && recallAperture.departingStrength > 0
          && consensusMemoryApertureAnimating(recallAperture.departing, now);
        const apertureDimming = activeApertureDimming
          || departingApertureDimming;
        const baked = apertureBakedRef.current;
        // The identity/strength half is not needed for the proof above; it is
        // a freshness rule, so the frame a recall's state actually moves
        // always re-evaluates instead of trusting a whole-history argument.
        const apertureBakeSettled = !apertureDimming
          && !baked.dimmed
          && baked.active === recallAperture.active
          && baked.departing === recallAperture.departing
          && baked.activeStrength === recallAperture.activeStrength
          && baked.departingStrength === recallAperture.departingStrength;
        /** The colour buffer is the one lane two commits can reach in a single
         *  frame: the bake below and the event flush further down. The bake
         *  goes first, and whatever it marks it owns for the rest of the frame
         *  — a recall holding through a block's admit/kill burst is the
         *  ordinary case, not a corner, so a dimming bake folds the flush's own
         *  slots into its ranges rather than leaving two mark sets on one
         *  buffer. A frame that skips the bake, or that rewrites nothing,
         *  claims nothing, and the flush owns the colour buffer again exactly
         *  as on any non-recall frame. */
        let apertureClaimedColorBuffer = false;
        const apertureBakeDeferredToFullWalk =
          passivePositionsDirtyRef.current || globalRepaintRef.current;
        if (
          (apertureActive || apertureAnimationRef.current)
          && !apertureBakeSettled
          && !apertureBakeDeferredToFullWalk
        ) {
          const recallApertureProbe = beginCpuProbe(
            PERFORMANCE_PROBE_LABELS.recallAperture,
          );
          bakeIndexedAperture(
            recallAperture,
            now,
            activeApertureDimming,
            departingApertureDimming,
            true,
          );
          fabric.count = usedSlotCountRef.current * FABRIC_SLOT_SEGMENTS;
          // The event flush marks curve and scalar at slot resolution and
          // would mark colour there too; folding its slots in here is what
          // keeps the colour buffer to ONE mark set for the frame.
          for (const slot of lifeDirtySlots) apertureDirtySlots.push(slot);
          // Colour records only, every frame of a recall: the cheapest lane,
          // so its policy bridges the widest parked gaps (see fabricSlots).
          apertureClaimedColorBuffer = commitFabricApertureLanes(
            fabric,
            mergeFabricSlotRanges(apertureDirtySlots, FABRIC_APERTURE_UPLOAD_POLICY),
          );
          completeApertureBake(recallAperture);
          endCpuProbe(recallApertureProbe);
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
          // Bookkeeping pass. Decay is a property of elapsed time and runs
          // ahead of every gate below — what a frame chooses to upload is
          // presentation, and presentation may never move the simulation.
          warmDrawKeys.length = 0;
          let warmEndpointsMoved = false;
          let warmPeakUsage = 0;
          for (const key of warmRouteKeys) {
            const st = states.get(key);
            if (!st) {
              warmRouteKeys.delete(key);
              warmMembershipMovedRef.current = true;
              continue;
            }
            st.usage = decayUsage(
              st.usage,
              dt,
              LIVE.cell.reinforceHalfLife,
            );
            if (st.usage <= 0) {
              warmRouteKeys.delete(key);
              warmMembershipMovedRef.current = true;
              continue;
            }
            // The record for the draw slot this key would take; a key that
            // drops out below leaves it for the next key to overwrite.
            const renderSlot = warmDrawKeys.length;
            if (renderSlot >= warmRenderPool.length) {
              warmRenderPool.push(makeEdgeRenderScratch());
            }
            const render = fabricEdgeRenderStateInto(
              warmRenderPool[renderSlot],
              st,
              now,
            );
            if (render.reap) {
              st.usage = 0;
              warmRouteKeys.delete(key);
              warmMembershipMovedRef.current = true;
              continue;
            }
            // Endpoints are sampled across [tStart, tEnd], and that interval
            // moves only while a tendril extends or a dead end retracts. A gc
            // fade and a stable edge both draw the full span, frame after
            // frame, from the same nine snapshotted numbers.
            if (render.animating && (render.tStart > 0 || render.tEnd < 1)) {
              warmEndpointsMoved = true;
            }
            if (st.usage > warmPeakUsage) warmPeakUsage = st.usage;
            warmDrawKeys.push(key);
          }
          const warmSinceCommit = now - warmCommittedSecRef.current;
          // Deep tail: every member is faint enough that a frame's colour
          // delta is under the display's own quantization, nothing has moved,
          // and the buffer already holds a coherent frame. Leave count and
          // every mark exactly where they are.
          const warmQuiet = warmPeakUsage > 0
            && warmPeakUsage < WARM_TAIL_USAGE
            && !warmMembershipMovedRef.current
            && !warmEndpointsMoved
            && warmSinceCommit >= 0
            && warmSinceCommit < WARM_TAIL_COMMIT_INTERVAL_S;
          if (!warmQuiet) {
            warmRoutes.count = 0;
            for (let i = 0; i < warmDrawKeys.length; i += 1) {
              const st = states.get(warmDrawKeys[i]);
              if (!st) continue;
              writeFabricEdgeSegments(
                warmRoutes,
                st,
                warmRenderPool[i],
                sample,
                now,
                st.usage,
                warmRouteBrightnessGain(
                  st.usage,
                  LIVE.cell.reinforceGain,
                ),
                recallAperture,
              );
            }
            // Colours ride usage and change every frame while anything decays;
            // positions do not. The third reading catches a layout change
            // neither of the first two explains — a live gain knob taken to
            // zero drops every stroke out of the packed prefix.
            const warmPositionsMoved = warmMembershipMovedRef.current
              || warmEndpointsMoved
              || warmRoutes.count !== warmRoutes.geometry.instanceCount;
            commitLayer(warmRoutes, warmPositionsMoved, true);
            syncFatLineLayerVisibility(warmRoutes);
            fabricStats.observeUpload(fabricUploadBytes(warmRoutes.count, {
              positions: warmPositionsMoved,
              colors: true,
            }));
            warmMembershipMovedRef.current = false;
            warmCommittedSecRef.current = now;
          }
        }

        if (!emitDirtyRef.current) {
          fabricStats.observeSkipFrame();
          endCpuProbe(emitProbe);
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
            // Three static buffers a range (two when the bake owns colour):
            // 384 B a slot, so a parked gap is worth bridging only while it
            // stays under the calls it saves — the policy carries the number.
            commitFabricLifecycleSlotRanges(
              fabric,
              mergeFabricSlotRanges(
                lifeDirtySlots,
                apertureClaimedColorBuffer
                  ? FABRIC_LIFECYCLE_CURVE_SCALAR_UPLOAD_POLICY
                  : FABRIC_LIFECYCLE_UPLOAD_POLICY,
              ),
              apertureClaimedColorBuffer,
            );
            // The wide pass draws this same geometry: same count, same state.
            trunk.mesh.visible = fabric.mesh.visible;
            fabricStats.observeIncrementalFrame(lifeDirtySlots.length, 0);
            lifeDirtySlots.length = 0;
          }
          emitDirtyRef.current = false;
          endCpuProbe(emitProbe);
          return;
        }

        // Full walk: compacting structural change (slot-space overflow /
        // boot) or a rare global repaint. Rewrites every static record into
        // freshly assigned slots.
        const fullWalkReason: FabricFullWalkReason = passivePositionsDirtyRef.current
          ? 'structural'
          : 'global-repaint';
        canonicalizeRenderOrder();
        const slots = slotByKeyRef.current;
        slots.clear();
        apertureIndex.clear();
        const slotCapacity = fabricSlotCapacity;
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
          // The slot writer resets the aperture lanes to the 1.0 baseline.
          // After every new slot is indexed, the post-walk pass below applies
          // the current recall to this final layout before the full upload.
          slots.set(key, slotIndex);
          apertureIndex.upsert(slotIndex, key, st);
          slotIndex += 1;
        }
        usedSlotCountRef.current = slotIndex;
        fabric.count = slotIndex * FABRIC_SLOT_SEGMENTS;
        lifeDirtySlots.length = 0; // superseded by the full upload below

        if (toReap) {
          for (const key of toReap) {
            const reaped = states.get(key);
            if (reaped) {
              fabricEdgeIndexDelete(edgeIndex, reaped.fromCellId, reaped.toCellId);
            }
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
        // The rewrite established a baseline in the NEW compacted layout.
        // Re-bake a live aperture through the NEW index before the full colour
        // upload claims the prefix. Release/no-recall keeps that baseline
        // directly. There is deliberately no partial aperture commit here:
        // it would clear or replace the full upload's ownership.
        apertureDimmedSlotsRef.current.clear();
        if (apertureDimming) {
          const recallApertureProbe = beginCpuProbe(
            PERFORMANCE_PROBE_LABELS.recallAperture,
          );
          bakeIndexedAperture(
            recallAperture,
            now,
            activeApertureDimming,
            departingApertureDimming,
            false,
          );
          endCpuProbe(recallApertureProbe);
        }
        completeApertureBake(recallAperture);

        commitFabricLifecycleFull(fabric);
        trunk.mesh.visible = fabric.mesh.visible;
        globalRepaintRef.current = false;
        passivePositionsDirtyRef.current = false;
        emitDirtyRef.current = false;
        fabricStats.observeFullWalk(fullWalkReason, slotIndex, 0);
        endCpuProbe(emitProbe);
      },
      pushActiveHop(hop, cells) {
        const layer = hop.mode === 'memory'
          ? memory
          : hop.mode === 'lock'
            ? routeHopPulse
            : active;
        const layerCapacity = fatLineLayerCapacity(layer);
        // Once a per-frame layer is saturated, later low-priority trails must
        // not continue doing Cell lookups and Bezier sampling for data that
        // pushSegment would discard.
        if (layer.count >= layerCapacity) return;
        // Ordinary route hops reuse the passive edge's snapshotted quadratic
        // exactly, avoiding two Cell lookups and one control-point derive per
        // active pulse per frame. A by-value ghost override must remain its own
        // geometry, and an edge outside the passive selection follows the
        // historical Cell lookup + seeded-control fallback. The lookup goes
        // through the numeric index (edgeIndexRef mirrors edgeStatesRef): this
        // is the one reader that runs per hop per frame, and a key string
        // built here was the hop path's whole remaining garbage.
        if (!resolveActiveHopCurveInto(
          activeCurve,
          ctrl,
          hop,
          cells,
          edgeIndex,
        )) return;
        // Walk the hop's Bezier in N+1 sample points; for each pair
        // of consecutive samples emit one sub-segment. Per-segment
        // brightness peaks at the wavefront (frontT) and decays
        // exponentially behind it; segments AHEAD of the wavefront
        // are skipped entirely so the lit region grows smoothly.
        const direction = hop.direction ?? 1;
        const samplesPerHop = hop.mode === 'lock'
          ? ROUTE_HOP_PULSE_SAMPLES_PER_HOP
          : activeSamplesPerHop;
        let prevX = direction === 1 ? activeCurve.fromX : activeCurve.toX;
        let prevY = direction === 1 ? activeCurve.fromY : activeCurve.toY;
        let prevZ = direction === 1 ? activeCurve.fromZ : activeCurve.toZ;
        for (let i = 1; i <= samplesPerHop; i++) {
          if (layer.count >= layerCapacity) break;
          const travelT = i / samplesPerHop;
          const curveT = direction === 1 ? travelT : 1 - travelT;
          bezierAtInto(
            sample,
            activeCurve.fromX, activeCurve.fromY, activeCurve.fromZ,
            activeCurve.ctrlX, activeCurve.ctrlY, activeCurve.ctrlZ,
            activeCurve.toX, activeCurve.toY, activeCurve.toZ,
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
        syncFatLineLayerVisibility(active);
        syncFatLineLayerVisibility(memory);
        active.count = 0;
        memory.count = 0;
      },
      flushRouteHopPulse() {
        if (
          routeHopPulse.count === 0
          && routeHopPulse.geometry.instanceCount === 0
        ) return;
        commitLayer(routeHopPulse);
        syncFatLineLayerVisibility(routeHopPulse);
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
      <primitive object={fabric.mesh} {...nerveGpuProbes.passiveBase} />
      {/* 中央神经: the same records, drawn wide, over the top decile of the
          arbor. Immediately after the mesh pass because the two are one
          picture split by width — never a second copy of the same edge. */}
      <primitive object={trunk.mesh} {...nerveGpuProbes.passiveTrunk} />
      <primitive object={warmRoutes.mesh} />
      <primitive object={active.mesh} {...nerveGpuProbes.active} />
      <primitive object={memory.mesh} {...nerveGpuProbes.memory} />
      <primitive object={routeHopPulse.mesh} />
    </>
  );
}
