import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { createNeighborGraphBuilder } from '../../src/geometry/neighborGraphBuilder';
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
  it('terminates and resolves a superseded build as null', async () => {
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
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    workers[1].complete();
    const result = await second;
    expect([...result!.graph.adjacency.keys()]).toEqual([11, 12, 13, 14, 15, 16]);
    builder.dispose();
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
    });
    worker.onerror?.(new ErrorEvent('error'));
    const result = await pending;

    expect(result?.graph.adjacency.size).toBe(6);
    expect(result?.passiveGraph).not.toBeNull();
    expect(worker.terminated).toBe(true);
    builder.dispose();
  });
});
