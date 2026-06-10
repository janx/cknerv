import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useControls } from 'leva';
import { useThree } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { QUALITY_PRESETS } from '../tweaks/qualityPresets';
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
import { SHOCKWAVE_SLOTS } from '../materials/shockwaveMaterial';
import { makeCellHybridMaterial } from '../materials/cellHybridMaterial';
import {
  CELLS_Y,
  chainNodeWorldPosition,
} from '../layout';
import { BLOCK_RECEIVE_S } from '../derives/peers.derive';

/** Cyan palette for the structural chain anchor (CKB icosahedron).
 *  The chain anchor reads as "structural backbone / chain truth" and
 *  stays visually distinct from the soft peripheral tissue of the RCG
 *  satellite kinds. Particles emitted from a chain anchor inherit this
 *  palette so they match the anchor itself. Kept in sync with the `ckb`
 *  entry of `_rcg/glowNodePalette.ts` — tune both together. */
const CHAIN_ANCHOR_PALETTE = { edge: '#7df9ff', halo: '#22d3ee', fill: '#0e7490' };
import CellShell, { GENERIC_SHELL_SIZE, TAGGED_SHELL_SIZE } from './CellShell';
import CellLifeAvatar from './CellLifeAvatar';
import BlockBeam from './BlockBeam';

// ---------------------------------------------------------------------------
// Block trigger — written by CellGalaxy on every block, consumed by:
//   • NervePulses (shockwave-delay timing for cell→cell pulses)
//   • CkbNodeAnchor (icosahedron halo flash)
//   • cellHybridMaterial / CellShell — fragment-shader rings expanding
//     outward from the miner anchor that brighten existing cells / shells
//     as they pass.
// The geometric block-cube + particle-burst was removed; the canopy
// shockwave (this brightness ring) and the icosahedron neural
// discharge are what carry the block visually now.
// ---------------------------------------------------------------------------

export interface BlockEventTrigger {
  /** `simClock.elapsedSec` when the trigger fired (sim-time-relative). */
  firedAt: number;
  /** World-space anchor of the originating CKB node. */
  origin: [number, number, number];
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
  onSelect: (id: string | null) => void;
  /** Map of cell.id → most-recent scene-seconds flash time. Owned by the
   *  consumer so overlay layers (e.g. RCG's NeuralNetwork) can write into
   *  the same buffer that CellGalaxy's block-event highlights feed and
   *  that CellShell consumes per frame. */
  cellFlashRef: React.MutableRefObject<Map<number, number>>;
  /** Set true whenever cellFlashRef gains an entry that should appear on
   *  the next frame. Cleared after the per-cell write loop runs. Lets
   *  flash-only updates bypass the cells-identity skip in useSimFrame
   *  without forcing a full per-cell rewrite. */
  flashDirtyRef: React.MutableRefObject<boolean>;
  /** Optional overlay rendered inside the cell galaxy's rotating
   *  world-space group. Used by consumers to add domain-specific
   *  animations (e.g. RCG's NeuralNetwork + DendriticBurst) atop the
   *  cell field without coupling CellGalaxy to non-generic components. */
  overlay?: ReactNode;
  /** True when the local node has peers, i.e. a block actually arrives FROM a
   *  peer. CellGalaxy then delays its whole block reaction by BLOCK_RECEIVE_S
   *  (the receive leg) so the canopy lights up when the local node RECEIVES
   *  the block, not at the raw pulse instant. False (no peers) → fire at t=0. */
  receivesFromPeer?: boolean;
}

/** Per-tag palette. The cell-galaxy projection ships opaque tag strings
 *  ("wallet" | "dex" | "cf" | "ckbloom" in the simulator); colour lookup
 *  is a runtime map on the SPA. Unknown tags fall back to GENERIC_COLOR. */
const COLOR_BY_TAG: Record<string, [number, number, number]> = {
  ckbloom: [0.94, 0.67, 0.99],   // #f0abfc
  dex:     [0.99, 0.83, 0.30],   // #fcd34d
  cf:      [0.99, 0.64, 0.69],   // #fda4af
  wallet:  [0.43, 0.91, 0.72],   // #6ee7b7
};
const GENERIC_COLOR: [number, number, number] = [0.62, 0.78, 1.0]; // pale star-blue
const ROTATION_RATE = 0.005; // rad/s

// Cell point sizes in world units. The hybrid shader draws the anchored
// core/glow sprite, and CellShell draws the faceted exterior around it.
const GENERIC_CELL_POINT_SIZE = 1.6;
const TAGGED_CELL_POINT_SIZE = 3.0;

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

export interface CellBufferTargets {
  /** Shared per-cell attribute arrays consumed by the hybrid Points layer. */
  posArr:   Float32Array;
  colorArr: Float32Array;
  bornArr:  Float32Array;
  deathArr: Float32Array;
  flashArr: Float32Array;
  sizeArr:  Float32Array;
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

    const color = (c.tag !== null && COLOR_BY_TAG[c.tag]) || GENERIC_COLOR;
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
  flashRef?: { current: { firedAt: number } | null };
}) {
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
      }
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
//   • The visible cell footprint (shell wireframe + anchored core sprite) is tiny
//     in world units (≤ ~0.25 world units shell, ~1.6–3.0 point size) but ~5–15 px
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
//   pickRadius_px = max(cellPointHalfExtent_px, shellCircumradius_px)
// where both terms come from the live shaders' world→screen mapping:
//   gl_PointSize ≈ aSize × 2 × (viewportHeight/2) / viewZ   (hybrid core sprite)
//   shellR_world = aSize_shell × shellScale            (CellShell.tsx)
// Zoom in → cells appear bigger → pick radius grows the same way.
// Increase `shellScale` → shell grows → pick radius grows. No constant
// slop term — what you see is what you click.
//
// Performance: O(N) projections per click, no per-frame cost. N ≤ 6000
// (INSTANCE_CAPACITY); each iteration is a couple of Vector3 mul+project
// — sub-ms on commodity hardware.

interface CellPickerProps {
  cellsListRef: React.MutableRefObject<Cell[]>;
  onSelect: (id: string | null) => void;
}

/** Custom Object3D that participates in r3f's raycast pipeline. Its
 *  `raycast()` projects every live cell's pos_seed to screen and pushes
 *  an intersect for the cell whose own visual radius covers the click.
 *  The intersect carries `instanceId` so the existing `cell:${id}`
 *  selection contract is preserved. */
function CellPicker({ cellsListRef, onSelect }: CellPickerProps) {
  const ref = useRef<THREE.Object3D>(null);
  const { size } = useThree();
  // Subscribe to the same `shellScale` knob CellShell.tsx uses. Leva
  // dedupes by folder+key, so we read the live value without
  // duplicating the panel UI and the click radius tracks the shell
  // exactly as the user resizes it.
  const { shellScale } = useControls('Cell Shell', {
    shellScale: { value: 1.0, min: 0.1, max: 3.0, step: 0.05, label: 'scale' },
  });
  // Live refs so the raycast closure reads the current viewport and
  // shellScale without having to rebind on every change.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const shellScaleRef = useRef(shellScale);
  shellScaleRef.current = shellScale;

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
      const liveShellScale = shellScaleRef.current;

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
        //   shell circumradius (px) = shellWorldR × halfH / viewZ
        //     — matches the CellShell vertex shader where the
        //     truncated-octahedron's max vertex norm is aSize × scale.
        // Take the larger so neither layer can leak outside the
        // clickable area. No constant slop — strictly visual.
        const isTagged = c.tag !== null;
        const cellPointAsize = isTagged ? TAGGED_CELL_POINT_SIZE : GENERIC_CELL_POINT_SIZE;
        const shellWorldR =
          (isTagged ? TAGGED_SHELL_SIZE : GENERIC_SHELL_SIZE) * liveShellScale;
        const depthToPx = halfH / viewZ;
        const cellPointPxR = cellPointAsize * depthToPx;
        const shellPxR = shellWorldR * depthToPx;
        const pickPxR = cellPointPxR > shellPxR ? cellPointPxR : shellPxR;
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
  }, [cellsListRef]);

  return (
    <object3D
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        if (typeof e.instanceId !== 'number') return;
        const cell = cellsListRef.current[e.instanceId];
        if (!cell) return;
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
 * Pure visual layer; never re-renders React on event arrival — owns its
 * own state in a ref and writes per-frame into the Points BufferGeometry
 * attribute buffers. The reducer is pulled from the cellGalaxy module;
 * `cellHybridMaterial` renders the anchored cell core/glow sprite.
 *
 * Each cell is rendered as one anchored hybrid Points sprite plus its
 * CellShell wireframe. Block shockwaves brighten/expand that existing
 * core and shell; no separate drifted halo Points layer is mounted.
 */
export default function CellGalaxy({ ckbNodeIds, minerCkbNodeIds, universeSeed, selectedId, onSelect, cellFlashRef, flashDirtyRef, overlay, receivesFromPeer = false }: CellGalaxyProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Server-driven cell list. The component is now a pure visual layer:
  // it reads cells from the cache and writes their xyz / born / death
  // attributes into the Points BufferGeometry each frame. Birth / death / tag
  // are reduced server-side in `simulator/src/dashboard/projections/cells.rs`.
  const cellsCache = useCellGalaxy();
  const { quality } = useControls('Time', {
    quality: {
      value: 'high' as 'high' | 'med' | 'low',
      options: ['high', 'med', 'low'] as const,
    },
  });
  const cellGalaxyMul = QUALITY_PRESETS[quality].cellGalaxyMul;
  const dischargeArms = QUALITY_PRESETS[quality].dischargeArms;
  // Subscribe to the same `shellScale` knob CellShell / CellPicker use.
  // Leva dedupes by folder+key, so reading here does not duplicate the
  // panel control — we just get a stable live value to forward into
  // CellLifeAvatar so its billboard size tracks the shell.
  const { shellScale } = useControls('Cell Shell', {
    shellScale: { value: 1.0, min: 0.1, max: 3.0, step: 0.05, label: 'scale' },
  });
  /** Per-frame mirror of the cellsList iteration order, written by
   *  `useFrame` below. `CellPicker` reads this ref each click so it
   *  sees the current frame's cells — an inline closure would otherwise
   *  capture only the initial render's data. The pick-time `instanceId`
   *  indexes into this array exactly the way the legacy InstancedMesh
   *  hitbox's `e.instanceId` did, so the `cell:${id}` selection
   *  contract is preserved. */
  const cellsListRef = useRef<Cell[]>([]);
  /** Identity of the cells Map last seen by useSimFrame. When
   *  cellsCache.cells === lastCellsRef.current, no birth/death/tag/gc
   *  delta has landed since our previous frame, so the static per-cell
   *  buffers (positions, colors, born/death, flash, size) are still
   *  valid — we skip writeCellBuffers and the matching needsUpdate
   *  flags. Pulse-only frames (which mutate lastPulseAtMs but leave
   *  the cells Map identity-stable) ride the skip path. */
  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  /** Last-seen `cellGalaxyMul` (from the leva quality preset). Including
   *  this in the change predicate keeps the skip-path correct when the
   *  user toggles quality between high/med/low while cells are stable —
   *  otherwise `cellGeometry.setDrawRange` stays at the old preset
   *  until the next birth/death/tag/gc delta lands. */
  const lastMulRef = useRef<number>(0);
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
      ({ current: null as { firedAt: number } | null }),
    );
  }, [ckbNodeIds]);
  /** Per-node BlockBeam trigger — same shape as chainNodeFlashRefs.
   *  CellGalaxy writes when the local node applies the received block;
   *  BlockBeam drains. Indexed by `ckbNodeIds.indexOf(sourceId)`. */
  const chainNodeBeamRefs = useMemo(() => {
    return ckbNodeIds.map(() =>
      ({ current: null as { firedAt: number } | null }),
    );
  }, [ckbNodeIds]);
  // Round-robin origin selector: blocks rotate through known CKB nodes so
  // the animation visibly samples the network rather than always firing
  // from the same anchor.
  const blockOriginIdxRef = useRef<number>(0);
  // Round-robin shockwave slot. The cell core/shell shaders own a
  // SHOCKWAVE_SLOTS-sized ring buffer of (fireAt, originXZ); each new
  // block trigger writes into the next slot so concurrent in-flight
  // waves coexist instead of cancelling each other (mesh profile fires
  // blocks every ~2 s while each wave lives 5 s, so ~3 waves are alive
  // at once).
  const shockSlotRef = useRef<number>(0);
  const shellShockwaveUniformsRef = useRef<{
    at: Float32Array;
    originXZ: Float32Array;
  } | null>(null);
  /** Mirrors `groupRef.current.rotation.y` each frame so child
   *  components (NervePulses) can project world-frame anchors into the
   *  cells-group's rotating local frame without traversing the
   *  Three.js scene graph. */
  const groupRotationYRef = useRef<number>(0);

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

  const hybridMaterial = useMemo(() => makeCellHybridMaterial(), []);

  const cellGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', cellPosAttr);
    g.setAttribute('aColor', cellColorAttr);
    g.setAttribute('aBornAt', cellBornAtAttr);
    g.setAttribute('aDeathAt', cellDeathAtAttr);
    g.setAttribute('aFlashAt', cellFlashAtAttr);
    g.setAttribute('aSize', cellSizeAttr);
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
  ]);

  // Bind the duration uniforms once. The wall→scene-seconds conversion
  // basis is derived per-frame from (Date.now(), simClock.elapsedSec) so
  // it survives Canvas remounts (e.g. quality toggles, which preserve
  // simClock by design).
  useEffect(() => {
    hybridMaterial.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    hybridMaterial.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
  }, [hybridMaterial]);

  useEffect(() => {
    return () => {
      hybridMaterial.dispose();
      cellGeometry.dispose();
    };
  }, [
    hybridMaterial,
    cellGeometry,
  ]);

  useSimFrame((state, dt) => {
    const group = groupRef.current;
    if (!group) return;

    const now = simClock.elapsedSec;
    // Derive the wall→scene-seconds basis live each frame instead of
    // anchoring on mount. Canvas remounts (quality toggle) preserve
    // simClock.elapsedSec, so a mount-time Date.now() anchor would
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
      cellGalaxyMul !== lastMulRef.current;
    let cellsList = cellsListRef.current;
    let count = drawCountRef.current;
    if (inputsChanged) {
      cellsList = Array.from(cellsCache.cells.values());
      cellsListRef.current = cellsList;
      count = Math.min(
        cellsList.length,
        Math.max(1, Math.floor(INSTANCE_CAPACITY * cellGalaxyMul)),
      );
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

      lastCellsRef.current = cellsCache.cells;
      lastMulRef.current = cellGalaxyMul;
    }

    // 2. Flash-only rewrite. When cells didn't change but a block event or
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

    // 3. Material uniforms.
    hybridMaterial.uniforms.uTime.value = now;
    hybridMaterial.uniforms.uDischargeArms.value = dischargeArms;
    hybridMaterial.uniforms.uViewportHeight.value = state.size.height;
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
        // peer. Delay the whole ledger reaction by the receive leg so the
        // canopy lights up when we receive (the courier reaches the hub), not
        // at the raw pulse instant. Zero when we have no peer to receive from.
        const receiveDelayS = receivesFromPeer ? BLOCK_RECEIVE_S : 0;
        const blockTriggerSceneS = simClock.elapsedSec + receiveDelayS;

        // Block trigger: anchored at the local node icosahedron (it applies
        // the received block). Used by NervePulses' shockwave-delay pathway
        // and by the icosahedron's own halo flash envelope.
        blockEventRef.current = {
          firedAt: blockTriggerSceneS,
          origin: worldOrigin,
        };
        const flashSlot = chainNodeFlashRefs[safeIdx];
        if (flashSlot) {
          flashSlot.current = { firedAt: blockTriggerSceneS };
        }
        const beamSlot = chainNodeBeamRefs[safeIdx];
        if (beamSlot) {
          beamSlot.current = { firedAt: blockTriggerSceneS };
        }

        // Fire the canopy brightness shockwave: a fragment-shader ring
        // expanding outward from (worldOrigin.xz) at uShockwaveSpeed
        // (matched to PULSE_PROPAGATION_VELOCITY = SHOCKWAVE_SPEED) for
        // uShockwaveDurS (sized to reach the outer galaxy rim). Delay
        // Fire at SHOCKWAVE_FIRE_DELAY_S (= beam completion), so the ring
        // departs after the column has fully completed instead of competing
        // with the beam body. The shader's `if (age < 0.0) return 0.0;`
        // keeps the ring invisible until that moment.
        const fireT = blockTriggerSceneS + SHOCKWAVE_FIRE_DELAY_S;
        // Round-robin into the shader ring buffer so a new wave doesn't
        // cancel any still in flight from earlier blocks. In-place
        // Float32Array mutation is picked up by three.js's per-frame
        // element-wise uniform cache check.
        const slot = shockSlotRef.current;
        shockSlotRef.current = (slot + 1) % SHOCKWAVE_SLOTS;
        const coreAt = hybridMaterial.uniforms.uShockwaveAt.value as Float32Array;
        const coreXZ = hybridMaterial.uniforms.uShockwaveOriginXZ.value as Float32Array;
        coreAt[slot] = fireT;
        coreXZ[slot * 2] = worldOrigin[0];
        coreXZ[slot * 2 + 1] = worldOrigin[2];
        const shellWave = shellShockwaveUniformsRef.current;
        if (shellWave) {
          shellWave.at[slot] = fireT;
          shellWave.originXZ[slot * 2] = worldOrigin[0];
          shellWave.originXZ[slot * 2 + 1] = worldOrigin[2];
        }
        // Block-cell highlight: schedule a flash on every cell touched
        // by this block, timed to the moment the visible canopy
        // shockwave ring sweeps that cell. Each cell ignites just
        // before NervePulses' input→output trail starts growing out of
        // it (NervePulses adds BLOCK_HIGHLIGHT_LEAD_S on top of the
        // same shockwave-arrival time). Together: ring sweeps cell →
        // cell ignites → trail departs → trail lands → target flash +
        // DendriticBurst.
        //
        // Distance is measured in the rotating local frame (where
        // pos_seed lives), so we project worldOrigin.xz through the
        // inverse y-rotation. group.rotation.y is the same value
        // groupRotationYRef carries to NervePulses' shockwave-defer,
        // so both code paths agree on dist.
        const groupRotY = group.rotation.y;
        const cosTinv = Math.cos(-groupRotY);
        const sinTinv = Math.sin(-groupRotY);
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
            const dx = cell.pos_seed[0] - originLocalX;
            const dz = cell.pos_seed[2] - originLocalZ;
            const dist = Math.hypot(dx, dz);
            const flashAtS =
              blockTriggerSceneS + SHOCKWAVE_FIRE_DELAY_S + dist / SHOCKWAVE_SPEED;
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
    group.rotation.y += ROTATION_RATE * dt;
    groupRotationYRef.current = group.rotation.y;
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
        {/* Consumer-supplied overlay — RCG supplies NeuralNetwork +
            DendriticBurst here; chain-generic consumers can leave this
            empty or pass their own overlay layers. Lives inside the
            rotating group so overlay layers share the cells' xz layout
            and rotate with the canopy. */}
        {overlay}

        <CellShell
          cellFlashRef={cellFlashRef}
          flashDirtyRef={flashDirtyRef}
          shockwaveUniformsRef={shellShockwaveUniformsRef}
        />

        <CellLifeAvatar shellScale={shellScale} />

        {/* Screen-space cell picker — replaces the legacy InstancedMesh
            sphere hitbox. Lives inside the rotating group so cell
            pos_seed (local frame) projects through the same world
            transform the visible core / shell layers use. */}
        <CellPicker cellsListRef={cellsListRef} onSelect={onSelect} />
      </group>

      {/* No more geometric block decoration — the block-cube,
          dissolve cloud, and canopy ripple ring were retired in N1.
          The visible "block landed" cue now lives in the
          source CKB icosahedron's neural discharge (scale pump +
          radial spark rays + brightness flash inside CkbNodeAnchor),
          which reads as a firing neuron rather than a mechanical
          packet emerging from a cube. */}

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
      {/* Per-node energy column — fires when the local node applies a
          received block, growing from the icosahedron up to the cell plane,
          then a strike-splash blooms at the impact point right before the
          canopy shockwave departs from the same point. Mounted in world space
          (outside the rotating cells group) so the column stays anchored
          to its node icosahedron regardless of canopy rotation. */}
      {ckbNodeIds.map((id, idx) => (
        <BlockBeam
          key={`beam:${id}`}
          originWorld={chainNodeWorldPosition(idx, Math.max(1, ckbNodeIds.length), universeSeed)}
          targetY={CELLS_Y}
          fireRef={chainNodeBeamRefs[idx]}
        />
      ))}
    </>
  );
}
