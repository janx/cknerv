// CellNucleusPortrait — dedicated detail Canvas for the selected consensus
// record. The portrait renders the chosen code-native core directly; no legacy
// specimen/anatomy graph is layered behind it. `focusField` is the readable A
// grammar used only by explicit CellDetailPanel row selection.
import { memo, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
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

/** Cadence for the heartbeat below. The core's motion is slow — a drifting
 * weave, a knot turning at 0.28 rad/s, packets stepping at 2 Hz — so half the
 * display rate is indistinguishable here and costs half as much beside the
 * Galaxy. Raise toward 60 only if the packet flow ever reads as stepping. */
export const PORTRAIT_HEARTBEAT_HZ = 30;

export function portraitHeartbeatIntervalMs(hz: number): number {
  return Math.max(1, Math.round(1000 / (hz > 0 ? hz : 1)));
}

/**
 * The portrait Canvas runs on demand so it does not race the Galaxy for the
 * main thread. That policy assumes a scene that is static when nothing is
 * interacting with it — which the consensus core is NOT: its useFrame advances
 * packet phase, knot rotation and weave drift off `clock.elapsedTime` forever.
 * Nothing in that core requests frames, so it used to animate only as long as
 * something else happened to wake the canvas (the panel's 80 ms scan clock, and
 * the halo / proof reader while their reads were in flight) and then froze
 * mid-flow once both stopped, a few seconds after opening.
 *
 * So drive it explicitly, at a throttled cadence rather than by surrendering to
 * `frameloop="always"`. Reduced motion pins the core's clock to zero, so there
 * is nothing to advance and no reason to tick.
 */
function PortraitHeartbeat({ enabled, hz }: { enabled: boolean; hz: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!enabled) return;
    const period = portraitHeartbeatIntervalMs(hz);
    const beat = window.setInterval(() => invalidate(), period);
    return () => window.clearInterval(beat);
  }, [enabled, hz, invalidate]);
  return null;
}

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

/** Pointer orbit gets an unthrottled loop so dragging tracks the cursor;
 * otherwise the portrait stays on demand, where PortraitHeartbeat paces it at
 * PORTRAIT_HEARTBEAT_HZ. Demand is what keeps the detail renderer from
 * competing with the Galaxy — note it no longer means dormant. */
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
        <PortraitHeartbeat
          enabled={!reducedMotion}
          hz={PORTRAIT_HEARTBEAT_HZ}
        />
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
