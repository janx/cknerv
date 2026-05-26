import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, RenderTexture } from '@react-three/drei';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import type { Cell } from '@cknerv/types';
import {
  hashToBytes,
  seedGrid,
  stepGrid,
  stepInterval,
  population,
  GRID_SIZE,
  type Grid,
} from '../cellLife/gameOfLife';
import {
  CELL,
  makeShapeGeometry,
  makeEdgeGeometry,
  pickShapeIndex,
} from '../materials/cellLifeWall';
import {
  CRIMSON,
  LCL,
  makeMembraneMaterial,
  makeEdgeMaterial,
} from '../materials/cellLifeDetail3DMaterial';
import type { ScanStateRef } from '../ui/scanState';

const SENTINEL_PAST = -1e9;
const SENTINEL_FUTURE = 1e9;
/** Reused per-frame to compute edge color (tinted lerp toward white)
 *  without allocating a fresh THREE.Color in each cell's loop body. */
const EDGE_COLOR_SCRATCH = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const RESET_GENERATION_CAP = 250;
const STAGNATION_HISTORY_K = 16;      // window of past grid signatures to detect short-period cycles
const ROTATION_RAD_PER_S = 0.15;      // slowed from 0.25 so the scan reads cleanly
const BIRTH_DUR_S = 0.45;             // slower, more deliberate birth animation
const BIRTH_OVERSHOOT = 1.45;         // bigger pop at birth peak
const BIRTH_FLASH_PEAK = 3.0;         // emissive flash peak during birth
const DEATH_DUR_S = 0.40;             // slower death animation
const DEATH_FLASH_PEAK = 3.5;         // emissive flash peak at death
const DEATH_PUFF_SCALE = 1.15;        // brief outward expansion before collapse
const STEP_PULSE_DUR_S = 0.15;        // heartbeat pulse duration after GoL step
const STEP_PULSE_PEAK = 0.6;          // max emissive boost during step heartbeat
const CHEBY_MAX = 1;                  // cluster neighborhood radius (8-neighbor)

// World-locked horizontal scan plane: a thin amber strip + soft halo
// that sweeps top→bottom through the wall (snap-back at bottom),
// giving the viewport its "scanning instrument" feel. Lives OUTSIDE
// the rotating group so the polyhedra rotate through it (the plane
// stays world-aligned).
export const WORLD = GRID_SIZE * CELL;     // visible wall extent in scene units
export const SCAN_PERIOD_S = 5.0;          // top→bottom sweep period; cursor in HUD reads same phase
const SCAN_Y_TOP = WORLD / 2 - 0.2;
const SCAN_Y_BOT = -(WORLD / 2 - 0.2);
const SCAN_BEAM_COLOR = 0xffd68a;    // amber-cream — beam core
const SCAN_HALO_COLOR = 0xff8c26;    // LCL amber — halo
const SCAN_TOUCH_REACH = CELL * 0.30; // world units: cells within this band latch a flash on scan crossing
const SCAN_TOUCH_EMISSIVE = 2.5;      // peak flash emissive boost at scan crossing
const SCAN_TOUCH_FADE_S = 0.5;        // linear fade duration of the per-cell flash
const SCAN_TOUCH_OPACITY_CAP = 0.95;  // was 0.55 — needs to be ABOVE the 0.60 alive baseline so flash boost reads as brightening, not dimming
// Continuous proximity glow: cells within this radius of the beam's Y get a
// smooth (1 - dy/reach)² emissive boost ON TOP OF the sharp flashBoost when
// the beam crosses. Without this, alive cells read as binary "off / flash".
const SCAN_PROXIMITY_REACH = CELL * 0.6;
const SCAN_PROXIMITY_PEAK = 1.0;
// Post-scan trail: a recently-scanned alive cell holds residual brightness
// past the 0.5s flash so the beam's path stays readable for ~1.5s.
const SCAN_TRAIL_LIFE_S = 1.5;
const SCAN_TRAIL_PEAK = 0.6;
// Wrap fade: smooth the beam out in the last WRAP_OUT_FRAC of the cycle and
// fade it back in over the first WRAP_IN_FRAC. Eliminates the visible
// teleport from bottom to top at each period boundary.
const SCAN_WRAP_OUT_FRAC = 0.08;
const SCAN_WRAP_IN_FRAC = 0.05;
// Beam plane dimensions. The plane is taller than the visible band because
// the gradient texture's alpha drops to ~0 at the edges — the visible beam
// width is ~0.25-0.30 world units.
const SCAN_BEAM_PLANE_H = 0.50;
const SCAN_HALO_PLANE_H = 1.0;

interface CellLifeDetail3DProps {
  cell: Cell;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional ref the sub-scene fills with the latest GoL state so a
   *  sibling HUD overlay can poll it (~10 Hz) without re-rendering R3F. */
  scanStateRef?: MutableRefObject<ScanStateRef | null>;
}

/**
 * 3D Life viewport for the cell detail panel.
 *
 * Renders a rotating wall of 64 polyhedra (one per CKB grid cell). Each
 * alive cell shows a translucent membrane polyhedron + bright wireframe
 * + a small solid emissive nucleus at 42% scale (gives a clear focal
 * point inside the shell). Cluster tinting (BFS over the 8-neighbor
 * ring) hue-shifts each connected component around CRIMSON / LCL
 * amber. A world-locked amber scan plane sweeps top→bottom (with
 * snap-back) through the wall for the "scanning instrument" feel; cells
 * the beam crosses flash bright and fade over 0.5s. A faint amber grid
 * sits behind the viewport as a subtle coordinate-reference backdrop.
 *
 * The sub-scene lives behind drei's <RenderTexture> so it composites
 * over the topology scene as a flat plane in HUD ortho space. An
 * optional `scanStateRef` is filled with the latest GoL grid +
 * generation so a sibling HUD overlay can render chrome + readouts.
 */
export default function CellLifeDetail3D({ cell, x, y, width, height, scanStateRef }: CellLifeDetail3DProps) {
  const gridTex = useMemo(() => makeGridTexture(), []);
  useEffect(() => () => gridTex.dispose(), [gridTex]);
  // Tile the texture so squares stay ~24 px regardless of viewport size.
  // The canvas is 256 px wide with 8 lines (every 32 px) → 8 squares per
  // repeat. We want ~24 px per square, so repeats = width / (8 * 24) =
  // width / 192.
  useMemo(() => {
    gridTex.repeat.set(width / 192, height / 192);
  }, [gridTex, width, height]);

  return (
    <group>
      {/* Grid backdrop — behind the RenderTexture display. Effective
          alpha (texture stroke ~0.22 × material opacity 0.55) ≈ 0.12 so
          the grid reads as a subtle coordinate reference, not a focal
          element. The SubScene clears transparent so the grid shows
          through in empty areas around the wall + away from the beam. */}
      <mesh position={[x + width / 2, y - height / 2, -0.5]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          map={gridTex}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      {/* RenderTexture display — front layer.
          The explicit width/height (2× viewport size, for DPR
          crispness) is required so the fat-line LineMaterial in the
          SubScene can be told the exact pixel size of the render
          target. Without explicit width/height, drei defaults to
          1024×1024 which would mismatch the per-cell LineMaterial
          `resolution` we pass in, producing inconsistent line widths. */}
      <mesh position={[x + width / 2, y - height / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent>
          <RenderTexture
            attach="map"
            anisotropy={1}
            width={Math.round(width * 2)}
            height={Math.round(height * 2)}
          >
            <SubScene
              cell={cell}
              aspect={width / height}
              renderTargetWidth={Math.round(width * 2)}
              renderTargetHeight={Math.round(height * 2)}
              scanStateRef={scanStateRef}
            />
          </RenderTexture>
        </meshBasicMaterial>
      </mesh>
    </group>
  );
}

/** Procedurally-generated grid texture for the scan viewport backdrop.
 *  256×256 canvas with 1px amber strokes every 32 texels (8 squares per
 *  tile). The caller tiles via `texture.repeat` so squares stay roughly
 *  uniform across viewport sizes. */
function makeGridTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255, 140, 38, 0.22)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(size, i + 0.5); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Compact string signature of a grid for cycle detection.
 *  Cells are 0/1/2 (dead / crimson-alive / LCL-alive), so concatenating
 *  the bytes as ASCII digits yields a unique fixed-length key per state. */
function gridSignature(grid: Grid): string {
  let s = '';
  for (let i = 0; i < grid.length; i++) s += grid[i];
  return s;
}

/** Centered world-space position for grid cell index i. */
function gridPos(i: number): { x: number; y: number } {
  const r = Math.floor(i / GRID_SIZE);
  const c = i % GRID_SIZE;
  return {
    x: (c - (GRID_SIZE - 1) / 2) * CELL,
    y: ((GRID_SIZE - 1) / 2 - r) * CELL,
  };
}

/** BFS connected-component labelling over alive cells at Chebyshev
 *  neighborhood `maxCheby`. Returns an array cid where cid[i] = -1 for
 *  dead cells, otherwise a 0-based cluster id. */
function findClusters(grid: Grid, maxCheby: number): Int16Array {
  const N = grid.length;
  const cid = new Int16Array(N).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (grid[s] === 0 || cid[s] !== -1) continue;
    stack.push(s);
    cid[s] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / GRID_SIZE);
      const c = i % GRID_SIZE;
      for (let dr = -maxCheby; dr <= maxCheby; dr++) {
        for (let dc = -maxCheby; dc <= maxCheby; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
          const ni = nr * GRID_SIZE + nc;
          if (grid[ni] > 0 && cid[ni] === -1) {
            cid[ni] = next;
            stack.push(ni);
          }
        }
      }
    }
    next++;
  }
  return cid;
}

/** Hue-shift the base color for a cluster id within the crimson/amber
 *  band. Returns a fresh THREE.Color. */
const HUE_OFFSETS = [0, 0.025, -0.025, 0.05, -0.05, 0.075, -0.075];
function clusterTint(clusterId: number, baseColor: THREE.Color): THREE.Color {
  if (clusterId < 0) return baseColor.clone();
  const off = HUE_OFFSETS[clusterId % HUE_OFFSETS.length];
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  hsl.h = (hsl.h + off + 1) % 1;
  hsl.l = Math.max(
    0.25,
    Math.min(0.70, hsl.l + ((clusterId * 0.03) % 0.08 - 0.04)),
  );
  const c = new THREE.Color();
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

interface CellEntry {
  group: THREE.Group;
  membrane: THREE.Mesh;
  edges: LineSegments2;
  /** Small solid inner shape that gives each alive cell a focal nucleus
   *  inside the translucent membrane shell. Color tracks tintedColor. */
  nucleus: THREE.Mesh;
  membraneMat: THREE.MeshStandardMaterial;
  edgeMat: LineMaterial;
  nucleusMat: THREE.MeshBasicMaterial;
  /** Grid row (0..GRID_SIZE-1). Stored so the scan-crossing check is
   *  O(1) per cell instead of recomputing from the flat index. */
  row: number;
  // Mutable per-frame state.
  isAlive: boolean;
  baseColor: THREE.Color;
  tintedColor: THREE.Color;
  bornAt: number;
  deathAt: number;
  clusterId: number;
  /** Timestamp (seconds, performance.now()/1000) at which this cell
   *  was last crossed by the scan beam. Drives a SCAN_TOUCH_FADE_S
   *  linear flash boost on top of the alive emissive. */
  flashAt: number;
}

/** Build a 1×N gaussian gradient DataTexture for the scan beam.
 *
 *  The beam plane uses an additive material with this texture as its `map`,
 *  giving a smooth bright-center → transparent-edge falloff rather than the
 *  hard rectangular edges of a flat-colored plane. Texture is 1 pixel wide
 *  (we only need vertical variation) and 64 tall; LinearFilter smooths the
 *  ramp so the beam reads as a soft band of light.
 *
 *  The gaussian σ is tuned to 3.5 (vs. the mockup's harsher 4.0) so the
 *  visible band is wider and feels more natural than a sharp blade. */
function makeBeamGradientTexture(color: THREE.Color): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * 4);
  const r = (color.r * 255) | 0;
  const g = (color.g * 255) | 0;
  const b = (color.b * 255) | 0;
  for (let i = 0; i < size; i++) {
    const norm = (i - size / 2) / (size / 2);  // -1..1
    const alpha = Math.exp(-norm * norm * 3.5);
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = (alpha * 255) | 0;
  }
  const tex = new THREE.DataTexture(data, 1, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Smooth out → in envelope at the period wrap so the beam doesn't visibly
 *  teleport from bottom to top each cycle. `phase` is the normalized cycle
 *  position 0..1; returns a 0..1 alpha multiplier. */
function beamAlphaForPhase(phase: number): number {
  if (phase > 1 - SCAN_WRAP_OUT_FRAC) {
    return Math.max(0, (1 - phase) / SCAN_WRAP_OUT_FRAC);
  }
  if (phase < SCAN_WRAP_IN_FRAC) {
    return phase / SCAN_WRAP_IN_FRAC;
  }
  return 1.0;
}

function SubScene({
  cell,
  aspect,
  renderTargetWidth,
  renderTargetHeight,
  scanStateRef,
}: {
  cell: Cell;
  aspect: number;
  renderTargetWidth: number;
  renderTargetHeight: number;
  scanStateRef?: MutableRefObject<ScanStateRef | null>;
}) {
  const bytes = useMemo(() => hashToBytes(cell.content_hash), [cell.content_hash]);
  const isDual = cell.tag !== null;
  const interval = useMemo(() => stepInterval(bytes), [bytes]);
  const shapeIdx = useMemo(() => pickShapeIndex(bytes), [bytes]);

  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Shared geometry: one polyhedron geo + its edge geo, used by all 64 cells.
  const shapeGeo = useMemo(() => makeShapeGeometry(shapeIdx), [shapeIdx]);
  useEffect(() => () => shapeGeo.dispose(), [shapeGeo]);
  const edgeGeo = useMemo(() => makeEdgeGeometry(shapeGeo), [shapeGeo]);
  useEffect(() => () => edgeGeo.dispose(), [edgeGeo]);

  // Fat-line wireframe geometry: built once from the EdgesGeometry.
  // Every cell's LineSegments2 reuses this same instance — the geometry
  // is immutable across cells (identical shape), only the per-cell
  // LineMaterial differs (color + opacity vary). The flat position
  // array is copied into a fresh Float32Array so this geometry's
  // lifecycle is decoupled from edgeGeo's dispose-on-unmount.
  const lineSegGeo = useMemo(() => {
    const g = new LineSegmentsGeometry();
    const positions = edgeGeo.attributes.position.array as ArrayLike<number>;
    g.setPositions(Float32Array.from(positions));
    return g;
  }, [edgeGeo]);
  useEffect(() => () => lineSegGeo.dispose(), [lineSegGeo]);

  // Source-of-truth resolution vector for every cell's LineMaterial.
  // LineMaterial's `resolution` setter does a `.copy()` internally — it
  // does NOT hold a reference to the caller's Vector2 — so to broadcast
  // a viewport-size change we have to walk every cell's material and
  // re-assign. The vector itself is intentionally stable across renders
  // (so we can `.set()` then propagate) instead of being rebuilt.
  const resolutionVec2 = useMemo(
    () => new THREE.Vector2(renderTargetWidth, renderTargetHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const groupRef = useRef<THREE.Group>(null);
  const cellsRef = useRef<CellEntry[]>([]);
  const gridRef = useRef<Grid>(new Uint8Array(GRID_SIZE * GRID_SIZE));
  const generationRef = useRef(0);
  const gridHistoryRef = useRef<string[]>([]);
  const scanPlaneRef = useRef<THREE.Mesh>(null);
  const scanHaloRef = useRef<THREE.Mesh>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  // Wall-clock timestamp (s, performance.now()/1000) of the last GoL
  // step. Drives a brief global emissive heartbeat across all alive
  // cells so the stepping cadence is felt as a rhythm.
  const stepPulseAt = useRef<number>(SENTINEL_PAST);

  // Beam gradient texture: built once, disposed on unmount. The color
  // is baked into the texture's RGB channel and never changes — only
  // material.opacity is modulated per frame (wrap fade + soft pulse).
  const beamTex = useMemo(
    () => makeBeamGradientTexture(new THREE.Color(SCAN_BEAM_COLOR)),
    [],
  );
  useEffect(() => () => beamTex.dispose(), [beamTex]);

  // Drei's <PerspectiveCamera manual> defaults to aspect=1 and does not
  // auto-track the render target's dimensions. We feed it width/height
  // from the parent and rebuild the projection matrix imperatively
  // whenever aspect changes so the 1:1 wall stays square inside a
  // rectangular viewport (empty side bands instead of horizontal stretch).
  useEffect(() => {
    const cam = cameraRef.current;
    if (!(cam instanceof THREE.PerspectiveCamera)) return;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }, [aspect]);

  // Build the 64 cell entries once per (shapeGeo, edgeGeo) tuple.
  // Mounts them into groupRef on the next effect.
  const cellCount = GRID_SIZE * GRID_SIZE;
  const entries = useMemo(() => {
    const cells: CellEntry[] = [];
    for (let i = 0; i < cellCount; i++) {
      const { x: gx, y: gy } = gridPos(i);
      const membraneMat = makeMembraneMaterial();
      const membrane = new THREE.Mesh(shapeGeo, membraneMat);
      const edgeMat = makeEdgeMaterial(resolutionVec2);
      const edges = new LineSegments2(lineSegGeo, edgeMat);
      // LineSegments2 inherits from Mesh; computeLineDistances is a
      // no-op for non-dashed materials but the LineMaterial API expects
      // it to have been called at least once so the dash uniform is
      // initialised. Cheap insurance.
      edges.computeLineDistances();
      // Inner nucleus: same shared shape geometry, scaled to 42% of the
      // membrane so each alive cell reads as "outer translucent shell +
      // solid emissive core" — much more dimensional than a single shell.
      const nucleusMat = new THREE.MeshBasicMaterial({
        color: CRIMSON.clone(),
        transparent: true,
        opacity: 0.95,
      });
      const nucleus = new THREE.Mesh(shapeGeo, nucleusMat);
      nucleus.scale.setScalar(0.42);
      nucleus.visible = false;
      const group = new THREE.Group();
      group.add(membrane);
      group.add(edges);
      group.add(nucleus);
      group.position.set(gx, gy, 0);
      cells.push({
        group,
        membrane,
        edges,
        nucleus,
        membraneMat,
        edgeMat,
        nucleusMat,
        row: Math.floor(i / GRID_SIZE),
        isAlive: false,
        baseColor: CRIMSON.clone(),
        tintedColor: CRIMSON.clone(),
        bornAt: SENTINEL_PAST,
        deathAt: SENTINEL_FUTURE,
        clusterId: -1,
        flashAt: SENTINEL_PAST,
      });
    }
    return { cells };
    // resolutionVec2 is stable (constructed once, mutated in place) so
    // omitting it from deps is intentional — we don't want to rebuild
    // all 64 cells just because the parent viewport resized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeGeo, edgeGeo, lineSegGeo, cellCount]);

  // Stash entries in refs so useFrame / interval callbacks see the live arrays.
  cellsRef.current = entries.cells;

  // Dispose per-cell materials on entry replacement / unmount.
  useEffect(() => {
    const { cells } = entries;
    return () => {
      for (const c of cells) {
        c.membraneMat.dispose();
        c.edgeMat.dispose();
        c.nucleusMat.dispose();
      }
    };
  }, [entries]);

  // Broadcast the current render-target size to every cell's edge
  // material. LineMaterial's `resolution` setter copies into its own
  // internal uniform rather than holding a reference, so propagation
  // has to be explicit: update the source vector, then push the value
  // into each live material. Runs on mount (after entries are built)
  // and on every viewport-size change.
  useEffect(() => {
    resolutionVec2.set(renderTargetWidth, renderTargetHeight);
    for (const c of entries.cells) {
      c.edgeMat.resolution.copy(resolutionVec2);
    }
  }, [entries, renderTargetWidth, renderTargetHeight, resolutionVec2]);

  // Seed + apply initial state whenever bytes / isDual change.
  useEffect(() => {
    const initial = seedGrid(bytes, isDual);
    gridRef.current = initial.slice();
    generationRef.current = 0;
    gridHistoryRef.current = [gridSignature(initial)];
    applySeed(initial, cellsRef.current);
    // Publish initial snapshot for the HUD overlay (if any) to render
    // POP / GEN immediately on mount rather than starting at 0/0.
    if (scanStateRef) {
      scanStateRef.current = { grid: gridRef.current, generation: 0 };
    }
  }, [bytes, isDual, scanStateRef]);

  // GoL stepper interval. Gated by prefers-reduced-motion.
  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => {
      const cells = cellsRef.current;
      const grid = gridRef.current;
      const next = stepGrid(grid);
      const now = performance.now() / 1000;
      const nextCid = findClusters(next, CHEBY_MAX);
      for (let i = 0; i < next.length; i++) {
        const was = grid[i] > 0;
        const is = next[i] > 0;
        const c = cells[i];
        if (is && !was) {
          c.bornAt = now;
          const base = next[i] === 2 ? LCL : CRIMSON;
          c.baseColor = base.clone();
        }
        if (is) {
          const base = next[i] === 2 ? LCL : CRIMSON;
          c.tintedColor = clusterTint(nextCid[i], base);
          c.clusterId = nextCid[i];
        }
        if (!is && was) c.deathAt = now;
        c.isAlive = is;
      }
      gridRef.current = next;
      generationRef.current++;
      // Trigger the heartbeat pulse — all alive cells get a brief
      // emissive boost decaying over STEP_PULSE_DUR_S, communicating
      // the stepping cadence as a global rhythm.
      stepPulseAt.current = now;
      // Stagnation = the new grid matches any of the last K signatures,
      // catching still lifes (period 1) and short oscillators (period
      // ≤ K). Push first, then test inclusion among prior entries.
      const sig = gridSignature(next);
      const stagnated = gridHistoryRef.current.includes(sig);
      gridHistoryRef.current.push(sig);
      if (gridHistoryRef.current.length > STAGNATION_HISTORY_K) {
        gridHistoryRef.current.shift();
      }
      if (
        population(next) === 0 ||
        generationRef.current > RESET_GENERATION_CAP ||
        stagnated
      ) {
        const reseed = seedGrid(bytes, isDual);
        gridRef.current = reseed;
        generationRef.current = 0;
        // Clear history then prime with the fresh seed so the very next
        // step has a baseline to compare against (and the just-flagged
        // stagnated signature can't immediately re-trigger).
        gridHistoryRef.current = [gridSignature(reseed)];
        applySeed(reseed, cellsRef.current);
      }
      // Republish state so a sibling HUD overlay sees the new grid +
      // generation on its next poll tick (≤ 100 ms latency).
      if (scanStateRef) {
        scanStateRef.current = {
          grid: gridRef.current,
          generation: generationRef.current,
        };
      }
    }, interval);
    return () => window.clearInterval(id);
  }, [bytes, isDual, interval, reducedMotion, scanStateRef]);

  // Env map baked from a HemisphereLight tinted CRIMSON↔amber so the
  // membrane's transmission refracts into the palette, not blue. Done
  // once on mount; wired onto the scene via the same useThree+effect
  // pattern as the prior cube-wall implementation.
  const { gl, scene } = useThree();
  const envTex = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0a0f18);
    envScene.add(new THREE.HemisphereLight(0x9e1933, 0xff8c26, 1.0));
    const tex = pmrem.fromScene(envScene).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);
  useEffect(() => () => envTex.dispose(), [envTex]);

  useEffect(() => {
    const prev = scene.environment;
    scene.environment = envTex;
    return () => { scene.environment = prev; };
  }, [scene, envTex]);

  // Per-frame: rotate the group; drive per-cell scale/emissive/opacity
  // from birth/death ramps; sync nucleus colour with the alive tint.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Unidirectional top→bottom scan, period SCAN_PERIOD_S, snap-back
    // to top at end of period. The HUD overlay (sibling) recomputes the
    // same phase from performance.now() so cursor + beam stay aligned.
    const tMs = performance.now();
    const phase = (tMs / 1000 % SCAN_PERIOD_S) / SCAN_PERIOD_S; // 0..1 top→bot
    const scanY = SCAN_Y_TOP + (SCAN_Y_BOT - SCAN_Y_TOP) * phase;
    // Wrap fade-out (last SCAN_WRAP_OUT_FRAC of cycle) + fade-in (first
    // SCAN_WRAP_IN_FRAC of next). Without this the beam visibly teleports
    // from the bottom of the wall back to the top each period.
    const alphaScale = beamAlphaForPhase(phase);
    if (scanPlaneRef.current) {
      scanPlaneRef.current.position.y = scanY;
      const mat = scanPlaneRef.current.material as THREE.MeshBasicMaterial;
      // The gradient texture carries the gaussian alpha; material.opacity
      // compounds with that alpha when transparent is true. So opacity
      // here = (wrap fade) × (soft pulse), peaking at 1.0 in steady state.
      const pulse = 0.85 + 0.15 * Math.sin(t * 18);
      mat.opacity = alphaScale * pulse;
    }
    if (scanHaloRef.current) {
      scanHaloRef.current.position.y = scanY;
      const mat = scanHaloRef.current.material as THREE.MeshBasicMaterial;
      // Halo is a separate scatter layer at a low baseline opacity so it
      // can dim with the wrap fade without disappearing into the beam.
      mat.opacity = 0.10 * alphaScale;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y = t * ROTATION_RAD_PER_S;
    }

    // Wall clock (performance.now()/1000) for flash ages. Matches the
    // interval callback's `now` so per-cell birth/death + flash latches
    // line up exactly across frames.
    const tWall = tMs / 1000;

    const cells = cellsRef.current;
    // First pass: latch flashAt on any alive cell the beam just crossed.
    // O(1) per cell via stored row.
    for (let idx = 0; idx < cells.length; idx++) {
      const c = cells[idx];
      if (!c.isAlive) continue;
      const cellY = ((GRID_SIZE - 1) / 2 - c.row) * CELL;
      if (Math.abs(cellY - scanY) < SCAN_TOUCH_REACH) {
        c.flashAt = tWall;
      }
    }

    for (let idx = 0; idx < cells.length; idx++) {
      const c = cells[idx];
      const bRamp = Math.min(1, Math.max(0, (t - c.bornAt) / BIRTH_DUR_S));
      const dRamp = Math.min(1, Math.max(0, (t - c.deathAt) / DEATH_DUR_S));
      let scale = 0;
      let emis = 0;
      let oM = 0;
      let oE = 0;
      if (c.isAlive) {
        // Birth scale: 0 → BIRTH_OVERSHOOT over first half, then
        // BIRTH_OVERSHOOT → 1.0 over second half. Bigger pop than the
        // old 0→1.25→1.0 ramp.
        scale = bRamp < 0.5
          ? bRamp * 2 * BIRTH_OVERSHOOT
          : BIRTH_OVERSHOOT - (bRamp - 0.5) * 2 * (BIRTH_OVERSHOOT - 1.0);
        // Birth emissive flash: 0 → BIRTH_FLASH_PEAK over first 30%,
        // then BIRTH_FLASH_PEAK → 0.8 over the remaining 70%.
        emis = bRamp < 0.3
          ? (bRamp / 0.3) * BIRTH_FLASH_PEAK
          : BIRTH_FLASH_PEAK - ((bRamp - 0.3) / 0.7) * (BIRTH_FLASH_PEAK - 0.8);
        oM = 0.60;
        oE = 0.95;
      } else if (c.deathAt > SENTINEL_PAST && dRamp < 1) {
        // Death puff: scale 1.0 → DEATH_PUFF_SCALE over first 15%, then
        // collapse from DEATH_PUFF_SCALE → 0 over the remaining 85%.
        if (dRamp < 0.15) {
          scale = 1.0 + (dRamp / 0.15) * (DEATH_PUFF_SCALE - 1.0);
          emis = (dRamp / 0.15) * DEATH_FLASH_PEAK;
          oM = 0.60;
          oE = 0.95;
        } else {
          const k = (dRamp - 0.15) / 0.85;
          scale = DEATH_PUFF_SCALE * (1 - k);
          emis = DEATH_FLASH_PEAK * (1 - k);
          oM = 0.60 * (1 - k);
          oE = 0.95 * (1 - k);
        }
      }
      // Scan flash: stronger, time-faded boost rather than a continuous
      // proximity gradient. The boost peaks at the moment of crossing
      // and decays linearly to zero over SCAN_TOUCH_FADE_S.
      const flashAge = tWall - c.flashAt;
      const flashBoost = flashAge >= 0 && flashAge < SCAN_TOUCH_FADE_S
        ? (1 - flashAge / SCAN_TOUCH_FADE_S) * SCAN_TOUCH_EMISSIVE
        : 0;
      if (flashBoost > 0) {
        emis += flashBoost;
        oM = Math.min(SCAN_TOUCH_OPACITY_CAP, oM + flashBoost * 0.08);
      }
      // Continuous proximity glow on top of the discrete flash. Cells get
      // a smooth (1 − dy/reach)² boost when the beam is in the wider
      // SCAN_PROXIMITY_REACH band, so the beam APPROACHING a cell already
      // brightens it — not just the instant of crossing. Only applies to
      // alive cells; dead cells stay invisible.
      if (c.isAlive) {
        const cellY = ((GRID_SIZE - 1) / 2 - c.row) * CELL;
        const dy = Math.abs(cellY - scanY);
        if (dy < SCAN_PROXIMITY_REACH) {
          const k = 1 - dy / SCAN_PROXIMITY_REACH;
          // Multiply by the same wrap-fade alpha so the proximity glow
          // doesn't visibly hover when the beam itself has faded out at
          // the period boundary.
          emis += k * k * SCAN_PROXIMITY_PEAK * alphaScale;
        }
      }
      // Scan trail: after a crossing latch, hold a soft residue past the
      // 0.5s flash through SCAN_TRAIL_LIFE_S so the beam's path remains
      // readable behind it. flashAt doubles as "last scanned at" — only
      // applies to alive cells (a dead cell shouldn't glow from a stale
      // pre-death scan).
      if (c.isAlive && flashAge >= 0 && flashAge < SCAN_TRAIL_LIFE_S) {
        emis += (1 - flashAge / SCAN_TRAIL_LIFE_S) * SCAN_TRAIL_PEAK;
      }
      // GoL heartbeat: brief global emissive boost on every step pulse,
      // decaying linearly over STEP_PULSE_DUR_S. Only alive cells feel
      // it — dead cells should remain invisible regardless of cadence.
      // We capture stepPulseBoost separately so the edge layer can ride
      // a scaled-down (~30%) version of the same envelope as an opacity
      // flicker — keeps wireframe + membrane synchronised to the GoL
      // cadence without compounding emissive colour shifts.
      let stepPulseBoost = 0;
      if (c.isAlive) {
        const stepPulseAge = tWall - stepPulseAt.current;
        if (stepPulseAge >= 0 && stepPulseAge < STEP_PULSE_DUR_S) {
          stepPulseBoost = (1 - stepPulseAge / STEP_PULSE_DUR_S) * STEP_PULSE_PEAK;
          emis += stepPulseBoost;
        }
      }
      c.group.scale.set(scale, scale, scale);
      c.membraneMat.color.copy(c.tintedColor);
      c.membraneMat.emissive.copy(c.tintedColor);
      c.membraneMat.emissiveIntensity = emis;
      c.membraneMat.opacity = oM;
      // Edge colour: cluster-tinted hue lerped 35% toward white. Each
      // connected component therefore reads with its OWN edge hue
      // (rather than every cell sharing the static CRIMSON_EDGE /
      // LCL_EDGE white-lerp), reinforcing the multi-molecule reading.
      // The lerp toward white keeps lines bright enough to clear the
      // membrane glow.
      EDGE_COLOR_SCRATCH.copy(c.tintedColor).lerp(WHITE, 0.35);
      c.edgeMat.color.copy(EDGE_COLOR_SCRATCH);
      // Edge step pulse: bump opacity by 30% of the cell-emissive pulse
      // (× 0.2 scale because LineMaterial opacity already starts at 0.95
      // for alive cells — we want a perceptible flicker, not a saturated
      // flash). LineMaterial doesn't expose emissive intensity, so
      // opacity is the cleanest knob; multiplying .color.multiplyScalar
      // would compound across frames since we don't reset color from a
      // pristine source each tick.
      const edgeStepBoost = stepPulseBoost * 0.3;
      c.edgeMat.opacity = Math.min(1.0, oE + edgeStepBoost * 0.2);
      // Nucleus tracks the cluster-tinted color and only shows for alive
      // cells. The group-level scale carries it through birth/death
      // ramps so we don't need a separate envelope.
      c.nucleusMat.color.copy(c.tintedColor);
      c.nucleus.visible = c.isAlive;
    }
  });

  // Attach all 64 cell groups to the rotating group. Doing this in an
  // effect (not JSX) lets us reuse the imperatively-built Three objects
  // without R3F re-reconciling each frame. The instanceof guard keeps
  // jsdom-mocked tests (where `<group>` is a stub DOM node and
  // `groupRef.current` is null or a non-Three element) from crashing.
  useEffect(() => {
    const grp = groupRef.current;
    if (!(grp instanceof THREE.Object3D)) return;
    const { cells } = entries;
    for (const c of cells) grp.add(c.group);
    return () => {
      for (const c of cells) grp.remove(c.group);
    };
  }, [entries]);

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault manual position={[0, 0, 7]} fov={30} aspect={aspect} />
      <ambientLight intensity={0.25} />
      <directionalLight color={0xff6688} intensity={1.6} position={[2, 3, 4]} />
      <directionalLight color={0xffb060} intensity={0.25} position={[-3, -1, 2]} />
      {/* Rim light from BEHIND the wall: amber-tinted (palette-warm) so
          flat-shaded polyhedra read with a faint silhouette glow against
          the backdrop. Cool tints would clash with the Eva-style palette. */}
      <directionalLight color={0xffd68a} intensity={0.5} position={[0, 0.5, -3]} />
      <group ref={groupRef} />
      {/* World-locked horizontal scan plane + halo. Sibling of the
          rotating group so the polyhedra spin through it. The beam is a
          single plane carrying a gaussian gradient texture (bright center,
          transparent edges) — reads as a soft band of light rather than
          two stacked rectangles. A wider, dimmer halo plane underneath
          adds scatter. */}
      <mesh ref={scanPlaneRef}>
        <planeGeometry args={[WORLD * 1.3, SCAN_BEAM_PLANE_H]} />
        <meshBasicMaterial
          map={beamTex}
          transparent
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={scanHaloRef}>
        <planeGeometry args={[WORLD * 1.4, SCAN_HALO_PLANE_H]} />
        <meshBasicMaterial
          color={SCAN_HALO_COLOR}
          transparent
          opacity={0.10}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/** Apply a freshly-seeded grid to the cell entries: alive flags, base
 *  + tinted + edge colors, and birth/death sentinel timestamps. */
function applySeed(grid: Grid, cells: CellEntry[]) {
  const cid = findClusters(grid, CHEBY_MAX);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    const c = cells[i];
    if (!c) continue;
    c.isAlive = v > 0;
    const base = v === 2 ? LCL : CRIMSON;
    c.baseColor = base.clone();
    c.tintedColor = clusterTint(cid[i], base);
    c.clusterId = cid[i];
    c.bornAt = v > 0 ? SENTINEL_PAST : SENTINEL_FUTURE;
    c.deathAt = v > 0 ? SENTINEL_FUTURE : SENTINEL_PAST;
  }
}
