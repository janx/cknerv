/**
 * The Cell picker's ONE hover word on the canvas, and the cursor it shares.
 *
 * Written from `CellGalaxy`'s `onPointerMove` — which fires many times a second
 * while the pointer sits on one Cell — and retracted by its unmount. Both
 * writes here are gated on the value that is already on the element, because
 * both cost something for saying what was already said: a dataset write is an
 * attribute mutation (and a wake-up for anything observing the canvas, which
 * the live hover oracle is), and a `cursor` assignment is a CSSOM write and a
 * style-attribute mutation.
 *
 * ⚠️ The gate cannot be "the hovered id did not change". The cursor is the
 * arbitration of three independent layers — this picker, the causal lens's own
 * word and the network marks' (`cellCanvasCursor`) — so the id can stand still
 * while the right cursor changes underneath it, and another layer can leave a
 * cursor of its own behind. Reading the element answers both: the write happens
 * when the element does not already say it, whoever last spoke.
 */
import { cellCanvasCursor } from '../derives/cellInteraction.derive';
import { peerNodeHovered } from './peerHoverWord';

/** Publish (or retract, with `null`) the picker's hover word and resolve the
 *  shared cursor. Returns whether the DOM was touched at all. */
export function applyCellPickerHover(
  canvas: HTMLElement,
  id: number | null,
): boolean {
  let touched = false;
  const word = id === null ? undefined : String(id);
  if (canvas.dataset.cellPickerHover !== word) {
    if (word === undefined) delete canvas.dataset.cellPickerHover;
    else canvas.dataset.cellPickerHover = word;
    touched = true;
  }
  // A nearer causal endpoint can stop propagation and deliberately own the
  // same screen point. Its marker remains the active affordance even when this
  // farther picker receives the synthetic pointer-out cleanup.
  const cursor = cellCanvasCursor(
    id !== null,
    canvas.dataset.cellCausalNavigationHover !== undefined,
    peerNodeHovered(canvas),
  );
  if (canvas.style.cursor !== cursor) {
    canvas.style.cursor = cursor;
    touched = true;
  }
  return touched;
}
