import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  deriveGalaxyConsensusBraid,
  writeGalaxyConsensusBraidBuffers,
  type GalaxyNucleusBuffers,
  type GalaxyNucleusCursor,
} from '../../src/derives/galaxyNucleus.derive';

const CELL: Cell = {
  id: 17,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 100,
  tag: 'dex',
  pos_seed: [1, 2, 3],
  out_point: { tx_hash: `0x${'cd'.repeat(32)}`, index: 0 },
  capacity: 8_000e8,
  data_hex: `0x${'ab'.repeat(96)}`,
  content_hash: `0x${'22'.repeat(32)}`,
  lock_kind: 'multisig',
  asset_kind: 'dao',
};

function buffersFor(lineVertices: number, nodes: number): GalaxyNucleusBuffers {
  return {
    linePos: new Float32Array(lineVertices * 3),
    lineCol: new Float32Array(lineVertices * 3),
    nodePos: new Float32Array(nodes * 3),
    nodeSize: new Float32Array(nodes),
    nodeAlpha: new Float32Array(nodes),
  };
}

function emptyCursor(): GalaxyNucleusCursor {
  return { lineVertices: 0, nodes: 0 };
}

describe('galaxy consensus braid LOD', () => {
  it('derives deterministic contributor paths, fine stitches, and agreements', () => {
    const left = deriveGalaxyConsensusBraid(CELL);
    const right = deriveGalaxyConsensusBraid(CELL);

    expect(left).toEqual(right);
    expect(left.segments.length).toBeGreaterThan(4 * 64 * 6);
    expect(left.colors).toHaveLength(left.segments.length);
    expect(left.detailWeights).toHaveLength(left.segments.length / 6);
    expect(left.detailWeights.some((weight) => weight > 0.5)).toBe(true);
    expect(left.knots.length).toBeGreaterThan(0);
  });

  it('places the normalized A geometry around the real Cell origin', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const buffers = buffersFor(braid.segments.length / 3, braid.knots.length);
    const cursor = emptyCursor();
    const result = writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      1,
      0.3,
      buffers,
      cursor,
    );

    expect(result).toBe(cursor);
    expect(cursor.lineVertices).toBe(braid.segments.length / 3);
    expect(cursor.nodes).toBe(braid.knots.length);
    expect(buffers.linePos[0]).toBeCloseTo(
      CELL.pos_seed[0] + braid.segments[0] * 0.3,
      6,
    );
    expect(buffers.linePos[1]).toBeCloseTo(
      CELL.pos_seed[1] + braid.segments[1] * 0.3,
      6,
    );
    expect(buffers.lineCol[0]).toBeGreaterThan(0);
    expect(buffers.nodeAlpha[0]).toBeGreaterThan(0);
  });

  it('honors fixed buffer capacities without writing a partial segment', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const buffers = buffersFor(2, 1);
    const cursor = emptyCursor();

    writeGalaxyConsensusBraidBuffers(CELL, braid, 1, 0.3, buffers, cursor);

    expect(cursor).toEqual({ lineVertices: 2, nodes: 1 });
    expect(buffers.linePos).toHaveLength(6);
    expect(buffers.nodePos).toHaveLength(3);
  });

  it('reserves agreement knots for near LOD and dims dead Cells', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const midBuffers = buffersFor(braid.segments.length / 3, braid.knots.length);
    const nearBuffers = buffersFor(braid.segments.length / 3, braid.knots.length);
    const deadBuffers = buffersFor(braid.segments.length / 3, braid.knots.length);

    writeGalaxyConsensusBraidBuffers(CELL, braid, 0.3, 0.3, midBuffers, emptyCursor());
    writeGalaxyConsensusBraidBuffers(CELL, braid, 1, 0.3, nearBuffers, emptyCursor());
    writeGalaxyConsensusBraidBuffers(
      { ...CELL, death_at_ms: 1 },
      braid,
      1,
      0.3,
      deadBuffers,
      emptyCursor(),
    );

    expect(midBuffers.nodeAlpha[0]).toBe(0);
    expect(nearBuffers.nodeAlpha[0]).toBeGreaterThan(0);
    expect(deadBuffers.nodeAlpha[0]).toBeLessThan(nearBuffers.nodeAlpha[0]);
    expect(deadBuffers.lineCol[0]).toBeLessThan(nearBuffers.lineCol[0]);
  });
});
