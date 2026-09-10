// CellNucleusPortrait — the detail card's portrait square. In the app the
// braid renders on the MAIN WebGL context: CellPortraitInset scissors this
// square and draws there, so this component owns only the DOM side — the
// interactive element, its measurements, and the braid content pushed through
// the portrait channel. Review labs opt into `standalone`, which keeps the
// old self-contained Canvas so portraits work outside the app shell (and in
// multiples). `focusField` is the readable A grammar used only by explicit
// CellDetailPanel row selection.
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Cell, CellSemanticRecord } from '@cknerv/types';
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
import type { CellDetailLayoutSide } from './CellDetailPanel';
import CellCoreArtwork, { type CellCoreDirection } from './CellCoreArtwork';
import {
  registerCellPortraitElement,
  setCellPortraitContent,
  setCellPortraitOffset,
} from './cellPortraitInsetChannel';

export const SCAN_PERIOD_S = 4.2;

/** Standalone (lab) renderer DPR: labs mirror the device up to the same
 * ceiling the app's quality cascade tops out at. */
export function resolveStandalonePortraitDpr(devicePixelRatio: number): number {
  const deviceDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  return Math.min(deviceDpr, 2);
}

function CellNucleusPortrait({
  cell,
  direction = 'relic',
  reducedMotion,
  focusField = null,
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
  semanticRecord = null,
  identityProofBinding = null,
  onIdentityProofRead,
  onInteractionChange,
  layoutSide = 'left',
  standalone = false,
}: {
  cell: Cell;
  direction?: CellCoreDirection;
  reducedMotion: boolean;
  /** Retained as the public semantic focus; only production A consumes it. */
  focusField?: ConsensusBraidField | null;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
  semanticRecord?: CellSemanticRecord | null;
  identityProofBinding?: CellIdentityProofBinding | null;
  onIdentityProofRead?: (kind: CellIdentityProofKind) => void;
  /** Close-mid-drag reset; live orbit events come from the inset renderer
   * (or from the standalone controls below). */
  onInteractionChange?: (active: boolean) => void;
  /** Column-order flips move this square without resizing it — the only
   * layout change ResizeObserver cannot see, so it re-triggers measuring. */
  layoutSide?: CellDetailLayoutSide;
  /** Self-contained Canvas for review labs / hosts without the inset pass. */
  standalone?: boolean;
  /** Compatibility input for callers that share a scan epoch with the panel. */
  scanEpochMs?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
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
  const selectedBinding = identityProofBinding?.cellId === cell.id
    ? identityProofBinding
    : null;
  const artwork = (
    <CellCoreArtwork
      direction={direction}
      cell={cell}
      reducedMotion={reducedMotion}
      focusField={focusField}
      traceReadout={traceReadout}
      traceResponseRef={traceResponseRef}
      traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
      semanticRecord={semanticRecord}
      identityProofBinding={selectedBinding}
      onIdentityProofRead={onIdentityProofRead}
    />
  );

  useLayoutEffect(() => {
    if (standalone) return;
    const host = hostRef.current;
    registerCellPortraitElement(host);
    if (!host) return;
    // The offset is measured against the box the frame writer TRANSLATES, so
    // it stays valid while the anchor moves that box around the canvas: both
    // rects carry the same transform and the difference cancels out.
    //
    // ⚠️ THAT BOX IS THE SPECIMEN'S OWN PANEL NOW, not the card. The three
    // instruments came apart (2026-09-10) and the element carrying
    // `data-cell-inspection-overlay` is the layer they stand on — inset 0 and
    // never transformed — so measuring against it would give a screen position
    // that a ResizeObserver never re-reads when the panel merely moves.
    const card = host.closest<HTMLElement>('[data-cell-constellation-panel="specimen"]')
      ?? host.closest<HTMLElement>('[data-cell-inspection-overlay]');
    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const cardRect = card?.getBoundingClientRect();
      setCellPortraitOffset({
        dx: hostRect.left - (cardRect?.left ?? 0),
        dy: hostRect.top - (cardRect?.top ?? 0),
        width: hostRect.width,
        height: hostRect.height,
      });
    };
    measure();
    const detach = () => {
      registerCellPortraitElement(null);
      setCellPortraitOffset(null);
    };
    if (typeof ResizeObserver === 'undefined') return detach;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (card) observer.observe(card);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [cell.id, layoutSide, standalone]);

  useLayoutEffect(() => {
    if (standalone) return;
    setCellPortraitContent(artwork);
  });
  useLayoutEffect(() => {
    if (standalone) return undefined;
    return () => {
      setCellPortraitContent(null);
      onInteractionChange?.(false);
    };
  }, [onInteractionChange, standalone]);

  const proofFocus = focusField === 'state'
    ? 'address'
    : focusField === 'data'
      ? 'content'
      : focusField === 'born'
        ? 'anchor'
        : 'idle';
  return (
    <div
      ref={hostRef}
      data-memory-portrait-state={traceReadout?.stage ?? 'idle'}
      data-cell-semantic-morphology={semanticRecord ? 'validated' : 'absent'}
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
        selectedBinding ? selectedBinding.phase : 'idle'
      }
      data-memory-portrait-identity-count={
        selectedBinding ? selectedBinding.resolvedKinds.length : 0
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
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        pointerEvents: 'auto',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {standalone ? (
        <Canvas
          gl={{ alpha: true, antialias: true }}
          dpr={resolveStandalonePortraitDpr(
            typeof window === 'undefined' ? 1 : window.devicePixelRatio,
          )}
          camera={{ position: [0, 0, 3], fov: 40, near: 0.1, far: 20 }}
          style={{ background: 'transparent', touchAction: 'none' }}
        >
          {artwork}
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
      ) : null}
    </div>
  );
}

// The surrounding detail panel advances its DOM-only scan beam on an 80 ms
// clock. memo keeps those parent renders from re-pushing identical braid
// content through the portrait channel on every tick.
export default memo(CellNucleusPortrait);
