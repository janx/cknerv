// Persistent renderer for the spatial consensus graph + separate per-frame
// layers for live writes, explicitly recalled historical routes, and the
// bounded optical acknowledgement of one click-locked route Cell.
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

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import type { NeighborGraph, NeighborEdge } from '../geometry/neighborGraph';
import { bezierAtInto, bezierControlInto, fabricEdgeSeed } from '../geometry/edgeBezier';
import { fabricEdgeKey, orderFabricStateKeys } from './fabricOrder';
import { FABRIC_SAMPLES_PER_EDGE, MAX_FABRIC_SEGMENTS } from './fabricCapacity';
import {
  fabricEdgeRenderState,
  GROWTH_MS,
  type DeathKind,
} from './fabricEdgeRender';
import { reinforceUsage, decayUsage, usageBrightnessBoost } from './fabricReinforce';
import { passiveFabricEnergyScale } from './fabricLuminance';
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
  cellInspectionFieldTransitionScaleAt,
  type CellInspectionField,
} from './cellInspectionField';

// Dense-mesh baseline energy (the `cell.fabricAlpha` tweak, default 0.12).
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
/** One lock response can touch at most two route edges. */
const ROUTE_HOP_PULSE_SAMPLES_PER_HOP = 24;
const MAX_ROUTE_HOP_PULSE_SEGMENTS = ROUTE_HOP_PULSE_SAMPLES_PER_HOP * 2;
const ROUTE_HOP_PULSE_WIDTH_SCALE = 1.3;

// Line widths in px (now the `cell.fabricWidth` / `cell.activeWidth`
// tweaks, defaults 2.5 / 3.4): visibly substantial crisp lines that read
// against post-bloom cells, the fabric staying clearly thinner than the
// active wavefront. Read live — `LIVE.cell.fabricWidth/activeWidth` seed
// the layers at build time (useMemo below). Historical recall scales only its
// own material from the same active-width baseline.

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
}

export interface NeuralFabricProps {
  onReady: (handles: NeuralFabricHandles) => void;
}

interface FatLineLayer {
  positions: Float32Array;
  colors: Float32Array;
  posBuf: THREE.InstancedInterleavedBuffer;
  colBuf: THREE.InstancedInterleavedBuffer;
  geometry: LineSegmentsGeometry;
  material: LineMaterial;
  mesh: LineSegments2;
  count: number;
}

/** One persistent fabric edge. Endpoint positions + control point
 *  are snapshotted at birth so the edge can keep rendering after
 *  its endpoint cell has been GC'd (dying phase). `bornAt` drives
 *  the growth window; `dyingAt` (when non-null) drives decay. The
 *  two phases are mutually exclusive — at any moment an edge is in
 *  growing (`dyingAt === null`, age < GROWTH_MS), stable
 *  (`dyingAt === null`, age >= GROWTH_MS), or dying. */
interface EdgeState {
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
  /** Per-edge brightness multiplier in [0.45, 1.0], derived from the
   *  edge's deterministic seed. Stable across the edge's lifetime so
   *  the network has a fixed hierarchy of bright "trunks" and dim
   *  "branches" rather than uniform mesh. */
  brightnessMul: number;
  /** A route transitions between two contributor colours along its length. */
  fromR: number; fromG: number; fromB: number;
  toR: number; toG: number; toB: number;
  /** ② Self-organization: activity weight in [0, USAGE_CAP]. Pulse
   *  traversals bump it (`reinforce`), each frame decays it, and it boosts
   *  the rendered brightness on top of `brightnessMul`. 0 in the resting
   *  state → boost ×1 → byte-identical to ①. */
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

/** Short enough to feel directly attached to selection, long enough that a
 * different Cell's graph-distance hierarchy never pops into existence. */
const INSPECTION_FIELD_TRANSITION_SECONDS = 0.34;

function inspectionFieldScaleAt(
  state: InspectionFieldTransition,
  fromCellId: number,
  toCellId: number,
  edgeT: number,
  lifecycleFlash: number,
): number {
  const fieldScale = cellInspectionFieldTransitionScaleAt(
    state.from,
    state.to,
    state.progress,
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

/** Floor brightness at the midpoint of a fabric edge, as a fraction of
 *  the endpoint brightness. The taper drops smoothly from 1.0 at each
 *  cell down to TAPER_MIN at the shaft midpoint, then back to 1.0 at
 *  the other cell — a parabolic profile that lets each Cell read as a
 *  bright agreement endpoint rather than a uniform vessel. */
const TAPER_MIN = 0.30;

/** Returns the per-vertex brightness multiplier along a fabric edge at
 *  parameter t ∈ [0, 1]. Parabolic in (2t − 1)² so it's exactly
 *  TAPER_MIN at the midpoint and 1.0 at either endpoint, with smooth
 *  rise on both sides. */
function taper(t: number): number {
  const k = 2 * t - 1;
  return TAPER_MIN + (1 - TAPER_MIN) * k * k;
}

/** Floor brightness — twigs / non-forest cross-links sit here. */
const TWIG_MIN = 0.45;

/** Per-edge brightness multiplier ∈ [TWIG_MIN, 1.0], the fabric's trunk/branch
 *  hierarchy. Forest edges scale by their arbor weight `w` (normalized subtree
 *  size), so REAL trunks (carrying many descendants) are bright and REAL twigs
 *  dim — grown venation rather than a uniform web. Non-forest cross-links and
 *  not-yet-weighted incremental edges (`w === undefined`) get a dim textured
 *  band off the deterministic edge seed, reading as faint tissue without faking
 *  trunks. Stable per edge across its lifetime. */
function arborBrightness(w: number | undefined, seed: number): number {
  if (w !== undefined) return TWIG_MIN + (1 - TWIG_MIN) * w;
  return TWIG_MIN + 0.14 * (((seed >>> 16) & 0xff) / 0xff);
}

function makeFatLineLayer(
  maxSegments: number,
  widthPx: number,
  accumulation: 'screen' | 'additive',
): FatLineLayer {
  const positions = new Float32Array(maxSegments * 6);
  const colors = new Float32Array(maxSegments * 6);
  const posBuf = new THREE.InstancedInterleavedBuffer(positions, 6, 1);
  const colBuf = new THREE.InstancedInterleavedBuffer(colors, 6, 1);
  const geometry = new LineSegmentsGeometry();
  geometry.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(posBuf, 3, 0));
  geometry.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(posBuf, 3, 3));
  geometry.setAttribute('instanceColorStart', new THREE.InterleavedBufferAttribute(colBuf, 3, 0));
  geometry.setAttribute('instanceColorEnd', new THREE.InterleavedBufferAttribute(colBuf, 3, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
  geometry.instanceCount = 0;
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
  const mesh = new LineSegments2(geometry, material);
  return { positions, colors, posBuf, colBuf, geometry, material, mesh, count: 0 };
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
): void {
  if (layer.count >= layer.positions.length / 6) return;
  const off = layer.count * 6;
  layer.positions[off + 0] = ax;
  layer.positions[off + 1] = ay;
  layer.positions[off + 2] = az;
  layer.positions[off + 3] = bx;
  layer.positions[off + 4] = by;
  layer.positions[off + 5] = bz;
  layer.colors[off + 0] = rA;
  layer.colors[off + 1] = gA;
  layer.colors[off + 2] = bA;
  layer.colors[off + 3] = rB;
  layer.colors[off + 4] = gB;
  layer.colors[off + 5] = bB;
  layer.count += 1;
}

function commitLayer(layer: FatLineLayer): void {
  layer.posBuf.needsUpdate = true;
  layer.colBuf.needsUpdate = true;
  layer.geometry.instanceCount = layer.count;
}

export default function NeuralFabric({ onReady }: NeuralFabricProps) {
  const simClock = useSimClock();
  const { size } = useThree();
  const { effective: quality } = useQualityRuntime();
  const { activeSamplesPerHop } = QUALITY_PRESETS[quality];

  const fabric = useMemo(
    () => makeFatLineLayer(MAX_FABRIC_SEGMENTS, LIVE.cell.fabricWidth, 'screen'),
    [],
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

  // Persistent across handle re-creations so Canvas remounts and quality-view
  // reconciliation never drop an edge's growth/decay lifecycle state.
  const edgeStatesRef = useRef<Map<string, EdgeState>>(new Map());
  /** True when there's pending work to emit: either the edge map
   *  was just mutated by `setFabric`, or at least one edge is in
   *  growth/decay and its appearance changes per frame. Flipped
   *  off after a final emit settles everything into stable state. */
  const emitDirtyRef = useRef<boolean>(false);
  const renderOrderRef = useRef<string[]>([]);
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
  // Wall/sim-seconds of the previous emitFabric, for the ② usage-decay dt.
  // Advanced every frame (even on early-return) so a redraw resuming after an
  // idle stretch decays by one frame, not the whole idle gap.
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
    active.material.resolution.set(size.width, size.height);
    memory.material.resolution.set(size.width, size.height);
    routeHopPulse.material.resolution.set(size.width, size.height);
  }, [
    size,
    fabric.material,
    active.material,
    memory.material,
    routeHopPulse.material,
  ]);

  useEffect(() => () => {
    fabric.geometry.dispose();
    fabric.material.dispose();
    active.geometry.dispose();
    active.material.dispose();
    memory.geometry.dispose();
    memory.material.dispose();
    routeHopPulse.geometry.dispose();
    routeHopPulse.material.dispose();
  }, [fabric, active, memory, routeHopPulse]);

  useEffect(() => {
    // Reused 3-element scratch buffers — the hot-loop fabric/active
    // sample paths previously allocated a fresh tuple per Bezier
    // evaluation (~75k per rebuild at the full mesh's ~18k edges × 4
    // samples, plus ~400 per frame from active hop sampling).
    const ctrl = new Float32Array(3);
    const sample = new Float32Array(3);

    const handles: NeuralFabricHandles = {
      setInspectionField(field) {
        const transition = inspectionFieldRef.current;
        if (transition.to === field) return;
        transition.from = transition.to;
        transition.to = field;
        transition.progress = 0;
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
        emitDirtyRef.current = true;
      },
      setMemoryRouteWidthScale(scale) {
        const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
        memory.material.linewidth = LIVE.cell.activeWidth * safeScale;
        routeHopPulse.material.linewidth = LIVE.cell.activeWidth
          * ROUTE_HOP_PULSE_WIDTH_SCALE
          * safeScale;
      },
      setFabric(graph, cells, now) {
        const states = edgeStatesRef.current;
        const { order, liveKeys } = orderFabricStateKeys(graph.edges, states.keys());
        renderOrderRef.current = order;
        // Two-pass diff. Pass 1: walk new edges, add fresh ones in
        // growing phase, revive any that were dying. Track seen keys
        // so pass 2 can flag the removed ones.
        for (const e of graph.edges) {
          const key = fabricEdgeKey(e.from, e.to);
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
              existing.bornAt = now - GROWTH_MS / 1000;
            }
            continue;
          }
          const a = cells.get(e.from);
          const c = cells.get(e.to);
          if (!a || !c) continue;
          const seed = fabricEdgeSeed(e.from, e.to);
          const routeColors = consensusRouteColors(seed);
          bezierControlInto(
            ctrl,
            a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
            c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
            seed,
          );
          states.set(key, {
            fromCellId: e.from,
            toCellId: e.to,
            fromX: a.pos_seed[0], fromY: a.pos_seed[1], fromZ: a.pos_seed[2],
            toX: c.pos_seed[0], toY: c.pos_seed[1], toZ: c.pos_seed[2],
            ctrlX: ctrl[0], ctrlY: ctrl[1], ctrlZ: ctrl[2],
            bornAt: now,
            dyingAt: null,
            deathKind: null,
            deadEnd: null,
            growDir: 1,
            brightnessMul: arborBrightness(e.w, seed),
            fromR: routeColors.from[0], fromG: routeColors.from[1], fromB: routeColors.from[2],
            toR: routeColors.to[0], toG: routeColors.to[1], toB: routeColors.to[2],
            usage: 0,
          });
        }
        // Pass 2: any state not in the new graph enters dying phase,
        // tagged 'gc' — a full-length quiet fade. This path is
        // reconciliation / legacy whole-graph corrections, NOT a real
        // chain cell death (those are driven per-edge via killEdges with
        // kind 'death', which retracts + flashes). Idempotent: if it was
        // already dying we keep the original dyingAt/deathKind, so the
        // clock doesn't reset on repeated setFabric calls during the
        // same death window.
        for (const [key, st] of states) {
          if (liveKeys.has(key)) continue;
          if (st.dyingAt === null) { st.dyingAt = now; st.deathKind = 'gc'; }
        }
        emitDirtyRef.current = true;
      },
      growEdges(edges, cells, bornAtByKey, dirByKey) {
        // `now` is read from the shared sim clock so callers don't have
        // to thread it; the driver's bornAtByKey values are absolute
        // sim-seconds against the same clock (a future value staggers).
        const now = simClock.elapsedSec;
        const states = edgeStatesRef.current;
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
            continue;
          }
          const a = cells.get(e.from);
          const c = cells.get(e.to);
          if (!a || !c) continue;
          const seed = fabricEdgeSeed(e.from, e.to);
          const routeColors = consensusRouteColors(seed);
          bezierControlInto(
            ctrl,
            a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
            c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
            seed,
          );
          states.set(key, {
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
            fromR: routeColors.from[0], fromG: routeColors.from[1], fromB: routeColors.from[2],
            toR: routeColors.to[0], toG: routeColors.to[1], toB: routeColors.to[2],
            usage: 0,
          });
          renderOrderRef.current.push(key); // append; emitFabric reaps
        }
        emitDirtyRef.current = true;
      },
      killEdges(keys, dyingAt, kind, deadEndByKey) {
        const states = edgeStatesRef.current;
        for (const key of keys) {
          const st = states.get(key);
          // Skip unknown or already-dying edges — the latter keeps the
          // death clock from resetting if a kill is issued twice.
          if (!st || st.dyingAt !== null) continue;
          st.dyingAt = dyingAt;
          st.deathKind = kind;
          st.deadEnd = kind === 'death' ? (deadEndByKey?.get(key) ?? 'from') : null;
        }
        emitDirtyRef.current = true;
      },
      reinforce(fromCellId, toCellId) {
        const st = edgeStatesRef.current.get(fabricEdgeKey(fromCellId, toCellId));
        if (!st) return;
        st.usage = reinforceUsage(st.usage, LIVE.cell.reinforceAmount);
        emitDirtyRef.current = true;
      },
      emitFabric(now) {
        // ② usage-decay dt, advanced every frame (even when we early-return
        // below) so decay never sees a stale multi-second idle gap.
        const prevEmit = prevEmitSecRef.current;
        const dt = prevEmit === null ? 0 : Math.max(0, now - prevEmit);
        prevEmitSecRef.current = now;
        // Cell-mesh live-tune change-detector. Runs BEFORE the early-
        // return so a knob dragged while the fabric is idle still applies.
        // Purely ADDITIVE: it only ever FORCES a redraw (sets emitDirtyRef
        // true), never suppresses one, so it cannot regress the living-
        // mesh animation. Steady state with no change = six numeric
        // compares, then the existing early-return fires as before.
        const ct = LIVE.cell, lc = lastCellTweakRef.current;
        if (ct.fabricAlpha !== lc.alpha || ct.activeColorR !== lc.r || ct.activeColorG !== lc.g ||
            ct.activeColorB !== lc.b || ct.fabricWidth !== lc.fw || ct.activeWidth !== lc.aw ||
            ct.centerDim !== lc.cd) {
          lc.alpha = ct.fabricAlpha; lc.r = ct.activeColorR; lc.g = ct.activeColorG;
          lc.b = ct.activeColorB; lc.fw = ct.fabricWidth; lc.aw = ct.activeWidth;
          lc.cd = ct.centerDim;
          emitDirtyRef.current = true; // force one redraw with the new values
        }
        const inspectionField = inspectionFieldRef.current;
        if (inspectionField.progress < 1) {
          inspectionField.progress = Math.min(
            1,
            inspectionField.progress
              + dt / INSPECTION_FIELD_TRANSITION_SECONDS,
          );
          emitDirtyRef.current = true;
          if (inspectionField.progress >= 1) {
            inspectionField.from = inspectionField.to;
          }
        }
        const recallAperture = recallApertureRef.current;
        const apertureAnimating = (
          recallAperture.activeStrength > 0.001
          && consensusMemoryApertureAnimating(recallAperture.active, now)
        ) || (
          recallAperture.departingStrength > 0.001
          && consensusMemoryApertureAnimating(recallAperture.departing, now)
        );
        // Temporal masks need fresh passive vertices while their verified
        // wavefront or targetward closure is moving. One final redraw after
        // the interval restores every released fibre to its exact baseline.
        if (apertureAnimating || apertureAnimationRef.current) {
          emitDirtyRef.current = true;
        }
        apertureAnimationRef.current = apertureAnimating;
        if (!emitDirtyRef.current) return;
        // Live line widths. LineMaterial.linewidth is runtime-settable, so
        // pushing it on every real draw (after the early-return) picks up
        // any width-knob change — including on the forced redraw above.
        fabric.material.linewidth = LIVE.cell.fabricWidth;
        active.material.linewidth = LIVE.cell.activeWidth;
        const states = edgeStatesRef.current;
        fabric.count = 0;
        let stillAnimating = 0;
        // Reap list deferred so we don't mutate the map mid-iteration.
        let toReap: string[] | null = null;

        for (const key of renderOrderRef.current) {
          const st = states.get(key);
          if (!st) continue;
          // All lifecycle math (grow tip / gc fade / death retract +
          // flash / future-staggered start) lives in the pure
          // fabricEdgeRenderState. It returns the drawn Bezier interval
          // [tStart, tEnd], the alpha multiplier, a semantic death
          // flash, and reap/animating flags — this loop just draws it.
          const rs = fabricEdgeRenderState(st, now);
          if (rs.reap) { (toReap ??= []).push(key); continue; }
          // ② A vein still warm from recent traffic keeps decaying, and keeps
          // the fabric emitting each frame until it relaxes back to baseline.
          let animating = rs.animating;
          if (st.usage > 0) {
            st.usage = decayUsage(st.usage, dt, LIVE.cell.reinforceHalfLife);
            if (st.usage > 0) animating = true;
          }
          if (animating) stillAnimating += 1;
          if (!rs.visible || rs.alphaMul <= 0) continue;

          // Route energy BEFORE per-vertex taper. Resting routes stay vascular
          // crimson; hierarchy and recent real traffic reclaim gold. Brightness
          // falls toward the middle so Cells remain the agreement anchors. A
          // real Cell death resolves toward the retirement colour, never the
          // pale light reserved for successful agreement.
          // Usage boost multiplies the hierarchy baseline — exactly ×1 when
          // the route is cold.
          const boost = usageBrightnessBoost(st.usage, LIVE.cell.reinforceGain);
          const fl = rs.flash;
          const energy = LIVE.cell.fabricAlpha * rs.alphaMul * st.brightnessMul * boost;
          const hierarchy = Math.max(
            0,
            Math.min(1, (st.brightnessMul - TWIG_MIN) / (1 - TWIG_MIN)),
          );
          const goldMix = consensusRouteGoldMix(hierarchy, st.usage);
          const gold = CONSENSUS_BRAID_PALETTE.gold;
          const retire = CONSENSUS_BRAID_PALETTE.retire;
          const fromSemanticR = (st.fromR + (gold[0] - st.fromR) * goldMix) * (1 - fl) + retire[0] * fl;
          const fromSemanticG = (st.fromG + (gold[1] - st.fromG) * goldMix) * (1 - fl) + retire[1] * fl;
          const fromSemanticB = (st.fromB + (gold[2] - st.fromB) * goldMix) * (1 - fl) + retire[2] * fl;
          const toSemanticR = (st.toR + (gold[0] - st.toR) * goldMix) * (1 - fl) + retire[0] * fl;
          const toSemanticG = (st.toG + (gold[1] - st.toG) * goldMix) * (1 - fl) + retire[1] * fl;
          const toSemanticB = (st.toB + (gold[2] - st.toB) * goldMix) * (1 - fl) + retire[2] * fl;

          // Walk sub-segments uniformly over the drawn interval
          // [tStart, tEnd]. This covers every lifecycle case: stable
          // [0,1], grow-in [0,p] or [1-p,1] (growDir), and death retract
          // (dead end recedes toward the survivor). taper(t) uses the
          // true t so a partial tendril tip near the shaft midpoint is
          // correctly dim.
          const tStart = rs.tStart, tEnd = rs.tEnd;
          bezierAtInto(sample, st.fromX, st.fromY, st.fromZ, st.ctrlX, st.ctrlY, st.ctrlZ, st.toX, st.toY, st.toZ, tStart);
          let prevX = sample[0], prevY = sample[1], prevZ = sample[2];
          const startTaper = taper(tStart);
          const prevSpatial = passiveFabricEnergyScale(
            prevX,
            prevZ,
            hierarchy,
            st.usage,
            fl,
            LIVE.cell.centerDim,
          );
          const prevAperture = recallApertureScaleAt(
            recallAperture,
            prevX,
            prevZ,
            fl,
            now,
          );
          const prevInspection = inspectionFieldScaleAt(
            inspectionField,
            st.fromCellId,
            st.toCellId,
            tStart,
            fl,
          );
          const startEnergy = energy
            * startTaper
            * prevSpatial
            * prevAperture
            * prevInspection;
          let prevR = (fromSemanticR + (toSemanticR - fromSemanticR) * tStart)
            * startEnergy;
          let prevG = (fromSemanticG + (toSemanticG - fromSemanticG) * tStart)
            * startEnergy;
          let prevB = (fromSemanticB + (toSemanticB - fromSemanticB) * tStart)
            * startEnergy;
          for (let i = 1; i <= FABRIC_SAMPLES_PER_EDGE; i++) {
            const tRaw = tStart + (tEnd - tStart) * (i / FABRIC_SAMPLES_PER_EDGE);
            const t = tRaw > tEnd ? tEnd : tRaw;
            bezierAtInto(sample, st.fromX, st.fromY, st.fromZ, st.ctrlX, st.ctrlY, st.ctrlZ, st.toX, st.toY, st.toZ, t);
            const endTaper = taper(t);
            const endSpatial = passiveFabricEnergyScale(
              sample[0],
              sample[2],
              hierarchy,
              st.usage,
              fl,
              LIVE.cell.centerDim,
            );
            const endAperture = recallApertureScaleAt(
              recallAperture,
              sample[0],
              sample[2],
              fl,
              now,
            );
            const endInspection = inspectionFieldScaleAt(
              inspectionField,
              st.fromCellId,
              st.toCellId,
              t,
              fl,
            );
            const endEnergy = energy
              * endTaper
              * endSpatial
              * endAperture
              * endInspection;
            const endR = (fromSemanticR + (toSemanticR - fromSemanticR) * t)
              * endEnergy;
            const endG = (fromSemanticG + (toSemanticG - fromSemanticG) * t)
              * endEnergy;
            const endB = (fromSemanticB + (toSemanticB - fromSemanticB) * t)
              * endEnergy;
            pushSegmentGradient(
              fabric,
              prevX, prevY, prevZ, sample[0], sample[1], sample[2],
              prevR, prevG, prevB,
              endR, endG, endB,
            );
            prevX = sample[0]; prevY = sample[1]; prevZ = sample[2];
            prevR = endR; prevG = endG; prevB = endB;
            if (t >= tEnd) break;
          }
        }

        if (toReap) {
          const reapSet = new Set(toReap);
          for (const key of toReap) states.delete(key);
          renderOrderRef.current = renderOrderRef.current.filter((key) => !reapSet.has(key));
        }

        commitLayer(fabric);
        // Continue emitting next frame while any edge is animating.
        // Once everything's stable, this frame's emit captured the
        // final state — leave the buffer alone until the next diff.
        emitDirtyRef.current = stillAnimating > 0;
      },
      pushActiveHop(hop, cells) {
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
        const layer = hop.mode === 'memory'
          ? memory
          : hop.mode === 'lock'
            ? routeHopPulse
            : active;
        const direction = hop.direction ?? 1;
        const samplesPerHop = hop.mode === 'lock'
          ? ROUTE_HOP_PULSE_SAMPLES_PER_HOP
          : activeSamplesPerHop;
        let prevX = direction === 1 ? a.pos_seed[0] : c.pos_seed[0];
        let prevY = direction === 1 ? a.pos_seed[1] : c.pos_seed[1];
        let prevZ = direction === 1 ? a.pos_seed[2] : c.pos_seed[2];
        for (let i = 1; i <= samplesPerHop; i++) {
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
  }, [
    fabric,
    active,
    memory,
    routeHopPulse,
    onReady,
    activeSamplesPerHop,
  ]);

  return (
    <>
      <primitive object={fabric.mesh} />
      <primitive object={active.mesh} />
      <primitive object={memory.mesh} />
      <primitive object={routeHopPulse.mesh} />
    </>
  );
}
