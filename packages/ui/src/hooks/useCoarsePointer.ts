import { mediaQueryMatches, useMediaQuery } from '../components/hud/useMediaQuery';

/**
 * Is the machine's PRIMARY pointer a coarse one — a finger rather than a
 * mouse, a trackpad or a stylus.
 *
 * ⭐ AND IT ANSWERS A DIFFERENT QUESTION FROM `pointerClickSlopPx`. That one
 * asks about a gesture and reads `PointerEvent.pointerType`, because a
 * gesture is made by one instrument and the reader may own several. This one
 * asks about the LAYOUT — how big a control has to be before anyone reaches
 * for it — and a layout has to be decided before the first press, for every
 * pointer that might arrive. So the two are not duplicates and neither can
 * stand in for the other: an iPad with a Magic Keyboard is `fine` here and
 * still reports `touch` for anything a finger does to the glass.
 *
 * `(pointer: coarse)` and not `(any-pointer: coarse)`: a desktop with a
 * touchscreen it never uses would otherwise get the tablet's control sizes
 * for the life of the session, and this instrument's density is the point of
 * it. The question is what the reader is DRIVING with, and the primary
 * pointer is the browser's own answer to that.
 *
 * Reactive: an iPad docked into a keyboard mid-session flips the primary
 * pointer, and every control that read this follows.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** The query, synchronously, for the callers that cannot hold a hook. False
 *  where there is no `matchMedia` to ask — an environment that cannot answer
 *  is not a touch screen. */
export function coarsePointerMatches(): boolean {
  return mediaQueryMatches(COARSE_POINTER_QUERY);
}

export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
