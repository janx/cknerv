import { describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  createNeighborGraphBuilder,
  neighborGraphBuilderStats,
  TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS,
} from '../../src/geometry/neighborGraphBuilder';
import {
  createNeighborGraphWorkerSession,
  executeNeighborGraphWorkerRequest,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from '../../src/geometry/neighborGraphWorkerProtocol';
import {
  consumeTopologyJournal,
  createTopologyJournal,
  type TopologyJournal,
} from '../../src/geometry/topologyJournal';

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

    expect(second!.graph).not.toBe(first!.graph);
    expect(second!.graph).toEqual(first!.graph);
    for (const [id, neighbours] of first!.graph.adjacency) {
      expect(second!.graph.adjacency.get(id)).toBe(neighbours);
    }
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
    // The newest build still completes — synchronously, off the dead worker.
    const result = await second;
    expect(result?.graph.adjacency.size).toBe(6);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].posted).toHaveLength(1);

    // The cleared queue stays cleared: the next build gets a fresh worker
    // and dispatches immediately.
    const third = builder.build(cells(20), { topology: { k: 2 } });
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);
    workers[1].complete();
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

      // A later build is served by a fresh worker, and the watchdog it arms
      // is cleared by the answer.
      const third = builder.build(cells(20), topologyOptions);
      expect(workers).toHaveLength(2);
      workers[1].complete();
      expect((await third)?.graph.adjacency.size).toBe(6);
      vi.advanceTimersByTime(TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS * 2);
      expect(workers[1].terminated).toBe(false);
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
