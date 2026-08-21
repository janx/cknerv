/** Shared context-energy easing for scene layers that recede behind a
 * camera-proximity focus (the Cell close view's zoom recede). One rate and
 * snap for every consumer so node, link, and fibre context always settle
 * together. */
export const CONTEXT_DAMP_RATE = 9;
export const CONTEXT_DAMP_SNAP = 0.002;

/** Frame-rate independent approach toward a [0, 1] context-energy target. */
export function dampContextEnergy(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  const safeCurrent = Number.isFinite(current) ? current : 1;
  const safeTarget = Number.isFinite(target)
    ? Math.max(0, Math.min(1, target))
    : 1;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return safeCurrent;
  const next = safeCurrent
    + (safeTarget - safeCurrent)
      * (1 - Math.exp(-deltaSeconds * CONTEXT_DAMP_RATE));
  return Math.abs(next - safeTarget) < CONTEXT_DAMP_SNAP
    ? safeTarget
    : next;
}
