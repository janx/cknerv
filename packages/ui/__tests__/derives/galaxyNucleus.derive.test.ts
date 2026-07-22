import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../src/derives/cellVisual.derive';
import {
  consensusBraidAgreementTarget,
  deriveConsensusBraidTopology,
} from '../../src/derives/consensusBraid.derive';
import {
  deriveGalaxyConsensusBraid,
  writeGalaxyConsensusBraidBuffers,
  type GalaxyNucleusBuffers,
  type GalaxyNucleusCursor,
} from '../../src/derives/galaxyNucleus.derive';
import { consensusMemoryEvidenceBindings } from '../../src/derives/consensusMemoryEvidence.derive';

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
    nodeResolve: new Float32Array(nodes),
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
    expect(left.knots).toHaveLength(
      consensusBraidAgreementTarget(deriveCellVisual(CELL)),
    );
  });

  it('uses the portrait topology agreement order and capacity scale exactly', () => {
    const visual = deriveCellVisual(CELL);
    const topology = deriveConsensusBraidTopology(visual, CELL.birth_block);
    const braid = deriveGalaxyConsensusBraid(CELL);

    expect(braid.presenceScale).toBe(topology.presenceScale);
    expect(braid.knots.map((knot) => [knot.x, knot.y, knot.z])).toEqual(
      topology.agreements.map((agreement) => [...agreement.midpoint]),
    );
  });

  it('preserves the same topology while capacity changes physical presence', () => {
    const low = deriveGalaxyConsensusBraid({ ...CELL, capacity: 61e8 });
    const high = deriveGalaxyConsensusBraid({ ...CELL, capacity: 1_000_000e8 });

    expect(high.segments).toEqual(low.segments);
    expect(high.knots).toEqual(low.knots);
    expect(high.presenceScale).toBeGreaterThan(low.presenceScale);
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

  it('scans canonical paths and resolves real agreement knots during recall', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const baseline = buffersFor(braid.segments.length / 3, braid.knots.length);
    const reading = buffersFor(braid.segments.length / 3, braid.knots.length);
    const resolved = buffersFor(braid.segments.length / 3, braid.knots.length);

    writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      0.55,
      0.3,
      baseline,
      emptyCursor(),
    );
    writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      0.55,
      0.3,
      reading,
      emptyCursor(),
      { role: 'target', strength: 1, phase: 0.5, convergence: 0 },
    );
    writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      0.55,
      0.3,
      resolved,
      emptyCursor(),
      { role: 'target', strength: 1, phase: 0.5, convergence: 1 },
    );

    expect(Math.max(...reading.lineCol)).toBeGreaterThan(Math.max(...baseline.lineCol));
    expect(resolved.lineCol.reduce((sum, channel) => sum + channel, 0))
      .toBeGreaterThan(reading.lineCol.reduce((sum, channel) => sum + channel, 0));
    expect(Math.max(...resolved.nodeAlpha)).toBeGreaterThan(Math.max(...reading.nodeAlpha));
    expect(Math.max(...reading.nodeResolve)).toBe(0);
    expect(Math.max(...resolved.nodeResolve)).toBe(1);
    expect(resolved.linePos).toEqual(baseline.linePos);
  });

  it('resolves each evidence-bound knot from that source instead of the aggregate', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const evidence = [
      {
        sourceId: 1,
        ordinal: 1,
        contentHash: `0x${'11'.repeat(32)}`,
        convergence: 1,
      },
      {
        sourceId: 2,
        ordinal: 2,
        contentHash: `0x${'33'.repeat(32)}`,
        convergence: 0,
      },
    ];
    const bindings = consensusMemoryEvidenceBindings(
      CELL.content_hash,
      evidence,
      braid.knots.length,
    );
    const buffers = buffersFor(braid.segments.length / 3, braid.knots.length);

    writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      1,
      0.3,
      buffers,
      emptyCursor(),
      {
        role: 'target',
        strength: 1,
        phase: 0.5,
        convergence: 0.5,
        evidence,
      },
    );

    expect(buffers.nodeResolve[bindings[0].knotIndex]).toBe(1);
    expect(buffers.nodeResolve[bindings[1].knotIndex]).toBe(0);
  });

  it('holds resolved agreement knots while the route aperture releases', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const buffers = buffersFor(braid.segments.length / 3, braid.knots.length);

    writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      1,
      0.3,
      buffers,
      emptyCursor(),
      { role: 'target', strength: 0.25, phase: 0.5, convergence: 1 },
    );

    expect(Math.max(...buffers.nodeResolve)).toBe(0.5);
    expect(Math.max(...buffers.nodeAlpha)).toBeGreaterThan(0.25);
  });

  it('isolates the knot bound to the focused evidence source', () => {
    const braid = deriveGalaxyConsensusBraid(CELL);
    const evidence = [
      {
        sourceId: 1,
        ordinal: 1,
        contentHash: `0x${'11'.repeat(32)}`,
        convergence: 1,
      },
      {
        sourceId: 2,
        ordinal: 2,
        contentHash: `0x${'33'.repeat(32)}`,
        convergence: 1,
      },
    ];
    const bindings = consensusMemoryEvidenceBindings(
      CELL.content_hash,
      evidence,
      braid.knots.length,
    );
    const buffers = buffersFor(braid.segments.length / 3, braid.knots.length);

    writeGalaxyConsensusBraidBuffers(
      CELL,
      braid,
      1,
      0.3,
      buffers,
      emptyCursor(),
      {
        role: 'target',
        strength: 1,
        phase: 0.5,
        convergence: 1,
        evidence,
        evidenceFocusSourceId: evidence[0].sourceId,
      },
    );

    const selectedKnot = bindings[0].knotIndex;
    const passiveKnot = bindings[1].knotIndex;
    expect(buffers.nodeAlpha[selectedKnot]).toBeGreaterThan(
      buffers.nodeAlpha[passiveKnot],
    );
    expect(buffers.nodeResolve[selectedKnot]).toBe(1);
    expect(buffers.nodeResolve[passiveKnot]).toBeLessThan(0.2);
  });
});
