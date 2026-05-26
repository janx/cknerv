import { useEffect, useMemo } from 'react';
import { useControls } from 'leva';

import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { QUALITY_PRESETS } from '../tweaks/qualityPresets';
import { makeCellCanopyVeilMaterial } from '../materials/cellCanopyVeilMaterial';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';

export const CANOPY_VEIL_WIDTH = 196;
export const CANOPY_VEIL_DEPTH = 154;

export default function CellCanopyVeil() {
  const cellsCache = useCellGalaxy();
  const { quality } = useControls('Time', {
    quality: {
      value: 'high' as 'high' | 'med' | 'low',
      options: ['high', 'med', 'low'] as const,
    },
  });
  const intensityMul = QUALITY_PRESETS[quality].canopyVeilMul;
  const material = useMemo(() => makeCellCanopyVeilMaterial(), []);

  useEffect(() => () => material.dispose(), [material]);

  useSimFrame(() => {
    material.uniforms.uTime.value = simClock.elapsedSec;
    material.uniforms.uIntensity.value = intensityMul;
  });

  if (intensityMul <= 0 || cellsCache.cells.size === 0) return null;

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      renderOrder={-4}
      frustumCulled={false}
    >
      <planeGeometry args={[CANOPY_VEIL_WIDTH, CANOPY_VEIL_DEPTH, 1, 1]} />
    </mesh>
  );
}
