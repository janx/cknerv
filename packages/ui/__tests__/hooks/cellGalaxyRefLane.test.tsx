// The two lanes out of `CellGalaxyProvider`, and which consumers may take
// which.
//
// The VALUE lane subscribes: a consumer on it re-renders on every cells batch,
// which is two or three times a block. The REF lane does not: the handle's
// identity holds for the provider's life and its `current` advances at commit,
// so a frame callback can read the newest committed cache without its
// component being told anything. Both are load-bearing — a render-time
// decision has to be on the value lane or React cannot schedule it — and the
// whole cost of getting it wrong is invisible: nothing throws, the layer just
// re-renders for a cache it looks at once per landing.
//
// The layer this exists for is `BlockDeliveryLayer`, which reads the cells for
// exactly one thing (the nearest-Cell index a landing schedules its flashes
// off) and reads it at ingest time. Its wiring is pinned at the foot of the
// file: r3f v8's `<Canvas>` never mounts its children at 0×0, so the scene
// layer itself cannot be render-counted in jsdom — what can be, and is here,
// is the lane's own promise.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { memo } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyCellsCache, type CellGalaxyCache } from '@cknerv/cache';
import {
  CellGalaxyProvider,
  useCellGalaxyOptional,
  useCellGalaxyRefOptional,
} from '../../src/hooks/cellGalaxyContext';

afterEach(cleanup);

const BLOCK_DELIVERY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/BlockDeliveryLayer.tsx'),
  'utf8',
);

/** A cache generation, as a cells batch publishes one: a new object each time,
 *  because that is what makes React re-render the consumers of the value. The
 *  token rides on `revision`, which is a number the test can name; `cellsToken`
 *  is deliberately an opaque object with no readable value. */
function generation(revision: number): CellGalaxyCache {
  return { ...emptyCellsCache(), revision, cellsToken: {} };
}

/** Both probes are memoized and take no props, so the ONLY thing that can
 *  re-render either is a context it subscribed to. That is the reading. */
function lanes() {
  const renders = { value: 0, ref: 0 };
  const seen = {
    value: null as CellGalaxyCache | null,
    handle: null as { readonly current: CellGalaxyCache } | null,
  };
  const OnValue = memo(function OnValue() {
    renders.value += 1;
    seen.value = useCellGalaxyOptional();
    return null;
  });
  const OnRef = memo(function OnRef() {
    renders.ref += 1;
    seen.handle = useCellGalaxyRefOptional();
    return null;
  });
  return { renders, seen, OnValue, OnRef };
}

describe('the cells context has two lanes', () => {
  it('re-renders the value lane per generation and the ref lane not at all', () => {
    const { renders, OnValue, OnRef } = lanes();
    const view = render(
      <CellGalaxyProvider value={generation(1)}>
        <OnValue />
        <OnRef />
      </CellGalaxyProvider>,
    );
    expect(renders).toEqual({ value: 1, ref: 1 });

    for (let i = 2; i <= 4; i += 1) {
      act(() => {
        view.rerender(
          <CellGalaxyProvider value={generation(i)}>
            <OnValue />
            <OnRef />
          </CellGalaxyProvider>,
        );
      });
    }

    expect(renders.value, 'the value lane stopped subscribing').toBe(4);
    expect(renders.ref, 'the ref lane re-rendered for a cells batch').toBe(1);
  });

  it('still hands the ref lane the newest committed cache', () => {
    // The point of the lane: a layer that never re-renders must not be reading
    // a stale stage. `current` advances in a layout effect, so it is the cache
    // of the commit that just happened and never an uncommitted one.
    const { renders, seen, OnValue, OnRef } = lanes();
    const view = render(
      <CellGalaxyProvider value={generation(1)}>
        <OnValue />
        <OnRef />
      </CellGalaxyProvider>,
    );
    const handle = seen.handle;
    // What a frame callback reads, on a frame between two commits.
    expect(handle?.current.revision).toBe(1);

    act(() => {
      view.rerender(
        <CellGalaxyProvider value={generation(7)}>
          <OnValue />
          <OnRef />
        </CellGalaxyProvider>,
      );
    });

    expect(seen.value?.revision).toBe(7);
    // The layer never rendered — and the handle it is still holding carries
    // the stage as the last commit left it.
    expect(renders.ref).toBe(1);
    expect(seen.handle).toBe(handle);
    expect(handle?.current.revision).toBe(7);
  });

  it('answers null on both lanes in a galaxy-less scene', () => {
    const { seen, OnValue, OnRef } = lanes();
    render(<><OnValue /><OnRef /></>);
    expect(seen.value).toBeNull();
    expect(seen.handle).toBeNull();
  });
});

describe('the delivery layer is on the ref lane', () => {
  it('reads the cells at ingest time and subscribes to nothing', () => {
    expect(BLOCK_DELIVERY_SOURCE).toContain('useCellGalaxyRefOptional()');
    expect(BLOCK_DELIVERY_SOURCE).not.toContain('useCellGalaxyOptional');
    // The index is asked for where it is used — inside the landing branch of
    // the frame loop — rather than held in a memo the render has to reach.
    expect(BLOCK_DELIVERY_SOURCE).toContain('const readNearestCellIndex = () => {');
    expect(BLOCK_DELIVERY_SOURCE).toContain('cellsCacheRef?.current ?? null');
    expect(BLOCK_DELIVERY_SOURCE).not.toMatch(/const nearestCellIndex = useMemo/);
  });
});
