import { Text } from '@react-three/drei';

import { FONT_DISPLAY, FONT_MONO } from '../ui/fonts';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { replayPresentation } from './hud/replayPresentation';

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

/** Cause-specific canonical replay progress. Renders while `cache.backfill`
 *  is non-null, including a zero-total reorg waiting state. Anchored by its
 *  top-center; the bar spans `width`. */
export default function BackfillHud({ x, y, width }: BackfillHudProps) {
  const { backfill } = useCellGalaxy();
  if (!backfill) return null;

  const visual = replayPresentation(backfill.phase);
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
        color={visual.color}
        letterSpacing={0.3}
        outlineWidth={0.18}
        outlineColor={visual.color}
        outlineOpacity={0.45}
      >
        {`⟦ ${visual.tag} · ${visual.title} ⟧`}
      </Text>

      <Text
        font={FONT_MONO}
        position={[0, -HEADER_SIZE - 6, 1]}
        anchorX="center"
        anchorY="top"
        fontSize={FIELD_SIZE}
        color="#e2e8f0"
      >
        {backfill.total > 0
          ? `${backfill.done} / ${backfill.total} blocks`
          : visual.waiting}
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
        <meshBasicMaterial color={visual.color} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
