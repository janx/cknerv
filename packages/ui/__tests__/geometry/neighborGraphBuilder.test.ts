import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  createNeighborGraphBuilder,
  neighborGraphBuilderStats,
} from '../../src/geometry/neighborGraphBuilder';
import {
  executeNeighborGraphWorkerRequest,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from '../../src/geometry/neighborGraphWorkerProtocol';

function cells(offset = 0): Map<number, Cell> {
  const entries: Array<[number, Cell]> = [];
  for (let index = 0; index < 6; index += 1) {
    const id = offset + index + 1;
    entries.push([id, {
      id,
      born_at_ms: 0,
      death_at_ms: null,
      birth_block: 1,
      tag: null,
      pos_seed: [index * 2, 0, index % 2],
      out_point: { tx_hash: `0x${id}`, index: 0 },
      capacity: 1,
      data_hex: '0x',
      content_hash: `0x${id}`,
    }]);
  }
  return new Map(entries);
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
});
