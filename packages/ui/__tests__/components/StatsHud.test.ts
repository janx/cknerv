import { describe, expect, it } from 'vitest';

import { fmtCompact, fpsColor } from '../../src/components/StatsHud';

describe('fpsColor', () => {
  it('returns green at smooth-60 territory (≥55)', () => {
    expect(fpsColor(60)).toBe('#86efac');
    expect(fpsColor(55)).toBe('#86efac');
  });

  it('returns amber for jank (30-54)', () => {
    expect(fpsColor(54.9)).toBe('#fbbf24');
    expect(fpsColor(45)).toBe('#fbbf24');
    expect(fpsColor(30)).toBe('#fbbf24');
  });

  it('returns red below 30', () => {
    expect(fpsColor(29.9)).toBe('#f87171');
    expect(fpsColor(10)).toBe('#f87171');
    expect(fpsColor(0)).toBe('#f87171');
  });
});

describe('fmtCompact', () => {
  it('renders sub-1k counts as plain integers', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(1)).toBe('1');
    expect(fmtCompact(999)).toBe('999');
    expect(fmtCompact(142.7)).toBe('143');
  });

  it('renders 1k-100k with one decimal place', () => {
    expect(fmtCompact(1000)).toBe('1.0k');
    expect(fmtCompact(28_400)).toBe('28.4k');
    expect(fmtCompact(99_900)).toBe('99.9k');
  });

  it('rounds to integer once over 100k', () => {
    expect(fmtCompact(100_000)).toBe('100k');
    expect(fmtCompact(150_500)).toBe('151k');
    expect(fmtCompact(999_999)).toBe('1000k');
  });

  it('renders millions with one decimal', () => {
    expect(fmtCompact(1_000_000)).toBe('1.0M');
    expect(fmtCompact(2_500_000)).toBe('2.5M');
  });

  it('handles non-finite / negative as em-dash', () => {
    expect(fmtCompact(NaN)).toBe('—');
    expect(fmtCompact(Infinity)).toBe('—');
    expect(fmtCompact(-1)).toBe('—');
  });
});
