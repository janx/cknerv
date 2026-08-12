import { afterEach, describe, expect, it } from 'vitest';
import { restoreCellGalaxyFocus } from '../src/cell-galaxy-focus';

afterEach(() => {
  document.body.replaceChildren();
});

describe('restoreCellGalaxyFocus', () => {
  it('returns focus to the Galaxy Canvas without changing tab order', () => {
    const canvas = document.createElement('canvas');
    const detailControl = document.createElement('button');
    document.body.append(canvas, detailControl);
    detailControl.focus();

    restoreCellGalaxyFocus(canvas);

    expect(document.activeElement).toBe(canvas);
    expect(canvas.tabIndex).toBe(-1);
  });

  it('is safe before the Canvas ref is ready', () => {
    expect(() => restoreCellGalaxyFocus(null)).not.toThrow();
  });
});
