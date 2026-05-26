import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import CellShell from '../../src/components/CellShell';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';

describe('CellShell', () => {
  it('mounts inside an r3f Canvas without throwing', () => {
    function Harness() {
      const flashRef = useRef(new Map<number, number>());
      const dirtyRef = useRef(false);
      return <CellShell cellFlashRef={flashRef} flashDirtyRef={dirtyRef} />;
    }
    expect(() =>
      render(
        <CellGalaxyProvider value={emptyCellsCache()}>
          <Canvas>
            <Harness />
          </Canvas>
        </CellGalaxyProvider>,
      ),
    ).not.toThrow();
  });
});
