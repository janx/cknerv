// What a refresh of the near-LOD braid buffers is allowed to cost.
//
// The whole populated prefix used to be rewritten and flagged on every refresh:
// the 12 Hz LOD tick, and every frame a focus envelope eased. With a Cell
// selected at rest that is the two 30,240-float interleaved buffers re-uploaded
// about eight times a second (27 KB per flag, ×2) for a change to ONE entry —
// the 2026-09-12 review's H-1.
//
// The layout is what makes the slice-local write safe. An entry's span is a
// function of its braid and of the capacity left when its turn comes, and of
// nothing else: `writeGalaxyConsensusBraidBuffers` walks `braid.segments` and
// `braid.knots` to their end or to the cap, and `detail`, `scale`, `focus` and
// `recall` only change the VALUES it stores. So while the entries and their
// order hold, every entry owns the same bytes on every frame, and a refresh may
// rewrite only the ones whose inputs moved. When the order or the membership
// moves, the spans move with them and the prefix is rewritten whole.
import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  createGalaxyNucleusWritePlan,
  deriveGalaxyConsensusBraid,
  writeGalaxyConsensusBraidBuffers,
  writeGalaxyNucleusEntries,
  type GalaxyConsensusBraid,
  type GalaxyNucleusBuffers,
  type GalaxyNucleusCursor,
  type GalaxyNucleusEntry,
  type GalaxyNucleusRecallResponse,
} from '../../src/derives/galaxyNucleus.derive';

const MAX_NEAR = 12;
const MAX_SEG = 420;
const MAX_NODE = 12;

function cellAt(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 100 + id,
    tag: null,
    pos_seed: [id * 0.5, 2, -id * 0.25],
    out_point: { tx_hash: `0x${(id % 256).toString(16).padStart(2, '0').repeat(32)}`, index: id % 4 },
    capacity: (1_000 + id * 37) * 1e8,
    data_hex: id % 3 === 0 ? `0x${'ab'.repeat(24)}` : '0x',
    data_bytes: id % 3 === 0 ? 24 : 0,
    content_hash: `0x${((id * 7) % 256).toString(16).padStart(2, '0').repeat(32)}`,
    lock_shape_seed: [id % 5, (id + 1) % 7],
    type_shape_seed: id % 2 === 0 ? [id % 3, (id + 3) % 5] : null,
    data_shape_seed: [id % 4, (id + 2) % 6],
    lock_kind: id % 2 === 0 ? 'sighash' : 'multisig',
    asset_kind: id % 3 === 0 ? 'dao' : 'native',
  };
}

function buffers(): GalaxyNucleusBuffers {
  const lineVertices = MAX_NEAR * MAX_SEG * 2;
  const nodes = MAX_NEAR * MAX_NODE;
  return {
    linePos: new Float32Array(lineVertices * 3),
    lineCol: new Float32Array(lineVertices * 3),
    nodePos: new Float32Array(nodes * 3),
    nodeSize: new Float32Array(nodes),
    nodeAlpha: new Float32Array(nodes),
    nodeResolve: new Float32Array(nodes),
  };
}

interface Entry extends GalaxyNucleusEntry {
  cell: Cell;
  braid: GalaxyConsensusBraid;
  detail: number;
  scale: number;
  userFocus: number;
  recall: GalaxyNucleusRecallResponse | null;
}

function entries(count: number): Entry[] {
  const list: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    const cell = cellAt(index + 1);
    list.push({
      cell,
      braid: deriveGalaxyConsensusBraid(cell),
      detail: 0.4 + index * 0.01,
      scale: 0.2 + index * 0.003,
      userFocus: 0,
      recall: null,
    });
  }
  return list;
}

/** The oracle: the whole prefix, written from zero the way the component wrote
 *  it before this plan existed. */
function whole(list: readonly Entry[], target: GalaxyNucleusBuffers): GalaxyNucleusCursor {
  const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
  for (const entry of list) {
    writeGalaxyConsensusBraidBuffers(
      entry.cell,
      entry.braid,
      entry.detail,
      entry.scale,
      target,
      cursor,
      entry.recall,
      entry.userFocus,
    );
  }
  return cursor;
}

function prefixEqual(
  left: GalaxyNucleusBuffers,
  right: GalaxyNucleusBuffers,
  cursor: GalaxyNucleusCursor,
): string | null {
  const lineComponents = cursor.lineVertices * 3;
  for (let i = 0; i < lineComponents; i += 1) {
    if (left.linePos[i] !== right.linePos[i]) return `linePos[${i}] ${left.linePos[i]} vs ${right.linePos[i]}`;
    if (left.lineCol[i] !== right.lineCol[i]) return `lineCol[${i}] ${left.lineCol[i]} vs ${right.lineCol[i]}`;
  }
  for (let i = 0; i < cursor.nodes * 3; i += 1) {
    if (left.nodePos[i] !== right.nodePos[i]) return `nodePos[${i}] ${left.nodePos[i]} vs ${right.nodePos[i]}`;
  }
  for (let i = 0; i < cursor.nodes; i += 1) {
    if (left.nodeSize[i] !== right.nodeSize[i]) return `nodeSize[${i}]`;
    if (left.nodeAlpha[i] !== right.nodeAlpha[i]) return `nodeAlpha[${i}]`;
    if (left.nodeResolve[i] !== right.nodeResolve[i]) return `nodeResolve[${i}]`;
  }
  return null;
}

describe('the near-LOD nucleus writes what changed', () => {
  it('rewrites the whole prefix the first time it sees a layout', () => {
    const list = entries(MAX_NEAR);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);

    writeGalaxyNucleusEntries(list, target, cursor, plan);

    expect(plan.whole).toBe(true);
    expect(plan.rewritten).toBe(MAX_NEAR);
    expect(plan.lineSpanCount).toBe(0);
    expect(cursor.lineVertices).toBeGreaterThan(0);
    const oracle = buffers();
    expect(prefixEqual(target, oracle, whole(list, oracle))).toBeNull();
  });

  it('flags one span for one hover change among twelve near entries', () => {
    const list = entries(MAX_NEAR);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    writeGalaxyNucleusEntries(list, target, cursor, plan);
    const prefixVertices = cursor.lineVertices;

    // A hover envelope on the seventh entry: its focus and its detail move,
    // nothing else does.
    list[6].userFocus = 0.31;
    list[6].detail = 0.62;
    writeGalaxyNucleusEntries(list, target, cursor, plan);

    expect(plan.whole).toBe(false);
    expect(plan.rewritten).toBe(1);
    expect(plan.lineSpanCount).toBe(1);
    expect(plan.nodeSpanCount).toBe(1);
    const span = plan.lineSpans[0];
    expect(span.start).toBe(plan.entries[6].lineStart);
    expect(span.count).toBe(plan.entries[6].lineEnd - plan.entries[6].lineStart);
    // One of twelve braids, and the braids differ in length, so the share is
    // stated as a bound rather than a twelfth.
    expect(span.count / prefixVertices).toBeLessThan(0.12);
    expect(cursor.lineVertices).toBe(prefixVertices);

    const oracle = buffers();
    expect(prefixEqual(target, oracle, whole(list, oracle))).toBeNull();
  });

  it('flags nothing at all when no input moved', () => {
    const list = entries(MAX_NEAR);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    writeGalaxyNucleusEntries(list, target, cursor, plan);

    writeGalaxyNucleusEntries(list, target, cursor, plan);

    expect(plan.whole).toBe(false);
    expect(plan.rewritten).toBe(0);
    expect(plan.lineSpanCount).toBe(0);
    expect(plan.nodeSpanCount).toBe(0);
  });

  it('rewrites the whole prefix when the membership or the order moves', () => {
    const list = entries(MAX_NEAR);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    writeGalaxyNucleusEntries(list, target, cursor, plan);

    // The sort key includes focus, so a hover reorders the list — and every
    // span after the swap moves with it.
    const reordered = [list[3], ...list.filter((_, index) => index !== 3)];
    writeGalaxyNucleusEntries(reordered, target, cursor, plan);
    expect(plan.whole).toBe(true);
    expect(plan.rewritten).toBe(MAX_NEAR);

    // …and so does one entry leaving.
    const shorter = reordered.slice(0, MAX_NEAR - 1);
    writeGalaxyNucleusEntries(shorter, target, cursor, plan);
    expect(plan.whole).toBe(true);
    expect(plan.rewritten).toBe(MAX_NEAR - 1);

    const oracle = buffers();
    expect(prefixEqual(target, oracle, whole(shorter, oracle))).toBeNull();
  });

  it('rewrites an entry whose record was replaced, or whose braid was', () => {
    const list = entries(4);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    writeGalaxyNucleusEntries(list, target, cursor, plan);

    // A death is patched into the resident record in place (T16), so the object
    // identity says nothing about `life` — and `life` scales every colour the
    // writer stores.
    list[2].cell.death_at_ms = 1_000;
    writeGalaxyNucleusEntries(list, target, cursor, plan);
    expect(plan.rewritten).toBe(1);
    expect(plan.whole).toBe(false);
    const oracle = buffers();
    expect(prefixEqual(target, oracle, whole(list, oracle))).toBeNull();
  });

  it('rewrites an entry under recall on every refresh', () => {
    const list = entries(4);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    list[1].recall = { role: 'target', strength: 0.6, phase: 0.2, convergence: 0.4 };
    writeGalaxyNucleusEntries(list, target, cursor, plan);

    // The read head moves every frame a recall is held, so a signature over it
    // would be a signature that never matches. It is rewritten by rule.
    writeGalaxyNucleusEntries(list, target, cursor, plan);
    expect(plan.rewritten).toBe(1);
    expect(plan.lineSpanCount).toBe(1);
    expect(plan.lineSpans[0].start).toBe(plan.entries[1].lineStart);

    // And the frame after it is released, once.
    list[1].recall = null;
    writeGalaxyNucleusEntries(list, target, cursor, plan);
    expect(plan.rewritten).toBe(1);
    writeGalaxyNucleusEntries(list, target, cursor, plan);
    expect(plan.rewritten).toBe(0);
  });

  it('leaves the buffers where a whole rewrite would, over 200 random steps', () => {
    const list = entries(MAX_NEAR);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    const oracle = buffers();
    let seed = 20260912;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let live = [...list];

    // Warm-up, unasserted: both sides run the same arithmetic, and V8's
    // `Math.pow`/`Math.exp` are not bit-stable across JIT tiers (see T11's
    // note in this wave's ledger). Tiering both paths up before the comparison
    // begins keeps the equality exact rather than approximate.
    for (let step = 0; step < 40; step += 1) {
      live[step % live.length].userFocus = random();
      writeGalaxyNucleusEntries(live, target, cursor, plan);
      whole(live, oracle);
    }

    for (let step = 0; step < 200; step += 1) {
      const roll = random();
      const index = Math.floor(random() * live.length);
      if (roll < 0.45) {
        live[index].userFocus = random();
        live[index].detail = 0.35 + random() * 0.6;
      } else if (roll < 0.6) {
        live[index].scale = 0.15 + random() * 0.2;
      } else if (roll < 0.75) {
        live[index].recall = random() < 0.5
          ? { role: random() < 0.5 ? 'target' : 'source', strength: random(), phase: random(), convergence: random() }
          : null;
      } else if (roll < 0.85) {
        live[index].cell.death_at_ms = live[index].cell.death_at_ms === null ? 2_000 : null;
      } else if (roll < 0.95) {
        // A reorder, as a hover's focus sort produces.
        const swap = Math.floor(random() * live.length);
        const held = live[index];
        live[index] = live[swap];
        live[swap] = held;
      } else {
        // Membership: a cell leaves or comes back.
        live = live.length > 4 && random() < 0.5
          ? live.filter((_, at) => at !== index)
          : [...list].slice(0, 4 + Math.floor(random() * (MAX_NEAR - 4)));
      }
      writeGalaxyNucleusEntries(live, target, cursor, plan);
      const oracleCursor = whole(live, oracle);
      expect(oracleCursor.lineVertices).toBe(cursor.lineVertices);
      expect(oracleCursor.nodes).toBe(cursor.nodes);
      const mismatch = prefixEqual(target, oracle, oracleCursor);
      expect(mismatch, `step ${step} (roll ${roll.toFixed(3)})`).toBeNull();
    }
  });

  it('keeps its pools, so a refresh allocates nothing of its own', () => {
    const list = entries(MAX_NEAR);
    const target = buffers();
    const cursor: GalaxyNucleusCursor = { lineVertices: 0, nodes: 0 };
    const plan = createGalaxyNucleusWritePlan(MAX_NEAR);
    writeGalaxyNucleusEntries(list, target, cursor, plan);
    const records = plan.entries;
    const lineSpans = plan.lineSpans;
    const nodeSpans = plan.nodeSpans;
    const identities = records.map((record) => record);
    const spanIdentities = lineSpans.map((span) => span);

    for (let step = 0; step < 200; step += 1) {
      list[step % MAX_NEAR].userFocus = (step % 17) / 17;
      writeGalaxyNucleusEntries(list, target, cursor, plan);
    }

    expect(plan.entries).toBe(records);
    expect(plan.lineSpans).toBe(lineSpans);
    expect(plan.nodeSpans).toBe(nodeSpans);
    expect(records.length).toBe(MAX_NEAR);
    expect(lineSpans.length).toBe(MAX_NEAR);
    expect(records.every((record, index) => record === identities[index])).toBe(true);
    expect(lineSpans.every((span, index) => span === spanIdentities[index])).toBe(true);
  });
});
