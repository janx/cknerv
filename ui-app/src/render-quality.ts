import type { QualityPreset } from '@cknerv/ui';

/** Query switches used by deterministic review/performance routes. Only an
 * explicit `=1` enables a switch so copied URLs cannot turn features on via an
 * empty or unrelated value. */
export function hasQuerySwitch(search: string, name: string): boolean {
  return new URLSearchParams(search).get(name) === '1';
}

/** Resolve a runtime Canvas DPR without ever supersampling below CSS-pixel
 * density. Invalid browser readings fall back to one. */
export function resolveCanvasDpr(devicePixelRatio: number, maxDpr: number): number {
  const deviceDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  return Math.min(deviceDpr, maxDpr);
}

/** Explicit deterministic quality override for screenshots and performance
 * review. Unknown values leave adaptive runtime ownership unchanged. */
export function resolveQualityOverride(search: string): QualityPreset | null {
  const requested = new URLSearchParams(search).get('quality');
  return requested === 'high' || requested === 'med' || requested === 'low'
    ? requested
    : null;
}
