// The Cell picker's hover word, and what it is allowed to touch.
//
// `onPointerMove` fires many times a second while the pointer sits on ONE Cell,
// and the picker answered every one of those with two DOM writes: the dataset
// word and the canvas cursor. Neither is free — a dataset write is an attribute
// mutation (and a wake-up for anything observing the canvas), and a `cursor`
// assignment is a CSSOM write and a style-attribute mutation — and both said
// exactly what they already said.
//
// ⚠️ The cursor is NOT a function of this layer alone: the causal lens and the
// network marks publish their own words on the same canvas and the cursor is
// the arbitration of all three (`cellCanvasCursor`). So the gate cannot be "the
// hovered id did not change"; it has to be "the value we are about to write is
// the value that is there", read from the element, which also re-asserts the
// cursor if another layer overwrote it.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyCellPickerHover } from '../../src/components/cellPickerHoverWord';
import { markPeerNodeHover } from '../../src/components/peerHoverWord';

let canvas: HTMLCanvasElement;
let observer: MutationObserver;

function mutations(): string[] {
  return observer.takeRecords().map((record) => record.attributeName ?? record.type);
}

beforeEach(() => {
  document.body.innerHTML = '';
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  observer = new MutationObserver(() => undefined);
  observer.observe(canvas, { attributes: true });
});

describe('the Cell picker publishes its hover word', () => {
  it('writes the word and the cursor when the pointer arrives', () => {
    expect(applyCellPickerHover(canvas, 42)).toBe(true);
    expect(canvas.dataset.cellPickerHover).toBe('42');
    expect(canvas.style.cursor).toBe('pointer');
    expect(mutations().sort()).toEqual(['data-cell-picker-hover', 'style']);
  });

  it('writes nothing at all while the pointer stays on the same Cell', () => {
    applyCellPickerHover(canvas, 42);
    mutations();

    for (let move = 0; move < 20; move += 1) {
      expect(applyCellPickerHover(canvas, 42)).toBe(false);
    }

    expect(mutations()).toEqual([]);
    expect(canvas.dataset.cellPickerHover).toBe('42');
    expect(canvas.style.cursor).toBe('pointer');
  });

  it('retracts the word once, and stays quiet off the canopy', () => {
    applyCellPickerHover(canvas, 42);
    mutations();

    expect(applyCellPickerHover(canvas, null)).toBe(true);
    expect(canvas.dataset.cellPickerHover).toBeUndefined();
    expect(canvas.style.cursor).toBe('');
    expect(mutations().sort()).toEqual(['data-cell-picker-hover', 'style']);

    for (let move = 0; move < 20; move += 1) {
      expect(applyCellPickerHover(canvas, null)).toBe(false);
    }
    expect(mutations()).toEqual([]);
  });

  it('moves the word, not the cursor, when the pointer crosses to another Cell', () => {
    applyCellPickerHover(canvas, 42);
    mutations();

    expect(applyCellPickerHover(canvas, 43)).toBe(true);
    expect(canvas.dataset.cellPickerHover).toBe('43');
    // The cursor was already `pointer` and is still `pointer`: one word moved,
    // one write.
    expect(mutations()).toEqual(['data-cell-picker-hover']);
  });

  it('keeps the cursor another layer is entitled to', () => {
    // A network mark under the same ray owns the pixel; the picker retracting
    // its own word must not take the cursor with it.
    markPeerNodeHover(canvas, 'QmPeer', 'measured');
    applyCellPickerHover(canvas, 42);
    mutations();

    expect(applyCellPickerHover(canvas, null)).toBe(true);
    expect(canvas.style.cursor).toBe('pointer');
    expect(mutations()).toEqual(['data-cell-picker-hover']);
  });

  it('re-asserts a cursor something else overwrote', () => {
    applyCellPickerHover(canvas, 42);
    canvas.style.cursor = 'crosshair';
    mutations();

    // The gate reads the element, not a remembered value, so a cursor that
    // drifted comes back on the next move rather than at the next hover change.
    expect(applyCellPickerHover(canvas, 42)).toBe(true);
    expect(canvas.style.cursor).toBe('pointer');
    expect(mutations()).toEqual(['style']);
  });
});
