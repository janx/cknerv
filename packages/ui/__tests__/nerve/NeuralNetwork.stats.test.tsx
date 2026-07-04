import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import NeuralNetwork from '../../src/nerve/NeuralNetwork';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';
import { resetPulseStats } from '../../src/nerve/pulseStats';

beforeEach(() => resetPulseStats());

describe('NeuralNetwork drop instrumentation wiring', () => {
  // Integration mount-safety test — the level this jsdom harness supports
  // (same precedent as __tests__/components/CellGalaxy.test.tsx). r3f v8's
  // <Canvas> never mounts its children at 0×0 (the no-op ResizeObserver in
  // test-setup.ts keeps the container unmeasured), so NeuralNetwork's effects
  // never run here — the counters can't be observed through a Canvas mount.
  // The wiring LOGIC (planLinkBatch + tickBlockIfAdvanced) is instead unit-
  // tested directly against the real pulseStats in __tests__/nerve/pulseBatch.test.ts.
  // This test only proves the component + its effects compile and mount without
  // throwing; a minimal empty cache is all a smoke test needs.
  it('mounts inside an r3f Canvas without throwing', () => {
    expect(() =>
      render(
        <CellGalaxyProvider value={emptyCellsCache()}>
          <Canvas>
            <NeuralNetwork />
          </Canvas>
        </CellGalaxyProvider>,
      ),
    ).not.toThrow();
  });
});
