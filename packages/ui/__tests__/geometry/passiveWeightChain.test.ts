// The arbor weight is `sqrt(subtreeSize / maxSubtreeSize)` over the whole
// forest, so one birth or death in the largest of the fourteen trees rescales
// EVERY weight in the drawn selection — and the landing was replacing 4,400 to
// 6,000 of 8,000 immutable records a block to carry that rescale (L2-3: ~1 MB
// and 6–15 ms inside `cpu.topology.commit`, off the frame ledger).
//
// Only two readers on the main thread ever look at a held record's `w`: the
// width tier, which wants the whole selection's weights EXACTLY, and the
// fabric at the moment it admits an edge, which freezes `arborBrightness` and
// `trunkness` into a state and never reads them again. So the exact weights
// travel beside the list in a typed array the landing overwrites in place, and
// a record is replaced only when something a reader can SEE has moved.
//
// This file is the proof that nothing a reader can see did move, over the same
// 12,000-Cell stage the bench and lane L2 measure, chained sixteen blocks.
import { describe, expect, it } from 'vitest';
import { bridgeHostChain } from '../helpers/bridgeHostChain';
import golden from '../fixtures/passiveWeightChain.json';
import {
  PACKED_PASSIVE_VALUE_STRIDE,
  PASSIVE_WEIGHT_GRAIN,
  applyPassiveSelectionPatch,
  collectPassiveSelectionPatch,
  passiveWeightClass,
} from '../../src/geometry/neighborGraphWorkerProtocol';
import { fabricEdgeSeed } from '../../src/geometry/edgeBezier';
import { arborBrightness } from '../../src/nerve/fabricLuminance';
import { fabricEdgeTrunkness, fabricTrunkTier } from '../../src/nerve/fabricTrunkClass';
import type { NeighborEdge, PassiveSelection } from '../../src/geometry/neighborGraph';

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

/** What the fabric freezes into a state the moment it admits an edge — the
 *  only thing a record's `w` is ever read FOR, besides the tier.
 *
 *  ⚠️ `arborBrightness` runs `Math.pow`, and V8's is not bit-stable across JIT
 *  tiers: the inlined form and the runtime form differ in the last ULP and
 *  which one runs moves with machine load. One part in a million is eleven
 *  orders above that noise and three below anything an eye could be shown. */
function admissionParts(edges: readonly NeighborEdge[]): string[] {
  return edges.map((e) => {
    const seed = fabricEdgeSeed(e.from, e.to);
    return `${e.from},${e.to}:${Math.round(arborBrightness(e.w, seed) * 1e6)}`
      + `:${fabricEdgeTrunkness(e.w)};`;
  });
}

/** The weights the TIER reads, wherever they now live. Exact: these are the
 *  wire's own doubles, copied, never computed. */
function weightParts(selection: PassiveSelection): string[] {
  return selection.edges.map((e, index) => (
    `${e.from},${e.to}:${selection.weights ? selection.weights[index] : (e.w ?? Number.NaN)};`
  ));
}

/** What the rule says a block must replace, counted from the patch itself and
 *  not from the code under test: a surviving record whose distance moved,
 *  whose weight crossed a class, or whose weight moved past the grain. */
function expectedRewrites(
  previous: readonly NeighborEdge[],
  next: readonly NeighborEdge[],
  values: Float64Array,
): { total: number; classChanges: number; drifted: number } {
  const held = new Map(previous.map((e) => [`${e.from}:${e.to}`, e]));
  let classChanges = 0;
  let drifted = 0;
  for (let index = 0; index < next.length; index += 1) {
    const before = held.get(`${next[index].from}:${next[index].to}`);
    if (before === undefined) continue;
    const d = values[index * PACKED_PASSIVE_VALUE_STRIDE];
    const packed = values[index * PACKED_PASSIVE_VALUE_STRIDE + 1];
    const w = Number.isNaN(packed) ? undefined : packed;
    if (passiveWeightClass(before.w) !== passiveWeightClass(w) || before.d !== d) {
      classChanges += 1;
      continue;
    }
    if (w !== undefined && Math.abs((before.w as number) - w) > PASSIVE_WEIGHT_GRAIN) {
      drifted += 1;
    }
  }
  return { total: classChanges + drifted, classChanges, drifted };
}

describe('the passive weights of sixteen chained blocks', () => {
  it('leaves the tier and every admission exactly where the whole rewrite left them', () => {
    const chain = bridgeHostChain();
    const held: PassiveSelection = { edges: [...chain[0].edges] };
    const rewritten: number[] = [];
    const before: number[] = [];
    const classChanges: number[] = [];
    for (let block = 1; block < chain.length; block += 1) {
      const patch = collectPassiveSelectionPatch(
        chain[block - 1].edges,
        chain[block].edges,
      );
      const rule = expectedRewrites(held.edges, chain[block].edges, patch.values);
      const delta = applyPassiveSelectionPatch(held, patch);
      const tier = fabricTrunkTier(held.edges, undefined, held.weights);
      const golden_ = golden.perBlock[block - 1];
      const read = {
        block,
        edges: held.edges.length,
        added: delta.added.length,
        removed: delta.removed.length,
        trunkTierEdges: tier.edges,
        trunkTierThreshold: tier.threshold,
        weightedSelectionEdges: tier.weighted,
        admissionDigest: fnv(admissionParts(delta.added)),
        weightsDigest: fnv(weightParts(held)),
      };
      const { rewritten: wholeRewrite, ...pinned } = golden_;
      expect(read).toEqual({ ...pinned });
      // The rule, exactly: nothing else was replaced, and nothing the rule
      // names was kept.
      expect(delta.rewritten, `block ${block}`).toBe(rule.total);
      expect(delta.rewritten).toBeLessThan(wholeRewrite);
      rewritten.push(delta.rewritten);
      before.push(wholeRewrite);
      classChanges.push(rule.classChanges);
    }
    const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    // ⚠️ B-0i asks for ≤ 10 % of the records a block and this rule does not
    // reach it — measurably, and for a reason the grain cannot touch. About a
    // THIRD of the ~7,900 survivors a block do not drift, they change CLASS:
    // the arbor is rebuilt around each block's births and deaths, and an edge
    // that was a forest edge becomes a cross-link or the other way round.
    // `arborBrightness` answers a different curve for those, so the rule keeps
    // every one. What the grain removes is the rescale — the other half.
    expect(mean(classChanges)).toBeGreaterThan(mean(rewritten) / 2);
    expect(mean(rewritten)).toBeLessThanOrEqual(mean(before) * 0.75);
    expect(Math.max(...rewritten)).toBeLessThanOrEqual(4_600);
  }, 300_000);
});
