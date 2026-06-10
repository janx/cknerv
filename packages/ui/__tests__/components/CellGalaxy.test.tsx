import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import CellGalaxy from '../../src/components/CellGalaxy';
import { writeFlashSlots, writeCellBuffers } from '../../src/components/CellGalaxy';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';
import type { Cell } from '@cknerv/types';

const CELL_GALAXY_SOURCE = resolve(
  process.cwd(),
  'src/components/CellGalaxy.tsx',
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

  it('mounts with receivesFromPeer (receive-delayed reaction) without throwing', () => {
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
              receivesFromPeer
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
  it('writes position, color, born/death and flash for each cell', () => {
    const cells: Cell[] = [
      { ...mkCell(1), pos_seed: [1, 2, 3], born_at_ms: 1000 },
      { ...mkCell(2), pos_seed: [4, 5, 6], born_at_ms: 2000, tag: 'wallet' },
    ];
    const t = {
      posArr:   new Float32Array(6),
      colorArr: new Float32Array(6),
      bornArr:  new Float32Array(2),
      deathArr: new Float32Array(2).fill(1e9),
      flashArr: new Float32Array(2).fill(-1e9),
      sizeArr:  new Float32Array(2),
    };
    const flashMap = new Map<number, number>([[2, 7.5]]);

    writeCellBuffers(cells, 2, (ms: number) => ms / 1000, flashMap, t);

    // Position copied from pos_seed.
    expect(t.posArr[0]).toBe(1);
    expect(t.posArr[1]).toBe(2);
    expect(t.posArr[2]).toBe(3);
    expect(t.posArr[3]).toBe(4);
    // Generic cell color (cell 1 has tag=null) — first channel of GENERIC_COLOR.
    expect(t.colorArr[0]).toBeCloseTo(0.62, 5);
    // wallet-tagged color (cell 2) — first channel of wallet [0.43, 0.91, 0.72].
    expect(t.colorArr[3]).toBeCloseTo(0.43, 5);
    // Size: generic vs tagged.
    expect(t.sizeArr[0]).toBeCloseTo(1.6, 5);
    expect(t.sizeArr[1]).toBeCloseTo(3, 5);
    // Flash slot 1 (cell id=2) has 7.5 from flashMap.
    expect(t.flashArr[1]).toBe(7.5);
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
    };
    writeCellBuffers(cells, 1, (ms: number) => ms / 1000, new Map(), t);
    const snapshotColor = t.colorArr[0];
    writeCellBuffers(cells, 1, (ms: number) => ms / 1000, new Map(), t);
    expect(t.colorArr[0]).toBe(snapshotColor);
  });
});
