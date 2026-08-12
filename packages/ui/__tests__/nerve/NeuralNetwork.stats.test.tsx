import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import NeuralNetwork from '../../src/nerve/NeuralNetwork';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';
import { resetPulseStats } from '../../src/nerve/pulseStats';

const NETWORK_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/nerve/NeuralNetwork.tsx'),
  'utf8',
);

beforeEach(() => resetPulseStats());

describe('NeuralNetwork drop instrumentation wiring', () => {
  it('consumes reducer Cell changes without rebuilding a lifecycle snapshot', () => {
    expect(NETWORK_SOURCE).toContain('const diff = cellsCache.cellChanges');
    expect(NETWORK_SOURCE).toContain('diff.baseToken !== routedCellsTokenRef.current');
    expect(NETWORK_SOURCE).toContain('syncCellRenderSet(');
    expect(NETWORK_SOURCE).toContain('displayTopologyVersionRef.current');
    expect(NETWORK_SOURCE).toContain('createNeighborGraphBuilder');
    expect(NETWORK_SOURCE).toContain('scheduleRoutingGraphBuild');
    expect(NETWORK_SOURCE).toContain('if (!routingGraphReadyRef.current) return');
    expect(NETWORK_SOURCE).toContain('routingGraphBuilder.cancel()');
    expect(NETWORK_SOURCE).not.toContain('routingGraphBuilder.dispose()');
    expect(NETWORK_SOURCE).not.toContain('buildNeighborGraph(cells, opts)');
    expect(NETWORK_SOURCE).not.toContain('diffAndSnapshotCells');
    expect(NETWORK_SOURCE).not.toContain('snapshotCells');
    expect(NETWORK_SOURCE).not.toContain('prevCellsRef');
  });

  it('journals exact Cell ids for sparse flash-buffer uploads', () => {
    expect(NETWORK_SOURCE).toContain('flashDirtyIdsRef?: CellFlashDirtyIdsRef');
    expect(NETWORK_SOURCE.match(/markCellFlashDirty\(/g)).toHaveLength(2);
  });

  it('feeds the display graph from the server display journal — never invalidating on the display path', () => {
    // The display-plane build request always chains worker deltas; the
    // explicit journal invalidation survives ONLY for the no-display-plane
    // fallback's truncated canonical prefix.
    expect(NETWORK_SOURCE).toContain('feedDisplayGraphJournal(displayFeedRef.current, cellsCache)');
    expect(NETWORK_SOURCE).toMatch(
      /displayPlaneActive \|\| displayCells === cellsCache\.cells\s*\?\s*consumeTopologyJournal\(displayFeedRef\.current\.journal\)\s*:\s*invalidateTopologyJournal\(displayFeedRef\.current\.journal\)/,
    );
    // Zero composition policy remains: no source knowledge, no activity
    // derivation, no client-side membership resolution.
    expect(NETWORK_SOURCE).not.toContain('galaxyComposition');
    expect(NETWORK_SOURCE).not.toContain('currentActivityCellIds');
    // The nerve screen budget defers to the server display plane when the
    // live-tuning knob rests at its default.
    expect(NETWORK_SOURCE).toContain('cellsCache.displayBudget?.nerveEdges');
  });

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
