export type CameraPresetName = 'default' | 'top' | 'side' | 'iso';

export interface CameraPresetValue {
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_PRESETS: Record<CameraPresetName, CameraPresetValue> = {
  default: { position: [110, 108, 110], target: [0, 18, 0] },
  top:     { position: [0, 200, 0.1],  target: [0, 0, 0] },
  side:    { position: [200, 0, 0],    target: [0, 0, 0] },
  iso:     { position: [150, 100, 150], target: [0, 0, 0] },
};

export function getCameraPreset(name: CameraPresetName): CameraPresetValue {
  return CAMERA_PRESETS[name];
}
