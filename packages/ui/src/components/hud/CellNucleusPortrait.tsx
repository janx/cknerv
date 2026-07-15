// CellNucleusPortrait — dedicated detail Canvas for the selected consensus
// record. The portrait renders the chosen code-native core directly; no legacy
// specimen/anatomy graph is layered behind it. `focusField` is the readable A
// grammar used by CellDetailPanel's scan and row selection.
import { Canvas } from '@react-three/fiber';
import type { Cell } from '@cknerv/types';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import CellCoreArtwork, { type CellCoreDirection } from './CellCoreArtwork';

export const SCAN_PERIOD_S = 4.2;

/** @deprecated Production portraits no longer project specimen landmarks. */
export interface ProbeScreen {
  x: number;
  y: number;
  visible: boolean;
  index: number;
  lockT: number;
  traveling: boolean;
}

function ConsensusScene({
  cell,
  direction,
  reducedMotion,
  focusField,
}: {
  cell: Cell;
  direction: CellCoreDirection;
  reducedMotion: boolean;
  focusField: ConsensusBraidField | null;
}) {
  return (
    <CellCoreArtwork
      direction={direction}
      cell={cell}
      reducedMotion={reducedMotion}
      focusField={focusField}
    />
  );
}

export default function CellNucleusPortrait({
  cell,
  direction = 'relic',
  reducedMotion,
  focusField = null,
}: {
  cell: Cell;
  direction?: CellCoreDirection;
  reducedMotion: boolean;
  /** Retained as the public semantic focus; only production A consumes it. */
  focusField?: ConsensusBraidField | null;
  /** Compatibility input for callers that share a scan epoch with the panel. */
  scanEpochMs?: number;
}) {
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: 'none' }}>
      <Canvas
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{ background: 'transparent' }}
        frameloop={reducedMotion ? 'demand' : 'always'}
      >
        <ConsensusScene
          cell={cell}
          direction={direction}
          reducedMotion={reducedMotion}
          focusField={focusField}
        />
      </Canvas>
    </div>
  );
}
