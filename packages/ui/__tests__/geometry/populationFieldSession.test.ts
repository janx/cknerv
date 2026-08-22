// The halo placement conversation, and what it does when the worker does not
// come back.
//
// The layer this serves is an R3F component and is not testable in jsdom, so
// the logic lives here instead. What is being pinned is a silent failure:
// before this session existed, a worker that errored left the placement store
// null for the life of the tab, and BOTH the halo and the bridge nerve tier
// (which anchors its far ends exclusively in that store) simply never
// appeared — no error, no warning, nothing to notice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginPopulationFieldPlacement,
  populationFieldSessionStats,
  resetPopulationFieldSessionWarning,
} from '../../src/geometry/populationFieldSession';
import type { PopulationPlacementSnapshot } from '../../src/geometry/populationPlacementStore';

/** A placement-shaped value. The buffers are never read here — what is under
 *  test is WHICH placement arrives and how many times, not its contents. */
function snapshot(count: number): PopulationPlacementSnapshot {
  return {
    positions: new Float32Array(count * 3),
    segments: new Uint32Array(0),
    backboneSegments: new Uint32Array(0),
    backboneSegmentCount: 0,
    residualSegments: new Uint32Array(0),
    residualSegmentCount: 0,
    backboneComponents: 0,
    weights: new Float32Array(count),
    count,
    segmentCount: 0,
    streamlines: 0,
    work: 0,
  };
}

const FALLBACK_COUNT = 7;
const WORKER_COUNT = 11;

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;

  onerror: ((event: unknown) => void) | null = null;

  onmessageerror: ((event: unknown) => void) | null = null;

  posted: unknown[] = [];

  terminated = 0;

  /** Set to throw from `postMessage`, the structured-clone failure path. */
  postThrows: Error | null = null;

  postMessage(message: unknown): void {
    if (this.postThrows) throw this.postThrows;
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** The reply the real worker sends. */
  reply(kind: string = 'placed'): void {
    this.onmessage?.({
      data: {
        kind,
        positions: new Float32Array(WORKER_COUNT * 3),
        segments: new Uint32Array(0),
        backboneSegments: new Uint32Array(0),
        backboneSegmentCount: 0,
        residualSegments: new Uint32Array(0),
        residualSegmentCount: 0,
        backboneComponents: 0,
        weights: new Float32Array(WORKER_COUNT),
        count: WORKER_COUNT,
        segmentCount: 0,
        streamlines: 0,
        work: 0,
      },
    } as unknown as MessageEvent);
  }
}

interface Harness {
  worker: FakeWorker;
  placed: PopulationPlacementSnapshot[];
  syncCalls: { points: number; seed: number }[];
  session: { cancel(): void };
}

function start(): Harness {
  const worker = new FakeWorker();
  const placed: PopulationPlacementSnapshot[] = [];
  const syncCalls: { points: number; seed: number }[] = [];
  const session = beginPopulationFieldPlacement({
    worker: worker as unknown as Worker,
    request: { kind: 'place', points: 1234, seed: 0xabc },
    onPlaced: (placement) => { placed.push(placement); },
    placeSynchronously: (points, seed) => {
      syncCalls.push({ points, seed });
      return snapshot(FALLBACK_COUNT);
    },
  });
  return { worker, placed, syncCalls, session };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPopulationFieldSessionWarning();
  populationFieldSessionStats.workerFallbacks = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('populationFieldSession — the happy path', () => {
  it('delivers the worker placement and spends no main-thread pass', () => {
    const { worker, placed, syncCalls } = start();
    expect(worker.posted).toEqual([{ kind: 'place', points: 1234, seed: 0xabc }]);

    worker.reply();

    expect(placed).toHaveLength(1);
    expect(placed[0].count).toBe(WORKER_COUNT);
    expect(syncCalls).toEqual([]);
    expect(worker.terminated).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect(populationFieldSessionStats.workerFallbacks).toBe(0);
  });

  it('drops the reply when the mount is already gone', () => {
    const { worker, placed, syncCalls, session } = start();
    session.cancel();
    worker.reply();
    expect(placed).toEqual([]);
    expect(syncCalls).toEqual([]);
  });
});

describe('populationFieldSession — the worker cannot deliver', () => {
  it('falls back exactly once on error, and the store still receives a placement', () => {
    const { worker, placed, syncCalls } = start();

    worker.onerror?.(new Error('worker died'));

    expect(syncCalls).toEqual([{ points: 1234, seed: 0xabc }]);
    expect(placed).toHaveLength(1);
    expect(placed[0].count).toBe(FALLBACK_COUNT);
    expect(worker.terminated).toBe(1);
    expect(populationFieldSessionStats.workerFallbacks).toBe(1);
  });

  it('warns once, naming both layers that would otherwise vanish', () => {
    const { worker } = start();
    worker.onerror?.(new Error('worker died'));
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain('halo');
    expect(message).toContain('bridge nerve tier');
  });

  it('falls back on a deserialize failure', () => {
    const { worker, placed, syncCalls } = start();
    worker.onmessageerror?.(new Error('structured clone'));
    expect(syncCalls).toHaveLength(1);
    expect(placed[0].count).toBe(FALLBACK_COUNT);
  });

  it('falls back when postMessage itself throws', () => {
    const worker = new FakeWorker();
    worker.postThrows = new Error('detached buffer');
    const placed: PopulationPlacementSnapshot[] = [];
    let syncCalls = 0;
    beginPopulationFieldPlacement({
      worker: worker as unknown as Worker,
      request: { kind: 'place', points: 8, seed: 9 },
      onPlaced: (placement) => { placed.push(placement); },
      placeSynchronously: () => { syncCalls += 1; return snapshot(FALLBACK_COUNT); },
    });
    expect(syncCalls).toBe(1);
    expect(placed).toHaveLength(1);
  });

  it('falls back on a reply it cannot read', () => {
    const { worker, placed, syncCalls } = start();
    worker.reply('something-else');
    expect(syncCalls).toHaveLength(1);
    expect(placed[0].count).toBe(FALLBACK_COUNT);
  });

  it('ignores a worker that answers after the fallback already ran', () => {
    const { worker, placed, syncCalls } = start();

    worker.onerror?.(new Error('worker died'));
    // The real hazard: a worker that errored can still post. A second publish
    // would replace the buffers two layers are already drawing.
    worker.reply();

    expect(syncCalls).toHaveLength(1);
    expect(placed).toHaveLength(1);
    expect(placed[0].count).toBe(FALLBACK_COUNT);
  });

  it('does not fall back twice when both handlers fire', () => {
    const { worker, placed, syncCalls } = start();
    worker.onerror?.(new Error('first'));
    worker.onmessageerror?.(new Error('second'));
    expect(syncCalls).toHaveLength(1);
    expect(placed).toHaveLength(1);
    expect(populationFieldSessionStats.workerFallbacks).toBe(1);
  });

  it('does not place on the main thread for a mount that is already gone', () => {
    const { worker, placed, syncCalls, session } = start();
    session.cancel();
    worker.onerror?.(new Error('worker died'));
    expect(syncCalls).toEqual([]);
    expect(placed).toEqual([]);
  });

  // Every case above injects the fallback. This one does not: the REAL
  // composition — the walk, then the backbone partition over its finished
  // buffers — has to produce a snapshot the renderer can consume, or the
  // fallback would only trade a silent absence for a broken draw. Run at a
  // small point count; the composition is what is under test, not the size.
  it('the default fallback composes a placement the renderer can draw', () => {
    const worker = new FakeWorker();
    const placed: PopulationPlacementSnapshot[] = [];
    beginPopulationFieldPlacement({
      worker: worker as unknown as Worker,
      request: { kind: 'place', points: 400, seed: 0x00c0ffee },
      onPlaced: (placement) => { placed.push(placement); },
    });
    worker.onerror?.(new Error('worker died'));

    expect(placed).toHaveLength(1);
    const placement = placed[0];
    expect(placement.count).toBeGreaterThan(0);
    expect(placement.positions.length).toBeGreaterThanOrEqual(placement.count * 3);
    expect(placement.weights.length).toBeGreaterThanOrEqual(placement.count);
    // The partition, not an overlay: the two halves add up to the whole.
    expect(placement.backboneSegmentCount + placement.residualSegmentCount)
      .toBe(placement.segmentCount);
    expect(Number.isFinite(placement.positions[0])).toBe(true);
  });
});
