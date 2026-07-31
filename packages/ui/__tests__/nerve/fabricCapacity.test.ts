import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import { helixSeedF64 } from '../../src/helix';
import {
  FABRIC_SAMPLES_PER_EDGE,
  MAX_FABRIC_SEGMENTS,
  MAX_GRAPH_CELLS,
} from '../../src/nerve/fabricCapacity';

// Production connectivity config — mirrors ui-app/src/runtime-config.ts.
const PROD_K = 5;
const PROD_MAX_EDGE_LENGTH = 42;

function helixCell(id: number): Cell {
  const [x, y, z] = helixSeedF64(id);
  return {
    id, born_at_ms: 0, death_at_ms: null, birth_block: 1,
    tag: null, pos_seed: [x, y, z],
    out_point: { tx_hash: '0x', index: 0 },
    capacity: 0, data_hex: '',
    content_hash: '0x' + '00'.repeat(32),
  };
}

describe('fabric capacity', () => {
  it('preserves enough samples for an organic passive-fabric curve', () => {
    expect(FABRIC_SAMPLES_PER_EDGE).toBeGreaterThanOrEqual(4);
  });

  // Builds the real neighbour graph over a capacity-sized helix field,
  // exactly as the renderer would, and asserts every edge fits the
  // segment buffer. This is the empirical degree measurement encoded as
  // a guard: if it fails, AVG_DEGREE_BOUND (and the buffer) must grow.
  // MAX_GRAPH_CELLS (~22,000) cells — the worst case the buffer is sized
  // for; the build is O(N·k) in practice.
  it('holds the full graph at MAX_GRAPH_CELLS without truncation', () => {
    const cells = new Map<number, Cell>();
    for (let id = 0; id < MAX_GRAPH_CELLS; id++) cells.set(id, helixCell(id));
    const g = buildNeighborGraph(cells, {
      k: PROD_K,
      maxEdgeLength: PROD_MAX_EDGE_LENGTH,
    });
    const segments = g.edges.length * FABRIC_SAMPLES_PER_EDGE;
    expect(segments).toBeLessThanOrEqual(MAX_FABRIC_SEGMENTS);
  });
});
