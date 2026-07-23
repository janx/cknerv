// CellNucleusPortrait — dedicated detail Canvas for the selected consensus
// record. The portrait renders the chosen code-native core directly; no legacy
// specimen/anatomy graph is layered behind it. `focusField` is the readable A
// grammar used by CellDetailPanel's scan and row selection.
import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Cell } from '@cknerv/types';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import { deriveCellContentAddressEncoding } from '../../derives/cellContentAddress.derive';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryTraceReadout,
} from '../../nerve/consensusMemoryTrace';
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
  traceReadout,
  traceResponseRef,
  traceEvidenceFocusSourceId,
  onContentAddressRead,
}: {
  cell: Cell;
  direction: CellCoreDirection;
  reducedMotion: boolean;
  focusField: ConsensusBraidField | null;
  traceReadout: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId: number | null;
  onContentAddressRead?: () => void;
}) {
  return (
    <CellCoreArtwork
      direction={direction}
      cell={cell}
      reducedMotion={reducedMotion}
      focusField={focusField}
      traceReadout={traceReadout}
      traceResponseRef={traceResponseRef}
      traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
      onContentAddressRead={onContentAddressRead}
    />
  );
}

export default function CellNucleusPortrait({
  cell,
  direction = 'relic',
  reducedMotion,
  focusField = null,
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
  onContentAddressRead,
}: {
  cell: Cell;
  direction?: CellCoreDirection;
  reducedMotion: boolean;
  /** Retained as the public semantic focus; only production A consumes it. */
  focusField?: ConsensusBraidField | null;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
  onContentAddressRead?: () => void;
  /** Compatibility input for callers that share a scan epoch with the panel. */
  scanEpochMs?: number;
}) {
  const addressEncoding = useMemo(
    () => deriveCellContentAddressEncoding(cell.content_hash),
    [cell.content_hash],
  );
  return (
    <div
      data-memory-portrait-state={traceReadout?.stage ?? 'idle'}
      data-memory-evidence-focus-source={traceEvidenceFocusSourceId ?? undefined}
      data-memory-portrait-address="resolved"
      data-memory-portrait-address-fingerprint={addressEncoding.fingerprint}
      data-memory-portrait-address-lanes={addressEncoding.lanes
        .map((lane) => lane.toFixed(3))
        .join(',')}
      data-memory-portrait-address-phase={addressEncoding.phase.toFixed(3)}
      data-memory-portrait-address-focus={
        focusField === 'data' ? 'content' : 'idle'
      }
      style={{ width: '100%', aspectRatio: '1 / 1', pointerEvents: 'none' }}
    >
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
          traceReadout={traceReadout}
          traceResponseRef={traceResponseRef}
          traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
          onContentAddressRead={onContentAddressRead}
        />
      </Canvas>
    </div>
  );
}
