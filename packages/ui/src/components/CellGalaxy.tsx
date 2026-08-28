import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
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
  ENTER_FADE_MS,
  EXIT_FADE_MS,
  EXIT_HOLD_MAX,
  INSTANCE_CAPACITY,
} from '../geometry/cellPositions';
import {
  cellRenderOverlay,
  cellRenderOverlayChanged,
  cellRenderSetChanged,
  createCellRenderSetState,
  diffCellRenderSlots,
  resolveStagedCell,
  syncCellRenderSet,
  type CellRenderRange,
} from '../geometry/cellRenderSet';
import {
  cellLifecycleSceneTimes,
  createCellLifecycleStampState,
  ENTER_STAMP_SENTINEL,
  EXIT_STAMP_SENTINEL,
  pruneCellEnterStamps,
  reapCellExitHolds,
  refreshCellExitHolds,
  syncCellLifecycleStamps,
  takeCellExitHoldCells,
  type CellLifecycleRecord,
} from '../geometry/cellLifecycleStamps';
import {
  createCellSlotState,
  syncCellSlots,
} from '../geometry/cellSlotAssignment';
import {
  ScreenSpaceHitIndex,
  type ScreenSpaceRadiusPad,
} from '../geometry/screenSpaceHitIndex';
import { CellPickDriftEnvelope } from '../geometry/cellPickDriftEnvelope';
import type { ScalarThresholdEpoch } from '../geometry/sparseScalarAttribute';
import type { Cell } from '@cknerv/types';
import {
  useCellGalaxy,
  useCellGalaxyRef,
} from '../hooks/cellGalaxyContext';
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
  CELL_CLICK_MAX_POINTER_DELTA_PX,
  CELL_EXPANDED_DETAIL_THRESHOLD,
  CELL_EXPANDED_PICK_MIN_RADIUS_PX,
  CELL_EXPANDED_PICK_PADDING_PX,
  CELL_HOVER_FOCUS,
  CELL_PICK_FOCUS_PAD_CEILING_PX,
  CELL_SELECTED_FOCUS,
  CONSENSUS_BRAID_BASE_SCALE,
  CONSENSUS_BRAID_LOCAL_RADIUS,
  NETWORK_PEER_PICK_FLAG,
  cellCanvasCursor,
  pointerRayOwnedByNetworkPeer,
  cellGalaxyRotationScaleTarget,
  cellPickRadiusPx,
  consensusBraidRenderScale,
  dampCellGalaxyRotationScale,
  selectedCellNumericId,
} from '../derives/cellInteraction.derive';
import { makeCellHybridMaterial } from '../materials/cellHybridMaterial';
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
import { deriveCanonicalRewriteArrivals } from '../derives/canonicalRewrite.derive';
import {
  cellIdsWithinRadiusFromIndex,
  rotYWorldToLocalXZ,
  sharedCellNearestIndex,
} from '../derives/peers.derive';
import {
  collectCellFlashCandidates,
  markCellFlashDirty,
  mergeCellFlashRanges,
  rangesFromSortedSlots,
  writeActiveCellFlashIndicesFromCandidates,
  writeDirtyCellFlashSlots,
  type CellFlashDirtyIdsRef,
} from './cellFlash';
import { markPopulatedBufferUpdate } from '../geometry/populatedBufferAttribute';
import CellPopulationField from './CellPopulationField';

import { CHAIN_ANCHOR_HEX } from '../visualPalette';
import { HUD_COLORS, rgba } from './hud/hudTheme';
// Pre-parsed rest halo: the anchor frame loop re-asserts uColor every frame,
// and THREE's CSS-string parse is measurable at that rate.
const CHAIN_ANCHOR_HALO_COLOR = new THREE.Color(CHAIN_ANCHOR_HEX.halo);
import CellNucleus from './CellNucleus';

// ---------------------------------------------------------------------------
// Portable block trigger shape retained for overlay consumers. CellGalaxy uses
// the same event identity for its exact delivery/commit flashes; the broad
// brightness shockwave is owned and rendered by the P2P colony.
// ---------------------------------------------------------------------------

import {
  BEAM_GROW_DUR_S,
  BLOCK_HIGHLIGHT_DELAY_S,
  LOCAL_IGNITION_RADIUS,
  LOCAL_IGNITION_SPEED,
  MAX_BLOCK_HIGHLIGHTS,
  MAX_LOCAL_IGNITIONS,
} from '../ui/topologyConstants';

interface CellGalaxyProps {
  ckbNodeIds: string[];
  /** Resolved server projection cap. The shared renderer hard ceiling still
   * bounds allocations, while smaller profiles keep AUTO honest. */
  cellCapacity?: number;
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
  /** Optional live interaction gate. Consumers with camera controls can
   * suspend the O(N) screen-space picker after a real drag begins while still
   * allowing the pointer-down and click raycasts that preserve R3F semantics. */
  pickingSuspendedRef?: React.RefObject<boolean>;
  /** Compressed amount for the unresolved population, from
   *  `deriveCellPopulationField`. Zero (the default) places and draws nothing
   *  at all, which is the correct state whenever the stage covers its scope
   *  or the caller has not derived a population. */
  populationGain?: number;
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
const EMPTY_OVERLAY_ENTRIES: Cell[] = [];
const EMPTY_CELL_ID_LIST: number[] = [];

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

export interface CellBufferTargets {
  /** Shared per-cell attribute arrays consumed by the hybrid Points layer. */
  posArr:   Float32Array;
  colorArr: Float32Array;
  /** Packed record clock, 2 per slot: birth then death. */
  recordAtArr: Float32Array;
  /** Packed stage clock, 2 per slot: resolution in then release out. */
  stageAtArr: Float32Array;
  flashArr: Float32Array;
  sizeArr:  Float32Array;
  memoryIdentityArr: Float32Array;
  memorySeedArr: Float32Array;
  /** Picker-owned, never uploaded: the capacity-derived braid presence per
   * slot, in full precision so the screen index reads exactly the value the
   * derive returns. Optional only for callers that draw without picking. */
  pickPresenceArr?: Float64Array;
}

/** Client-clock lifecycle stamps keyed by cell id. Every one of them is
 * ABSENT for the resting case, and the sentinel written in its place is what
 * makes the corresponding shader ramp inert. */
export interface CellBufferStamps {
  /** Receipt-time birth for canonical rewrite arrivals, which carry
   * historical chain timestamps they must not be drawn at. */
  bornAt?: ReadonlyMap<number, number>;
  enterAt?: ReadonlyMap<number, number>;
  exitAt?: ReadonlyMap<number, number>;
}

export interface CellBufferPresentation {
  color: readonly [number, number, number];
  size: number;
  memoryIdentity: readonly [number, number, number, number];
  memorySeed: number;
  /** `consensusBraidPresenceScale(capacityMass(capacity))`, the one
   * capacity-derived term the pick disc reads. */
  braidPresence: number;
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
    braidPresence: consensusBraidPresenceScale(capacityMass(cell.capacity)),
  };
  cache?.set(cell, presentation);
  return presentation;
}

/** Write all visible Cell buffers, or only the supplied changed ranges for a
 * live block delta. Caller owns GPU update ranges and `needsUpdate` flags.
 *
 * Returns how many written slots changed a PICK input — point size or braid
 * presence — against what the slot held before. The screen-space hit index
 * bakes exactly those two per-slot values besides position, so this is the
 * one signal (beside the field version, which covers position) that can make
 * it stale; a rewrite that leaves both where they were, which is what every
 * enrichment refresh and every death does, returns zero and costs no
 * re-projection. */
export function writeCellBuffers(
  cells: Cell[],
  count: number,
  toSceneSeconds: (ms: number) => number,
  flashMap: Map<number, number>,
  targets: CellBufferTargets,
  stamps?: CellBufferStamps,
  ranges?: readonly CellBufferRange[],
  presentationCache?: WeakMap<Cell, CellBufferPresentation>,
): number {
  const activeRanges = ranges ?? [{ start: 0, count }];
  const pickPresenceArr = targets.pickPresenceArr;
  let pickInputsChanged = 0;
  for (const range of activeRanges) {
    const end = Math.min(count, cells.length, range.start + range.count);
    for (let i = Math.max(0, range.start); i < end; i += 1) {
      const c = cells[i];
      const { bornAtS, deathAtS } = cellLifecycleSceneTimes(
        c,
        toSceneSeconds,
        stamps?.bornAt?.get(c.id),
      );
      const flashAtS = flashMap.get(c.id) ?? -1e9;

      const presentation = cellBufferPresentation(c, presentationCache);
      // Compared as stored: the size lane is float32, the presence lane is
      // not, and the index reads both back from these arrays.
      if (
        Math.fround(presentation.size) !== targets.sizeArr[i]
        || (
          pickPresenceArr !== undefined
          && pickPresenceArr[i] !== presentation.braidPresence
        )
      ) {
        pickInputsChanged += 1;
      }
      if (pickPresenceArr !== undefined) {
        pickPresenceArr[i] = presentation.braidPresence;
      }
      targets.posArr[i * 3 + 0]   = c.pos_seed[0];
      targets.posArr[i * 3 + 1]   = c.pos_seed[1];
      targets.posArr[i * 3 + 2]   = c.pos_seed[2];
      targets.colorArr[i * 3 + 0] = presentation.color[0];
      targets.colorArr[i * 3 + 1] = presentation.color[1];
      targets.colorArr[i * 3 + 2] = presentation.color[2];
      targets.recordAtArr[i * 2 + 0] = bornAtS;
      targets.recordAtArr[i * 2 + 1] = deathAtS;
      // Stage stamps travel with the cell, not with the slot: swap-from-tail
      // moves a cell mid-fade, and a freed slot's next occupant must not
      // inherit the departure it was written for.
      targets.stageAtArr[i * 2 + 0] = stamps?.enterAt?.get(c.id)
        ?? ENTER_STAMP_SENTINEL;
      targets.stageAtArr[i * 2 + 1] = stamps?.exitAt?.get(c.id)
        ?? EXIT_STAMP_SENTINEL;
      targets.flashArr[i]         = flashAtS;
      targets.sizeArr[i]          = presentation.size;
      targets.memoryIdentityArr.set(presentation.memoryIdentity, i * 4);
      targets.memorySeedArr[i]    = presentation.memorySeed;
    }
  }
  return pickInputsChanged;
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

/** Write the stage-exit stamps of exactly the ids whose stamp changed, and
 * return their coalesced upload ranges. These cells KEEP their slot for the
 * fade, so the membership sync reports no dirty slot for them — a departure
 * (and a cancelled departure) is invisible to every other upload path. */
export function writeCellExitStampSlots(
  changedIds: readonly number[],
  slotOf: ReadonlyMap<number, number>,
  visibleCount: number,
  exitAt: ReadonlyMap<number, number>,
  stageAtArr: Float32Array,
): CellBufferRange[] {
  // Ranges stay in SLOT units — the caller merges them with the membership
  // ranges, and the upload marker scales both by the attribute's itemSize.
  const count = Math.min(
    Math.floor(stageAtArr.length / 2),
    Number.isFinite(visibleCount) ? Math.max(0, Math.floor(visibleCount)) : 0,
  );
  const slots: number[] = [];
  for (const id of changedIds) {
    const slot = slotOf.get(id);
    if (slot === undefined || slot < 0 || slot >= count) continue;
    stageAtArr[slot * 2 + 1] = exitAt.get(id) ?? EXIT_STAMP_SENTINEL;
    slots.push(slot);
  }
  slots.sort((a, b) => a - b);
  return rangesFromSortedSlots(slots);
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

/** The label under the chain anchor is DOM — a drei `Html` pinned to the
 *  scene, not a material — so its two tiers come from the HUD's text ladder
 *  rather than from a pair of hexes typed beside the opacities. Both were
 *  inside the separation floor of the rung they were reaching for: the resting
 *  grey 28.0 from `legendInk` and the selected cyan 15.5 from `cyanInk`, which
 *  is this file's own definition of one colour wearing two names. */
const ANCHOR_REST_PRESENTATION: CkbNodeAnchorPresentation = {
  haloIntensity: 0.52,
  edgeOpacity: 0.46,
  fillOpacity: 0.07,
  labelOpacity: 0.46,
  labelColor: HUD_COLORS.legendInk,
  labelShadow: `0 0 6px ${rgba(CHAIN_ANCHOR_HEX.halo, 0.24)}`,
};

const ANCHOR_SELECTED_PRESENTATION: CkbNodeAnchorPresentation = {
  haloIntensity: 0.92,
  edgeOpacity: 0.9,
  fillOpacity: 0.14,
  labelOpacity: 0.92,
  labelColor: HUD_COLORS.cyanInk,
  labelShadow:
    `0 0 5px ${rgba(CHAIN_ANCHOR_HEX.edge, 0.62)}, 0 0 11px ${rgba(CHAIN_ANCHOR_HEX.halo, 0.32)}`,
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
  const gl = useThree((state) => state.gl);
  const bodyRef = useRef<THREE.Group>(null);
  const presentation = ckbNodeAnchorPresentation(selected);
  // DESIGN: the anchor joins the measured peers' EXISTING arbitration instead
  // of minting a second one. NETWORK_PEER_PICK_FLAG reads as "a network-layer
  // node owns this pixel", and the labeled anchor IS the local network node
  // (inferredTopology pins the colony's local node onto this very position) —
  // so one flag, one `peerNodeHover` dataset word, and the shared cursor
  // contract stays three-writer rather than four.
  const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);

  const syncCursor = () => {
    const canvas = gl.domElement;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      canvas.dataset.peerNodeHover !== undefined,
    );
  };

  // Anchors do not churn the way peers do, but a StrictMode remount can still
  // unmount a hovered one without a pointer-out; never leave the canvas
  // advertising a hand for a node that no longer exists.
  useEffect(() => () => {
    const canvas = gl.domElement;
    if (canvas.dataset.peerNodeHover !== id) return;
    delete canvas.dataset.peerNodeHover;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      false,
    );
  }, [gl, id]);
  // All three of the anchor's surfaces — halo, wireframe, translucent fill —
  // come off the one token, which is the whole reason it lives in
  // `visualPalette.ts` rather than beside this component: `NodeSelfCard` tints
  // its frame from the same constant, so the floating card and the thing the
  // card is ABOUT are the same colour by construction. Two of the three used
  // to be typed as literals seventy lines below this binding, and retuning the
  // token moved the card while leaving the icosahedron exactly where it was.
  //
  // The event carrier lives in the halo. An intensity ref eases between the
  // subdued rest/selection levels and a short block-arrival peak, while the
  // shader supplies the single shared breathing envelope.
  const palette = CHAIN_ANCHOR_HEX;
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
            color={palette.edge}
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
            color={palette.fill}
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
        userData={hitUserData}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
        onPointerOver={() => {
          gl.domElement.dataset.peerNodeHover = id;
          syncCursor();
        }}
        onPointerOut={() => {
          if (gl.domElement.dataset.peerNodeHover === id) {
            delete gl.domElement.dataset.peerNodeHover;
          }
          syncCursor();
        }}
      >
        <sphereGeometry args={[ANCHOR_HIT_RADIUS, 8, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Html
        position={[0, -2.72, 0]}
        center
        occlude={false}
        // Bounded stack: drei's default range is in the millions, which put
        // this label ABOVE the DOM inspection cards (layer z 40). Above the
        // route/marker labels (6-8), below every floating card.
        zIndexRange={[10, 0]}
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
// Performance: one O(N) projection refresh per index revision feeds an
// allocation-stable screen-space grid, and every pointer query reuses it until
// something a pick answer reads has moved further than a pixel budget. The
// index bakes four per-slot inputs — position, point size, braid presence,
// expanded detail — and goes stale on their own counters (field version,
// pick-size epoch, detail epoch) and the draw count, never on the identity of
// the drawn list: a payload delta that moves no cell republishes the list and
// re-projects nothing. Two more inputs are deliberately NOT revisions: focus,
// which changes at most two discs and is padded at query time, and sub-budget
// camera motion, which is measured against the index's own drift envelope.
// While the camera is being moved — by a drag, by the damping tail after one,
// or by a route flight — hover probes are skipped altogether and the index is
// rebuilt once, lazily, on the first probe after the motion settles; presses
// and clicks are answered throughout, pointerdown from a precise snapshot.

interface CellPickerProps {
  cellsListRef: React.MutableRefObject<Cell[]>;
  drawCountRef: React.MutableRefObject<number>;
  fieldVersionRef: { readonly current: number };
  sizeEpochRef: { readonly current: number };
  pickPresenceArr: Float64Array;
  detailAttr: THREE.BufferAttribute;
  detailPickEpoch: ScalarThresholdEpoch;
  sizeAttr: THREE.BufferAttribute;
  selectedCellIdRef: React.MutableRefObject<number | null>;
  hoveredCellIdRef: React.MutableRefObject<number | null>;
  pickingSuspendedRef?: React.RefObject<boolean>;
  onSelect: (id: string | null) => void;
}

export function cellPointerGestureIsClick(delta: number): boolean {
  return Number.isFinite(delta)
    && delta >= 0
    && delta <= CELL_CLICK_MAX_POINTER_DELTA_PX;
}

/** The DOM events whose raycast a suspended picker still answers. R3F takes
 *  a click's target from the pointerdown raycast and reports a click that hit
 *  nothing as a miss, so skipping either during camera motion would turn a
 *  click on a Cell into a cleared selection; pointer moves — hover probes —
 *  are the only raycasts the suspension may drop. */
export function isCellPickPointerAction(
  event: { readonly type: string } | null,
): boolean {
  if (event === null) return false;
  const { type } = event;
  return type === 'pointerdown'
    || type === 'click'
    || type === 'dblclick'
    || type === 'contextmenu';
}

/** Screen-space error the hover index may accumulate from galaxy spin before
 *  it rebuilds. The galaxy rotates every frame, so exact matrix equality made
 *  EVERY pointermove rebuild the whole O(visible) projection; letting the
 *  worst-placed cell drift ≤ this many px keeps hover accuracy sub-visual
 *  (pick radii are 5–15px) while collapsing rebuilds during mouse motion to
 *  ~1 per 2s at the default spin rate. Clicks are exempt: pointerdown forces
 *  a precise snapshot. */
export const CELL_PICK_ROTATION_DRIFT_BUDGET_PX = 1.5;

/** Max screen-px displacement per radian of galaxy spin for one indexed
 *  cell: its distance from the spin (Y) axis times the world→pixel scale at
 *  its view depth. The index tracks the max over indexed cells and goes
 *  stale once accumulated spin could move that cell past the budget. */
export function cellPickDriftPxPerRadian(
  axisRadius: number,
  projectionScaleY: number,
  halfH: number,
  viewZ: number,
): number {
  return viewZ > 0 ? (axisRadius * projectionScaleY * halfH) / viewZ : 0;
}

/** Screen-px an indexed cell can have moved since the index was built, given
 *  how far the CAMERA has rotated and travelled — the same budget the galaxy's
 *  own spin gets, for the motion exact matrix equality used to rebuild on: the
 *  OrbitControls damping tail after every release and every route flight's
 *  exponential lerp, both of which run while the pointer is still moving.
 *
 *  Rotation needs nothing from the scene: the gnomonic projection stretches
 *  radially by sec²α, so one radian moves the worst point in the frame — the
 *  far corner — by f + corner²/f, with f = projectionScaleY·halfH the focal
 *  length in px. Translation is the term that does: its across-view component
 *  moves a point by f·d/z and its along-view component rescales screen radius
 *  by d/z, both worst at the NEAREST indexed cell. The denominator shrinks by
 *  the distance travelled so the bound stays a bound whichever way the move
 *  points, and a move that reaches that cell is unbounded — which is the
 *  honest answer, and forces the rebuild. */
export function cellPickCameraDriftPx(
  radians: number,
  distance: number,
  projectionScaleY: number,
  halfW: number,
  halfH: number,
  minViewZ: number,
): number {
  const focalPx = projectionScaleY * halfH;
  if (!(focalPx > 0)) return Infinity;
  const cornerSq = halfW * halfW + halfH * halfH;
  const rotationPx = Math.max(0, radians) * (focalPx + cornerSq / focalPx);
  if (!(distance > 0)) return rotationPx;
  const nearZ = minViewZ - distance;
  if (!(nearZ > 0)) return Infinity;
  return rotationPx + (distance * (focalPx + Math.sqrt(cornerSq))) / nearZ;
}

/** The one arithmetic behind a Cell's screen-space acquisition disc. The
 *  rebuild loop runs it at focus 0 for every indexed cell and the query-time
 *  pad re-runs it at the live focus for the ≤2 focused ones, so a padded disc
 *  is what a rebuild would have baked and not an approximation of it. */
export function cellPickDiscRadiusPx(
  pointSize: number,
  capacity: number,
  detail: number,
  focus: number,
  viewZ: number,
  height: number,
  halfH: number,
  projectionScaleY: number,
): number {
  const depthToPx = halfH / viewZ;
  const braidScale = consensusBraidRenderScale(
    viewZ,
    height,
    projectionScaleY,
    focus,
    consensusBraidPresenceScale(capacityMass(capacity)),
  );
  return cellPickRadiusPx(
    pointSize * depthToPx,
    CONSENSUS_BRAID_LOCAL_RADIUS * braidScale * projectionScaleY * depthToPx,
    detail,
  );
}

export interface CellPickRaycastSources {
  /** Read for `cells[hit.index]` and the focus-pad id lookup only. Its
   *  identity is NOT an index key: a payload delta republishes a fresh list
   *  with every slot where it was, and the index answers that list exactly. */
  cellsListRef: React.MutableRefObject<Cell[]>;
  drawCountRef: React.MutableRefObject<number>;
  /** Bumped when the drawn set's positions moved — a slot changed occupant or
   *  a replacement carried a different `pos_seed`. */
  fieldVersionRef: { readonly current: number };
  /** Bumped when `writeCellBuffers` changed a drawn slot's point size or
   *  braid presence. With the field version and the draw count, that is
   *  every per-slot input the index bakes. */
  sizeEpochRef: { readonly current: number };
  /** Per-slot `consensusBraidPresenceScale(capacityMass(capacity))`, filled
   *  by `writeCellBuffers` beside `sizeAttr`. */
  pickPresenceArr: Float64Array;
  detailAttr: THREE.BufferAttribute;
  detailPickEpoch: ScalarThresholdEpoch;
  /** Authoritative per-slot point size. `writeCellBuffers` fills it in the
   *  same synchronous block that publishes `cellsListRef` and bumps the
   *  epochs above, so a slot's size can never disagree with the cell the
   *  picker reads at that index. */
  sizeAttr: THREE.BufferAttribute;
  selectedCellIdRef: React.MutableRefObject<number | null>;
  hoveredCellIdRef: React.MutableRefObject<number | null>;
  /** While true, hover probes are skipped; presses and clicks still answer
   *  (see `isCellPickPointerAction`). */
  pickingSuspendedRef?: React.RefObject<boolean>;
  /** The DOM event R3F is dispatching this raycast for — its `lastEvent`. A
   *  raycast with no event on record counts as a hover probe. */
  pointerEventRef?: { readonly current: { readonly type: string } | null };
  forcePreciseRef: React.MutableRefObject<boolean>;
  viewportRef: React.MutableRefObject<{ width: number; height: number }>;
}

/** Build the picker's `Object3D.raycast`. Lives outside the component so the
 *  index's revision state and the gate that governs it can be exercised
 *  without an r3f Canvas, which jsdom cannot raycast through. */
export function createCellPickRaycast({
  cellsListRef,
  drawCountRef,
  fieldVersionRef,
  sizeEpochRef,
  pickPresenceArr,
  detailAttr,
  detailPickEpoch,
  sizeAttr,
  selectedCellIdRef,
  hoveredCellIdRef,
  pickingSuspendedRef,
  pointerEventRef,
  forcePreciseRef,
  viewportRef,
}: CellPickRaycastSources) {
  // Scratch allocations hoisted out of the per-cell loop.
  const cellView = new THREE.Vector3();
  const cellNdc = new THREE.Vector3();
  const rayNdc = new THREE.Vector3();
  const bestPoint = new THREE.Vector3();
  const modelView = new THREE.Matrix4();
  const viewDelta = new THREE.Matrix4();
  const cameraPosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const cameraScale = new THREE.Vector3();
  const screenIndex = new ScreenSpaceHitIndex(INSTANCE_CAPACITY);
  // The image-plane box of the admitted entries, refilled with every
  // rebuild: what the camera-motion budget is measured against.
  const envelope = new CellPickDriftEnvelope();
  const indexedMatrixWorld = new THREE.Matrix4();
  const indexedModelView = new THREE.Matrix4();
  const indexedProjection = new THREE.Matrix4();
  const indexedCameraMatrixWorld = new THREE.Matrix4();
  const indexedCameraPosition = new THREE.Vector3();
  const indexedCameraQuaternion = new THREE.Quaternion();
  // Two pad slots because `cellFocusTarget` has two inputs, selected first: a
  // cell that is both takes the selected disc once and leaves slot 1 unused.
  const focusPads: ScreenSpaceRadiusPad[] = [
    { index: -1, radius: 0 },
    { index: -1, radius: 0 },
  ];
  let indexedFieldVersion = -1;
  let indexedSizeEpoch = -1;
  let indexedCount = -1;
  let indexedDetailEpoch = -1;
  let indexedWidth = -1;
  let indexedHeight = -1;
  let indexedRotationY = 0;
  let indexedDriftPxPerRadian = 0;
  let indexedProjectionScaleY = 0;
  // Zero until a rebuild reports one, so an index holding nothing rebuilds on
  // any camera travel instead of trusting a depth it never measured.
  let indexedMinViewZ = 0;
  let indexedRevision = 0;
  let padRevision = -1;
  let padSelectedCellId: number | null = null;
  let padHoveredCellId: number | null = null;

  return function raycastCells(
    this: THREE.Object3D,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ): void {
    // Suspension drops hover probes only. A press or a click during camera
    // motion is answered as it always was — from a precise snapshot — because
    // R3F's click contract runs through both raycasts (see
    // `isCellPickPointerAction`).
    if (
      pickingSuspendedRef?.current
      && !isCellPickPointerAction(pointerEventRef?.current ?? null)
    ) return;
    const cells = cellsListRef.current;
    const count = Math.min(drawCountRef.current, cells.length);
    if (count === 0) return;
    const detailArray = detailAttr.array as Float32Array;
    const sizeArray = sizeAttr.array as Float32Array;
    const camera = raycaster.camera;
    if (!camera) return;
    const ray = raycaster.ray;

    // Recover the click point in NDC: any point on the ray in front of
    // the camera projects back to the same screen pixel. t=1 is fine.
    rayNdc.copy(ray.origin).addScaledVector(ray.direction, 1).project(camera);
    const clickNdcX = rayNdc.x;
    const clickNdcY = rayNdc.y;

    const { width, height } = viewportRef.current;
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const forcePrecise = forcePreciseRef.current;
    forcePreciseRef.current = false;
    const matrix = this.matrixWorld;
    // The galaxy group only ever SPINS about Y (it never translates or
    // scales), so a matrixWorld change is attributed to the recorded spin
    // and tolerated inside the pixel budget; a change with zero recorded
    // spin means some other ancestor transform moved — rebuild exactly.
    const rotationDrift = Math.abs(galaxyFrame.rotationY - indexedRotationY);
    const matrixStale = !indexedMatrixWorld.equals(matrix)
      && (rotationDrift === 0
        || rotationDrift * indexedDriftPxPerRadian
          > CELL_PICK_ROTATION_DRIFT_BUDGET_PX);
    // Camera motion is budgeted against the index's own drift envelope: the
    // exact worst case over the box its admitted entries span, so a damping
    // tail's last creep and a flight's final approach ride the index they
    // have, and anything that could have moved a disc past the budget does
    // not. Viewport and projection are pinned exactly below, so reading them
    // live for the bound is reading what the index was built with; the
    // projection stays an exact compare, it moves on resize and fov alone.
    // A camera that has not moved at all costs sixteen compares and nothing
    // else. An index holding no admitted entry has no envelope, and falls
    // back to the viewport-corner bound, which needs no entries to reason.
    let cameraStale = false;
    if (!indexedCameraMatrixWorld.equals(camera.matrixWorld)) {
      let cameraDriftPx: number;
      if (envelope.empty) {
        camera.matrixWorld.decompose(
          cameraPosition,
          cameraQuaternion,
          cameraScale,
        );
        cameraDriftPx = cellPickCameraDriftPx(
          indexedCameraQuaternion.angleTo(cameraQuaternion),
          indexedCameraPosition.distanceTo(cameraPosition),
          camera.projectionMatrix.elements[5],
          halfW,
          halfH,
          indexedMinViewZ,
        );
      } else {
        viewDelta.multiplyMatrices(
          camera.matrixWorldInverse,
          indexedCameraMatrixWorld,
        );
        cameraDriftPx = envelope.driftPx(
          viewDelta,
          halfW * camera.projectionMatrix.elements[0],
          halfH * camera.projectionMatrix.elements[5],
          // A padded disc scales like any other, so the largest radius a
          // query can see is the largest admitted one plus the pad ceiling.
          screenIndex.maxRadiusPx + CELL_PICK_FOCUS_PAD_CEILING_PX,
        );
      }
      cameraStale = cameraDriftPx > CELL_PICK_ROTATION_DRIFT_BUDGET_PX;
    }
    // The drawn list's identity is not a key: `cellSlotAssignment` republishes
    // a fresh array for any slot rewrite, including the ones that move no
    // cell, while the counters below move exactly when a baked input did.
    const structuralIndexChange = indexedFieldVersion !== fieldVersionRef.current
      || indexedSizeEpoch !== sizeEpochRef.current
      || indexedCount !== count
      // Detail reaches the index ONLY through cellPickRadiusPx's expanded
      // branch, which is a threshold test — so the attribute's version is
      // the wrong signal. A hover envelope eases for 0.3–0.7s and rewrites
      // its slots on every frame of it, and gating on the version made every
      // pointermove of a sweep re-project the whole field for magnitudes no
      // pick answer reads. The epoch counts crossings, so it moves exactly
      // when a cell's pick disc changes width.
      || indexedDetailEpoch !== detailPickEpoch.epoch
      || indexedWidth !== width
      || indexedHeight !== height
      || matrixStale
      || cameraStale
      || !indexedProjection.equals(camera.projectionMatrix);
    if (forcePrecise || structuralIndexChange) {
      // Focus is NOT baked in: every disc goes in unfocused and the ≤2
      // focused ones are padded at query time. The admit pad keeps entries
      // a pad could still reach inside the grid, so membership stays what a
      // focused rebuild's would have been.
      screenIndex.begin(width, height, CELL_PICK_FOCUS_PAD_CEILING_PX);
      modelView.multiplyMatrices(camera.matrixWorldInverse, matrix);
      const projectionScaleY = camera.projectionMatrix.elements[5];
      let maxDriftPxPerRadian = 0;
      let minViewZ = Infinity;
      // The drift envelope's extremes, tracked in locals for the same reason
      // as everything else in the loop, and handed over once at the end.
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      let minW = Infinity;
      let maxW = -Infinity;
      // This loop is the picker's whole cost, and it allocates nothing. Every
      // per-slot input is read from a typed array, and no double is passed
      // through a call: the engine boxes a double argument whenever it
      // decides not to inline the callee, and with a closure this size that
      // decision moves with every edit — `Math.hypot` alone left ~430 KB per
      // rebuild at 12K, three heap numbers per cell. So the disc arithmetic
      // is `cellPickDiscRadiusPx` at focus 0 written out in place (the braid
      // scale at rest is the base scale times presence — same operations,
      // same order, same bits; the pick oracle test pins the two together),
      // the spin bound is `cellPickDriftPxPerRadian` in place, the vectors
      // are written by field, and the index takes its entry through a typed
      // scratch. What remains callable takes an object or an integer.
      const indexEntry = screenIndex.entry;
      for (let i = 0; i < count; i += 1) {
        const seed = cells[i].pos_seed;
        const localX = seed[0];
        const localZ = seed[2];
        cellView.x = localX;
        cellView.y = seed[1];
        cellView.z = localZ;
        cellView.applyMatrix4(modelView);

        // View-space depth feeds both visual footprint and frustum rejection.
        const viewZ = -cellView.z;
        if (viewZ <= 0) continue;
        const depthToPx = halfH / viewZ;
        const braidScale = CONSENSUS_BRAID_BASE_SCALE
          * Math.max(0, pickPresenceArr[i]);
        const pointRadiusPx = sizeArray[i] * depthToPx;
        const braidRadiusPx = CONSENSUS_BRAID_LOCAL_RADIUS * braidScale
          * projectionScaleY * depthToPx;
        const pointRadius = Number.isFinite(pointRadiusPx)
          ? Math.max(0, pointRadiusPx)
          : 0;
        const braidRadius = Number.isFinite(braidRadiusPx)
          ? Math.max(0, braidRadiusPx)
          : 0;
        const visibleRadius = Math.max(pointRadius, braidRadius);
        const detail = detailArray[i] ?? 0;
        const pickPxR = !Number.isFinite(detail)
          || detail <= CELL_EXPANDED_DETAIL_THRESHOLD
          ? visibleRadius
          : Math.max(
            visibleRadius,
            CELL_EXPANDED_PICK_MIN_RADIUS_PX,
            braidRadius + CELL_EXPANDED_PICK_PADDING_PX,
          );

        // Reuse the view-space result instead of applying the camera inverse
        // a second time through Vector3.project().
        cellNdc.copy(cellView).applyMatrix4(camera.projectionMatrix);
        if (cellNdc.z < -1 || cellNdc.z > 1) continue;
        const driftPxPerRadian = (
          Math.sqrt(localX * localX + localZ * localZ)
          * projectionScaleY * halfH
        ) / viewZ;
        if (driftPxPerRadian > maxDriftPxPerRadian) {
          maxDriftPxPerRadian = driftPxPerRadian;
        }
        if (viewZ < minViewZ) minViewZ = viewZ;
        indexEntry[0] = (cellNdc.x + 1) * halfW;
        indexEntry[1] = (1 - cellNdc.y) * halfH;
        indexEntry[2] = pickPxR;
        indexEntry[3] = cellNdc.z;
        if (screenIndex.insertEntry(i)) {
          const w = 1 / viewZ;
          const u = cellView.x * w;
          const v = cellView.y * w;
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
          if (w < minW) minW = w;
          if (w > maxW) maxW = w;
        }
      }
      envelope.set(minU, maxU, minV, maxV, minW, maxW);
      indexedFieldVersion = fieldVersionRef.current;
      indexedSizeEpoch = sizeEpochRef.current;
      indexedCount = count;
      indexedDetailEpoch = detailPickEpoch.epoch;
      indexedWidth = width;
      indexedHeight = height;
      indexedRotationY = galaxyFrame.rotationY;
      indexedDriftPxPerRadian = maxDriftPxPerRadian;
      indexedProjectionScaleY = projectionScaleY;
      indexedMinViewZ = Number.isFinite(minViewZ) ? minViewZ : 0;
      indexedModelView.copy(modelView);
      indexedMatrixWorld.copy(matrix);
      indexedCameraMatrixWorld.copy(camera.matrixWorld);
      camera.matrixWorld.decompose(
        indexedCameraPosition,
        indexedCameraQuaternion,
        cameraScale,
      );
      indexedProjection.copy(camera.projectionMatrix);
      indexedRevision += 1;
    }

    const selectedCellId = selectedCellIdRef.current;
    const hoveredCellId = hoveredCellIdRef.current;
    if (
      padRevision !== indexedRevision
      || padSelectedCellId !== selectedCellId
      || padHoveredCellId !== hoveredCellId
    ) {
      padRevision = indexedRevision;
      padSelectedCellId = selectedCellId;
      padHoveredCellId = hoveredCellId;
      focusPads[0].index = -1;
      focusPads[1].index = -1;
      // The only O(count) step a focus change still costs: two id lookups
      // over the very list the index is keyed on, ~1% of the projection it
      // replaces. Selected wins the cell it shares with hover, exactly as
      // `cellFocusTarget` resolves it.
      let wanted = (selectedCellId === null ? 0 : 1)
        + (hoveredCellId === null || hoveredCellId === selectedCellId ? 0 : 1);
      for (let i = 0; i < count && wanted > 0; i += 1) {
        const id = cells[i].id;
        if (id === selectedCellId) {
          focusPads[0].index = i;
          wanted -= 1;
        } else if (id === hoveredCellId) {
          focusPads[1].index = i;
          wanted -= 1;
        }
      }
      // Padded discs are evaluated in the index's own snapshot — its model
      // view, its viewport — so a pad and the radii around it describe one
      // camera even while the live one drifts inside the budget.
      for (let slot = 0; slot < focusPads.length; slot += 1) {
        const pad = focusPads[slot];
        if (pad.index < 0) continue;
        const c = cells[pad.index];
        cellView
          .set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2])
          .applyMatrix4(indexedModelView);
        const viewZ = -cellView.z;
        if (viewZ <= 0) {
          pad.index = -1;
          continue;
        }
        pad.radius = cellPickDiscRadiusPx(
          sizeArray[pad.index],
          c.capacity,
          detailArray[pad.index] ?? 0,
          slot === 0 ? CELL_SELECTED_FOCUS : CELL_HOVER_FOCUS,
          viewZ,
          indexedHeight,
          indexedHeight * 0.5,
          indexedProjectionScaleY,
        );
      }
    }

    const hit = screenIndex.find(
      (clickNdcX + 1) * halfW,
      (1 - clickNdcY) * halfH,
      focusPads,
    );
    if (!hit) return;
    const hitCell = cells[hit.index];
    if (!hitCell) return;
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
}

/** Custom Object3D that participates in r3f's raycast pipeline. Its
 *  `raycast()` refreshes a current-frame screen index, then pushes an
 *  intersect for the cell whose own visual radius covers the pointer.
 *  The intersect carries `instanceId` so the existing `cell:${id}`
 *  selection contract is preserved. */
function CellPicker({
  cellsListRef,
  drawCountRef,
  fieldVersionRef,
  sizeEpochRef,
  pickPresenceArr,
  detailAttr,
  detailPickEpoch,
  sizeAttr,
  selectedCellIdRef,
  hoveredCellIdRef,
  pickingSuspendedRef,
  onSelect,
}: CellPickerProps) {
  const ref = useRef<THREE.Object3D>(null);
  const forcePreciseRaycastRef = useRef(false);
  const { gl, size } = useThree();
  // R3F records the DOM event it is dispatching before it raycasts, in one
  // ref for the root's lifetime: how the raycast tells a hover probe from a
  // press or a click while the picker is suspended.
  const pointerEventRef = useThree((state) => state.internal.lastEvent);
  // Live viewport ref keeps the raycast closure current without rebinding.
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    node.raycast = createCellPickRaycast({
      cellsListRef,
      drawCountRef,
      fieldVersionRef,
      sizeEpochRef,
      pickPresenceArr,
      detailAttr,
      detailPickEpoch,
      sizeAttr,
      selectedCellIdRef,
      hoveredCellIdRef,
      pickingSuspendedRef,
      pointerEventRef,
      forcePreciseRef: forcePreciseRaycastRef,
      viewportRef: sizeRef,
    });

    return () => {
      // Plain Object3D.raycast is a no-op; restore on unmount so a
      // future remount doesn't carry a stale closure.
      node.raycast = THREE.Object3D.prototype.raycast;
    };
  }, [
    cellsListRef,
    detailAttr,
    detailPickEpoch,
    drawCountRef,
    fieldVersionRef,
    hoveredCellIdRef,
    pickPresenceArr,
    pickingSuspendedRef,
    pointerEventRef,
    selectedCellIdRef,
    sizeAttr,
    sizeEpochRef,
  ]);

  useEffect(() => {
    const canvas = gl.domElement;
    const forcePreciseRaycast = () => {
      forcePreciseRaycastRef.current = true;
    };
    // Capture runs before R3F's delegated bubble handler. Pointer-down starts
    // from a precise snapshot; pointer-up/click then reuse it unless the camera,
    // Cell field, focus, viewport, or expanded-detail membership changed.
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
      gl.domElement.dataset.peerNodeHover !== undefined,
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
      gl.domElement.dataset.peerNodeHover !== undefined,
    );
  };

  return (
    <object3D
      ref={ref}
      onPointerMove={(e) => {
        if (
          pointerRayOwnedByNetworkPeer(e.intersections)
          || typeof e.instanceId !== 'number'
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
        // A network node's hit sphere on this same ray owns the pixel — a
        // measured peer or the labeled chain anchor alike: the Cell would win
        // the distance sort, so returning WITHOUT stopping propagation lets
        // the event walk on to the node.
        if (pointerRayOwnedByNetworkPeer(e.intersections)) return;
        e.stopPropagation();
        if (!cellPointerGestureIsClick(e.delta)) return;
        if (
          typeof e.instanceId !== 'number'
          || e.instanceId < 0
          || e.instanceId >= drawCountRef.current
        ) return;
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

interface CellIdentityCacheMarkersProps {
  identityProof: CellIdentityProofEvent | null;
  identityProofBinding: CellIdentityProofBinding | null;
  identityProofSampleElapsedSeconds?: number;
}

/** Render-owned cache decisions stay subscribed without making the thousand-
 * line frame driver a Context consumer. A proof can outlive the cache object
 * that first resolved it, so this small leaf deliberately rerenders and
 * resolves canonical-first on every committed cache value. */
const CellIdentityCacheMarkers = memo(function CellIdentityCacheMarkers({
  identityProof,
  identityProofBinding,
  identityProofSampleElapsedSeconds,
}: CellIdentityCacheMarkersProps) {
  const cellsCache = useCellGalaxy();
  const identityProofCell = identityProof
    ? cellsCache.cells.get(identityProof.cellId)
      ?? cellsCache.displayResidents.get(identityProof.cellId)
      ?? null
    : null;
  const identityProofBindingCell = identityProofBinding
    ? cellsCache.cells.get(identityProofBinding.cellId)
      ?? cellsCache.displayResidents.get(identityProofBinding.cellId)
      ?? null
    : null;
  return (
    <>
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
    </>
  );
});

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
function CellGalaxy({
  ckbNodeIds,
  cellCapacity,
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
  pickingSuspendedRef,
  populationGain = 0,
  localReceiveDelayS = 0,
}: CellGalaxyProps) {
  const simClock = useSimClock();
  const groupRef = useRef<THREE.Group>(null);
  // Server-driven cell list. The component is now a pure visual layer:
  // the frame callback reads the latest committed cache through one stable
  // handle and patches changed xyz / born / death slots in the Points buffers.
  // Render-owned proof markers retain an ordinary subscribed consumer above.
  const cellsCacheRef = useCellGalaxyRef();
  const { effective: quality } = useQualityRuntime();
  const cellDisplay = useCellDisplayRuntime();
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
  /** Display-journal cursor over the server-authored stage membership.
   * Ordinary churn patches indexed slots; only reset/skipped-journal/clamp
   * transitions rebuild. */
  const cellRenderSetRef = useRef(createCellRenderSetState());
  /** D4 overlay pool state: a SELECTED cell that sits off-stage renders as
   * an overlay entry appended after the staged list — client-transient,
   * never entering the shared display membership or the passive display
   * graph. */
  const overlayStateRef = useRef<{
    selectedCellId: number | null;
    entries: Cell[];
    /** Ids of `entries`, resolved only while the pool is non-empty — every
     * other segment has to ask whether the overlay already draws an id. */
    ids: Set<number> | null;
    combined: Cell[];
  }>({
    selectedCellId: null,
    entries: EMPTY_OVERLAY_ENTRIES,
    ids: null,
    combined: [],
  });
  /** Stage enter/exit stamps plus the deferred-free queue that keeps a
   * departing cell drawable for the length of its fade. */
  const cellLifecycleRef = useRef(createCellLifecycleStampState());
  /** Stable GPU slot assignment over the staged + overlay + exit-hold
   * membership. */
  const cellSlotStateRef = useRef(createCellSlotState());
  /** Bumped only when the slot sync reports the drawn cells MOVED. Published
   * beside `cellsListRef` in the same synchronous block, so a reader that
   * takes both takes one consistent generation of them. */
  const cellFieldVersionRef = useRef(0);
  /** Bumped when `writeCellBuffers` changed a drawn slot's point size or
   * braid presence — with the field version and the draw count, every
   * per-slot input the pick index bakes. Published in the same block. */
  const cellPickSizeEpochRef = useRef(0);
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
  const handledRewriteRef = useRef(cellsCacheRef.current.linkPrune);
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
  // Both clocks are packed pairs: the shader declares one vec2 per pair
  // because ESSL 3.00 charges a vertex slot for every DECLARED attribute and
  // the body material has only 13 to spend (see the budget test in
  // __tests__/materials/vertexAttributeBudget.test.ts). Component 0 is where
  // the gesture starts, component 1 where it ends — the same order the
  // shader swizzles.
  const cellRecordAtAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY * 2);
    // x = birth (0), y = death. Only the death half has a sentinel.
    for (let i = 1; i < arr.length; i += 2) arr[i] = 1e9;
    return new THREE.BufferAttribute(arr, 2);
  }, []);
  // Stage stamps: sparse per-churn writes, exactly the aFlashAt access
  // pattern. Their sentinels are the resting value, so an untouched slot is
  // always "fully resolved, not exiting".
  const cellStageAtAttr = useMemo(() => {
    const arr = new Float32Array(INSTANCE_CAPACITY * 2);
    for (let i = 0; i < arr.length; i += 2) {
      arr[i] = ENTER_STAMP_SENTINEL;
      arr[i + 1] = EXIT_STAMP_SENTINEL;
    }
    return new THREE.BufferAttribute(arr, 2)
      .setUsage(THREE.DynamicDrawUsage);
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
  // Picker-owned twin of the size lane: the per-slot braid presence, written
  // by the same `writeCellBuffers` pass and never uploaded.
  const cellPickPresenceArr = useMemo(
    () => new Float64Array(INSTANCE_CAPACITY),
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
  // The shaders read that lane as a continuous magnitude; the picker reads it
  // as one line — expanded braids get a padded pick disc, compact lights keep
  // their exact footprint. So the writer counts crossings of that line here,
  // and the picker's screen index goes stale on this counter rather than on
  // every frame of every hover envelope that ever eased.
  const cellDetailPickEpoch = useMemo<ScalarThresholdEpoch>(
    () => ({ threshold: CELL_EXPANDED_DETAIL_THRESHOLD, epoch: 0 }),
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
  const hybridMaterial = useMemo(() => makeCellHybridMaterial(), []);
  const flareMaterial = useMemo(() => makeCellFlareMaterial(), []);

  const cellGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', cellPosAttr);
    g.setAttribute('aColor', cellColorAttr);
    g.setAttribute('aRecordAt', cellRecordAtAttr);
    g.setAttribute('aStageAt', cellStageAtAttr);
    g.setAttribute('aFlashAt', cellFlashAtAttr);
    g.setAttribute('aSize', cellSizeAttr);
    g.setAttribute('aMemoryIdentity', cellMemoryIdentityAttr);
    g.setAttribute('aMemorySeed', cellMemorySeedAttr);
    g.setAttribute('aDetail', cellDetailAttr);
    g.setAttribute('aFocus', cellFocusAttr);
    g.setAttribute('aRecall', cellRecallAttr);
    g.setAttribute('aRecallState', cellRecallStateAttr);
    g.setDrawRange(0, 0);
    // Permissive sphere for the bounded tissue plus its rare halo drift.
    // Skipping this would let frustum culling drop the entire cloud at
    // oblique angles.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
    return g;
  }, [
    cellPosAttr,
    cellColorAttr,
    cellRecordAtAttr,
    cellStageAtAttr,
    cellFlashAtAttr,
    cellSizeAttr,
    cellMemoryIdentityAttr,
    cellMemorySeedAttr,
    cellDetailAttr,
    cellFocusAttr,
    cellRecallAttr,
    cellRecallStateAttr,
  ]);

  const cellFlareGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // Share the authoritative Cell attributes. Only the small element array is
    // flare-specific, so active writes do not duplicate position/lifecycle
    // buffers or change the resting body draw.
    g.setAttribute('position', cellPosAttr);
    g.setAttribute('aRecordAt', cellRecordAtAttr);
    g.setAttribute('aStageAt', cellStageAtAttr);
    g.setAttribute('aFlashAt', cellFlashAtAttr);
    g.setAttribute('aSize', cellSizeAttr);
    g.setIndex(cellFlareIndexAttr);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 120);
    return g;
  }, [
    cellPosAttr,
    cellRecordAtAttr,
    cellStageAtAttr,
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
    hybridMaterial.uniforms.uEnterDurS.value = ENTER_FADE_MS / 1000;
    hybridMaterial.uniforms.uExitDurS.value = EXIT_FADE_MS / 1000;
    flareMaterial.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    flareMaterial.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
    flareMaterial.uniforms.uEnterDurS.value = ENTER_FADE_MS / 1000;
    flareMaterial.uniforms.uExitDurS.value = EXIT_FADE_MS / 1000;
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

    // One coherent cache generation for this frame. The Provider advances the
    // stable handle at commit, so every read below observes the same immutable
    // reducer result without subscribing this scene root to Context identity.
    const cellsCache = cellsCacheRef.current;
    const cellDisplayLimit = resolveCellDisplayLimit(
      cellDisplay,
      cellCapacity,
      cellsCache.displayBudget?.cells,
    );
    const now = simClock.elapsedSec;
    // Derive the wall→scene-seconds basis live each frame instead of
    // anchoring on mount. Canvas remounts preserve simClock.elapsedSec,
    // so a mount-time Date.now() anchor would
    // desync the shader's uTime from the aRecordAt clock and cause new
    // events to render as if they had already happened.
    const sceneStartWallMs = Date.now() - now * 1000;
    const toSceneSeconds = (ms: number) => (ms - sceneStartWallMs) / 1000;

    const prevPulseAtMs = lastPulseAtMsRef.current;
    const pulseAtMs = cellsCache.lastPulseAtMs;
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
      || renderSet.displayToken !== cellsCache.displayToken
      || renderSet.displayBudget !== cellDisplayLimit
      || renderSet.displayPlaneActive !== (cellsCache.displayBudget !== null);
    const renderUpdate = renderNeedsSync
      ? syncCellRenderSet(renderSet, cellsCache, cellDisplayLimit)
      : null;
    // Overlay pool: selection visibility is a client transient appended
    // AFTER the staged list, resolved canonical-first. Recomputed only when
    // the staged list or the selection inputs move.
    const overlayState = overlayStateRef.current;
    // The staged list is copy-on-write, so a delta whose display journal
    // touched nothing on stage — an off-stage record, an enrichment refresh —
    // republishes the same array. Resolving the overlay against it stays
    // O(1) and runs on every delta; walking the drawn list does not, and
    // takes this as its precondition.
    const stagedChanged = cellRenderSetChanged(renderUpdate);
    const overlayNeedsSync = renderUpdate !== null
      || overlayState.selectedCellId !== selectedCellIdRef.current;
    let overlayChanged = false;
    if (overlayNeedsSync) {
      const overlay = cellRenderOverlay(
        cellsCache,
        renderSet.indexById,
        selectedCellIdRef.current,
      );
      overlayState.selectedCellId = selectedCellIdRef.current;
      // The shared buffers hold INSTANCE_CAPACITY slots; the staged list is
      // bounded by the display budget, so the reserved overlay pool fits.
      // Clamp defensively so a manual full-capacity clamp can never push
      // the combined list past the allocation.
      const capacityLeft = INSTANCE_CAPACITY - renderSet.cells.length;
      const entries = overlay.length > capacityLeft
        ? overlay.slice(0, Math.max(0, capacityLeft))
        : overlay;
      overlayChanged = cellRenderOverlayChanged(overlayState.entries, entries);
      overlayState.entries = entries;
      if (overlayChanged) {
        overlayState.ids = entries.length === 0
          ? null
          : new Set(entries.map((cell) => cell.id));
      }
    }
    // Stage lifecycle: a departure keeps its slot until its fade ends, so the
    // drawn list is staged + overlay + exit holds. Reaping is one comparison
    // against the time-ordered head, cheap enough to run every frame.
    const lifecycle = cellLifecycleRef.current;
    const holdsReaped = reapCellExitHolds(lifecycle, now);
    let holdsChanged = holdsReaped > 0;
    const overlayIds = overlayState.ids;
    let exitStampIds: readonly number[] = EMPTY_CELL_ID_LIST;
    // A selection can land on a cell that is still fading out, with no
    // journal patch behind it — so this runs on any overlay movement, not
    // only on membership churn: the hold has to end before the overlay draws
    // the same cell a second time. Nothing else can start or cancel a fade:
    // holds are born from `exited` and die from an overlay pickup.
    if (overlayChanged || (renderUpdate?.membershipChanged ?? false)) {
      const slotState = cellSlotStateRef.current;
      const stampSync = syncCellLifecycleStamps(lifecycle, {
        entered: renderUpdate?.entered ?? EMPTY_CELL_ID_LIST,
        exited: renderUpdate?.exited ?? EMPTY_CELL_ID_LIST,
        nowS: now,
        // A departing record is usually already gone from the cache — that
        // gc is what exited it — so the slot mirror is the honest fallback:
        // it holds exactly what the screen last drew.
        resolve: (id): CellLifecycleRecord | null => {
          const slot = slotState.slotOf.get(id);
          const cell = resolveStagedCell(cellsCache, id)
            ?? (slot === undefined ? undefined : slotState.cells[slot]);
          if (!cell) return null;
          return {
            cell,
            times: cellLifecycleSceneTimes(
              cell,
              toSceneSeconds,
              rewriteBirthAtRef.current.get(id),
            ),
          };
        },
        drawnElsewhere: overlayIds === null
          ? null
          : (id) => overlayIds.has(id),
      });
      exitStampIds = stampSync.exitStampIds;
      if (stampSync.held > 0 || stampSync.cancelled > 0) holdsChanged = true;
      pruneCellEnterStamps(lifecycle, now, ENTER_FADE_MS / 1000);
    }
    if (cellsMapChanged) {
      // A death landing mid-fade has to reach the buffers: the withering
      // clock is written from the record, so the held record must keep up.
      const refreshed = refreshCellExitHolds(
        lifecycle,
        (id) => resolveStagedCell(cellsCache, id) ?? null,
      );
      if (refreshed > 0) holdsChanged = true;
    }
    // The three segments of the drawn list, each with its own precondition:
    // a slot sync that runs for a list none of them moved spends 12K lookups
    // to conclude exactly that. Reaping is frame-driven and is the one thing
    // that re-syncs the slots with no journal patch behind it.
    const membershipNeedsSync = stagedChanged || overlayChanged || holdsChanged;
    if (membershipNeedsSync) {
      const staged = renderSet.cells;
      const overlayEntries = overlayState.entries;
      const holdCells = takeCellExitHoldCells(
        lifecycle,
        INSTANCE_CAPACITY - staged.length - overlayEntries.length,
      );
      overlayState.combined = overlayEntries.length === 0
        && holdCells.length === 0
        ? staged
        : staged.concat(overlayEntries, holdCells);
    }
    // Stable-slot indirection: each cell keeps its GPU slot while visible
    // (staged, overlay, or fading out), so uploads collapse to O(churn).
    const slotSync = membershipNeedsSync
      ? syncCellSlots(cellSlotStateRef.current, overlayState.combined)
      : null;
    const cellsList = slotSync?.cells ?? cellSlotStateRef.current.published;
    const count = cellsList.length;
    const cellBufferRanges = slotSync?.ranges ?? EMPTY_CELL_BUFFER_RANGES;
    const drawCountChanged = count !== drawCountRef.current;
    cellsListRef.current = cellsList;
    drawCountRef.current = count;
    if (slotSync?.positionsChanged) cellFieldVersionRef.current += 1;
    const flashMap = cellFlashRef.current;
    // Exit stamps land on slots whose occupant did not change, so this is the
    // one upload the membership ranges above cannot express. Merge both
    // sources and mark the attribute exactly once — a second mark would
    // clear the first. Enter rides the same packed attribute, so this is the
    // ONLY place the stage clock is marked.
    const exitStampRanges = exitStampIds.length === 0
      ? EMPTY_CELL_BUFFER_RANGES
      : writeCellExitStampSlots(
        exitStampIds,
        cellSlotStateRef.current.slotOf,
        count,
        lifecycle.exitAt,
        cellStageAtAttr.array as Float32Array,
      );
    markCellBufferUpdateRanges(
      cellStageAtAttr,
      exitStampRanges.length === 0
        ? cellBufferRanges
        : mergeCellFlashRanges(cellBufferRanges, exitStampRanges, count),
      count,
    );

    if (cellBufferRanges.length > 0 || drawCountChanged) {
      const pickInputsChanged = writeCellBuffers(
        cellsList,
        count,
        toSceneSeconds,
        flashMap,
        {
          posArr:   cellPosAttr.array as Float32Array,
          colorArr: cellColorAttr.array as Float32Array,
          recordAtArr: cellRecordAtAttr.array as Float32Array,
          stageAtArr:  cellStageAtAttr.array as Float32Array,
          flashArr: cellFlashAtAttr.array as Float32Array,
          sizeArr:  cellSizeAttr.array as Float32Array,
          memoryIdentityArr: cellMemoryIdentityAttr.array as Float32Array,
          memorySeedArr: cellMemorySeedAttr.array as Float32Array,
          pickPresenceArr: cellPickPresenceArr,
        },
        {
          bornAt: rewriteBirthAtRef.current,
          enterAt: lifecycle.enterAt,
          exitAt: lifecycle.exitAt,
        },
        cellBufferRanges,
        cellBufferPresentationCacheRef.current,
      );
      // Published beside the list, the count and the field version above: a
      // reader that takes them in one raycast takes one generation of all.
      if (pickInputsChanged > 0) cellPickSizeEpochRef.current += 1;

      cellGeometry.setDrawRange(0, count);
      markCellBufferUpdateRanges(cellPosAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(cellColorAttr, cellBufferRanges, count);
      markCellBufferUpdateRanges(cellRecordAtAttr, cellBufferRanges, count);
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
        const [originLocalX, originLocalZ] = rotYWorldToLocalXZ(
          worldOrigin[0],
          worldOrigin[2],
          group.rotation.y,
        );
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
        {/* The unresolved population, as real filaments in this rotating
            frame — the same positional law and the same material family as the
            Cell bodies, smaller and dimmer, drawn BENEATH them. Inside the
            group is the whole point: it turns with the Cells, with their
            parallax, as one body. Two draws, both siblings of the pick object
            rather than descendants of it: it carries no ids, registers no
            pointer handlers, and neither its points nor its fibres ever answer
            a raycast. */}
        <CellPopulationField gain={populationGain} />
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
            visibleIndexByCell={cellSlotStateRef.current.slotOf}
            fieldVersionRef={cellFieldVersionRef}
            groupRef={groupRef}
            detailAttr={cellDetailAttr}
            detailPickEpoch={cellDetailPickEpoch}
            focusAttr={cellFocusAttr}
            recallAttr={cellRecallAttr}
            recallStateAttr={cellRecallStateAttr}
            selectedCellIdRef={selectedCellIdRef}
            hoveredCellIdRef={hoveredCellIdRef}
          />
          {identityProof !== null || identityProofBinding !== null ? (
            <CellIdentityCacheMarkers
              identityProof={identityProof}
              identityProofBinding={identityProofBinding}
              identityProofSampleElapsedSeconds={identityProofSampleElapsedSeconds}
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
          fieldVersionRef={cellFieldVersionRef}
          sizeEpochRef={cellPickSizeEpochRef}
          pickPresenceArr={cellPickPresenceArr}
          detailAttr={cellDetailAttr}
          detailPickEpoch={cellDetailPickEpoch}
          sizeAttr={cellSizeAttr}
          selectedCellIdRef={selectedCellIdRef}
          hoveredCellIdRef={hoveredCellIdRef}
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

// Memoized: the consumer holds the whole dashboard's state in one component, so
// a chain poll, a stream-health flip or a note about an orbit gesture used to
// re-run this entire body — forty-odd hook slots and their dep compares — for a
// frame in which not one cell had moved. Cells now reach the imperative driver
// through `useCellGalaxyRef`, so cache-object replacement no longer pierces the
// memo bail-out; the frame reads the latest committed value. The small identity
// marker leaf remains a subscribed `useCellGalaxy` consumer because its cache
// resolution controls JSX and must receive a React commit.
export default memo(CellGalaxy);
