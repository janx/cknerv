import { describe, expect, it } from 'vitest';
import {
  FABRIC_CORE_OUTER_RADIUS,
  passiveFabricEnergyScale,
} from '../../src/nerve/fabricLuminance';

describe('passiveFabricEnergyScale', () => {
  it('squares the shared Cell floor for cold background routes at the core', () => {
    expect(passiveFabricEnergyScale(0, 0, 0, 0, 0, 0.3)).toBeCloseTo(0.09, 6);
  });

  it('restores the sparse rim exactly and keeps the function radial', () => {
    expect(passiveFabricEnergyScale(FABRIC_CORE_OUTER_RADIUS, 0, 0, 0, 0, 0.3)).toBe(1);
    expect(passiveFabricEnergyScale(9, 12, 0, 0, 0, 0.3)).toBeCloseTo(
      passiveFabricEnergyScale(-9, -12, 0, 0, 0, 0.3),
      8,
    );
  });

  it('lets real hierarchy and recent traffic reclaim core contrast', () => {
    const cold = passiveFabricEnergyScale(0, 0, 0, 0, 0, 0.3);
    const trunk = passiveFabricEnergyScale(0, 0, 1, 0, 0, 0.3);
    const used = passiveFabricEnergyScale(0, 0, 0, 1, 0, 0.3);
    expect(trunk).toBeGreaterThan(cold);
    expect(used).toBeGreaterThan(trunk);
    expect(used).toBeLessThan(1);
  });

  it('never suppresses a full lifecycle flash', () => {
    expect(passiveFabricEnergyScale(0, 0, 0, 0, 1, 0.3)).toBe(1);
  });
});
