import { Text } from '@react-three/drei';

import { FONT_DISPLAY, FONT_MONO } from '../ui/fonts';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';

interface BackfillHudProps {
  /** HUD-space center x of the panel. */
  x: number;
  /** HUD-space top y of the panel. */
  y: number;
  /** Panel width in HUD units. */
  width: number;
}

const BAR_H = 6;
const HEADER_SIZE = 11;
const FIELD_SIZE = 10;

/** Boot-time seeding progress. Renders only while `cache.backfill` is
 *  non-null (server is replaying the recent block window). Anchored by
 *  its top-center; the bar spans `width`. */
export default function BackfillHud({ x, y, width }: BackfillHudProps) {
  const { backfill } = useCellGalaxy();
  if (!backfill) return null;

  const ratio =
    backfill.total > 0
      ? Math.min(1, Math.max(0, backfill.done / backfill.total))
      : 0;
  const filledW = width * ratio;

  return (
    <group position={[x, y, 0]}>
      <Text
        font={FONT_DISPLAY}
        position={[0, 0, 1]}
        anchorX="center"
        anchorY="top"
        fontSize={HEADER_SIZE}
        color="#67e8f9"
        letterSpacing={0.3}
        outlineWidth={0.18}
        outlineColor="#0ea5e9"
        outlineOpacity={0.45}
      >
        ⟦ SEEDING LIVE CELLS ⟧
      </Text>

      <Text
        font={FONT_MONO}
        position={[0, -HEADER_SIZE - 6, 1]}
        anchorX="center"
        anchorY="top"
        fontSize={FIELD_SIZE}
        color="#e2e8f0"
      >
        {`${backfill.done} / ${backfill.total} blocks`}
      </Text>

      {/* Progress bar: track + fill. Bar is centered on x, so it spans
          [-width/2, +width/2]; the fill grows from the left edge. */}
      <mesh position={[0, -HEADER_SIZE - FIELD_SIZE - 16, 0]}>
        <planeGeometry args={[width, BAR_H]} />
        <meshBasicMaterial color="#1e293b" transparent opacity={0.8} />
      </mesh>
      <mesh
        position={[-width / 2 + filledW / 2, -HEADER_SIZE - FIELD_SIZE - 16, 1]}
      >
        <planeGeometry args={[Math.max(filledW, 0.001), BAR_H]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
