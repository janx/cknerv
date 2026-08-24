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
  type CellBufferPresentation,
  writeFlashSlots,
  writeCellBuffers,
  writeCellExitStampSlots,
} from '../../src/components/CellGalaxy';
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
  ENTER_STAMP_SENTINEL,
  EXIT_STAMP_SENTINEL,
} from '../../src/geometry/cellLifecycleStamps';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';
import type { Cell } from '@cknerv/types';

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

  it('can suspend full-field picking during camera drags', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain('pickingSuspendedRef?: React.RefObject<boolean>');
    expect(source).toContain('if (pickingSuspendedRef?.current) return;');
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
    // the one thing that re-syncs the slots without a journal patch.
    expect(source).toContain(
      'const membershipNeedsSync = overlayNeedsSync || holdsReaped > 0;',
    );
    // The hold segment can never outgrow the allocation it is written into.
    expect(source).toContain(
      'INSTANCE_CAPACITY - staged.length - overlayEntries.length',
    );
    // Stamping reads the membership diff the render set now publishes, and
    // runs on overlay movement too — a selection can land on a fading cell.
    expect(source).toContain('entered: renderUpdate?.entered');
    expect(source).toContain('exited: renderUpdate?.exited');
    expect(source).toContain('if (overlayNeedsSync) {\n      const slotState');
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

function pickField(): Cell[] {
  // A spiral shell, deliberately crowded: overlapping discs are what make the
  // find()'s distance/depth tie-break — and therefore the oracle — load
  // bearing. Tagged cells and a capacity spread vary point size and presence.
  return Array.from({ length: 260 }, (_, i) => {
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
  sizes: Float32Array;
  details: Float32Array;
  object: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  selectedCellIdRef: { current: number | null };
  hoveredCellIdRef: { current: number | null };
  forcePreciseRef: { current: boolean };
  raycast: (
    this: THREE.Object3D,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ) => void;
}

function pickHarness(): PickHarness {
  const cells = pickField();
  const sizes = new Float32Array(cells.length);
  const details = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i += 1) sizes[i] = cellPointSize(cells[i]);
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

  const selectedCellIdRef = { current: null as number | null };
  const hoveredCellIdRef = { current: null as number | null };
  const forcePreciseRef = { current: false };
  const raycast = createCellPickRaycast({
    cellsListRef: { current: cells },
    drawCountRef: { current: cells.length },
    detailAttr: new THREE.BufferAttribute(details, 1),
    detailPickEpoch: { threshold: 0.02, epoch: 0 },
    sizeAttr: new THREE.BufferAttribute(sizes, 1),
    selectedCellIdRef,
    hoveredCellIdRef,
    forcePreciseRef,
    viewportRef: { current: { width: PICK_WIDTH, height: PICK_HEIGHT } },
  });
  return {
    cells, sizes, details, object, camera,
    selectedCellIdRef, hoveredCellIdRef, forcePreciseRef, raycast,
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
});
