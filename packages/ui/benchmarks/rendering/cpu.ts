import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import {
  advanceConstellationFrame,
  createCellConstellationHandles,
  commitConstellationFrame,
  suspendConstellationFrame,
} from '../../src/components/hud/cellConstellationFrame';
import {
  buildBridgeAnchorIndex,
  createBridgeHostSyncJob,
  createBridgeHostRegistry,
  createBridgeSelectionJob,
  runBridgeHostSyncJobSlice,
  runBridgeSelectionJobSlice,
  selectBridgeEdges,
  syncBridgeHosts,
} from '../../src/geometry/bridgeEdges';
import {
  createBridgeReconcileJob,
  runBridgeReconcileJobSlice,
} from '../../src/nerve/bridgeStroke';
import { createCellSlotState, syncCellSlots } from '../../src/geometry/cellSlotAssignment';
import { createNeighborGraphBuilder } from '../../src/geometry/neighborGraphBuilder';
import {
  resetNeighborGraphBuilderStats,
  snapshotNeighborGraphBuilderStats,
} from '../../src/geometry/neighborGraphBuilderStats';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import {
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
  placePopulationField,
} from '../../src/geometry/populationFieldPlacement';
import { helixSeedF64 } from '../../src/helix';
import {
  COHORT_MOTES_PER_COHORT,
  buildCohortMotesGeometry,
  setCohortMotesDrawCount,
  stampCohortMotes,
} from '../../src/materials/colonyMotes';
import * as ledger from '../../src/nerve/frameBudget';
import {
  resetConstellationWorkStats,
  snapshotConstellationWorkStats,
} from '../../src/derives/cellConstellation.derive';

function readCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (error) {
    // The managed benchmark sandbox can report EPERM after git already wrote
    // stdout. Ordinary checkouts take the return above; this keeps that
    // captured exact hash rather than guessing through worktree/packed refs.
    const stdout = (error as { stdout?: string | Buffer }).stdout;
    if (stdout) return stdout.toString().trim();
    throw error;
  }
}
const commit = readCommit();
function readSourceFingerprint(): { dirty: boolean; sha256: string } {
  let dirty = true;
  try {
    dirty = execFileSync('git', ['status', '--porcelain', '--', '.', '../../ui-app'], {
      encoding: 'utf8',
    }).trim().length > 0;
  } catch {
    // Some managed runners deny child git even though the checkout is readable.
    // Conservative `true` avoids mislabelling modified code as a clean HEAD.
  }
  const hash = createHash('sha256');
  const addTree = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = `${path}/${name}`;
      const stat = statSync(child);
      if (stat.isDirectory()) addTree(child);
      else {
        hash.update(child);
        hash.update(readFileSync(child));
      }
    }
  };
  addTree('src');
  addTree('benchmarks');
  addTree('../../ui-app/src');
  hash.update(readFileSync('package.json'));
  return { dirty, sha256: hash.digest('hex') };
}
const source = readSourceFingerprint();
const seed = POPULATION_FIELD_SEED;
const topology = { k: 5, maxEdgeLength: 42, passiveEdgeBudget: 8_000 };
const environment = {
  node: process.version,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  logicalCpus: os.cpus().length,
  platform: `${process.platform}-${process.arch}`,
};
const sizes = (process.env.CKNERV_BENCH_SIZES ?? '12000,50000')
  .split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0);

function emit(scenario: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({
    commit, source, scenario, seed, topology, includesDom: false, environment, ...fields,
  }));
}

function distribution(samples: number[]): Record<string, number> {
  samples.sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
    p95Ms: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0,
    maxMs: samples[samples.length - 1] ?? 0,
  };
}

function measure(iterations: number, run: (index: number) => void): number[] {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    run(index);
    samples.push(performance.now() - started);
  }
  return samples;
}

emit('environment', { sizes, date: new Date().toISOString() });
if (process.env.CKNERV_BENCH_METADATA_ONLY === '1') process.exit(0);
const placementStarted = performance.now();
const placement = placePopulationField(POPULATION_FIELD_POINTS, seed);
emit('population-preparation', {
  size: placement.count,
  segments: placement.segmentCount,
  elapsedMs: performance.now() - placementStarted,
});
const anchorIndex = buildBridgeAnchorIndex(placement);

const panels = [
  { slot: 'analysis', height: 717 },
  { slot: 'specimen', height: 314 },
  { slot: 'reader', height: 340 },
  { slot: 'trace', height: 420 },
] as const;
for (const panelCount of [2, 3, 4]) {
  const handles = createCellConstellationHandles();
  handles.chipWidth = 376;
  handles.chipHeight = 24;
  for (const panel of panels.slice(0, panelCount)) {
    handles.panels[panel.slot].present = true;
    handles.panels[panel.slot].height = panel.height;
  }
  resetConstellationWorkStats();
  const firstStarted = performance.now();
  commitConstellationFrame(handles, 590, 331.5, 1180, 663, 104, 14, []);
  const firstMs = performance.now() - firstStarted;
  const samples = measure(60, (index) => {
    commitConstellationFrame(handles, 591 + index, 331.5, 1180, 663, 104, 14, []);
  });
  emit('inspection-anchor-drift', {
    size: panelCount,
    viewport: [1180, 663],
    firstMs,
    ...distribution(samples),
    operations: snapshotConstellationWorkStats(),
  });

  const resumable = createCellConstellationHandles();
  resumable.chipWidth = 376;
  resumable.chipHeight = 24;
  for (const panel of panels.slice(0, panelCount)) {
    resumable.panels[panel.slot].present = true;
    resumable.panels[panel.slot].height = panel.height;
  }
  ledger.resetFrameBudget();
  let frame = 1;
  const frameSlices: number[] = [];
  const landingFrames: number[] = [];
  const landingCpu: number[] = [];
  const land = (x: number) => {
    const keyPrefix = `${Math.round(x / 0.5)},`;
    const started = performance.now();
    const firstFrame = frame;
    do {
      const sliceStarted = performance.now();
      advanceConstellationFrame(
        resumable, x, 331.5, 1180, 663, 104, 14, [], 0, frame,
      );
      frameSlices.push(performance.now() - sliceStarted);
      frame += 1;
    } while (!resumable.connectorKey.startsWith(keyPrefix));
    landingFrames.push(frame - firstFrame);
    landingCpu.push(performance.now() - started);
  };
  land(590);
  for (let index = 0; index < 60; index += 1) land(591 + index);
  emit('inspection-anchor-drift-resumable', {
    size: panelCount,
    viewport: [1180, 663],
    frameSlice: distribution(frameSlices),
    landingCpu: distribution(landingCpu),
    landingFrames: distribution(landingFrames),
    scheduledLatencyAt60HzMs: distribution(landingFrames.map((count) => count * (1000 / 60))),
  });

  const moving = createCellConstellationHandles();
  moving.chipWidth = 376;
  moving.chipHeight = 24;
  for (const panel of panels.slice(0, panelCount)) {
    moving.panels[panel.slot].present = true;
    moving.panels[panel.slot].height = panel.height;
  }
  commitConstellationFrame(moving, 590, 331.5, 1180, 663, 104, 14, []);
  resetConstellationWorkStats();
  ledger.resetFrameBudget();
  const movingSlices: number[] = [];
  const settleSlices: number[] = [];
  let currentLandings = 0;
  let currentStaleRun = 0;
  let maxCurrentStaleFrames = 0;
  let provisionalVisibleFrames = 0;
  let hiddenFrames = 0;
  let currentHiddenRun = 0;
  let maxConsecutiveHiddenFrames = 0;
  let finalX = 590;
  for (let movingFrame = 1; movingFrame <= 120; movingFrame += 1) {
    finalX = 590 + (movingFrame % 48);
    const sliceStarted = performance.now();
    suspendConstellationFrame(moving, finalX, 331.5, 1180, 663, 14);
    movingSlices.push(performance.now() - sliceStarted);
    if (moving.connectorKey.startsWith(`${Math.round(finalX / 0.5)},`)) {
      currentLandings += 1;
      currentStaleRun = 0;
    } else {
      currentStaleRun += 1;
      maxCurrentStaleFrames = Math.max(maxCurrentStaleFrames, currentStaleRun);
    }
    if (moving.provisionalVisible) {
      provisionalVisibleFrames += 1;
      currentHiddenRun = 0;
    } else if (moving.lastLayout === null || currentStaleRun > 0) {
      hiddenFrames += 1;
      currentHiddenRun += 1;
      maxConsecutiveHiddenFrames = Math.max(maxConsecutiveHiddenFrames, currentHiddenRun);
    }
  }
  let settleFrames = 0;
  while (!moving.connectorKey.startsWith(`${Math.round(finalX / 0.5)},`) && settleFrames < 120) {
    settleFrames += 1;
    const sliceStarted = performance.now();
    advanceConstellationFrame(
      moving, finalX, 331.5, 1180, 663, 104, 14, [], 0, 120 + settleFrames,
    );
    settleSlices.push(performance.now() - sliceStarted);
  }
  emit('inspection-camera-motion-suspended', {
    size: panelCount,
    viewport: [1180, 663],
    simulatedFrames: 120,
    currentLandings,
    maxCurrentStaleFrames,
    provisionalVisibleFrames,
    hiddenFrames,
    maxConsecutiveHiddenFrames,
    settleFrames,
    settled: moving.connectorKey.startsWith(`${Math.round(finalX / 0.5)},`),
    motionFrame: distribution(movingSlices),
    settleFrame: distribution(settleSlices),
    operations: snapshotConstellationWorkStats(),
  });
}

for (const size of sizes) {
  const cells = Array.from({ length: size }, (_unused, index) => {
    const id = index + 1;
    return { id, pos_seed: helixSeedF64(id), death_at_ms: null };
  });
  const cellMap = new Map(cells.map((cell) => [cell.id, cell]));
  const topologyStarted = performance.now();
  const graph = buildNeighborGraph(cellMap, topology);
  const passive = buildPassiveNeighborGraph(graph, {
    edgeBudget: topology.passiveEdgeBudget,
  });
  emit('topology-preparation', {
    size, elapsedMs: performance.now() - topologyStarted,
    edges: graph.edges.length, passiveEdges: passive.edges.length,
  });

  resetNeighborGraphBuilderStats();
  const recoveryBuilder = createNeighborGraphBuilder({
    minWorkerCells: 0,
    workerFactory: () => { throw new Error('benchmark worker construction failure'); },
  });
  let heartbeatAt = performance.now();
  let maxHeartbeatGapMs = 0;
  let heartbeats = 0;
  const heartbeat = setInterval(() => {
    const at = performance.now();
    maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, at - heartbeatAt);
    heartbeatAt = at;
    heartbeats += 1;
  }, 1);
  const recoveryStarted = performance.now();
  const recovered = await recoveryBuilder.build(cellMap, {
    topology,
    includePassive: true,
    passiveEdgeBudget: topology.passiveEdgeBudget,
  });
  const recoveryElapsedMs = performance.now() - recoveryStarted;
  clearInterval(heartbeat);
  recoveryBuilder.dispose();
  emit('worker-construction-failure-recovery', {
    size,
    elapsedMs: recoveryElapsedMs,
    maxHeartbeatGapMs,
    heartbeats,
    result: {
      nodes: recovered?.graph.adjacency.size ?? 0,
      passiveEdges: recovered?.passiveGraph?.edges.length ?? 0,
    },
    operations: snapshotNeighborGraphBuilderStats(),
  });
  const registry = createBridgeHostRegistry();
  syncBridgeHosts(registry, cellMap, passive.edges);

  const pipelineRegistry = createBridgeHostRegistry();
  const pipelineSlices: number[] = [];
  const pipelinePhaseSlices: Record<string, number[]> = {};
  const recordPipelineSlice = (phase: string, run: () => boolean) => {
    const started = performance.now();
    const done = run();
    const elapsed = performance.now() - started;
    pipelineSlices.push(elapsed);
    (pipelinePhaseSlices[phase] ??= []).push(elapsed);
    return done;
  };
  const pipelineStarted = performance.now();
  const syncJob = createBridgeHostSyncJob(pipelineRegistry, cellMap, passive.edges);
  while (!recordPipelineSlice('sync', () => runBridgeHostSyncJobSlice(syncJob, 2).done)) {
    // The production component resumes this cursor on the next frame.
  }
  const selectionJob = createBridgeSelectionJob(pipelineRegistry.hosts.values(), anchorIndex);
  while (!recordPipelineSlice(
    'select', () => runBridgeSelectionJobSlice(selectionJob, 2).done,
  )) {
    // The production component resumes this cursor on the next frame.
  }
  const reconcileJob = createBridgeReconcileJob(
    new Map(), selectionJob.result!.bridges, 0, [],
  );
  while (!recordPipelineSlice(
    'reconcile', () => runBridgeReconcileJobSlice(reconcileJob, 2).done,
  )) {
    // The production component resumes this cursor on the next frame.
  }
  emit('bridge-cold-pipeline', {
    size,
    elapsedMs: performance.now() - pipelineStarted,
    slices: pipelineSlices.length,
    scheduledLatencyAt60HzMs: pipelineSlices.length * (1000 / 60),
    slice: distribution(pipelineSlices),
    phaseSlices: Object.fromEntries(
      Object.entries(pipelinePhaseSlices).map(([phase, values]) => [phase, distribution(values)]),
    ),
    operations: {
      sync: syncJob.operations,
      select: selectionJob.operations,
      reconcile: reconcileJob.operations,
      bridges: selectionJob.result!.bridges.length,
    },
  });

  for (const temperature of ['cold', 'warm'] as const) {
    const coverageCache = new Map<number, number>();
    const planCache = new Map();
    if (temperature === 'warm') {
      selectBridgeEdges(registry.hosts.values(), anchorIndex, { coverageCache, planCache });
    }
    const total: number[] = [];
    const slice: number[] = [];
    const sliceCounts: number[] = [];
    const operationCounts: number[] = [];
    const phaseSlices: Record<string, number[]> = {};
    let result = null;
    const repetitions = temperature === 'cold' ? 5 : 30;
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      if (temperature === 'cold') {
        coverageCache.clear();
        planCache.clear();
      }
      const job = createBridgeSelectionJob(registry.hosts.values(), anchorIndex, {
        coverageCache, planCache,
      });
      const started = performance.now();
      let slices = 0;
      while (job.phase !== 'done') {
        const phase = job.phase;
        const sliceStarted = performance.now();
        runBridgeSelectionJobSlice(job, 2);
        const elapsed = performance.now() - sliceStarted;
        slice.push(elapsed);
        (phaseSlices[phase] ??= []).push(elapsed);
        slices += 1;
      }
      total.push(performance.now() - started);
      sliceCounts.push(slices);
      operationCounts.push(job.operations);
      result = job.result;
    }
    emit(`bridge-selection-${temperature}`, {
      size, ...distribution(total),
      slice: distribution(slice),
      phaseSlices: Object.fromEntries(
        Object.entries(phaseSlices).map(([phase, values]) => [phase, distribution(values)]),
      ),
      scheduledLatencyAt60HzMs: distribution(
        sliceCounts.map((count) => count * (1000 / 60)),
      ),
      jobOperations: distribution(operationCounts),
      operations: result === null ? null : {
        bridges: result.bridges.length,
        hosts: result.hosts,
        considered: result.considered,
      },
      cacheEntries: { coverage: coverageCache.size, plans: planCache.size },
    });
  }

  const slots = createCellSlotState();
  const renderCells = cells as never[];
  syncCellSlots(slots, renderCells);
  const oldPublished = slots.published;
  const updates: Array<{ previous: never[]; next: never[]; changed: never[] }> = [];
  let previous = renderCells;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const next = previous.slice();
    const slot = (iteration * 173) % size;
    next[slot] = { ...next[slot], tag: `bench-${iteration}` } as never;
    updates.push({ previous, next, changed: [next[slot]] });
    previous = next;
  }
  let gets = 0;
  const originalGet = slots.slotOf.get;
  slots.slotOf.get = function countedGet(id: number) {
    gets += 1;
    return originalGet.call(this, id);
  };
  const samples = measure(100, (iteration) => {
    const update = updates[iteration];
    syncCellSlots(slots, update.next, {
      previousCells: update.previous, removedIds: [], upserts: update.changed,
    });
  });
  emit('cell-slot-single-payload', {
    size, ...distribution(samples),
    operations: { mapGets: gets, immutablePublished: slots.published !== slots.cells },
    retiredSnapshotStable: oldPublished[0] === cells[0],
  });
}

ledger.resetFrameBudget();
ledger.beginFrameBudget();
ledger.reserveFrameBudget(ledger.FRAME_BUDGET_PLAN_SLICE, 4);
const drain = ledger.mayStartFrameWork(ledger.FRAME_BUDGET_FABRIC_DRAIN, 8);
if (drain) ledger.spendFrameBudget(ledger.FRAME_BUDGET_FABRIC_DRAIN, 8);
const bridge = ledger.mayStartFrameWork(ledger.FRAME_BUDGET_BRIDGE_STEP, 3);
if (bridge) ledger.spendFrameBudget(ledger.FRAME_BUDGET_BRIDGE_STEP, 3);
const plan = ledger.mayStartFrameWork(ledger.FRAME_BUDGET_PLAN_SLICE, 4);
if (plan) ledger.spendFrameBudget(ledger.FRAME_BUDGET_PLAN_SLICE, 4);
emit('frame-ledger-drain-bridge-plan', {
  size: 0, operations: { drain, bridge, plan }, ...ledger.snapshotFrameBudget(),
});

const motes = buildCohortMotesGeometry(64);
setCohortMotesDrawCount(motes, 7);
const gulp = motes.getAttribute('aGulp');
gulp.onUploadCallback();
stampCohortMotes(motes, 6, 1);
emit('cohort-mote-prefix-and-gulp', {
  size: 7,
  operations: {
    allocatedVertices: 64 * COHORT_MOTES_PER_COHORT,
    drawnVertices: motes.drawRange.count,
    gulpBytes: gulp.updateRanges.reduce((sum, range) => sum + range.count * 4, 0),
  },
});
motes.dispose();
