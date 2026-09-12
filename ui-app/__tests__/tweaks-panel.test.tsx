// The dev panel is mounted when it is asked for.
//
// leva's `useControls` is called by the status strip, the sim clock and the
// adaptive-quality controller — three things a visitor's page mounts whether
// or not anyone wants a tuning panel — and every one of those subscriptions
// drags leva's whole bridge into the page's React work. `TweakSync` is the
// expensive half: five `useControls` over five full schemas, re-run on every
// App render, which is 3.6 ms of a block frame in a dev profile for a panel
// nobody has opened.
//
// ⚠️ The `<Leva>` element is NOT the expensive half and must not be unmounted
// with it: it is what SUPPRESSES leva's own always-visible panel. leva's
// `useRenderRoot` injects `#leva__root` into the body the first time a
// `useControls` consumer mounts while no `<Leva>` has claimed the root, and
// that injected panel wears leva's own skin, sits 10 px from the top right
// over CELL·03, and has no toggle. The suppressor therefore stays mounted and
// is memoized instead; what the backtick ARMS is the bridge.

import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A partial mock: leva's real `<Leva>` still draws, so the DOM assertions
// below are about the real panel — only `useControls` is wrapped, and it is
// wrapped because it is the one call `Tweaks` makes on every render. Its call
// count IS this component's render count, and `Tweaks` is the only consumer
// mounted in this file.
vi.mock('leva', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    useControls: vi.fn(actual.useControls as (...args: never[]) => unknown),
  };
});

import { useControls } from 'leva';
import Tweaks from '../src/Tweaks';
import {
  resetTweaksPanelForTest,
  toggleTweaksPanel,
  tweaksPanelSnapshot,
  useTweaksPanel,
} from '../src/tweaks-panel';

function backtick(target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: '`', bubbles: true,
    }));
  });
}

/** A reader of the panel state, so a test can watch what App would see. */
function Armed() {
  const panel = useTweaksPanel();
  return <span data-armed={panel.armed} data-shown={panel.shown} />;
}

const controls = useControls as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { resetTweaksPanelForTest(); controls.mockClear(); });
afterEach(() => { cleanup(); resetTweaksPanelForTest(); });

describe('the dev panel is armed by the backtick', () => {
  it('starts disarmed on an ordinary page', () => {
    render(<Armed />);
    expect(document.querySelector('[data-armed="true"]')).toBeNull();
    expect(tweaksPanelSnapshot()).toEqual({ armed: false, shown: false });
  });

  it('arms and opens on the first backtick, and toggles after it', () => {
    render(<Armed />);

    backtick();
    expect(tweaksPanelSnapshot()).toEqual({ armed: true, shown: true });
    expect(document.querySelector('[data-armed="true"][data-shown="true"]'))
      .not.toBeNull();

    // Closing does not disarm: the bridge stays mounted once someone has
    // asked for it, so a second open is instant and the knobs hold.
    backtick();
    expect(tweaksPanelSnapshot()).toEqual({ armed: true, shown: false });
  });

  it('leaves the backtick to a field the visitor is typing in', () => {
    render(<Armed />);
    const input = document.createElement('input');
    document.body.appendChild(input);

    backtick(input);

    expect(tweaksPanelSnapshot().armed).toBe(false);
    input.remove();
  });

  it('is armed and open from the first frame with ?dev=1', () => {
    resetTweaksPanelForTest('?dev=1');
    render(<Armed />);
    expect(tweaksPanelSnapshot()).toEqual({ armed: true, shown: true });
  });
});

describe('the leva root is claimed whether or not the panel is open', () => {
  it('draws no panel at rest and injects none of leva\'s own', () => {
    render(<Tweaks />);
    // `<Leva hidden>` renders null, so the closed panel is not DOM at all…
    expect(document.getElementById('leva__root')).toBeNull();
    expect(document.querySelector('[class*="leva"]')).toBeNull();
  });

  it('draws the panel when the store says it is open', () => {
    // The panel reads ONE state, and it is not its own: App has to know when
    // the visitor asked, so that it can mount the bridge in the same gesture.
    render(<Tweaks />);
    act(() => { toggleTweaksPanel(); });
    expect(document.querySelector('[class*="leva"]')).not.toBeNull();
  });
});

describe('the panel is not App\'s to re-render', () => {
  it('holds its render while its parent re-renders around it', () => {
    // `Tweaks` is App's first child and takes no props, so unmemoized it
    // re-ran — and re-registered its control with leva — on every App render:
    // once a block, plus every mempool tick, health poll and peers poll.
    let bump = () => {};
    function Parent() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      return <Tweaks />;
    }
    render(<Parent />);
    const atRest = controls.mock.calls.length;
    expect(atRest).toBeGreaterThanOrEqual(1);

    act(() => { bump(); });
    act(() => { bump(); });

    expect(controls.mock.calls.length).toBe(atRest);

    // …and it still answers the store, which is the only thing that may
    // change what it draws.
    act(() => { toggleTweaksPanel(); });
    expect(controls.mock.calls.length).toBeGreaterThan(atRest);
  });
});
