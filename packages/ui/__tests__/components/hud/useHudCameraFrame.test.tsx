import { useEffect, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHudCameraFrame, type HudCameraFrame } from '../../../src/components/hud/useHudCameraFrame';

let notifyResize: () => void;
let width: number;
let height: number;
let leftWidth: number;
let rightWidth: number;
let panelTop: number;
let panelHeight: number;

function Harness({ onFrame, onEffect, layout = 'wide', left = true, right = true }: {
  onFrame: (frame: HudCameraFrame) => void;
  onEffect?: () => void;
  layout?: string;
  left?: boolean;
  right?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  useHudCameraFrame(rootRef, leftRef, rightRef, layout, onFrame);
  useEffect(() => { onEffect?.(); }, [onEffect]);
  return (
    <div ref={rootRef} data-box="root">
      {left ? <div ref={leftRef} data-box="left" /> : null}
      {right ? <div ref={rightRef} data-box="right" /> : null}
    </div>
  );
}

beforeEach(() => {
  width = 1920;
  height = 1080;
  leftWidth = 370;
  rightWidth = 332;
  panelTop = 78;
  panelHeight = 500;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    // An inset host proves the published coordinates are local to the stage.
    const x = 32;
    const y = 16;
    const kind = this.dataset.box;
    const w = kind === 'root' ? width : kind === 'left' ? leftWidth : rightWidth;
    const h = kind === 'root' ? height : panelHeight;
    const left = kind === 'root' ? x : kind === 'left' ? x + 14 : x + width - 14 - w;
    const top = kind === 'root' ? y : y + panelTop;
    return { x: left, y: top, left, top, width: w, height: h, right: left + w, bottom: top + h, toJSON() {} };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HUD camera frame', () => {
  it('publishes the final horizontal reservation before passive effects', () => {
    const order: string[] = [];
    const onFrame = vi.fn(() => { order.push('frame'); });
    render(<Harness onFrame={onFrame} onEffect={() => { order.push('effect'); }} />);
    expect(order).toEqual(['frame', 'effect']);
    expect(onFrame).toHaveBeenCalledWith({
      width: 1920, height: 1080, hole: { left: 384, right: 1574 },
    });
  });

  it('does not mistake an unmeasured host or rail for a full-width stage', () => {
    width = 0;
    const onFrame = vi.fn();
    render(<Harness onFrame={onFrame} />);
    expect(onFrame).not.toHaveBeenCalled();
    width = 1920;
    leftWidth = 0;
    act(() => notifyResize());
    expect(onFrame).not.toHaveBeenCalled();
    leftWidth = 370;
    act(() => notifyResize());
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0][0].hole).toEqual({ left: 384, right: 1574 });
  });

  it('treats explicitly absent rails as a measured full-width stage', () => {
    const onFrame = vi.fn();
    render(<Harness onFrame={onFrame} left={false} right={false} />);
    expect(onFrame).toHaveBeenCalledWith({
      width: 1920, height: 1080, hole: { left: 0, right: 1920 },
    });
  });

  it('keeps the frame through loading, late content and duplicate resize deliveries', () => {
    const onFrame = vi.fn();
    const view = render(<Harness onFrame={onFrame} />);
    // Boot banners disappear; a collapsed rail can now stand entirely above
    // the middle band. Even late content changing its width is not an input.
    panelTop = 48;
    panelHeight = 90;
    leftWidth = 386;
    view.rerender(<Harness onFrame={onFrame} />);
    act(() => notifyResize());
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('re-measures for viewport dimensions and explicit panel-layout changes', () => {
    const onFrame = vi.fn();
    const view = render(<Harness onFrame={onFrame} />);
    width = 1440;
    height = 900;
    leftWidth = 298;
    rightWidth = 240;
    view.rerender(<Harness onFrame={onFrame} layout="collapsed" />);
    expect(onFrame).toHaveBeenLastCalledWith({
      width: 1440, height: 900, hole: { left: 312, right: 1186 },
    });
    act(() => notifyResize());
    expect(onFrame).toHaveBeenCalledTimes(2);
    height = 800;
    act(() => notifyResize());
    expect(onFrame).toHaveBeenLastCalledWith({
      width: 1440, height: 800, hole: { left: 312, right: 1186 },
    });
    view.rerender(<Harness onFrame={onFrame} layout="right-off" right={false} />);
    expect(onFrame).toHaveBeenLastCalledWith({
      width: 1440, height: 800, hole: { left: 312, right: 1440 },
    });
  });
});
