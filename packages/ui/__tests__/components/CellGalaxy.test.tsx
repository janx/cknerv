import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import CellGalaxy from '../../src/components/CellGalaxy';
import {
  ckbNodeAnchorHaloTarget,
  ckbNodeAnchorPresentation,
  cellPointerGestureIsClick,
  cellPickDriftPxPerRadian,
  CELL_PICK_ROTATION_DRIFT_BUDGET_PX,
  cellPointSize,
  diffCellBufferSlots,
  type CellBufferPresentation,
  writeFlashSlots,
  writeCellBuffers,
  writeCellExitStampSlots,
  writeCellInspectionNavigationRoles,
  writeCellInspectionTargets,
} from '../../src/components/CellGalaxy';
import {
  ENTER_STAMP_SENTINEL,
  EXIT_STAMP_SENTINEL,
} from '../../src/geometry/cellLifecycleStamps';
import { deriveCellInspectionField } from '../../src/nerve/cellInspectionField';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';
import type { Cell } from '@cknerv/types';

const CELL_GALAXY_SOURCE = resolve(
  process.cwd(),
  'src/components/CellGalaxy.tsx',
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

  it('turns direct inspection neighbours into the bounded pick surface', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    expect(source).toContain(
      'cellInspectionNavigationTarget(inspectionField, c.id)',
    );
    expect(source).toContain(
      'const count = Math.min(drawCountRef.current, cells.length)',
    );
    expect(source).toContain('i < count');
    expect(source).toContain('inspectionFieldRef={inspectionFieldRef}');
    expect(source).toContain("g.setAttribute('aInspectionRole'");
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
    const picker = source.slice(
      source.indexOf('function CellPicker('),
      source.indexOf('export default function CellGalaxy'),
    );

    expect(picker).toContain('ScreenSpaceHitIndex');
    expect(picker).toContain('indexedMatrixWorld.equals(matrix)');
    expect(picker).toContain('indexedCameraView.equals(camera.matrixWorldInverse)');
    expect(picker).toContain('indexedProjection.equals(camera.projectionMatrix)');
    expect(picker).toContain('indexedDetailVersion !== detailAttr.version');
    expect(picker).toContain('screenIndex.find(');
    expect(picker).toContain("canvas.addEventListener('pointerdown'");
    expect(picker).not.toContain("canvas.addEventListener('pointerup'");
    expect(picker).not.toContain("canvas.addEventListener('click'");
    expect(picker).not.toContain('window.requestAnimationFrame');
    expect(picker).not.toContain('indexFreshThisFrame');
    expect(picker).toContain('forcePreciseRaycastRef.current');
  });

  it('consumes only the server display plane — zero composition policy', () => {
    const source = readFileSync(CELL_GALAXY_SOURCE, 'utf8');

    // The old client-side composition machinery must stay dead: membership
    // is server-authored and arrives as the display journal.
    expect(source).not.toContain('galaxyComposition');
    expect(source).not.toContain('currentActivityCellIds');
    expect(source).not.toContain('pinCellInspectionFieldInVisiblePrefix');
    // Staged members resolve canonical-first through the display residents,
    // and selection/inspection visibility rides the bounded overlay pool
    // appended after the staged list.
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

describe('writeCellInspectionTargets', () => {
  it('writes graph-hop energy in the current visible Cell order', () => {
    const cells = [mkCell(3), mkCell(1), mkCell(4), mkCell(2)];
    const graph: NeighborGraph = {
      adjacency: new Map([
        [1, new Set([2])],
        [2, new Set([1, 3])],
        [3, new Set([2])],
        [4, new Set()],
      ]),
      edges: [
        { from: 1, to: 2, d: 1 },
        { from: 2, to: 3, d: 1 },
      ],
    };
    const field = deriveCellInspectionField(graph, 1);
    const targets = new Float32Array(4);

    writeCellInspectionTargets(cells, cells.length, field, targets);

    expect(targets[0]).toBeCloseTo(0.72);
    expect(targets[1]).toBe(1);
    expect(targets[2]).toBeCloseTo(0.46);
    expect(targets[3]).toBeCloseTo(0.9);
  });

  it('restores every visible Cell to full energy without inspection', () => {
    const targets = new Float32Array(3).fill(0);

    writeCellInspectionTargets([mkCell(1), mkCell(2)], 2, null, targets);

    expect([...targets]).toEqual([1, 1, 0]);
  });

  it('patches only changed membership ranges during a block update', () => {
    const targets = new Float32Array([0.25, 0.25, 0.25]);

    writeCellInspectionTargets(
      [mkCell(1), mkCell(2), mkCell(3)],
      3,
      null,
      targets,
      [{ start: 1, count: 1 }],
    );

    expect([...targets]).toEqual([0.25, 1, 0.25]);
  });
});

describe('writeCellInspectionNavigationRoles', () => {
  it('marks only direct neighbours in the current visible Cell order', () => {
    const cells = [mkCell(3), mkCell(1), mkCell(4), mkCell(2)];
    const graph: NeighborGraph = {
      adjacency: new Map([
        [1, new Set([2])],
        [2, new Set([1, 3])],
        [3, new Set([2])],
        [4, new Set()],
      ]),
      edges: [
        { from: 1, to: 2, d: 1 },
        { from: 2, to: 3, d: 1 },
      ],
    };
    const field = deriveCellInspectionField(graph, 1);
    const roles = new Float32Array(4);

    writeCellInspectionNavigationRoles(cells, cells.length, field, roles);

    expect([...roles]).toEqual([0, 0, 0, 1]);
  });

  it('clears navigation roles when inspection closes', () => {
    const roles = new Float32Array([1, 1, 1]);

    writeCellInspectionNavigationRoles(
      [mkCell(1), mkCell(2)],
      2,
      null,
      roles,
    );

    expect([...roles]).toEqual([0, 0, 1]);
  });

  it('patches only changed navigation slots during a block update', () => {
    const roles = new Float32Array([1, 1, 1]);

    writeCellInspectionNavigationRoles(
      [mkCell(1), mkCell(2), mkCell(3)],
      3,
      null,
      roles,
      [{ start: 1, count: 1 }],
    );

    expect([...roles]).toEqual([1, 0, 1]);
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
      bornArr: new Float32Array(3).fill(-99),
      deathArr: new Float32Array(3).fill(-99),
      enterArr: new Float32Array(3).fill(-99),
      exitArr: new Float32Array(3).fill(-99),
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
    expect(t.bornArr[0]).toBe(-99);
    expect(t.bornArr[1]).not.toBe(-99);
    expect(t.bornArr[2]).toBe(-99);
    // Stage stamps ride the same ranges as every other per-cell attribute.
    expect([...t.enterArr]).toEqual([-99, ENTER_STAMP_SENTINEL, -99]);
    expect([...t.exitArr]).toEqual([-99, EXIT_STAMP_SENTINEL, -99]);
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
      bornArr:  new Float32Array(2),
      deathArr: new Float32Array(2).fill(1e9),
      enterArr: new Float32Array(2),
      exitArr:  new Float32Array(2),
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
    // Far retained cores preserve the same bounded A field mapping.
    expect([...t.memoryIdentityArr.slice(0, 3)]).toEqual([0, 0, 0]);
    expect(t.memoryIdentityArr[3]).toBeGreaterThan(0);
    expect(t.memoryIdentityArr[3]).toBeLessThan(1);
    expect(t.memoryIdentityArr[4]).toBeCloseTo(0.6);
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
      bornArr: new Float32Array(2),
      deathArr: new Float32Array(2).fill(1e9),
      enterArr: new Float32Array(2),
      exitArr: new Float32Array(2),
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

    expect(t.bornArr[1]).toBe(42);
    expect(t.bornArr[0]).not.toBe(42);
  });

  it('writes stage stamps per cell id, sentinels for everyone else', () => {
    const cells = [mkCell(1), mkCell(2), mkCell(3)];
    const t = {
      posArr: new Float32Array(9),
      colorArr: new Float32Array(9),
      bornArr: new Float32Array(3),
      deathArr: new Float32Array(3).fill(1e9),
      enterArr: new Float32Array(3),
      exitArr: new Float32Array(3),
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
    expect([...t.enterArr]).toEqual([
      5,
      ENTER_STAMP_SENTINEL,
      ENTER_STAMP_SENTINEL,
    ]);
    expect([...t.exitArr]).toEqual([
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
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
      bornArr:  new Float32Array(1),
      deathArr: new Float32Array(1).fill(1e9),
      enterArr: new Float32Array(1),
      exitArr:  new Float32Array(1),
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
    expect(source).toContain('cellInspectionFromAttr');
    expect(source).toContain('cellInspectionToAttr');
    expect(source).toContain('uInspectionBlend.value');
    expect(source).not.toContain(
      'markPopulatedBufferUpdate(cellInspectionAttr, count)',
    );
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
    // aExitAt is marked exactly once, from both range sources.
    expect(source.match(/markCellBufferUpdateRanges\(\n?\s*cellExitAtAttr/g))
      .toHaveLength(1);
    expect(source).toContain(
      'mergeCellFlashRanges(cellBufferRanges, exitStampRanges, count)',
    );
  });
});

describe('writeCellExitStampSlots', () => {
  it('writes only changed stamps and coalesces their upload ranges', () => {
    const exitArr = new Float32Array(6).fill(EXIT_STAMP_SENTINEL);
    const slotOf = new Map([[10, 1], [11, 2], [12, 4], [13, 5]]);
    const exitAt = new Map([[10, 7.5], [11, 7.5]]);

    const ranges = writeCellExitStampSlots(
      [10, 11, 12],
      slotOf,
      6,
      exitAt,
      exitArr,
    );

    expect(ranges).toEqual([
      { start: 1, count: 2 },
      { start: 4, count: 1 },
    ]);
    expect([...exitArr]).toEqual([
      EXIT_STAMP_SENTINEL,
      7.5,
      7.5,
      EXIT_STAMP_SENTINEL,
      // A cancelled departure returns to the sentinel, which is the whole
      // reason this path exists: its slot occupant never changed.
      EXIT_STAMP_SENTINEL,
      EXIT_STAMP_SENTINEL,
    ]);
  });

  it('skips ids with no slot and slots past the draw range', () => {
    const exitArr = new Float32Array(3).fill(EXIT_STAMP_SENTINEL);
    const ranges = writeCellExitStampSlots(
      [10, 11],
      new Map([[10, 5]]),
      3,
      new Map([[10, 1], [11, 2]]),
      exitArr,
    );
    expect(ranges).toEqual([]);
    expect([...exitArr]).toEqual([
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

  it('tolerates ~1s of default spin before the worst rim cell rebuilds', () => {
    const rim = cellPickDriftPxPerRadian(60, 2.4, 540, 150);
    const toleratedRadians = CELL_PICK_ROTATION_DRIFT_BUDGET_PX / rim;
    // Default LIVE.galaxy.rotationRate is 0.0025 rad/s — the budget must
    // buy enough angle that hover motion stops rebuilding per event.
    expect(toleratedRadians / 0.0025).toBeGreaterThan(0.5);
    // …while staying sub-visual: the budget itself is under 2px.
    expect(CELL_PICK_ROTATION_DRIFT_BUDGET_PX).toBeLessThan(2);
  });
});
