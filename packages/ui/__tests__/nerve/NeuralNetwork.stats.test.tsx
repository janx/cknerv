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
    expect(NETWORK_SOURCE).toContain('syncCellRenderSet(');
    expect(NETWORK_SOURCE).toContain('displayTopologyVersionRef.current');
    expect(NETWORK_SOURCE).toContain('createNeighborGraphBuilder');
    expect(NETWORK_SOURCE).toContain('displayGraphBuilder.cancel()');
    // Unmount ends the Worker thread but never the builder: Strict Mode
    // replays setup→cleanup→setup against the same instance, and `dispose`
    // is terminal.
    expect(NETWORK_SOURCE).toContain('displayGraphBuilder.releaseWorker()');
    expect(NETWORK_SOURCE).not.toContain('displayGraphBuilder.dispose()');
    expect(NETWORK_SOURCE).not.toContain('buildNeighborGraph(cells, opts)');
    expect(NETWORK_SOURCE).not.toContain('diffAndSnapshotCells');
    expect(NETWORK_SOURCE).not.toContain('snapshotCells');
    expect(NETWORK_SOURCE).not.toContain('prevCellsRef');
  });

  // Replaces the former "routing graph is maintained separately" guard. A
  // second graph over the retained map let pulses route through cells that are
  // never rendered — 41% of sources on mainnet — so the invariant flipped from
  // "keep both fresh" to "there is only one".
  it('keeps exactly one neighbour graph, built over the staged subset', () => {
    expect(NETWORK_SOURCE.match(/createNeighborGraphBuilder\(\)/g))
      .toHaveLength(1);
    // `graphRef` here is the deleted routing ref: `displayGraphRef` and
    // `passiveGraphRef` both capitalise the G, so this cannot match them.
    expect(NETWORK_SOURCE).not.toContain('graphRef');
    expect(NETWORK_SOURCE).not.toContain('routing');
  });

  it('plans, validates and draws pulses on that one graph and its map', () => {
    // Planning takes the pair together, so a route can never be found over
    // edges whose endpoints the geometry lookup below cannot resolve.
    expect(NETWORK_SOURCE).toContain(
      '      displayCellsRef.current,\n      displayGraphRef.current,',
    );
    // Per-frame hop validation and hop geometry read the same pair.
    expect(NETWORK_SOURCE).toContain(
      'const adjacency = displayGraphRef.current.adjacency',
    );
    expect(NETWORK_SOURCE).toContain('const cells = displayCellsRef.current');
    // Nothing routes over the retained map any more.
    expect(NETWORK_SOURCE).not.toContain('const cells = cellsCache.cells');
  });

  it('maintains that graph eagerly between worker builds', () => {
    expect(NETWORK_SOURCE).toContain('planDisplayMeshDiff(');
    // The licence for replaying a diff in place, and the ceiling past which
    // the rebuild already in flight is left to do the work.
    expect(NETWORK_SOURCE).toContain('feed.fresh && feed.chained');
    expect(NETWORK_SOURCE).toContain('shouldDeferBirthsToBulkRebuild(');
  });

  it('journals exact Cell ids for sparse flash-buffer uploads', () => {
    expect(NETWORK_SOURCE).toContain('flashDirtyIdsRef?: CellFlashDirtyIdsRef');
    expect(NETWORK_SOURCE.match(/markCellFlashDirty\(/g)).toHaveLength(2);
  });

  it('feeds the display graph from the server display journal — invalidating only for a truncated prefix', () => {
    // The display-plane build request chains worker deltas; the explicit
    // journal invalidation survives for the two truncated-prefix regimes —
    // the manual clamp under a plane, and the no-display-plane fallback's
    // partial canonical prefix — whose churn the journal describes against a
    // membership wider than the packed window.
    expect(NETWORK_SOURCE).toContain('feedDisplayGraphJournal(displayFeedRef.current, cellsCache)');
    expect(NETWORK_SOURCE).toContain(
      'cellRenderClampActive(cellsCache, cellDisplayLimit)',
    );
    expect(NETWORK_SOURCE).toMatch(
      /\(displayPlaneActive && !clampActive\)\s*\|\|\s*displayCells === cellsCache\.cells\s*\?\s*consumeTopologyJournal\(displayFeedRef\.current\.journal\)\s*:\s*invalidateTopologyJournal\(displayFeedRef\.current\.journal\)/,
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
