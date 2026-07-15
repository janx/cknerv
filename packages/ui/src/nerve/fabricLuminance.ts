// Spatial energy compression for the passive Cell consensus fabric.
//
// Additive blending has no knowledge of how many routes overlap a pixel. The
// dense field centre therefore needs a lower per-route energy floor than the
// sparse rim. This pure helper shapes that floor while allowing semantically
// important structure (real arbor trunks, recently used routes, lifecycle
// flashes) to reclaim headroom. Active protocol writes use their own layer and
// intentionally bypass this function.

export const FABRIC_CORE_INNER_RADIUS = 3;
export const FABRIC_CORE_OUTER_RADIUS = 24;
export const FABRIC_TRUNK_RECLAIM = 0.34;
export const FABRIC_USAGE_RECLAIM = 0.52;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Brightness scale for one passive route sample.
 *
 * `centerDim` is shared with the Cell body. Squaring it gives the much denser
 * fabric a stronger core floor without introducing a second art-direction
 * control. `hierarchy` is normalized arbor trunkness; `usage` is recent real
 * packet activity; `flash` is a lifecycle event envelope. All outputs remain
 * in [0, 1], and the sparse rim is exactly 1.
 */
export function passiveFabricEnergyScale(
  x: number,
  z: number,
  hierarchy: number,
  usage: number,
  flash: number,
  centerDim: number,
): number {
  const radius = Math.hypot(x, z);
  const radialMix = smoothstep(
    FABRIC_CORE_INNER_RADIUS,
    FABRIC_CORE_OUTER_RADIUS,
    radius,
  );
  const coreFloor = clamp01(centerDim) ** 2;
  const radial = coreFloor + (1 - coreFloor) * radialMix;
  const semanticReclaim = Math.max(
    clamp01(flash),
    clamp01(hierarchy) * FABRIC_TRUNK_RECLAIM,
    clamp01(usage) * FABRIC_USAGE_RECLAIM,
  );
  return radial + (1 - radial) * semanticReclaim;
}
