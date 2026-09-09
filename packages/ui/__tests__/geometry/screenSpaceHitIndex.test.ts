import { describe, expect, it } from 'vitest';
import {
  ScreenSpaceHitIndex,
  type ScreenSpaceRadiusPad,
} from '../../src/geometry/screenSpaceHitIndex';

describe('ScreenSpaceHitIndex', () => {
  it('finds a sprite across bucket boundaries using its visual radius', () => {
    const index = new ScreenSpaceHitIndex(8, 32);
    index.begin(128, 96);
    index.insert(3, 31, 40, 12, 0.2);

    expect(index.find(40, 40)?.index).toBe(3);
    expect(index.find(50, 40)).toBeNull();
  });

  it('uses screen distance first and depth for near-equal overlaps', () => {
    const index = new ScreenSpaceHitIndex(8, 32);
    index.begin(128, 96);
    index.insert(1, 64, 48, 10, 0.6);
    index.insert(2, 64.2, 48, 10, 0.1);

    expect(index.find(64, 48)?.index).toBe(2);
    index.insert(4, 66, 48, 10, -0.2);
    expect(index.find(64, 48)?.index).toBe(2);
  });

  it('reuses storage across viewport rebuilds and rejects stale entries', () => {
    const index = new ScreenSpaceHitIndex(4, 16);
    index.begin(100, 100);
    index.insert(0, 20, 20, 8, 0);
    expect(index.find(20, 20)?.index).toBe(0);

    index.begin(50, 50);
    index.insert(1, 40, 40, 5, 0);
    expect(index.find(20, 20)).toBeNull();
    expect(index.find(40, 40)?.index).toBe(1);
  });
});

/** The entries under test, dense enough that a padded disc has to beat real
 * competitors rather than sit alone on an empty screen. */
const CROWD: ReadonlyArray<[number, number, number, number, number]> = [
  // index, x, y, radius, depth
  [0, 60, 60, 4, 0.5],
  [1, 96, 60, 5, 0.2],
  [2, 132, 62, 3, 0.9],
  [3, 60, 96, 6, 0.4],
  [4, 100, 100, 3, 0.1],
  [5, 150, 120, 7, 0.7],
  [6, 30, 130, 4, 0.3],
];

function crowd(padded?: { index: number; radius: number }): ScreenSpaceHitIndex {
  const index = new ScreenSpaceHitIndex(8, 32);
  index.begin(200, 160);
  for (const [i, x, y, radius, depth] of CROWD) {
    index.insert(i, x, y, i === padded?.index ? padded.radius : radius, depth);
  }
  return index;
}

/** The same crowd with every radius raised to `floor` — what a floored query
 *  has to answer exactly as. */
function flooredCrowd(floor: number): ScreenSpaceHitIndex {
  const index = new ScreenSpaceHitIndex(8, 32);
  index.begin(200, 160, floor);
  for (const [i, x, y, radius, depth] of CROWD) {
    index.insert(i, x, y, Math.max(radius, floor), depth);
  }
  return index;
}

function raster(
  index: ScreenSpaceHitIndex,
  pads?: readonly ScreenSpaceRadiusPad[],
  minRadiusPx?: number,
): Array<number | null> {
  const answers: Array<number | null> = [];
  for (let y = 1; y < 160; y += 3) {
    for (let x = 1; x < 200; x += 3) {
      answers.push(index.find(x, y, pads, minRadiusPx)?.index ?? null);
    }
  }
  return answers;
}

describe('ScreenSpaceHitIndex query-time radius pads', () => {
  it('answers exactly as an index built with the padded radius does', () => {
    // The equivalence bar: for every pointer position on the screen, a pad
    // must return what re-inserting that entry at the same radius returns —
    // ties, depth ordering, bucket walk order and all.
    for (const radius of [9, 17, 26, 40]) {
      const padded = crowd({ index: 1, radius });
      const base = crowd();
      expect(
        raster(base, [{ index: 1, radius }, { index: -1, radius: 0 }]),
      ).toEqual(raster(padded));
    }
  });

  it('leaves every unpadded query on the indexed radii', () => {
    // A pad is not a mutation: the same index answers both ways at once, so
    // a stale focus can never leak into an unfocused answer.
    const index = crowd();
    const answers = raster(index);
    expect(raster(index, [{ index: 1, radius: 40 }])).not.toEqual(answers);
    expect(raster(index)).toEqual(answers);
    expect(index.find(96, 96, [{ index: 1, radius: 40 }])?.index).toBe(1);
    expect(index.find(96, 96)).toBeNull();
  });

  it('widens the probe window by the pad, not just by the indexed max', () => {
    // The bug this pins: bucketRadius derived from maxRadius alone stops the
    // walk short of the padded entry's own bucket. 7px indexed, 40px padded,
    // 32px buckets — the pointer is three buckets away from every centre.
    const index = crowd();
    expect(index.find(60, 155, [{ index: 3, radius: 60 }])?.index).toBe(3);
    expect(index.find(60, 155)).toBeNull();
  });

  it('reports the radius the answer was decided by', () => {
    const index = crowd();
    expect(index.find(96, 62, [{ index: 1, radius: 20 }])?.radiusSq).toBe(400);
    expect(index.find(96, 62)?.radiusSq).toBe(25);
  });

  it('keeps entries a pad could still reach inside the grid', () => {
    // An entry whose centre is off-viewport but whose padded disc reaches
    // back in. Without the admit pad the insert drops it and no query-time
    // radius can bring it back, so the pad would answer differently from a
    // rebuild — which is the one thing it must never do.
    const admitted = new ScreenSpaceHitIndex(4, 32);
    admitted.begin(200, 160, 34);
    admitted.insert(0, -12, 80, 3, 0.5);
    expect(admitted.find(4, 80, [{ index: 0, radius: 30 }])?.index).toBe(0);
    // ...and it stays invisible to everyone who does not pad it.
    expect(admitted.find(4, 80)).toBeNull();

    const dropped = new ScreenSpaceHitIndex(4, 32);
    dropped.begin(200, 160);
    dropped.insert(0, -12, 80, 3, 0.5);
    expect(dropped.find(4, 80, [{ index: 0, radius: 30 }])).toBeNull();
  });
});

describe('ScreenSpaceHitIndex in-place radius patches', () => {
  it('answers exactly as an index built with the patched radius does', () => {
    // The same equivalence bar the pads are held to, for the write that
    // outlives the query: after a patch, EVERY pointer position on the screen
    // must return what a build at that radius returns — bucket walk order,
    // depth ties and all.
    for (const radius of [1, 9, 17, 26, 40]) {
      const patched = crowd();
      expect(patched.patch(1, 96, 60, radius, 0.2)).toBe(true);
      expect(raster(patched)).toEqual(raster(crowd({ index: 1, radius })));
    }
  });

  it('reports the patched radius as the one the answer was decided by', () => {
    const index = crowd();
    expect(index.find(96, 62)?.radiusSq).toBe(25);
    index.patch(1, 96, 60, 20, 0.2);
    expect(index.find(96, 62)?.radiusSq).toBe(400);
  });

  it('refuses, writing nothing, when the entry would MOVE', () => {
    // A patch keeps the bucket the centre put it in. A different centre is a
    // re-bucketing, which is chain surgery — and the caller's answer to that
    // is a rebuild, so the refusal has to leave the index untouched.
    const index = crowd();
    const before = raster(index);
    expect(index.patch(1, 97, 60, 20, 0.2)).toBe(false);
    expect(index.patch(1, 96, 61, 20, 0.2)).toBe(false);
    expect(raster(index)).toEqual(before);
  });

  it('refuses when the radius flips the admit verdict, either way', () => {
    // Admitted → rejected: a radius the insert would have dropped cannot be
    // written, because the entry is chained and its bucket walk would still
    // find it.
    const index = new ScreenSpaceHitIndex(4, 32);
    index.begin(200, 160, 34);
    expect(index.insert(0, 100, 80, 6, 0.5)).toBe(true);
    expect(index.patch(0, 100, 80, 0, 0.5)).toBe(false);
    expect(index.find(100, 80)?.index).toBe(0);

    // Rejected → admitted: an entry off the viewport by more than the admit
    // pad was never chained, so no store could put it in a bucket walk.
    expect(index.insert(1, -80, 80, 3, 0.5)).toBe(false);
    expect(index.patch(1, -80, 80, 90, 0.5)).toBe(false);
    expect(index.find(4, 80)).toBeNull();
  });

  it('is a no-op on a slot this build rejected, and says so', () => {
    // Rejected before and after: there is nothing chained to repair, and the
    // slot's stored centre belongs to an earlier build — so the patch must not
    // compare against that centre, and must not resurrect the entry.
    const index = new ScreenSpaceHitIndex(4, 32);
    index.begin(200, 160);
    index.insert(0, 100, 80, 6, 0.5);
    // The next build drops the entry off the viewport, where its own radius
    // cannot reach back in.
    index.begin(200, 160);
    expect(index.insert(0, -80, 80, 3, 0.5)).toBe(false);
    expect(index.admitted(0)).toBe(false);
    expect(index.patch(0, -80, 80, 4, 0.5)).toBe(true);
    expect(index.find(4, 80)).toBeNull();
    // ...and nothing was written where the earlier build had left it.
    expect(index.find(100, 80)).toBeNull();
  });

  it('grows the probe ceiling and never shrinks it inside a build', () => {
    // `maxRadiusPx` is what the probe window and the caller's drift bound are
    // derived from. A patch can raise it exactly; it cannot lower it without
    // walking the field, so a shrink leaves it high — conservative in both
    // readers, and reset by the next `begin`.
    const index = crowd();
    expect(index.maxRadiusPx).toBe(7);
    index.patch(1, 96, 60, 21, 0.2);
    expect(index.maxRadiusPx).toBe(21);
    index.patch(1, 96, 60, 2, 0.2);
    expect(index.maxRadiusPx).toBe(21);
    // ...and a too-large ceiling changes no answer: every candidate the wider
    // walk reaches is still tested against its own exact radius.
    expect(raster(index)).toEqual(raster(crowd({ index: 1, radius: 2 })));
    index.begin(200, 160);
    expect(index.maxRadiusPx).toBe(0);
  });
});


describe('ScreenSpaceHitIndex query-time radius floor', () => {
  it('answers exactly as an index built with every radius raised to it', () => {
    // The same equivalence bar the pads keep: for every pointer position on
    // the screen, a floored query must return what a rebuild at those radii
    // returns — ties, depth ordering and bucket walk order included.
    for (const floor of [8, 14, 22, 30]) {
      expect(raster(crowd(), undefined, floor)).toEqual(raster(flooredCrowd(floor)));
    }
  });

  it('leaves every unfloored query on the indexed radii', () => {
    // The whole point: one build answers a mouse exactly and a finger
    // forgivingly, within one frame, without storing either answer.
    const index = crowd();
    const precise = raster(index);
    expect(raster(index, undefined, 22)).not.toEqual(precise);
    expect(raster(index)).toEqual(precise);
    // 20 px from every centre: nothing a mouse could be pointing at, and
    // exactly the neighbourhood a fingertip covers.
    expect(index.find(80, 60)).toBeNull();
    expect(index.find(80, 60, undefined, 22)?.index).toBe(1);
  });

  it('gives the finger the NEAREST entry, not the first or the frontmost', () => {
    // Two competitors inside one finger: 0 at (60,60) and 1 at (96,60). The
    // pointer sits nearer 0, and 1 is nearer the camera — distance wins, so
    // the reader gets the Cell under their fingertip and not the one in
    // front of it.
    const index = crowd();
    expect(index.find(70, 60, undefined, 22)?.index).toBe(0);
    expect(index.find(88, 60, undefined, 22)?.index).toBe(1);
  });

  it('widens the probe window by the floor, not just by the indexed max', () => {
    // The bug a floor applied only in the radius test would have: the walk
    // stops at ceil(maxRadius / bucketSize) buckets and never reaches the
    // entry the floor was supposed to catch.
    const index = new ScreenSpaceHitIndex(4, 8);
    index.begin(200, 160, 30);
    index.insert(0, 100, 100, 2, 0.5);
    expect(index.find(100, 122)).toBeNull();
    expect(index.find(100, 122, undefined, 24)?.index).toBe(0);
  });

  it('is the last word, over a pad as well as over the indexed radius', () => {
    // A pad only ever grows a disc, so raising an already-padded one to the
    // floor can never shrink it.
    const index = crowd();
    expect(index.find(80, 60, [{ index: 1, radius: 8 }], 22)?.radiusSq).toBe(484);
    expect(index.find(96, 62, [{ index: 1, radius: 30 }], 22)?.radiusSq).toBe(900);
  });

  it('cannot reach what the index never admitted', () => {
    const empty = new ScreenSpaceHitIndex(4, 32);
    empty.begin(200, 160, 22);
    expect(empty.find(50, 50, undefined, 22)).toBeNull();
    // A floor is a query-time reading of entries the index HOLDS, and
    // `admits` keeps out anything with no radius at all — so an entry that
    // draws nothing stays unreachable however wide the finger is. That is
    // the same rule a pad lives under, and it is why the floor can never
    // answer differently from a rebuild.
    const invisible = new ScreenSpaceHitIndex(4, 32);
    invisible.begin(200, 160, 22);
    expect(invisible.insert(0, 50, 50, 0, 0.5)).toBe(false);
    expect(invisible.find(60, 50, undefined, 22)).toBeNull();
  });

  it('ignores a floor that is not a number', () => {
    const index = crowd();
    expect(raster(index, undefined, Number.NaN)).toEqual(raster(index));
    expect(raster(index, undefined, -5)).toEqual(raster(index));
  });
});
