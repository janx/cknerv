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
    expect([...cohorts.matchAll(/lanes\.gulp\.needsUpdate = true;/g)])
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
    expect(cohorts).toContain(
      'writeCohortMotes(motesGeometry, index, RETIRED_SEAT, 0, 0);',
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
