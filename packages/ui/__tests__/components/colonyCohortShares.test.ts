// THE TWO THINGS A COHORT'S MARK LEARNS FROM A BLOCK, and neither of them may
// move its geometry or re-render a thing.
//
// The live producer window reaches the colony BY REFERENCE. `staging` is a
// fresh array on every attributed block — its tallies moved — and as a prop
// it defeated `memo(NetworkColony)` once a block, on top of the render the
// pulse itself costs. The holder's identity never changes; the cohort layer
// reads it once a frame by identity and rewrites its share lane exactly when
// the array does. These pins hold both halves: the lane's contents, and the
// once-per-change discipline of the writer.
//
// ⭐⭐ AND SINCE 2026-09-02, WHICH BLOCK IS A COHORT'S OWN. `ColonyFlood.entryId`
// is `attested:<key>` exactly when the chain named a producer this colony
// stands a node for, and `CohortMark.nodeId` is that same string built by the
// same `attestedNodeId` — so the gate is ONE STRING COMPARE against the id the
// wave itself leaves from, and a mark is structurally incapable of gulping for
// a block it did not make. The lane it writes is `aGulp`, in SIM SECONDS.
//
// ⭐⭐ AND SINCE 2026-09-03 EVERY LANE IS WRITTEN TWICE, AT TWO WIDTHS. The mark
// is two draws now — a ray-traced quad per cohort and a `THREE.Points` cloud of
// specks falling into it — and a Points geometry is not instanced: it has one
// vertex per MOTE, so the same fact has to be 96 copies wide over there. The
// last describe below is where that widening is measured: same values, same two
// walks, and a stamp that moves exactly one cohort's ninety-six slots.
//
// ⚠️ These are pure-function tests because they have to be: r3f effects do not
// run under jsdom (the `Canvas` never commits, so `onCreated` never fires and
// no geometry exists to read back), so the logic a block drives is extracted
// and pinned here, and the WIRING that drives it is pinned by source in
// `ColonySightedNodes.test.tsx`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cohortHandLane,
  cohortMassLane,
  cohortMassRelay,
  cohortShareLane,
  cohortWinLane,
  cohortWinStamp,
  type CohortMark,
} from '../../src/components/ColonyCohorts';
import {
  COHORT_GULP_RISE,
  COHORT_NEVER_WON,
} from '../../src/materials/colonyCohort';
import {
  COHORT_MASS_ANCHOR_SHARE,
  COHORT_MASS_FLOOR,
  cohortHandedness,
} from '../../src/materials/colonyLens';
import {
  COHORT_MOTES_PER_COHORT,
  buildCohortMotesGeometry,
  stampCohortMotes,
  writeCohortMotes,
} from '../../src/materials/colonyMotes';
import { mistShareFactor } from '../../src/materials/colonyMist';
import type { ProducerStanding } from '../../src/derives/blockProducers.derive';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

function mark(key: string, seed: number): CohortMark {
  return { producerKey: key, nodeId: `attested:${key}`, pos: [0, 0, 0], seed };
}

/** Only the fields the lane reads; the rest of a standing is the card's.
 *
 *  ⭐ `week` IS THE LEDGER'S SHARE, and it is a share of a DIFFERENT window:
 *  the indexer's seven complete days against the ring's 240 blocks. Each rides
 *  on the standing beside the denominator it was counted with, so the lane
 *  reads ONE of them and never combines the two. */
function standing(key: string, share: number, week?: number): ProducerStanding {
  return {
    key,
    share,
    ledger: week === undefined ? null : { share: week },
  } as ProducerStanding;
}

describe('cohortShareLane', () => {
  it('writes each staged cohort its live share, by key and never by position', () => {
    const marks = [mark('0xb', 0.2), mark('0xa', 0.7), mark('0xc', 0.4)];
    const share = new Float32Array(marks.length);
    // The window arrives in a different order from the marks; a positional
    // write would hand cohort b cohort a's share.
    cohortShareLane(marks, [standing('0xa', 0.56), standing('0xc', 0.02), standing('0xb', 0.3)], share);
    expect(Array.from(share)).toEqual([
      Math.fround(0.3), Math.fround(0.56), Math.fround(0.02),
    ]);
  });

  it('keeps a dropped cohort eating at the floor rate rather than stopping it', () => {
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7)];
    const share = new Float32Array([0.5, 0.5]);
    cohortShareLane(marks, [standing('0xa', 0.9)], share);
    // b left the view but its node is still standing: the lane says 0, not
    // "whatever was there".
    expect(Array.from(share)).toEqual([Math.fround(0.9), 0]);
    // No window at all is the same code path as an empty one.
    cohortShareLane(marks, null, share);
    expect(Array.from(share)).toEqual([0, 0]);
  });

  it('takes the WEEK when the ledger names the producer, and the ring when it does not', () => {
    // ⭐⭐ TWO WINDOWS, NEVER MIXED. `ledger.share` is this producer's fraction
    // of the indexer's seven complete days; `share` is its fraction of the last
    // 240 attributed blocks. They have different denominators, so the lane
    // reads one or the other — and it prefers the week, because the ring is
    // EMPTY for the first minute of every boot and after every reorg, exactly
    // when a rate driven off it would report every cohort as equal.
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7)];
    const share = new Float32Array(marks.length);
    cohortShareLane(
      marks,
      [standing('0xa', 0.5, 0.617), standing('0xb', 0.5)],
      share,
    );
    // a has a week and it wins over its ring reading; b has none and keeps the
    // ring's. Both stood at 0.5 in the window, so the lane could not have taken
    // the ring for a and still shown these two numbers.
    expect(Array.from(share)).toEqual([Math.fround(0.617), Math.fround(0.5)]);
    // ⚠️ A ledger-only producer is a REAL standing with `blocks 0` against the
    // ring, so its window share is a plain 0 — and the week is what the sink
    // must drink on, or a cohort the ring has lost stops taking anything.
    cohortShareLane(marks, [standing('0xa', 0, 0.023), standing('0xb', 0.4)], share);
    expect(Array.from(share)).toEqual([Math.fround(0.023), Math.fround(0.4)]);
  });

  it('returns the largest share it wrote, which is the lens’s divisor', () => {
    // ⭐ ONE WALK, ONE ANSWER. `uShareMax` is the divisor of a RATIO, so the
    // lane and the number the shader divides by must be computed together or a
    // frame can carry one without the other.
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7), mark('0xc', 0.4)];
    const share = new Float32Array(marks.length);
    expect(cohortShareLane(
      marks,
      [standing('0xa', 0.1), standing('0xb', 0.62), standing('0xc', 0.28)],
      share,
    )).toBeCloseTo(0.62, 12);
    // ⭐ It is the maximum over the STAGED marks, not over the window: a
    // producer the colony stands no node for cannot set the divisor for the
    // ones it does.
    expect(cohortShareLane(
      [mark('0xa', 0.2)],
      [standing('0xa', 0.1), standing('0xz', 0.9)],
      share,
    )).toBeCloseTo(0.1, 12);
    // ⚠️ AND 1 WHEN NOTHING POSITIVE WAS WRITTEN — no window, no marks, or a
    // window in which every staged cohort holds nothing. Every factor is then
    // the floor, which is the honest reading of "nobody here is taking
    // anything", and never a division by zero.
    expect(cohortShareLane(marks, null, share)).toBe(1);
    expect(cohortShareLane(marks, [standing('0xa', 0)], share)).toBe(1);
    expect(cohortShareLane([], [standing('0xa', 0.5)], share)).toBe(1);
  });
});

describe('cohortMassLane — a cohort’s size is its share of the WEEK', () => {
  const ANCHOR = COHORT_MASS_ANCHOR_SHARE;
  const FLOOR = COHORT_MASS_FLOOR;

  /** The targets as `ColonyCohorts` allocates them: every slot at 1, because a
   *  cohort nothing has been said about is the form this layer always drew. */
  function massTargets(entries: number): Float32Array {
    return new Float32Array(entries).fill(1);
  }

  it('writes each staged cohort its own factor, by key and never by position', () => {
    // ⭐⭐ THE SAME LAW `cohortShareLane` KEEPS, and it has to be kept again
    // here: the staged set reshuffles whenever a producer enters or leaves the
    // window, so a positional write would hand cohort b cohort a's SIZE — and a
    // size is the one lane the eye compares between neighbours.
    const marks = [mark('0xb', 0.2), mark('0xa', 0.7), mark('0xc', 0.4)];
    const target = massTargets(marks.length);
    expect(cohortMassLane(marks, [
      standing('0xa', 0.1, 0.6247),
      standing('0xc', 0.1, 0.0219),
      standing('0xb', 0.1, 0.1283),
    ], ANCHOR, FLOOR, target)).toBe(true);
    expect(target[0]).toBeCloseTo(0.598, 3);
    expect(target[1]).toBeCloseTo(1, 6);
    expect(target[2]).toBeCloseTo(FLOOR, 6);
  });

  it('reads the WEEK and ignores the ring, whichever way the two disagree', () => {
    // ⭐⭐⭐ THE OPPOSITE CHOICE FROM THE SHARE LANE, AND FOR THE OPPOSITE
    // REASON. `aShare` drives a RATE — read over seconds of watching, against
    // the busiest cohort in view — so it takes whichever window measured a
    // producer. A SIZE is read at a glance and compared across days: it must
    // not pulse once a block, and the 240-block ring moves on every block,
    // empties on every reorg and is empty for the first minute of every boot.
    const marks = [mark('0xa', 0.2)];
    const target = massTargets(1);
    // 60 % of the ring and 2 % of the week: the week decides, and it says small.
    cohortMassLane(marks, [standing('0xa', 0.6, 0.02)], ANCHOR, FLOOR, target);
    expect(target[0]).toBeCloseTo(FLOOR, 6);
    // …and the mirror: 1 % of the ring and 63 % of the week is the giant.
    cohortMassLane(marks, [standing('0xa', 0.01, 0.63)], ANCHOR, FLOOR, target);
    expect(target[0]).toBeCloseTo(1, 6);
  });

  it('says NO WEEK and sizes every cohort at 1 when nothing carries a ledger', () => {
    // ⭐⭐ NO LEDGER ⇒ TODAY'S PICTURE, BYTE FOR BYTE. A ckbadger outage, a
    // devnet, a boot before the first fetch: the honest answer to "how big is
    // this cohort" is then the form this layer drew before it could ask. The
    // RETURN is what says which of the two happened, so a caller can tell "the
    // week says everyone is full size" from "there is no week".
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7)];
    const target = new Float32Array([0.45, 0.6]);
    expect(cohortMassLane(
      marks,
      [standing('0xa', 0.9), standing('0xb', 0.1)],
      ANCHOR, FLOOR, target,
    )).toBe(false);
    expect(Array.from(target)).toEqual([1, 1]);
    // No window at all is the same code path as a window with no week in it.
    target.set([0.45, 0.6]);
    expect(cohortMassLane(marks, null, ANCHOR, FLOOR, target)).toBe(false);
    expect(Array.from(target)).toEqual([1, 1]);
    expect(cohortMassLane(marks, undefined, ANCHOR, FLOOR, target)).toBe(false);
    // …and ONE ledger row anywhere is a week: the rest of the colony is then
    // measured against it rather than exempted from it.
    expect(cohortMassLane(
      marks,
      [standing('0xa', 0.9, 0.6247), standing('0xb', 0.1)],
      ANCHOR, FLOOR, target,
    )).toBe(true);
    expect(target[0]).toBeCloseTo(1, 6);
    expect(target[1]).toBeCloseTo(FLOOR, 6);
  });

  it('floors a cohort the week does not name, which is what a newcomer IS', () => {
    // ⚠️ A READING AND NOT A MISSING VALUE. A producer inside the 240 blocks
    // and outside the seven days is brand new, or too small to have made the
    // adapter's 16-row cap, or a cohort the week has dropped that is still
    // standing — every one of those is "small this week", which is what the
    // floor says. The alternative, a mass of 1, would draw the colony's newest
    // and smallest mark at the giant's size.
    const marks = [mark('0xa', 0.2), mark('0xnew', 0.7)];
    const target = massTargets(marks.length);
    cohortMassLane(marks, [standing('0xa', 0.5, 0.6247)], ANCHOR, FLOOR, target);
    expect(target[0]).toBeCloseTo(1, 6);
    expect(target[1]).toBeCloseTo(FLOOR, 6);
    // A standing the RING knows and the week does not is the same thing: the
    // ring's 0.5 is not a size and is never read as one.
    cohortMassLane(
      marks,
      [standing('0xa', 0.5, 0.6247), standing('0xnew', 0.5)],
      ANCHOR, FLOOR, target,
    );
    expect(target[1]).toBeCloseTo(FLOOR, 6);
  });

  it('gives the live week its measured sizes: one giant, three middling, a tail', () => {
    // ⭐⭐ THE SHAPE THE CHANNEL EXISTS FOR, measured off ckbadger
    // `charts/miner-address-distribution?range=7d` (2026-08-27 → 2026-09-02,
    // 68,814 blocks, 7 rows). The cube root separates the giant from the rest
    // by 1.75× and keeps the whole range near the 3× step the peer-tier work
    // found legible: linear would spread these over 30× and put the tail under
    // a pixel, a logarithm would collapse the top into 1.0 / 0.84 / 0.82.
    const week = [0.6247, 0.1283, 0.1101, 0.0984, 0.0219, 0.0165, 0];
    const marks = week.map((_, index) => mark(`0x${index}`, index / week.length));
    const target = massTargets(marks.length);
    cohortMassLane(
      marks,
      week.map((share, index) => standing(`0x${index}`, 0, share)),
      ANCHOR, FLOOR, target,
    );
    const sizes = Array.from(target).map((value) => Math.round(value * 1000) / 1000);
    expect(sizes).toEqual([1, 0.598, 0.568, 0.547, FLOOR, FLOOR, FLOOR]);
    // …and it is MONOTONE, which is the only property the eye is asked to read.
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeLessThanOrEqual(sizes[index - 1]);
    }
  });

  it('takes the anchor and the floor from the panel — and floor 1 is the OFF switch', () => {
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7), mark('0xnew', 0.4)];
    const target = massTargets(marks.length);
    const window = [standing('0xa', 0, 0.6247), standing('0xb', 0, 0.1283)];
    // A lower anchor lifts everybody: 12.8 % of the week is full size against a
    // 12 % anchor, and the 62 % cohort clips at 1 rather than growing past it.
    cohortMassLane(marks, window, 0.12, FLOOR, target);
    expect(target[0]).toBeCloseTo(1, 6);
    expect(target[1]).toBeCloseTo(1, 6);
    // A higher floor lifts the tail without touching the top.
    cohortMassLane(marks, window, ANCHOR, 0.8, target);
    expect(target[0]).toBeCloseTo(1, 6);
    expect(target[1]).toBeCloseTo(0.8, 6);
    expect(target[2]).toBeCloseTo(0.8, 6);
    // ⭐⭐⭐ AND A FLOOR OF 1 IS THE WHOLE CHANNEL TURNED OFF — every mass
    // clamps to 1 whatever the week says, which is the picture this layer drew
    // before the lane was written and the OTHER half of the live leg's A/B.
    // ⚠️ It has to hold for the cohorts the week names AND for the ones it does
    // not, or the OFF page would still be drawing one small mark.
    cohortMassLane(marks, window, ANCHOR, 1, target);
    expect(Array.from(target)).toEqual([1, 1, 1]);
  });
});

describe('cohortMassRelay — a size follows the cohort, never the slot', () => {
  it('carries every cohort’s current size across a re-plan, by node id', () => {
    // ⭐⭐⭐ THE SAME BACK DOOR `cohortWinLane` CLOSES, with a worse symptom.
    // The lane is indexed by POSITION and the staged set reshuffles, so a walk
    // that left it alone would hand whoever takes slot 0 the previous
    // occupant's size — and then ease it away over a second and a half, which
    // reads as half the colony resizing because one cohort left the window.
    const before = [mark('0xa', 0.2), mark('0xb', 0.7)];
    const massNow = new Map([['attested:0xa', 1], ['attested:0xb', 0.52]]);
    const lane = new Float32Array(2).fill(1);
    cohortMassRelay(before, massNow, new Float32Array([1, 0.6]), 0, lane);
    expect(Array.from(lane)).toEqual([1, Math.fround(0.52)]);
    // `0xa` leaves the window and `0xc` arrives; `0xb` survives AT A NEW SLOT,
    // and its 0.52 moves with it rather than staying at index 1.
    const after = [mark('0xb', 0.7), mark('0xc', 0.4)];
    cohortMassRelay(after, massNow, new Float32Array([0.6, 0.45]), 0, lane);
    // ⚠️ …and `0xc`, which nothing has ever eased, starts AT ITS TARGET. A mark
    // appearing at 2 % of the week must be small the frame it appears; growth
    // is for a mass that CHANGED, never for a cohort that arrived.
    expect(Array.from(lane)).toEqual([Math.fround(0.52), Math.fround(0.45)]);
    // A colony with nothing eased yet is every mark at its own target.
    cohortMassRelay(after, null, new Float32Array([0.6, 0.45]), 0, lane);
    expect(Array.from(lane)).toEqual([Math.fround(0.6), Math.fround(0.45)]);
  });

  it('packs the hand into the SIGN, and the switch turns it off for everybody', () => {
    // ⭐ ONE LANE FOR TWO FACTS. The magnitude is the size and the sign is which
    // way the cohort winds — identity off the payout key's own seed, which is
    // what separates the middling cohorts the week makes the same size. A
    // second lane would be a whole float per VERTEX on the motes' 96-wide copy
    // for one bit that never changes over a cohort's life.
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7)];
    expect(cohortHandedness(0.2)).toBe(1);
    expect(cohortHandedness(0.7)).toBe(-1);
    const lane = new Float32Array(2);
    cohortMassRelay(marks, null, new Float32Array([0.6, 0.6]), 1, lane);
    expect(Array.from(lane)).toEqual([Math.fround(0.6), Math.fround(-0.6)]);
    // ⚠️ …and with the knob down every cohort is +1 with its MAGNITUDE
    // untouched: the switch may only change which way a mark winds, never how
    // big it is.
    cohortMassRelay(marks, null, new Float32Array([0.6, 0.6]), 0, lane);
    expect(Array.from(lane)).toEqual([Math.fround(0.6), Math.fround(0.6)]);
    // The switch is read at the half-way mark, because a panel value is a float
    // and a hand is a bit.
    expect(cohortHandLane(0.7, 0)).toBe(1);
    expect(cohortHandLane(0.7, 0.49)).toBe(1);
    expect(cohortHandLane(0.7, 0.5)).toBe(-1);
    expect(cohortHandLane(0.7, 1)).toBe(-1);
    expect(cohortHandLane(0.2, 1)).toBe(1);
  });
});

/** The gulp lane as `ColonyCohorts` allocates one: every slot at the sentinel,
 *  because an unwritten slot must read "has never won" and not "won at t = 0". */
function gulpLane(entries: number): Float32Array {
  return new Float32Array(entries).fill(COHORT_NEVER_WON);
}

/** The distance to the next representable float32 above `x` — the lane's
 *  resolution at that magnitude, read off the bits rather than estimated. */
function ulpAt(x: number): number {
  const value = new Float32Array([x]);
  const bits = new Uint32Array(value.buffer);
  const here = value[0];
  bits[0] += 1;
  return value[0] - here;
}

describe('cohortWinStamp — which block is a cohort’s own', () => {
  const marks = [mark('0xa', 0.2), mark('0xb', 0.7), mark('0xc', 0.4)];

  it('moves EXACTLY ONE mark’s slot, and it is the one the flood leaves from', () => {
    // ⭐⭐⭐ THE WHOLE GATE IS A STRING COMPARE, and this is what it buys: a
    // block cannot reach a mark except through the identity the chain itself
    // attested. Two cohorts stand either side of the one that won and neither
    // of them moves — which is the failure this layer's header spent six rounds
    // refusing to risk, and the reason it refused was that it took no input at
    // all rather than that a keyed input was unsafe.
    const gulp = gulpLane(marks.length);
    expect(cohortWinStamp(marks, 'attested:0xb', 12.5, gulp)).toBe(1);
    expect(Array.from(gulp)).toEqual([COHORT_NEVER_WON, 12.5, COHORT_NEVER_WON]);
  });

  it('fires NOTHING when the chain named nobody this colony stands a node for', () => {
    // ⭐⭐ THE ANONYMOUS GHOST PICK IS THE COMMON CASE, NOT AN ERROR. A block
    // whose cellbase names nobody, a producer that left the rolling window
    // between the pulse and this render, and every mid-session resync all land
    // on `pickOrigin`, whose id belongs to no cohort — and a degenerate colony
    // hands over `null`. Nothing swallowing is the scene saying what it was
    // told, and it is pinned so a later round cannot decide it looks like a bug
    // and "fix" it into a mouth gulping on somebody else's block.
    const gulp = gulpLane(marks.length);
    expect(cohortWinStamp(marks, null, 12.5, gulp)).toBe(-1);
    expect(cohortWinStamp(marks, undefined, 12.5, gulp)).toBe(-1);
    expect(cohortWinStamp(marks, '', 12.5, gulp)).toBe(-1);
    // The ghost pick's own id — an anonymous scatter node, which is what
    // `entryId` actually carries on such a block.
    expect(cohortWinStamp(marks, 'inf:37', 12.5, gulp)).toBe(-1);
    // A MEASURED worker, which is what `BlockDeliveryLayer` launches from and
    // what a cohort must never answer for.
    expect(cohortWinStamp(marks, 'peer:0x9f', 12.5, gulp)).toBe(-1);
    // …and a producer the chain DID name, whose mark this colony has not
    // staged: the pulse's key and the colony's window are two readings of one
    // rolling window taken on different streams, so this is ordinary too.
    expect(cohortWinStamp(marks, 'attested:0xz', 12.5, gulp)).toBe(-1);
    // ⚠️ AND A BARE KEY IS NOT AN ID. The prefix is the namespace the compare
    // rests on, so a caller that handed over `producerKey` instead of `nodeId`
    // must miss rather than quietly match.
    expect(cohortWinStamp(marks, '0xb', 12.5, gulp)).toBe(-1);
    // Not one number moved, in any of the seven.
    expect(Array.from(gulp)).toEqual([
      COHORT_NEVER_WON, COHORT_NEVER_WON, COHORT_NEVER_WON,
    ]);
  });

  it('leaves BOTH mouths swallowing when two blocks name two cohorts seconds apart', () => {
    // ⭐⭐⭐ THIS IS THE TEST THAT CHOSE A LANE OVER A UNIFORM. One index
    // broadcast to every instance would have to be overwritten by the second
    // block, cutting the first mark's swallow off mid-flight to hand the second
    // one its own — two cohorts a few seconds apart is an ordinary minute on
    // mainnet, not a corner. Each mark carrying its own moment means both run
    // to their end, side by side, with no sequencing anywhere on the CPU.
    const gulp = gulpLane(marks.length);
    cohortWinStamp(marks, 'attested:0xa', 10, gulp);
    cohortWinStamp(marks, 'attested:0xc', 12, gulp);
    expect(Array.from(gulp)).toEqual([10, COHORT_NEVER_WON, 12]);
    // …and a cohort that wins twice keeps only its LATEST block, because the
    // lane is a moment and not a tally.
    cohortWinStamp(marks, 'attested:0xa', 14, gulp);
    expect(Array.from(gulp)).toEqual([14, COHORT_NEVER_WON, 12]);
  });

  it('survives the trip into a Float32Array at every sim second a session reaches', () => {
    // ⚠️ THE LANE IS FLOAT32 AND THE STAMP IS FLOAT64, so what the shader
    // compares is the ROUNDED value — and what would break the envelope is not
    // the rounding but its STEP approaching the attack. Measured here rather
    // than argued: the step is 61 µs at 1e3 s, 0.98 ms at 1e4 s (2.8 hours of
    // session) and 7.8 ms at 1e5 s (27.8 hours), which is still under a seventh
    // of `COHORT_GULP_RISE`. The first magnitude where the step reaches a whole
    // second — and the envelope, over in three, quantises to three samples — is
    // 2^23 s, or 97 days of unbroken session.
    const gulp = gulpLane(1);
    for (const [at, step] of [[1e3, 6.103515625e-5], [1e4, 9.765625e-4], [1e5, 7.8125e-3]]) {
      cohortWinStamp([marks[0]], 'attested:0xa', at, gulp);
      expect([at, gulp[0]]).toEqual([at, Math.fround(at)]);
      expect([at, ulpAt(at)]).toEqual([at, step]);
      // The gulp's attack is still many lane steps wide at every one of them.
      expect([at, step < COHORT_GULP_RISE / 7]).toEqual([at, true]);
    }
    expect(ulpAt(2 ** 23)).toBe(1);
    // …and the sentinel itself is exact in float32, which is what lets the
    // lane hold "never won" as a value rather than as a flag.
    expect(Math.fround(COHORT_NEVER_WON)).toBe(COHORT_NEVER_WON);
    expect(gulpLane(3)[2]).toBe(COHORT_NEVER_WON);
  });
});

describe('cohortWinLane — a win belongs to a cohort, never to a slot', () => {
  it('re-lays every win under a new plan, so no slot inherits another’s block', () => {
    // ⭐⭐⭐ THE BACK DOOR INTO GULPING FOR THE WRONG COHORT, and it does not go
    // through a bad key: the lane is indexed by POSITION and the staged set
    // reshuffles whenever a producer enters or leaves the rolling window. A
    // walk that left the lane alone would hand whoever takes slot 0 the moment
    // its previous occupant won — a mark firing for somebody else's block,
    // arriving through a re-plan. So the win is held against the cohort and
    // re-laid whenever the plan moves, which is the law `cohortShareLane` has
    // always kept: by key, never by position.
    const before = [mark('0xa', 0.2), mark('0xb', 0.7)];
    const wonAt = new Map([['attested:0xa', 10], ['attested:0xb', 12]]);
    const gulp = gulpLane(2);
    cohortWinLane(before, wonAt, gulp);
    expect(Array.from(gulp)).toEqual([10, 12]);
    // `0xa` leaves the window and `0xc` arrives; `0xb` survives, AT A NEW SLOT
    // — and its win moves with it rather than staying at index 1.
    const after = [mark('0xb', 0.7), mark('0xc', 0.4)];
    cohortWinLane(after, wonAt, gulp);
    expect(Array.from(gulp)).toEqual([12, COHORT_NEVER_WON]);
    // …and a cohort with no win on record reads the sentinel, not a leftover.
    cohortWinLane(after, null, gulp);
    expect(Array.from(gulp)).toEqual([COHORT_NEVER_WON, COHORT_NEVER_WON]);
  });

  it('brings a cohort back with the win it left with, after a rolled window', () => {
    // ⭐ THE MAP OUTLIVES THE PLAN ON PURPOSE, and R16's version of it did not.
    // A peer poll that briefly loses a producer from the rolling window is
    // ordinary; a mark that came back reading the sentinel would be cutting a
    // swallow short for a block the chain never un-mined. `cohortWinLane` reads
    // the map and never edits it, so a cohort that vanishes from `marks` simply
    // stops being written — and is written again, with its own moment, the
    // first plan that stages it back.
    const wonAt = new Map([['attested:0xb', 33.25]]);
    // `0xb` is off stage: only `0xa` is planned, and it has never won.
    const alone = gulpLane(1);
    cohortWinLane([mark('0xa', 0.2)], wonAt, alone);
    expect(Array.from(alone)).toEqual([COHORT_NEVER_WON]);
    // …and the walk left the map alone, so `0xb`'s return finds its win.
    expect(wonAt.get('attested:0xb')).toBe(33.25);
    const back = gulpLane(2);
    cohortWinLane([mark('0xa', 0.2), mark('0xb', 0.7)], wonAt, back);
    expect(Array.from(back)).toEqual([COHORT_NEVER_WON, 33.25]);
  });

  it('lays the same lane the stamp writes, so neither can drift from the other', () => {
    // Both walks are addressed by the same index into the same Float32Array —
    // one entry per staged mark, no stride and no packing — which is the whole
    // reason the layer can re-lay a lane the pulse also writes.
    const marks = [mark('0xa', 0.2), mark('0xb', 0.7), mark('0xc', 0.4)];
    const gulp = gulpLane(marks.length);
    expect(cohortWinStamp(marks, 'attested:0xc', 4.5, gulp)).toBe(2);
    cohortWinLane(marks, new Map([['attested:0xc', 4.5]]), gulp);
    expect(Array.from(gulp)).toEqual([COHORT_NEVER_WON, COHORT_NEVER_WON, 4.5]);
  });
});

describe('the share lane follows the window by reference', () => {
  it('reads the standings off a ref once a frame and writes only when the array changed', () => {
    const cohorts = source('ColonyCohorts.tsx');
    // The writer: one identity test per frame, a walk only on a change.
    expect(cohorts).toContain('useFrame(() => {');
    expect(cohorts).toContain('const live = producersRef?.current ?? null;');
    expect(cohorts).toContain('if (live === writtenSharesRef.current) return;');
    // The walk itself is the pure function pinned above, and it marks the
    // lane once per walk.
    expect(cohorts).toContain('shareMaxRef.current = cohortShareLane(marks, producers, share);');
    expect(cohorts).toContain('lanes.share.needsUpdate = true;');
    // A rebuilt lane or a moved cohort set re-walks regardless of the window.
    expect(cohorts).toContain('}, [producersRef, writeShares]);');
    // Never an effect keyed on the array: that is the render this replaces.
    expect(cohorts).not.toContain('[lanes, marks, producers]');
  });

  it('threads the ref through the memoized colony root untouched', () => {
    const colony = source('NetworkColony.tsx');
    expect(colony).toContain('producersRef?: ProducerSharesRef | null;');
    expect(colony).toContain('producersRef={producersRef}');
    expect(colony).not.toContain('producers={producers}');
  });
});

describe('the mass lane is the week, eased into place', () => {
  const cohorts = source('ColonyCohorts.tsx');
  /** Everything from the ease's own frame callback to the end of the file —
   *  the walk whose upload discipline is the point of these pins. Nothing
   *  after it touches the mass lane, so a slice is enough to scope a count. */
  const slew = cohorts.slice(cohorts.indexOf('useFrame((_, dt) => {'));

  it('recomputes the targets on the SAME walk the share lane is written on', () => {
    // ⭐⭐ TWO FIELDS OF ONE OBJECT, READ TOGETHER. The rate takes whichever
    // window measured a producer and the size takes the seven days alone, so
    // reading them on two walks would let a frame carry a share from one poll
    // against a week from another — one walk, one set of standings, both lanes.
    const writer = cohorts.slice(
      cohorts.indexOf('const writeShares = useCallback('),
      cohorts.indexOf('}, [lanes, marks, motesGeometry]);'),
    );
    expect(writer).toContain(
      'cohortMassLane(marks, producers, knobs.anchor, knobs.floor, lanes.massTarget);',
    );
    expect(writer).toContain('knobs.anchor = LIVE.peer.cohortMassAnchor;');
    expect(writer).toContain('knobs.floor = LIVE.peer.cohortMassFloor;');
    // …and the two live `writeCohortMotes` calls hand the specks the lane's own
    // value rather than a 1, so the disc and the parcels falling into it cannot
    // be two different sizes. The third call is the retired tail, pinned below
    // at its literal.
    expect([...cohorts.matchAll(/writeCohortMotes\(/g)]).toHaveLength(3);
    expect([...cohorts.matchAll(/shareMaxRef\.current\),\s*mass\[index\],/g)])
      .toHaveLength(2);
  });

  it('eases on its OWN raw frame, and uploads only what actually moved', () => {
    // ⚠️ A SECOND CALLBACK BESIDE THE POLL, NEVER INSIDE IT. The share poll's
    // whole shape is an identity test and a one-line early return; a size that
    // moved has nothing to do with a window that did not, and folding the two
    // together would make the ease wait for a block.
    expect(cohorts).toContain('useFrame(() => {');
    expect(cohorts).toContain('if (live === writtenSharesRef.current) return;');
    expect(cohorts).toContain('useFrame((_, dt) => {');
    // ⚠️ THE RAW FRAME AND WALL `dt`: `useSimFrame` skips entirely under a
    // pause, and a ledger that cleared during one must not hold the old sizes
    // until the clock runs again. Clamped, because a backgrounded tab hands
    // over whole seconds on its first frame back.
    expect(slew).toContain('const step = dt > 0.1 ? 0.1 : dt > 0 ? dt : 0;');
    expect(slew).toContain('cohortMassApproach(');
    expect(slew).toContain('COHORT_MASS_SLEW_S,');
    // ⚠️⚠️ THE GATE IS THE DIFFERENCE BETWEEN AN EASE AND AN UPLOAD A FRAME FOR
    // THE LIFE OF THE TAB — 6,144 mote floats plus the lane, sixty times a
    // second, for a number that changes twice a session. Nothing moved ⇒
    // neither buffer is written and neither is flagged.
    expect(slew).toContain('if (Math.abs(mass[index] - value) <= 1e-4) continue;');
    expect(slew).toContain('writeCohortMotesMass(motesGeometry, index, value);');
    expect(slew).toContain('markCohortAttributeRange(lanes.mass, 0, marks.length);');
    expect([...slew.matchAll(/markCohortAttributeRange\(lanes\.mass, 0, marks\.length\);/g)])
      .toHaveLength(1);
    // …and no closure in the walk: `forEach` here would allocate one per frame.
    expect(slew).toContain('for (let index = 0; index < marks.length; index += 1) {');
  });

  it('holds the CURRENT size against the node id, so a re-plan carries it', () => {
    // ⭐⭐ THE `wonAtRef` PATTERN, FOR THE `wonAtRef` REASON: a slot index is
    // not an identity, and a size held by slot would be handed to whoever took
    // the slot and then eased away — half the colony resizing because one
    // cohort left the window.
    expect(cohorts).toContain('const massNowRef = useRef<Map<string, number>>(new Map());');
    expect(slew).toContain('const current = now.get(mark.nodeId);');
    expect(slew).toContain('if (eased !== current) now.set(mark.nodeId, eased);');
    // The re-lay under a plan is the pure function measured above, run off the
    // same map — and BEFORE the walk that writes the motes, because the specks'
    // 96 copies are read out of the lane it fills.
    expect(cohorts).toContain('cohortMassRelay(\n      marks,\n      massNowRef.current,');
    expect(cohorts.indexOf('cohortMassRelay('))
      .toBeLessThan(cohorts.indexOf('mistShareFactor(share[index] ?? 0, shareMaxRef.current),'));
    expect(cohorts).toContain('markCohortAttributeRange(lanes.mass, 0, marks.length);');
  });

  it('writes the lens lane through the PACK and through nothing else', () => {
    // ⚠️⚠️ A RAW MASS IN THE LANE WOULD LOSE THE HAND AND COULD HOLD A ZERO,
    // which is the one value neither program can read as an absence: the motes
    // divide by the birth radius, and a NaN there fails the `vBright <= 0.001`
    // gate and draws garbage. `cohortMassLaneValue` is the only writer — twice,
    // the re-lay and the ease — and it clamps the magnitude rather than
    // throwing, because a throw inside `useFrame` takes the whole loop down.
    expect([...cohorts.matchAll(/cohortMassLaneValue\(/g)]).toHaveLength(2);
    expect(cohorts).toContain('lane[index] = cohortMassLaneValue(');
    expect(slew).toContain('const value = cohortMassLaneValue(eased, cohortHandLane(mark.seed, handKnob));');
    expect(slew).toContain('mass[index] = value;');
  });

  it('reads its three knobs from the panel, and the floor is the OFF switch', () => {
    for (const knob of ['cohortMassAnchor', 'cohortMassFloor', 'cohortHand'] as const) {
      expect(cohorts, knob).toContain(`LIVE.peer.${knob}`);
    }
    // ⚠️ A KNOB THAT MOVED THE ANCHOR OR THE FLOOR MOVES EVERY TARGET AT ONCE,
    // and the targets are otherwise recomputed only once an attributed block —
    // so the panel is compared per frame, and it goes through the TARGETS
    // rather than through the lane, which is what makes the OFF switch a
    // second-and-a-half ease instead of a colony-wide pop.
    expect(slew).toContain('const knobs = massKnobsRef.current;');
    expect(slew).toContain(
      'if (anchor !== knobs.anchor || floor !== knobs.floor || handKnob !== knobs.hand) {',
    );
    expect(slew).toContain(
      'cohortMassLane(marks, writtenSharesRef.current, anchor, floor, lanes.massTarget);',
    );
    expect(slew).not.toMatch(/mass\[index\] = (?!value;)/);
  });
});

describe('the motes carry the same two lanes, ninety-six copies wide', () => {
  const marks = [mark('0xa', 0.2), mark('0xb', 0.7), mark('0xc', 0.4)];
  const cohorts = source('ColonyCohorts.tsx');

  it('stamps EXACTLY the named cohort’s 96 slots and no neighbour’s', () => {
    // ⚠️⚠️ THIS IS WHY THE INSTANCED LANE CANNOT SIMPLY BE HANDED OVER. Every
    // other draw in the feature reads ONE value per instance, so the layer can
    // bind one `InstancedBufferAttribute` to every geometry and know they gulp
    // on the same block. A Points geometry is one vertex per MOTE: the same
    // wrapper would be read by the first ninety-sixth of the colony's specks and
    // by garbage after it. So the value is widened, and what has to be pinned is
    // that the widening lands on the right ninety-six.
    const geometry = buildCohortMotesGeometry(marks.length);
    const gulp = geometry.getAttribute('aGulp');
    expect(gulp.count).toBe(marks.length * COHORT_MOTES_PER_COHORT);
    stampCohortMotes(geometry, 1, 12.5);
    for (let slot = 0; slot < gulp.count; slot += 1) {
      const cohort = Math.floor(slot / COHORT_MOTES_PER_COHORT);
      expect(`slot ${slot}: ${gulp.getX(slot)}`)
        .toBe(`slot ${slot}: ${cohort === 1 ? 12.5 : COHORT_NEVER_WON}`);
    }
    // …and a second cohort winning seconds later leaves the first one running,
    // exactly as the instanced lane does: two mouths, two moments, no sequencing.
    stampCohortMotes(geometry, 2, 14);
    expect(gulp.getX(COHORT_MOTES_PER_COHORT)).toBe(12.5);
    expect(gulp.getX(2 * COHORT_MOTES_PER_COHORT)).toBe(14);
    expect(gulp.getX(0)).toBe(COHORT_NEVER_WON);
  });

  it('is RE-LAID under a new plan from the same map, so a moved cohort keeps its burst', () => {
    // ⭐⭐ A WIN FOLLOWS THE COHORT AND NEVER THE SLOT — the same law
    // `cohortWinLane` keeps for the instanced lane, and it has to be kept twice
    // because the two lanes are two buffers. Here it is measured rather than
    // argued: `0xb` moves from slot 1 to slot 0 and its 12.5 moves with it.
    const wonAt = new Map([['attested:0xb', 12.5]]);
    const before = buildCohortMotesGeometry(marks.length);
    marks.forEach((m, index) => {
      stampCohortMotes(before, index, wonAt.get(m.nodeId) ?? COHORT_NEVER_WON);
    });
    expect(before.getAttribute('aGulp').getX(COHORT_MOTES_PER_COHORT)).toBe(12.5);
    // `0xa` leaves the window; `0xb` survives at a new slot.
    const after = [mark('0xb', 0.7), mark('0xc', 0.4)];
    const rebuilt = buildCohortMotesGeometry(marks.length);
    after.forEach((m, index) => {
      stampCohortMotes(rebuilt, index, wonAt.get(m.nodeId) ?? COHORT_NEVER_WON);
    });
    const gulp = rebuilt.getAttribute('aGulp');
    expect(gulp.getX(0)).toBe(12.5);
    expect(gulp.getX(COHORT_MOTES_PER_COHORT)).toBe(COHORT_NEVER_WON);

    // …and the layer really does run that walk, off the SAME map the instanced
    // lane is re-laid from — one `wonAtRef`, two widths, so the disc and the
    // specks cannot swallow different blocks.
    expect(cohorts).toContain(
      'wonAtRef.current.get(mark.nodeId) ?? COHORT_NEVER_WON,',
    );
    expect(cohorts).toContain(
      'cohortWinLane(marks, wonAtRef.current, lanes.gulp.array as Float32Array);',
    );
    // Two stamps in the file and no more: the re-lay under a plan and the write
    // on a pulse, which are exactly the two places the instanced lane moves.
    expect([...cohorts.matchAll(/stampCohortMotes\(/g)]).toHaveLength(2);
    expect([...cohorts.matchAll(/markCohortAttributeRange\(lanes\.gulp,/g)])
      .toHaveLength(2);
  });

  it('takes the share ALREADY WEIGHED, because it multiplies it straight into k', () => {
    // ⚠️ THE ONE ASYMMETRY BETWEEN THE TWO DRAWS, and it is a division of
    // labour rather than a difference of opinion. The lens's vertex stage runs
    // `MIST_SHARE_FACTOR_GLSL` on `aShare` — a floor of 0.35, normalised by the
    // busiest cohort in view — before the share becomes the sink's k; this
    // program has no such line and multiplies `aStrength` straight into `uK`.
    // So the layer runs the SAME function on the CPU, and the parity is that it
    // is the same function and not a second arithmetic.
    const share = new Float32Array([0.617, 0.023, 0]);
    const geometry = buildCohortMotesGeometry(marks.length);
    marks.forEach((m, index) => {
      writeCohortMotes(
        geometry,
        index,
        { x: m.pos[0], y: m.pos[1], z: m.pos[2] },
        m.seed,
        mistShareFactor(share[index], 0.617),
        1,
      );
    });
    const strength = geometry.getAttribute('aStrength');
    expect(strength.getX(0)).toBeCloseTo(1, 6);
    expect(strength.getX(COHORT_MOTES_PER_COHORT)).toBeCloseTo(0.374, 3);
    expect(strength.getX(2 * COHORT_MOTES_PER_COHORT)).toBeCloseTo(0.35, 6);
    // ⭐ IT IS THE WHOLE COHORT OR NOTHING, on both lanes: a partial write would
    // show as a wedge of one intake falling faster than the rest of it.
    for (let slot = 0; slot < COHORT_MOTES_PER_COHORT; slot += 1) {
      expect(strength.getX(slot)).toBe(strength.getX(0));
    }

    // …and the layer calls it from BOTH walks — the plan's and the window's —
    // because a re-plan and an attributed block each move a cohort's rate.
    expect([...cohorts.matchAll(/writeCohortMotes\(/g)]).toHaveLength(3);
    expect([...cohorts.matchAll(
      /mistShareFactor\(share\[index\] \?\? 0, shareMaxRef\.current\)/g,
    )]).toHaveLength(2);
    // ⚠️ AND THE THIRD CALL RETIRES A SLOT THE PLAN DROPPED. The geometry is
    // sized for `COHORT_MARK_CAP` and never rebuilt — a rebuild would drop every
    // live stamp — so a cohort that left the window has to be written OVER at a
    // strength of zero, or 96 specks keep spiralling into a seat nobody stands
    // at any more.
    // ⚠️ …AT A MASS OF 1 AND NEVER 0. A slot is retired by its STRENGTH; the
    // mass lane multiplies every length in the program, so a zero there is the
    // one value that is not an absence but a mark with no extent at all.
    expect(cohorts).toContain(
      'writeCohortMotes(motesGeometry, index, RETIRED_SEAT, 0, 0, 1);',
    );
    expect(cohorts).toContain('motesWrittenRef.current = marks.length;');
  });

  it('never rebuilds the specks’ buffer, which is what makes a stamp survive a re-plan', () => {
    // ⚠️ THE INSTANCED LANES ARE REBUILT ON A CAPACITY CHANGE and re-laid from
    // `wonAtRef` immediately after; the motes' geometry CANNOT be, because its
    // `aGulp` is a copy rather than a shared wrapper and a rebuild would drop the
    // live stamps before the re-lay could put them back. Sizing it at the cap
    // costs 6,144 vertices whose spare slots draw nothing at all.
    expect(cohorts).toContain('buildCohortMotesGeometry(COHORT_MARK_CAP),');
    expect(cohorts).toMatch(/motesGeometry = useMemo\(\s*\(\) => buildCohortMotesGeometry\(COHORT_MARK_CAP\),\s*\[\],\s*\)/);
    // An unwritten slot is not a mote by ARITHMETIC and not by a draw range: its
    // strength is zero and the program refuses anything below the live floor.
    const spare = buildCohortMotesGeometry(2);
    expect(spare.getAttribute('aStrength').getX(0)).toBe(0);
    expect(spare.getAttribute('aGulp').getX(0)).toBe(COHORT_NEVER_WON);
  });
});
