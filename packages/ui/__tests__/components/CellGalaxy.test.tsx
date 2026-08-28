import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import CellGalaxy from '../../src/components/CellGalaxy';
import {
  ckbNodeAnchorHaloTarget,
  ckbNodeAnchorPresentation,
  cellPointerGestureIsClick,
  cellPickCameraDriftPx,
  cellPickDiscRadiusPx,
  cellPickDriftPxPerRadian,
  CELL_PICK_ROTATION_DRIFT_BUDGET_PX,
  cellPointSize,
  createCellPickRaycast,
  diffCellBufferSlots,
  isCellPickPointerAction,
  planCellBufferUploadRanges,
  type CellBufferPresentation,
  writeFlashSlots,
  writeCellBuffers,
  writeCellExitStampSlots,
} from '../../src/components/CellGalaxy';
import {
  slotRangesUploadCost,
  slotUploadPolicy,
} from '../../src/nerve/fabricSlots';
import { getHeapSpaceStatistics } from 'node:v8';
import {
  CELL_HOVER_FOCUS,
  CELL_PICK_FOCUS_PAD_CEILING_PX,
  CELL_SELECTED_FOCUS,
  CONSENSUS_BRAID_LOCAL_RADIUS,
  cellFocusTarget,
  cellPickRadiusPx,
  consensusBraidRenderScale,
} from '../../src/derives/cellInteraction.derive';
import { consensusBraidPresenceScale } from '../../src/derives/consensusBraid.derive';
import { capacityMass } from '../../src/derives/cellVisual.derive';
import { ScreenSpaceHitIndex } from '../../src/geometry/screenSpaceHitIndex';
import {
  resetCellPickStats,
  snapshotCellPickStats,
} from '../../src/geometry/cellPickStats';
import {
  cellLifecycleSceneTimes,
  createCellLifecycleStampState,
  ENTER_STAMP_SENTINEL,
  EXIT_STAMP_SENTINEL,
  reapCellExitHolds,
  syncCellLifecycleStamps,
  takeCellExitHoldCells,
} from '../../src/geometry/cellLifecycleStamps';
import {
  cellRenderSetChanged,
  createCellRenderSetState,
  resolveStagedCell,
  syncCellRenderSet,
} from '../../src/geometry/cellRenderSet';
import {
  createCellSlotState,
  syncCellSlots,
} from '../../src/geometry/cellSlotAssignment';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from '@cknerv/cache';
import type { Cell, CellGalaxySnapshot } from '@cknerv/types';

const CELL_GALAXY_SOURCE = resolve(
  process.cwd(),
  'src/components/CellGalaxy.tsx',
);
const CELL_NUCLEUS_SOURCE = resolve(
  process.cwd(),
  'src/components/CellNucleus.tsx',
);
const CONTENT_ADDRESS_ECHO_SOURCE = resolve(
  process.cwd(),
  'src/components/CellContentAddressEchoMarker.tsx',
);
const OUTPOINT_LOCATOR_SOURCE = resolve(
  process.cwd(),
  'src/components/CellOutpointLocatorMarker.tsx',
);
const BIRTH_ANCHOR_SOURCE = resolve(
  process.cwd(),
  'src/components/CellBirthAnchorMarker.tsx',
);
const IDENTITY_PROOF_MARKER_SOURCE = resolve(
  process.cwd(),
  'src/components/CellIdentityProofMarker.tsx',
);
const IDENTITY_PROOF_LABEL_SOURCE = resolve(
  process.cwd(),
  'src/components/CellIdentityProofLabel.tsx',
);
const IDENTITY_PROOF_LABEL_PRESENTATION_SOURCE = resolve(
  process.cwd(),
  'src/components/cellIdentityProofLabel.presentation.ts',
);
const IDENTITY_BINDING_MARKER_SOURCE = resolve(
  process.cwd(),
  'src/components/CellIdentityBindingMarker.tsx',
);
const IDENTITY_BINDING_GLYPH_SOURCE = resolve(
  process.cwd(),
  'src/components/CellIdentityBindingGlyph.tsx',
);
const COLONY_NODES_SOURCE = resolve(
  process.cwd(),
  'src/components/ColonyNodes.tsx',
);

describe('CellGalaxy', () => {
  it('mounts inside an r3f Canvas without throwing', () => {
    const cellFlashRef = { current: new Map<number, number>() };
    const flashDirtyRef = { current: false };
    expect(() =>
      render(
        <CellGalaxyProvider value={emptyCellsCache()}>
          <Canvas>
            <CellGalaxy
              ckbNodeIds={[]}
              selectedId={null}
              onSelect={() => {}}
              cellFlashRef={cellFlashRef}
              flashDirtyRef={flashDirtyRef}
            />
          </Canvas>
        </CellGalaxyProvider>,
      ),
    ).not.toThrow();
  });

  it('does not mount the retired per-cell halo Points shockwave layer', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).not.toContain('makeHaloPointsMaterial');
    expect(source).not.toContain('makeHaloSpriteTexture');
    expect(source).not.toContain('haloMaterial');
  });

  it('leaves the broad new-block brightness wave to the peer network', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).not.toContain('writeShockwaveSlot(');
    expect(source).not.toContain('uShockwaveAt');
    expect(source).not.toContain('selectWaveAnchor');
  });

  it('does not mount the retired nebula gas background layer', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).not.toContain('nebulaGas');
    expect(source).not.toContain('NEBULA_GAS');
    expect(source).not.toContain('makeNebulaGas');
  });

  it('does not mount the retired breathing canopy veil', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).not.toContain('CellCanopyVeil');
  });

  it('uses the consensus braid as the only production Cell form', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('<CellNucleus');
    expect(source).not.toContain('<CellOrganism');
    expect(source).not.toContain('CELL_FORM');
  });

  it('uses the shared manual-or-server display budget for its draw range', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toMatch(
      /resolveCellDisplayLimit\(\s*cellDisplay,\s*cellCapacity,\s*cellsCache\.displayBudget\?\.cells,\s*\)/,
    );
    expect(source).toContain('createCellRenderSetState()');
    expect(source).toMatch(
      /syncCellRenderSet\(renderSet,\s*cellsCache,\s*cellDisplayLimit\)/,
    );
    expect(source).toContain('const count = cellsList.length');
  });

  it('keeps frame-owned cache churn off the scene-root render lane', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    const identityLeaf = source.slice(
      source.indexOf('const CellIdentityCacheMarkers = memo('),
      source.indexOf('function CellGalaxy('),
    );
    const root = source.slice(
      source.indexOf('function CellGalaxy('),
      source.indexOf('// Memoized:'),
    );
    const frame = root.slice(
      root.indexOf('useSimFrame('),
      root.indexOf('\n  return ('),
    );

    // The thousand-line root subscribes only to the stable handle, then takes
    // one immutable cache generation for each frame.
    expect(root).toContain('const cellsCacheRef = useCellGalaxyRef()');
    expect(root).not.toContain('const cellsCache = useCellGalaxy()');
    expect(frame).toContain('const cellsCache = cellsCacheRef.current');
    // A server-budget update still reaches stage sync even though it no longer
    // needs a React commit on the root.
    expect(frame).toMatch(
      /resolveCellDisplayLimit\(\s*cellDisplay,\s*cellCapacity,\s*cellsCache\.displayBudget\?\.cells,\s*\)/,
    );
    expect(frame).toContain(
      'syncCellRenderSet(renderSet, cellsCache, cellDisplayLimit)',
    );

    // Cache lookup that controls JSX remains on the ordinary subscribed lane,
    // including display-resident fallback for off-canonical staged records.
    expect(identityLeaf).toContain('const cellsCache = useCellGalaxy()');
    expect(identityLeaf).toContain('cellsCache.cells.get(identityProof.cellId)');
    expect(identityLeaf).toContain(
      'cellsCache.displayResidents.get(identityProof.cellId)',
    );
  });

  it('uploads exact dirty flash slots while retaining the legacy fallback', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('writeDirtyCellFlashSlots(');
    // The flash writer resolves ids through the STABLE slot map — list
    // positions reshuffle per block, GPU slots do not.
    expect(source).toContain('cellSlotStateRef.current.slotOf');
    expect(source).toContain('mergeCellFlashRanges(');
    expect(source).toContain('dirtyFlashIds?.clear()');
    expect(source).toContain('writeFlashSlots(');
    expect(source.match(/markCellFlashDirty\(/g)).toHaveLength(3);
  });

  it('submits only currently active protocol-write slots to the flare draw', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('writeActiveCellFlashIndicesFromCandidates(');
    expect(source).toContain('collectCellFlashCandidates(');
    expect(source).toContain('new Uint16Array(INSTANCE_CAPACITY)');
    expect(source).toContain('g.setIndex(cellFlareIndexAttr)');
    expect(source).toContain(
      'cellFlareGeometry.setDrawRange(0, flareIndexWrite.count)',
    );
    expect(source).toContain('geometry={cellFlareGeometry}');
    // And with no active slot at all it is an invisible object, not a
    // zero-vertex draw that still binds its program every frame; the flip
    // rides the same commit as the draw range.
    expect(source).toContain('ref={flarePointsRef}');
    const flareCommit = source.slice(
      source.indexOf('if (flareIndexWrite.changed) {'),
      source.indexOf('// 4. Material uniforms.'),
    );
    expect(flareCommit).toContain('cellFlareGeometry.setDrawRange(0, flareIndexWrite.count);');
    expect(flareCommit).toContain('flarePointsRef.current.visible = flareIndexWrite.count > 0;');
    expect(source).toContain('points.visible = flareDrawCountRef.current > 0;');
  });

  it('keeps every drawn cell pickable — no inspection navigation gate', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    // During inspection the picker must accept ANY cell: clicking another
    // cell switches the open card through the same handleSelect path.
    expect(source).not.toContain('cellInspectionNavigationTarget');
    expect(source).not.toContain('inspectionFieldRef');
    expect(source).not.toContain('aInspection');
    expect(source).toContain(
      'const count = Math.min(drawCountRef.current, cells.length)',
    );
    expect(source).toContain('i < count');
  });

  it('uses the live expanded-braid detail for a forgiving pick surface', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('cellPickRadiusPx(');
    expect(source).toContain('detailArray[i] ?? 0');
    expect(source).toContain('detailAttr={cellDetailAttr}');
  });

  it('suspends hover probes during camera motion, never presses or clicks', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('pickingSuspendedRef?: React.RefObject<boolean>');
    // The gate is the suspension AND "this is not a press or a click": R3F
    // takes a click's target from the pointerdown raycast and reports a
    // click with no hit as a miss, so the old all-events skip would have
    // turned a click during the damping tail into a cleared selection.
    expect(source).toMatch(
      /if \(\s*pickingSuspendedRef\?\.current\s*&& !isCellPickPointerAction\(pointerEventRef\?\.current \?\? null\)\s*\) return;/,
    );
    expect(source).not.toContain('if (pickingSuspendedRef?.current) return;');
    // The event comes from R3F's own record of what it is dispatching, not
    // from a second set of DOM listeners racing the first.
    expect(source).toContain('useThree((state) => state.internal.lastEvent)');
  });

  it('reuses one exact screen index until a projection input changes', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    // The window opens at the raycast factory and runs through the component
    // that binds it. The galaxy root is `memo(CellGalaxy)` now, so the slice
    // ends at the declaration rather than at an `export default function` that
    // no longer exists — an indexOf miss on either boundary would silently
    // widen the window and let the negative assertions below pass for free.
    const picker = source.slice(
      source.indexOf('export function createCellPickRaycast('),
      source.indexOf('function CellGalaxy('),
    );
    expect(source.indexOf('function CellGalaxy(')).toBeGreaterThan(-1);

    expect(picker).toContain('ScreenSpaceHitIndex');
    expect(picker).toContain('indexedMatrixWorld.equals(matrix)');
    expect(picker).toContain('indexedProjection.equals(camera.projectionMatrix)');
    expect(picker).toContain('indexedDetailEpoch !== detailPickEpoch.epoch');
    expect(picker).toContain('screenIndex.find(');
    expect(picker).toContain("canvas.addEventListener('pointerdown'");
    expect(picker).not.toContain("canvas.addEventListener('pointerup'");
    expect(picker).not.toContain("canvas.addEventListener('click'");
    expect(picker).not.toContain('window.requestAnimationFrame');
    expect(picker).not.toContain('indexFreshThisFrame');
    expect(picker).toContain('forcePreciseRaycastRef.current');

    // Focus identity is not a projection input: the two focused discs are
    // padded at query time, so a pointer sweep no longer re-projects the
    // field twice per cell it crosses.
    expect(picker).not.toContain('indexedSelectedCellId');
    expect(picker).not.toContain('indexedHoveredCellId');
    expect(picker).toContain('CELL_PICK_FOCUS_PAD_CEILING_PX');
    // Camera motion is a pixel budget like the spin above it, not an exact
    // matrix compare that every frame of a damping tail walks through.
    expect(picker).not.toContain('indexedCameraView');
    expect(picker).toContain('cellPickCameraDriftPx(');
  });

  it('goes stale on the detail line being crossed, not on detail moving', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    const nucleusSource = readFileSync(CELL_NUCLEUS_SOURCE, 'utf8');

    // One epoch object, owned beside the attribute it describes, seeded with
    // the ONE line the picker reads the lane across.
    expect(source).toMatch(
      /const cellDetailPickEpoch = useMemo<ScalarThresholdEpoch>\(\s*\(\) => \(\{ threshold: CELL_EXPANDED_DETAIL_THRESHOLD, epoch: 0 \}\),/,
    );
    // Handed to the writer and to the reader — same object, no module global.
    expect(source.match(/detailPickEpoch=\{cellDetailPickEpoch\}/g))
      .toHaveLength(2);
    // The raw attribute version is gone from the gate for good: it moves on
    // every frame of a 0.3-0.7s hover ease, and the pick answer does not.
    expect(source).not.toContain('detailAttr.version');
    expect(source).not.toContain('indexedDetailVersion');

    // Exactly one detail writer, and it is the one that carries the epoch.
    // The focus and recall lanes must NOT — they are not in the pick gate,
    // and epoch-ing them would put the rebuild back on every eased frame.
    expect(nucleusSource).toMatch(
      /writeSparseScalarAttribute\(\s*detailAttr,\s*detailSlots\.current,\s*writes,\s*detailPickEpoch,\s*\)/,
    );
    expect(nucleusSource.match(/detailPickEpoch/g)).toHaveLength(3);
    expect(nucleusSource).toContain(
      'writeSparseScalarAttribute(focusAttr, focusSlots.current, writes)',
    );
    expect(nucleusSource).toMatch(
      /writeSparseScalarAttribute\(\s*recallAttr,\s*recallSlots\.current,\s*recallWrites,\s*\)/,
    );
  });

  it('consumes only the server display plane — zero composition policy', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    // The old client-side composition machinery must stay dead: membership
    // is server-authored and arrives as the display journal.
    expect(source).not.toContain('galaxyComposition');
    expect(source).not.toContain('currentActivityCellIds');
    expect(source).not.toContain('pinCellInspectionFieldInVisiblePrefix');
    // Staged members resolve canonical-first through the display residents,
    // and selection visibility rides the bounded overlay pool appended
    // after the staged list.
    expect(source).toContain('cellsCache.displayResidents.get(');
    expect(source).toContain('cellRenderOverlay(');
    expect(source).toContain('renderSet.displayToken !== cellsCache.displayToken');
  });

  it('shares explicit memory focus between the route overlay and Cell body', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('<ConsensusMemoryFocusScope>');
    expect(source).toContain('recallAttr={cellRecallAttr}');
    expect(source).toContain('recallStateAttr={cellRecallStateAttr}');
  });

  it('mounts one exact WHERE / WHAT / WHEN proof at the confirmed Cell', () => {
    const galaxySource = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    const echoSource = readFileSync(CONTENT_ADDRESS_ECHO_SOURCE, 'utf8');
    const locatorSource = readFileSync(OUTPOINT_LOCATOR_SOURCE, 'utf8');
    const anchorSource = readFileSync(BIRTH_ANCHOR_SOURCE, 'utf8');
    const dispatcherSource = readFileSync(
      IDENTITY_PROOF_MARKER_SOURCE,
      'utf8',
    );
    const labelSource = readFileSync(IDENTITY_PROOF_LABEL_SOURCE, 'utf8');
    const labelPresentationSource = readFileSync(
      IDENTITY_PROOF_LABEL_PRESENTATION_SOURCE,
      'utf8',
    );

    expect(galaxySource).toContain('<CellIdentityProofMarker');
    expect(galaxySource).toContain('cellsCache.cells.get(identityProof.cellId)');
    expect(galaxySource).toContain(
      'sampleElapsedSeconds={identityProofSampleElapsedSeconds}',
    );
    expect(dispatcherSource).toContain("event.kind === 'address'");
    expect(dispatcherSource).toContain("event.kind === 'anchor'");
    expect(dispatcherSource).toContain('<CellContentAddressEchoMarker');
    expect(dispatcherSource.match(/sampleElapsedSeconds=/g)).toHaveLength(3);
    expect(echoSource).toContain('deriveCellContentAddressSegments(encoding)');
    expect(echoSource).toContain('cellContentAddressEchoFrame(');
    expect(echoSource).toContain('sampleElapsedSeconds');
    expect(echoSource).toContain('memoryContentAddressEchoFingerprint');
    expect(echoSource).toContain('new LineSegments2(');
    expect(locatorSource).toContain('deriveCellOutpointLocatorSegments(encoding)');
    expect(locatorSource).toContain('cellOutpointLocatorEchoFrame(');
    expect(locatorSource).toContain('sampleElapsedSeconds');
    expect(locatorSource).toContain('memoryOutpointLocatorIndexBytes');
    expect(anchorSource).toContain('deriveCellBirthAnchorSegments(encoding)');
    expect(anchorSource).toContain('cellBirthAnchorEchoFrame(');
    expect(anchorSource).toContain('sampleElapsedSeconds');
    expect(anchorSource).toContain('memoryBirthAnchorTargetWorldY: CHAIN_Y');
    expect(echoSource).toContain('<CellIdentityProofLabel');
    expect(locatorSource).toContain('<CellIdentityProofLabel');
    expect(anchorSource).toContain('<CellIdentityProofLabel');
    expect(labelSource).toContain('<Html');
    expect(labelPresentationSource).toContain(
      'presentCellIdentityProofLabel',
    );
    expect(labelSource).toContain("pointerEvents: 'none'");
  });

  it('opens one bounded identity knot at 0/3 and retains resolved proofs', () => {
    const galaxySource = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    const markerSource = readFileSync(IDENTITY_BINDING_MARKER_SOURCE, 'utf8');
    const glyphSource = readFileSync(IDENTITY_BINDING_GLYPH_SOURCE, 'utf8');

    expect(galaxySource).toContain('<CellIdentityBindingMarker');
    expect(galaxySource).toContain(
      'cellsCache.cells.get(identityProofBinding.cellId)',
    );
    expect(galaxySource).toContain(
      '{identityProofBinding && identityProofBindingCell ? (',
    );
    expect(galaxySource).toContain('cellGalaxyRotationScaleTarget(');
    expect(galaxySource).toContain('dampCellGalaxyRotationScale(');
    expect(markerSource).toContain('<Billboard');
    expect(markerSource).toContain('<CellIdentityBindingGlyph');
    expect(markerSource).not.toContain('resolvedKinds.length === 0');
    expect(glyphSource).toContain('CELL_IDENTITY_PROOF_KINDS.map');
    expect(glyphSource).toContain('cellIdentityProofBindingComplete(binding)');
    expect(glyphSource).toContain('memoryIdentityBindingPhase');
    expect(glyphSource).toContain('<ringGeometry');
    expect(glyphSource).not.toContain('<Html');
    expect(glyphSource).not.toContain('<img');
  });

  it('mounts with localReceiveDelayS (receive-delayed reaction) without throwing', () => {
    const cellFlashRef = { current: new Map<number, number>() };
    const flashDirtyRef = { current: false };
    expect(() =>
      render(
        <CellGalaxyProvider value={emptyCellsCache()}>
          <Canvas>
            <CellGalaxy
              ckbNodeIds={['ckb:local']}
              selectedId={null}
              onSelect={() => {}}
              cellFlashRef={cellFlashRef}
              flashDirtyRef={flashDirtyRef}
              localReceiveDelayS={0.3}
            />
          </Canvas>
        </CellGalaxyProvider>,
      ),
    ).not.toThrow();
  });
});

describe('CKB node anchor emphasis', () => {
  it('keeps the resting anchor subordinate and promotes deliberate states', () => {
    const resting = ckbNodeAnchorPresentation(false);
    const selected = ckbNodeAnchorPresentation(true);

    expect(resting.haloIntensity).toBeLessThan(selected.haloIntensity);
    expect(resting.edgeOpacity).toBeLessThan(selected.edgeOpacity);
    expect(resting.fillOpacity).toBeLessThan(selected.fillOpacity);
    expect(resting.labelOpacity).toBeLessThan(selected.labelOpacity);
    expect(ckbNodeAnchorHaloTarget(false, false)).toBe(
      resting.haloIntensity,
    );
    expect(ckbNodeAnchorHaloTarget(true, false)).toBe(
      selected.haloIntensity,
    );
    expect(ckbNodeAnchorHaloTarget(false, true)).toBeGreaterThan(
      selected.haloIntensity,
    );
  });

  it('owns its pixel through the peers\' arbitration, not a second one', () => {
    const galaxySource = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    const colonySource = readFileSync(COLONY_NODES_SOURCE, 'utf8');

    // ONE flag and ONE dataset word for every network node: the Cell picker's
    // existing yield then covers the labeled local anchor with no new branch,
    // and the shared cursor arbitration stays three-writer.
    expect(galaxySource).toContain(
      'const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);',
    );
    expect(colonySource).toContain(
      'const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);',
    );
    expect(galaxySource).toContain('userData={hitUserData}');
    // Hover affordance: the anchor offers the same hand a measured peer does.
    expect(galaxySource).toContain('gl.domElement.dataset.peerNodeHover = id;');
    expect(galaxySource).toContain(
      'if (gl.domElement.dataset.peerNodeHover === id) {',
    );
    // ... and the remount guard, so no stale hand outlives the anchor.
    expect(galaxySource).toContain(
      'if (canvas.dataset.peerNodeHover !== id) return;',
    );
    // Selection itself is untouched: the click still names the anchor.
    expect(galaxySource).toContain('onSelect(id);');
  });
});

describe('CellGalaxy click', () => {
  it('rejects R3F clicks synthesized from pointer drags', () => {
    expect(cellPointerGestureIsClick(0)).toBe(true);
    expect(cellPointerGestureIsClick(2)).toBe(true);
    expect(cellPointerGestureIsClick(3)).toBe(false);
    expect(cellPointerGestureIsClick(Number.NaN)).toBe(false);

    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');
    expect(source).toContain(
      'if (!cellPointerGestureIsClick(e.delta)) return;',
    );
  });

  it('encodes cell selection as `cell:<id>` when instanceId is set', () => {
    const onSelect = vi.fn();

    // Rebuild the handler in isolation — r3f Canvas + raycasting can't
    // run in jsdom, so we exercise the contract via a constructed event.
    const cellsListRef = {
      current: [
        {
          id: 42,
          born_at_ms: 0,
          death_at_ms: null,
          birth_block: 1,
          tag: null,
          pos_seed: [0, 0, 0] as [number, number, number],
          out_point: { tx_hash: '0xabc', index: 0 },
          capacity: 100,
          data_hex: '0x',
          data_bytes: 0,
          content_hash: '0x' + '00'.repeat(32),
          lock_shape_seed: [1, 2] as [number, number],
          type_shape_seed: null,
          data_shape_seed: [3, 4] as [number, number],
        },
      ],
    };

    const handler = (e: { instanceId?: number; stopPropagation: () => void }) => {
      e.stopPropagation();
      if (typeof e.instanceId !== 'number') return;
      const cell = cellsListRef.current[e.instanceId];
      if (!cell) return;
      onSelect(`cell:${cell.id}`);
    };

    handler({ instanceId: 0, stopPropagation: () => {} });
    expect(onSelect).toHaveBeenCalledWith('cell:42');
  });

  it('is a no-op when instanceId is missing', () => {
    const onSelect = vi.fn();
    const handler = (e: { instanceId?: number; stopPropagation: () => void }) => {
      e.stopPropagation();
      if (typeof e.instanceId !== 'number') return;
      onSelect('cell:should-not-fire');
    };
    handler({ stopPropagation: () => {} });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pure-function unit tests (no Canvas / r3f needed)
// ---------------------------------------------------------------------------

function mkCell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: '0x', index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

describe('writeFlashSlots', () => {
  it('writes flashMap value into the flash array at the cell index', () => {
    const cells = [mkCell(10), mkCell(20), mkCell(30)];
    const flashMap = new Map<number, number>([[20, 4.5]]);
    const flashArr = new Float32Array(8).fill(-1e9);

    writeFlashSlots(cells, 3, flashMap, flashArr);

    expect(flashArr[0]).toBe(-1e9);
    expect(flashArr[1]).toBe(4.5);
    expect(flashArr[2]).toBe(-1e9);
    expect(flashArr[3]).toBe(-1e9);
  });

  it('writes -1e9 sentinel when the cell has no flash entry', () => {
    const cells = [mkCell(10)];
    const flashMap = new Map<number, number>();
    const flashArr = new Float32Array(4);

    writeFlashSlots(cells, 1, flashMap, flashArr);

    expect(flashArr[0]).toBe(-1e9);
  });
});

describe('writeCellBuffers', () => {
  it('reports the slots whose pick inputs changed, and fills the presence lane', () => {
    const cells = [mkCell(10), mkCell(20), mkCell(30)];
    cells[1].capacity = 900e8;
    const n = cells.length;
    const t = {
      posArr: new Float32Array(n * 3),
      colorArr: new Float32Array(n * 3),
      recordAtArr: new Float32Array(n * 2),
      stageAtArr: new Float32Array(n * 2),
      flashArr: new Float32Array(n),
      sizeArr: new Float32Array(n),
      memoryIdentityArr: new Float32Array(n * 4),
      memorySeedArr: new Float32Array(n),
      pickPresenceArr: new Float64Array(n),
    };
    const write = (list: Cell[]) => writeCellBuffers(
      list, n, (ms: number) => ms / 1000, new Map(), t,
    );

    // First fill: every slot is new to the lanes.
    expect(write(cells)).toBe(3);
    for (let i = 0; i < n; i += 1) {
      expect(t.sizeArr[i]).toBe(Math.fround(cellPointSize(cells[i])));
      expect(t.pickPresenceArr[i])
        .toBe(consensusBraidPresenceScale(capacityMass(cells[i].capacity)));
    }
    // A payload delta — new objects, same size and capacity — reports none.
    const refreshed = cells.map((cell) => ({
      ...cell,
      data_hex: '0xff',
      death_at_ms: 5,
    }));
    expect(write(refreshed)).toBe(0);
    // A tag changes the point size; a capacity changes the presence.
    const tagged = refreshed.map((cell, i) => (
      i === 0 ? { ...cell, tag: 'tagged' as const } : cell
    ));
    expect(write(tagged)).toBe(1);
    expect(t.sizeArr[0]).toBe(Math.fround(cellPointSize(tagged[0])));
    const heavier = tagged.map((cell, i) => (
      i === 2 ? { ...cell, capacity: 3e12 } : cell
    ));
    expect(write(heavier)).toBe(1);
    expect(t.pickPresenceArr[2])
      .toBe(consensusBraidPresenceScale(capacityMass(3e12)));
    // Rewriting the same records again changes nothing.
    expect(write(heavier)).toBe(0);
    // Without the lane, only the size counts.
    const { pickPresenceArr: _omit, ...withoutLane } = t;
    expect(writeCellBuffers(
      heavier.map((cell, i) => (i === 1 ? { ...cell, capacity: 1 } : cell)),
      n, (ms: number) => ms / 1000, new Map(), withoutLane,
    )).toBe(0);
  });

  it('coalesces only changed immutable Cell slots after a block delta', () => {
    const first = mkCell(1);
    const second = mkCell(2);
    const third = mkCell(3);
    const taggedSecond = { ...second, tag: 'wallet' as const };

    expect(diffCellBufferSlots([], [first, second, third])).toEqual({
      ranges: [{ start: 0, count: 3 }],
      membershipChanged: true,
    });
    expect(diffCellBufferSlots(
      [first, second, third],
      [first, taggedSecond, third],
    )).toEqual({
      ranges: [{ start: 1, count: 1 }],
      membershipChanged: false,
    });
    expect(diffCellBufferSlots(
      [first, second],
      [first, second, third],
    )).toEqual({
      ranges: [{ start: 2, count: 1 }],
      membershipChanged: true,
    });
    expect(diffCellBufferSlots(
      [first, second, third],
      [first, second, third],
    )).toEqual({ ranges: [], membershipChanged: false });
  });

  it('derives only requested Cell buffer ranges', () => {
    const cells = [mkCell(1), mkCell(2), mkCell(3)];
    const presentationCache = new WeakMap<Cell, CellBufferPresentation>();
    const t = {
      posArr: new Float32Array(9).fill(-99),
      colorArr: new Float32Array(9).fill(-99),
      recordAtArr: new Float32Array(6).fill(-99),
      stageAtArr: new Float32Array(6).fill(-99),
      flashArr: new Float32Array(3).fill(-99),
      sizeArr: new Float32Array(3).fill(-99),
      memoryIdentityArr: new Float32Array(12).fill(-99),
      memorySeedArr: new Float32Array(3).fill(-99),
    };

    writeCellBuffers(
      cells,
      cells.length,
      (ms: number) => ms / 1000,
      new Map(),
      t,
      undefined,
      [{ start: 1, count: 1 }],
      presentationCache,
    );

    expect(t.posArr[0]).toBe(-99);
    expect(t.posArr[3]).toBe(cells[1].pos_seed[0]);
    expect(t.posArr[6]).toBe(-99);
    expect(t.recordAtArr[0]).toBe(-99);
    expect(t.recordAtArr[2]).not.toBe(-99);
    expect(t.recordAtArr[4]).toBe(-99);
    // Stage stamps ride the same ranges as every other per-cell attribute,
    // two components at a time.
    expect([...t.stageAtArr]).toEqual([
      -99,
      -99,
      ENTER_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      -99,
      -99,
    ]);
    expect(t.memoryIdentityArr[4]).not.toBe(-99);
    expect(t.memoryIdentityArr[8]).toBe(-99);
    expect(presentationCache.has(cells[0])).toBe(false);
    expect(presentationCache.has(cells[1])).toBe(true);
    expect(presentationCache.has(cells[2])).toBe(false);
  });

  it('writes position, color, born/death and flash for each cell', () => {
    const cells: Cell[] = [
      {
        ...mkCell(1),
        pos_seed: [1, 2, 3],
        born_at_ms: 1000,
        capacity: 61e8,
        asset_kind: 'native',
        lock_kind: 'sighash',
      },
      {
        ...mkCell(2),
        pos_seed: [4, 5, 6],
        born_at_ms: 2000,
        tag: 'wallet',
        capacity: 1_000_000e8,
        data_hex: `0x${'ab'.repeat(1024)}`,
        data_bytes: 1024,
        asset_kind: 'dao',
        lock_kind: 'omnilock',
      },
    ];
    const t = {
      posArr:   new Float32Array(6),
      colorArr: new Float32Array(6),
      recordAtArr: new Float32Array(4),
      stageAtArr:  new Float32Array(4),
      flashArr: new Float32Array(2).fill(-1e9),
      sizeArr:  new Float32Array(2),
      memoryIdentityArr: new Float32Array(8),
      memorySeedArr: new Float32Array(2),
    };
    const flashMap = new Map<number, number>([[2, 7.5]]);

    writeCellBuffers(cells, 2, (ms: number) => ms / 1000, flashMap, t);

    // Position copied from pos_seed.
    expect(t.posArr[0]).toBe(1);
    expect(t.posArr[1]).toBe(2);
    expect(t.posArr[2]).toBe(3);
    expect(t.posArr[3]).toBe(4);
    // Untagged Cells restore the earlier luminous rose body.
    expect(t.colorArr[0]).toBeCloseTo(1, 5);
    expect(t.colorArr[1]).toBeCloseTo(0.4, 5);
    expect(t.colorArr[2]).toBeCloseTo(0.44, 5);
    // Explicit runtime tags keep their established pastel identity.
    expect(t.colorArr[3]).toBeCloseTo(0.43, 5);
    expect(t.colorArr[4]).toBeCloseTo(0.91, 5);
    expect(t.colorArr[5]).toBeCloseTo(0.72, 5);
    // Size: stable per-id morphology; tags remain the larger landmarks.
    expect(t.sizeArr[0]).toBeCloseTo(cellPointSize(cells[0]), 5);
    expect(t.sizeArr[1]).toBeCloseTo(cellPointSize(cells[1]), 5);
    expect(t.sizeArr[1]).toBeGreaterThan(t.sizeArr[0]);
    // Flash slot 1 (cell id=2) has 7.5 from flashMap.
    expect(t.flashArr[1]).toBe(7.5);
    // Packed record clock: birth in .x, the still-alive sentinel in .y. The
    // two cells were born a second apart and carry the same commit delay.
    expect(t.recordAtArr[2] - t.recordAtArr[0]).toBeCloseTo(1, 5);
    expect(t.recordAtArr[1]).toBe(1e9);
    expect(t.recordAtArr[3]).toBe(1e9);
    // Far retained cores preserve the same bounded A field mapping.
    expect([...t.memoryIdentityArr.slice(0, 3)]).toEqual([0, 0, 0]);
    expect(t.memoryIdentityArr[3]).toBeGreaterThan(0);
    expect(t.memoryIdentityArr[3]).toBeLessThan(1);
    expect(t.memoryIdentityArr[4]).toBeCloseTo(3 / 7);
    expect(t.memoryIdentityArr[5]).toBeCloseTo(0.75);
    expect(t.memoryIdentityArr[6]).toBe(1);
    expect(t.memoryIdentityArr[7]).toBe(1);
    expect(t.memorySeedArr[0]).toBe(0);
  });

  it('uses receipt-time birth only for canonical replacement overrides', () => {
    const cells = [mkCell(1), mkCell(2)];
    const t = {
      posArr: new Float32Array(6),
      colorArr: new Float32Array(6),
      recordAtArr: new Float32Array(4),
      stageAtArr: new Float32Array(4),
      flashArr: new Float32Array(2).fill(-1e9),
      sizeArr: new Float32Array(2),
      memoryIdentityArr: new Float32Array(8),
      memorySeedArr: new Float32Array(2),
    };

    writeCellBuffers(
      cells,
      2,
      (ms: number) => ms / 1000,
      new Map(),
      t,
      { bornAt: new Map([[2, 42]]) },
    );

    expect(t.recordAtArr[2]).toBe(42);
    expect(t.recordAtArr[0]).not.toBe(42);
  });

  it('writes stage stamps per cell id, sentinels for everyone else', () => {
    const cells = [mkCell(1), mkCell(2), mkCell(3)];
    const t = {
      posArr: new Float32Array(9),
      colorArr: new Float32Array(9),
      recordAtArr: new Float32Array(6),
      stageAtArr: new Float32Array(6),
      flashArr: new Float32Array(3).fill(-1e9),
      sizeArr: new Float32Array(3),
      memoryIdentityArr: new Float32Array(12),
      memorySeedArr: new Float32Array(3),
    };

    writeCellBuffers(
      cells,
      3,
      (ms: number) => ms / 1000,
      new Map(),
      t,
      { enterAt: new Map([[1, 5]]), exitAt: new Map([[3, 9]]) },
    );

    // Stamps follow the CELL, so a swap-from-tail move carries them along
    // and a freed slot's next occupant inherits neither.
    expect([...t.stageAtArr]).toEqual([
      5,
      EXIT_STAMP_SENTINEL,
      ENTER_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      ENTER_STAMP_SENTINEL,
      9,
    ]);
  });
});

describe('CellGalaxy useSimFrame buffer behavior', () => {
  it('keeps full buffer writes deterministic for snapshot hydration', () => {
    const cells = [mkCell(1)];
    const t = {
      posArr:   new Float32Array(3),
      colorArr: new Float32Array(3),
      recordAtArr: new Float32Array(2),
      stageAtArr:  new Float32Array(2),
      flashArr: new Float32Array(1).fill(-1e9),
      sizeArr:  new Float32Array(1),
      memoryIdentityArr: new Float32Array(4),
      memorySeedArr: new Float32Array(1),
    };
    writeCellBuffers(cells, 1, (ms: number) => ms / 1000, new Map(), t);
    const snapshotColor = t.colorArr[0];
    writeCellBuffers(cells, 1, (ms: number) => ms / 1000, new Map(), t);
    expect(t.colorArr[0]).toBe(snapshotColor);
  });

  it('routes live block changes through partial CPU and GPU ranges', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('const renderUpdate = renderNeedsSync');
    expect(source).toContain('? syncCellRenderSet(');
    // Uploads are driven by the stable-slot sync, not list positions.
    expect(source).toContain('syncCellSlots(cellSlotStateRef.current');
    expect(source).toContain(
      'const cellBufferRanges = slotSync?.ranges',
    );
    expect(source).toContain('cellBufferRanges,');
    expect(source).toContain('markCellBufferUpdateRanges(');
  });

  it('draws staged + overlay + exit holds, and reaps every frame', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    // The drawn list gains a third segment; the slot layer keeps it dense.
    expect(source).toContain('const holdsReaped = reapCellExitHolds(');
    expect(source).toContain('const holdCells = takeCellExitHoldCells(');
    expect(source).toContain(
      'staged.concat(overlayEntries, holdCells)',
    );
    // Reaping is frame-driven, membership work is not: a hold expiring is
    // the one thing that re-syncs the slots without a journal patch. Each
    // segment of the drawn list carries its own precondition; a delta that
    // moved none of them never reaches the slot layer.
    expect(source).toContain(
      'const membershipNeedsSync = stagedChanged || overlayChanged'
      + ' || holdsChanged;',
    );
    expect(source).toContain(
      'const stagedChanged = cellRenderSetChanged(renderUpdate);',
    );
    expect(source).toContain(
      'cellRenderOverlayChanged(overlayState.entries, entries)',
    );
    expect(source).toContain('let holdsChanged = holdsReaped > 0;');
    expect(source).toContain(
      'if (stampSync.held > 0 || stampSync.cancelled > 0) holdsChanged = true;',
    );
    expect(source).toContain('if (refreshed > 0) holdsChanged = true;');
    // The hold segment can never outgrow the allocation it is written into.
    expect(source).toContain(
      'INSTANCE_CAPACITY - staged.length - overlayEntries.length',
    );
    // Stamping reads the membership diff the render set now publishes, and
    // runs on overlay movement too — a selection can land on a fading cell.
    expect(source).toContain('entered: renderUpdate?.entered');
    expect(source).toContain('exited: renderUpdate?.exited');
    expect(source).toContain(
      'if (overlayChanged || (renderUpdate?.membershipChanged ?? false)) {'
      + '\n      const slotState',
    );
    // The packed stage clock is marked exactly once, from both range
    // sources — enter and exit share one attribute, so a second mark would
    // clear the first.
    expect(source.match(/markCellBufferUpdateRanges\(\n?\s*cellStageAtAttr/g))
      .toHaveLength(1);
    expect(source).toContain(
      'mergeCellFlashRanges(cellBufferRanges, exitStampRanges, count)',
    );
  });
});

// ── the drawn list's preconditions, replayed against real deltas ────────
// A miniature of the frame body's membership section: the same production
// modules in the same order, minus the overlay pool (its own predicate is
// tested beside `cellRenderOverlay`). The gated and ungated drivers differ
// in exactly one expression — the precondition under test — so the ungated
// one is the oracle for the gated one.

/** Every `slotOf` read and write the slot sync performs. The sync's whole
 * O(list) cost lands here, so zero reads is the honest proof that a delta
 * never reached it. */
class CountingSlotMap extends Map<number, number> {
  reads = 0;
  writes = 0;

  override get(key: number): number | undefined {
    this.reads += 1;
    return super.get(key);
  }

  override set(key: number, value: number): this {
    this.writes += 1;
    return super.set(key, value);
  }
}

interface StageDriver {
  render: ReturnType<typeof createCellRenderSetState>;
  slots: ReturnType<typeof createCellSlotState>;
  lifecycle: ReturnType<typeof createCellLifecycleStampState>;
  probe: CountingSlotMap;
  combined: Cell[];
  syncs: number;
  fieldVersion: number;
}

function makeStageDriver(): StageDriver {
  const slots = createCellSlotState();
  const probe = new CountingSlotMap();
  slots.slotOf = probe;
  return {
    render: createCellRenderSetState(),
    slots,
    lifecycle: createCellLifecycleStampState(),
    probe,
    combined: [],
    syncs: 0,
    fieldVersion: 0,
  };
}

/** One frame. `cache` is null for a frame with no cache movement behind it
 * — the reap case, which has no journal patch at all. */
function stageFrame(
  driver: StageDriver,
  cache: CellGalaxyCache | null,
  nowS: number,
  gated: boolean,
): { ids: number[]; ranges: unknown[]; drawn: Cell[] } {
  const update = cache === null
    ? null
    : syncCellRenderSet(driver.render, cache, 12_000);
  const stagedChanged = cellRenderSetChanged(update);
  const holdsReaped = reapCellExitHolds(driver.lifecycle, nowS);
  let holdsChanged = holdsReaped > 0;
  if (update?.membershipChanged) {
    const stamp = syncCellLifecycleStamps(driver.lifecycle, {
      entered: update.entered,
      exited: update.exited,
      nowS,
      resolve: (id) => {
        const cell = cache === null ? undefined : resolveStagedCell(cache, id);
        if (!cell) return null;
        return { cell, times: cellLifecycleSceneTimes(cell, (ms) => ms / 1000) };
      },
    });
    if (stamp.held > 0 || stamp.cancelled > 0) holdsChanged = true;
  }
  // Ungated: what the frame body did before — any journal patch at all, plus
  // the reap. Stamping is unreachable without a membership diff either way,
  // so the two drivers stamp identically.
  const needsSync = gated
    ? stagedChanged || holdsChanged
    : update !== null || holdsReaped > 0;
  if (needsSync) {
    const staged = driver.render.cells;
    const holdCells = takeCellExitHoldCells(driver.lifecycle, 12_000);
    driver.combined = holdCells.length === 0
      ? staged
      : staged.concat(holdCells);
  }
  let sync = null as ReturnType<typeof syncCellSlots> | null;
  if (needsSync) {
    driver.syncs += 1;
    sync = syncCellSlots(driver.slots, driver.combined);
    if (sync.positionsChanged) driver.fieldVersion += 1;
  }
  const drawn = sync?.cells ?? driver.slots.published;
  return { ids: drawn.map((entry) => entry.id), ranges: sync?.ranges ?? [], drawn };
}

function stagedSnapshot(ids: readonly number[]): CellGalaxySnapshot {
  return {
    cells: ids.map((id) => mkCellAt(id)),
    last_pulse_at_ms: 0,
    display: {
      budget: { cells: 12_000, nerve_edges: 8_000 },
      members: [...ids],
      residents: [],
      provenance: {
        mode: 'canonical',
        source: null,
        as_of: null,
        updated_at_ms: 0,
      },
    },
  };
}

/** Distinct positions per id, so a bounding sphere can tell the drawn set
 * apart from any other. */
function mkCellAt(id: number, overrides: Partial<Cell> = {}): Cell {
  return { ...mkCell(id), pos_seed: [id, id * 0.5, -id], ...overrides };
}

describe('CellGalaxy drawn-list preconditions', () => {
  it('spends nothing on a delta whose display journal touched no one', () => {
    const base = fromCellsSnapshot(1, stagedSnapshot([1, 2, 3]));
    const driver = makeStageDriver();
    expect(stageFrame(driver, base, 0, true).ids).toEqual([1, 2, 3]);
    const published = driver.slots.published;
    const version = driver.fieldVersion;
    driver.probe.reads = 0;
    driver.probe.writes = 0;

    // An off-stage birth and an off-stage tag: the cache advances, the
    // cursor runs, and the stage it describes does not move.
    const offStage = applyRevisionedCellDeltas(base, [
      { revision: 2, delta: { type: 'birth', cell: mkCellAt(99) } },
      { revision: 3, delta: { type: 'tag', id: 99, tag: 'dex' } },
    ]);
    const after = stageFrame(driver, offStage, 0.1, true);

    expect(driver.syncs).toBe(1);
    expect(driver.probe.reads).toBe(0);
    expect(driver.probe.writes).toBe(0);
    expect(driver.fieldVersion).toBe(version);
    // The published identity is what the nucleus index and the pick index
    // both memoize on — it must survive a delta that changed nothing.
    expect(after.drawn).toBe(published);

    // Mutation check: ungated, the same delta pays a full pass to conclude
    // exactly this.
    const ungated = makeStageDriver();
    stageFrame(ungated, base, 0, false);
    ungated.probe.reads = 0;
    stageFrame(ungated, offStage, 0.1, false);
    expect(ungated.syncs).toBe(2);
    expect(ungated.probe.reads).toBe(3);
  });

  it('answers what the ungated path answers, delta for delta', () => {
    const base = fromCellsSnapshot(1, stagedSnapshot([1, 2, 3]));
    const arrival = applyRevisionedCellDeltas(base, [
      { revision: 2, delta: { type: 'birth', cell: mkCellAt(4) } },
      {
        revision: 2,
        delta: {
          type: 'display',
          enter_ids: [4],
          enter_cells: [],
          exit_ids: [],
        },
      },
    ]);
    const payload = applyCellDelta(arrival, { type: 'tag', id: 2, tag: 'dex' });
    const departure = applyCellDelta(payload, {
      type: 'display',
      enter_ids: [],
      enter_cells: [],
      exit_ids: [1],
    });
    const offStage = applyCellDelta(departure, {
      type: 'birth',
      cell: mkCellAt(77),
    });
    // Wall clock: the last frame is past the exit fade, so the hold reaps
    // with no journal patch behind it.
    const script: [CellGalaxyCache | null, number][] = [
      [base, 0],
      [arrival, 0.2],
      [payload, 0.4],
      [departure, 0.6],
      [offStage, 0.8],
      [null, 60],
    ];

    const gated = makeStageDriver();
    const ungated = makeStageDriver();
    for (const [cache, nowS] of script) {
      const left = stageFrame(gated, cache, nowS, true);
      const right = stageFrame(ungated, cache, nowS, false);
      expect(left.ids).toEqual(right.ids);
      expect(left.ranges).toEqual(right.ranges);
    }
    // The churn really did happen: an arrival, a departure that held its
    // slot for the fade, and a reap that finally freed it.
    expect(gated.syncs).toBeGreaterThan(1);
    expect(gated.slots.published.map((entry) => entry.id).sort())
      .toEqual([2, 3, 4]);
    expect(gated.fieldVersion).toBe(ungated.fieldVersion);
    // The nucleus reads this map instead of rebuilding its own — it has to
    // be the drawn list, exactly.
    expect([...gated.slots.slotOf.keys()].sort()).toEqual([2, 3, 4]);
    for (const [id, slot] of gated.slots.slotOf) {
      expect(gated.slots.published[slot].id).toBe(id);
    }
  });

  it('stamps the stage lifecycle on the delta that carried it', () => {
    const base = fromCellsSnapshot(1, stagedSnapshot([1, 2, 3]));
    const driver = makeStageDriver();
    stageFrame(driver, base, 0, true);

    const departure = applyCellDelta(base, {
      type: 'display',
      enter_ids: [],
      enter_cells: [],
      exit_ids: [2],
    });
    const after = stageFrame(driver, departure, 0.2, true);

    // The departure is stamped and still drawn: the slot belongs to the fade
    // until the fade ends.
    expect(driver.lifecycle.exitAt.get(2)).toBe(0.2);
    expect(after.ids).toContain(2);
    expect(driver.slots.slotOf.has(2)).toBe(true);
  });

  it('syncs a reap frame that carries no journal patch at all', () => {
    const base = fromCellsSnapshot(1, stagedSnapshot([1, 2, 3]));
    const driver = makeStageDriver();
    stageFrame(driver, base, 0, true);
    stageFrame(driver, applyCellDelta(base, {
      type: 'display',
      enter_ids: [],
      enter_cells: [],
      exit_ids: [2],
    }), 0.2, true);
    const syncs = driver.syncs;

    // No cache movement, only the clock: the fade ends and the cell has to
    // leave the stage.
    const reaped = stageFrame(driver, null, 60, true);

    expect(driver.syncs).toBe(syncs + 1);
    expect(reaped.ids).not.toContain(2);
    expect(driver.slots.slotOf.has(2)).toBe(false);

    // And a frame after that, with the queue empty, costs nothing again.
    const resting = driver.slots.published;
    driver.probe.reads = 0;
    expect(stageFrame(driver, null, 61, true).drawn).toBe(resting);
    expect(driver.probe.reads).toBe(0);
    expect(driver.syncs).toBe(syncs + 1);
  });
});

describe('writeCellExitStampSlots', () => {
  it('writes only changed stamps and coalesces their upload ranges', () => {
    // Packed stage clock: 2 components per slot, exit in `.y`. The enter
    // halves stay untouched — this path only moves departures.
    const stageAtArr = new Float32Array(12);
    for (let i = 0; i < 12; i += 2) {
      stageAtArr[i] = ENTER_STAMP_SENTINEL;
      stageAtArr[i + 1] = EXIT_STAMP_SENTINEL;
    }
    const slotOf = new Map([[10, 1], [11, 2], [12, 4], [13, 5]]);
    const exitAt = new Map([[10, 7.5], [11, 7.5]]);

    const ranges = writeCellExitStampSlots(
      [10, 11, 12],
      slotOf,
      6,
      exitAt,
      stageAtArr,
    );

    // Ranges stay in slot units; the upload marker scales them by itemSize.
    expect(ranges).toEqual([
      { start: 1, count: 2 },
      { start: 4, count: 1 },
    ]);
    expect([...stageAtArr]).toEqual([
      ENTER_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      ENTER_STAMP_SENTINEL,
      7.5,
      ENTER_STAMP_SENTINEL,
      7.5,
      ENTER_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      // A cancelled departure returns to the sentinel, which is the whole
      // reason this path exists: its slot occupant never changed.
      ENTER_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      ENTER_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
    ]);
  });

  it('skips ids with no slot and slots past the draw range', () => {
    const stageAtArr = new Float32Array(6).fill(EXIT_STAMP_SENTINEL);
    const ranges = writeCellExitStampSlots(
      [10, 11],
      new Map([[10, 5]]),
      3,
      new Map([[10, 1], [11, 2]]),
      stageAtArr,
    );
    expect(ranges).toEqual([]);
    expect([...stageAtArr]).toEqual([
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
    ]);
  });
});

describe('cell pick index rotation tolerance', () => {
  it('scales drift with axis distance and inverse view depth', () => {
    // A rim cell at 60u from the spin axis, projScaleY 2.4, half-height
    // 540px, 150u deep: ~518 px of screen motion per radian of spin.
    const rim = cellPickDriftPxPerRadian(60, 2.4, 540, 150);
    expect(rim).toBeCloseTo((60 * 2.4 * 540) / 150, 6);
    // The same cell twice as deep moves half as fast on screen.
    expect(cellPickDriftPxPerRadian(60, 2.4, 540, 300)).toBeCloseTo(rim / 2, 6);
    // On-axis cells do not move under spin; behind-camera depth is inert.
    expect(cellPickDriftPxPerRadian(0, 2.4, 540, 150)).toBe(0);
    expect(cellPickDriftPxPerRadian(60, 2.4, 540, 0)).toBe(0);
  });

  it('tolerates ~2s of default spin before the worst rim cell rebuilds', () => {
    const rim = cellPickDriftPxPerRadian(60, 2.4, 540, 150);
    const toleratedRadians = CELL_PICK_ROTATION_DRIFT_BUDGET_PX / rim;
    // Default LIVE.galaxy.rotationRate is 0.00125 rad/s — the budget must
    // buy enough angle that hover motion stops rebuilding per event.
    expect(toleratedRadians / 0.00125).toBeGreaterThan(0.5);
    // …while staying sub-visual: the budget itself is under 2px.
    expect(CELL_PICK_ROTATION_DRIFT_BUDGET_PX).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Pointer picking — the gate that decides WHEN the screen index is rebuilt,
// against an oracle for WHAT it must answer. jsdom cannot raycast an r3f
// Canvas, so the raycast is built straight from its factory and driven with a
// real THREE.Raycaster.
// ---------------------------------------------------------------------------

const PICK_WIDTH = 960;
const PICK_HEIGHT = 640;

function pickField(count = 260): Cell[] {
  // A spiral shell, deliberately crowded: overlapping discs are what make the
  // find()'s distance/depth tie-break — and therefore the oracle — load
  // bearing. Tagged cells and a capacity spread vary point size and presence.
  return Array.from({ length: count }, (_, i) => {
    const angle = i * 2.399963;
    const radius = 4 + 2.4 * Math.sqrt(i);
    const cell = mkCell(i + 1);
    cell.pos_seed = [
      Math.cos(angle) * radius,
      Math.sin(i * 0.7) * 14,
      Math.sin(angle) * radius,
    ];
    cell.capacity = 61 + (i % 23) * 1400;
    cell.tag = i % 7 === 0 ? 'tagged' : null;
    return cell;
  });
}

interface PickHarness {
  cells: Cell[];
  cellsListRef: { current: Cell[] };
  sizes: Float32Array;
  presence: Float64Array;
  details: Float32Array;
  object: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  selectedCellIdRef: { current: number | null };
  hoveredCellIdRef: { current: number | null };
  forcePreciseRef: { current: boolean };
  fieldVersionRef: { current: number };
  sizeEpochRef: { current: number };
  pickingSuspendedRef: { current: boolean };
  pointerEventRef: { current: { type: string } | null };
  raycast: (
    this: THREE.Object3D,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ) => void;
}

/** The per-slot lanes exactly as `writeCellBuffers` fills them. */
function fillPickLanes(
  cells: readonly Cell[],
  sizes: Float32Array,
  presence: Float64Array,
): void {
  for (let i = 0; i < cells.length; i += 1) {
    sizes[i] = cellPointSize(cells[i]);
    presence[i] = consensusBraidPresenceScale(capacityMass(cells[i].capacity));
  }
}

function pickHarness(count = 260): PickHarness {
  const cells = pickField(count);
  const sizes = new Float32Array(cells.length);
  const presence = new Float64Array(cells.length);
  const details = new Float32Array(cells.length);
  fillPickLanes(cells, sizes, presence);
  // A handful of near cells sit past the expanded-detail line, so the padded
  // branch of `cellPickRadiusPx` is exercised and not merely declared.
  for (const i of [3, 17, 88, 201]) details[i] = 0.5;

  const object = new THREE.Object3D();
  object.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(
    50, PICK_WIDTH / PICK_HEIGHT, 0.1, 2000,
  );
  camera.position.set(0, 18, 132);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const cellsListRef = { current: cells };
  const selectedCellIdRef = { current: null as number | null };
  const hoveredCellIdRef = { current: null as number | null };
  const forcePreciseRef = { current: false };
  const fieldVersionRef = { current: 0 };
  const sizeEpochRef = { current: 0 };
  const pickingSuspendedRef = { current: false };
  // What R3F's `lastEvent` holds while it raycasts: a hover probe unless a
  // test says otherwise.
  const pointerEventRef = { current: { type: 'pointermove' } as { type: string } | null };
  const raycast = createCellPickRaycast({
    cellsListRef,
    drawCountRef: { current: cells.length },
    fieldVersionRef,
    sizeEpochRef,
    pickPresenceArr: presence,
    detailAttr: new THREE.BufferAttribute(details, 1),
    detailPickEpoch: { threshold: 0.02, epoch: 0 },
    sizeAttr: new THREE.BufferAttribute(sizes, 1),
    selectedCellIdRef,
    hoveredCellIdRef,
    pickingSuspendedRef,
    pointerEventRef,
    forcePreciseRef,
    viewportRef: { current: { width: PICK_WIDTH, height: PICK_HEIGHT } },
  });
  return {
    cells, cellsListRef, sizes, presence, details, object, camera,
    selectedCellIdRef, hoveredCellIdRef, forcePreciseRef,
    fieldVersionRef, sizeEpochRef, pickingSuspendedRef, pointerEventRef,
    raycast,
  };
}

/** The picker's rebuild exactly as it stood before the focus pad and the
 *  camera budget: the whole field re-projected on the spot, every disc baked
 *  at its live focus. Kept here as the ORACLE — a pick answer is contract,
 *  and this is what that contract has always been. */
function referencePick(
  h: PickHarness,
  camera: THREE.PerspectiveCamera,
  px: number,
  py: number,
): number | null {
  const index = new ScreenSpaceHitIndex(h.cells.length);
  index.begin(PICK_WIDTH, PICK_HEIGHT);
  const halfW = PICK_WIDTH * 0.5;
  const halfH = PICK_HEIGHT * 0.5;
  const modelView = new THREE.Matrix4()
    .multiplyMatrices(camera.matrixWorldInverse, h.object.matrixWorld);
  const projectionScaleY = camera.projectionMatrix.elements[5];
  const view = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  for (let i = 0; i < h.cells.length; i += 1) {
    const c = h.cells[i];
    view.set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2])
      .applyMatrix4(modelView);
    const viewZ = -view.z;
    if (viewZ <= 0) continue;
    const depthToPx = halfH / viewZ;
    const braidScale = consensusBraidRenderScale(
      viewZ,
      PICK_HEIGHT,
      projectionScaleY,
      cellFocusTarget(
        c.id,
        h.selectedCellIdRef.current,
        h.hoveredCellIdRef.current,
      ),
      consensusBraidPresenceScale(capacityMass(c.capacity)),
    );
    const pickPxR = cellPickRadiusPx(
      cellPointSize(c) * depthToPx,
      CONSENSUS_BRAID_LOCAL_RADIUS * braidScale * projectionScaleY * depthToPx,
      h.details[i] ?? 0,
    );
    ndc.copy(view).applyMatrix4(camera.projectionMatrix);
    if (ndc.z < -1 || ndc.z > 1) continue;
    index.insert(
      i, (ndc.x + 1) * halfW, (1 - ndc.y) * halfH, pickPxR, ndc.z,
    );
  }
  return index.find(px, py)?.index ?? null;
}

/** One pointer position through the real raycast, as `e.instanceId`. */
function livePick(h: PickHarness, px: number, py: number): number | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      (px / PICK_WIDTH) * 2 - 1,
      -((py / PICK_HEIGHT) * 2 - 1),
    ),
    h.camera,
  );
  const intersects: THREE.Intersection[] = [];
  h.raycast.call(h.object, raycaster, intersects);
  return intersects.length === 0
    ? null
    : (intersects[0].instanceId ?? null);
}

/** Every pointer position on a coarse raster. Live and oracle sweeps stay
 *  apart so a rebuild count can be taken around the live one alone. */
function sweep(
  answer: (px: number, py: number) => number | null,
): Array<number | null> {
  const answers: Array<number | null> = [];
  for (let py = 6; py < PICK_HEIGHT; py += 11) {
    for (let px = 6; px < PICK_WIDTH; px += 11) answers.push(answer(px, py));
  }
  return answers;
}

const liveSweep = (h: PickHarness) => sweep((px, py) => livePick(h, px, py));

/** `camera` is the pose the oracle projects through — the INDEXED one when
 *  the live camera has since drifted inside its budget. */
const oracleSweep = (h: PickHarness, camera = h.camera) =>
  sweep((px, py) => referencePick(h, camera, px, py));

function countRebuilds(run: () => void): number {
  const spy = vi.spyOn(ScreenSpaceHitIndex.prototype, 'begin');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe('cell pick focus pad', () => {
  it('never grows a disc past the ceiling the index admits entries for', () => {
    // The admit pad is what keeps a padded disc reachable, so it has to be an
    // upper bound on the pad itself. Sweep the inputs focus actually travels
    // through: depth, viewport, projection, capacity presence, both sides of
    // the expanded-detail line.
    let worst = 0;
    for (const viewZ of [1.5, 6, 22, 74, 190, 640]) {
      for (const projectionScaleY of [0.9, 2.144, 4.1]) {
        for (const height of [360, 640, 1440]) {
          for (const capacity of [61, 900, 12_000, 900_000]) {
            for (const detail of [0, 0.5]) {
              for (const size of [0.78, 1.4, 3.6]) {
                const base = cellPickDiscRadiusPx(
                  size, capacity, detail, 0,
                  viewZ, height, height * 0.5, projectionScaleY,
                );
                for (const focus of [CELL_HOVER_FOCUS, CELL_SELECTED_FOCUS]) {
                  const padded = cellPickDiscRadiusPx(
                    size, capacity, detail, focus,
                    viewZ, height, height * 0.5, projectionScaleY,
                  );
                  // A pad may only ever grow a disc: the index keeps the
                  // bucket the centre put it in, and `find` widens its probe
                  // by the pad, so a shrinking one would answer wrong.
                  expect(padded).toBeGreaterThanOrEqual(base);
                  worst = Math.max(worst, padded - base);
                }
              }
            }
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(CELL_PICK_FOCUS_PAD_CEILING_PX);
    // …and the ceiling is not idly generous: it is worth padding for.
    expect(worst).toBeGreaterThan(CELL_PICK_FOCUS_PAD_CEILING_PX * 0.5);
  });

  it('answers a hover flip without re-projecting the field', () => {
    const h = pickHarness();
    // First pointer event builds the index. Everything after is the finding:
    // a sweep across the dense core flips the hovered id twice per cell it
    // crosses, and each flip used to re-project all of them.
    expect(countRebuilds(() => livePick(h, 480, 320))).toBe(1);
    const flips = countRebuilds(() => {
      for (const id of [12, 13, null, 41, 42, 41, null, 7]) {
        h.hoveredCellIdRef.current = id;
        livePick(h, 480, 320);
      }
    });
    expect(flips).toBe(0);

    // Selection arrives from outside the picker (a HUD link, a route flight),
    // and is just as free.
    expect(countRebuilds(() => {
      h.selectedCellIdRef.current = 41;
      livePick(h, 480, 320);
      h.selectedCellIdRef.current = 200;
      livePick(h, 480, 320);
    })).toBe(0);
  });

  it('pads the focused discs to exactly what a focused rebuild bakes', () => {
    const h = pickHarness();
    livePick(h, 480, 320);

    for (const [selected, hovered] of [
      [null, null], [41, null], [null, 41], [41, 42], [41, 41], [4, 202],
    ] as Array<[number | null, number | null]>) {
      h.selectedCellIdRef.current = selected;
      h.hoveredCellIdRef.current = hovered;
      let live: Array<number | null> = [];
      expect(countRebuilds(() => { live = liveSweep(h); })).toBe(0);
      expect(live).toEqual(oracleSweep(h));
      // The sweep has to actually reach the focused cells, or the
      // equivalence above is a statement about empty space.
      if (selected !== null) expect(live).toContain(selected - 1);
    }
  });
});

describe('cell pick camera budget', () => {
  it('bounds the screen motion the camera can hide, and says so in px', () => {
    // The derivation, checked against the thing it claims to bound: move a
    // real camera, project a real field through both poses, and measure.
    const h = pickHarness();
    const projectionScaleY = h.camera.projectionMatrix.elements[5];
    const halfW = PICK_WIDTH * 0.5;
    const halfH = PICK_HEIGHT * 0.5;

    const project = (camera: THREE.PerspectiveCamera) => {
      const modelView = new THREE.Matrix4()
        .multiplyMatrices(camera.matrixWorldInverse, h.object.matrixWorld);
      const out: Array<[number, number] | null> = [];
      let minViewZ = Infinity;
      const v = new THREE.Vector3();
      for (const c of h.cells) {
        v.set(c.pos_seed[0], c.pos_seed[1], c.pos_seed[2])
          .applyMatrix4(modelView);
        const viewZ = -v.z;
        if (viewZ <= 0) { out.push(null); continue; }
        minViewZ = Math.min(minViewZ, viewZ);
        v.applyMatrix4(camera.projectionMatrix);
        out.push([(v.x + 1) * halfW, (1 - v.y) * halfH]);
      }
      return { out, minViewZ };
    };

    const from = project(h.camera);
    for (const [pitch, yaw, roll, dx, dy, dz] of [
      [0.002, 0, 0, 0, 0, 0],
      [0, 0.004, 0, 0, 0, 0],
      [0, 0, 0.01, 0, 0, 0],
      [0, 0, 0, 0.05, 0, 0],
      [0, 0, 0, 0, 0, -0.4],
      [0.0015, 0.0009, 0.003, 0.02, 0.03, 0.05],
      [0.02, 0.03, 0.01, 0.9, 0.4, 1.7],
    ]) {
      const moved = h.camera.clone();
      moved.rotateX(pitch);
      moved.rotateY(yaw);
      moved.rotateZ(roll);
      moved.position.add(new THREE.Vector3(dx, dy, dz));
      moved.updateMatrixWorld(true);

      const to = project(moved);
      let measured = 0;
      for (let i = 0; i < h.cells.length; i += 1) {
        const a = from.out[i];
        const b = to.out[i];
        if (!a || !b) continue;
        measured = Math.max(measured, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }

      const fromQ = new THREE.Quaternion();
      const toQ = new THREE.Quaternion();
      const scratch = new THREE.Vector3();
      h.camera.matrixWorld.decompose(new THREE.Vector3(), fromQ, scratch);
      moved.matrixWorld.decompose(new THREE.Vector3(), toQ, scratch);
      const bound = cellPickCameraDriftPx(
        fromQ.angleTo(toQ),
        h.camera.position.distanceTo(moved.position),
        projectionScaleY,
        halfW,
        halfH,
        from.minViewZ,
      );
      expect(measured).toBeGreaterThan(0);
      expect(bound).toBeGreaterThanOrEqual(measured);
    }
  });

  it('is unbounded where it cannot be honest', () => {
    // Travel that reaches the nearest indexed cell rescales the screen without
    // limit, and an index that measured no depth at all has no near cell to
    // reason from. Both must rebuild rather than guess.
    expect(cellPickCameraDriftPx(0, 4, 2.144, 480, 320, 4)).toBe(Infinity);
    expect(cellPickCameraDriftPx(0, 0.001, 2.144, 480, 320, 0)).toBe(Infinity);
    expect(cellPickCameraDriftPx(0, 0, 2.144, 480, 320, 0)).toBe(0);
    expect(cellPickCameraDriftPx(0, 1, 0, 480, 320, 90)).toBe(Infinity);
    // Rotation alone needs nothing from the scene: no indexed depth, still a
    // finite bound, because the projection's own stretch is the whole term.
    expect(cellPickCameraDriftPx(0.01, 0, 2.144, 480, 320, 0))
      .toBeCloseTo(0.01 * (686.08 + (480 * 480 + 320 * 320) / 686.08), 6);
  });

  it('rides a sub-budget camera move on the index it already has', () => {
    const h = pickHarness();
    expect(countRebuilds(() => livePick(h, 480, 320))).toBe(1);
    const indexed = h.camera.clone();

    // A damping tail's late frames and a route flight's last approach: motion
    // far under one pixel of screen displacement, arriving on every
    // pointermove. Exact matrix equality rebuilt the whole field for each.
    const tail = countRebuilds(() => {
      for (let step = 0; step < 24; step += 1) {
        h.camera.rotateY(2e-6);
        h.camera.position.z -= 4e-4;
        h.camera.updateMatrixWorld(true);
        livePick(h, 480 + step, 320);
      }
    });
    expect(tail).toBe(0);

    // And what it answers is the snapshot it was built from, exactly.
    const live = liveSweep(h);
    expect(live).toEqual(oracleSweep(h, indexed));
    expect(live.some((hit) => hit !== null)).toBe(true);
  });

  it('rebuilds once the move could have cost more than the budget', () => {
    const h = pickHarness();
    livePick(h, 480, 320);

    // One orbit step of any real size clears 1.5px many times over.
    expect(countRebuilds(() => {
      h.camera.rotateY(0.02);
      h.camera.updateMatrixWorld(true);
      livePick(h, 480, 320);
    })).toBe(1);

    // A pure dolly with no rotation at all is caught by the translation term.
    expect(countRebuilds(() => {
      h.camera.position.z -= 3;
      h.camera.updateMatrixWorld(true);
      livePick(h, 480, 320);
    })).toBe(1);

    // …and the fresh index answers the new camera, not the old one.
    expect(liveSweep(h)).toEqual(oracleSweep(h));
  });

  it('gives the click its precise snapshot however cheap the reuse got', () => {
    const h = pickHarness();
    livePick(h, 480, 320);
    // Nothing changed — the pointermove path reuses.
    expect(countRebuilds(() => livePick(h, 481, 320))).toBe(0);
    // The pointerdown listener sets this flag; it must survive every budget
    // above it and be spent exactly once.
    h.forcePreciseRef.current = true;
    expect(countRebuilds(() => livePick(h, 481, 320))).toBe(1);
    expect(countRebuilds(() => livePick(h, 481, 320))).toBe(0);
  });

  it('rides the damping tail and a flight on the index it has, once they settle', () => {
    // OrbitControls' damping law exactly (dampingFactor 0.08, change while
    // the frame moved the camera past EPS), with the pointer moving twice a
    // frame, then the route camera's exponential lerp. Suspension is what
    // App's sentinel publishes: the frame's `change` verdict.
    const h = pickHarness();
    livePick(h, 480, 320);
    const target = new THREE.Vector3(0, 0, 0);
    const spherical = new THREE.Spherical()
      .setFromVector3(h.camera.position.clone().sub(target));
    let delta = 0.5;
    let px = 300;
    const lastPosition = h.camera.position.clone();
    const lastQuaternion = h.camera.quaternion.clone();
    let changeFrames = 0;
    let settledProbeRebuilds = -1;
    const tail = countRebuilds(() => {
      for (let frame = 0; frame < 240; frame += 1) {
        spherical.theta += delta * 0.08;
        delta *= 0.92;
        h.camera.position.setFromSpherical(spherical).add(target);
        h.camera.lookAt(target);
        h.camera.updateMatrixWorld(true);
        const changed = lastPosition.distanceToSquared(h.camera.position) > 1e-6
          || 8 * (1 - lastQuaternion.dot(h.camera.quaternion)) > 1e-6;
        if (changed) {
          changeFrames = frame + 1;
          lastPosition.copy(h.camera.position);
          lastQuaternion.copy(h.camera.quaternion);
        }
        h.pickingSuspendedRef.current = changed;
        livePick(h, (px += 3) % PICK_WIDTH, 320);
        livePick(h, (px += 3) % PICK_WIDTH, 323);
      }
    });
    // The tail is real (over a second of change frames), the picker spent
    // one rebuild on it — the settle — and nothing on the sub-EPS creep that
    // follows a settle, which the envelope measures as under budget.
    expect(changeFrames).toBeGreaterThan(60);
    expect(tail).toBe(1);
    settledProbeRebuilds = countRebuilds(() => {
      for (let i = 0; i < 20; i += 1) livePick(h, (px += 3) % PICK_WIDTH, 320);
    });
    expect(settledProbeRebuilds).toBe(0);
    // And what it answers after settling is the settled camera, exactly.
    expect(liveSweep(h)).toEqual(oracleSweep(h));

    // A flight: the automation flag holds the suspension for its whole
    // duration; the one rebuild is the first probe after it lands.
    const goal = h.camera.position.clone().add(new THREE.Vector3(-30, -12, -20));
    let frames = 0;
    const flight = countRebuilds(() => {
      h.pickingSuspendedRef.current = true;
      for (frames = 0; frames < 400; frames += 1) {
        h.camera.position.lerp(goal, 1 - Math.exp(-6.5 / 60));
        h.camera.lookAt(target);
        h.camera.updateMatrixWorld(true);
        livePick(h, (px += 3) % PICK_WIDTH, 320);
        livePick(h, (px += 3) % PICK_WIDTH, 323);
        if (h.camera.position.distanceToSquared(goal) <= 0.0025) break;
      }
      h.pickingSuspendedRef.current = false;
      livePick(h, (px += 3) % PICK_WIDTH, 320);
    });
    expect(frames).toBeGreaterThan(30);
    expect(flight).toBe(1);
    expect(liveSweep(h)).toEqual(oracleSweep(h));
  });
});

describe('cell pick suspension', () => {
  it('answers presses and clicks while suspended, and hover probes only when not', () => {
    const h = pickHarness();
    expect(isCellPickPointerAction(null)).toBe(false);
    expect(isCellPickPointerAction({ type: 'pointermove' })).toBe(false);
    expect(isCellPickPointerAction({ type: 'pointerup' })).toBe(false);
    expect(isCellPickPointerAction({ type: 'wheel' })).toBe(false);
    for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu']) {
      expect(isCellPickPointerAction({ type })).toBe(true);
    }

    // A pointer position that hits at rest.
    const hits = sweep((px, py) => livePick(h, px, py));
    const at = hits.findIndex((hit) => hit !== null);
    expect(at).toBeGreaterThanOrEqual(0);
    const px = 6 + (at % Math.ceil((PICK_WIDTH - 6) / 11)) * 11;
    const py = 6 + Math.floor(at / Math.ceil((PICK_WIDTH - 6) / 11)) * 11;
    const expected = livePick(h, px, py);
    expect(expected).not.toBeNull();

    h.pickingSuspendedRef.current = true;
    // Hover probes: nothing, and no rebuild spent on them.
    expect(countRebuilds(() => {
      expect(livePick(h, px, py)).toBeNull();
      h.pointerEventRef.current = null;
      expect(livePick(h, px, py)).toBeNull();
      h.pointerEventRef.current = { type: 'pointerup' };
      expect(livePick(h, px, py)).toBeNull();
    })).toBe(0);
    // The press and the click that R3F's click contract runs through, and
    // the two other click-class events it reports misses for: all answered,
    // and the press from its precise snapshot.
    for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu']) {
      h.pointerEventRef.current = { type };
      expect(livePick(h, px, py)).toBe(expected);
    }
    h.forcePreciseRef.current = true;
    h.pointerEventRef.current = { type: 'pointerdown' };
    expect(countRebuilds(() => livePick(h, px, py))).toBe(1);
    // Lifted: hover answers again.
    h.pickingSuspendedRef.current = false;
    h.pointerEventRef.current = { type: 'pointermove' };
    expect(livePick(h, px, py)).toBe(expected);
  });

  it('treats a raycast with no event source as a hover probe', () => {
    // Harnesses without an event ref (and R3F before its first event) get
    // the conservative answer: suspended means skipped.
    const h = pickHarness();
    const cells = h.cells;
    const raycast = createCellPickRaycast({
      cellsListRef: { current: cells },
      drawCountRef: { current: cells.length },
      fieldVersionRef: h.fieldVersionRef,
      sizeEpochRef: h.sizeEpochRef,
      pickPresenceArr: h.presence,
      detailAttr: new THREE.BufferAttribute(h.details, 1),
      detailPickEpoch: { threshold: 0.02, epoch: 0 },
      sizeAttr: new THREE.BufferAttribute(h.sizes, 1),
      selectedCellIdRef: h.selectedCellIdRef,
      hoveredCellIdRef: h.hoveredCellIdRef,
      pickingSuspendedRef: { current: true },
      forcePreciseRef: h.forcePreciseRef,
      viewportRef: { current: { width: PICK_WIDTH, height: PICK_HEIGHT } },
    });
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), h.camera);
    const intersects: THREE.Intersection[] = [];
    expect(countRebuilds(() => raycast.call(h.object, raycaster, intersects)))
      .toBe(0);
    expect(intersects).toEqual([]);
  });
});

describe('cell pick index keys', () => {
  /** A payload delta as the slot sync republishes one: every cell a fresh
   *  object, every slot where it was. */
  const republish = (h: PickHarness, patch: (cell: Cell, i: number) => Cell) => {
    const next = h.cells.map((cell, i) => patch({ ...cell }, i));
    h.cellsListRef.current = next;
    // The writer's lanes, as `writeCellBuffers` would leave them.
    fillPickLanes(next, h.sizes, h.presence);
    return next;
  };

  it('re-projects nothing for a payload-only delta, and answers the new list', () => {
    const h = pickHarness();
    livePick(h, 480, 320);
    const before = liveSweep(h);

    // Enrichment refreshes and deaths change the records, not the field.
    let next: Cell[] = [];
    expect(countRebuilds(() => {
      next = republish(h, (cell, i) => ({
        ...cell,
        data_hex: '0xabcd',
        death_at_ms: i % 5 === 0 ? 1_000 : null,
      }));
      for (let k = 0; k < 8; k += 1) livePick(h, 480 + k, 320);
    })).toBe(0);
    expect(h.cellsListRef.current).toBe(next);
    expect(h.cellsListRef.current).not.toBe(h.cells);
    // Same picks, resolved against the republished list.
    const after = liveSweep(h);
    expect(after).toEqual(before);
    expect(after).toEqual(oracleSweep(h));
  });

  it('rebuilds on a size change, on a presence change, and on a move', () => {
    const h = pickHarness();
    livePick(h, 480, 320);

    // A tag arriving through enrichment changes the point size of its cell:
    // the writer reports it, the epoch moves, the index follows — and the
    // answer is what a fresh projection gives.
    expect(countRebuilds(() => {
      republish(h, (cell, i) => (i === 41 ? { ...cell, tag: 'tagged' } : cell));
      h.sizeEpochRef.current += 1;
      livePick(h, 480, 320);
      livePick(h, 481, 320);
    })).toBe(1);
    expect(liveSweep(h)).toEqual(oracleSweep(h));

    // Capacity feeds the braid presence, the disc's other baked term.
    expect(countRebuilds(() => {
      republish(h, (cell, i) => (i === 7 ? { ...cell, capacity: 5e12 } : cell));
      h.sizeEpochRef.current += 1;
      livePick(h, 480, 320);
    })).toBe(1);
    expect(liveSweep(h)).toEqual(oracleSweep(h));

    // A relocation is a field version, whatever else the record carries.
    expect(countRebuilds(() => {
      republish(h, (cell, i) => (
        i === 12 ? { ...cell, pos_seed: [cell.pos_seed[0] + 3, cell.pos_seed[1], cell.pos_seed[2]] } : cell
      ));
      h.fieldVersionRef.current += 1;
      livePick(h, 480, 320);
      livePick(h, 482, 320);
    })).toBe(1);
    expect(liveSweep(h)).toEqual(oracleSweep(h));
  });
});

describe('cell pick rebuild allocation', () => {
  it('rebuilds a large field without allocating', () => {
    // The loop passes no double through a call boundary and reads only typed
    // lanes, so the engine has nothing to box. Measured on V8's new space
    // after the function has tiered up: the first rebuilds run through the
    // interpreter and baseline tiers, which box everything, so the warm-up
    // is long on purpose. A scavenge inside a measured round (the space
    // reads lower afterwards than before) voids that round.
    const h = pickHarness(6000);
    for (let i = 0; i < 300; i += 1) {
      h.forcePreciseRef.current = true;
      livePick(h, 300 + (i % 400), 200 + (i % 200));
      livePick(h, 500 + (i % 300), 300);
    }
    const newSpaceUsed = () => (
      getHeapSpaceStatistics().find((space) => space.space_name === 'new_space')
        ?.space_used_size ?? Number.NaN
    );
    const REBUILDS = 20;
    let measured = false;
    let growthPerRebuild = Number.NaN;
    for (let round = 0; round < 6 && !measured; round += 1) {
      const before = newSpaceUsed();
      for (let i = 0; i < REBUILDS; i += 1) {
        h.forcePreciseRef.current = true;
        livePick(h, 300 + i * 7, 200 + i * 3);
      }
      const after = newSpaceUsed();
      if (!(after >= before)) continue;
      growthPerRebuild = (after - before) / REBUILDS;
      measured = true;
    }
    expect(measured).toBe(true);
    // 6,000 cells: one boxed double per cell would already be ~70 KB per
    // rebuild; the whole budget here is the pick's own hit object.
    expect(growthPerRebuild).toBeLessThan(8 * 1024);
  });
});

// ── the upload plan behind the eight cell attributes ──────────────────
// Six static attributes share one dirty set: every planned range is six
// bufferSubData calls, and a slot costs their summed 56 B. The plan bridges
// parked gaps only where that is cheaper than the calls it saves, and can at
// worst reach the dirty set's hull — the whole-prefix fallback past eight runs
// is gone. What the GPU holds after the upload must equal the CPU arrays
// exactly, which is the same guarantee a whole-prefix write gave.
describe('planCellBufferUploadRanges', () => {
  /** Six static lanes: pos 3, colour 3, recordAt 2, size 1, identity 4, seed 1. */
  const STATIC = slotUploadPolicy((3 + 3 + 2 + 1 + 4 + 1) * 4, 6);
  const STAGE_AT = slotUploadPolicy(2 * 4, 1);

  function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }
  function runsOf(slots: Iterable<number>): { start: number; count: number }[] {
    const sorted = [...new Set(slots)].sort((a, b) => a - b);
    const runs: { start: number; count: number }[] = [];
    if (sorted.length === 0) return runs;
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
      runs.push({ start, count: prev - start + 1 });
      start = sorted[i];
      prev = sorted[i];
    }
    runs.push({ start, count: prev - start + 1 });
    return runs;
  }
  function covered(plan: readonly { start: number; count: number }[], slot: number): boolean {
    return plan.some((r) => slot >= r.start && slot < r.start + r.count);
  }

  it('derives the family policy from the attributes: 4 KB a call, six calls a range', () => {
    expect(STATIC).toEqual({
      bytesPerSlot: 56, callsPerRange: 6, gapMaxSlots: 438, maxRanges: 85,
    });
    expect(STAGE_AT.gapMaxSlots).toBe(512);
  });

  it('clamps to the drawn prefix and returns nothing for nothing', () => {
    expect(planCellBufferUploadRanges([], 100, STATIC)).toEqual([]);
    expect(planCellBufferUploadRanges([{ start: 0, count: 4 }], 0, STATIC)).toEqual([]);
    expect(planCellBufferUploadRanges(
      [{ start: -2, count: 4 }, { start: 98, count: 10 }],
      100,
      STATIC,
    )).toEqual([{ start: 0, count: 100 }]);
  });

  it('a fragmented block no longer becomes the whole prefix — the hull is the ceiling', () => {
    // Forty single-slot runs, all inside [6000, 6500) of a 12,000-cell
    // prefix: the old eight-run cap uploaded 12,000 × 56 B for this.
    const random = seeded(7);
    const slots = new Set<number>();
    while (slots.size < 40) slots.add(6000 + Math.floor(random() * 500));
    const plan = planCellBufferUploadRanges(runsOf(slots), 12_000, STATIC);
    const cost = slotRangesUploadCost(plan, STATIC);
    expect(cost.slots).toBeLessThanOrEqual(500);
    expect(cost.slots).toBeLessThan(12_000 * 0.05);
    expect(plan[0].start).toBeGreaterThanOrEqual(6000);
    const last = plan[plan.length - 1];
    expect(last.start + last.count).toBeLessThanOrEqual(6500);
    for (const slot of slots) expect(covered(plan, slot)).toBe(true);
  });

  it('keeps a tail run and a few scattered replacements as separate, exact ranges', () => {
    // Tail adds are one run; two replacements far from it and from each
    // other stay their own calls — bridging 2,000 parked slots would cost
    // more than the six calls it saves.
    const ranges = [
      { start: 3_000, count: 1 },
      { start: 7_000, count: 1 },
      { start: 11_950, count: 50 },
    ];
    expect(planCellBufferUploadRanges(ranges, 12_000, STATIC)).toEqual(ranges);
    // Two replacements 200 slots apart DO bridge: 200 × 56 B = 11 KB for six
    // calls saved, under the 4 KB-a-call model's 438-slot allowance.
    expect(planCellBufferUploadRanges(
      [{ start: 3_000, count: 1 }, { start: 3_200, count: 1 }],
      12_000,
      STATIC,
    )).toEqual([{ start: 3_000, count: 201 }]);
  });

  it('what the GPU holds after the planned upload equals the CPU array, frame after frame', () => {
    // A CPU-side attribute (3 floats a slot) and a GPU mirror. Each frame
    // rewrites random slots on the CPU, plans the upload for the dirty runs,
    // and copies only the planned ranges into the mirror — a whole-prefix
    // write is the oracle, and the mirror must match it exactly.
    const count = 2_000;
    const itemSize = 3;
    const cpu = new Float32Array(count * itemSize);
    const gpu = new Float32Array(count * itemSize);
    const random = seeded(11);
    for (let i = 0; i < cpu.length; i += 1) cpu[i] = random();
    gpu.set(cpu);
    for (let frame = 0; frame < 40; frame += 1) {
      const dirty = new Set<number>();
      const scattered = 1 + Math.floor(random() * 60);
      for (let i = 0; i < scattered; i += 1) dirty.add(Math.floor(random() * count));
      const tail = Math.floor(random() * 30);
      for (let i = 0; i < tail; i += 1) dirty.add(count - 1 - i);
      for (const slot of dirty) {
        for (let k = 0; k < itemSize; k += 1) cpu[slot * itemSize + k] = random();
      }
      const plan = planCellBufferUploadRanges(runsOf(dirty), count, STATIC);
      for (let i = 1; i < plan.length; i += 1) {
        expect(plan[i].start).toBeGreaterThan(plan[i - 1].start + plan[i - 1].count - 1);
      }
      for (const range of plan) {
        gpu.set(
          cpu.subarray(range.start * itemSize, (range.start + range.count) * itemSize),
          range.start * itemSize,
        );
      }
      expect(gpu).toEqual(cpu);
      for (const slot of dirty) expect(covered(plan, slot)).toBe(true);
    }
  });
});

// ── the picker's own counters ─────────────────────────────────────────
// What a live probe reads to tell a rebuild storm from a reuse: every
// raycast, the hover probes the motion gate declined, the rebuilds, and the
// gate that was open at each.
describe('cell pick stats', () => {
  it('counts raycasts, reuses, suspended skips, rebuilds and the gate behind each rebuild', () => {
    resetCellPickStats();
    const h = pickHarness();
    // The first raycast builds: every counter-keyed gate is open on an index
    // that has never been built.
    livePick(h, 480, 320);
    let s = snapshotCellPickStats();
    expect(s).toMatchObject({ raycasts: 1, rebuilds: 1, reuses: 0, suspendedSkips: 0 });
    expect(s.rebuildReasons).toMatchObject({
      pointerdown: 0, fieldVersion: 1, sizeEpoch: 1, count: 1,
      detailEpoch: 1, viewport: 1, projection: 1,
    });
    expect(s.padRefreshes).toBe(1);

    // Nothing changed: the pointermove path reuses.
    livePick(h, 481, 320);
    s = snapshotCellPickStats();
    expect(s).toMatchObject({ raycasts: 2, rebuilds: 1, reuses: 1 });

    // A press: the precise snapshot, and only that gate is counted.
    h.forcePreciseRef.current = true;
    livePick(h, 481, 320);
    s = snapshotCellPickStats();
    expect(s.rebuilds).toBe(2);
    expect(s.rebuildReasons.pointerdown).toBe(1);
    expect(s.rebuildReasons.fieldVersion).toBe(1);

    // A moved field: that gate alone.
    h.fieldVersionRef.current += 1;
    livePick(h, 481, 320);
    s = snapshotCellPickStats();
    expect(s.rebuilds).toBe(3);
    expect(s.rebuildReasons.fieldVersion).toBe(2);
    expect(s.rebuildReasons.pointerdown).toBe(1);

    // Camera in motion: a hover probe is declined and counted as such, a
    // press is still answered.
    h.pickingSuspendedRef.current = true;
    livePick(h, 481, 320);
    s = snapshotCellPickStats();
    expect(s).toMatchObject({ raycasts: 5, suspendedSkips: 1, rebuilds: 3 });
    h.pointerEventRef.current = { type: 'pointerdown' };
    h.forcePreciseRef.current = true;
    livePick(h, 481, 320);
    s = snapshotCellPickStats();
    expect(s).toMatchObject({ raycasts: 6, suspendedSkips: 1, rebuilds: 4 });
    expect(s.rebuildReasons.pointerdown).toBe(2);
    h.pickingSuspendedRef.current = false;
    h.pointerEventRef.current = { type: 'pointermove' };

    // Hits are a subset of the raycasts answered, and the snapshot is a copy.
    expect(s.hits).toBeLessThanOrEqual(s.raycasts - s.suspendedSkips);
    s.rebuilds = 99;
    expect(snapshotCellPickStats().rebuilds).toBe(4);
    resetCellPickStats();
    expect(snapshotCellPickStats().raycasts).toBe(0);
  });
});
