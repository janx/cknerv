// The closed chip's equalizer used to be three `<rect>`s animated inside the
// note's SVG, which a browser can only animate on the main thread — style,
// paint and commit every frame for as long as the chip attracts. Each bar is
// its own outermost `<svg>` now, so the compositor runs the transform alone.
// These pins hold what may not have moved with it: the rects' geometry, the
// scale origins the old `transform-box: fill-box` gave them, the glow cast
// from the union of note and bars, the viewport clip, and the keyframes.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Jukebox from '../src/Jukebox';

const OPEN_LABEL = 'Open Jukebox and play default SoundCloud track';

afterEach(cleanup);

/** The three bars the single SVG drew, in the glyph's coordinates. */
const BARS = [
  { id: 'a', x: 12.2, y: 7.3, height: 5.1, origin: '1.4px 9.4px' },
  { id: 'b', x: 15.6, y: 3.3, height: 9.1, origin: '1.8px 9.4px' },
  { id: 'c', x: 19, y: 5.8, height: 6.6, origin: '1.2px 9.4px' },
] as const;

function mountGlyph(): HTMLElement {
  render(<Jukebox />);
  const opener = screen.getByRole('button', { name: OPEN_LABEL });
  return opener.querySelector('.cknerv-jukebox-glyph') as HTMLElement;
}

describe('Jukebox glyph', () => {
  it('keeps the single SVG\'s box, clip and glow on the wrapper the bars now live in', () => {
    const glyph = mountGlyph();
    expect(glyph.tagName).toBe('SPAN');
    expect(glyph.style.width).toBe('23px');
    expect(glyph.style.height).toBe('14px');
    // The old SVG clipped the group tick at its viewport's top edge; the
    // wrapper clips the same box. The glow is cast from the wrapper, so its
    // silhouette is still the union of note and bars.
    expect(glyph.style.overflow).toBe('hidden');
    expect(glyph.style.filter).toBe('drop-shadow(0 0 4px rgba(32,240,255,.55))');
    // The note stays one static SVG, and it carries no filter of its own.
    const note = glyph.querySelector(':scope > svg') as SVGSVGElement;
    expect(note.getAttribute('viewBox')).toBe('0 0 23 14');
    expect(note.style.filter).toBe('');
    expect(note.querySelectorAll('rect')).toHaveLength(0);
  });

  it('draws each bar as its own SVG root at the rect it always was, scaling about its bottom', () => {
    const glyph = mountGlyph();
    const group = glyph.querySelector('.cknerv-jukebox-bars') as HTMLElement;
    expect(group.tagName).toBe('SPAN');
    // The group's origin is the union's bottom centre — the fill box the
    // `<g>` had: (12.2 + 21.4) / 2 = 16.8, baseline 12.4.
    expect(group.style.left).toBe('12px');
    expect(group.style.top).toBe('3px');
    expect(group.style.transformOrigin).toBe('4.8px 9.4px');
    for (const bar of BARS) {
      const root = glyph.querySelector(`.cknerv-jukebox-bar-${bar.id}`) as SVGSVGElement;
      expect(root.tagName.toLowerCase()).toBe('svg');
      expect(root.classList.contains('cknerv-jukebox-bar')).toBe(true);
      const rect = root.querySelector('rect') as SVGRectElement;
      // Integer root offset plus the rect's fractional position lands on the
      // old rect exactly — the anti-aliased edge is at the same coordinate.
      const rootLeft = parseFloat(root.style.left) + parseFloat(group.style.left);
      const rootTop = parseFloat(root.style.top) + parseFloat(group.style.top);
      expect(rootLeft + Number(rect.getAttribute('x'))).toBeCloseTo(bar.x, 9);
      expect(rootTop + Number(rect.getAttribute('y'))).toBeCloseTo(bar.y, 9);
      expect(rect.getAttribute('width')).toBe('2.4');
      expect(Number(rect.getAttribute('height'))).toBeCloseTo(bar.height, 9);
      expect(Number.isInteger(parseFloat(root.style.left))).toBe(true);
      // …and the root scales about the rect's own bottom centre, which is
      // where `transform-box: fill-box; transform-origin: bottom` put it.
      expect(root.style.transformOrigin).toBe(bar.origin);
      expect(root.style.overflow).toBe('visible');
    }
  });

  it('keeps the keyframes, their timing and the settled gate word for word', () => {
    mountGlyph();
    const css = document.getElementById('cknerv-jukebox-style')?.textContent ?? '';
    expect(css).toContain('@keyframes cknerv-jukebox-eq-a{0%,100%{transform:scaleY(.42)}50%{transform:scaleY(1)}}');
    expect(css).toContain('@keyframes cknerv-jukebox-eq-b{0%,100%{transform:scaleY(1)}46%{transform:scaleY(.34)}}');
    expect(css).toContain('@keyframes cknerv-jukebox-eq-c{0%,100%{transform:scaleY(.6)}32%{transform:scaleY(.95)}}');
    expect(css).toContain('@keyframes cknerv-jukebox-tick{0%{transform:scaleY(1)}16%{transform:scaleY(1.55)}100%{transform:scaleY(1)}}');
    expect(css).toContain('.cknerv-jukebox-bar-a{animation:cknerv-jukebox-eq-a 2.4s ease-in-out infinite}');
    expect(css).toContain('.cknerv-jukebox-bar-b{animation:cknerv-jukebox-eq-b 3.1s ease-in-out infinite}');
    expect(css).toContain('.cknerv-jukebox-bar-c{animation:cknerv-jukebox-eq-c 2.7s ease-in-out infinite}');
    expect(css).toContain('.cknerv-jukebox-bars{animation:cknerv-jukebox-tick .52s ease-out 1}');
    expect(css).toContain(
      '[data-jukebox-attract="settled"] .cknerv-jukebox-glyph,'
      + '[data-jukebox-attract="settled"] .cknerv-jukebox-bar,'
      + '[data-jukebox-attract="settled"] .cknerv-jukebox-bars{animation:none}',
    );
    expect(css).toContain('@media (prefers-reduced-motion:reduce){.cknerv-jukebox-glyph,.cknerv-jukebox-bar,.cknerv-jukebox-bars{animation:none}}');
  });
});
