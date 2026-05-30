// Persistent renderer for the spatial neighbour graph + per-frame
// rebuild for the actively-lit segments along in-progress pulse hops.
//
// Each logical edge is a quadratic Bezier with a perpendicular xz
// offset on the control point (deterministic per edge), so the
// fabric reads as curved organic fibres rather than a wireframe. The
// active layer draws sub-segments of the same curve with a brightness
// gradient — the wavefront end is bright, the wake fades exponentially
// behind it. Both layers share the same Bezier control points so the
// pulse always rides on the visible line.
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
import type { NeighborGraph } from '../geometry/neighborGraph';
import { bezierAtInto, bezierControlInto, fabricEdgeSeed } from '../geometry/edgeBezier';
import { fabricEdgeKey, orderFabricStateKeys } from './fabricOrder';

/** Fabric baseline alpha. Higher than the original 0.20 because the
 *  per-vertex taper now multiplies it by ~0.53 on average (parabolic
 *  profile from TAPER_MIN to 1.0), and per-edge brightness adds
 *  another ~0.73 average multiplier — so without compensation the
 *  network would read dimmer than the un-tapered original. At 0.35
 *  the endpoint hotspots (taper=1.0 × brightnessMul up to 1.0) land
 *  noticeably brighter than the old uniform 0.20, producing visible
 *  "bouton" glow where edges meet cells; midpoints and dim branches
 *  fade into a darker shaft, reading as axon taper. */
const FABRIC_ALPHA = 0.35;
/** Deep crimson with a slight purple shoulder — Eva-flesh /
 *  internal-organ palette. Bloom shifts the halo toward warmer pink
 *  but the base stays unmistakably oxygenated-blood red. */
const FABRIC_COLOR = new THREE.Color(0.48, 0.06, 0.16);

/** Active wavefront colour. LCL amber-orange, the colour synaptic
 *  firing reads as in Eva's berserk-mode anatomical close-ups. Bright
 *  enough to clear the bloom threshold and halo into yellow-white. */
const ACTIVE_COLOR_R = 1.0;
const ACTIVE_COLOR_G = 0.55;
const ACTIVE_COLOR_B = 0.15;

/** Number of sub-segments per fabric edge — gives every fibre a
 *  visible curve at typical zoom. 4 is enough for short edges,
 *  smooth enough for the eye not to pick out the polyline. */
const FABRIC_SAMPLES_PER_EDGE = 4;
/** Number of sub-segments emitted per active hop. Higher = smoother
 *  wavefront, more GPU work per pulse. 12 keeps the brightness
 *  gradient legible. */
const ACTIVE_SAMPLES_PER_HOP = 12;

/** Hard segment caps. ~3000 fabric edges × 4 sub-segments = 12000.
 *  Active: ~12 hops × 12 sub-segments = 144 per pulse, × ~32 active
 *  pulses = 4600. */
const MAX_FABRIC_SEGMENTS = 16000;
const MAX_ACTIVE_SEGMENTS = 6000;

/** 2.5 px — visibly substantial crisp lines that read against
 *  post-bloom cells while staying clearly thinner than the active
 *  wavefront (3.4 px). */
const FABRIC_WIDTH_PX = 2.5;
const ACTIVE_WIDTH_PX = 3.4;

/** Fabric edge growth window. A freshly-added edge takes this long
 *  to reach full length + alpha. Length is linear in progress
 *  (reads as a tendril extending from the source cell); alpha uses
 *  easeOutCubic (fast in, slow finish — looks more biological than
 *  a flat ramp). Tuned to feel like neural projection, not a wipe. */
const GROWTH_MS = 1200;
/** Fabric edge decay window. A removed edge's alpha rolls down
 *  linearly across this interval; the fibre keeps its full length
 *  through decay (retracting reads as "withdrawn", we want
 *  "atrophied"). Slightly longer than GROWTH_MS so deaths feel
 *  weightier than births. */
const DECAY_MS = 1500;

/** Per-frame request to draw one active hop. The renderer samples
 *  the same Bezier the fabric uses, then emits ACTIVE_SAMPLES_PER_HOP
 *  sub-segments with a brightness gradient peaking at `frontT`
 *  (the wavefront's normalised position along this hop). */
export interface ActiveHop {
  fromCellId: number;
  toCellId: number;
  /** Wavefront position in [0, 1] along the hop's Bezier. */
  frontT: number;
  /** Overall brightness multiplier for this hop. Older trail hops
   *  get smaller values so the cascade reads as a fading wake. */
  brightness: number;
}

export interface NeuralFabricHandles {
  /** Push one active hop's worth of curve sub-segments into this
   *  frame's buffer. Driven from the orchestrator's per-frame loop. */
  pushActiveHop(hop: ActiveHop, cells: ReadonlyMap<number, Cell>): void;
  /** Commit the active buffer at end of frame. */
  flushActive(): void;
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
  fromX: number; fromY: number; fromZ: number;
  toX: number; toY: number; toZ: number;
  ctrlX: number; ctrlY: number; ctrlZ: number;
  /** Sim seconds at which this edge entered the growing phase. */
  bornAt: number;
  /** Sim seconds at which this edge entered the dying phase, or
   *  null while alive. */
  dyingAt: number | null;
  /** Per-edge brightness multiplier in [0.45, 1.0], derived from the
   *  edge's deterministic seed. Stable across the edge's lifetime so
   *  the network has a fixed hierarchy of bright "trunks" and dim
   *  "branches" rather than uniform mesh. */
  brightnessMul: number;
}

/** Floor brightness at the midpoint of a fabric edge, as a fraction of
 *  the endpoint brightness. The taper drops smoothly from 1.0 at each
 *  cell down to TAPER_MIN at the shaft midpoint, then back to 1.0 at
 *  the other cell — a parabolic profile that reads as "axon emerging
 *  from cell body, narrowing along its shaft, broadening at the
 *  terminal" rather than a uniform vessel of constant thickness. */
const TAPER_MIN = 0.30;

/** Returns the per-vertex brightness multiplier along a fabric edge at
 *  parameter t ∈ [0, 1]. Parabolic in (2t − 1)² so it's exactly
 *  TAPER_MIN at the midpoint and 1.0 at either endpoint, with smooth
 *  rise on both sides. */
function taper(t: number): number {
  const k = 2 * t - 1;
  return TAPER_MIN + (1 - TAPER_MIN) * k * k;
}

/** Map an edge's deterministic seed onto a per-edge brightness in
 *  [0.45, 1.0]. The high 8 bits of the seed give an even spread; the
 *  result is the same every frame so the network has a stable visual
 *  hierarchy of "main trunks" (near 1.0) and "fine branches" (near
 *  0.45) rather than a uniform mesh. */
function edgeBrightness(seed: number): number {
  const byte = (seed >>> 16) & 0xff;
  return 0.45 + 0.55 * (byte / 0xff);
}

function makeFatLineLayer(maxSegments: number, widthPx: number): FatLineLayer {
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
    blending: THREE.AdditiveBlending,
    worldUnits: false,
    toneMapped: false,
  });
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
 *  by the fabric layer to draw axonal taper: each sub-segment fades
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
  const { size } = useThree();

  const fabric = useMemo(() => makeFatLineLayer(MAX_FABRIC_SEGMENTS, FABRIC_WIDTH_PX), []);
  const active = useMemo(() => makeFatLineLayer(MAX_ACTIVE_SEGMENTS, ACTIVE_WIDTH_PX), []);

  // Persistent across handle re-creations (onReady callback identity
  // changes whenever the orchestrator's cellsCache.cells reference
  // flips, which would otherwise drop our lifecycle state every
  // birth/death delta).
  const edgeStatesRef = useRef<Map<string, EdgeState>>(new Map());
  /** True when there's pending work to emit: either the edge map
   *  was just mutated by `setFabric`, or at least one edge is in
   *  growth/decay and its appearance changes per frame. Flipped
   *  off after a final emit settles everything into stable state. */
  const emitDirtyRef = useRef<boolean>(false);
  const renderOrderRef = useRef<string[]>([]);

  useEffect(() => {
    fabric.material.resolution.set(size.width, size.height);
    active.material.resolution.set(size.width, size.height);
  }, [size, fabric.material, active.material]);

  useEffect(() => () => {
    fabric.geometry.dispose();
    fabric.material.dispose();
    active.geometry.dispose();
    active.material.dispose();
  }, [fabric, active]);

  useEffect(() => {
    // Reused 3-element scratch buffers — the hot-loop fabric/active
    // sample paths previously allocated a fresh tuple per Bezier
    // evaluation (~30k per setFabric call at 6k edges × 5 samples,
    // plus ~400 per frame from active hop sampling).
    const ctrl = new Float32Array(3);
    const sample = new Float32Array(3);

    const handles: NeuralFabricHandles = {
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
          bezierControlInto(
            ctrl,
            a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
            c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
            seed,
          );
          states.set(key, {
            fromX: a.pos_seed[0], fromY: a.pos_seed[1], fromZ: a.pos_seed[2],
            toX: c.pos_seed[0], toY: c.pos_seed[1], toZ: c.pos_seed[2],
            ctrlX: ctrl[0], ctrlY: ctrl[1], ctrlZ: ctrl[2],
            bornAt: now,
            dyingAt: null,
            brightnessMul: edgeBrightness(seed),
          });
        }
        // Pass 2: any state not in the new graph enters dying phase
        // (idempotent — if it was already dying we keep the original
        // dyingAt, so the decay clock doesn't reset on repeated
        // setFabric calls during the same death window).
        for (const [key, st] of states) {
          if (liveKeys.has(key)) continue;
          if (st.dyingAt === null) st.dyingAt = now;
        }
        emitDirtyRef.current = true;
      },
      emitFabric(now) {
        if (!emitDirtyRef.current) return;
        const states = edgeStatesRef.current;
        fabric.count = 0;
        let stillAnimating = 0;
        // Reap list deferred so we don't mutate the map mid-iteration.
        let toReap: string[] | null = null;

        for (const key of renderOrderRef.current) {
          const st = states.get(key);
          if (!st) continue;
          let alphaMul = 1;
          let lengthFront = 1;

          if (st.dyingAt !== null) {
            const decayMs = (now - st.dyingAt) * 1000;
            if (decayMs >= DECAY_MS) {
              (toReap ??= []).push(key);
              continue;
            }
            alphaMul = 1 - decayMs / DECAY_MS;
            stillAnimating += 1;
          } else {
            const growthMs = (now - st.bornAt) * 1000;
            if (growthMs < GROWTH_MS) {
              const p = growthMs / GROWTH_MS;
              // easeOutCubic on alpha — fast in, slow finish reads
              // more biological than a flat ramp. Length is linear
              // so the tendril's leading edge moves at constant
              // visual speed.
              const u = 1 - p;
              alphaMul = 1 - u * u * u;
              lengthFront = p;
              stillAnimating += 1;
            }
            // else: stable, defaults of 1/1 apply.
          }

          if (alphaMul <= 0) continue;

          // Base colour BEFORE per-vertex taper. We modulate this with
          // taper(t) at each sub-segment endpoint so the line gradients
          // from "bright at cell terminals" to "dim at shaft midpoint"
          // — visual mimic of axon tapering / synaptic boutons.
          const baseR = FABRIC_COLOR.r * FABRIC_ALPHA * alphaMul * st.brightnessMul;
          const baseG = FABRIC_COLOR.g * FABRIC_ALPHA * alphaMul * st.brightnessMul;
          const baseB = FABRIC_COLOR.b * FABRIC_ALPHA * alphaMul * st.brightnessMul;

          // Walk sub-segments. When `lengthFront < 1`, stop at the
          // last whole-or-partial segment that fits — the partial
          // tip segment uses `lengthFront` as its t, which keeps the
          // tendril ending at a clean point on the Bezier rather
          // than snapping forward in 1/N increments.
          let prevX = st.fromX, prevY = st.fromY, prevZ = st.fromZ;
          let prevTaper = taper(0); // start of edge at t=0 → endpoint glow
          for (let i = 1; i <= FABRIC_SAMPLES_PER_EDGE; i++) {
            const tFull = i / FABRIC_SAMPLES_PER_EDGE;
            const tPrev = (i - 1) / FABRIC_SAMPLES_PER_EDGE;
            if (tPrev >= lengthFront) break;
            const t = tFull <= lengthFront ? tFull : lengthFront;
            bezierAtInto(
              sample,
              st.fromX, st.fromY, st.fromZ,
              st.ctrlX, st.ctrlY, st.ctrlZ,
              st.toX, st.toY, st.toZ,
              t,
            );
            // During growth (lengthFront < 1) the tip is a partial t
            // value; its taper should reflect that actual t, not the
            // sample index, so a freshly-extending tendril is dim if
            // its front happens to be near the midpoint.
            const endTaper = taper(t);
            pushSegmentGradient(
              fabric,
              prevX, prevY, prevZ, sample[0], sample[1], sample[2],
              baseR * prevTaper, baseG * prevTaper, baseB * prevTaper,
              baseR * endTaper, baseG * endTaper, baseB * endTaper,
            );
            prevX = sample[0]; prevY = sample[1]; prevZ = sample[2];
            prevTaper = endTaper;
            if (t >= lengthFront) break;
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
        let prevX = a.pos_seed[0], prevY = a.pos_seed[1], prevZ = a.pos_seed[2];
        for (let i = 1; i <= ACTIVE_SAMPLES_PER_HOP; i++) {
          const t = i / ACTIVE_SAMPLES_PER_HOP;
          bezierAtInto(
            sample,
            a.pos_seed[0], a.pos_seed[1], a.pos_seed[2],
            ctrl[0], ctrl[1], ctrl[2],
            c.pos_seed[0], c.pos_seed[1], c.pos_seed[2],
            t,
          );
          // Mid-t of this sub-segment.
          const tMid = (t + (i - 1) / ACTIVE_SAMPLES_PER_HOP) * 0.5;
          if (tMid <= hop.frontT) {
            const distBehind = hop.frontT - tMid;
            // Sharper decay = tighter wavefront. 7.5 makes the lit
            // band extend roughly 0.4 of one hop behind the front,
            // which reads as a definite wave rather than a static line.
            const tail = Math.exp(-distBehind * 7.5);
            const intensity = hop.brightness * tail;
            const r = ACTIVE_COLOR_R * intensity;
            const g = ACTIVE_COLOR_G * intensity;
            const b = ACTIVE_COLOR_B * intensity;
            pushSegment(active, prevX, prevY, prevZ, sample[0], sample[1], sample[2], r, g, b);
          }
          prevX = sample[0]; prevY = sample[1]; prevZ = sample[2];
        }
      },
      flushActive() {
        commitLayer(active);
        active.count = 0;
      },
    };
    onReady(handles);
  }, [fabric, active, onReady]);

  return (
    <>
      <primitive object={fabric.mesh} />
      <primitive object={active.mesh} />
    </>
  );
}
