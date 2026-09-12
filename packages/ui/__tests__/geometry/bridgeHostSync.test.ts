import v8 from 'node:v8';
import vm from 'node:vm';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  createBridgeHostRegistry,
  createBridgeHostSyncJob,
  stepBridgeHostSyncJob,
  syncBridgeHosts,
  type BridgeHostRegistry,
} from '../../src/geometry/bridgeEdges';
import {
  BRIDGE_CHAIN_BLOCKS,
  BRIDGE_CHAIN_SIZE,
  bridgeHostChain,
  digestBridgeHosts,
  type BridgeHostChainBlock,
  type BridgeHostDigest,
} from '../helpers/bridgeHostChain';
import { legacySyncBridgeHosts } from '../helpers/legacyBridgeHostSync';
import golden from '../fixtures/bridgeHostSyncChain.json';

/**
 * The host sync is the one thing on the block frame that is allowed to cost
 * nothing: it runs on EVERY build, and on a composed stage its whole answer
 * is the word "no". 1901530d made it resumable by rebuilding three scratch
 * Maps and a record per Cell — 6.5 MB of garbage per build at 12,000 Cells,
 * where the sync it replaced allocated 0.75 MB (lane L2-1). This file is the
 * pair of claims that let the cursor go back to the persistent records: the
 * answer is the retired sync's, word for word, and the build allocates
 * essentially nothing.
 */

const CHAIN_TIMEOUT_MS = 120_000;

let chain: readonly BridgeHostChainBlock[];

beforeAll(() => {
  chain = bridgeHostChain();
}, CHAIN_TIMEOUT_MS);

function fullHosts(registry: BridgeHostRegistry): Map<number, number> {
  const degrees = new Map<number, number>();
  for (const host of registry.hosts.values()) degrees.set(host.id, host.degree);
  return degrees;
}

/** The chain through the cursor, one digest per block. */
function walkWithCursor(cut?: (block: number) => number): BridgeHostDigest[] {
  const registry = createBridgeHostRegistry();
  return chain.map((block, index) => {
    const stop = cut?.(index) ?? 0;
    if (stop > 0) {
      // A newer arm lands: this job is dropped where it stands, never
      // resumed, and never rolled back.
      const abandoned = createBridgeHostSyncJob(registry, block.cells, block.edges);
      stepBridgeHostSyncJob(abandoned, stop);
      expect(abandoned.phase).not.toBe('done');
    }
    const job = createBridgeHostSyncJob(registry, block.cells, block.edges);
    while (!stepBridgeHostSyncJob(job, 32).done) {
      // The Canvas resumes this cursor on the next frame.
    }
    return digestBridgeHosts(registry, job.moved);
  });
}

describe('the bridge host sync answers what the sync it replaced answered', () => {
  it('says the same word and holds the same hosts on 16 chained blocks', () => {
    expect(walkWithCursor()).toEqual(golden.blocks);
  }, CHAIN_TIMEOUT_MS);

  it('agrees with the retired sync host for host and degree for degree', () => {
    // The digest above is the committed record; this is the retired code
    // itself, run beside the cursor over the same stage. A digest says two
    // runs differ; this says WHERE.
    const cursorRegistry = createBridgeHostRegistry();
    const oracleRegistry = createBridgeHostRegistry();
    for (let block = 0; block <= BRIDGE_CHAIN_BLOCKS; block += 1) {
      const { cells, edges } = chain[block];
      const moved = syncBridgeHosts(cursorRegistry, cells, edges);
      const oracleMoved = legacySyncBridgeHosts(oracleRegistry, cells, edges);
      expect({ block, moved }).toEqual({ block, moved: oracleMoved });
      expect(fullHosts(cursorRegistry)).toEqual(fullHosts(oracleRegistry));
    }
  }, CHAIN_TIMEOUT_MS);

  it('leaves the registry of an abandoned job readable by the one that replaces it', () => {
    const stage = BRIDGE_CHAIN_SIZE;
    // One cut inside each walk: the stage, the drawn edges, the registry.
    for (const cut of [stage >> 1, stage + (stage >> 2), stage * 2 + 4_000]) {
      expect(walkWithCursor(() => cut)).toEqual(golden.blocks);
    }
  }, CHAIN_TIMEOUT_MS);

  it('publishes the commit whole or not at all', () => {
    const registry = createBridgeHostRegistry();
    syncBridgeHosts(registry, chain[0].cells, chain[0].edges);
    const before = fullHosts(registry);
    const job = createBridgeHostSyncJob(registry, chain[1].cells, chain[1].edges);
    while (job.phase !== 'commit') stepBridgeHostSyncJob(job, 1);
    // Everything the three walks did is scratch: every host the last build
    // published still answers at the degree it published, and a Cell this
    // build inserted answers as the non-candidate it is until the commit
    // says otherwise.
    const midway = fullHosts(registry);
    for (const [id, degree] of before) expect(midway.get(id)).toBe(degree);
    const inserted = [...midway].filter(([id]) => !before.has(id));
    expect(inserted.length).toBeGreaterThan(0);
    for (const [, degree] of inserted) expect(degree).toBe(Number.POSITIVE_INFINITY);
    expect(job.counted.length + job.departed.length).toBeGreaterThan(0);
    // And the commit does not ask the budget again — one operation, whole.
    expect(stepBridgeHostSyncJob(job, 1).done).toBe(true);
    expect(fullHosts(registry)).not.toEqual(before);
    for (const host of job.departed) expect(registry.hosts.has(host.id)).toBe(false);
    for (const host of job.counted) expect(host.degree).toBe(host.next);
  }, CHAIN_TIMEOUT_MS);
});

describe('the bridge host sync costs a build what it has to and no more', () => {
  it('walks the stage, the drawn edges and the registry, and nothing else', () => {
    const registry = createBridgeHostRegistry();
    syncBridgeHosts(registry, chain[0].cells, chain[0].edges);
    const job = createBridgeHostSyncJob(registry, chain[1].cells, chain[1].edges);
    while (!stepBridgeHostSyncJob(job, 32).done) {
      // The Canvas resumes this cursor on the next frame.
    }
    // 12,000 published Cells + 8,000 drawn edges + ~12,000 records + one
    // commit, each walk paying one operation for its own end. The scratch
    // Maps this replaced walked the stage twice more: 44,044 at the same
    // stage, which is the number to beat, not a ms on a loaded machine.
    expect(job.operations).toBeLessThanOrEqual(32_100);
    expect(job.operations).toBeGreaterThan(BRIDGE_CHAIN_SIZE * 2);
  }, CHAIN_TIMEOUT_MS);

  it('carries no collection of its own', () => {
    const job = createBridgeHostSyncJob(
      createBridgeHostRegistry(), chain[0].cells, chain[0].edges,
    );
    // The heap gate below is the reading; this is the rule that produces it.
    // A scratch Map or Set on the job is one keyed structure per build over
    // the stage — the shape the whole rewrite was to be rid of, and one that
    // costs ~0.9 MB at 12,000 Cells, which is under that gate on its own.
    for (const [field, value] of Object.entries(job)) {
      expect(
        value instanceof Map || value instanceof Set,
        `${field} is a scratch collection the build pays for`,
      ).toBe(false);
    }
  }, CHAIN_TIMEOUT_MS);

  it('allocates under a megabyte for a build at 12,000 Cells', () => {
    const gc = exposeGc();
    const registry = createBridgeHostRegistry();
    syncBridgeHosts(registry, chain[0].cells, chain[0].edges);
    const samples: number[] = [];
    for (let block = 1; block <= 8; block += 1) {
      const { cells, edges } = chain[block];
      const job = createBridgeHostSyncJob(registry, cells, edges);
      gc();
      gc();
      const before = process.memoryUsage().heapUsed;
      while (!stepBridgeHostSyncJob(job, 32).done) {
        // The Canvas resumes this cursor on the next frame.
      }
      samples.push(process.memoryUsage().heapUsed - before);
    }
    // Min of the samples, as lane L2's A/B was read: a heap delta measured
    // beside a running test suite has a floor, not a mean. The three scratch
    // Maps and the record per Cell measured 6,537 KB here at the same stage.
    expect(Math.min(...samples) / 1024).toBeLessThanOrEqual(1_024);
  }, CHAIN_TIMEOUT_MS);

  it('keeps one record per host across builds', () => {
    const registry = createBridgeHostRegistry();
    syncBridgeHosts(registry, chain[0].cells, chain[0].edges);
    const survivor = [...registry.hosts.values()][BRIDGE_CHAIN_SIZE >> 1];
    const record = registry.hosts.get(survivor.id);
    syncBridgeHosts(registry, chain[1].cells, chain[1].edges);
    // The seat never moves while a Cell is on the stage, so a build that
    // re-made this record would be paying for a copy of itself.
    expect(registry.hosts.get(survivor.id)).toBe(record);
  }, CHAIN_TIMEOUT_MS);
});

/** `--expose-gc` without the command line: the heap delta needs a floor. */
function exposeGc(): () => void {
  const exposed = (globalThis as { gc?: () => void }).gc;
  if (typeof exposed === 'function') return exposed;
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  v8.setFlagsFromString('--no-expose-gc');
  return gc;
}
