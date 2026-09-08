import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { HudHole } from '../hudOcclusion';

export interface HudCameraFrame {
  width: number;
  height: number;
  hole: HudHole;
}

/** Reserve the rails' horizontal footprint for the camera. Unlike inspection
 * occlusion, this does not depend on panel heights or the top banner. Publish
 * before paint, then only for a viewport resize or an explicit panel-layout
 * change. Loading data and fonts must not recompose an already visible scene.
 * No publication means unmeasured; absent rails mean a measured full stage. */
export function useHudCameraFrame(
  rootRef: RefObject<HTMLElement>,
  leftRef: RefObject<HTMLElement>,
  rightRef: RefObject<HTMLElement>,
  layoutKey: string,
  onFrame: ((frame: HudCameraFrame) => void) | undefined,
): void {
  const lastInput = useRef<{ width: number; height: number; layoutKey: string } | null>(null);
  const lastFrame = useRef<HudCameraFrame | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !onFrame) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const { width, height } = box;
      if (width <= 0 || height <= 0) return;
      const previous = lastInput.current;
      if (previous?.width === width && previous.height === height
        && previous.layoutKey === layoutKey) return;

      const leftBox = leftRef.current?.getBoundingClientRect();
      const rightBox = rightRef.current?.getBoundingClientRect();
      // A mounted rail with no layout is not a disabled rail. Wait for the
      // host's first nonzero layout instead of fitting to an empty stage.
      if ((leftBox && leftBox.width <= 0) || (rightBox && rightBox.width <= 0)) return;
      const left = leftBox ? Math.max(0, Math.min(width, leftBox.right - box.left)) : 0;
      const right = rightBox ? Math.max(left, Math.min(width, rightBox.left - box.left)) : width;
      lastInput.current = { width, height, layoutKey };
      const frame = lastFrame.current;
      if (frame?.width === width && frame.height === height
        && frame.hole.left === left && frame.hole.right === right) return;
      const next = { width, height, hole: { left, right } };
      lastFrame.current = next;
      onFrame(next);
    };
    measure();
    // Observe only the host: watching the panels would make data arrival a
    // camera input again. Ignore an observer's initial delivery at the same
    // size; it can arrive after a banner or a font has already changed.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(root);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rootRef, leftRef, rightRef, layoutKey, onFrame]);
}
