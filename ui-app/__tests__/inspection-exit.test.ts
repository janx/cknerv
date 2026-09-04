// The hold that gives a card an exit (C8).
//
// The contract is small and every clause of it is a defect somebody would
// otherwise hit: the selection outlives the close by exactly the fade, two
// closes do not stack, a selection that moved abandons the hold, and a page
// that goes away mid-exit runs nothing afterwards.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInspectionExit } from '../src/inspection-exit';

const EXIT_MS = 120;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useInspectionExit', () => {
  it('holds the selection for the length of the fade, then clears it', () => {
    const cleared = vi.fn();
    const { result } = renderHook(() => useInspectionExit(EXIT_MS));
    expect(result.current.leaving).toBe(false);

    act(() => { result.current.close(cleared); });
    // The card is told it is leaving on the same tick the × was pressed, and
    // the selection is still there for it to be drawn from.
    expect(result.current.leaving).toBe(true);
    expect(cleared).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(EXIT_MS - 1); });
    expect(cleared).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(result.current.leaving).toBe(false);
  });

  it('ignores a second close while one is running', () => {
    // Escape and the × reach the same handler, and a card can only leave once.
    const cleared = vi.fn();
    const { result } = renderHook(() => useInspectionExit(EXIT_MS));

    act(() => { result.current.close(cleared); });
    act(() => { vi.advanceTimersByTime(60); });
    act(() => { result.current.close(cleared); });
    act(() => { vi.advanceTimersByTime(60); });

    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('abandons the hold when the selection moved instead of ending', () => {
    // A cell → cell switch: the card stays and is re-dressed, so nothing may
    // clear the selection a hundred milliseconds later.
    const cleared = vi.fn();
    const { result } = renderHook(() => useInspectionExit(EXIT_MS));

    act(() => { result.current.close(cleared); });
    act(() => { result.current.cancel(); });
    expect(result.current.leaving).toBe(false);

    act(() => { vi.advanceTimersByTime(EXIT_MS * 4); });
    expect(cleared).not.toHaveBeenCalled();
  });

  it('cancels nothing when nothing is leaving', () => {
    const { result } = renderHook(() => useInspectionExit(EXIT_MS));
    act(() => { result.current.cancel(); });
    expect(result.current.leaving).toBe(false);
  });

  it('clears at once when there is no fade to wait for', () => {
    // Reduced motion, and any caller that passes 0: an exit of no length is a
    // close, not a hold, and it may not leave the selection alive for a frame.
    const cleared = vi.fn();
    const { result } = renderHook(() => useInspectionExit(0));

    act(() => { result.current.close(cleared); });
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(result.current.leaving).toBe(false);
  });

  it('runs nothing after the page goes away mid-exit', () => {
    const cleared = vi.fn();
    const { result, unmount } = renderHook(() => useInspectionExit(EXIT_MS));

    act(() => { result.current.close(cleared); });
    unmount();
    act(() => { vi.advanceTimersByTime(EXIT_MS * 4); });

    expect(cleared).not.toHaveBeenCalled();
  });
});
