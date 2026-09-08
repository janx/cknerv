// The top bar's fold, which is a MEASUREMENT and not a screen size. The rule
// under test is small — want + slack against available, with hysteresis on the
// way back — and everything hard about it is where jsdom cannot follow: it
// lays nothing out, so every box reads 0 and every width here is a stub.
// That is the first thing pinned: zero is NO EVIDENCE, and the estimate goes
// on answering, live.
//
// ⚠️ THIS PACKAGE HAS A `ResizeObserver`, and it does nothing.
// `__tests__/test-setup.ts` polyfills a no-op one for r3f's `useMeasure`, so
// the hook takes its OBSERVER branch by default and a `resize` event moves
// nothing. Both paths are exercised below, each by saying which one it wants:
// the fallback tests take the global away, the observer test installs one that
// fires. A test that assumed jsdom's bare state would be testing neither.
//
// ⚠️ AND THE FIRST-FRAME PIN IS A SOURCE PIN, because it has to be.
// `render()` wraps everything in `act`, which flushes layout and passive
// effects together — measured either way, the DOM reads the same after
// `render()` returns and the same in a passive effect (checked, both ways).
// The difference only exists in a browser, between the commit and the paint.
// So the contract is held where it can be: the hook is read off disk and must
// measure in `useLayoutEffect`, the same bargain `useMediaQuery` argues for
// reading `matchMedia` in its state initialiser (report E, E-4).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  STATUS_STRIP_FOLD_ESTIMATE_MAX_WIDTH_PX,
  STATUS_STRIP_FOLD_ESTIMATE_QUERY,
  STATUS_STRIP_FOLD_HYSTERESIS_PX,
  STATUS_STRIP_FOLD_SLACK_PX,
  STATUS_STRIP_WIDE_MEASURED_PX,
  decideStatusStripFold,
  useStatusStripFold,
} from '../../../src/components/hud/useStatusStripFold';

/** The two boxes, answered by attribute: `render` creates them, so a test
 *  cannot stub the instances before the layout effect reads them. */
let want = 0;
let available = 0;

const RECT_ORIGINAL = HTMLElement.prototype.getBoundingClientRect;
const HOOK_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/hud/useStatusStripFold.ts'), 'utf8',
);

function rect(width: number): DOMRect {
  return {
    width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

type FakeObserverRecord = {
  targets: Element[];
  disconnected: boolean;
  fire: () => void;
};

/** A `ResizeObserver` that records instead of observing. jsdom has none, so
 *  without this the hook takes its `resize` fallback — which is a path worth
 *  testing, and is tested, but is not the one a browser runs. */
function installFakeResizeObserver(): FakeObserverRecord[] {
  const records: FakeObserverRecord[] = [];
  class FakeResizeObserver {
    private readonly record: FakeObserverRecord;

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        targets: [],
        disconnected: false,
        fire: () => callback([], this as unknown as ResizeObserver),
      };
      records.push(this.record);
    }

    observe(target: Element): void { this.record.targets.push(target); }

    unobserve(): void {}

    disconnect(): void { this.record.disconnected = true; }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return records;
}

/** Take the setup file's no-op observer away, so the hook falls back to the
 *  window's own `resize` — the path a browser without a `ResizeObserver` has,
 *  and the only one a `resize` event can drive. */
function withoutResizeObserver(): void {
  vi.stubGlobal('ResizeObserver', undefined);
}

function Harness({ estimate }: { estimate: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const folded = useStatusStripFold(probe, host, estimate);
  return (
    <div ref={host} data-fold-host data-folded={String(folded)}>
      <div ref={probe} data-fold-probe />
    </div>
  );
}

function foldedNow(container: HTMLElement): string | null {
  return container.querySelector('[data-fold-host]')?.getAttribute('data-folded') ?? null;
}

/** A viewport change, through the path a browser without a `ResizeObserver`
 *  has: the stubs move and the window says so. */
function resizeTo(nextAvailable: number): void {
  available = nextAvailable;
  act(() => { window.dispatchEvent(new Event('resize')); });
}

beforeEach(() => {
  want = 0;
  available = 0;
  HTMLElement.prototype.getBoundingClientRect = function measured(this: HTMLElement) {
    return rect(this.hasAttribute('data-fold-probe') ? want : 0);
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-fold-host') ? available : 0; },
  });
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = RECT_ORIGINAL;
  // jsdom keeps `clientWidth` on `Element.prototype`; the stub above is an own
  // property of `HTMLElement.prototype` and deleting it uncovers the real one.
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  vi.unstubAllGlobals();
});

describe('the fold constants', () => {
  it('derives the estimate rather than typing it', () => {
    // The one number `ui-app/index.html` restates. It is the measured row plus
    // its slack, minus one because `max-width` is inclusive — the rails'
    // `RAILS_COLLAPSE_MAX_WIDTH_PX` is written the same way and for the same
    // reason. `boot-shell.test.ts` reads the derivation off this file.
    expect(STATUS_STRIP_WIDE_MEASURED_PX).toBe(1079);
    expect(STATUS_STRIP_FOLD_SLACK_PX).toBe(24);
    expect(STATUS_STRIP_FOLD_HYSTERESIS_PX).toBe(16);
    expect(STATUS_STRIP_FOLD_ESTIMATE_MAX_WIDTH_PX).toBe(
      STATUS_STRIP_WIDE_MEASURED_PX + STATUS_STRIP_FOLD_SLACK_PX - 1,
    );
    expect(STATUS_STRIP_FOLD_ESTIMATE_MAX_WIDTH_PX).toBe(1102);
    expect(STATUS_STRIP_FOLD_ESTIMATE_QUERY)
      .toBe(`(max-width: ${STATUS_STRIP_FOLD_ESTIMATE_MAX_WIDTH_PX}px)`);
  });
});

describe('decideStatusStripFold', () => {
  it('treats a zero from either box as no evidence', () => {
    // jsdom, a `display: none` ancestor, a box read before its first layout.
    // None of them is a width of zero, so none of them may move the strip.
    expect(decideStatusStripFold(false, 0, 1180)).toBe(false);
    expect(decideStatusStripFold(true, 0, 1180)).toBe(true);
    expect(decideStatusStripFold(false, STATUS_STRIP_WIDE_MEASURED_PX, 0)).toBe(false);
    expect(decideStatusStripFold(true, STATUS_STRIP_WIDE_MEASURED_PX, 0)).toBe(true);
  });

  it('folds a wide row the pixel its slack runs out', () => {
    // 1,079 + 24 = 1,103: at 1,103 the spacer is exactly the two margins and
    // the row stands; at 1,102 it is one short and folds.
    expect(decideStatusStripFold(false, 1079, 1103)).toBe(false);
    expect(decideStatusStripFold(false, 1079, 1102)).toBe(true);
  });

  it('makes a folded row find the hysteresis before it stands up again', () => {
    // Unfolding costs 1,079 + 24 + 16 = 1,119. Between 1,103 and 1,119 the
    // answer depends on where the strip already stands, which is what stops
    // `LAG 9 → LAG 10` moving every rail on the page 28 px.
    expect(decideStatusStripFold(true, 1079, 1118)).toBe(true);
    expect(decideStatusStripFold(true, 1079, 1119)).toBe(false);
    expect(decideStatusStripFold(false, 1079, 1118)).toBe(false);
  });

  it('folds when the content grows into the room, not only when the room shrinks', () => {
    // The same page, a wider row: 1,100 + 24 = 1,124 does not fit 1,119.
    // A rule that only watched the viewport could not see this at all.
    expect(decideStatusStripFold(false, 1100, 1119)).toBe(true);
  });
});

describe('useStatusStripFold', () => {
  it('answers with the estimate while there is nothing to measure', () => {
    // Every box reads 0 here, which is jsdom's state and every existing
    // HudOverlay test's state: the media query goes on being the answer.
    const { container, rerender } = render(<Harness estimate={false} />);
    expect(foldedNow(container)).toBe('false');

    // …and it stays LIVE. A hook that wrote the estimate's value into state on
    // a no-evidence measurement would have frozen it at mount, and the query
    // would have stopped moving the strip for the rest of the session.
    rerender(<Harness estimate />);
    expect(foldedNow(container)).toBe('true');
  });

  it('lets a measurement outrank the estimate, both ways', () => {
    want = STATUS_STRIP_WIDE_MEASURED_PX;
    available = 1180;
    const wide = render(<Harness estimate />);
    // An 11-inch iPad: the query said fold, the row says it fits with 101 px
    // to spare. This is the whole change, in one assertion.
    expect(foldedNow(wide.container)).toBe('false');

    cleanup();
    available = 1024;
    const folded = render(<Harness estimate={false} />);
    // …and a 10.2-inch one folds even where a query would not have folded it.
    expect(foldedNow(folded.container)).toBe('true');
  });

  it('measures in a layout effect, so the first frame is the measured one', () => {
    // The pin this environment can actually hold (see the head of this file):
    // the measurement and the subscription are one LAYOUT effect. Measured in
    // a plain effect, the HUD would commit one frame of the estimate and then
    // move every rail on the page 28 px — a jump on the first paint, in the
    // same frames the boot band is holding still (report E, E-4).
    const body = /useStatusStripFold\([\s\S]*$/.exec(HOOK_SOURCE)?.[0] ?? '';
    expect(body, 'the hook stopped measuring before the paint')
      .toContain('useLayoutEffect(');
    expect(body, 'a second effect: the subscription must share the layout effect')
      .not.toMatch(/\buseEffect\(/);
  });

  it('re-decides on a resize where there is no ResizeObserver', () => {
    withoutResizeObserver();
    want = STATUS_STRIP_WIDE_MEASURED_PX;
    available = 1180;
    const { container } = render(<Harness estimate={false} />);
    expect(foldedNow(container)).toBe('false');

    resizeTo(1024);
    expect(foldedNow(container)).toBe('true');

    resizeTo(1400);
    expect(foldedNow(container)).toBe('false');
  });

  it('watches both boxes and lets go of them on unmount', () => {
    const observers = installFakeResizeObserver();
    want = STATUS_STRIP_WIDE_MEASURED_PX;
    available = 1180;
    const { container, unmount } = render(<Harness estimate />);

    expect(observers).toHaveLength(1);
    // The probe because content arrives — a chip, a font, a longer status
    // word; the host because the page is resized, rotated or split. Watching
    // one of them would leave half the rule unable to fire.
    expect(observers[0].targets).toEqual([
      container.querySelector('[data-fold-probe]'),
      container.querySelector('[data-fold-host]'),
    ]);
    expect(foldedNow(container)).toBe('false');

    // The row grew past the room it had — no viewport event anywhere.
    want = 1200;
    act(() => { observers[0].fire(); });
    expect(foldedNow(container)).toBe('true');

    expect(observers[0].disconnected).toBe(false);
    unmount();
    expect(observers[0].disconnected).toBe(true);
  });

  it('does not flap between two layouts a digit apart', () => {
    // The walk of the plan's fit table, on today's row: down through the fold
    // and back up through the hysteresis. 1,110 answers differently on the way
    // down and on the way up, and that is the feature.
    withoutResizeObserver();
    want = STATUS_STRIP_WIDE_MEASURED_PX;
    available = 1200;
    const { container } = render(<Harness estimate={false} />);
    const walk = [foldedNow(container)];
    for (const width of [1110, 1102, 1110, 1118, 1119]) {
      resizeTo(width);
      walk.push(foldedNow(container));
    }
    expect(walk).toEqual(['false', 'false', 'true', 'true', 'true', 'false']);
  });
});
