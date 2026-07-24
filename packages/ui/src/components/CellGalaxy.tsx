import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import { LIVE } from '../tweaks/liveTweaks';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';

import type { Vec3 } from '../types';
import { makeHaloMaterial, phaseFor, rateFor } from './GlowNode';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  INSTANCE_CAPACITY,
} from '../geometry/cellPositions';
import type { Cell } from '@cknerv/types';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { ConsensusMemoryFocusScope } from '../hooks/consensusMemoryFocusContext';
import { capacityMass, deriveCellVisual } from '../derives/cellVisual.derive';
import {
  consensusBlockColor,
  consensusCellColor,
} from '../derives/consensusFlow.derive';
import { consensusBraidPresenceScale } from '../derives/consensusBraid.derive';
import {
  consensusMemoryCoreIdentity,
} from '../derives/consensusMemoryCoreIdentity.derive';
import {
  CONSENSUS_BRAID_LOCAL_RADIUS,
  cellGalaxyRotationScaleTarget,
  cellFocusTarget,
  consensusBraidRenderScale,
  dampCellGalaxyRotationScale,
  selectedCellNumericId,
} from '../derives/cellInteraction.derive';
import { SHOCKWAVE_SLOTS, writeShockwaveSlot } from '../materials/shockwaveMaterial';
import { makeCellHybridMaterial } from '../materials/cellHybridMaterial';
import { makeCellFlareMaterial } from '../materials/cellFlareMaterial';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../materials/pointSpritePresentation';
import {
  CELLS_Y,
  chainNodeWorldPosition,
} from '../layout';
import CellIdentityProofMarker, {
  type CellIdentityProofBinding,
  type CellIdentityProofEvent,
} from './CellIdentityProofMarker';
import CellIdentityBindingMarker from './CellIdentityBindingMarker';
import {
  cellInspectionFieldScale,
  dampCellInspectionFieldScale,
  type CellInspectionField,
} from '../nerve/cellInspectionField';

/** Cyan palette for the structural chain anchor (CKB icosahedron).
 *  The chain anchor reads as "structural backbone / chain truth" and
 *  stays visually distinct from the Cell consensus field. Its resting
 *  structure remains cyan while a block event temporarily carries that
 *  block's A-lane hue. Kept in sync with the `ckb`
 *  entry of `_rcg/glowNodePalette.ts` — tune both together. */
const CHAIN_ANCHOR_PALETTE = { edge: '#7df9ff', halo: '#22d3ee', fill: '#0e7490' };
import CellNucleus from './CellNucleus';

// ---------------------------------------------------------------------------
// Block trigger — written by CellGalaxy on every block, consumed by:
//   • NervePulses (shockwave-delay timing for cell→cell pulses)
//   • CkbNodeAnchor (icosahedron halo flash)
//   • cellHybridMaterial — fragment-shader rings expanding
//     outward from the miner anchor that brighten existing far-field cells
//     as they pass.
// The geometric block cube was removed; one A carrier identity now passes
// through the anchor halo, canopy wave, routes, and local write seals.
// ---------------------------------------------------------------------------

export interface BlockEventTrigger {
  /** `simClock.elapsedSec` when the trigger fired (sim-time-relative). */
  firedAt: number;
  /** World-space anchor of the originating CKB node. */
  origin: [number, number, number];
  /** Stable A carrier identity for this observed block. */
  color: [number, number, number];
}

import {
  BEAM_GROW_DUR_S,
  LOCAL_IGNITION_RADIUS,
  LOCAL_IGNITION_SPEED,
  MAX_BLOCK_HIGHLIGHTS,
  MAX_LOCAL_IGNITIONS,
  SHOCKWAVE_FIRE_DELAY_S,
  SHOCKWAVE_SPEED,
} from '../ui/topologyConstants';

// Cell birth/death visual timing offset (s) — applied to each cell's
// born/death scene timestamp so the shader starts the birth scale-up
// (or the death fade-out) approximately when the visible canopy
// shockwave ring sweeps the cell. Equal to SHOCKWAVE_FIRE_DELAY_S +
// a typical traversal time (~0.15 s) so a cell midway through the
// galaxy ignites in sync with the highlight write CellGalaxy emits
// when the block lands. Per-cell distance-exact alignment would
// require threading the originating miner's coords into each cell's
// birth metadata; the static offset is close enough.
export const BLOCK_HIGHLIGHT_DELAY_S = SHOCKWAVE_FIRE_DELAY_S + 0.15;

interface CellGalaxyProps {
  ckbNodeIds: string[];
  /** Subset of `ckbNodeIds` whose chain node runs a miner. Miner pulses
   *  only fire from these positions. Falls back to all node ids when empty
   *  (e.g. tests / placeholder profile). */
  minerCkbNodeIds?: string[];
  /** Universe seed driving icosahedra scatter — propagated from
   *  `ProfileSnapshot.universe_seed`. */
  universeSeed?: number;
  /** Currently selected node id (drives the CKB node selection reticle). */
  selectedId: string | null;
  /** Currently selected Cell id (`cell:<id>`). Kept separate from the network
   *  selection so both detail axes can remain open at the same time. */
  selectedCellId?: string | null;
  /** One WHERE / WHAT / WHEN acknowledgement emitted after the portrait
   *  resolves the selected identity facet. It never mutates chain state. */
  identityProof?: CellIdentityProofEvent | null;
  /** Accumulated proof state for the selected Cell. One bounded scene glyph
   *  persists as the bridge from exact identity into causal recall. */
  identityProofBinding?: CellIdentityProofBinding | null;
  /** Fixed elapsed time for deterministic identity-proof review frames.
   *  Production callers omit this and retain the live event clock. */
  identityProofSampleElapsedSeconds?: number;
  onSelect: (id: string | null) => void;
  /** Map of cell.id → most-recent scene-seconds flash time. Owned by the
   *  consumer so overlay layers (e.g. RCG's NeuralNetwork) can write into
   *  the same buffer that CellGalaxy's block-event highlights feed. */
  cellFlashRef: React.MutableRefObject<Map<number, number>>;
  /** Set true whenever cellFlashRef gains an entry that should appear on
   *  the next frame. Cleared after the per-cell write loop runs. Lets
   *  flash-only updates bypass the cells-identity skip in useSimFrame
   *  without forcing a full per-cell rewrite. */
  flashDirtyRef: React.MutableRefObject<boolean>;
  /** Optional overlay rendered inside the cell galaxy's rotating
   *  world-space group. Used by consumers to add domain-specific
   *  animations (e.g. consensus routes + write seals) atop the
   *  cell field without coupling CellGalaxy to non-generic components. */
  overlay?: ReactNode;
  /** Shared topology field published by the overlay's NeuralNetwork. The
   * Cell body reads it directly so selection never rebuilds the graph here. */
  inspectionFieldRef?: React.RefObject<CellInspectionField | null>;
  /** Seconds after the block pulse at which the LOCAL node applies the block —
   *  i.e. when it hears the block from the network (caller-supplied delay). The
   *  whole ledger reaction is delayed by this, so the canonical ripple never
   *  fires at t=0 / never before the peers. 0 = no delay (degenerate). */
  localReceiveDelayS?: number;
  /** World-space anchor for the per-block canopy brightness wave, supplied by the
   *  caller — the block's entry point into the galaxy (an entry peer, or in the
   *  colony model our own local node). The wave is fired from here so propagation
   *  reads as sweeping outward from it. null → falls back to the local origin. */
  entryWorld?: Vec3 | null;
  /** Scene-seconds from the block pulse at which the entry point receives the
   *  block. The brightness wave departs at `entryArrivalS + SHOCKWAVE_FIRE_DELAY_S`
   *  (entry-point beam completion). ckb-rcg passes the entry peer's `arrivals[entryId]`;
   *  the cknerv colony caller passes `localReceiveDelayS` (== the local apply time,
   *  since our node IS the entry point), so wave-time and local-apply coincide. */
  entryArrivalS?: number;
}

// Cell point sizes in world units. The hybrid shader draws the anchored
// core/glow sprite; the closest points expand into the shared A braid LOD.
const GENERIC_CELL_POINT_SIZE = 1.6;
const TAGGED_CELL_POINT_SIZE = 3.0;

/**
 * Choose the origin + scene-time for the canopy brightness wave (the shockwave
 * ring and the cell highlights swept by it). Generic across callers: the wave is
 * owned by whatever `entryWorld` the caller supplies — the block's entry point
 * into the galaxy. When it is known the wave fires from there at the caller's
 * `elapsedSec + entryArrivalS`; the caller adds `SHOCKWAVE_FIRE_DELAY_S` so it
 * departs as that entry point's beam completes. With no entry (null) it falls
 * back to the local node's origin/time, preserving single-node behaviour.
 *
 * NOTE on callers: the ckb-rcg sibling passes the ENTRY PEER (the first peer to
 * receive the block) — distinct from, and earlier than, the local node's own
 * apply. The cknerv colony caller instead passes the LOCAL node as `entryWorld`
 * with `entryArrivalS == localReceiveDelayS` (our node IS the galaxy's entry
 * point — the local ledger receives here), so there the wave-time and local-apply
 * time coincide rather than the wave leading.
 */
export function selectWaveAnchor(
  entryWorld: Vec3 | null,
  entryArrivalS: number,
  elapsedSec: number,
  localOrigin: Vec3,
  localTriggerSceneS: number,
): { origin: Vec3; triggerSceneS: number } {
  if (entryWorld) {
    return { origin: entryWorld, triggerSceneS: elapsedSec + entryArrivalS };
  }
  return { origin: localOrigin, triggerSceneS: localTriggerSceneS };
}

/**
 * Write per-cell flash timestamps into the shared flash buffer (consumed by
 * the anchored hybrid cell Points layer via the shared BufferGeometry).
 * `flashMap` is a cell.id → scene-seconds timestamp written by the
 * per-block highlight path and by NervePulses on spike arrival. A cell
 * without an entry gets the `-1e9` sentinel.
 */
export function writeFlashSlots(
  cells: Cell[],
  count: number,
  flashMap: Map<number, number>,
  flashArr: Float32Array,
): void {
  for (let i = 0; i < count; i += 1) {
    const c = cells[i];
    flashArr[i] = flashMap.get(c.id) ?? -1e9;
  }
}

/** Write the static graph-distance target for each currently visible Cell.
 * The render loop eases a separate GPU attribute toward these values. */
export function writeCellInspectionTargets(
  cells: Cell[],
  count: number,
  field: CellInspectionField | null,
  targetArr: Float32Array,
): void {
  for (let i = 0; i < count; i += 1) {
    targetArr[i] = cellInspectionFieldScale(field, cells[i].id);
  }
}

/** Preserve the deterministic cache order while pinning one selected Cell into
 * the visible prefix. Quality changes may reduce the prefix, but an identity the
 * user is already inspecting must never disappear merely because the renderer
 * shed background capacity. The tail remains intact for live-id pruning. */
export function pinSelectedCellInVisiblePrefix(
  cells: Cell[],
  visibleCount: number,
  selectedCellId: number | null,
): Cell[] {
  if (selectedCellId === null || visibleCount <= 0 || visibleCount >= cells.length) {
    return cells;
  }
  const selectedIndex = cells.findIndex((cell) => cell.id === selectedCellId);
  if (selectedIndex < 0 || selectedIndex < visibleCount) return cells;
  const pinned = cells.slice();
  const boundaryIndex = visibleCount - 1;
  [pinned[boundaryIndex], pinned[selectedIndex]] = [
    pinned[selectedIndex],
    pinned[boundaryIndex],
  ];
  return pinned;
}

export interface CellBufferTargets {
  /** Shared per-cell attribute arrays consumed by the hybrid Points layer. */
  posArr:   Float32Array;
  colorArr: Float32Array;
  bornArr:  Float32Array;
  deathArr: Float32Array;
  flashArr: Float32Array;
  sizeArr:  Float32Array;
  memoryIdentityArr: Float32Array;
  memorySeedArr: Float32Array;
}

/**
 * Write all per-cell static + flash data into the supplied buffers. Pure:
 * mutates the typed-array fields of `targets`. Caller owns the geometry
 * attribute `needsUpdate` flags — this function never touches them.
 */
export function writeCellBuffers(
  cells: Cell[],
  count: number,
  toSceneSeconds: (ms: number) => number,
  flashMap: Map<number, number>,
  targets: CellBufferTargets,
): void {
  for (let i = 0; i < count; i += 1) {
    const c = cells[i];
    const isTagged = c.tag !== null;
    const bornAtS = toSceneSeconds(c.born_at_ms) + BLOCK_HIGHLIGHT_DELAY_S;
    const deathAtS = c.death_at_ms === null
      ? 1e9
      : toSceneSeconds(c.death_at_ms) + BLOCK_HIGHLIGHT_DELAY_S;
    const flashAtS = flashMap.get(c.id) ?? -1e9;

    const visual = deriveCellVisual(c);
    const color = consensusCellColor(visual);
    const memoryIdentity = consensusMemoryCoreIdentity(visual);
    targets.posArr[i * 3 + 0]   = c.pos_seed[0];
    targets.posArr[i * 3 + 1]   = c.pos_seed[1];
    targets.posArr[i * 3 + 2]   = c.pos_seed[2];
    targets.colorArr[i * 3 + 0] = color[0];
    targets.colorArr[i * 3 + 1] = color[1];
    targets.colorArr[i * 3 + 2] = color[2];
    targets.bornArr[i]          = bornAtS;
    targets.deathArr[i]         = deathAtS;
    targets.flashArr[i]         = flashAtS;
    targets.sizeArr[i]          = isTagged ? TAGGED_CELL_POINT_SIZE : GENERIC_CELL_POINT_SIZE;
    targets.memoryIdentityArr.set(memoryIdentity.semantic, i * 4);
    targets.memorySeedArr[i]    = memoryIdentity.hashSeed;
  }
}

// ---------------------------------------------------------------------------
// CkbNodeAnchor — slowly-spinning wireframe icosahedra inside the galaxy.
// One per real CKB node, positioned deterministically.
// ---------------------------------------------------------------------------

function ckbNodeLabel(id: string): string {
  // Format: `ckb:devnet[:N]` → `CKB[:N]`. Drops the `devnet` segment so
  // the in-galaxy label reads as a clean "CKB" (or "CKB:0", "CKB:1"
  // when multiple nodes are present). The chain anchor's plain id
  // `ckb:devnet` becomes "CKB".
  if (id === 'ckb:devnet') return 'CKB';
  if (id.startsWith('ckb:devnet:')) return `CKB:${id.slice('ckb:devnet:'.length)}`;
  if (id.startsWith('ckb:')) return id.slice(4).toUpperCase();
  return id.toUpperCase();
}

/** Duration in seconds of the GlowNode-style halo intensity pulse on
 *  block arrival. Mirrors the temporal feel of GlowNode's flash hint:
 *  intensityRef snaps toward `ANCHOR_FLASH_PEAK_INTENSITY` and lerps
 *  back to the resting 1.0 over the same envelope. */
const ANCHOR_FLASH_DURATION_S = 0.6;
/** Peak halo intensity multiplier during the flash. Matches
 *  GlowNode.flash_green's target=2.4. */
const ANCHOR_FLASH_PEAK_INTENSITY = 2.4;
/** World-units edge of the halo billboard plane. Sized like
 *  GlowNode.shape.size * 6 — the icosahedron radius is 2.5, so the
 *  halo plane is 15 × 15. */
const ANCHOR_HALO_PLANE_SIZE = 2.5 * 6.0;

function CkbNodeAnchor({
  id,
  position,
  selected,
  onSelect,
  flashRef,
}: {
  id: string;
  position: [number, number, number];
  selected: boolean;
  onSelect: (id: string | null) => void;
  flashRef?: { current: { firedAt: number; color: [number, number, number] } | null };
}) {
  const simClock = useSimClock();
  const bodyRef = useRef<THREE.Group>(null);
  // Halo material drives the new-block flash exactly the way GlowNode
  // drives `flash_green` / `pulse_blue`: bake an `intensityRef` that
  // smoothly lerps toward a target (peak during the flash window,
  // rest = 1.0 otherwise), multiply by the breathing envelope, and
  // write into `uIntensity`. No more wireframe colour lerp, shell
  // opacity pump, corona ring, or spark rays — all of that visual
  // mass moves into the additive halo so the icosahedron flash
  // reads identically to every other node's flash hint.
  const palette = CHAIN_ANCHOR_PALETTE;
  const haloMat = useMemo(() => {
    const m = makeHaloMaterial(palette);
    m.uniforms.uPhase.value = phaseFor(id);
    return m;
  }, [palette, id]);
  const phase = useMemo(() => phaseFor(id), [id]);
  const rate = useMemo(() => 0.7 + 0.6 * rateFor(id), [id]);
  const intensityRef = useRef(1);

  useEffect(() => () => haloMat.dispose(), [haloMat]);

  useSimFrame((_, dt) => {
    if (bodyRef.current) {
      bodyRef.current.rotation.x += dt * 0.15;
      bodyRef.current.rotation.y += dt * 0.1;
    }
    // Hint-style flash target. `flashRef` is set on each new block
    // and reads as a brief peak in halo intensity, just like GlowNode
    // when its hint is `flash_green` (target=2.4 sustained, then back
    // to 1 after the hint clears).
    let target = 1;
    const trigger = flashRef?.current ?? null;
    if (trigger) {
      const age = simClock.elapsedSec - trigger.firedAt;
      if (age >= 0 && age < ANCHOR_FLASH_DURATION_S) {
        target = ANCHOR_FLASH_PEAK_INTENSITY;
        haloMat.uniforms.uColor.value.setRGB(...trigger.color);
      } else {
        haloMat.uniforms.uColor.value.set(palette.halo);
      }
    } else {
      haloMat.uniforms.uColor.value.set(palette.halo);
    }
    intensityRef.current += (target - intensityRef.current) * Math.min(1, dt * 12);

    const t = simClock.elapsedSec;
    haloMat.uniforms.uTime.value = t;
    const breathe = 0.85 + 0.15 * Math.sin(t * rate + phase);
    haloMat.uniforms.uIntensity.value = intensityRef.current * breathe;
  });

  return (
    <group position={position}>
      {/* Camera-facing additive halo — the entire flash effect lives
          here. Unified with GlowNode so chain icosahedra and the
          rest of the topology speak the same flash language. */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh material={haloMat}>
          <planeGeometry args={[ANCHOR_HALO_PLANE_SIZE, ANCHOR_HALO_PLANE_SIZE]} />
        </mesh>
      </Billboard>
      <group ref={bodyRef}>
        <lineSegments>
          <edgesGeometry args={[new THREE.IcosahedronGeometry(2.5, 0)]} />
          <lineBasicMaterial
            color="#7df9ff"
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            transparent
          />
        </lineSegments>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onSelect(id);
          }}
        >
          <icosahedronGeometry args={[2.5, 0]} />
          <meshBasicMaterial
            color="#0e7490"
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
      <Html
        position={[0, -3.6, 0]}
        center
        occlude={false}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            color: '#e6f4ff',
            fontSize: '9.5px',
            fontWeight: 500,
            letterSpacing: '0.32em',
            fontFamily:
              "'Orbitron Local', 'JetBrains Mono Local', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: 'nowrap',
            textShadow:
              '0 0 4px rgba(125, 249, 255, 0.9), 0 0 12px rgba(125, 249, 255, 0.55), 0 0 22px rgba(125, 249, 255, 0.25)',
            textTransform: 'uppercase',
          }}
        >
          {ckbNodeLabel(id)}
        </div>
      </Html>
      {selected ? <CkbSelectionReticle size={6} /> : null}
    </group>
  );
}

/**
 * Selection reticle for the CKB node — eight L-shaped corner ticks
 * arranged around a square frame, slowly rotating in the camera-facing
 * plane. Mirrors the look of GlowNode's SelectionReticle so the two
 * node kinds feel consistent when picked.
 */
export function CkbSelectionReticle({ size }: { size: number }) {
  const ref = useRef<THREE.Group>(null);
  useSimFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * 0.6;
  });
  const half = size / 2;
  const ticks: [Vec3, Vec3][] = [
    [[-half, -half * 0.7, 0], [-half, -half, 0]],
    [[-half * 0.7, -half, 0], [-half, -half, 0]],
    [[half, -half * 0.7, 0], [half, -half, 0]],
    [[half * 0.7, -half, 0], [half, -half, 0]],
    [[-half, half * 0.7, 0], [-half, half, 0]],
    [[-half * 0.7, half, 0], [-half, half, 0]],
    [[half, half * 0.7, 0], [half, half, 0]],
    [[half * 0.7, half, 0], [half, half, 0]],
  ];
  return (
    <group ref={ref}>
      {ticks.map(([a, b], i) => (
        <mesh
          key={i}
          position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]}
          rotation={[0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])]}
        >
          <planeGeometry args={[Math.hypot(b[0] - a[0], b[1] - a[1]), 0.18]} />
          <meshBasicMaterial color="#e0f2fe" transparent opacity={0.9} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// CellPicker — screen-space cell hit-test, replacing the legacy
// InstancedMesh sphere hitbox.
// ---------------------------------------------------------------------------
//
// Why screen-space, not 3D raycast:
//   • The visible cell footprint (anchored core sprite + near braid) is tiny
//     in world units but ~5–15 px
//     on screen. A 3D-radius hitbox has to be huge in world units to be
//     clickable, which causes overlapping hitboxes in the dense core and
//     "nearest along ray" picks a cell that isn't the one the user aimed
//     at.
//   • The user's intent is "the cell at this pixel" — so we test in pixel
//     space. Project each pos_seed through the live world+camera matrices
//     and pick the cell whose screen position is closest to the click,
//     within a per-cell pixel tolerance derived from its on-screen size.
//
// Pick radius is synced with the visible cell footprint — never a fixed
// number. For every cell, on every click:
//   pickRadius_px = max(cellPointHalfExtent_px, braidCircumradius_px)
// where both terms come from the live shaders' world→screen mapping:
//   gl_PointSize ≈ aSize × 2 × (viewportHeight/2) / viewZ   (hybrid core sprite)
//   braidR_world = the production A LOD's interaction-aware screen radius
// Zoom in → cells appear bigger → pick radius grows the same way.
// No constant slop term — what you see is what you click.
//
// Performance: O(N) projections per click, no per-frame cost. N ≤ 6000
// (INSTANCE_CAPACITY); each iteration is a couple of Vector3 mul+project
// — sub-ms on commodity hardware.

interface CellPickerProps {
  cellsListRef: React.MutableRefObject<Cell[]>;
  selectedCellIdRef: React.MutableRefObject<number | null>;
  hoveredCellIdRef: React.MutableRefObject<number | null>;
  onSelect: (id: string | null) => void;
}

/** Custom Object3D that participates in r3f's raycast pipeline. Its
 *  `raycast()` projects every live cell's pos_seed to screen and pushes
 *  an intersect for the cell whose own visual radius covers the click.
 *  The intersect carries `instanceId` so the existing `cell:${id}`
 *  selection contract is preserved. */
function CellPicker({
  cellsListRef,
  selectedCellIdRef,
  hoveredCellIdRef,
  onSelect,
}: CellPickerProps) {
  const ref = useRef<THREE.Object3D>(null);
  const { gl, size } = useThree();
  // Live viewport ref keeps the raycast closure current without rebinding.
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Scratch allocations hoisted out of the per-cell loop.
    const cellWorld = new THREE.Vector3();
    const cellView = new THREE.Vector3();
    const cellNdc = new THREE.Vector3();
    const rayNdc = new THREE.Vector3();
    const bestPoint = new THREE.Vector3();

    node.raycast = function raycastCells(raycaster, intersects) {
      const cells = cellsListRef.current;
      if (cells.length === 0) return;
      const camera = raycaster.camera;
      if (!camera) return;
      const ray = raycaster.ray;

      // Recover the click point in NDC: any point on the ray in front of
      // the camera projects back to the same screen pixel. t=1 is fine.
      rayNdc.copy(ray.origin).addScaledVector(ray.direction, 1).project(camera);
      const clickNdcX = rayNdc.x;
      const clickNdcY = rayNdc.y;

      const { width, height } = sizeRef.current;
      const halfW = width * 0.5;
      const halfH = height * 0.5;

      const matrix = this.matrixWorld;
      let bestIdx = -1;
      let bestPxSq = Infinity;
      let bestDepth = Infinity;

      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        cellWorld
          .set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2])
          .applyMatrix4(matrix);

        // View-space depth — feeds both the cell's per-pixel size and
        // the frustum-skip below.
        cellView.copy(cellWorld).applyMatrix4(camera.matrixWorldInverse);
        const viewZ = -cellView.z;
        if (viewZ <= 0) continue; // behind camera

        // Per-cell pick radius synced to the visible footprint.
        //   cell point half-extent (px) = aSize × halfH / viewZ
        //     — matches the hybrid shader's gl_PointSize formula
        //     (aSize × 2 × depthToPx); the sprite quad is what the user
        //     sees as the core/glow.
        //   braid circumradius (px) = BRAID_PICK_RADIUS × halfH / viewZ.
        // Take the larger so neither layer can leak outside the
        // clickable area. No constant slop — strictly visual.
        const isTagged = c.tag !== null;
        const cellPointAsize = isTagged ? TAGGED_CELL_POINT_SIZE : GENERIC_CELL_POINT_SIZE;
        const depthToPx = halfH / viewZ;
        const cellPointPxR = cellPointAsize * depthToPx;
        const focus = cellFocusTarget(
          c.id,
          selectedCellIdRef.current,
          hoveredCellIdRef.current,
        );
        const braidScale = consensusBraidRenderScale(
          viewZ,
          height,
          camera.projectionMatrix.elements[5],
          focus,
          consensusBraidPresenceScale(capacityMass(c.capacity)),
        );
        const braidPxR = CONSENSUS_BRAID_LOCAL_RADIUS
          * braidScale
          * camera.projectionMatrix.elements[5]
          * depthToPx;
        const pickPxR = cellPointPxR > braidPxR ? cellPointPxR : braidPxR;
        const pickPxRSq = pickPxR * pickPxR;

        cellNdc.copy(cellWorld).project(camera);
        if (cellNdc.z < -1 || cellNdc.z > 1) continue;

        const dx = (cellNdc.x - clickNdcX) * halfW;
        const dy = (cellNdc.y - clickNdcY) * halfH;
        const pxSq = dx * dx + dy * dy;
        if (pxSq > pickPxRSq) continue;

        // Closest screen-space wins; tie-break by depth (closer to
        // camera = smaller NDC z) so when two cells coincide on screen
        // the front-facing one is picked.
        if (
          pxSq < bestPxSq - 0.5 ||
          (Math.abs(pxSq - bestPxSq) <= 0.5 && cellNdc.z < bestDepth)
        ) {
          bestPxSq = pxSq;
          bestDepth = cellNdc.z;
          bestIdx = i;
          bestPoint.copy(cellWorld);
        }
      }

      if (bestIdx < 0) return;

      intersects.push({
        // World distance from the ray origin (camera) to the picked
        // cell's pos_seed. r3f sorts intersects by this when multiple
        // objects (e.g. chain icosahedra) compete for the same click.
        distance: ray.origin.distanceTo(bestPoint),
        point: bestPoint.clone(),
        object: this,
        // r3f surfaces this on the synthetic event as `e.instanceId`;
        // the onClick handler below indexes back into cellsListRef.
        instanceId: bestIdx,
      });
    };

    return () => {
      // Plain Object3D.raycast is a no-op; restore on unmount so a
      // future remount doesn't carry a stale closure.
      node.raycast = THREE.Object3D.prototype.raycast;
    };
  }, [cellsListRef, hoveredCellIdRef, selectedCellIdRef]);

  useEffect(() => () => {
    if (gl.domElement.style.cursor === 'pointer') gl.domElement.style.cursor = '';
  }, [gl]);

  const setHovered = (id: number | null) => {
    hoveredCellIdRef.current = id;
    gl.domElement.style.cursor = id === null ? '' : 'pointer';
  };

  return (
    <object3D
      ref={ref}
      onPointerMove={(e) => {
        if (typeof e.instanceId !== 'number') {
          setHovered(null);
          return;
        }
        const cell = cellsListRef.current[e.instanceId];
        setHovered(cell?.id ?? null);
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (typeof e.instanceId !== 'number') return;
        const cell = cellsListRef.current[e.instanceId];
        if (!cell) return;
        setHovered(cell.id);
        onSelect(`cell:${cell.id}`);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// CellGalaxy — main component.
// ---------------------------------------------------------------------------

/**
 * Backdrop "galaxy" of cells (UTXOs) at the chain anchor y=CHAIN_Y.
 *
 * Chain-stream arrivals stay in shared buffers without per-Cell React objects.
 * The sole event object is a user-requested identity proof, mounted as one
 * bounded marker. `cellHybridMaterial` renders the anchored core/glow sprites.
 *
 * Far cells are one anchored hybrid Points sprite. The selected A language
 * expands the closest cells into one batched braid LOD without per-cell
 * objects. Block shockwaves continue to brighten the anchored far core.
 */
export default function CellGalaxy({
  ckbNodeIds,
  minerCkbNodeIds,
  universeSeed,
  selectedId,
  selectedCellId = null,
  identityProof = null,
  identityProofBinding = null,
  identityProofSampleElapsedSeconds,
  onSelect,
  cellFlashRef,
  flashDirtyRef,
  overlay,
  inspectionFieldRef,
  localReceiveDelayS = 0,
  entryWorld = null,
  entryArrivalS = 0,
}: CellGalaxyProps) {
  const simClock = useSimClock();
  const groupRef = useRef<THREE.Group>(null);
  // Server-driven cell list. The component is now a pure visual layer:
  // it reads cells from the cache and writes their xyz / born / death
  // attributes into the Points BufferGeometry each frame. Birth / death / tag
  // are reduced server-side in `simulator/src/dashboard/projections/cells.rs`.
  const cellsCache = useCellGalaxy();
  const identityProofCell = identityProof
    ? cellsCache.cells.get(identityProof.cellId) ?? null
    : null;
  const identityProofBindingCell = identityProofBinding
    ? cellsCache.cells.get(identityProofBinding.cellId) ?? null
    : null;
  const { effective: quality } = useQualityRuntime();
  const cellGalaxyMul = QUALITY_PRESETS[quality].cellGalaxyMul;
  const dischargeArms = QUALITY_PRESETS[quality].dischargeArms;
  const memorySignal = QUALITY_PRESETS[quality].memorySignal;
  /** Per-frame mirror of the cellsList iteration order, written by
   *  `useFrame` below. `CellPicker` reads this ref each click so it
   *  sees the current frame's cells — an inline closure would otherwise
   *  capture only the initial render's data. The pick-time `instanceId`
   *  indexes into this array exactly the way the legacy InstancedMesh
   *  hitbox's `e.instanceId` did, so the `cell:${id}` selection
   *  contract is preserved. */
  const cellsListRef = useRef<Cell[]>([]);
  const selectedCellIdRef = useRef<number | null>(null);
  const hoveredCellIdRef = useRef<number | null>(null);
  selectedCellIdRef.current = selectedCellNumericId(selectedCellId);
  /** Identity of the cells Map last seen by useSimFrame. When
   *  cellsCache.cells === lastCellsRef.current, no birth/death/tag/gc
   *  delta has landed since our previous frame, so the static per-cell
   *  buffers (positions, colors, lifecycle, size, memory identity) are still
   *  valid — we skip writeCellBuffers and the matching needsUpdate
   *  flags. Pulse-only frames (which mutate lastPulseAtMs but leave
   *  the cells Map identity-stable) ride the skip path. */
  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  /** Last-seen `cellGalaxyMul` (from the effective runtime quality preset).
   *  The preset can be owned by the adaptive controller or a manual override.
   *  Including
   *  this in the change predicate keeps the skip-path correct when the
   *  user toggles quality between high/med/low while cells are stable —
   *  otherwise `cellGeometry.setDrawRange` stays at the old preset
   *  until the next birth/death/tag/gc delta lands. */
  const lastMulRef = useRef<number>(0);
  const lastPinnedCellIdRef = useRef<number | null>(null);
  /** Per-frame mirror of the cell draw count. Written in the
   *  inputsChanged path; read by the flash-only fast path so neither
   *  path needs to recompute the clamp. */
  const drawCountRef = useRef<number>(0);
  const lastPulseAtMsRef = useRef<number>(0);
  /** BlockEvent trigger — written on each new block so cell→cell pulses
   *  can sync their fire time to the visible shockwave wavefront. */
  const blockEventRef = useRef<BlockEventTrigger | null>(null);
  /** Per-icosahedron flash trigger — written on each new block for the
   *  miner anchor that sourced it. CkbNodeAnchor reads its own slot
   *  each frame and brightens the wireframe + inner shell when fresh.
   *  Indexed by `ckbNodeIds.indexOf(sourceId)`; size matches
   *  ckbNodeIds. */
  const chainNodeFlashRefs = useMemo(() => {
    return ckbNodeIds.map(() =>
      ({ current: null as { firedAt: number; color: [number, number, number] } | null }),
    );
  }, [ckbNodeIds]);
  // Round-robin origin selector: blocks rotate through known CKB nodes so
  // the animation visibly samples the network rather than always firing
  // from the same anchor.
  const blockOriginIdxRef = useRef<number>(0);
  // Round-robin shockwave slot. The far-field cell core shader owns a
  // SHOCKWAVE_SLOTS-sized ring buffer of (fireAt, originXZ); each new
  // block trigger writes into the next slot so concurrent in-flight
  // waves coexist instead of cancelling each other (mesh profile fires
  // blocks every ~2 s while each wave lives 5 s, so ~3 waves are alive
  // at once).
  const shockSlotRef = useRef<number>(0);
  /** Mirrors `groupRef.current.rotation.y` each frame so child
   *  components (NervePulses) can project world-frame anchors into the
   *  cells-group's rotating local frame without traversing the
   *  Three.js scene graph. */
  const groupRotationYRef = useRef<number>(0);
  const galaxyRotationScaleRef = useRef(1);

  // Hybrid Points buffers: one entry per cell. Written each frame
  // by writeCellBuffers. Indices are stable across frames so gl_VertexID
  // in the shader phases deterministically per cell.
  const cellPosAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY * 3), 3),
    [],
  );
  const cellColorAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY * 3), 3),
    [],
  );
  const cellBornAtAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  const cellDeathAtAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY);
    arr.fill(1e9);
    return new THREE.BufferAttribute(arr, 1);
  }, []);
  const cellFlashAtAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY);
    arr.fill(-1e9);
    return new THREE.BufferAttribute(arr, 1);
  }, []);
  const cellSizeAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  // Compact A identity for the far retained core: asset orientation, lock
  // cadence, payload lanes, capacity mass, and one stable content-hash seed.
  const cellMemoryIdentityAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY * 4), 4),
    [],
  );
  const cellMemorySeedAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  // LOD detail factor per cell (0 = far/unchanged glow, →1 = camera-near, peak
  // suppressed so the nucleus shows). Written each frame by <CellNucleus>.
  const cellDetailAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  // Smooth hover/selection envelope. CellNucleus owns the easing and writes
  // this shared attribute so the far point and the expanded braid stay in sync.
  const cellFocusAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  // Signed recall energy: negative = evidence source, positive = retained
  // target. Resolution is separate so the target can lock only after its real
  // witnesses arrive. Both buffers stay idle at zero outside explicit recall.
  const cellRecallAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  const cellRecallStateAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1),
    [],
  );
  // One eased topology-energy scalar per body point. The target lives in a
  // CPU-only array so a selection change can cross-fade without React state or
  // rebuilding any Cell geometry.
  const cellInspectionAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY);
    arr.fill(1);
    return new THREE.BufferAttribute(arr, 1);
  }, []);
  const cellInspectionTargetArr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY);
    arr.fill(1);
    return arr;
  }, []);
  const lastInspectionFieldRef = useRef<CellInspectionField | null>(null);
  const inspectionAnimatingRef = useRef(false);

  const hybridMaterial = useMemo(() => makeCellHybridMaterial(), []);
  const flareMaterial = useMemo(() => makeCellFlareMaterial(), []);

  const cellGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', cellPosAttr);
    g.setAttribute('aColor', cellColorAttr);
    g.setAttribute('aBornAt', cellBornAtAttr);
    g.setAttribute('aDeathAt', cellDeathAtAttr);
    g.setAttribute('aFlashAt', cellFlashAtAttr);
    g.setAttribute('aSize', cellSizeAttr);
    g.setAttribute('aMemoryIdentity', cellMemoryIdentityAttr);
    g.setAttribute('aMemorySeed', cellMemorySeedAttr);
    g.setAttribute('aDetail', cellDetailAttr);
    g.setAttribute('aFocus', cellFocusAttr);
    g.setAttribute('aRecall', cellRecallAttr);
    g.setAttribute('aRecallState', cellRecallStateAttr);
    g.setAttribute('aInspection', cellInspectionAttr);
    g.setDrawRange(0, 0);
    // Permissive bounding sphere — cells live in a Gaussian field bounded
    // by SIGMA, core sprites extend a few units past that. Skipping
    // computeBoundingSphere would let frustum culling drop the entire
    // cloud at oblique angles.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 80);
    return g;
  }, [
    cellPosAttr,
    cellColorAttr,
    cellBornAtAttr,
    cellDeathAtAttr,
    cellFlashAtAttr,
    cellSizeAttr,
    cellMemoryIdentityAttr,
    cellMemorySeedAttr,
    cellDetailAttr,
    cellFocusAttr,
    cellRecallAttr,
    cellRecallStateAttr,
    cellInspectionAttr,
  ]);

  // Bind the duration uniforms once. The wall→scene-seconds conversion
  // basis is derived per-frame from (Date.now(), simClock.elapsedSec) so
  // it survives any Canvas remount because simClock is module-owned.
  useEffect(() => {
    hybridMaterial.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    hybridMaterial.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
    flareMaterial.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    flareMaterial.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
  }, [hybridMaterial, flareMaterial]);

  useEffect(() => {
    return () => {
      hybridMaterial.dispose();
      flareMaterial.dispose();
      cellGeometry.dispose();
    };
  }, [
    hybridMaterial,
    flareMaterial,
    cellGeometry,
  ]);

  useSimFrame((state, dt) => {
    const group = groupRef.current;
    if (!group) return;

    const now = simClock.elapsedSec;
    // Derive the wall→scene-seconds basis live each frame instead of
    // anchoring on mount. Canvas remounts preserve simClock.elapsedSec,
    // so a mount-time Date.now() anchor would
    // desync the shader's uTime from aBornAt/aDeathAt and cause new
    // events to render as if they had already happened.
    const sceneStartWallMs = Date.now() - now * 1000;
    const toSceneSeconds = (ms: number) => (ms - sceneStartWallMs) / 1000;

    const prevPulseAtMs = lastPulseAtMsRef.current;
    const pulseAtMs = cellsCache.lastPulseAtMs;

    // 1. Skip-or-rewrite the static per-cell buffers based on cells Map identity
    //    or quality-preset multiplier change.
    const inputsChanged =
      cellsCache.cells !== lastCellsRef.current ||
      cellGalaxyMul !== lastMulRef.current ||
      selectedCellIdRef.current !== lastPinnedCellIdRef.current;
    let cellsList = cellsListRef.current;
    let count = drawCountRef.current;
    if (inputsChanged) {
      const allCells = Array.from(cellsCache.cells.values());
      count = Math.min(
        allCells.length,
        Math.max(1, Math.floor(INSTANCE_CAPACITY * cellGalaxyMul)),
      );
      cellsList = pinSelectedCellInVisiblePrefix(
        allCells,
        count,
        selectedCellIdRef.current,
      );
      cellsListRef.current = cellsList;
      drawCountRef.current = count;
      const flashMap = cellFlashRef.current;

      writeCellBuffers(
        cellsList,
        count,
        toSceneSeconds,
        flashMap,
        {
          posArr:   cellPosAttr.array as Float32Array,
          colorArr: cellColorAttr.array as Float32Array,
          bornArr:  cellBornAtAttr.array as Float32Array,
          deathArr: cellDeathAtAttr.array as Float32Array,
          flashArr: cellFlashAtAttr.array as Float32Array,
          sizeArr:  cellSizeAttr.array as Float32Array,
          memoryIdentityArr: cellMemoryIdentityAttr.array as Float32Array,
          memorySeedArr: cellMemorySeedAttr.array as Float32Array,
        },
      );

      // Opportunistic prune: keep flashMap from leaking entries for cells
      // that have been GC'd from the cells cache.
      if (flashMap.size > count * 2 + 100) {
        const liveIds = new Set(cellsList.map((c) => c.id));
        for (const id of flashMap.keys()) {
          if (!liveIds.has(id)) flashMap.delete(id);
        }
      }

      cellGeometry.setDrawRange(0, count);
      cellPosAttr.needsUpdate = true;
      cellColorAttr.needsUpdate = true;
      cellBornAtAttr.needsUpdate = true;
      cellDeathAtAttr.needsUpdate = true;
      cellFlashAtAttr.needsUpdate = true;
      cellSizeAttr.needsUpdate = true;
      cellMemoryIdentityAttr.needsUpdate = true;
      cellMemorySeedAttr.needsUpdate = true;

      lastCellsRef.current = cellsCache.cells;
      lastMulRef.current = cellGalaxyMul;
      lastPinnedCellIdRef.current = selectedCellIdRef.current;
    }

    // 2. Topology-distance field. Its immutable snapshot changes only when
    // selection or real graph membership changes; GPU writes continue for the
    // short easing interval, then return to a zero-cost steady state.
    const inspectionField = inspectionFieldRef?.current ?? null;
    const inspectionFieldChanged =
      inspectionField !== lastInspectionFieldRef.current;
    if (inputsChanged || inspectionFieldChanged) {
      writeCellInspectionTargets(
        cellsList,
        count,
        inspectionField,
        cellInspectionTargetArr,
      );
      lastInspectionFieldRef.current = inspectionField;
      inspectionAnimatingRef.current = true;
    }
    if (inspectionAnimatingRef.current) {
      const inspectionValues = cellInspectionAttr.array as Float32Array;
      let inspectionNeedsWrite = false;
      let inspectionStillAnimating = false;
      for (let i = 0; i < count; i += 1) {
        const current = inspectionValues[i];
        const target = cellInspectionTargetArr[i];
        if (current === target) continue;
        const next = dampCellInspectionFieldScale(current, target, dt);
        inspectionValues[i] = next;
        inspectionNeedsWrite = true;
        if (next !== target) inspectionStillAnimating = true;
      }
      inspectionAnimatingRef.current = inspectionStillAnimating;
      if (inspectionNeedsWrite) cellInspectionAttr.needsUpdate = true;
    }

    // 3. Flash-only rewrite. When cells didn't change but a block event or
    //    spike arrival wrote into cellFlashRef, push the new values into
    //    the cell flash slots without redoing positions / colors / sizes.
    if (!inputsChanged && flashDirtyRef.current) {
      writeFlashSlots(
        cellsListRef.current,
        drawCountRef.current,
        cellFlashRef.current,
        cellFlashAtAttr.array as Float32Array,
      );
      cellFlashAtAttr.needsUpdate = true;
      flashDirtyRef.current = false;
    }
    if (inputsChanged) {
      // writeCellBuffers above already wrote flash slots; clear the dirty
      // flag so we don't double-write on the next frame.
      flashDirtyRef.current = false;
    }

    // 4. Material uniforms.
    const pointPixelRatio = resolvePointSpritePixelRatio(
      state.gl.getPixelRatio(),
    );
    const pointViewportHeight = pointSpriteDeviceViewportHeight(
      state.size.height,
      pointPixelRatio,
    );
    hybridMaterial.uniforms.uTime.value = now;
    hybridMaterial.uniforms.uViewportHeight.value = pointViewportHeight;
    hybridMaterial.uniforms.uPixelRatio.value = pointPixelRatio;
    hybridMaterial.uniforms.uMemoryMinPointPx.value = memorySignal.coreMinPx;
    hybridMaterial.uniforms.uMemoryLinePx.value = memorySignal.compactLinePx;
    hybridMaterial.uniforms.uMemorySignalEnergy.value = memorySignal.energyScale;
    // Live shockwave boosts/ceils (Galaxy panel). Written every frame — not in
    // the block-fire trigger below — so a knob dragged mid-wave takes effect on
    // the in-flight wave, not just the next block. Defaults in LIVE.galaxy.*
    // equal the shipped literals, so with the panel closed these are byte-exact
    // self-writes (zero drift).
    hybridMaterial.uniforms.uShockwaveColorBoost.value = LIVE.galaxy.colorBoost;
    hybridMaterial.uniforms.uShockwaveAlphaBoost.value = LIVE.galaxy.alphaBoost;
    hybridMaterial.uniforms.uShockwaveColorCeil.value = LIVE.galaxy.colorCeil;
    hybridMaterial.uniforms.uShockwaveAlphaCeil.value = LIVE.galaxy.alphaCeil;
    hybridMaterial.uniforms.uShockwaveSizeBoost.value = LIVE.galaxy.sizeBoost;
    hybridMaterial.uniforms.uShockwaveTrailBoost.value = LIVE.galaxy.trailBoost;
    hybridMaterial.uniforms.uWarmth.value = LIVE.cell.warmth; // hash-stable A hue → gold bias
    hybridMaterial.uniforms.uCenterDim.value = LIVE.cell.centerDim; // shared centre-energy floor
    flareMaterial.uniforms.uTime.value = now;
    flareMaterial.uniforms.uViewportHeight.value = pointViewportHeight;
    flareMaterial.uniforms.uDischargeArms.value = dischargeArms;
    if (pulseAtMs > prevPulseAtMs) {
      lastPulseAtMsRef.current = pulseAtMs;
      // Per-block effects fire here.

      // Select the miner CKB node (round-robin). Round-robin only across
      // miner ids so the animation never fires from a sync-only node.
      // Falls back to the full node list when the caller hasn't supplied
      // miner ids (tests / placeholder profile).
      const sourcePool =
        minerCkbNodeIds && minerCkbNodeIds.length > 0
          ? minerCkbNodeIds
          : ckbNodeIds;
      if (sourcePool.length > 0) {
        const sourceId = sourcePool[blockOriginIdxRef.current % sourcePool.length];
        blockOriginIdxRef.current = (blockOriginIdxRef.current + 1) >>> 0;
        const idx = ckbNodeIds.indexOf(sourceId);
        const safeIdx = idx >= 0 ? idx : 0;
        // World-space origin of this block's miner icosahedron.
        const worldOrigin = chainNodeWorldPosition(
          safeIdx,
          Math.max(1, ckbNodeIds.length),
          universeSeed,
        );

        // The local node is not a miner: it APPLIES a block it received from a
        // peer. Delay the whole ledger reaction by localReceiveDelayS (the entry
        // peer's latency-derived arrival + relay hop) so the canopy lights up when
        // we receive the block — the courier reaches the hub — not at the raw
        // pulse instant. Zero when we have no peer to receive from.
        const receiveDelayS = localReceiveDelayS;
        const blockTriggerSceneS = simClock.elapsedSec + receiveDelayS;
        const blockColor = consensusBlockColor(pulseAtMs);

        // The canopy brightness wave is owned by the caller-supplied entry point
        // (see selectWaveAnchor): fire the wave (shockwave ring + ring-swept cell
        // highlights) from that position + receive time so it sweeps outward from
        // the entry and reaches the local cells naturally. In the ckb-rcg sibling
        // the entry is the ENTRY PEER, so the wave departs ~BLOCK_RELAY_HOP_S
        // earlier than the local apply (off-center); in the cknerv colony caller
        // entryWorld IS the local node with entryArrivalS == localReceiveDelayS,
        // so the wave and the local apply coincide. Falls back to the local node
        // when there is no entry. The local reaction below (halo/local-ignition)
        // keeps the local origin + blockTriggerSceneS regardless.
        const { origin: waveOrigin, triggerSceneS: waveTriggerSceneS } =
          selectWaveAnchor(
            entryWorld,
            entryArrivalS,
            simClock.elapsedSec,
            worldOrigin,
            blockTriggerSceneS,
          );

        // Block trigger: anchored at the local node icosahedron (it applies
        // the received block). Used by consensus routes' shockwave-delay pathway
        // and by the icosahedron's own halo flash envelope.
        blockEventRef.current = {
          firedAt: blockTriggerSceneS,
          origin: worldOrigin,
          color: blockColor,
        };
        const flashSlot = chainNodeFlashRefs[safeIdx];
        if (flashSlot) {
          flashSlot.current = { firedAt: blockTriggerSceneS, color: blockColor };
        }

        // Fire the canopy brightness shockwave: a fragment-shader ring
        // expanding outward from (waveOrigin.xz = the entry peer) at
        // uShockwaveSpeed (matched to PULSE_PROPAGATION_VELOCITY =
        // SHOCKWAVE_SPEED) for uShockwaveDurS (sized to reach the outer galaxy
        // rim). Fire at SHOCKWAVE_FIRE_DELAY_S past the entry peer's receive
        // (= its beam completion), so the ring departs after that column has
        // fully completed instead of competing with the beam body. The shader's
        // `if (age < 0.0) return 0.0;` keeps the ring invisible until that moment.
        const fireT = waveTriggerSceneS + SHOCKWAVE_FIRE_DELAY_S;
        // Round-robin into the shader ring buffer so a new wave doesn't
        // cancel any still in flight from earlier blocks. In-place
        // Float32Array mutation is picked up by three.js's per-frame
        // element-wise uniform cache check.
        const slot = shockSlotRef.current;
        shockSlotRef.current = (slot + 1) % SHOCKWAVE_SLOTS;
        const coreAt = hybridMaterial.uniforms.uShockwaveAt.value as Float32Array;
        const coreXZ = hybridMaterial.uniforms.uShockwaveOriginXZ.value as Float32Array;
        const coreColor = hybridMaterial.uniforms.uShockwaveColor.value as Float32Array;
        writeShockwaveSlot(
          coreAt,
          coreXZ,
          coreColor,
          slot,
          fireT,
          [waveOrigin[0], waveOrigin[2]],
          blockColor,
        );
        // Block-cell highlight: schedule a flash on every cell touched
        // by this block, timed to the moment the visible canopy
        // shockwave ring sweeps that cell. Each cell ignites just
        // before NervePulses' input→output trail starts growing out of
        // it (NervePulses adds BLOCK_HIGHLIGHT_LEAD_S on top of the
        // same shockwave-arrival time). Together: ring sweeps cell →
        // cell ignites → trail departs → trail lands → target flash +
        // protocol write seal.
        //
        // Distance is measured in the rotating local frame (where pos_seed
        // lives), so we project each origin's xz through the inverse y-rotation.
        // Two origins now: the wave (entry peer) drives the ring-swept block-cell
        // highlights; the local node drives the local-ignition sweep below.
        const groupRotY = group.rotation.y;
        const cosTinv = Math.cos(-groupRotY);
        const sinTinv = Math.sin(-groupRotY);
        const waveOriginLocalX = waveOrigin[0] * cosTinv - waveOrigin[2] * sinTinv;
        const waveOriginLocalZ = waveOrigin[0] * sinTinv + waveOrigin[2] * cosTinv;
        const originLocalX = worldOrigin[0] * cosTinv - worldOrigin[2] * sinTinv;
        const originLocalZ = worldOrigin[0] * sinTinv + worldOrigin[2] * cosTinv;
        const freshLinks = cellsCache.recentLinks.filter(
          (lk) => lk.at_ms >= prevPulseAtMs,
        );
        const seenCells = new Set<number>();
        let highlights = 0;
        outer: for (const lk of freshLinks) {
          for (const cellId of [...lk.from_ids, ...lk.to_ids]) {
            if (highlights >= MAX_BLOCK_HIGHLIGHTS) break outer;
            if (seenCells.has(cellId)) continue;
            seenCells.add(cellId);
            const cell = cellsCache.cells.get(cellId);
            if (!cell) continue;
            const dx = cell.pos_seed[0] - waveOriginLocalX;
            const dz = cell.pos_seed[2] - waveOriginLocalZ;
            const dist = Math.hypot(dx, dz);
            const flashAtS =
              waveTriggerSceneS + SHOCKWAVE_FIRE_DELAY_S + dist / SHOCKWAVE_SPEED;
            const prev = cellFlashRef.current.get(cellId) ?? -1e9;
            if (flashAtS > prev) {
              cellFlashRef.current.set(cellId, flashAtS);
              flashDirtyRef.current = true;
            }
            highlights += 1;
          }
        }

        // Local-ignition pass: at the strike moment (block trigger +
        // BEAM_GROW_DUR_S), cells geographically near the impact xz
        // ignite in a fast radial sweep at LOCAL_IGNITION_SPEED. This
        // bridges the "beam → cells" narrative — cells visibly
        // *receive* the injected energy at the strike moment, before
        // the slower canopy shockwave begins its much wider sweep at
        // SHOCKWAVE_FIRE_DELAY_S. Iterates all live cells (not just
        // freshLinks) so geography wins over transaction membership;
        // for cells in both sets the ignition overrides the slower
        // shockwave-aligned flash because the strike-time ignition is
        // the closer cause and reads better visually.
        const strikeSceneS = blockTriggerSceneS + BEAM_GROW_DUR_S;
        const radiusSq = LOCAL_IGNITION_RADIUS * LOCAL_IGNITION_RADIUS;
        let ignited = 0;
        for (const cell of cellsCache.cells.values()) {
          if (ignited >= MAX_LOCAL_IGNITIONS) break;
          const dx = cell.pos_seed[0] - originLocalX;
          const dz = cell.pos_seed[2] - originLocalZ;
          const distSq = dx * dx + dz * dz;
          if (distSq > radiusSq) continue;
          const dist = Math.sqrt(distSq);
          const flashAtS = strikeSceneS + dist / LOCAL_IGNITION_SPEED;
          cellFlashRef.current.set(cell.id, flashAtS);
          flashDirtyRef.current = true;
          ignited += 1;
        }
      }
    }

    // 7. Group rotation.
    galaxyRotationScaleRef.current = dampCellGalaxyRotationScale(
      galaxyRotationScaleRef.current,
      cellGalaxyRotationScaleTarget(selectedCellIdRef.current),
      dt,
    );
    group.rotation.y += LIVE.galaxy.rotationRate
      * galaxyRotationScaleRef.current
      * dt;
    groupRotationYRef.current = group.rotation.y;
    // Mirror to the shared frame so sibling layers (BlockDeliveryLayer) can
    // project world landings into this rotating cell frame.
    galaxyFrame.rotationY = group.rotation.y;
  });

  return (
    <>
      {/* Cells galaxy — flat hybrid Crab+MW canopy at CELLS_Y, the
          top layer above the chain mesh. Slow rotation gives the
          arms a living-galaxy feel. The cube + ripple animation
          lives in world space (below) so it can span chain → cells
          planes. */}
      <group ref={groupRef} position={[0, CELLS_Y, 0]}>
        <points
          geometry={cellGeometry}
          material={hybridMaterial}
          frustumCulled={false}
        />
        {/* Co-located protocol-write signal — shares the cell geometry (so the
            per-frame aFlashAt writes feed it for free) and renders only the
            contributor rails + agreement loops over a steady cell body. */}
        <points
          geometry={cellGeometry}
          material={flareMaterial}
          frustumCulled={false}
          renderOrder={1}
        />
        <ConsensusMemoryFocusScope>
          {/* Consumer-supplied overlay — the default app supplies consensus
              routes + write seals here; chain-generic consumers can leave this
              empty or pass their own overlay layers. Lives inside the
              rotating group so overlay layers share the cells' xz layout
              and rotate with the canopy. */}
          {overlay}

          {/* Production A language: far = hash-stable consensus light;
              mid = contributor paths; near = stitches + agreement knots. */}
          <CellNucleus
            cellsListRef={cellsListRef}
            drawCountRef={drawCountRef}
            groupRef={groupRef}
            detailAttr={cellDetailAttr}
            focusAttr={cellFocusAttr}
            recallAttr={cellRecallAttr}
            recallStateAttr={cellRecallStateAttr}
            selectedCellIdRef={selectedCellIdRef}
            hoveredCellIdRef={hoveredCellIdRef}
          />
          {identityProof && identityProofCell ? (
            <CellIdentityProofMarker
              cell={identityProofCell}
              event={identityProof}
              sampleElapsedSeconds={identityProofSampleElapsedSeconds}
            />
          ) : null}
          {identityProofBinding && identityProofBindingCell ? (
            <CellIdentityBindingMarker
              cell={identityProofBindingCell}
              binding={identityProofBinding}
            />
          ) : null}
        </ConsensusMemoryFocusScope>
        {/* Screen-space cell picker — replaces the legacy InstancedMesh
            sphere hitbox. Lives inside the rotating group so cell
            pos_seed (local frame) projects through the same world
            transform the visible core / braid layers use. */}
        <CellPicker
          cellsListRef={cellsListRef}
          selectedCellIdRef={selectedCellIdRef}
          hoveredCellIdRef={hoveredCellIdRef}
          onSelect={onSelect}
        />
      </group>

      {/* The old geometric block decoration is retired. CkbNodeAnchor exposes
          only the protocol carrier hue; BlockDeliveryLayer and the canopy
          wave continue that same identity into the Cell field. */}

      {/* Static icosahedra at chain-layer world positions. Each
          receives its own flashRef so it can light up when it sources
          a block. */}
      {ckbNodeIds.map((id, idx) => (
        <CkbNodeAnchor
          key={id}
          id={id}
          position={chainNodeWorldPosition(idx, Math.max(1, ckbNodeIds.length), universeSeed)}
          selected={selectedId === id}
          onSelect={onSelect}
          flashRef={chainNodeFlashRefs[idx]}
        />
      ))}
    </>
  );
}
