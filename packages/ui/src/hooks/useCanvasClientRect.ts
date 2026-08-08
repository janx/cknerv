import { useEffect, useRef, type RefObject } from 'react';

/** Low-frequency safety net for layout shifts that neither the canvas
 *  ResizeObserver nor a window `resize` reports (e.g. an ancestor reflow that
 *  moves a same-size canvas). */
export const CANVAS_CLIENT_RECT_SAFETY_REFRESH_MS = 1_000;

/**
 * Caches `canvas.getBoundingClientRect()` outside the render frame loop.
 *
 * Reading the rect inside `useFrame` forces a synchronous layout pass on any
 * frame where HUD React work has dirtied styles, which profiling showed as a
 * dominant jank source. The canvas is a fullscreen fixed element, so its rect
 * only changes with the viewport: a ResizeObserver plus a window `resize`
 * fallback refresh the cache event-driven, and a low-frequency interval
 * re-measures as a safety net. Frame loops read `ref.current` and never touch
 * layout themselves.
 */
export function useCanvasClientRect(
  canvas: HTMLCanvasElement,
): RefObject<DOMRect | null> {
  const rectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    const measure = () => {
      rectRef.current = canvas.getBoundingClientRect();
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    observer?.observe(canvas);
    window.addEventListener('resize', measure);
    const safetyRefresh = window.setInterval(
      measure,
      CANVAS_CLIENT_RECT_SAFETY_REFRESH_MS,
    );
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.clearInterval(safetyRefresh);
    };
  }, [canvas]);
  return rectRef;
}
