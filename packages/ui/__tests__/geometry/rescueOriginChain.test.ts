// The rescue is the planner's largest grain: one dark block fires a dst-rooted
// BFS that reaches the whole 12,000-Cell stage, and every node it reaches was
// costing two `cells` hash lookups and two closure calls (L2-2). The walk now
// scores out of the scratch's own typed arrays instead — but the rescue is the
// only light a dark block gets, so the node it picks may not move.
//
// This file is that proof, over the forty dark blocks lane L2 timed, against a
// golden written from the code BEFORE the typed walk landed.
import { describe, expect, it } from 'vitest';
import golden from '../fixtures/rescueOriginChain.json';
import { rescueStage, type RescueStageCell } from '../helpers/rescueStage';
import {
  anchorProximity,
  anchorProximityScore,
  createRouteScratch,
  rescueOrigin,
  RESCUE_MIN_HOPS,
  rimEntry,
  rimEntryScore,
  type RescueScoreSpec,
} from '../../src/geometry/pathRouter';

function fnv(parts: string[]): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      const code = part.charCodeAt(i);
      low = Math.imul(low ^ code, 0x01000193) >>> 0;
      high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
    }
  }
  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`;
}

/** Counts what a search asks the publish for, which is the whole point: the
 *  walk used to ask twice per visited node and now asks once per node per
 *  publish, then never again. */
class CountingCells extends Map<number, RescueStageCell> {
  gets = 0;
  hass = 0;
  override get(id: number): RescueStageCell | undefined {
    this.gets += 1;
    return super.get(id);
  }
  override has(id: number): boolean {
    this.hass += 1;
    return super.has(id);
  }
}

describe('the rescue over forty dark blocks of the bench stage', () => {
  it('is built on the stage the golden was written from', () => {
    const stage = rescueStage();
    expect({
      size: stage.cells.size,
      nodes: stage.graph.adjacency.size,
      edges: stage.graph.edges.length,
      digest: fnv([...stage.cells.values()].map((c) =>
        `${c.id}:${Math.round(c.pos_seed[0] * 1e6)},`
        + `${Math.round(c.pos_seed[1] * 1e6)},${Math.round(c.pos_seed[2] * 1e6)};`)),
    }).toEqual(golden.stage);
  });

  it('picks the origins the closure-scored walk picked, block for block', () => {
    const stage = rescueStage();
    const scratch = createRouteScratch();
    const rows = stage.blocks.map((block) => {
      const spec: RescueScoreSpec = block.anchor
        ? anchorProximity(block.cells, block.anchor)
        : rimEntry(block.cells, block.dst);
      const path = rescueOrigin(stage.graph, block.dst, spec, { scratch });
      // The score is recomputed through the CLOSURE the spec replaced: the
      // chosen node has to be the argmax under the arithmetic as it was
      // written, not merely under the arithmetic as it is now spelled.
      const score = block.anchor
        ? anchorProximityScore(block.cells, block.anchor)
        : rimEntryScore(block.cells, block.dst);
      return {
        index: block.index,
        kind: block.kind,
        dst: block.dst,
        origin: path ? path[0] : null,
        hops: path ? path.length - 1 : 0,
        pathDigest: fnv(path ? path.map((id) => `${id};`) : ['null']),
        bestScore: path ? Number(score(path[0]).toPrecision(12)) : null,
      };
    });
    expect(rows).toEqual(golden.blocks);
  });

  it('leaves the general form, which any score can still use, answering the same', () => {
    const stage = rescueStage();
    const scratch = createRouteScratch();
    const rows = stage.blocks.map((block) => {
      const score = block.anchor
        ? anchorProximityScore(block.cells, block.anchor)
        : rimEntryScore(block.cells, block.dst);
      const path = rescueOrigin(stage.graph, block.dst, score, {
        valid: (id) => block.cells.has(id),
        scratch,
      });
      return {
        index: block.index,
        origin: path ? path[0] : null,
        hops: path ? path.length - 1 : 0,
      };
    });
    expect(rows).toEqual(golden.blocks.map((b) => ({
      index: b.index,
      origin: b.origin,
      hops: b.hops,
    })));
  });

  it('asks the publish once per node it reaches, and the next attempt asks nothing', () => {
    const stage = rescueStage();
    const cells = new CountingCells(stage.cells);
    const scratch = createRouteScratch();
    const first = stage.blocks[0];
    const second = stage.blocks[4];

    rescueOrigin(stage.graph, first.dst, anchorProximity(cells, first.anchor!), { scratch });
    const cold = cells.gets + cells.hass;
    expect(cold).toBeGreaterThan(0);
    expect(cold).toBeLessThanOrEqual(stage.cells.size);

    cells.gets = 0;
    cells.hass = 0;
    rescueOrigin(stage.graph, second.dst, anchorProximity(cells, second.anchor!), { scratch });
    // One: the first walk's own root, which a root is never scored at and so
    // never resolved. Every other node of the stage is answered from the table.
    expect(cells.gets + cells.hass).toBe(1);

    // A new publish is a new map instance, and the whole table is resolved
    // against it again — the rescue must never answer off a departed Cell.
    const next = new CountingCells(stage.lagged);
    rescueOrigin(stage.graph, second.dst, anchorProximity(next, second.anchor!), { scratch });
    expect(next.gets + next.hass).toBeGreaterThan(0);
  });

  it('reaches for an origin far past any margin a hop cap could allow', () => {
    // Measured here so nobody re-derives it from the plan: capping the walk at
    // `RESCUE_MIN_HOPS + margin` does NOT preserve the answer. Both scores get
    // BETTER with distance from the destination — proximity to a coin that is
    // anywhere on the stage, rim-wardness along an outward radial — so the
    // argmax sits wherever the stage put it, not near the frontier's start.
    const hops = golden.blocks.map((b) => b.hops).sort((a, b) => a - b);
    const beyond = (margin: number) =>
      hops.filter((h) => h > RESCUE_MIN_HOPS + margin).length;
    expect(hops[20]).toBeGreaterThanOrEqual(14);
    expect(hops[39]).toBeGreaterThanOrEqual(40);
    expect(beyond(4)).toBeGreaterThanOrEqual(30);
    expect(beyond(12)).toBeGreaterThanOrEqual(15);
  });
});
