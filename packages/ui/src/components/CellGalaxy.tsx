import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import { LIVE } from '../tweaks/liveTweaks';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import {
  resolveCellDisplayLimit,
  useCellDisplayRuntime,
} from '../tweaks/cellDisplay';
import { Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';

import type { Vec3 } from '../types';
import { makeHaloMaterial, phaseFor } from './GlowNode';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  INSTANCE_CAPACITY,
} from '../geometry/cellPositions';
import {
  createCellRenderSetState,
  currentActivityCellIds,
  diffCellRenderSlots,
  syncCellRenderSet,
  type CellRenderRange,
} from '../geometry/cellRenderSet';
import {
  createCellSlotState,
  syncCellSlots,
} from '../geometry/cellSlotAssignment';
import { ScreenSpaceHitIndex } from '../geometry/screenSpaceHitIndex';
export {
  pinCellInspectionFieldInVisiblePrefix,
  pinSelectedCellInVisiblePrefix,
} from '../geometry/cellRenderSet';
import type { Cell, GalaxyCompositionRecord } from '@cknerv/types';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { ConsensusMemoryFocusScope } from '../hooks/consensusMemoryFocusContext';
import {
  capacityMass,
  deriveCellVisual,
  hasCellTagAccent,
} from '../derives/cellVisual.derive';
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
  cellCanvasCursor,
  cellGalaxyRotationScaleTarget,
  cellFocusTarget,
  cellPickRadiusPx,
  consensusBraidRenderScale,
  dampCellGalaxyRotationScale,
  selectedCellNumericId,
} from '../derives/cellInteraction.derive';
import {
  CELL_INSPECTION_NAVIGATION_SIZE_SCALE,
  makeCellHybridMaterial,
} from '../materials/cellHybridMaterial';
import { makeCellFlareMaterial } from '../materials/cellFlareMaterial';
import { CELL_FLASH_DURATION_S } from '../materials/cellEnvelope.glsl';
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
import CanonicalRewriteEcho from './CanonicalRewriteEcho';
import {
  cellInspectionDirectNavigationRole,
  cellInspectionBodyTransitionBlend,
  cellInspectionFieldScale,
  cellInspectionNavigationTarget,
  CELL_INSPECTION_BODY_TRANSITION_SECONDS,
  type CellInspectionField,
} from '../nerve/cellInspectionField';
import { deriveCanonicalRewriteArrivals } from '../derives/canonicalRewrite.derive';
import {
  cellIdsWithinRadiusFromIndex,
  sharedCellNearestIndex,
} from '../derives/peers.derive';
import {
  collectCellFlashCandidates,
  markCellFlashDirty,
  mergeCellFlashRanges,
  writeActiveCellFlashIndicesFromCandidates,
  writeDirtyCellFlashSlots,
  type CellFlashDirtyIdsRef,
} from './cellFlash';
import { markPopulatedBufferUpdate } from '../geometry/populatedBufferAttribute';

/** Cyan palette for the structural chain anchor (CKB icosahedron).
 *  The chain anchor reads as "structural backbone / chain truth" and
 *  stays visually distinct from the Cell consensus field. Its resting
 *  structure remains cyan while a block event temporarily carries that
 *  block's A-lane hue. Kept in sync with the `ckb`
 *  entry of `_rcg/glowNodePalette.ts` — tune both together. */
const CHAIN_ANCHOR_PALETTE = { edge: '#7df9ff', halo: '#22d3ee', fill: '#0e7490' };
// Pre-parsed rest halo: the anchor frame loop re-asserts uColor every frame,
// and THREE's CSS-string parse is measurable at that rate.
const CHAIN_ANCHOR_HALO_COLOR = new THREE.Color(CHAIN_ANCHOR_PALETTE.halo);
import CellNucleus from './CellNucleus';

// ---------------------------------------------------------------------------
// Portable block trigger shape retained for overlay consumers. CellGalaxy uses
// the same event identity for its exact delivery/commit flashes; the broad
// brightness shockwave is owned and rendered by the P2P colony.
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
  BLOCK_COMMIT_DELAY_S,
  LOCAL_IGNITION_RADIUS,
  LOCAL_IGNITION_SPEED,
  MAX_BLOCK_HIGHLIGHTS,
  MAX_LOCAL_IGNITIONS,
} from '../ui/topologyConstants';

// Cell birth/death visual timing offset (s) — applied to each cell's
// born/death scene timestamp so the shader starts the birth scale-up
// (or the death fade-out) at the end of the delivery/commit choreography.
export const BLOCK_HIGHLIGHT_DELAY_S = BLOCK_COMMIT_DELAY_S + 0.15;

interface CellGalaxyProps {
  ckbNodeIds: string[];
  /** Resolved server projection cap. The shared renderer hard ceiling still
   * bounds allocations, while smaller profiles keep AUTO honest. */
  cellCapacity?: number;
  /** Optional canonically validated resting reservoir. It changes only the
   * visible composition; canonical block activity remains in CellGalaxyCache. */
  galaxyComposition?: GalaxyCompositionRecord | null;
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
  /** Exact Cell ids changed since the last GPU commit. When omitted,
   *  CellGalaxy preserves the legacy full-visible-buffer fallback. */
  flashDirtyIdsRef?: CellFlashDirtyIdsRef;
  /** Optional overlay rendered inside the cell galaxy's rotating
   *  world-space group. Used by consumers to add domain-specific
   *  animations (e.g. consensus routes + write seals) atop the
   *  cell field without coupling CellGalaxy to non-generic components. */
  overlay?: ReactNode;
  /** Shared topology field published by the overlay's NeuralNetwork. The
   * Cell body reads it directly so selection never rebuilds the graph here. */
  inspectionFieldRef?: React.RefObject<CellInspectionField | null>;
  /** Optional live interaction gate. Consumers with camera controls can
   * suspend the O(N) screen-space picker after a real drag begins while still
   * allowing the pointer-down and click raycasts that preserve R3F semantics. */
  pickingSuspendedRef?: React.RefObject<boolean>;
  /** Seconds after the block pulse at which the LOCAL node applies the block —
   *  i.e. when it hears the block from the network (caller-supplied delay). The
   *  whole ledger reaction is delayed by this, so the canonical ripple never
   *  fires at t=0 / never before the peers. 0 = no delay (degenerate). */
  localReceiveDelayS?: number;
}

// Cell point sizes in world units. A stable per-id range prevents the far field
// from becoming an evenly punched dot screen; tags remain larger landmarks.
const GENERIC_CELL_POINT_SIZE = 1.35;
const TAGGED_CELL_POINT_SIZE = 2.75;

export function cellPointSize(cell: Pick<Cell, 'id' | 'tag'>): number {
  let hash = Math.imul(cell.id >>> 0, 0x9e3779b1) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  const u = ((hash >>> 8) & 0xffff) / 0xffff;
  const morphology = 0.58 + 0.72 * u * u
    + (cell.tag === null && u > 0.975 ? 0.48 : 0);
  return (cell.tag === null ? GENERIC_CELL_POINT_SIZE : TAGGED_CELL_POINT_SIZE)
    * morphology;
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

/** One contiguous run of visible Cell slots whose static GPU attributes need
 * to be refreshed. Block deltas usually touch only a handful of these runs. */
export type CellBufferRange = CellRenderRange;

const EMPTY_CELL_BUFFER_RANGES: CellBufferRange[] = [];

export interface CellBufferDiff {
  ranges: CellBufferRange[];
  /** True only when visible ids/order changed, not for an in-place Cell value
   * replacement such as death/tag metadata. */
  membershipChanged: boolean;
}

/** Compare the last rendered prefix with the next one by immutable Cell
 * identity and coalesce adjacent changes into upload-friendly ranges. */
export function diffCellBufferSlots(
  previous: readonly Cell[],
  next: readonly Cell[],
): CellBufferDiff {
  return diffCellRenderSlots(previous, next);
}

/** Write one static graph-distance transition endpoint for visible Cells. The
 * shader cross-fades two such attributes through a single material uniform. */
export function writeCellInspectionTargets(
  cells: Cell[],
  count: number,
  field: CellInspectionField | null,
  targetArr: Float32Array,
  ranges?: readonly CellBufferRange[],
): void {
  const activeRanges = ranges ?? [{ start: 0, count }];
  for (const range of activeRanges) {
    const end = Math.min(count, range.start + range.count);
    for (let i = Math.max(0, range.start); i < end; i += 1) {
      targetArr[i] = cellInspectionFieldScale(field, cells[i].id);
    }
  }
}

/** Write the atomic navigation affordance for direct renderer-neighbours.
 * This intentionally does not ease: visual role and pickability change on the
 * same field snapshot, so a fading marker never advertises a stale target. */
export function writeCellInspectionNavigationRoles(
  cells: Cell[],
  count: number,
  field: CellInspectionField | null,
  roleArr: Float32Array,
  ranges?: readonly CellBufferRange[],
): void {
  const activeRanges = ranges ?? [{ start: 0, count }];
  for (const range of activeRanges) {
    const end = Math.min(count, range.start + range.count);
    for (let i = Math.max(0, range.start); i < end; i += 1) {
      roleArr[i] = cellInspectionDirectNavigationRole(field, cells[i].id);
    }
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
  memoryIdentityArr: Float32Array;
  memorySeedArr: Float32Array;
}

export interface CellBufferPresentation {
  color: readonly [number, number, number];
  size: number;
  memoryIdentity: readonly [number, number, number, number];
  memorySeed: number;
}

function cellBufferPresentation(
  cell: Cell,
  cache?: WeakMap<Cell, CellBufferPresentation>,
): CellBufferPresentation {
  const cached = cache?.get(cell);
  if (cached) return cached;
  const visual = deriveCellVisual(cell);
  const identity = consensusMemoryCoreIdentity(visual);
  const presentation: CellBufferPresentation = {
    color: consensusCellColor(visual, hasCellTagAccent(cell.tag)),
    size: cellPointSize(cell),
    memoryIdentity: identity.semantic,
    memorySeed: identity.hashSeed,
  };
  cache?.set(cell, presentation);
  return presentation;
}

/** Write all visible Cell buffers, or only the supplied changed ranges for a
 * live block delta. Caller owns GPU update ranges and `needsUpdate` flags. */
export function writeCellBuffers(
  cells: Cell[],
  count: number,
  toSceneSeconds: (ms: number) => number,
  flashMap: Map<number, number>,
  targets: CellBufferTargets,
  bornAtOverrides?: ReadonlyMap<number, number>,
  ranges?: readonly CellBufferRange[],
  presentationCache?: WeakMap<Cell, CellBufferPresentation>,
): void {
  const activeRanges = ranges ?? [{ start: 0, count }];
  for (const range of activeRanges) {
    const end = Math.min(count, cells.length, range.start + range.count);
    for (let i = Math.max(0, range.start); i < end; i += 1) {
      const c = cells[i];
      const bornAtS = bornAtOverrides?.get(c.id)
        ?? toSceneSeconds(c.born_at_ms) + BLOCK_HIGHLIGHT_DELAY_S;
      const deathAtS = c.death_at_ms === null
        ? 1e9
        : toSceneSeconds(c.death_at_ms) + BLOCK_HIGHLIGHT_DELAY_S;
      const flashAtS = flashMap.get(c.id) ?? -1e9;

      const presentation = cellBufferPresentation(c, presentationCache);
      targets.posArr[i * 3 + 0]   = c.pos_seed[0];
      targets.posArr[i * 3 + 1]   = c.pos_seed[1];
      targets.posArr[i * 3 + 2]   = c.pos_seed[2];
      targets.colorArr[i * 3 + 0] = presentation.color[0];
      targets.colorArr[i * 3 + 1] = presentation.color[1];
      targets.colorArr[i * 3 + 2] = presentation.color[2];
      targets.bornArr[i]          = bornAtS;
      targets.deathArr[i]         = deathAtS;
      targets.flashArr[i]         = flashAtS;
      targets.sizeArr[i]          = presentation.size;
      targets.memoryIdentityArr.set(presentation.memoryIdentity, i * 4);
      targets.memorySeedArr[i]    = presentation.memorySeed;
    }
  }
}

const MAX_CELL_BUFFER_UPLOAD_RANGES = 8;

/** Tell Three.js to upload only changed scalar runs. Highly fragmented block
 * updates fall back to one upload while retaining the cheaper partial CPU
 * derivation above. */
function markCellBufferUpdateRanges(
  attribute: THREE.BufferAttribute,
  ranges: readonly CellBufferRange[],
  visibleCount: number,
): void {
  if (ranges.length === 0 || visibleCount <= 0) return;
  attribute.clearUpdateRanges();
  const uploadRanges = ranges.length <= MAX_CELL_BUFFER_UPLOAD_RANGES
    ? ranges
    : [{ start: 0, count: visibleCount }];
  for (const range of uploadRanges) {
    if (range.count <= 0) continue;
    attribute.addUpdateRange(
      range.start * attribute.itemSize,
      range.count * attribute.itemSize,
    );
  }
  attribute.needsUpdate = true;
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
 *  back to the quieter resting presentation over the same envelope. */
const ANCHOR_FLASH_DURATION_S = 0.6;
/** The local anchor remains a little larger than a measured peer (1.4), but
 *  no longer reads as a second hero beside the Cell field. */
const ANCHOR_BODY_RADIUS = 1.75;
/** Preserve the generous glow language without the old 15 × 15 billboard. */
const ANCHOR_HALO_PLANE_SIZE = ANCHOR_BODY_RADIUS * 5.6;
/** Keep the original hit area after shrinking the visible body. */
const ANCHOR_HIT_RADIUS = 2.5;
/** A real block may briefly promote the anchor above both resting and selected
 *  states. The lower peak avoids a cyan strobe competing with the peer wave. */
const ANCHOR_FLASH_PEAK_INTENSITY = 1.85;

export interface CkbNodeAnchorPresentation {
  haloIntensity: number;
  edgeOpacity: number;
  fillOpacity: number;
  labelOpacity: number;
  labelColor: string;
  labelShadow: string;
}

const ANCHOR_REST_PRESENTATION: CkbNodeAnchorPresentation = {
  haloIntensity: 0.52,
  edgeOpacity: 0.46,
  fillOpacity: 0.07,
  labelOpacity: 0.46,
  labelColor: '#86aab2',
  labelShadow: '0 0 6px rgba(34, 211, 238, 0.24)',
};

const ANCHOR_SELECTED_PRESENTATION: CkbNodeAnchorPresentation = {
  haloIntensity: 0.92,
  edgeOpacity: 0.9,
  fillOpacity: 0.14,
  labelOpacity: 0.92,
  labelColor: '#d8f8fb',
  labelShadow:
    '0 0 5px rgba(125, 249, 255, 0.62), 0 0 11px rgba(34, 211, 238, 0.32)',
};

/** Three explicit levels keep the anchor quiet at rest, legible on selection,
 *  and momentarily bright only when chain data actually arrives. */
export function ckbNodeAnchorPresentation(
  selected: boolean,
): CkbNodeAnchorPresentation {
  return selected
    ? ANCHOR_SELECTED_PRESENTATION
    : ANCHOR_REST_PRESENTATION;
}

export function ckbNodeAnchorHaloTarget(
  selected: boolean,
  flashActive: boolean,
): number {
  return flashActive
    ? ANCHOR_FLASH_PEAK_INTENSITY
    : ckbNodeAnchorPresentation(selected).haloIntensity;
}

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
  const presentation = ckbNodeAnchorPresentation(selected);
  // The event carrier lives in the halo. An intensity ref eases between the
  // subdued rest/selection levels and a short block-arrival peak, while the
  // shader supplies the single shared breathing envelope.
  const palette = CHAIN_ANCHOR_PALETTE;
  const haloMat = useMemo(() => {
    const m = makeHaloMaterial(palette);
    m.uniforms.uPhase.value = phaseFor(id);
    return m;
  }, [palette, id]);
  const wireGeometry = useMemo(() => {
    const source = new THREE.IcosahedronGeometry(ANCHOR_BODY_RADIUS, 0);
    const edges = new THREE.EdgesGeometry(source);
    source.dispose();
    return edges;
  }, []);
  const intensityRef = useRef(presentation.haloIntensity);

  useEffect(() => () => {
    haloMat.dispose();
    wireGeometry.dispose();
  }, [haloMat, wireGeometry]);

  useSimFrame((_, dt) => {
    if (bodyRef.current) {
      bodyRef.current.rotation.x += dt * 0.15;
      bodyRef.current.rotation.y += dt * 0.1;
    }
    // `flashRef` is set on each new block and temporarily promotes the halo
    // above both rest and selection before it eases back.
    let flashActive = false;
    const trigger = flashRef?.current ?? null;
    if (trigger) {
      const age = simClock.elapsedSec - trigger.firedAt;
      if (age >= 0 && age < ANCHOR_FLASH_DURATION_S) {
        flashActive = true;
        haloMat.uniforms.uColor.value.setRGB(
          trigger.color[0],
          trigger.color[1],
          trigger.color[2],
        );
      } else {
        haloMat.uniforms.uColor.value.copy(CHAIN_ANCHOR_HALO_COLOR);
      }
    } else {
      haloMat.uniforms.uColor.value.copy(CHAIN_ANCHOR_HALO_COLOR);
    }
    const target = ckbNodeAnchorHaloTarget(selected, flashActive);
    intensityRef.current += (target - intensityRef.current) * Math.min(1, dt * 12);

    const t = simClock.elapsedSec;
    haloMat.uniforms.uTime.value = t;
    // makeHaloMaterial already carries one subtle breathing envelope. Avoid
    // multiplying a second one here: the anchor should not pulse at rest.
    haloMat.uniforms.uIntensity.value = intensityRef.current;
  });

  return (
    <group position={position}>
      {/* Camera-facing additive halo — the entire flash effect lives
          here. Unified with GlowNode so chain icosahedra and the
          rest of the topology speak the same flash language. */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh material={haloMat}>
          <planeGeometry
            args={[ANCHOR_HALO_PLANE_SIZE, ANCHOR_HALO_PLANE_SIZE]}
          />
        </mesh>
      </Billboard>
      <group ref={bodyRef}>
        <lineSegments>
          <primitive object={wireGeometry} attach="geometry" />
          <lineBasicMaterial
            color="#7df9ff"
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={presentation.edgeOpacity}
            depthWrite={false}
          />
        </lineSegments>
        <mesh>
          <icosahedronGeometry args={[ANCHOR_BODY_RADIUS, 0]} />
          <meshBasicMaterial
            color="#0e7490"
            transparent
            opacity={presentation.fillOpacity}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* The visible form is quieter, but the original click target remains
          forgiving and follows the anchor rather than its DOM label. An
          invisible MATERIAL keeps the raycast (the Raycaster never consults
          material.visible) while the renderer skips the draw entirely. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
      >
        <sphereGeometry args={[ANCHOR_HIT_RADIUS, 8, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Html
        position={[0, -2.72, 0]}
        center
        occlude={false}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          style={{
            color: presentation.labelColor,
            opacity: presentation.labelOpacity,
            fontSize: '8px',
            fontWeight: selected ? 500 : 400,
            letterSpacing: '0.24em',
            fontFamily:
              "'Orbitron Local', 'JetBrains Mono Local', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: 'nowrap',
            textShadow: presentation.labelShadow,
            textTransform: 'uppercase',
            transition:
              'color 180ms ease, opacity 180ms ease, text-shadow 180ms ease',
          }}
        >
          {ckbNodeLabel(id)}
        </div>
      </Html>
      {selected ? (
        <CkbSelectionReticle size={ANCHOR_BODY_RADIUS * 3.2} />
      ) : null}
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
//   compact:  pickRadius_px = max(pointHalfExtent_px, braidCircumradius_px)
//   expanded: pickRadius_px also gets one bounded fine-line acquisition pad
// where both terms come from the live shaders' world→screen mapping:
//   gl_PointSize ≈ aSize × 2 × (viewportHeight/2) / viewZ   (hybrid core sprite)
//   braidR_world = the production A LOD's interaction-aware screen radius
// Zoom in → cells appear bigger → pick radius grows the same way.
// The pad applies only while the real braid geometry is actually visible;
// compact lights keep their exact footprint in the dense far field.
//
// Performance: one O(N) projection refresh per structural/camera revision feeds
// an allocation-stable screen-space grid; all pointer queries reuse it until an
// input to the projection changes. Camera drags suspend the picker entirely.

interface CellPickerProps {
  cellsListRef: React.MutableRefObject<Cell[]>;
  drawCountRef: React.MutableRefObject<number>;
  detailAttr: THREE.BufferAttribute;
  selectedCellIdRef: React.MutableRefObject<number | null>;
  hoveredCellIdRef: React.MutableRefObject<number | null>;
  inspectionFieldRef?: React.RefObject<CellInspectionField | null>;
  pickingSuspendedRef?: React.RefObject<boolean>;
  onSelect: (id: string | null) => void;
}

/** Match R3F's stationary-click tolerance, which it otherwise applies only
 * to missed clicks. Successful raycast hits must reject drag-generated clicks
 * explicitly. */
export const CELL_CLICK_MAX_POINTER_DELTA_PX = 2;

export function cellPointerGestureIsClick(delta: number): boolean {
  return Number.isFinite(delta)
    && delta >= 0
    && delta <= CELL_CLICK_MAX_POINTER_DELTA_PX;
}

/** Custom Object3D that participates in r3f's raycast pipeline. Its
 *  `raycast()` refreshes a current-frame screen index, then pushes an
 *  intersect for the cell whose own visual radius covers the pointer.
 *  The intersect carries `instanceId` so the existing `cell:${id}`
 *  selection contract is preserved. */
function CellPicker({
  cellsListRef,
  drawCountRef,
  detailAttr,
  selectedCellIdRef,
  hoveredCellIdRef,
  inspectionFieldRef,
  pickingSuspendedRef,
  onSelect,
}: CellPickerProps) {
  const ref = useRef<THREE.Object3D>(null);
  const forcePreciseRaycastRef = useRef(false);
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
    const modelView = new THREE.Matrix4();
    const screenIndex = new ScreenSpaceHitIndex(INSTANCE_CAPACITY);
    const indexedMatrixWorld = new THREE.Matrix4();
    const indexedCameraView = new THREE.Matrix4();
    const indexedProjection = new THREE.Matrix4();
    let indexedCells: Cell[] | null = null;
    let indexedCount = -1;
    let indexedInspectionField: CellInspectionField | null = null;
    let indexedSelectedCellId: number | null = null;
    let indexedHoveredCellId: number | null = null;
    let indexedDetailVersion = -1;
    let indexedWidth = -1;
    let indexedHeight = -1;

    node.raycast = function raycastCells(raycaster, intersects) {
      if (pickingSuspendedRef?.current) return;
      const cells = cellsListRef.current;
      const count = Math.min(drawCountRef.current, cells.length);
      if (count === 0) return;
      const detailArray = detailAttr.array as Float32Array;
      const inspectionField = inspectionFieldRef?.current ?? null;
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
      const forcePrecise = forcePreciseRaycastRef.current;
      forcePreciseRaycastRef.current = false;
      const matrix = this.matrixWorld;
      const structuralIndexChange = indexedCells !== cells
        || indexedCount !== count
        || indexedInspectionField !== inspectionField
        || indexedSelectedCellId !== selectedCellIdRef.current
        || indexedHoveredCellId !== hoveredCellIdRef.current
        || indexedDetailVersion !== detailAttr.version
        || indexedWidth !== width
        || indexedHeight !== height
        || !indexedMatrixWorld.equals(matrix)
        || !indexedCameraView.equals(camera.matrixWorldInverse)
        || !indexedProjection.equals(camera.projectionMatrix);
      if (forcePrecise || structuralIndexChange) {
        screenIndex.begin(width, height);
        modelView.multiplyMatrices(camera.matrixWorldInverse, matrix);
        const projectionScaleY = camera.projectionMatrix.elements[5];
        const selectedCellId = selectedCellIdRef.current;
        const hoveredCellId = hoveredCellIdRef.current;
        for (let i = 0; i < count; i += 1) {
          const c = cells[i];
          if (!cellInspectionNavigationTarget(inspectionField, c.id)) continue;
          cellView
            .set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2])
            .applyMatrix4(modelView);

          // View-space depth feeds both visual footprint and frustum rejection.
          const viewZ = -cellView.z;
          if (viewZ <= 0) continue;
          const navigationSizeScale = cellInspectionDirectNavigationRole(
            inspectionField,
            c.id,
          ) > 0
            ? CELL_INSPECTION_NAVIGATION_SIZE_SCALE
            : 1;
          const depthToPx = halfH / viewZ;
          const cellPointPxR = cellPointSize(c)
            * navigationSizeScale
            * depthToPx;
          const focus = cellFocusTarget(
            c.id,
            selectedCellId,
            hoveredCellId,
          );
          const braidScale = consensusBraidRenderScale(
            viewZ,
            height,
            projectionScaleY,
            focus,
            consensusBraidPresenceScale(capacityMass(c.capacity)),
          );
          const braidPxR = CONSENSUS_BRAID_LOCAL_RADIUS
            * braidScale
            * projectionScaleY
            * depthToPx;
          const pickPxR = cellPickRadiusPx(
            cellPointPxR,
            braidPxR,
            detailArray[i] ?? 0,
          );

          // Reuse the view-space result instead of applying the camera inverse
          // a second time through Vector3.project().
          cellNdc.copy(cellView).applyMatrix4(camera.projectionMatrix);
          if (cellNdc.z < -1 || cellNdc.z > 1) continue;
          screenIndex.insert(
            i,
            (cellNdc.x + 1) * halfW,
            (1 - cellNdc.y) * halfH,
            pickPxR,
            cellNdc.z,
          );
        }
        indexedCells = cells;
        indexedCount = count;
        indexedInspectionField = inspectionField;
        indexedSelectedCellId = selectedCellIdRef.current;
        indexedHoveredCellId = hoveredCellIdRef.current;
        indexedDetailVersion = detailAttr.version;
        indexedWidth = width;
        indexedHeight = height;
        indexedMatrixWorld.copy(matrix);
        indexedCameraView.copy(camera.matrixWorldInverse);
        indexedProjection.copy(camera.projectionMatrix);
      }

      const hit = screenIndex.find(
        (clickNdcX + 1) * halfW,
        (1 - clickNdcY) * halfH,
      );
      if (!hit) return;
      const hitCell = cells[hit.index];
      if (
        !hitCell
        || !cellInspectionNavigationTarget(inspectionField, hitCell.id)
      ) return;
      bestPoint
        .set(hitCell.pos_seed[0], hitCell.pos_seed[1], hitCell.pos_seed[2])
        .applyMatrix4(matrix);

      intersects.push({
        // World distance from the ray origin (camera) to the picked
        // cell's pos_seed. r3f sorts intersects by this when multiple
        // objects (e.g. chain icosahedra) compete for the same click.
        distance: ray.origin.distanceTo(bestPoint),
        point: bestPoint.clone(),
        object: this,
        // r3f surfaces this on the synthetic event as `e.instanceId`;
        // the onClick handler below indexes back into cellsListRef.
        instanceId: hit.index,
      });
    };

    return () => {
      // Plain Object3D.raycast is a no-op; restore on unmount so a
      // future remount doesn't carry a stale closure.
      node.raycast = THREE.Object3D.prototype.raycast;
    };
  }, [
    cellsListRef,
    detailAttr,
    drawCountRef,
    hoveredCellIdRef,
    inspectionFieldRef,
    pickingSuspendedRef,
    selectedCellIdRef,
  ]);

  useEffect(() => {
    const canvas = gl.domElement;
    const forcePreciseRaycast = () => {
      forcePreciseRaycastRef.current = true;
    };
    // Capture runs before R3F's delegated bubble handler. Pointer-down starts
    // from a precise snapshot; pointer-up/click then reuse it unless the camera,
    // Cell field, focus, viewport, or detail buffers actually changed.
    canvas.addEventListener('pointerdown', forcePreciseRaycast, true);
    return () => {
      canvas.removeEventListener('pointerdown', forcePreciseRaycast, true);
    };
  }, [gl]);

  useEffect(() => () => {
    delete gl.domElement.dataset.cellPickerHover;
    gl.domElement.style.cursor = cellCanvasCursor(
      false,
      gl.domElement.dataset.cellCausalNavigationHover !== undefined,
    );
  }, [gl]);

  const setHovered = (id: number | null) => {
    hoveredCellIdRef.current = id;
    if (id === null) {
      delete gl.domElement.dataset.cellPickerHover;
    } else {
      gl.domElement.dataset.cellPickerHover = String(id);
    }
    // A nearer causal endpoint can stop propagation and deliberately own the
    // same screen point. Its marker remains the active affordance even when
    // this farther picker receives the synthetic pointer-out cleanup.
    const causalNavigationOwnsCursor =
      gl.domElement.dataset.cellCausalNavigationHover !== undefined;
    gl.domElement.style.cursor = cellCanvasCursor(
      id !== null,
      causalNavigationOwnsCursor,
    );
  };

  return (
    <object3D
      ref={ref}
      onPointerMove={(e) => {
        if (
          typeof e.instanceId !== 'number'
          || e.instanceId < 0
          || e.instanceId >= drawCountRef.current
        ) {
          setHovered(null);
          return;
        }
        const cell = cellsListRef.current[e.instanceId];
        setHovered(cell?.id ?? null);
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (!cellPointerGestureIsClick(e.delta)) return;
        if (
          typeof e.instanceId !== 'number'
          || e.instanceId < 0
          || e.instanceId >= drawCountRef.current
        ) return;
        const cell = cellsListRef.current[e.instanceId];
        if (!cell) return;
        if (!cellInspectionNavigationTarget(
          inspectionFieldRef?.current ?? null,
          cell.id,
        )) return;
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
 * objects. Exact delivery/commit flashes remain anchored to real Cells; the
 * broad new-block brightness wave renders in the peer network.
 */
export default function CellGalaxy({
  ckbNodeIds,
  cellCapacity,
  galaxyComposition = null,
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
  flashDirtyIdsRef,
  overlay,
  inspectionFieldRef,
  pickingSuspendedRef,
  localReceiveDelayS = 0,
}: CellGalaxyProps) {
  const simClock = useSimClock();
  const groupRef = useRef<THREE.Group>(null);
  // Server-driven cell list. The component is now a pure visual layer:
  // it reads cells from the cache and patches changed xyz / born / death
  // slots in the Points BufferGeometry. Birth / death / tag are reduced
  // server-side before they reach this renderer.
  const cellsCache = useCellGalaxy();
  const activityCellIds = useMemo(
    () => galaxyComposition ? currentActivityCellIds(cellsCache) : [],
    [cellsCache.pulseLinks, galaxyComposition],
  );
  const activityKey = useMemo(
    () => galaxyComposition ? activityCellIds.join(':') : '',
    [activityCellIds, galaxyComposition],
  );
  const compositionCellsById = useMemo(() => {
    const cells = new Map<number, Cell>();
    if (!galaxyComposition) return cells;
    for (const cell of [
      ...galaxyComposition.dao,
      ...galaxyComposition.typed,
      ...galaxyComposition.plain,
    ]) cells.set(cell.id, cell);
    return cells;
  }, [galaxyComposition]);
  const identityProofCell = identityProof
    ? cellsCache.cells.get(identityProof.cellId)
      ?? compositionCellsById.get(identityProof.cellId)
      ?? null
    : null;
  const identityProofBindingCell = identityProofBinding
    ? cellsCache.cells.get(identityProofBinding.cellId)
      ?? compositionCellsById.get(identityProofBinding.cellId)
      ?? null
    : null;
  const { effective: quality } = useQualityRuntime();
  const cellDisplay = useCellDisplayRuntime();
  const cellDisplayLimit = resolveCellDisplayLimit(
    cellDisplay,
    cellCapacity,
  );
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
  /** Reducer-journal cursor for the visible prefix. Ordinary retained Cell
   * replacements patch indexed slots, and births beyond the display cap leave
   * this array untouched. */
  const cellRenderSetRef = useRef(createCellRenderSetState());
  /** Stable GPU slot assignment over the render set's membership. */
  const cellSlotStateRef = useRef(createCellSlotState());
  /** Unchanged immutable Cell objects retain their expensive hash/taxonomy
   * presentation even when GC moves them to a different visible slot. */
  const cellBufferPresentationCacheRef = useRef(
    new WeakMap<Cell, CellBufferPresentation>(),
  );
  const selectedCellIdRef = useRef<number | null>(null);
  const hoveredCellIdRef = useRef<number | null>(null);
  selectedCellIdRef.current = selectedCellNumericId(selectedCellId);
  /** Identity of the cells Map last seen by useSimFrame. Retained separately
   * from the journal cursor because canonical rewrite arrivals compare the
   * exact previous and current authoritative maps. */
  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  /** Receipt-time lifecycle overrides for records arriving during a canonical
   * suffix rewrite. Replayed chain timestamps are historical, so without this
   * small client-side clock the replacement records would appear fully formed
   * instead of visibly re-entering the maintained structure. */
  const rewriteBirthAtRef = useRef<Map<number, number>>(new Map());
  const handledRewriteRef = useRef(cellsCache.linkPrune);
  const rewriteArrivalUntilRef = useRef(-1e9);
  /** Per-frame mirror of the cell draw count. Written by the journal cursor;
   * read by the flash-only fast path so neither path recomputes the clamp. */
  const drawCountRef = useRef<number>(0);
  const flareDrawCountRef = useRef<number>(0);
  // Flash-index candidates: slots whose aFlashAt window is open or still to
  // open. Fed by every aFlashAt write path below; the resting frame then costs
  // nothing instead of scanning every visible slot. Stale entries retire
  // lazily by value, so the set never needs an explicit reset.
  const flareCandidateSlotsRef = useRef<Set<number>>(new Set());
  const flareScratchSlotsRef = useRef<number[]>([]);
  const lastPulseAtMsRef = useRef<number>(0);
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
    return new THREE.BufferAttribute(arr, 1)
      .setUsage(THREE.DynamicDrawUsage);
  }, []);
  const cellFlareIndexAttr = useMemo(
    () => new THREE.BufferAttribute(
      new Uint16Array(INSTANCE_CAPACITY),
      1,
    ).setUsage(THREE.DynamicDrawUsage),
    [],
  );
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
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1)
      .setUsage(THREE.DynamicDrawUsage),
    [],
  );
  // Smooth hover/selection envelope. CellNucleus owns the easing and writes
  // this shared attribute so the far point and the expanded braid stay in sync.
  const cellFocusAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1)
      .setUsage(THREE.DynamicDrawUsage),
    [],
  );
  // Signed recall energy: negative = evidence source, positive = retained
  // target. Resolution is separate so the target can lock only after its real
  // witnesses arrive. Both buffers stay idle at zero outside explicit recall.
  const cellRecallAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1)
      .setUsage(THREE.DynamicDrawUsage),
    [],
  );
  const cellRecallStateAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1)
      .setUsage(THREE.DynamicDrawUsage),
    [],
  );
  // Static transition endpoints per body point. Selection changes upload each
  // endpoint once; the shader advances one scalar instead of rewriting the
  // complete visible Cell buffer on every easing frame.
  const cellInspectionFromAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY);
    arr.fill(1);
    return new THREE.BufferAttribute(arr, 1)
      .setUsage(THREE.DynamicDrawUsage);
  }, []);
  const cellInspectionToAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY);
    arr.fill(1);
    return new THREE.BufferAttribute(arr, 1)
      .setUsage(THREE.DynamicDrawUsage);
  }, []);
  // Atomic direct-neighbour navigation role. Unlike the body energy, this does
  // not cross-fade: the shader affordance and CellPicker eligibility always
  // describe the same current graph snapshot.
  const cellInspectionRoleAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(INSTANCE_CAPACITY), 1)
      .setUsage(THREE.DynamicDrawUsage),
    [],
  );
  const lastInspectionFieldRef = useRef<CellInspectionField | null>(null);
  const inspectionTransitionRef = useRef({ elapsed: 0, active: false });

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
    g.setAttribute('aInspectionFrom', cellInspectionFromAttr);
    g.setAttribute('aInspectionTo', cellInspectionToAttr);
    g.setAttribute('aInspectionRole', cellInspectionRoleAttr);
    g.setDrawRange(0, 0);
    // Permissive sphere for the bounded tissue plus its rare halo drift.
    // Skipping this would let frustum culling drop the entire cloud at
    // oblique angles.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
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
    cellInspectionFromAttr,
    cellInspectionToAttr,
    cellInspectionRoleAttr,
  ]);

  const cellFlareGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // Share the authoritative Cell attributes. Only the small element array is
    // flare-specific, so active writes do not duplicate position/lifecycle
    // buffers or change the resting body draw.
    g.setAttribute('position', cellPosAttr);
    g.setAttribute('aBornAt', cellBornAtAttr);
    g.setAttribute('aDeathAt', cellDeathAtAttr);
    g.setAttribute('aFlashAt', cellFlashAtAttr);
    g.setAttribute('aSize', cellSizeAttr);
    g.setIndex(cellFlareIndexAttr);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
    return g;
  }, [
    cellPosAttr,
    cellBornAtAttr,
    cellDeathAtAttr,
    cellFlashAtAttr,
    cellSizeAttr,
    cellFlareIndexAttr,
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
      cellFlareGeometry.dispose();
    };
  }, [
    hybridMaterial,
    flareMaterial,
    cellGeometry,
    cellFlareGeometry,
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
    const inspectionField = inspectionFieldRef?.current ?? null;
    const rewrite = cellsCache.linkPrune;
    const rewriteMarkerChanged = rewrite !== handledRewriteRef.current;
    const rewriteReplayActive = cellsCache.backfill?.phase === 'reorg'
      || cellsCache.backfill?.phase === 'rebuild';
    if (rewriteMarkerChanged) {
      handledRewriteRef.current = rewrite;
      rewriteArrivalUntilRef.current = now + 2.5;
      rewriteBirthAtRef.current.clear();
    }
    if (rewriteReplayActive) {
      rewriteArrivalUntilRef.current = now + 1.0;
    }

    // 1. Advance the reducer-journal cursor. The ordinary path patches only
    //    changed visible slots; snapshots, skipped journals, GC/order changes,
    //    and semantic-pinning changes resolve through one canonical rebuild.
    const cellsMapChanged = cellsCache.cells !== lastCellsRef.current;
    if (cellsMapChanged) {
      for (const [id, bornAt] of rewriteBirthAtRef.current) {
        if (now - bornAt > 2) rewriteBirthAtRef.current.delete(id);
      }
      if (
        rewrite
        && (rewriteMarkerChanged
          || rewriteReplayActive
          || now <= rewriteArrivalUntilRef.current)
      ) {
        const arrivals = deriveCanonicalRewriteArrivals(
          lastCellsRef.current,
          cellsCache.cells,
          rewrite.fromBlock,
        );
        for (const id of arrivals) {
          rewriteBirthAtRef.current.set(id, now);
          cellFlashRef.current.set(id, now);
          markCellFlashDirty(id, flashDirtyRef, flashDirtyIdsRef);
        }
      }
      lastCellsRef.current = cellsCache.cells;
    }

    const renderSet = cellRenderSetRef.current;
    const renderNeedsSync = renderSet.cellsToken !== cellsCache.cellsToken
      || renderSet.displayBudget !== cellDisplayLimit
      || renderSet.selectedCellId !== selectedCellIdRef.current
      || renderSet.inspectionField !== inspectionField
      || renderSet.compositionToken !== galaxyComposition
      || renderSet.activityKey !== activityKey;
    const renderUpdate = renderNeedsSync
      ? syncCellRenderSet(
        renderSet,
        cellsCache,
        cellDisplayLimit,
        selectedCellIdRef.current,
        inspectionField,
        galaxyComposition,
        activityCellIds,
      )
      : null;
    // Stable-slot indirection: the render set's LIST reorders per block
    // (activity leads, cap eviction removes from the front), but each cell
    // keeps its GPU slot while visible, so uploads collapse to O(churn).
    const slotSync = renderUpdate
      ? syncCellSlots(cellSlotStateRef.current, renderUpdate.cells)
      : null;
    const cellsList = slotSync?.cells ?? cellSlotStateRef.current.published;
    const count = cellsList.length;
    const cellBufferRanges = slotSync?.ranges ?? EMPTY_CELL_BUFFER_RANGES;
    const renderMembershipChanged = slotSync?.membershipChanged ?? false;
    const drawCountChanged = count !== drawCountRef.current;
    cellsListRef.current = cellsList;
    drawCountRef.current = count;
    const flashMap = cellFlashRef.current;

    if (cellBufferRanges.length > 0 || drawCountChanged) {
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
        rewriteBirthAtRef.current,
        cellBufferRanges,
        cellBufferPresentationCacheRef.current,
      );

      cellGeometry.setDrawRange(0, count);
      markCellBufferUpdateRanges(cellPosAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(cellColorAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(cellBornAtAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(cellDeathAtAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(cellSizeAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(
        cellMemoryIdentityAttr,
        cellBufferRanges,
        count,
      );
      markCellBufferUpdateRanges(
        cellMemorySeedAttr,
        cellBufferRanges,
        count,
      );
      // Rewritten slots may now hold a different cell's flash timestamp —
      // re-admit any whose window is open or pending. Rides a frame that is
      // already O(rewritten slots).
      collectCellFlashCandidates(
        cellBufferRanges.length > 0
          ? cellBufferRanges
          : [{ start: 0, count }],
        cellFlashAtAttr.array as Float32Array,
        count,
        now,
        CELL_FLASH_DURATION_S,
        flareCandidateSlotsRef.current,
      );
    }

    // Opportunistic prune: keep flashMap from leaking entries for cells that
    // have been GC'd. Run only when the authoritative map advances; hidden
    // births no longer enter the static-buffer path above.
    if (cellsMapChanged && flashMap.size > count * 2 + 100) {
      const liveIds = new Set(cellsList.map((c) => c.id));
      for (const id of flashMap.keys()) {
        if (!liveIds.has(id)) flashMap.delete(id);
      }
    }

    // 2. Topology-distance field. Its immutable endpoint snapshots change only
    // when selection or real graph membership changes. The transition itself
    // advances through one material uniform, with no per-frame Cell loop or
    // BufferAttribute upload.
    const inspectionFieldChanged =
      inspectionField !== lastInspectionFieldRef.current;
    const inspectionRanges = inspectionFieldChanged
      ? [{ start: 0, count }]
      : renderMembershipChanged
        ? cellBufferRanges
        : [];
    if (inspectionRanges.length > 0) {
      const inspectionFrom = cellInspectionFromAttr.array as Float32Array;
      const inspectionTo = cellInspectionToAttr.array as Float32Array;
      if (inspectionFieldChanged) {
        // Preserve the exact on-screen value if a second selection arrives
        // before the previous transition has settled.
        const currentBlend = hybridMaterial.uniforms.uInspectionBlend.value;
        for (let i = 0; i < count; i += 1) {
          inspectionFrom[i] += (
            inspectionTo[i] - inspectionFrom[i]
          ) * currentBlend;
        }
      }
      writeCellInspectionTargets(
        cellsList,
        count,
        inspectionField,
        inspectionTo,
        inspectionRanges,
      );
      if (!inspectionFieldChanged) {
        // New/replaced render slots have no previous identity to cross-fade.
        // Seed both endpoints from their authoritative current target.
        for (const range of inspectionRanges) {
          const end = Math.min(count, range.start + range.count);
          for (let i = Math.max(0, range.start); i < end; i += 1) {
            inspectionFrom[i] = inspectionTo[i];
          }
        }
      }
      writeCellInspectionNavigationRoles(
        cellsList,
        count,
        inspectionField,
        cellInspectionRoleAttr.array as Float32Array,
        inspectionRanges,
      );
      markCellBufferUpdateRanges(
        cellInspectionRoleAttr,
        inspectionRanges,
        count,
      );
      markCellBufferUpdateRanges(
        cellInspectionFromAttr,
        inspectionRanges,
        count,
      );
      markCellBufferUpdateRanges(
        cellInspectionToAttr,
        inspectionRanges,
        count,
      );
    }
    if (inspectionFieldChanged) {
      lastInspectionFieldRef.current = inspectionField;
      inspectionTransitionRef.current.elapsed = 0;
      inspectionTransitionRef.current.active = true;
      hybridMaterial.uniforms.uInspectionBlend.value = 0;
    }
    const inspectionTransition = inspectionTransitionRef.current;
    if (!inspectionFieldChanged && inspectionTransition.active) {
      inspectionTransition.elapsed = Math.min(
        CELL_INSPECTION_BODY_TRANSITION_SECONDS,
        inspectionTransition.elapsed + dt,
      );
      hybridMaterial.uniforms.uInspectionBlend.value =
        cellInspectionBodyTransitionBlend(inspectionTransition.elapsed);
      if (
        inspectionTransition.elapsed
        >= CELL_INSPECTION_BODY_TRANSITION_SECONDS
      ) {
        inspectionTransition.active = false;
      }
    }

    // 3. Flash-only rewrite. Production callers publish exact dirty ids, so
    //    both the CPU write and GPU upload stay proportional to visible Cell
    //    arrivals. Callers without that journal retain the full-prefix path.
    const dirtyFlashIds = flashDirtyIdsRef?.current;
    const flashMapDirty = flashDirtyRef.current
      || (dirtyFlashIds?.size ?? 0) > 0;
    let flashBufferRanges: readonly CellBufferRange[] = cellBufferRanges;
    let flashNeedsFullUpload = false;
    if (flashMapDirty) {
      if (dirtyFlashIds && dirtyFlashIds.size > 0) {
        const dirtyFlashRanges = writeDirtyCellFlashSlots(
          dirtyFlashIds,
          cellSlotStateRef.current.slotOf,
          drawCountRef.current,
          cellFlashRef.current,
          cellFlashAtAttr.array as Float32Array,
          flareCandidateSlotsRef.current,
        );
        flashBufferRanges = mergeCellFlashRanges(
          cellBufferRanges,
          dirtyFlashRanges,
          count,
        );
      } else {
        writeFlashSlots(
          cellsListRef.current,
          drawCountRef.current,
          cellFlashRef.current,
          cellFlashAtAttr.array as Float32Array,
        );
        cellFlashAtAttr.clearUpdateRanges();
        cellFlashAtAttr.needsUpdate = true;
        flashNeedsFullUpload = true;
        collectCellFlashCandidates(
          [{ start: 0, count: drawCountRef.current }],
          cellFlashAtAttr.array as Float32Array,
          drawCountRef.current,
          now,
          CELL_FLASH_DURATION_S,
          flareCandidateSlotsRef.current,
        );
      }
      dirtyFlashIds?.clear();
      flashDirtyRef.current = false;
    }
    if (!flashNeedsFullUpload) {
      markCellBufferUpdateRanges(
        cellFlashAtAttr,
        flashBufferRanges,
        count,
      );
    }

    // The additive write layer shares all Cell attributes but submits only
    // slots whose exact aFlashAt age can produce fragments this frame. The
    // candidate set makes this event-driven: a resting frame visits nothing
    // instead of scanning every visible slot.
    const flareIndexWrite = writeActiveCellFlashIndicesFromCandidates(
      flareCandidateSlotsRef.current,
      cellFlashAtAttr.array as Float32Array,
      count,
      now,
      CELL_FLASH_DURATION_S,
      cellFlareIndexAttr.array as Uint16Array,
      flareDrawCountRef.current,
      flareScratchSlotsRef.current,
    );
    if (flareIndexWrite.changed) {
      markPopulatedBufferUpdate(
        cellFlareIndexAttr,
        flareIndexWrite.count,
      );
      cellFlareGeometry.setDrawRange(0, flareIndexWrite.count);
      flareDrawCountRef.current = flareIndexWrite.count;
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
    hybridMaterial.uniforms.uWarmth.value = LIVE.cell.warmth; // living rose body → ember bias
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

        // The local chain anchor still acknowledges the block when our node
        // applies it. Network propagation and its broad brightness wave are
        // already visible in NetworkColony.
        const flashSlot = chainNodeFlashRefs[safeIdx];
        if (flashSlot) {
          flashSlot.current = { firedAt: blockTriggerSceneS, color: blockColor };
        }

        // Exact block-cell acknowledgement: flash only Cells touched by the
        // block at the end of the shared carrier/commit phase. There is no
        // distance sweep here; a broad radial wave would falsely make unrelated
        // Cell state read as network propagation.
        const groupRotY = group.rotation.y;
        const cosTinv = Math.cos(-groupRotY);
        const sinTinv = Math.sin(-groupRotY);
        const originLocalX = worldOrigin[0] * cosTinv - worldOrigin[2] * sinTinv;
        const originLocalZ = worldOrigin[0] * sinTinv + worldOrigin[2] * cosTinv;
        const freshLinks = cellsCache.pulseLinks.filter(
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
            const flashAtS = blockTriggerSceneS + BLOCK_HIGHLIGHT_DELAY_S;
            const prev = cellFlashRef.current.get(cellId) ?? -1e9;
            if (flashAtS > prev) {
              cellFlashRef.current.set(cellId, flashAtS);
              markCellFlashDirty(cellId, flashDirtyRef, flashDirtyIdsRef);
            }
            highlights += 1;
          }
        }

        // Local-ignition pass: at the strike moment (block trigger +
        // BEAM_GROW_DUR_S), cells geographically near the impact xz
        // ignite in a fast radial sweep at LOCAL_IGNITION_SPEED. This
        // bridges the "carrier → cells" narrative: nearby Cells visibly receive
        // the delivered block at the field contact. It is deliberately bounded
        // to the landing area, while the broad wave stays in the peer network.
        // The shared spatial index (one build per Cell-set revision, paid by
        // the delivery layer already) replaces the old full-map distance walk;
        // in-radius hits come back in Cell-map scan order, so the first-N cap
        // selects exactly the cells the walk did.
        const strikeSceneS = blockTriggerSceneS + BEAM_GROW_DUR_S;
        const withinRadius = cellIdsWithinRadiusFromIndex(
          originLocalX,
          originLocalZ,
          LOCAL_IGNITION_RADIUS,
          sharedCellNearestIndex(
            cellsCache.cellsToken,
            cellsCache.cells,
            cellsCache.cellChanges,
          ),
        );
        const ignitionCount = Math.min(withinRadius.length, MAX_LOCAL_IGNITIONS);
        for (let hit = 0; hit < ignitionCount; hit += 1) {
          const { id, dist } = withinRadius[hit];
          const flashAtS = strikeSceneS + dist / LOCAL_IGNITION_SPEED;
          cellFlashRef.current.set(id, flashAtS);
          markCellFlashDirty(id, flashDirtyRef, flashDirtyIdsRef);
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
      {/* Cells galaxy — folded organic tissue at CELLS_Y, the top layer
          above the chain mesh. Slow rotation exposes its real depth and
          irregular lobes. The cube + ripple animation
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
          geometry={cellFlareGeometry}
          material={flareMaterial}
          frustumCulled={false}
          renderOrder={1}
        />
        {/* Canonical correction is not hidden as a cache reset. The exact
            suffix records invalidated by link_prune briefly fracture inward;
            real replacement Birth deltas then use the ordinary Cell body with
            a receipt-time re-entry envelope. */}
        <CanonicalRewriteEcho />
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
          drawCountRef={drawCountRef}
          detailAttr={cellDetailAttr}
          selectedCellIdRef={selectedCellIdRef}
          hoveredCellIdRef={hoveredCellIdRef}
          inspectionFieldRef={inspectionFieldRef}
          pickingSuspendedRef={pickingSuspendedRef}
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
