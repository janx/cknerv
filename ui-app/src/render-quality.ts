import type { QualityPreset } from '@cknerv/ui';

/** Query switches used by deterministic review/performance routes. Only an
 * explicit `=1` enables a switch so copied URLs cannot turn features on via an
 * empty or unrelated value. */
export function hasQuerySwitch(search: string, name: string): boolean {
  return new URLSearchParams(search).get(name) === '1';
}

/** The production dashboard owns AUTO by default. Deterministic review Labs
 * retain their High baseline unless the review URL explicitly asks to exercise
 * the adaptive controller. */
export function shouldApplyAutoStartupQuality(
  reviewRouteActive: boolean,
  search: string,
): boolean {
  return !reviewRouteActive || hasQuerySwitch(search, 'adaptive-quality');
}

/** Resolve a runtime Canvas DPR without ever supersampling below CSS-pixel
 * density. Invalid browser readings fall back to one. */
export function resolveCanvasDpr(devicePixelRatio: number, maxDpr: number): number {
  const deviceDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  return Math.min(deviceDpr, maxDpr);
}

/** AUTO's cold-start load classes, expressed as pixels in the drawing buffer
 * High would create. The 8 MP boundary puts both 4K@1x and 1080p@2x directly
 * on Med: the repository's paired 4K measurements found High missing vsync in
 * two windows of four while Med made it in all four. Above 20 MP, beginning at
 * Low avoids spending the entire warmup/calibration window on a plainly
 * oversized High buffer. This chooses only the opening ceiling; the lifetime
 * controller may still step down after sustained pressure and never steps up. */
export const AUTO_STARTUP_MED_BUFFER_PIXELS = 8_000_000;
export const AUTO_STARTUP_LOW_BUFFER_PIXELS = 20_000_000;

export function resolveAutoStartupQuality(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  highMaxDpr: number,
): QualityPreset {
  if (
    !Number.isFinite(cssWidth)
    || !Number.isFinite(cssHeight)
    || cssWidth <= 0
    || cssHeight <= 0
  ) return 'high';

  const highDpr = resolveCanvasDpr(devicePixelRatio, highMaxDpr);
  const highBufferPixels = cssWidth * cssHeight * highDpr * highDpr;
  if (highBufferPixels >= AUTO_STARTUP_LOW_BUFFER_PIXELS) return 'low';
  if (highBufferPixels >= AUTO_STARTUP_MED_BUFFER_PIXELS) return 'med';
  return 'high';
}

/** Whether to negotiate MSAA (the Canvas `antialias` context attribute) at
 * boot. MSAA is a multisampled default framebuffer resolved every frame at a
 * cost proportional to the drawing-buffer pixels, and it is largest exactly
 * where the DPR lever is already inert (>= 8 MP). It is a context attribute
 * fixed at Canvas creation and cannot follow the runtime tier, so it is decided
 * once from the same buffer class the startup ceiling uses: a buffer that opens
 * at MED or LOW (>= 8 MP) turns MSAA off, and only a HIGH-class buffer (< 8 MP)
 * keeps it on — for the hard edges it actually helps (the capsule
 * `LineSegments2`, the couriers, the icosahedra), whose fill is cheap there.
 * Unusable geometry keeps AA on, matching {@link resolveAutoStartupQuality}'s
 * deterministic HIGH fallback. */
export function resolveStartupAntialias(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  highMaxDpr: number,
): boolean {
  return (
    resolveAutoStartupQuality(cssWidth, cssHeight, devicePixelRatio, highMaxDpr)
    === 'high'
  );
}

/** Explicit deterministic quality override for screenshots and performance
 * review. Unknown values leave adaptive runtime ownership unchanged. */
export function resolveQualityOverride(search: string): QualityPreset | null {
  const requested = new URLSearchParams(search).get('quality');
  return requested === 'high' || requested === 'med' || requested === 'low'
    ? requested
    : null;
}
