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

/**
 * What AUTO will spend on a fanless machine, whatever its display says.
 *
 * A tablet reports `devicePixelRatio` 2 and a screen at 264 ppi, so an 11"
 * iPad in landscape asks for a 2360x1640 drawing buffer — 3.87 MP of the
 * additive halo, on a passively cooled GPU that will throttle rather than
 * spin a fan. The startup ceiling reads that as a HIGH-class buffer, which
 * is the right reading of the AREA and says nothing about the silicon: the
 * same 3.87 MP is a quiet frame on a desktop and a thermal budget here.
 *
 * 1.5 costs 44% of the fill (3.87 -> 2.18 MP) and costs the READING nothing,
 * because the HUD is a DOM overlay: every glyph, rail and figure stays at the
 * display's own density and only the galaxy renders coarser. And 1.5 is the
 * density this file already calls geometrically anti-aliased
 * ({@link MSAA_OFF_MIN_DPR}) — an edge is spread across more than one sample
 * before anything multisamples it — so the picture loses less than the
 * arithmetic suggests.
 *
 * ⭐ AUTO ONLY. A reader who names a tier has said what they want the picture
 * to be, and this is a machine's budget, not a preference. `high` chosen by
 * hand still renders at the display's full density on the same tablet — it
 * may drop frames, and that is the reader's call to make.
 */
export const COARSE_POINTER_AUTO_MAX_DPR = 1.5;

/** Resolve a runtime Canvas DPR without ever supersampling below CSS-pixel
 * density. Invalid browser readings fall back to one.
 *
 * `coarseAuto` is "a touch device, with AUTO still holding the tier" and
 * lowers the ceiling to {@link COARSE_POINTER_AUTO_MAX_DPR}. It lowers only:
 * a preset whose own `maxDpr` is already below it keeps its own answer. */
export function resolveCanvasDpr(
  devicePixelRatio: number,
  maxDpr: number,
  coarseAuto = false,
): number {
  const deviceDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  const ceiling = coarseAuto
    ? Math.min(maxDpr, COARSE_POINTER_AUTO_MAX_DPR)
    : maxDpr;
  return Math.min(deviceDpr, ceiling);
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

/** The drawing-buffer density at or above which MSAA stops paying, whatever
 * the area. A buffer of 1.5 device pixels per CSS pixel already anti-aliases
 * geometrically — an edge is spread across more than one sample before any
 * multisampling — while the multisample resolve multiplies exactly the thin
 * passes this scene is made of. Measured on the 890M at 1920×960 CSS @2× (a
 * 3840×1920 buffer: 7.37 MP, a HIGH-class window under the 8 MP boundary): the
 * MSAA context cost 2.2× the scene GPU time of the same page without it —
 * residual fibres 2.5 → 6.5 ms, fabric base 0.46 → 1.5, bridge 0.22 → 1.0,
 * cell bodies 0.55 → 1.9. Below this density MSAA is still worth its resolve,
 * because there the hard edges it helps (the capsule `LineSegments2`, the
 * couriers, the icosahedra) are one device pixel wide with nothing else to
 * soften them. */
export const MSAA_OFF_MIN_DPR = 1.5;

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
 * cost proportional to the drawing-buffer pixels. It is a context attribute
 * fixed at Canvas creation and cannot follow the runtime tier, so it is decided
 * once, from two readings of the buffer High would create, in this order.
 *
 * Density first: a buffer at {@link MSAA_OFF_MIN_DPR} or denser gets no MSAA at
 * any area, because such a buffer already anti-aliases geometrically while the
 * resolve multiplies precisely this scene's thin passes (the measurement lives
 * at the constant). The density read is the buffer's, not the display's —
 * `resolveCanvasDpr` first clamps the browser's reading to High's own ceiling —
 * so a browser reporting 8 on a 2-capped buffer is dense at 2, and an invalid
 * or sub-one reading normalises to 1 and is not dense at all. A dense display
 * whose viewport geometry is unusable therefore gets no MSAA either: that is
 * the cheaper of the two failures, and the only one that cannot miss a frame.
 *
 * Then the area class, for everything below that density: the same 8 MP class
 * the startup ceiling uses. A buffer that opens at MED or LOW (>= 8 MP) turns
 * MSAA off — there the per-frame resolve is largest and the DPR lever is
 * already inert — and only a HIGH-class buffer (< 8 MP) keeps it on, for the
 * hard edges it actually helps, whose fill is cheap there. Unusable geometry
 * BELOW the density line keeps AA on, matching
 * {@link resolveAutoStartupQuality}'s deterministic HIGH fallback.
 *
 * Only the context attribute moves: {@link resolveAutoStartupQuality} is
 * untouched, the class still decides the OPENING TIER, and the maximized 2×
 * window still opens at HIGH — now without a multisampled buffer under it. */
export function resolveStartupAntialias(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  highMaxDpr: number,
): boolean {
  if (resolveCanvasDpr(devicePixelRatio, highMaxDpr) >= MSAA_OFF_MIN_DPR) {
    return false;
  }
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
