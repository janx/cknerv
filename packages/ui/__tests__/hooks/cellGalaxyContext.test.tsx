import { memo } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyCellsCache, type CellGalaxyCache } from '@cknerv/cache';
import {
  CellGalaxyProvider,
  useCellGalaxy,
  useCellGalaxyRef,
  type CellGalaxyCacheRef,
} from '../../src/hooks/cellGalaxyContext';

function cacheAt(lastPulseAtMs: number): CellGalaxyCache {
  return {
    ...emptyCellsCache(),
    revision: lastPulseAtMs,
    lastPulseAtMs,
  };
}

describe('CellGalaxyProvider cache lanes', () => {
  it('keeps ref consumers asleep while ordinary consumers update', () => {
    let subscribedRenders = 0;
    let frameRenders = 0;
    let frameCacheRef: CellGalaxyCacheRef | null = null;
    const readFrameCache = (): CellGalaxyCache => {
      const valueRef = frameCacheRef;
      if (valueRef === null) throw new Error('frame cache ref not mounted');
      return valueRef.current;
    };

    const SubscribedConsumer = memo(function SubscribedConsumer() {
      subscribedRenders += 1;
      const cache = useCellGalaxy();
      return <output data-testid="subscribed">{cache.lastPulseAtMs}</output>;
    });
    const FrameConsumer = memo(function FrameConsumer() {
      frameRenders += 1;
      frameCacheRef = useCellGalaxyRef();
      return <output data-testid="frame">frame</output>;
    });
    // Reuse the exact child elements so this measures Context propagation,
    // not ordinary parent reconciliation. Both consumers are memoized just as
    // the production CellGalaxy root is.
    const children = (
      <>
        <SubscribedConsumer />
        <FrameConsumer />
      </>
    );
    const initial = cacheAt(11);
    const view = render(
      <CellGalaxyProvider value={initial}>{children}</CellGalaxyProvider>,
    );

    expect(subscribedRenders).toBe(1);
    expect(frameRenders).toBe(1);
    expect(screen.getByTestId('subscribed').textContent).toBe('11');
    expect(frameCacheRef).not.toBeNull();
    expect(readFrameCache()).toBe(initial);

    const next = cacheAt(22);
    view.rerender(
      <CellGalaxyProvider value={next}>{children}</CellGalaxyProvider>,
    );

    expect(subscribedRenders).toBe(2);
    expect(frameRenders).toBe(1);
    expect(screen.getByTestId('subscribed').textContent).toBe('22');
    expect(readFrameCache()).toBe(next);

    const latest = cacheAt(33);
    view.rerender(
      <CellGalaxyProvider value={latest}>{children}</CellGalaxyProvider>,
    );
    expect(subscribedRenders).toBe(3);
    expect(frameRenders).toBe(1);
    expect(readFrameCache()).toBe(latest);
  });

  it('keeps both required hooks fail-fast outside the provider', () => {
    function SubscribedConsumer() {
      useCellGalaxy();
      return null;
    }
    function FrameConsumer() {
      useCellGalaxyRef();
      return null;
    }

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<SubscribedConsumer />)).toThrow(
        'useCellGalaxy() called outside',
      );
      expect(() => render(<FrameConsumer />)).toThrow(
        'useCellGalaxyRef() called outside',
      );
    } finally {
      error.mockRestore();
    }
  });
});
