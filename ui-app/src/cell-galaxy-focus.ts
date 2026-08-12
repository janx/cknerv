/** Return browser focus to the persistent Cell Galaxy interaction surface. */
export function restoreCellGalaxyFocus(
  canvas: HTMLCanvasElement | null,
): void {
  if (!canvas) return;
  // R3F's Canvas ref points at the inner <canvas>, while DOM props are placed
  // on its wrapper. Make the Galaxy rendering surface programmatically focusable
  // without adding it to the sequential keyboard tab order.
  canvas.tabIndex = -1;
  canvas.focus({ preventScroll: true });
}
