import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_CLIENT_RECT_SAFETY_REFRESH_MS,
  useCanvasClientRect,
} from '../../src/hooks/useCanvasClientRect';

interface RecordedObserver {
  callback: () => void;
  observed: Element[];
  disconnected: boolean;
}

function recordingResizeObserver(): RecordedObserver[] {
  const observers: RecordedObserver[] = [];
  class RecordingResizeObserver {
    private readonly record: RecordedObserver;

    constructor(callback: () => void) {
      this.record = { callback, observed: [], disconnected: false };
      observers.push(this.record);
    }

    observe(element: Element) {
      this.record.observed.push(element);
    }

    unobserve() {}

    disconnect() {
      this.record.disconnected = true;
    }
  }
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  return observers;
}

function trackedCanvas(initial: DOMRect) {
  const canvas = document.createElement('canvas');
  let rect = initial;
  const rectSpy = vi
    .spyOn(canvas, 'getBoundingClientRect')
    .mockImplementation(() => rect);
  return {
    canvas,
    rectSpy,
    setRect: (next: DOMRect) => {
      rect = next;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCanvasClientRect', () => {
  it('measures once on mount and serves reads without further layout queries', () => {
    const { canvas, rectSpy } = trackedCanvas(new DOMRect(3, 4, 800, 600));

    const { result } = renderHook(() => useCanvasClientRect(canvas));

    expect(rectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.current?.left).toBe(3);
    expect(result.current.current?.width).toBe(800);
    // Frame loops read the ref; reads must never trigger a layout query.
    expect(result.current.current?.height).toBe(600);
    expect(rectSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cached rect on window resize', () => {
    const { canvas, rectSpy, setRect } = trackedCanvas(
      new DOMRect(0, 0, 800, 600),
    );
    const { result } = renderHook(() => useCanvasClientRect(canvas));

    setRect(new DOMRect(0, 0, 1024, 768));
    window.dispatchEvent(new Event('resize'));

    expect(rectSpy).toHaveBeenCalledTimes(2);
    expect(result.current.current?.width).toBe(1024);
    expect(result.current.current?.height).toBe(768);
  });

  it('refreshes when the canvas ResizeObserver reports a size change', () => {
    const observers = recordingResizeObserver();
    const { canvas, setRect } = trackedCanvas(new DOMRect(0, 0, 800, 600));
    const { result } = renderHook(() => useCanvasClientRect(canvas));

    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([canvas]);

    setRect(new DOMRect(0, 0, 640, 480));
    observers[0].callback();

    expect(result.current.current?.width).toBe(640);
  });

  it('re-measures on the low-frequency safety interval', () => {
    vi.useFakeTimers();
    const { canvas, rectSpy, setRect } = trackedCanvas(
      new DOMRect(0, 0, 800, 600),
    );
    const { result } = renderHook(() => useCanvasClientRect(canvas));

    setRect(new DOMRect(0, 12, 800, 600));
    vi.advanceTimersByTime(CANVAS_CLIENT_RECT_SAFETY_REFRESH_MS - 1);
    expect(rectSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(rectSpy).toHaveBeenCalledTimes(2);
    expect(result.current.current?.top).toBe(12);
    // The safety refresh must stay low-frequency (≥1s) — it exists to catch
    // layout shifts neither resize channel reports, not to reintroduce
    // high-frequency forced layout.
    expect(CANVAS_CLIENT_RECT_SAFETY_REFRESH_MS).toBeGreaterThanOrEqual(1_000);
  });

  it('stops every refresh channel on unmount', () => {
    vi.useFakeTimers();
    const observers = recordingResizeObserver();
    const { canvas, rectSpy } = trackedCanvas(new DOMRect(0, 0, 800, 600));
    const { unmount } = renderHook(() => useCanvasClientRect(canvas));

    unmount();

    expect(observers[0].disconnected).toBe(true);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(CANVAS_CLIENT_RECT_SAFETY_REFRESH_MS * 3);
    expect(rectSpy).toHaveBeenCalledTimes(1);
  });
});
