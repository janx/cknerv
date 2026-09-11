import { describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  createNeighborGraphBuilder,
  neighborGraphBuilderStats,
  TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS,
} from '../../src/geometry/neighborGraphBuilder';
import type { NeighborGraphBuildResult } from '../../src/geometry/neighborGraphBuilder';
import {
  createNeighborGraphWorkerSession,
  deserializeNeighborAdjacency,
  deserializePassiveSelection,
  executeNeighborGraphWorkerRequest,
  packPreferredEdges,
  packTopologyCells,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from '../../src/geometry/neighborGraphWorkerProtocol';
import type { PassiveSelection } from '../../src/geometry/neighborGraph';
import { createBridgeHostRegistry, syncBridgeHosts } from '../../src/geometry/bridgeEdges';
import {
  consumeTopologyJournal,
  createTopologyJournal,
  type TopologyJournal,
} from '../../src/geometry/topologyJournal';
import {
  resetNeighborGraphBuilderStats,
  snapshotNeighborGraphBuilderStats,
} from '../../src/geometry/neighborGraphBuilderStats';
import { snapshotFabricStats } from '../../src/nerve/fabricStats';
import {
  blockFrameStats,
  resetBlockFrameStats,
  snapshotBlockFrameStats,
} from '../../src/nerve/blockFrameStats';
import {
  PERFORMANCE_PROBE_LABELS,
  resetPerformanceProbe,
  retainPerformanceProbe,
  snapshotPerformanceProbe,
} from '../../src/tweaks/performanceProbeStore';

/** One cell of the shared lattice: index decides the position, so a birth
 *  lands where the k-NN actually links it. */
function cellAt(id: number, index: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [index * 2, 0, index % 2],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 1,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${id}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function cells(offset = 0): Map<number, Cell> {
  const entries: Array<[number, Cell]> = [];
  for (let index = 0; index < 6; index += 1) {
    const id = offset + index + 1;
    entries.push([id, cellAt(id, index)]);
  }
  return new Map(entries);
}

/** A journal already chaining, as the feed leaves it after one consume. */
function chainedJournal(): TopologyJournal {
  const journal = createTopologyJournal();
  journal.valid = true;
  return journal;
}

class FakeWorker {
  onmessage: ((event: MessageEvent<NeighborGraphWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  request: NeighborGraphWorkerRequest | null = null;
  terminated = false;

  postMessage(message: NeighborGraphWorkerRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  complete(): void {
    if (!this.request) throw new Error('missing Worker request');
    const response = executeNeighborGraphWorkerRequest(this.request);
    this.onmessage?.({ data: response } as MessageEvent<NeighborGraphWorkerResponse>);
  }
}

class CountingFakeWorker extends FakeWorker {
  posted: NeighborGraphWorkerRequest[] = [];

  override postMessage(message: NeighborGraphWorkerRequest): void {
    this.posted.push(message);
    super.postMessage(message);
  }
}

/** `FakeWorker` with the real transfer semantics: every buffer in the
 *  transfer list detaches on the sender's side, so a request that reuses a
 *  previously transferred buffer fails to clone exactly as in a browser. */
class TransferringFakeWorker extends FakeWorker {
  override postMessage(
    message: NeighborGraphWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.request = structuredClone(message, { transfer });
  }

  replyStale(): void {
    if (!this.request) throw new Error('missing Worker request');
    this.onmessage?.({
      data: { kind: 'stale', requestId: this.request.requestId },
    } as MessageEvent<NeighborGraphWorkerResponse>);
  }
}

/** The fake the chain-integrity tests need: a REAL stateful session behind
 *  real transfer semantics. `executeNeighborGraphWorkerRequest` answers every
 *  message from scratch, so it can never disagree with the builder's
 *  generation bookkeeping — which is precisely what these tests are about. */
class SessionFakeWorker extends FakeWorker {
  posted: NeighborGraphWorkerRequest[] = [];
  private readonly session = createNeighborGraphWorkerSession();

  override postMessage(
    message: NeighborGraphWorkerRequest,
    transfer: Transferable[] = [],
  ): void {
    this.posted.push(message);
    this.request = structuredClone(message, { transfer });
  }

  override complete(): void {
    if (!this.request) throw new Error('missing Worker request');
    this.onmessage?.({
      data: this.session.execute(this.request),
    } as MessageEvent<NeighborGraphWorkerResponse>);
  }

  replyFailed(message = 'worker threw'): void {
    if (!this.request) throw new Error('missing Worker request');
    this.onmessage?.({
      data: { kind: 'failed', requestId: this.request.requestId, message },
    } as MessageEvent<NeighborGraphWorkerResponse>);
  }

  replyStale(): void {
    if (!this.request) throw new Error('missing Worker request');
    this.onmessage?.({
      data: { kind: 'stale', requestId: this.request.requestId },
    } as MessageEvent<NeighborGraphWorkerResponse>);
  }
}

describe('createNeighborGraphBuilder', () => {
  it('resolves a superseded build null and keeps the worker alive', async () => {
    const workers: FakeWorker[] = [];
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });

    const first = builder.build(cells(), { topology: { k: 2 } });
    const second = builder.build(cells(10), { topology: { k: 2 } });

    expect(await first).toBeNull();
    // The worker session survives supersession — its retained previous build
    // powers incremental responses; only dispose/failure terminates it.
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    // First completion answers the superseded request and frees the worker;
    // the coalesced second request goes out only then.
    workers[0].complete();
    workers[0].complete();
    const result = await second;
    expect([...result!.graph.adjacency.keys()]).toEqual([11, 12, 13, 14, 15, 16]);
    builder.dispose();
    expect(workers[0].terminated).toBe(true);
  });

  it('falls back to the canonical synchronous builder after a Worker error', async () => {
    const worker = new FakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });

    const pending = builder.build(cells(), {
      topology: { k: 2 },
      includePassive: true,
      passiveEdgeBudget: 3,
    });
    worker.onerror?.(new ErrorEvent('error'));
    const result = await pending;

    expect(result?.graph.adjacency.size).toBe(6);
    expect(result?.passiveGraph).not.toBeNull();
    expect(result?.passiveGraph?.edges).toHaveLength(3);
    expect(worker.terminated).toBe(true);
    builder.dispose();
  });

  it('counts worker fallbacks instead of failing silently', async () => {
    const before = neighborGraphBuilderStats.workerFallbacks;
    const worker = new FakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const pending = builder.build(cells(), { topology: { k: 2 } });
    worker.onerror?.(new ErrorEvent('error'));
    await pending;
    expect(neighborGraphBuilderStats.workerFallbacks).toBe(before + 1);
    builder.dispose();
  });

  it('recovers a construction failure behind a real task boundary', async () => {
    const before = snapshotNeighborGraphBuilderStats();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
    });
    let settled = false;
    const pending = builder.build(cells(), {
      topology: { k: 2 }, includePassive: true, passiveEdgeBudget: 3,
    }).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    // Promise microtasks cannot drain the recovery; at least one browser task
    // boundary is crossed before canonical work starts.
    expect(settled).toBe(false);
    const result = await pending;
    expect(result?.graph.adjacency.size).toBe(6);
    expect(result?.passiveGraph?.edges).toHaveLength(3);
    expect(snapshotNeighborGraphBuilderStats().recoveryCompleted)
      .toBe(before.recoveryCompleted + 1);
    builder.dispose();
  });

  it('cancels a sliced recovery when a newer generation replaces it', async () => {
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
    });
    const first = builder.build(cells(), { topology: { k: 2 } });
    const second = builder.build(cells(10), { topology: { k: 2 } });
    expect(await first).toBeNull();
    expect([...(await second)!.graph.adjacency.keys()])
      .toEqual([11, 12, 13, 14, 15, 16]);
    expect(snapshotNeighborGraphBuilderStats().recoveryCancelled).toBeGreaterThan(0);
    builder.dispose();
  });

  it('retains only one paused recovery task across supersede and dispose', async () => {
    const before = snapshotNeighborGraphBuilderStats();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
      recoveryBudgetMs: () => 0,
    });
    const first = builder.build(cells(), { topology: { k: 2 } });
    expect(snapshotNeighborGraphBuilderStats().recoveryPendingTasks)
      .toBe(before.recoveryPendingTasks + 1);
    const second = builder.build(cells(10), { topology: { k: 2 } });
    expect(await first).toBeNull();
    expect(snapshotNeighborGraphBuilderStats().recoveryPendingTasks)
      .toBe(before.recoveryPendingTasks + 1);
    builder.dispose();
    expect(await second).toBeNull();
    const after = snapshotNeighborGraphBuilderStats();
    expect(after.recoveryPendingTasks).toBe(before.recoveryPendingTasks);
    expect(after.recoveryMaxPendingTasks).toBeLessThanOrEqual(
      Math.max(before.recoveryMaxPendingTasks, before.recoveryPendingTasks + 1),
    );
  });

  it('recovers from the immutable cells captured for the requested generation', async () => {
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => { throw new Error('constructor failed'); },
    });
    const staged = cells();
    const recoveryCells = [...staged.values()];
    const pending = builder.build(staged, {
      topology: { k: 2 }, recoveryCells,
    });
    // The next cache message patches the stage Map before the recovery task
    // gets CPU time. Its older requested generation must remain coherent.
    staged.delete(6);
    staged.set(7, cellAt(7, 6));
    expect([...(await pending)!.graph.adjacency.keys()])
      .toEqual([1, 2, 3, 4, 5, 6]);
    builder.dispose();
  });

  it('threads reuseFrom into the deserializer so unchanged Sets survive', async () => {
    const worker = new FakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });

    const firstPending = builder.build(cells(), { topology: { k: 2 } });
    worker.complete();
    const first = await firstPending;
    expect(first).not.toBeNull();

    const secondPending = builder.build(cells(), {
      topology: { k: 2 },
      reuseFrom: () => ({ graph: first!.graph, passiveGraph: null }),
    });
    worker.complete();
    const second = await secondPending;

    // A one-shot session has no previous build, so this is the whole-graph
    // path: a new object whose unchanged Sets are still the old instances.
    expect(second!.graph).not.toBe(first!.graph);
    expect(second!.graph).toEqual(first!.graph);
    for (const [id, neighbours] of first!.graph.adjacency) {
      expect(second!.graph.adjacency.get(id)).toBe(neighbours);
    }
    builder.dispose();
  });

  /** The steady state of a live session: the response carries only the
   *  change set, and the builder applies it to the very graph the caller
   *  holds — no 12K-entry Map, no edge list, no per-node probe. */
  it('patches the held display graph in place when the session chains', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const patchedBefore = neighborGraphBuilderStats.patchedApplies;
    const fullBefore = neighborGraphBuilderStats.fullApplies;
    const unchainedBefore = neighborGraphBuilderStats.unchainedApplies;
    const held: { graph: NeighborGraphBuildResult['graph'] | null } = { graph: null };
    const reuseFrom = () => ({ graph: held.graph, passiveGraph: null });

    const firstPending = builder.build(cells(), { topology: { k: 2 }, reuseFrom });
    expect(worker.posted[0].patchBaseGeneration).toBe(0);
    worker.complete();
    const first = await firstPending;
    held.graph = first!.graph;
    expect(neighborGraphBuilderStats.fullApplies).toBe(fullBefore + 1);

    const staged = cells();
    staged.set(7, cellAt(7, 6));
    const journal = chainedJournal();
    journal.upserts.set(7, staged.get(7)!);
    const secondPending = builder.build(staged, {
      topology: { k: 2 },
      reuseFrom,
      cellsJournal: consumeTopologyJournal(journal),
    });
    // The request names the applied generation, so the session answers
    // with a patch against it.
    expect(worker.posted[1].patchBaseGeneration).toBe(1);
    worker.complete();
    const second = await secondPending;

    expect(second!.graph).toBe(first!.graph);
    expect(neighborGraphBuilderStats.patchedApplies).toBe(patchedBefore + 1);
    expect(neighborGraphBuilderStats.unchainedApplies).toBe(unchainedBefore);
    const fresh = executeNeighborGraphWorkerRequest({
      kind: 'build',
      requestId: 99,
      cells: packTopologyCells(staged),
      cellsDelta: null,
      patchBaseGeneration: 0,
      options: { k: 2 },
      includePassive: false,
      passiveEdgeBudget: null,
      passiveTuning: null,
      preferredEdges: null,
    });
    if (fresh.graph.kind !== 'full') throw new Error('expected full');
    const truth = deserializeNeighborAdjacency(fresh.graph.adjacency);
    expect([...second!.graph.adjacency.keys()].sort((a, b) => a - b))
      .toEqual([...truth.adjacency.keys()].sort((a, b) => a - b));
    for (const [id, neighbours] of truth.adjacency) {
      expect([...second!.graph.adjacency.get(id)!]).toEqual([...neighbours]);
    }
    expect(second!.graph.eagerBase.size).toBe(0);
    builder.dispose();
  });

  /** The passive selection follows the display graph: a chained response
   *  merges the worker's patch into the very selection the caller holds
   *  (same object, same array, in order), and the delta the fabric grows
   *  and kills from is that same patch, in the list's own records. */
  it('patches the held passive selection in place when the session chains, with the fabric delta and the bridge degrees of a whole build', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const patchedBefore = neighborGraphBuilderStats.passivePatchedApplies;
    const fullBefore = neighborGraphBuilderStats.passiveFullApplies;
    const held: {
      graph: NeighborGraphBuildResult['graph'] | null;
      passiveGraph: PassiveSelection | null;
    } = { graph: null, passiveGraph: null };
    const reuseFrom = () => ({ graph: held.graph, passiveGraph: held.passiveGraph });
    const passiveOptions = {
      topology: { k: 2 },
      includePassive: true,
      passiveEdgeBudget: 4,
      reuseFrom,
    };

    const firstPending = builder.build(cells(), passiveOptions);
    worker.complete();
    const first = await firstPending;
    held.graph = first!.graph;
    held.passiveGraph = first!.passiveGraph;
    expect(first!.passiveGraph!.edges).toHaveLength(4);
    expect(first!.passiveDelta).toBeNull();
    expect(neighborGraphBuilderStats.passiveFullApplies).toBe(fullBefore + 1);
    const heldArray = first!.passiveGraph!.edges;
    const heldBefore = [...heldArray];

    const staged = cells();
    staged.set(7, cellAt(7, 6));
    staged.delete(1);
    const journal = chainedJournal();
    journal.upserts.set(7, staged.get(7)!);
    journal.removedIds.add(1);
    const secondPending = builder.build(staged, {
      ...passiveOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    worker.complete();
    const second = await secondPending;

    expect(second!.passiveGraph).toBe(first!.passiveGraph);
    expect(second!.passiveGraph!.edges).toBe(heldArray);
    expect(neighborGraphBuilderStats.passivePatchedApplies).toBe(patchedBefore + 1);
    expect(neighborGraphBuilderStats.passiveFullApplies).toBe(fullBefore + 1);
    const delta = second!.passiveDelta;
    expect(delta).not.toBeNull();
    expect(delta!.added.length + delta!.removed.length).toBeGreaterThan(0);

    // The whole selection the session would have shipped: the same cells,
    // the same budget, its previous selection as the continuity preference.
    const truth = executeNeighborGraphWorkerRequest({
      kind: 'build',
      requestId: 99,
      cells: packTopologyCells(staged),
      cellsDelta: null,
      patchBaseGeneration: 0,
      options: { k: 2 },
      includePassive: true,
      passiveEdgeBudget: 4,
      passiveTuning: null,
      preferredEdges: packPreferredEdges(heldBefore),
    });
    if (truth.passiveGraph?.kind !== 'full') throw new Error('expected a whole selection');
    const whole = deserializePassiveSelection(truth.passiveGraph);
    expect(heldArray).toEqual(whole.edges);
    // The fabric's kills are the records the list dropped, its grows the
    // records the list now holds.
    for (const edge of delta!.removed) {
      expect(heldBefore).toContain(edge);
      expect(heldArray).not.toContain(edge);
    }
    for (const edge of delta!.added) {
      expect(heldBefore).not.toContain(edge);
      expect(heldArray).toContain(edge);
    }
    // The bridges count the same host degrees off either list.
    const degreesOf = (selection: PassiveSelection) => {
      const registry = createBridgeHostRegistry();
      syncBridgeHosts(registry, staged, selection.edges);
      return [...registry.hosts.values()].map((host) => [host.id, host.degree]);
    };
    expect(degreesOf(second!.passiveGraph!)).toEqual(degreesOf(whole));
    builder.dispose();
  });

  /** A caller that reuses its display graph but withholds its selection
   *  cannot be handed a passive patch: the builder refuses it, untouched,
   *  into the counted synchronous fallback rather than merging it into
   *  nothing. */
  it('falls back, counted, when a passive patch arrives without its base selection', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const fallbacksBefore = neighborGraphBuilderStats.workerFallbacks;
    const held: { graph: NeighborGraphBuildResult['graph'] | null } = { graph: null };
    const reuseFrom = () => ({ graph: held.graph, passiveGraph: null });
    const options = {
      topology: { k: 2 },
      includePassive: true,
      passiveEdgeBudget: 4,
      reuseFrom,
    };

    const firstPending = builder.build(cells(), options);
    worker.complete();
    held.graph = (await firstPending)!.graph;

    const secondPending = builder.build(cells(), {
      ...options,
      cellsJournal: consumeTopologyJournal(chainedJournal()),
    });
    worker.complete();
    const second = await secondPending;
    expect(neighborGraphBuilderStats.workerFallbacks).toBe(fallbacksBefore + 1);
    expect(worker.terminated).toBe(true);
    expect(second!.passiveGraph!.edges).toHaveLength(4);
    expect(second!.passiveDelta).toBeNull();
    builder.dispose();
  });

  /** Without `reuseFrom` there is no graph to patch, so the builder must
   *  never let the session answer with one. */
  it('asks for whole graphs when the caller cannot patch', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const options = { topology: { k: 2 }, includePassive: true, passiveEdgeBudget: 4 };
    const first = builder.build(cells(), options);
    worker.complete();
    expect(await first).not.toBeNull();
    const second = builder.build(cells(), options);
    expect(worker.posted[1].patchBaseGeneration).toBe(0);
    worker.complete();
    const result = await second;
    expect(result!.graph.adjacency.size).toBe(6);
    // The selection arrives whole too, with no delta to apply.
    expect(result!.passiveGraph!.edges).toHaveLength(4);
    expect(result!.passiveDelta).toBeNull();
    builder.dispose();
  });

  /** A superseded build advances the session without an apply: the next
   *  response cannot chain, so it comes back whole and is counted as the
   *  chain break it is. */
  it('counts unchained whole applies and stale resends', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const unchainedBefore = neighborGraphBuilderStats.unchainedApplies;
    const staleBefore = neighborGraphBuilderStats.staleResends;
    const held: { graph: NeighborGraphBuildResult['graph'] | null } = { graph: null };
    const reuseFrom = () => ({ graph: held.graph, passiveGraph: null });

    const first = builder.build(cells(), { topology: { k: 2 }, reuseFrom });
    worker.complete();
    held.graph = (await first)!.graph;

    const journal = chainedJournal();
    const second = builder.build(cells(), {
      topology: { k: 2 }, reuseFrom, cellsJournal: consumeTopologyJournal(journal),
    });
    const third = builder.build(cells(10), {
      topology: { k: 2 }, reuseFrom, cellsJournal: consumeTopologyJournal(journal),
    });
    // The superseded delta executes in the session (generation 2, never
    // applied); the queued build's delta then names generation 1 → stale →
    // full re-pack → generation 3, which does not chain from 1.
    worker.complete();
    expect(await second).toBeNull();
    worker.complete();
    expect(neighborGraphBuilderStats.staleResends).toBe(staleBefore + 1);
    worker.complete();
    const result = await third;
    expect(result!.graph).not.toBe(held.graph);
    expect([...result!.graph.adjacency.keys()]).toEqual([11, 12, 13, 14, 15, 16]);
    expect(neighborGraphBuilderStats.unchainedApplies).toBe(unchainedBefore + 1);
    builder.dispose();
  });

  /** A real Worker DETACHES every transferred buffer on the sending side.
   *  The stale-resend re-sends the same request shape, so anything it
   *  carries must be re-packed — a detached buffer makes `postMessage`
   *  throw `DataCloneError`, and the silent catch turns that into a
   *  synchronous main-thread rebuild of the whole display graph. Measured
   *  live as 400-800ms blocking tasks once the display plane made delta
   *  requests (and therefore `stale` replies) reachable. */
  it('survives a stale reply after transferring the preferred-edge buffer', async () => {
    const before = neighborGraphBuilderStats.workerFallbacks;
    const worker = new TransferringFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const passiveOptions = {
      topology: { k: 2 },
      includePassive: true,
      passiveEdgeBudget: 3,
      preferredEdges: [
        { from: 1, to: 2, d: 2 },
        { from: 2, to: 3, d: 2 },
      ],
    };

    // Chain a generation so the next build is eligible to send a delta.
    const firstPending = builder.build(cells(), passiveOptions);
    worker.complete();
    expect(await firstPending).not.toBeNull();

    const journal = createTopologyJournal();
    journal.valid = true;
    journal.upserts.set(7, {
      id: 7,
      pos_seed: [9, 0, 1],
    } as unknown as Cell);
    const secondPending = builder.build(cells(), {
      ...passiveOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    expect(worker.request?.cellsDelta).not.toBeNull();

    // The session rejects the delta (superseded generation) and asks for a
    // full pack; the resend must reach the worker, not the fallback.
    worker.replyStale();
    expect(worker.request?.cells).not.toBeNull();
    worker.complete();
    const second = await secondPending;

    expect(second).not.toBeNull();
    expect(second!.graph.adjacency.size).toBe(6);
    expect(neighborGraphBuilderStats.workerFallbacks).toBe(before);
    builder.dispose();
  });
});

describe('createNeighborGraphBuilder (coalesced sends)', () => {
  it('keeps at most one request in the worker and posts only the newest waiter', async () => {
    const worker = new CountingFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });

    const first = builder.build(cells(), { topology: { k: 2 } });
    // Worker is busy with the first request: neither superseding build may
    // reach it yet, and the middle one must never reach it at all.
    const second = builder.build(cells(10), { topology: { k: 2 } });
    const third = builder.build(cells(20), { topology: { k: 2 } });
    expect(worker.posted).toHaveLength(1);

    expect(await first).toBeNull();
    expect(await second).toBeNull();

    // The superseded response frees the worker; only the NEWEST build's
    // request follows it.
    worker.complete();
    expect(worker.posted).toHaveLength(2);
    worker.complete();
    const result = await third;
    expect([...result!.graph.adjacency.keys()]).toEqual([21, 22, 23, 24, 25, 26]);
    // The middle build's request was never packed or posted.
    expect(worker.posted.map((request) => request.requestId)).toEqual([1, 3]);
    builder.dispose();
  });

  it('a worker error with a queued send falls back the newest build and clears the queue', async () => {
    const workers: CountingFakeWorker[] = [];
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => {
        const worker = new CountingFakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });

    const first = builder.build(cells(), { topology: { k: 2 } });
    const second = builder.build(cells(10), { topology: { k: 2 } });
    workers[0].onerror?.(new ErrorEvent('error'));

    expect(await first).toBeNull();
    // The newest build still completes cooperatively off the dead worker.
    const result = await second;
    expect(result?.graph.adjacency.size).toBe(6);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].posted).toHaveLength(1);

    // The cleared queue stays cleared. A bounded retry backoff keeps the next
    // delta on canonical recovery instead of reconstructing a worker in a
    // failure loop.
    const third = builder.build(cells(20), { topology: { k: 2 } });
    expect(workers).toHaveLength(1);
    expect((await third)?.graph.adjacency.size).toBe(6);
    builder.dispose();
  });
});

// The worker session's retained cell map is patched by deltas that name only
// a base GENERATION. Every path that applies a build the session did not
// produce — or that leaves the session's own state in doubt — has to break
// that chain, or the next delta patches a baseline nobody ever saw.
describe('createNeighborGraphBuilder (worker session chain integrity)', () => {
  const topologyOptions = { topology: { k: 2 } };

  /** The sync fallback below the worker threshold builds on the MAIN thread
   *  while the caller's journal window is consumed and discarded. Leaving the
   *  chain intact let the next delta patch a baseline that skipped that
   *  window: cells removed during the sync build survived as ghost nodes in
   *  the authoritative graph until an unrelated chain break. */
  it('breaks the chain when a build falls below the worker threshold', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 6,
      workerFactory: () => worker as unknown as Worker,
    });
    const journal = chainedJournal();

    // Generation 1: the session's retained baseline is cells 1..6.
    const first = builder.build(cells(), topologyOptions);
    worker.complete();
    expect((await first)?.graph.adjacency.has(6)).toBe(true);

    // Cell 6 leaves. Five staged cells is below the threshold, so this build
    // never reaches the worker — but its journal window is gone.
    const staged = cells();
    staged.delete(6);
    journal.removedIds.add(6);
    const shrunk = await builder.build(staged, {
      ...topologyOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    expect(shrunk?.graph.adjacency.has(6)).toBe(false);
    expect(worker.posted).toHaveLength(1);

    // A birth pushes the staged set back over the threshold.
    staged.set(7, cellAt(7, 6));
    journal.upserts.set(7, staged.get(7)!);
    const grown = builder.build(staged, {
      ...topologyOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    // A delta here would chain from generation 1 and re-admit cell 6.
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1].cellsDelta).toBeNull();
    expect(worker.posted[1].cells).not.toBeNull();
    worker.complete();
    const result = await grown;
    expect(result!.graph.adjacency.has(6)).toBe(false);
    expect([...result!.graph.adjacency.keys()].sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 7]);
    builder.dispose();
  });

  /** A `failed` for a superseded request is not the newest build's problem,
   *  but the session may have thrown halfway through applying that delta
   *  (removals in, upserts not) — the retained baseline is suspect even
   *  though its generation never advanced. */
  it('keeps the session but breaks the chain when a superseded request fails', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const journal = chainedJournal();

    const first = builder.build(cells(), topologyOptions);
    worker.complete();
    expect(await first).not.toBeNull();

    const second = builder.build(cells(), {
      ...topologyOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    const third = builder.build(cells(), {
      ...topologyOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1].cellsDelta).not.toBeNull();

    worker.replyFailed('invalid packed topology delta buffer');
    expect(await second).toBeNull();

    // The worker lives on — one failed request is not a dead thread — and
    // the queued build follows it with a full pack, not a delta.
    expect(worker.terminated).toBe(false);
    expect(worker.posted).toHaveLength(3);
    expect(worker.posted[2].cellsDelta).toBeNull();
    worker.complete();
    expect((await third)?.graph.adjacency.size).toBe(6);
    builder.dispose();
  });

  /** `stale` for a superseded request carries no result at all; its only job
   *  is freeing the worker. Without the flush the queued build would wait
   *  forever behind an in-flight slot nobody will ever clear. */
  it('flushes the queued send when a superseded request comes back stale', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const journal = chainedJournal();

    const first = builder.build(cells(), topologyOptions);
    worker.complete();
    expect(await first).not.toBeNull();

    const second = builder.build(cells(), {
      ...topologyOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    const third = builder.build(cells(20), topologyOptions);
    worker.replyStale();

    expect(await second).toBeNull();
    expect(worker.posted).toHaveLength(3);
    worker.complete();
    expect([...(await third)!.graph.adjacency.keys()])
      .toEqual([21, 22, 23, 24, 25, 26]);
    builder.dispose();
  });

  /** A worker killed silently answers nothing, and the single in-flight slot
   *  is the gate for every later send — without the watchdog the topology
   *  freezes for the rest of the session. */
  it('falls back synchronously when the worker never answers', async () => {
    vi.useFakeTimers();
    try {
      const timeoutsBefore = neighborGraphBuilderStats.workerTimeouts;
      const workers: CountingFakeWorker[] = [];
      const builder = createNeighborGraphBuilder({
        minWorkerCells: 0,
        workerFactory: () => {
          const worker = new CountingFakeWorker();
          workers.push(worker);
          return worker as unknown as Worker;
        },
      });

      const first = builder.build(cells(), topologyOptions);
      const second = builder.build(cells(10), topologyOptions);
      expect(await first).toBeNull();
      expect(workers[0].posted).toHaveLength(1);

      vi.advanceTimersByTime(TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS - 1);
      expect(workers[0].terminated).toBe(false);
      vi.advanceTimersByTime(1);

      // The newest build completes off the dead worker, and the queued slot
      // died with it.
      expect((await second)?.graph.adjacency.size).toBe(6);
      expect(workers[0].terminated).toBe(true);
      expect(workers[0].posted).toHaveLength(1);
      expect(neighborGraphBuilderStats.workerTimeouts).toBe(timeoutsBefore + 1);

      // The immediate next build stays on recovery during retry backoff.
      const third = builder.build(cells(20), topologyOptions);
      expect(workers).toHaveLength(1);
      expect((await third)?.graph.adjacency.size).toBe(6);
      vi.advanceTimersByTime(TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS * 2);
      expect(neighborGraphBuilderStats.workerTimeouts).toBe(timeoutsBefore + 1);
      builder.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  /** `releaseWorker` is the unmount path: the Worker thread and its session
   *  end, the builder does not. Strict Mode replays setup→cleanup→setup
   *  against the same instance, so a terminal dispose there would leave the
   *  remounted galaxy with no topology at all. */
  it('releases the worker on unmount while staying usable', async () => {
    const workers: SessionFakeWorker[] = [];
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => {
        const worker = new SessionFakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });

    const first = builder.build(cells(), topologyOptions);
    workers[0].complete();
    expect(await first).not.toBeNull();

    builder.releaseWorker();
    expect(workers[0].terminated).toBe(true);

    const journal = chainedJournal();
    journal.upserts.set(7, cellAt(7, 6));
    const second = builder.build(cells(), {
      ...topologyOptions,
      cellsJournal: consumeTopologyJournal(journal),
    });
    // Fresh worker, fresh session: the request must be a full pack, since
    // the dead session's generations mean nothing to it.
    expect(workers).toHaveLength(2);
    expect(workers[1].posted[0].cellsDelta).toBeNull();
    workers[1].complete();
    expect((await second)?.graph.adjacency.size).toBe(6);
    builder.dispose();
  });

  /** The session prefers its own previous passive selection and reads
   *  `preferredEdges` only while it has none, so re-packing the fabric's
   *  edges into every build was pure wire cost. */
  it('sends continuity edges only while the session has no selection of its own', async () => {
    const worker = new SessionFakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const passiveOptions = {
      ...topologyOptions,
      includePassive: true,
      passiveEdgeBudget: 3,
      preferredEdges: [{ from: 1, to: 2, d: 2 }],
    };

    const first = builder.build(cells(), passiveOptions);
    expect(worker.posted[0].preferredEdges).not.toBeNull();
    worker.complete();
    expect(await first).not.toBeNull();

    const second = builder.build(cells(), passiveOptions);
    expect(worker.posted[1].preferredEdges).toBeNull();
    worker.complete();
    expect(await second).not.toBeNull();

    // A fresh session has no selection to prefer, so the edges ride again.
    builder.releaseWorker();
    const third = builder.build(cells(), passiveOptions);
    expect(worker.posted[2].preferredEdges).not.toBeNull();
    builder.dispose();
    expect(await third).toBeNull();
  });
});

describe('builder diagnostics', () => {
  it('spans the main-thread apply of a worker response under the opt-in probe', async () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const worker = new FakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    try {
      const pending = builder.build(cells(), { topology: { k: 2 } });
      // Nothing is spanned until the response lands: the worker's own time
      // is not main-thread time.
      expect(snapshotPerformanceProbe().cpu).toEqual({});
      worker.complete();
      expect(await pending).not.toBeNull();
      const commit = snapshotPerformanceProbe().cpu[PERFORMANCE_PROBE_LABELS.topologyCommit];
      expect(commit).toBeDefined();
      expect(commit.count).toBe(1);
      expect(commit.lastMs).toBeGreaterThanOrEqual(0);
    } finally {
      builder.dispose();
      release();
      resetPerformanceProbe(1);
    }
  });

  /** The block-frame gauge's landing mark opens at this handler's entry and
   *  is closed by the consumer's `.then` — a microtask of the same task. What
   *  the builder owes it is the other half: every path that applies NOTHING
   *  has to clear the mark, or the next landing is measured from a task it
   *  never belonged to. `observeLanding` records only against an open mark,
   *  so the counter answers "did this path leave one behind?" directly. */
  describe('the block-frame landing mark', () => {
    it('is left open by an applied response for the consumer to close', async () => {
      resetBlockFrameStats();
      const worker = new FakeWorker();
      const builder = createNeighborGraphBuilder({
        minWorkerCells: 0,
        workerFactory: () => worker as unknown as Worker,
      });
      const pending = builder.build(cells(), { topology: { k: 2 } });
      worker.complete();
      expect(await pending).not.toBeNull();
      blockFrameStats.observeLanding();
      const snapshot = snapshotBlockFrameStats();
      expect(snapshot.count).toBe(1);
      expect(snapshot.recent[0].landingMs).toBeGreaterThanOrEqual(0);
      builder.dispose();
      resetBlockFrameStats();
    });

    it('is cleared by a stale reply, whose only work is a re-send', async () => {
      resetBlockFrameStats();
      const worker = new TransferringFakeWorker();
      const builder = createNeighborGraphBuilder({
        minWorkerCells: 0,
        workerFactory: () => worker as unknown as Worker,
      });
      const pending = builder.build(cells(), {
        topology: { k: 2 },
        includePassive: true,
        preferredEdges: [{ from: 1, to: 2, d: 2 }],
      });
      worker.replyStale();
      blockFrameStats.observeLanding();
      expect(snapshotBlockFrameStats().count).toBe(0);
      worker.complete();
      expect(await pending).not.toBeNull();
      builder.dispose();
      resetBlockFrameStats();
    });

    it('is cleared by a superseded response, which only frees the worker', async () => {
      resetBlockFrameStats();
      const worker = new FakeWorker();
      const builder = createNeighborGraphBuilder({
        minWorkerCells: 0,
        workerFactory: () => worker as unknown as Worker,
      });
      const first = builder.build(cells(), { topology: { k: 2 } });
      const second = builder.build(cells(10), { topology: { k: 2 } });
      expect(await first).toBeNull();
      // Answers request #1 while #2 is the active build.
      worker.complete();
      blockFrameStats.observeLanding();
      expect(snapshotBlockFrameStats().count).toBe(0);
      worker.complete();
      expect(await second).not.toBeNull();
      builder.dispose();
      resetBlockFrameStats();
    });

    it('is cleared by a failed reply, which falls back synchronously', async () => {
      resetBlockFrameStats();
      const worker = new SessionFakeWorker();
      const builder = createNeighborGraphBuilder({
        minWorkerCells: 0,
        workerFactory: () => worker as unknown as Worker,
      });
      const pending = builder.build(cells(), { topology: { k: 2 } });
      worker.replyFailed();
      expect(await pending).not.toBeNull();
      blockFrameStats.observeLanding();
      expect(snapshotBlockFrameStats().count).toBe(0);
      builder.dispose();
      resetBlockFrameStats();
    });
  });

  it('carries its counters on the fabric snapshot, in their own module, with a reset', async () => {
    resetNeighborGraphBuilderStats();
    expect(snapshotNeighborGraphBuilderStats()).toMatchObject({
      fullApplies: 0,
      patchedApplies: 0,
      unchainedApplies: 0,
      staleResends: 0,
      workerFallbacks: 0,
    });
    const worker = new FakeWorker();
    const builder = createNeighborGraphBuilder({
      minWorkerCells: 0,
      workerFactory: () => worker as unknown as Worker,
    });
    const pending = builder.build(cells(), { topology: { k: 2 } });
    worker.complete();
    await pending;
    builder.dispose();
    // The builder mutates the shared object; the fabric's window hook reads
    // a copy of it beside the bridge's counters.
    expect(neighborGraphBuilderStats.fullApplies).toBe(1);
    expect(snapshotFabricStats().topology).toEqual(snapshotNeighborGraphBuilderStats());
    expect(snapshotFabricStats().topology.fullApplies).toBe(1);
    resetNeighborGraphBuilderStats();
    expect(neighborGraphBuilderStats.fullApplies).toBe(0);
  });
});
