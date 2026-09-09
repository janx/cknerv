import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CloseButton } from '../../../src/components/hud/primitives';
import {
  HUD_THEME_STYLE_ID,
  injectHudTheme,
} from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

describe('CloseButton', () => {
  it('renders a × and calls onClose on click', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CloseButton onClose={onClose} />);
    const btn = getByRole('button', { name: 'close' });
    expect(btn.textContent).toBe('×');
    expect((btn as HTMLElement).style.pointerEvents).toBe('auto');
    btn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a real button, so a keyboard can reach it and press it', () => {
    // It was a `<span role="button">` with no `tabIndex` and no key handler:
    // the only control on every card, unreachable by keyboard for the life of
    // the file (report E, E-13). A `<button>` is focusable and fires on Enter
    // and Space without a line of code saying so.
    const onClose = vi.fn();
    const { getByRole } = render(
      <>
        <button type="button">before</button>
        <CloseButton onClose={onClose} />
      </>,
    );
    const btn = getByRole('button', { name: 'close' });
    expect(btn.tagName).toBe('BUTTON');
    // `type="button"`, or a card rendered inside a form would submit it.
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.hasAttribute('disabled')).toBe(false);

    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the user agent\'s own button chrome', () => {
    // A `<button>` brings a border, a grey ground and the OS font with it, and
    // undoing that is not decoration — it is the price of the element.
    const { getByRole } = render(<CloseButton onClose={() => {}} />);
    const btn = getByRole('button', { name: 'close' }) as HTMLElement;
    expect(btn.style.border).toBe('0px');
    expect(btn.style.background).toBe('transparent');
    expect(btn.style.appearance).toBe('none');
    // The padding is no longer zero and is no longer chrome: it is where the
    // glyph's offsets went when the button grew a hand-sized reach around
    // them (see below).
    expect(btn.style.padding).toBe('6px 11px 0px 0px');
  });

  it('is big enough for a finger, without moving the glyph a pixel', () => {
    // The smallest target in the instrument: `×` measures 7.6 x 14 px, which
    // is 1.5 x 2.7 mm on an 11" iPad against a fingertip's 8-10 mm. Apple's
    // minimum is 44 pt, and the card's corner is composed — so the reach grows
    // INWARD, over the card's own empty corner, and the glyph stays put.
    const { getByRole } = render(<CloseButton onClose={() => {}} />);
    const btn = getByRole('button', { name: 'close' }) as HTMLElement;
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
    // `border-box`, or the padding would add to the 44 instead of living
    // inside it and the box would reach past the card's edges.
    expect(btn.style.boxSizing).toBe('border-box');
    // Anchored to the corner and the glyph pinned to ITS corner: top 0 +
    // 6 px of padding and right 0 + 11 px are the same two numbers the
    // button used to carry as offsets.
    expect(btn.style.top).toBe('0px');
    expect(btn.style.right).toBe('0px');
    expect(btn.style.alignItems).toBe('flex-start');
    expect(btn.style.justifyContent).toBe('flex-end');
  });

  it('answers a press, because a finger never hovers', () => {
    // The tint was `onMouseOver`/`onMouseOut` only, so on a touch screen the
    // one control every card carries acknowledged nothing until the card
    // vanished.
    const { getByRole } = render(<CloseButton onClose={() => {}} />);
    const btn = getByRole('button', { name: 'close' }) as HTMLElement;
    expect(btn.style.color).toBe('rgb(124, 135, 148)');
    fireEvent.pointerDown(btn);
    expect(btn.style.color).toBe('rgb(255, 48, 48)');
    fireEvent.pointerUp(btn);
    expect(btn.style.color).toBe('rgb(124, 135, 148)');
    // A press the browser takes away (a scroll claiming the gesture) must
    // not leave the control lit.
    fireEvent.pointerDown(btn);
    fireEvent.pointerCancel(btn);
    expect(btn.style.color).toBe('rgb(124, 135, 148)');
  });

  it('takes the HUD\'s focus ring, with every other button in the overlay', () => {
    // The theme's rule is an ELEMENT selector on purpose: no button has to opt
    // in, which is what the class rule could never promise — it covered four
    // strip controls and left a dozen others on Chromium's default ring.
    const document_ = document.implementation.createHTMLDocument('t');
    injectHudTheme(document_);
    const css = document_.getElementById(HUD_THEME_STYLE_ID)?.textContent ?? '';
    expect(css).toMatch(/(^|[\n,])button:focus-visible/);
    expect(css).toMatch(/button:focus-visible[^{]*\{outline:1px solid/);
    // …and the selection highlight beside it: a hex string being copied out of
    // a card was the last surface wearing the OS accent.
    expect(css).toMatch(/::selection\{background:rgba\(32, ?240, ?255, ?0?\.32\)\}/);
  });
});
