/**
 * Vitest setup file — polyfills for jsdom environment.
 *
 * jsdom lacks ResizeObserver (used by react-use-measure / r3f Canvas) and
 * WebGL (Three.js). Stub both so component smoke tests can mount without
 * throwing.
 */

// ResizeObserver stub — r3f Canvas's useMeasure path requires it.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as Record<string, unknown>).ResizeObserver =
    ResizeObserverStub;
}

// Canvas 2D context stub — any module that calls `canvas.getContext('2d')`
// in tests (e.g. deliveryTextures.ts radial-gradient sprites) needs
// a 2D context. jsdom 25 returns null by default.
// Other contextIds fall through to the original (jsdom returns null for
// WebGL etc., which Three.js / r3f tolerate via the existing test paths).
if (typeof window !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (function stubGetContext(
    this: HTMLCanvasElement,
    contextId: string,
    ...args: unknown[]
  ) {
    if (contextId === '2d') {
      return {
        createRadialGradient: () => ({
          addColorStop: () => {},
        }),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        fillRect: () => {},
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
      } as unknown as CanvasRenderingContext2D;
    }
    return (origGetContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown)
      .call(this, contextId, ...args);
  }) as typeof HTMLCanvasElement.prototype.getContext;
}
