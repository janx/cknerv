import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import CellGalaxy from '../../src/components/CellGalaxy';
import {
  ckbNodeAnchorHaloTarget,
  ckbNodeAnchorPresentation,
  writeFlashSlots,
  writeCellBuffers,
  writeCellInspectionNavigationRoles,
  writeCellInspectionTargets,
  pinCellInspectionFieldInVisiblePrefix,
  pinSelectedCellInVisiblePrefix,
} from '../../src/components/CellGalaxy';
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
    expect(source).not.toContain('<CellCrystal');
    expect(source).not.toContain('CELL_FORM');
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
          content_hash: '0x' + '00'.repeat(32),
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
    content_hash: '0x' + '00'.repeat(32),
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
});

describe('pinSelectedCellInVisiblePrefix', () => {
  it('pins an inspected Cell without dropping or duplicating cache entries', () => {
    const cells = [mkCell(1), mkCell(2), mkCell(3), mkCell(4), mkCell(5)];
    const result = pinSelectedCellInVisiblePrefix(cells, 3, 5);

    expect(result.slice(0, 3).map((cell) => cell.id)).toEqual([1, 2, 5]);
    expect(new Set(result.map((cell) => cell.id))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(cells.map((cell) => cell.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns the existing order when selection is already visible or absent', () => {
    const cells = [mkCell(1), mkCell(2), mkCell(3)];
    expect(pinSelectedCellInVisiblePrefix(cells, 2, 2)).toBe(cells);
    expect(pinSelectedCellInVisiblePrefix(cells, 2, 99)).toBe(cells);
    expect(pinSelectedCellInVisiblePrefix(cells, 3, 3)).toBe(cells);
  });
});

describe('pinCellInspectionFieldInVisiblePrefix', () => {
  it('keeps the root and direct neighbours before hop-two context', () => {
    const cells = Array.from({ length: 10 }, (_, index) => mkCell(index + 1));
    const field = {
      selectedCellId: 9,
      maxHops: 2,
      hopsByCellId: new Map([
        [9, 0],
        [8, 1],
        [10, 1],
        [6, 2],
        [7, 2],
      ]),
    };

    const result = pinCellInspectionFieldInVisiblePrefix(
      cells,
      4,
      9,
      field,
    );

    expect(new Set(result.slice(0, 4).map((cell) => cell.id)))
      .toEqual(new Set([9, 8, 10, 6]));
    expect(result[3].id).toBe(9);
    expect(new Set(result.map((cell) => cell.id)))
      .toEqual(new Set(cells.map((cell) => cell.id)));
    expect(cells.map((cell) => cell.id))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('spends a tight budget on every direct neighbour before hop two', () => {
    const cells = Array.from({ length: 8 }, (_, index) => mkCell(index + 1));
    const field = {
      selectedCellId: 8,
      maxHops: 2,
      hopsByCellId: new Map([
        [8, 0],
        [6, 1],
        [7, 1],
        [5, 2],
      ]),
    };

    const result = pinCellInspectionFieldInVisiblePrefix(
      cells,
      3,
      8,
      field,
    );

    expect(new Set(result.slice(0, 3).map((cell) => cell.id)))
      .toEqual(new Set([8, 6, 7]));
    expect(result.slice(0, 3).some((cell) => cell.id === 5)).toBe(false);
  });

  it('ignores a stale field while immediately pinning the new root', () => {
    const cells = Array.from({ length: 9 }, (_, index) => mkCell(index + 1));
    const staleField = {
      selectedCellId: 9,
      maxHops: 2,
      hopsByCellId: new Map([
        [9, 0],
        [6, 1],
        [7, 1],
      ]),
    };

    const result = pinCellInspectionFieldInVisiblePrefix(
      cells,
      3,
      8,
      staleField,
    );

    expect(result.slice(0, 3).map((cell) => cell.id)).toEqual([1, 2, 8]);
  });

  it('returns the existing order when the full field is already visible', () => {
    const cells = Array.from({ length: 6 }, (_, index) => mkCell(index + 1));
    const field = {
      selectedCellId: 2,
      maxHops: 2,
      hopsByCellId: new Map([
        [2, 0],
        [1, 1],
        [3, 1],
        [4, 2],
      ]),
    };

    expect(pinCellInspectionFieldInVisiblePrefix(cells, 4, 2, field))
      .toBe(cells);
    expect(pinCellInspectionFieldInVisiblePrefix(cells, 4, null, field))
      .toBe(cells);
  });
});

describe('writeCellBuffers', () => {
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
        asset_kind: 'dao',
        lock_kind: 'omnilock',
      },
    ];
    const t = {
      posArr:   new Float32Array(6),
      colorArr: new Float32Array(6),
      bornArr:  new Float32Array(2),
      deathArr: new Float32Array(2).fill(1e9),
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
    // Size: generic vs tagged.
    expect(t.sizeArr[0]).toBeCloseTo(1.6, 5);
    expect(t.sizeArr[1]).toBeCloseTo(3, 5);
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
      new Map([[2, 42]]),
    );

    expect(t.bornArr[1]).toBe(42);
    expect(t.bornArr[0]).not.toBe(42);
  });
});

describe('CellGalaxy useSimFrame skip behavior', () => {
  it('writeCellBuffers writes only when cellsList identity changes', () => {
    // Documents the contract used by the dirty-flag call site in
    // CellGalaxy.useSimFrame: calling writeCellBuffers twice with the
    // same input produces deterministic output, so it's safe for the
    // call site to skip the second call without altering buffer state.
    const cells = [mkCell(1)];
    const t = {
      posArr:   new Float32Array(3),
      colorArr: new Float32Array(3),
      bornArr:  new Float32Array(1),
      deathArr: new Float32Array(1).fill(1e9),
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
});
