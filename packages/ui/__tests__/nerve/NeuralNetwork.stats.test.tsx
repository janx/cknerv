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
    // …and the pair is captured when the batch is OPENED (request time), the
    // planning itself being sliced across later frames.
    expect(NETWORK_SOURCE).toContain(
      'enqueueLivePulseBatch(\n      livePlanQueueRef.current,\n      toFire,\n'
      + '      displayCellsRef.current,\n      displayGraphRef.current,',
    );
    // Per-frame hop validation and hop geometry read the same pair.
    expect(NETWORK_SOURCE).toContain(
      'const adjacency = displayGraphRef.current.adjacency',
    );
    expect(NETWORK_SOURCE).toContain('const cells = displayCellsRef.current');
    // Nothing routes over the retained map any more.
    expect(NETWORK_SOURCE).not.toContain('const cells = cellsCache.cells');
  });

  // The fabric keys an edge `lo|hi` and the geometry layer `${from}:${to}`,
  // and an unknown key is SKIPPED, not rejected — so a raw graph-vocabulary
  // key here reads as a working delta while nothing decays. The translation
  // has one home; this keeps the literal from growing back beside it.
  it('addresses the fabric through the edge-key translation, never raw', () => {
    expect(NETWORK_SOURCE).toContain('planSelectionDeltaUpdate(delta, deltaNow)');
    expect(NETWORK_SOURCE).toContain('selectionStrayEdgeKeys(');
    expect(NETWORK_SOURCE).not.toMatch(/\$\{edge\.from\}:\$\{edge\.to\}/);
  });

  it('maintains that graph eagerly between worker builds', () => {
    expect(NETWORK_SOURCE).toContain('planDisplayMeshDiff(');
    // The licence for replaying a diff in place.
    expect(NETWORK_SOURCE).toContain('feed.fresh && feed.chained');
    // Every generation's newborns are admitted eagerly, whatever the batch
    // size: the bucketed birth grid removed the comparison ceiling that once
    // deferred a large batch to the worker and left its newborns unroutable.
    expect(NETWORK_SOURCE).not.toContain('shouldDeferBirthsToBulkRebuild');
  });

  // The one-task planner ran every route search of a block delta inside the
  // effect that saw it. The effect now only opens the batch (cursor +
  // departure clock) and the searches run a bounded slice per frame, on the
  // raw frame and ahead of the pulse walk, so the packets it admits are in
  // the pool before the walk that would move them.
  it('opens link batches in the effect and plans them a slice per frame, before the pulse walk', () => {
    expect(NETWORK_SOURCE).toContain('openLinkBatch(');
    expect(NETWORK_SOURCE).not.toContain('planLinkBatch(');
    expect(NETWORK_SOURCE).toContain('const startSec = scheduleLivePulseStartSec(');
    const step = NETWORK_SOURCE.indexOf('stepLivePulseQueue(queue, livePlanStep)');
    const walk = NETWORK_SOURCE.indexOf('// Per-frame: roll every active pulse forward');
    expect(step).toBeGreaterThan(-1);
    expect(walk).toBeGreaterThan(step);
    // Raw frame, not the sim frame: a paused clock must not pause planning.
    // The slice reads the raw frame delta for its wall-relative budget.
    const stepFrame = NETWORK_SOURCE.lastIndexOf('useFrame((_state, delta) => {', step);
    const stepSimFrame = NETWORK_SOURCE.lastIndexOf('useSimFrame(', step);
    expect(stepFrame).toBeGreaterThan(stepSimFrame);
    // The departure clock is stamped at arrival, in the opening effect —
    // never inside the slice that admits the pulse.
    const enqueueAt = NETWORK_SOURCE.indexOf('enqueueLivePulseBatch(');
    expect(NETWORK_SOURCE.indexOf('const startSec = scheduleLivePulseStartSec('))
      .toBeLessThan(enqueueAt);
    // A reorg prunes queued links beside the pulses already in flight.
    const prunePool = NETWORK_SOURCE.indexOf('pulsesRef.current = prunePulsesFromBlock(');
    const pruneQueue = NETWORK_SOURCE.indexOf('pruneLivePulseQueue(livePlanQueueRef.current, prune.fromBlock)');
    expect(prunePool).toBeGreaterThan(-1);
    expect(pruneQueue).toBeGreaterThan(prunePool);
    // The queue is a ref that no effect cleanup clears: a dependency re-run
    // must not drop a batch a previous run opened.
    expect(NETWORK_SOURCE).not.toMatch(/livePlanQueueRef\.current\.batches\.length = 0/);
    expect(NETWORK_SOURCE).not.toMatch(/livePlanQueueRef\.current = createLivePulseQueue\(\)/);
  });

  // A storm frame pushes up to MAX_ACTIVE_PULSES × (head + TRAIL_HOPS)
  // hops; a literal per push was one object per hop per frame, and the
  // memory-distance loop allocated a pair array on every frame, pulses or
  // none. Every push now goes through the one scratch record.
  it('pushes every hop through one scratch record and allocates no per-frame pair', () => {
    const pushes = NETWORK_SOURCE.match(/handles\.pushActiveHop\(/g) ?? [];
    const scratchPushes = NETWORK_SOURCE.match(
      /handles\.pushActiveHop\(\s*writeActiveHop\(\s*hopScratch,/g,
    ) ?? [];
    expect(pushes.length).toBe(6);
    expect(scratchPushes.length).toBe(pushes.length);
    expect(NETWORK_SOURCE).not.toMatch(/pushActiveHop\(\s*\{/);
    expect(NETWORK_SOURCE).toContain('const hopScratch = useMemo(() => makeActiveHopScratch(), [])');
    expect(NETWORK_SOURCE).not.toContain('[traceFocusRef.current, departingFocus]');
  });

  it('journals exact Cell ids for sparse flash-buffer uploads', () => {
    expect(NETWORK_SOURCE).toContain('flashDirtyIdsRef?: CellFlashDirtyIdsRef');
    expect(NETWORK_SOURCE.match(/markCellFlashDirty\(/g)).toHaveLength(2);
  });

  it('measures the complete active and memory pulse frame without a callback wrapper', () => {
    const frameStart = NETWORK_SOURCE.indexOf(
      '// Per-frame: roll every active pulse forward',
    );
    const frameEnd = NETWORK_SOURCE.indexOf('\n\n  return (', frameStart);
    const frame = NETWORK_SOURCE.slice(frameStart, frameEnd);
    const begin = frame.indexOf('const activePulseFrameProbe = beginCpuProbe(');
    const guardedWork = frame.indexOf('try {', begin);
    const firstPush = frame.indexOf('handles.pushActiveHop');
    const lastPush = frame.lastIndexOf('handles.pushActiveHop');
    const flush = frame.indexOf('handles?.flushActive()');
    const cleanup = frame.indexOf('} finally {', flush);
    const end = frame.indexOf('endCpuProbe(activePulseFrameProbe)', cleanup);

    expect(frame).toContain('PERFORMANCE_PROBE_LABELS.activePulseFrame');
    expect(begin).toBeGreaterThan(-1);
    expect(guardedWork).toBeGreaterThan(begin);
    expect(firstPush).toBeGreaterThan(guardedWork);
    expect(lastPush).toBeGreaterThanOrEqual(firstPush);
    expect(flush).toBeGreaterThan(lastPush);
    expect(cleanup).toBeGreaterThan(flush);
    expect(end).toBeGreaterThan(cleanup);
    // measureCpuProbe would allocate its callback argument on every frame.
    // The explicit begin/end API returns before both allocation and clock
    // access while the opt-in probe has no retainers.
    expect(frame).not.toContain('measureCpuProbe');
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

  it('patches the staged map from the same update, above the build gates', () => {
    // The map the builder packs is maintained at O(churn), never rebuilt per
    // block — and it is resolved BEFORE the gates that skip a generation,
    // because the patch has to see every update the cursor publishes or it
    // pays for a rebuild it existed to avoid.
    expect(NETWORK_SOURCE).toContain(
      'syncCellRenderMap(displayCellMapRef.current, renderUpdate)',
    );
    expect(NETWORK_SOURCE).not.toContain('cellRenderMap(visibleCells)');
    const resolvedAt = NETWORK_SOURCE.indexOf('syncCellRenderMap(');
    const gatedAt = NETWORK_SOURCE.indexOf('if (!topologyChanged) return;');
    expect(resolvedAt).toBeGreaterThan(-1);
    expect(gatedAt).toBeGreaterThan(resolvedAt);
  });

  // The block-frame stack under the opt-in render probe: one span per cache
  // generation around the display sync, one per landed build around the
  // fabric's commit, and one per planning frame around the slice — each at
  // its real call site, each the bare call while the probe is off.
  it('spans the display sync, the fabric commit and the planning slice under the opt-in probe', () => {
    expect(NETWORK_SOURCE).toContain(
      'measureCpuProbe(PERFORMANCE_PROBE_LABELS.syncDisplayFabric, syncDisplayFabric)',
    );
    expect(NETWORK_SOURCE).not.toMatch(/useEffect\(\(\) => \{\n\s*syncDisplayFabric\(\);/);
    const commitAt = NETWORK_SOURCE.indexOf('beginCpuProbe(PERFORMANCE_PROBE_LABELS.fabricCommit)');
    expect(commitAt).toBeGreaterThan(-1);
    // Opened after the response guards, closed before the invalidate that
    // ends the commit — the handler's whole body, nothing outside it.
    expect(NETWORK_SOURCE.lastIndexOf(') return;', commitAt)).toBeGreaterThan(-1);
    expect(NETWORK_SOURCE.indexOf('endCpuProbe(commitProbe);', commitAt))
      .toBeLessThan(NETWORK_SOURCE.indexOf('invalidate();\n    }).catch(', commitAt));
    const sliceAt = NETWORK_SOURCE.indexOf('beginCpuProbe(PERFORMANCE_PROBE_LABELS.livePlanSlice)');
    expect(sliceAt).toBeGreaterThan(-1);
    // Taken only on frames that plan: the empty-queue return comes first.
    expect(NETWORK_SOURCE.lastIndexOf('if (queue.batches.length === 0) return;', sliceAt))
      .toBeGreaterThan(-1);
    expect(NETWORK_SOURCE.indexOf('stepLivePulseQueue(queue, livePlanStep)', sliceAt))
      .toBeLessThan(NETWORK_SOURCE.indexOf('endCpuProbe(sliceProbe);', sliceAt));
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
