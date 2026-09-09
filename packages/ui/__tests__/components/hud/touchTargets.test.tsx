import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  CELL_DISPLAY_MAX,
  getCellDisplayRuntimeSnapshot,
  setCellDisplayLimit,
  setCellDisplayMode,
} from '../../../src/tweaks/cellDisplay';
import { setAdaptiveQuality, setQualityMode } from '../../../src/tweaks/qualityPresets';

const levaMocks = vi.hoisted(() => ({ setQuality: vi.fn() }));
vi.mock('leva', () => ({ useControls: () => [{ quality: 'auto' }, levaMocks.setQuality] }));

import StatusStrip from '../../../src/components/hud/StatusStrip';
import {
  HUD_THEME_STYLE_ID,
  TOUCH_TARGET_MIN_PX,
  injectHudTheme,
} from '../../../src/components/hud/hudTheme';
import { COARSE_POINTER_QUERY } from '../../../src/hooks/useCoarsePointer';

const panels = [
  { id: 'chain', code: 'CKB·01', label: 'COMMON KNOWLEDGE BASE', visible: true, defaultVisible: true },
  { id: 'pulse', code: 'ECG·04', label: 'PULSE', visible: true, defaultVisible: true },
];

/** jsdom answers no media query at all unless one is installed. `coarse`
 *  decides what `(pointer: coarse)` reports; every other query stays false,
 *  which is what jsdom already meant by having none. */
function installPointerMedia(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === COARSE_POINTER_QUERY ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayMode('auto');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('touch reach in the top bar', () => {
  it('gives every bar control the reach class, and none of them a bigger box', () => {
    // Measured on an 11" iPad in landscape: all eleven controls under 44 pt,
    // the worst of them 23 x 18 px. The row has 77 px of headroom before it
    // folds, so nothing here may grow its own WIDTH — the reach is a
    // pseudo-element and the layout is untouched.
    installPointerMedia(true);
    const { container } = render(
      <StatusStrip
        panelControls={panels}
        onPanelVisibilityChange={() => {}}
        build={{ version: '1.0.4@abc1234', href: 'https://example.invalid' }}
        enrichmentSource={{ source: 'ckbadger', status: 'ready', capabilities: [] }}
      />,
    );
    const reachable = container.querySelectorAll('.cknerv-touch-target');
    // The build chip, the PANELS toggle, AUTO/MAN, four quality options and
    // the ckbadger link.
    expect(reachable.length).toBeGreaterThanOrEqual(7);
    reachable.forEach((el) => {
      // Every one of them must be positioned, or the pseudo-element resolves
      // against some ancestor and lands somewhere else entirely. The theme
      // rule says so for the class; this pins that nothing overrides it with
      // an inline `position: static`.
      const inline = (el as HTMLElement).style.position;
      expect(inline === '' || inline === 'relative' || inline === 'absolute').toBe(true);
    });
  });

  it('states the reach once, in the theme, and only for a coarse pointer', () => {
    const document_ = document.implementation.createHTMLDocument('t');
    injectHudTheme(document_);
    const css = document_.getElementById(HUD_THEME_STYLE_ID)?.textContent ?? '';
    expect(css).toContain('@media (pointer: coarse)');
    expect(css).toContain('.cknerv-touch-target{position:relative}');
    // Height only. A wider box would overlap the neighbour — H, M and L stand
    // 23 px apart — and pressing one letter to get another is worse than a
    // small target.
    expect(css).toContain(`height:${TOUCH_TARGET_MIN_PX}px`);
    expect(css).toMatch(/\.cknerv-touch-target::after\{[^}]*left:0;right:0/);
    expect(css).not.toMatch(/\.cknerv-touch-target::after\{[^}]*width:/);
  });

  it('lets the panel menu simply BE the size a hand needs', () => {
    // Unlike the bar's own controls this row can grow: the dropdown exists
    // between two taps and is placed over the scene.
    const { container } = render(
      <StatusStrip panelControls={panels} onPanelVisibilityChange={() => {}} />,
    );
    fireEvent.click(container.querySelector('[data-panel-visibility-toggle]')!);
    const row = container.querySelector('[data-panel-control="chain"]') as HTMLElement;
    expect(row.style.height).toBe(`${TOUCH_TARGET_MIN_PX}px`);
  });
});

describe('the stage-cells cap is settable by hand', () => {
  /** jsdom implements no `PointerEvent`, so `fireEvent.pointerDown` degrades
   *  to a bare `Event` and drops `clientX` — which is the whole input here. A
   *  `MouseEvent` typed `pointerdown` carries it, and React reads the native
   *  event either way. */
  function press(el: HTMLElement, type: string, clientX: number): void {
    fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  }

  /** The invisible range input over the track, with a track-sized box. */
  function slider(container: HTMLElement, width = 64): HTMLInputElement {
    const input = container.querySelector('.cknerv-cell-display-slider') as HTMLInputElement;
    input.getBoundingClientRect = () => ({
      x: 100, y: 0, left: 100, right: 100 + width, top: 0, bottom: 18,
      width, height: 18, toJSON: () => ({}),
    }) as DOMRect;
    input.setPointerCapture = () => {};
    input.hasPointerCapture = () => true;
    return input;
  }

  it('sets the cap from where the pointer landed on the track', () => {
    // WebKit does not jump a range input's thumb to a track click — it wants
    // the THUMB grabbed — and this thumb is `opacity: 0` on a 64 px track, so
    // on an iPad the control held an invisible grip nobody could find.
    installPointerMedia(true);
    const { container } = render(
      <StatusStrip panelControls={panels} onPanelVisibilityChange={() => {}} cellCount={CELL_DISPLAY_MAX} cellCapacity={CELL_DISPLAY_MAX} />,
    );
    const input = slider(container);
    press(input, 'pointerdown', 100);
    const atFloor = getCellDisplayRuntimeSnapshot().manualLimit;

    press(input, 'pointerdown', 164);
    expect(getCellDisplayRuntimeSnapshot().manualLimit).toBe(CELL_DISPLAY_MAX);
    expect(getCellDisplayRuntimeSnapshot().manualLimit).toBeGreaterThan(atFloor);

    // …and a drag keeps setting it while the pointer is captured.
    press(input, 'pointerdown', 100);
    press(input, 'pointermove', 132);
    const midway = getCellDisplayRuntimeSnapshot().manualLimit;
    expect(midway).toBeGreaterThan(atFloor);
    expect(midway).toBeLessThan(CELL_DISPLAY_MAX);
  });

  it('clamps to the track and never past it', () => {
    installPointerMedia(true);
    const { container } = render(
      <StatusStrip panelControls={panels} onPanelVisibilityChange={() => {}} cellCount={CELL_DISPLAY_MAX} cellCapacity={CELL_DISPLAY_MAX} />,
    );
    const input = slider(container);
    press(input, 'pointerdown', 3000);
    expect(getCellDisplayRuntimeSnapshot().manualLimit).toBe(CELL_DISPLAY_MAX);
    press(input, 'pointerdown', -3000);
    expect(getCellDisplayRuntimeSnapshot().manualLimit).toBeLessThan(CELL_DISPLAY_MAX);
  });

  it('grows the grab box for a finger and leaves the mouse its hairline', () => {
    // The rail, the ticks and the cap marker are unmoved either way: the box
    // that grows paints nothing.
    installPointerMedia(true);
    const coarse = render(<StatusStrip panelControls={panels} onPanelVisibilityChange={() => {}} />);
    expect(
      (coarse.container.querySelector('.cknerv-cell-display-slider') as HTMLElement).style.height,
    ).toBe(`${TOUCH_TARGET_MIN_PX}px`);
    cleanup();

    installPointerMedia(false);
    const fine = render(<StatusStrip panelControls={panels} onPanelVisibilityChange={() => {}} />);
    expect(
      (fine.container.querySelector('.cknerv-cell-display-slider') as HTMLElement).style.height,
    ).toBe('100%');
  });

  it('keeps the gesture, so a scrolling ancestor cannot take the cap away', () => {
    installPointerMedia(true);
    const { container } = render(<StatusStrip panelControls={panels} onPanelVisibilityChange={() => {}} />);
    const input = container.querySelector('.cknerv-cell-display-slider') as HTMLElement;
    expect(input.style.touchAction).toBe('none');
  });
});
