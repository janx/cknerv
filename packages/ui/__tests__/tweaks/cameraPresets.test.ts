import { describe, expect, it } from 'vitest';

import { CAMERA_PRESETS, getCameraPreset } from '../../src/tweaks/cameraPresets';
import { CELLS_Y } from '../../src/layout';

describe('cameraPresets', () => {
  it('exposes 4 presets', () => {
    expect(Object.keys(CAMERA_PRESETS)).toEqual(['default', 'top', 'side', 'iso']);
  });

  it('default preset targets the Cell canopy rather than the peer plane', () => {
    expect(getCameraPreset('default')).toEqual({
      position: [110, 108, 110],
      target: [0, CELLS_Y, 0],
    });
  });

  it('top preset looks straight down', () => {
    expect(getCameraPreset('top')).toEqual({
      position: [0, 200, 0.1],
      target: [0, 0, 0],
    });
  });

  it('iso preset uses equal x/z components', () => {
    const iso = getCameraPreset('iso');
    expect(iso.position[0]).toBe(iso.position[2]);
  });
});
