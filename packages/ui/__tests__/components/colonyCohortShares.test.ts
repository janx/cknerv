// The live producer window reaches the colony BY REFERENCE. `staging` is a
// fresh array on every attributed block — its tallies moved — and as a prop
// it defeated `memo(NetworkColony)` once a block, on top of the render the
// pulse itself costs. The holder's identity never changes; the cohort layer
// reads it once a frame by identity and rewrites its share lane exactly when
// the array does. These pins hold both halves: the lane's contents, and the
// once-per-change discipline of the writer.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cohortShareLane,
  type CohortMark,
} from '../../src/components/ColonyCohorts';
import type { ProducerStanding } from '../../src/derives/blockProducers.derive';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

function mark(key: string, seed: number): CohortMark {
  return { producerKey: key, nodeId: `attested:${key}`, pos: [0, 0, 0], seed };
}

/** Only the two fields the lane reads; the rest of a standing is the card's. */
function standing(key: string, share: number): ProducerStanding {
  return { key, share } as ProducerStanding;
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
    expect(cohorts).toContain('cohortShareLane(marks, producers, lanes.share.array as Float32Array);');
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
