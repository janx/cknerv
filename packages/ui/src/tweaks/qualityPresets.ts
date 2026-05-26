export type QualityPreset = 'high' | 'med' | 'low';

export interface QualityCascade {
  antialias: boolean;
  postfx: boolean;
  starsCount: number;
  particleCapMul: number;
  cellGalaxyMul: number;
  canopyVeilMul: number;
  dischargeArms: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityCascade> = {
  high: { antialias: true,  postfx: true,  starsCount: 1400, particleCapMul: 1.0,  cellGalaxyMul: 1.0, canopyVeilMul: 1.0,  dischargeArms: 3 },
  med:  { antialias: true,  postfx: false, starsCount: 600,  particleCapMul: 0.5,  cellGalaxyMul: 0.7, canopyVeilMul: 0.55, dischargeArms: 2 },
  low:  { antialias: false, postfx: false, starsCount: 200,  particleCapMul: 0.25, cellGalaxyMul: 0.3, canopyVeilMul: 0.35, dischargeArms: 1 },
};
