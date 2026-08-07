// CellNucleusPortrait — dedicated detail Canvas for the selected consensus
// record. The portrait renders the chosen code-native core directly; no legacy
// specimen/anatomy graph is layered behind it. `focusField` is the readable A
// grammar used only by explicit CellDetailPanel row selection.
import { memo, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Cell } from '@cknerv/types';
import type { ConsensusBraidField } from '../../derives/consensusBraid.derive';
import { deriveCellContentAddressEncoding } from '../../derives/cellContentAddress.derive';
import {
  deriveCellBirthAnchorEncoding,
  deriveCellOutpointLocatorEncoding,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '../../derives/cellIdentityProof.derive';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryTraceReadout,
} from '../../nerve/consensusMemoryTrace';
import { QUALITY_PRESETS, useQualityRuntime } from '../../tweaks/qualityPresets';
import CellCoreArtwork, { type CellCoreDirection } from './CellCoreArtwork';

export const SCAN_PERIOD_S = 4.2;

/** Mirror the main dashboard's quality DPR ceiling for this independent
 * renderer. The portrait previously stayed at R3F's default DPR after the
 * primary Canvas had already downgraded. */
export function resolvePortraitCanvasDpr(
  devicePixelRatio: number,
  maxDpr: number,
): number {
  const deviceDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  const ceiling = Number.isFinite(maxDpr) ? Math.max(1, maxDpr) : 1;
  return Math.min(deviceDpr, ceiling);
}

/** The independent portrait context stays dormant while idle. Pointer orbit
 * temporarily restores a live render loop; returning to demand mode prevents
 * the detail renderer from competing with the Galaxy. */
export function cellPortraitFrameloop(
  dragging: boolean,
): 'always' | 'demand' {
  return dragging ? 'always' : 'demand';
}

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
  identityProofBinding,
  onIdentityProofRead,
}: {
  cell: Cell;
  direction: CellCoreDirection;
  reducedMotion: boolean;
  focusField: ConsensusBraidField | null;
  traceReadout: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId: number | null;
  identityProofBinding: CellIdentityProofBinding | null;
  onIdentityProofRead?: (kind: CellIdentityProofKind) => void;
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
      identityProofBinding={identityProofBinding}
      onIdentityProofRead={onIdentityProofRead}
    />
  );
}

function CellNucleusPortrait({
  cell,
  direction = 'relic',
  reducedMotion,
  focusField = null,
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
  identityProofBinding = null,
  onIdentityProofRead,
  onInteractionChange,
}: {
  cell: Cell;
  direction?: CellCoreDirection;
  reducedMotion: boolean;
  /** Retained as the public semantic focus; only production A consumes it. */
  focusField?: ConsensusBraidField | null;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
  identityProofBinding?: CellIdentityProofBinding | null;
  onIdentityProofRead?: (kind: CellIdentityProofKind) => void;
  onInteractionChange?: (active: boolean) => void;
  /** Compatibility input for callers that share a scan epoch with the panel. */
  scanEpochMs?: number;
}) {
  const [dragging, setDragging] = useState(false);
  const { effective: quality } = useQualityRuntime();
  const portraitDpr = resolvePortraitCanvasDpr(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    QUALITY_PRESETS[quality].maxDpr,
  );
  const addressEncoding = useMemo(
    () => deriveCellContentAddressEncoding(cell.content_hash),
    [cell.content_hash],
  );
  const outpointEncoding = useMemo(
    () => deriveCellOutpointLocatorEncoding(
      cell.out_point.tx_hash,
      cell.out_point.index,
    ),
    [cell.out_point.index, cell.out_point.tx_hash],
  );
  const anchorEncoding = useMemo(
    () => deriveCellBirthAnchorEncoding(cell.birth_block),
    [cell.birth_block],
  );
  useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);
  const proofFocus = focusField === 'state'
    ? 'address'
    : focusField === 'data'
      ? 'content'
      : focusField === 'born'
        ? 'anchor'
        : 'idle';
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
      data-memory-portrait-proof-focus={proofFocus}
      data-memory-portrait-identity-phase={
        identityProofBinding?.cellId === cell.id
          ? identityProofBinding.phase
          : 'idle'
      }
      data-memory-portrait-identity-count={
        identityProofBinding?.cellId === cell.id
          ? identityProofBinding.resolvedKinds.length
          : 0
      }
      data-memory-portrait-outpoint-fingerprint={outpointEncoding.fingerprint}
      data-memory-portrait-outpoint-index-bytes={outpointEncoding.indexBytes
        .join(',')}
      data-memory-portrait-anchor-block={anchorEncoding.block}
      data-memory-portrait-anchor-hex={anchorEncoding.hexadecimal}
      data-cell-portrait-interactive="true"
      data-cell-portrait-dragging={dragging ? 'true' : 'false'}
      role="application"
      aria-label="Interactive Cell scan. Drag to orbit around the Cell."
      title="Drag to orbit around the Cell"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        pointerEvents: 'auto',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      <Canvas
        gl={{ alpha: true, antialias: true }}
        dpr={portraitDpr}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
        style={{
          background: 'transparent',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        frameloop={cellPortraitFrameloop(dragging)}
      >
        <ConsensusScene
          cell={cell}
          direction={direction}
          reducedMotion={reducedMotion}
          focusField={focusField}
          traceReadout={traceReadout}
          traceResponseRef={traceResponseRef}
          traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
          identityProofBinding={
            identityProofBinding?.cellId === cell.id
              ? identityProofBinding
              : null
          }
          onIdentityProofRead={onIdentityProofRead}
        />
        <OrbitControls
          enableDamping={!reducedMotion}
          dampingFactor={0.08}
          enablePan={false}
          enableZoom={false}
          rotateSpeed={0.65}
          target={[0, 0, 0]}
          onStart={() => {
            setDragging(true);
            onInteractionChange?.(true);
          }}
          onEnd={() => {
            setDragging(false);
            onInteractionChange?.(false);
          }}
        />
      </Canvas>
    </div>
  );
}

// The surrounding detail panel advances its DOM-only scan beam on an 80 ms
// clock. Keep those parent renders out of this independent R3F root: every
// otherwise-identical React commit invalidates a demand Canvas and makes the
// portrait compete with the full Galaxy even though its scene did not change.
export default memo(CellNucleusPortrait);
