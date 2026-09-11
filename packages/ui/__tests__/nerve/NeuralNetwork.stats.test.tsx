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
// The fabric half of a landing moved out of the component and into this pure
// module, so the guards that used to scan one file scan the pair.
const LANDING_QUEUE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/nerve/fabricLandingQueue.ts'),
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
    expect(NETWORK_SOURCE.match(/createNeighborGraphBuilder\(/g))
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
    // The translation followed the work: the drain plans the kills and each
    // grow chunk, and the periodic prune still diffs through the same helper.
    expect(LANDING_QUEUE_SOURCE).toContain('planSelectionDeltaUpdate(');
    expect(LANDING_QUEUE_SOURCE).toContain('selectionStrayEdgeKeys(');
    expect(LANDING_QUEUE_SOURCE).not.toMatch(/\$\{edge\.from\}:\$\{edge\.to\}/);
    expect(NETWORK_SOURCE).not.toMatch(/\$\{edge\.from\}:\$\{edge\.to\}/);
    // …and the component grows nothing itself any more: every birth crosses
    // the vocabulary boundary inside the queue. (`killEdges` stays for the
    // eager living-mesh retraction, which translates in `planMeshUpdate`, and
    // `setFabric` stays for the remount rehydrate, which hands a selection.)
    expect(NETWORK_SOURCE).not.toContain('growEdges');
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
    const invalidateAt = NETWORK_SOURCE.indexOf('invalidate();\n', commitAt);
    expect(invalidateAt).toBeGreaterThan(-1);
    expect(NETWORK_SOURCE.indexOf('endCpuProbe(commitProbe);', commitAt))
      .toBeLessThan(invalidateAt);
    // The then-block now ends one line later, on the always-on landing gauge
    // (T1): the probe span is still the commit, the gauge is the whole task.
    expect(invalidateAt).toBeLessThan(
      NETWORK_SOURCE.indexOf(
        'blockFrameStats.observeLanding();\n    }).catch(',
        commitAt,
      ),
    );
    const sliceAt = NETWORK_SOURCE.indexOf('beginCpuProbe(PERFORMANCE_PROBE_LABELS.livePlanSlice)');
    expect(sliceAt).toBeGreaterThan(-1);
    // Taken only on frames that plan: the empty-queue return comes first.
    expect(NETWORK_SOURCE.lastIndexOf('if (queue.batches.length === 0) return;', sliceAt))
      .toBeGreaterThan(-1);
    expect(NETWORK_SOURCE.indexOf('stepLivePulseQueue(queue, livePlanStep)', sliceAt))
      .toBeLessThan(NETWORK_SOURCE.indexOf('endCpuProbe(sliceProbe);', sliceAt));
  });

  // The always-on block-frame gauge (T1) is a different instrument from the
  // opt-in CPU probes above: it measures the TASK, not a span inside it, and
  // it has to be readable off a release build. Its correctness is entirely a
  // matter of where the three calls sit, so that is what is pinned.
  it('closes the worker landing task on the gauge and clears the mark on every other path', () => {
    // Opened in the worker's message handler (neighborGraphBuilder), closed by
    // the microtask that ends this build's commit — the same task.
    expect(NETWORK_SOURCE).toContain('blockFrameStats.observeLanding();\n    }).catch(');
    // Superseded / stale responses and a rejected build must not leave the
    // mark open for the NEXT landing to be measured from.
    expect(NETWORK_SOURCE).toContain(
      '        blockFrameStats.discardLanding();\n        return;\n      }',
    );
    expect(NETWORK_SOURCE).toContain(
      '}).catch((error: unknown) => {\n      blockFrameStats.discardLanding();',
    );
    // The frame reference is taken FIRST in the raw, priority −1 frame, so the
    // interval that contained a landing is bounded by real frame callbacks.
    const frameAt = NETWORK_SOURCE.indexOf('blockFrameStats.markFrame();');
    expect(frameAt).toBeGreaterThan(-1);
    expect(frameAt).toBeLessThan(
      NETWORK_SOURCE.indexOf('advanceConsensusMemoryRouteHopPulseClock(', frameAt),
    );
    expect(NETWORK_SOURCE.lastIndexOf('useFrame(({ clock }, rawDeltaSeconds) => {', frameAt))
      .toBeGreaterThan(-1);
  });

  // T5b: block and inspection consumers, one shared per-frame ledger. Each asks
  // before it starts and reports what it spent; the ledger itself is opened by
  // the raw priority −1 frame, which is the first subscriber of every frame,
  // so nothing can read the previous frame's remains. The rule's own arithmetic
  // is unit-tested in frameBudget.test.ts; what is pinned here is the wiring.
  it('opens one heavy-work ledger a frame and charges the consumers to it', () => {
    // Opened beside T1's frame mark, in the first subscriber of the frame.
    const markAt = NETWORK_SOURCE.indexOf('blockFrameStats.markFrame();');
    const beginAt = NETWORK_SOURCE.indexOf('beginFrameBudget(clock.elapsedTime);', markAt);
    expect(beginAt).toBeGreaterThan(markAt);
    expect(beginAt).toBeLessThan(
      NETWORK_SOURCE.indexOf('advanceConsensusMemoryRouteHopPulseClock(', markAt),
    );
    expect(NETWORK_SOURCE.match(/beginFrameBudget\(clock\.elapsedTime\)/g)).toHaveLength(1);

    // Both of this file's consumers ask before they start and report after.
    const drainAsk = NETWORK_SOURCE.indexOf(
      'mayStartFrameWork(\n        FRAME_BUDGET_FABRIC_DRAIN,',
    );
    const drainSpend = NETWORK_SOURCE.indexOf(
      'spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, drainMs);',
    );
    expect(drainAsk).toBeGreaterThan(-1);
    expect(drainSpend).toBeGreaterThan(drainAsk);
    expect(drainAsk).toBeLessThan(
      NETWORK_SOURCE.indexOf('drainFabricLandingQueue(landingQueue, {'),
    );
    const planAsk = NETWORK_SOURCE.indexOf(
      'mayStartFrameWork(\n      FRAME_BUDGET_PLAN_SLICE,',
    );
    const planSpend = NETWORK_SOURCE.indexOf(
      'spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, sliceMs);',
    );
    expect(planAsk).toBeGreaterThan(-1);
    expect(planSpend).toBeGreaterThan(planAsk);
    expect(planAsk).toBeLessThan(
      NETWORK_SOURCE.indexOf('stepLivePulseQueue(queue, livePlanStep)'),
    );
    // A consumer the ledger held still asks for the next frame: under a
    // demand frameloop nothing else would.
    expect(NETWORK_SOURCE).toContain('    )) {\n      invalidate();\n      return;\n    }');
  });

  // T4: the landing was one task doing two halves — the graph swap and the
  // fabric's grow/kill for the selection that swap published — and a task
  // cannot yield to itself. The split's correctness is entirely a matter of
  // WHERE the two halves now sit, so that is what is pinned here; the queue's
  // own order and budget are unit-tested in fabricLandingQueue.test.ts.
  it('lands the graph in the worker task and drains the fabric on later frames', () => {
    const commitAt = NETWORK_SOURCE.indexOf(
      'beginCpuProbe(PERFORMANCE_PROBE_LABELS.fabricCommit)',
    );
    const landingEnd = NETWORK_SOURCE.indexOf(
      'blockFrameStats.observeLanding();\n    }).catch(',
      commitAt,
    );
    expect(commitAt).toBeGreaterThan(-1);
    expect(landingEnd).toBeGreaterThan(commitAt);
    const landingTask = NETWORK_SOURCE.slice(commitAt, landingEnd);
    // The graph half stays: the swap, the version, the passive publish, the
    // width tier and the boot report all happen in the task that landed them.
    expect(landingTask).toContain('displayGraphRef.current = result.graph;');
    expect(landingTask).toContain('setDisplayGraphVersion(landedVersion);');
    expect(landingTask).toContain('passiveGraphRef.current = passiveGraph;');
    expect(landingTask).toContain('setTrunkTier(passiveGraph)');
    expect(landingTask).toContain('reportBootGraphApplied();');
    // The fabric half leaves as ONE O(1) enqueue — no translation, no
    // per-edge work, no handle call.
    expect(landingTask).toContain('enqueueFabricLanding(fabricLandingQueueRef.current, {');
    expect(landingTask).not.toContain('handles.');
    expect(landingTask).not.toContain('planSelectionDeltaUpdate');
    // The drain rides the raw priority −1 frame, after the gauge's frame mark
    // and BEFORE the live-plan slice's own budget, and it costs one length
    // check on the overwhelming majority of frames, which have nothing to land.
    const drainAt = NETWORK_SOURCE.indexOf('drainFabricLandingQueue(landingQueue, {');
    expect(drainAt).toBeGreaterThan(-1);
    expect(NETWORK_SOURCE.lastIndexOf(
      'landingQueue.items.length > 0\n      && handles\n',
      drainAt,
    )).toBeGreaterThan(-1);
    expect(NETWORK_SOURCE.lastIndexOf('useFrame(({ clock }, rawDeltaSeconds) => {', drainAt))
      .toBeGreaterThan(NETWORK_SOURCE.lastIndexOf('useFrame((_state, delta) => {', drainAt));
    expect(drainAt).toBeLessThan(
      NETWORK_SOURCE.indexOf('stepLivePulseQueue(queue, livePlanStep)'),
    );
    // The budget is read from the interval this frame followed — capped by
    // what the frame's shared heavy-work ledger has left for this consumer,
    // so a slow frame's quarter-interval cannot spend the live plan out of
    // its own frame — and the sim clock is read at drain so a birth never
    // animates from the past.
    expect(NETWORK_SOURCE).toContain(
      'fabricLandingBudgetMs(rawDeltaSeconds * 1000),\n'
      + '          frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN),',
    );
    // A remount rehydrates the fabric wholesale, so every queued delta is a
    // patch against a base that no longer exists.
    expect(NETWORK_SOURCE).toContain(
      'resetFabricLandingQueue(fabricLandingQueueRef.current);',
    );
    // The landed version reaches the bridge class, which chooses its hosts by
    // drawn fabric degree and so must know when the fabric caught up.
    expect(NETWORK_SOURCE).toContain(
      'fabricLandedVersionRef={fabricLandedVersionRef}',
    );
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
