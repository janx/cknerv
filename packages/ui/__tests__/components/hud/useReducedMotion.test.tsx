// Both of the HUD's `matchMedia` hooks, and the one thing that was wrong with
// each: they started `false` and corrected themselves in an effect, so the
// FIRST committed frame was wrong for every visitor the query is about
// (report E, E-4). A reduced-motion visitor saw one frame of the scan lines,
// the ECG loop and the CELL MESH breathe; a 1,280 px page committed one frame
// with the wide 36 px strip and then moved every rail down 28 px.
//
// ⚠️ THE TESTS READ THE FIRST RENDER, NOT THE SETTLED ONE, and that is the
// whole design of this file. `render()` from testing-library wraps the render
// in `act`, which flushes effects before it returns — so a test that reads the
// container afterwards passes on the broken hook too, and the first draft of
// these did. The probe records what every render saw instead, and the
// assertion is on `seen[0]`.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { useReducedMotion } from '../../../src/components/hud/useReducedMotion';
import { mediaQueryMatches, useMediaQuery } from '../../../src/components/hud/useMediaQuery';

let seen: boolean[] = [];
function Probe() { seen.push(useReducedMotion()); return null; }
function QueryProbe({ query }: { query: string }) { seen.push(useMediaQuery(query)); return null; }

/** `matchMedia`, answering by query so a test can be about ONE of them. A
 *  listener is recorded rather than fired: nothing here is about the
 *  subscription, and a stub that resolved on subscribe would hide the bug
 *  these tests exist for. */
function stubMatchMedia(answer: (query: string) => boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: answer(query), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => { seen = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('useReducedMotion', () => {
  it('answers the query on the FIRST render, not after an effect', () => {
    stubMatchMedia(() => true);
    render(<Probe />);
    expect(seen[0], 'the first committed frame ran motion at a visitor who asked for none')
      .toBe(true);
    expect(new Set(seen)).toEqual(new Set([true]));
  });

  it('says no when the query says no', () => {
    stubMatchMedia(() => false);
    render(<Probe />);
    expect(seen[0]).toBe(false);
  });

  it('runs motion where there is no matchMedia to ask', () => {
    // Not a request for stillness — jsdom without a stub, or a browser old
    // enough not to answer. `HudOverlay.prefersFullMotion` says the same.
    const original = window.matchMedia;
    // @ts-expect-error deleting the global is the condition under test
    delete window.matchMedia;
    render(<Probe />);
    expect(seen[0]).toBe(false);
    window.matchMedia = original;
  });
});

describe('useMediaQuery', () => {
  it('answers on the first render, per query', () => {
    stubMatchMedia((query) => query === '(max-width: 1280px)');
    render(<QueryProbe query="(max-width: 1280px)" />);
    expect(seen[0], 'the first frame was laid out for the wrong viewport').toBe(true);
    cleanup();
    seen = [];
    render(<QueryProbe query="(max-width: 560px)" />);
    expect(seen[0]).toBe(false);
  });

  it('is one reader of matchMedia, shared with the reduced-motion hook', () => {
    // The helper both hooks seed from. Two copies of these three lines is how
    // the two of them came to disagree about the first frame at all.
    stubMatchMedia((query) => query.includes('reduce'));
    expect(mediaQueryMatches('(prefers-reduced-motion: reduce)')).toBe(true);
    expect(mediaQueryMatches('(max-width: 1280px)')).toBe(false);
  });
});
