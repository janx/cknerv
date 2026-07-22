/** Clamp renderer DPR readings before they enter custom point-size shaders. */
export function resolvePointSpritePixelRatio(pixelRatio: number): number {
  return Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
}

/**
 * WebGL point size is measured in drawing-buffer pixels. Multiplying the CSS
 * viewport by renderer DPR keeps a world-space point the same apparent CSS
 * size across high, medium, and low quality canvases.
 */
export function pointSpriteDeviceViewportHeight(
  cssHeight: number,
  pixelRatio: number,
): number {
  const height = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  return height * resolvePointSpritePixelRatio(pixelRatio);
}
