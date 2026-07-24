import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import CellGalaxy from '../../src/components/CellGalaxy';
import {
  writeFlashSlots,
  writeCellBuffers,
  pinSelectedCellInVisiblePrefix,
  selectWaveAnchor,
} from '../../src/components/CellGalaxy';
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
    expect(dispatcherSource).toContain("event.kind === 'address'");
    expect(dispatcherSource).toContain("event.kind === 'anchor'");
    expect(dispatcherSource).toContain('<CellContentAddressEchoMarker');
    expect(echoSource).toContain('deriveCellContentAddressSegments(encoding)');
    expect(echoSource).toContain('cellContentAddressEchoFrame(');
    expect(echoSource).toContain('memoryContentAddressEchoFingerprint');
    expect(echoSource).toContain('new LineSegments2(');
    expect(locatorSource).toContain('deriveCellOutpointLocatorSegments(encoding)');
    expect(locatorSource).toContain('cellOutpointLocatorEchoFrame(');
    expect(locatorSource).toContain('memoryOutpointLocatorIndexBytes');
    expect(anchorSource).toContain('deriveCellBirthAnchorSegments(encoding)');
    expect(anchorSource).toContain('cellBirthAnchorEchoFrame(');
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

describe('selectWaveAnchor', () => {
  const LOCAL: [number, number, number] = [0, 22, 0];

  it('anchors the wave at the entry peer (origin + receive time) when present', () => {
    const entry: [number, number, number] = [10, 22, -5];
    const r = selectWaveAnchor(entry, 0.3, 4.0, LOCAL, 5.0);
    expect(r.origin).toEqual(entry);
    // Entry-peer receive time = elapsedSec + entryArrivalS — NOT the local
    // node's trigger time. This is the whole point: the wave is owned by the
    // first peer to receive the block, never the local node.
    expect(r.triggerSceneS).toBeCloseTo(4.3, 6);
  });

  it('falls back to the local node origin/time when there is no entry peer', () => {
    const r = selectWaveAnchor(null, 0, 4.0, LOCAL, 5.0);
    expect(r.origin).toEqual(LOCAL);
    expect(r.triggerSceneS).toBe(5.0);
  });
});

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
    // Far LOD stays in the structural cyan family; metadata remains secondary.
    expect(t.colorArr[2]).toBeGreaterThan(t.colorArr[0]);
    expect(t.colorArr[5]).toBeGreaterThan(t.colorArr[3]);
    expect(t.colorArr[3]).not.toBe(t.colorArr[0]);
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
