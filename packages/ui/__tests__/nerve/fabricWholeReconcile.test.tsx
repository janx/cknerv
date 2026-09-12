// A whole reconcile is the one grain in the landing queue that used to arrive
// entire: `delta === null` — a supersession, a worker fallback, a remount or
// the boot — hands the fabric a complete selection and the fabric walks it in
// one pass. T11 cut the classifying walk into slices the drain steps across
// frames and left the pass that decides deaths and admits births atomic. The
// claim that has to survive that is exact: the fabric a sliced reconcile
// leaves is the fabric the one-shot left, slot for slot.
//
// So this file reads the SLOTS. Every static record the component writes is
// the payload the vertex stage animates from, so the ordered stream of
// (slot, record) writes is what the fabric IS; the committed fixture beside it
// was generated from the code as it stood before the slicing, over the same
// 12,000-Cell stage the bench and lane L2 measure.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { fabricStageChain } from '../helpers/fabricStageChain';
import golden from '../fixtures/fabricWholeReconcileChain.json';
import {
  createFabricLandingQueue,
  drainFabricLandingQueue,
  enqueueFabricLanding,
  fabricLandingBudgetMs,
} from '../../src/nerve/fabricLandingQueue';
import { resetFabricStats, snapshotFabricStats } from '../../src/nerve/fabricStats';
import { resetSimClock } from '../../src/tweaks/simClock';
import NeuralFabric, { type NeuralFabricHandles } from '../../src/nerve/NeuralFabric';
import type { FabricLifecycleRecord } from '../../src/nerve/fabricLifecycleSlots';
import { fabricEdgeSeed } from '../../src/geometry/edgeBezier';
import { arborBrightness } from '../../src/nerve/fabricLuminance';
import { fabricEdgeTrunkness } from '../../src/nerve/fabricTrunkClass';
import type { Cell } from '@cknerv/types';

vi.mock('@react-three/fiber', () => ({
  useFrame: () => {},
  useThree: (selector?: (state: unknown) => unknown) => {
    const state = { size: { width: 1280, height: 720 } };
    return selector ? selector(state) : state;
  },
}));

/** The write stream, folded as it arrives: 12,000 Cells' worth of records is
 *  not a thing to keep, and a running digest compares just as exactly. */
const slotWrites = vi.hoisted(() => ({
  low: 0,
  high: 0,
  count: 0,
  arrays: null as unknown,
  /** Records kept whole, for the cases that read one rather than digest it. */
  capture: null as FabricLifecycleRecord[] | null,
}));

/** ⚠️ `brightnessMul` is `arborBrightness(w, seed)` = `TWIG_MIN + (1 −
 *  TWIG_MIN) · Math.pow(w, 1.2)`, and V8's `Math.pow` is NOT bit-stable: the
 *  TurboFan-inlined form and the runtime form differ in the last ULP, and
 *  WHICH one runs is a JIT-tier decision that moves with machine load. A
 *  full-precision digest over it therefore fails at random on a busy machine
 *  and says nothing when it does. One part in a million is eleven orders
 *  above that noise and three below anything an eye could be shown. Every
 *  other field here is either copied verbatim from the input or was observed
 *  bit-stable across the same runs, so only this one is quantised. */
function brightnessGrain(value: number): number {
  return Math.round(value * 1e6);
}

function foldWrite(text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    slotWrites.low = Math.imul(slotWrites.low ^ code, 0x01000193) >>> 0;
    slotWrites.high = Math.imul(slotWrites.high ^ code, 0x85ebca6b) >>> 0;
  }
}

vi.mock('../../src/nerve/fabricLifecycleSlots', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/nerve/fabricLifecycleSlots')
  >();
  return {
    ...actual,
    writeFabricLifecycleSlot: (
      arrays: Parameters<typeof actual.writeFabricLifecycleSlot>[0],
      slotBaseSegment: number,
      record: FabricLifecycleRecord,
    ) => {
      slotWrites.count += 1;
      slotWrites.arrays = arrays;
      slotWrites.capture?.push({ ...record });
      foldWrite(`${slotBaseSegment}|${record.fromX},${record.fromY},${record.fromZ}|`
        + `${record.ctrlX},${record.ctrlY},${record.ctrlZ}|`
        + `${record.toX},${record.toY},${record.toZ}|`
        + `${record.fromR},${record.fromG},${record.fromB}|`
        + `${record.toR},${record.toG},${record.toB}|`
        + `${record.bornAt}|${record.dyingAt}|${record.deathKind}|`
        + `${record.deadEnd}|${record.growDir}|`
        + `${brightnessGrain(record.brightnessMul)}|${record.trunkness};`);
      actual.writeFabricLifecycleSlot(arrays, slotBaseSegment, record);
    },
  };
});

function resetSlotWrites(): void {
  slotWrites.low = 0x811c9dc5;
  slotWrites.high = 0x01000193;
  slotWrites.count = 0;
  slotWrites.arrays = null;
  slotWrites.capture = null;
}

function streamDigest(): string {
  return `${slotWrites.low.toString(16).padStart(8, '0')}`
    + `${slotWrites.high.toString(16).padStart(8, '0')}`;
}

/** The GPU-facing arrays themselves — the write stream's own consequence, read
 *  once at the end so a write that never happened cannot hide. */
function arraysDigest(): string {
  const arrays = slotWrites.arrays as Record<string, Float32Array>;
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (const name of Object.keys(arrays).sort()) {
    const view = new Uint32Array(
      arrays[name].buffer,
      arrays[name].byteOffset,
      arrays[name].length,
    );
    for (let i = 0; i < view.length; i += 1) {
      low = Math.imul(low ^ view[i], 0x01000193) >>> 0;
      high = Math.imul(high ^ view[i], 0x85ebca6b) >>> 0;
    }
  }
  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`;
}

/** A Cell whose only fabric-relevant field is where it sits. */
function cell(id: number, x: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [x, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function mountFabric(): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(<NeuralFabric onReady={(ready) => { handles = ready; }} />);
  if (handles === null) throw new Error('NeuralFabric never handed over handles');
  return handles;
}

/** Blocks 0…4: the cold stage, then four chained landings, each applied WHOLE
 *  — the five unchained applies the gate names. */
const APPLIES = golden.perApply.length;

interface Applied {
  perApply: {
    block: number;
    edges: number;
    cells: number;
    added: number;
    revived: number;
    dying: number;
    stable: number;
    totalStates: number;
    writes: number;
    digest: string;
  }[];
  writes: number;
  streamDigest: string;
  arraysDigest: string;
  trunkTierEdges: number;
}

/** Apply the chain through `apply`, reading back the slots it wrote. */
function applyChain(
  apply: (handles: NeuralFabricHandles, block: number) => void,
): Applied {
  resetSlotWrites();
  resetFabricStats();
  resetSimClock();
  const handles = mountFabric();
  const perApply: Applied['perApply'] = [];
  for (let block = 0; block < APPLIES; block += 1) {
    const before = slotWrites.count;
    apply(handles, block);
    const { recentDiffs } = snapshotFabricStats();
    const last = recentDiffs[recentDiffs.length - 1];
    perApply.push({
      block,
      edges: fabricStageChain()[block].selection.edges.length,
      cells: fabricStageChain()[block].cells.size,
      added: last.added,
      revived: last.revived,
      dying: last.dying,
      stable: last.stable,
      totalStates: last.totalStates,
      writes: slotWrites.count - before,
      digest: streamDigest(),
    });
  }
  const stats = snapshotFabricStats();
  return {
    perApply,
    writes: slotWrites.count,
    streamDigest: streamDigest(),
    arraysDigest: arraysDigest(),
    trunkTierEdges: stats.trunkTierEdges,
  };
}

/** The INPUT the chain hands the fabric, folded the same way. The fabric is
 *  a pure function of it, so when a digest below moves this one says whether
 *  the stage moved under the test or the fabric did. */
function stageDigest(): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  const fold = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      low = Math.imul(low ^ code, 0x01000193) >>> 0;
      high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
    }
  };
  for (let block = 0; block < APPLIES; block += 1) {
    const { cells, selection } = fabricStageChain()[block];
    fold(`b${block}:${cells.size}:${selection.edges.length};`);
    for (const e of selection.edges) {
      const from = cells.get(e.from);
      const to = cells.get(e.to);
      fold(`${e.from},${e.to},${e.d},${e.w};`
        + `${from?.pos_seed.join(',')}>${to?.pos_seed.join(',')};`);
    }
  }
  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`;
}

function oneShot(handles: NeuralFabricHandles, block: number): void {
  const { cells, selection } = fabricStageChain()[block];
  handles.setFabric(selection, cells, 100 + block);
}

/** The same landing through the drain, with the budget a 60 Hz frame gives it
 *  — so the scan is cut wherever the budget falls, not at a tidy boundary.
 *  Returns what each simulated frame spent on it. */
function sliced(handles: NeuralFabricHandles, block: number): number[] {
  const { cells, selection } = fabricStageChain()[block];
  const queue = createFabricLandingQueue();
  enqueueFabricLanding(queue, {
    version: block,
    cells,
    passiveGraph: selection,
    delta: null,
  });
  const frameMs: number[] = [];
  while (queue.items.length > 0 && frameMs.length < 400) {
    const startedAt = performance.now();
    drainFabricLandingQueue(queue, {
      handles,
      budgetMs: fabricLandingBudgetMs(16.7),
      nowSec: 100 + block,
      nowMs: () => performance.now(),
    });
    frameMs.push(performance.now() - startedAt);
  }
  if (queue.items.length > 0) throw new Error('the drain never finished');
  return frameMs;
}

beforeEach(() => resetSlotWrites());

describe('a whole reconcile over the 12,000-Cell stage', () => {
  it('is what the committed record says the one-shot writes', () => {
    // The stage first: the fabric is a pure function of it, so a moved stage
    // is a different failure from a moved fabric and must not read as one.
    expect(stageDigest()).toBe(golden.stageDigest);
    const applied = applyChain(oneShot);
    expect(applied.perApply).toEqual(golden.perApply);
    expect(applied.writes).toBe(golden.writes);
    expect(applied.streamDigest).toBe(golden.streamDigest);
    expect(applied.arraysDigest).toBe(golden.arraysDigest);
    expect(applied.trunkTierEdges).toBe(golden.trunkTierEdges);
  }, 300_000);

  it('lands the same fabric when the drain slices it across frames', () => {
    const frames: number[] = [];
    const cut = applyChain((handles, block) => {
      frames.push(sliced(handles, block).length);
    });
    // Not one pass pretending to be many: the chained applies each took the
    // drain several frames.
    expect(Math.max(...frames.slice(1))).toBeGreaterThanOrEqual(2);
    // Against the one-shot in THIS process first — that is the claim, and a
    // failure here is about the slicing. The committed record below is the
    // second, weaker guard: if both sides move together it is the fixture or
    // the fabric under them that changed, not the cut.
    const shot = applyChain(oneShot);
    expect(cut.perApply).toEqual(shot.perApply);
    expect(cut.streamDigest).toBe(shot.streamDigest);
    expect(cut.arraysDigest).toBe(shot.arraysDigest);
    expect(cut.perApply).toEqual(golden.perApply);
    expect(cut.writes).toBe(golden.writes);
    expect(cut.streamDigest).toBe(golden.streamDigest);
    expect(cut.arraysDigest).toBe(golden.arraysDigest);
    expect(cut.trunkTierEdges).toBe(golden.trunkTierEdges);
  }, 300_000);
});

describe('what a whole reconcile freezes into a new edge', () => {
  it('takes the landing\'s exact weight, not the weight its record was left at', () => {
    // T12 lets a surviving record keep a weight up to `PASSIVE_WEIGHT_GRAIN`
    // behind the build's, because the two readers of a weight take the
    // landing's parallel array instead. This is the admission half of that:
    // the record here is a grain stale and the array is right, and what the
    // fabric freezes is what the array says.
    const cells = new Map<number, Cell>([
      [1, cell(1, 0)],
      [2, cell(2, 6)],
    ]);
    const exact = 0.7;
    const stale = exact - 0.019;
    const handles = mountFabric();
    slotWrites.capture = [];
    handles.setFabric(
      { edges: [{ from: 1, to: 2, d: 6, w: stale }], weights: Float64Array.of(exact) },
      cells,
      40,
    );
    const seed = fabricEdgeSeed(1, 2);
    expect(slotWrites.capture).toHaveLength(1);
    expect(slotWrites.capture![0].brightnessMul)
      .toBeCloseTo(arborBrightness(exact, seed), 12);
    expect(slotWrites.capture![0].trunkness).toBe(fabricEdgeTrunkness(exact));
    // The record the selection was handed is untouched — it is a value, and
    // whoever else holds it still reads the weight they were given.
    expect(stale).toBeLessThan(exact);
  });
});
