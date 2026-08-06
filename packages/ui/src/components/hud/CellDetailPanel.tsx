import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type {
  Cell,
  CellLink,
  CellSemanticRecord,
  EnrichmentSourceStatus,
  TransactionSemanticRecord,
} from '@cknerv/types';
import {
  formatCkb,
  formatAge,
  formatDataSize,
  formatLockKind,
  formatAssetKind,
  LOCK_COLORS,
  ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait from './CellNucleusPortrait';
import ConsensusIdentityPlate, {
  ConsensusMemoryTracePlate,
} from './ConsensusIdentityPlate';
import type {
  CellCausalNavigationReadout,
} from './CellCausalLensReadout';
import { PROBE_STEP_S, probeScan } from './probeScan';
import { deriveCellVisual } from '../../derives/cellVisual.derive';
import { deriveCellConsensusIdentity } from '../../derives/cellConsensusIdentity.derive';
import {
  deriveCellCausalLens,
  type CellCausalLens,
} from '../../derives/cellCausalLens.derive';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryRouteHopFocus,
  ConsensusMemoryTraceReadout,
  ConsensusMemoryTraceSource,
} from '../../nerve/consensusMemoryTrace';
import {
  CONSENSUS_BRAID_FIELDS,
  consensusBraidAgreementTarget,
  type ConsensusBraidField,
} from '../../derives/consensusBraid.derive';
import {
  cellIdentityProofBindingComplete,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '../../derives/cellIdentityProof.derive';
import CellSemanticsReadout, {
  type CellSemanticsPhase,
} from './CellSemanticsReadout';

const EMPTY_RECENT_LINKS: readonly CellLink[] = [];
const PORTRAIT_BRACKET_PX = 12;

type RowDecode = { label: string; value: string; color?: string };
export type CellInspectionFacet = ConsensusBraidField;
export type CellDetailLayoutSide = 'left' | 'right' | 'above' | 'below';

function portraitBracket(corner: 'tl' | 'tr' | 'bl' | 'br'): CSSProperties {
  const vertical: CSSProperties = corner[0] === 't'
    ? { top: 0 }
    : { bottom: 0 };
  const horizontal: CSSProperties = corner[1] === 'l'
    ? { left: 0 }
    : { right: 0 };
  const borderWidth = corner === 'tl'
    ? '1px 0 0 1px'
    : corner === 'tr'
      ? '1px 1px 0 0'
      : corner === 'bl'
        ? '0 0 1px 1px'
        : '0 1px 1px 0';
  return {
    position: 'absolute',
    zIndex: 4,
    width: PORTRAIT_BRACKET_PX,
    height: PORTRAIT_BRACKET_PX,
    borderColor: HUD_COLORS.orange,
    borderStyle: 'solid',
    borderWidth,
    opacity: 0.82,
    pointerEvents: 'none',
    ...vertical,
    ...horizontal,
  };
}

export interface CellDetailPanelProps {
  cell: Cell;
  recentLinks?: readonly CellLink[];
  /** Current projection records used to explain exact route-hop identities. */
  routeCellById?: ReadonlyMap<number, Cell>;
  /** Shared scene/HUD model of the selected Cell's real origin transaction. */
  causalLens?: CellCausalLens | null;
  /** Local browser-like path through explicit causal endpoint selections. */
  causalNavigation?: CellCausalNavigationReadout | null;
  tracedWriteSeq?: number | null;
  traceSource?: ConsensusMemoryTraceSource;
  traceReadout?: ConsensusMemoryTraceReadout | null;
  traceResponseRef?: ConsensusMemoryCellResponseRef;
  traceEvidenceFocusSourceId?: number | null;
  traceEvidencePreviewSourceId?: number | null;
  onTraceEvidenceFocusChange?: (sourceId: number | null) => void;
  traceRouteHopFocus?: ConsensusMemoryRouteHopFocus | null;
  onTraceRouteHopFocusChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
  traceRouteHopLock?: ConsensusMemoryRouteHopFocus | null;
  onTraceRouteHopLockChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
  identityProofBinding?: CellIdentityProofBinding | null;
  onTraceWrite?: (linkSeq: number) => void;
  onIdentityProofRead?: (
    kind: CellIdentityProofKind,
    cellId: number,
    reducedMotion: boolean,
  ) => void;
  /** Owns pointer orbit gestures inside the nested Cell Scan renderer. */
  onScanInteractionChange?: (active: boolean) => void;
  semanticSource?: EnrichmentSourceStatus;
  semanticPhase?: CellSemanticsPhase;
  semanticRecord?: CellSemanticRecord | null;
  semanticMessage?: string | null;
  semanticTransactionPhase?: CellSemanticsPhase;
  semanticTransactionRecord?: TransactionSemanticRecord | null;
  semanticTransactionMessage?: string | null;
  /** Mirrors a selected readout facet into the scene-to-detail connector. */
  onInspectionFieldChange?: (field: CellInspectionFacet | null) => void;
  /** Spatial fan direction selected by the scene-anchor placement solver. */
  layoutSide?: CellDetailLayoutSide;
  onClose: () => void;
  style?: CSSProperties;
}

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function formatCellData(dataHex: string): string {
  const size = formatDataSize(dataHex);
  if (size === '0 B') return 'Empty';
  return dataHex.endsWith('…') ? `${size} observed` : size;
}

function CellScanFact({
  field,
  label,
  value,
  color,
  revealed,
  selected,
  interactive,
  onActivate,
}: RowDecode & {
  field: CellInspectionFacet;
  revealed: boolean;
  selected: boolean;
  interactive: boolean;
  onActivate: () => void;
}) {
  const accent = color ?? HUD_COLORS.cyanWire;
  return (
    <button
      type="button"
      data-cell-detail-field={field}
      data-cell-detail-field-state={selected ? 'focused' : revealed ? 'resolved' : 'scanning'}
      aria-pressed={selected}
      disabled={!interactive}
      onClick={onActivate}
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 43,
        margin: 0,
        padding: '6px 7px 5px 10px',
        border: 0,
        borderLeft: `1px solid ${selected ? accent : rgba(accent, 0.34)}`,
        background: selected
          ? `linear-gradient(90deg,${rgba(accent, 0.17)},transparent 88%)`
          : 'transparent',
        boxShadow: selected ? `-3px 0 10px ${rgba(accent, 0.22)}` : undefined,
        color: accent,
        font: 'inherit',
        textAlign: 'left',
        cursor: interactive ? 'crosshair' : 'default',
        opacity: revealed ? 1 : 0.18,
        transition: 'opacity 260ms ease, background 160ms ease, box-shadow 160ms ease',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      <span style={{ display: 'block', fontSize: 9, letterSpacing: 1.2, color: HUD_COLORS.dim }}>
        {label}
      </span>
      <span
        title={value}
        style={{ display: 'block', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, lineHeight: 1.2, color: selected ? accent : color ?? HUD_COLORS.ink }}
      >
        {value}
      </span>
      <span
        aria-hidden="true"
        style={{ position: 'absolute', left: -2, top: 5, width: 3, height: 3, background: revealed ? accent : 'transparent', boxShadow: revealed ? `0 0 6px ${accent}` : undefined }}
      />
    </button>
  );
}

export default function CellDetailPanel({
  cell,
  recentLinks = EMPTY_RECENT_LINKS,
  routeCellById,
  causalLens = null,
  causalNavigation = null,
  tracedWriteSeq = null,
  traceSource = 'none',
  traceReadout = null,
  traceResponseRef,
  traceEvidenceFocusSourceId = null,
  traceEvidencePreviewSourceId = null,
  onTraceEvidenceFocusChange,
  traceRouteHopFocus = null,
  onTraceRouteHopFocusChange,
  traceRouteHopLock = null,
  onTraceRouteHopLockChange,
  identityProofBinding = null,
  onTraceWrite,
  onIdentityProofRead,
  onScanInteractionChange,
  semanticSource,
  semanticPhase,
  semanticRecord,
  semanticMessage,
  semanticTransactionPhase,
  semanticTransactionRecord,
  semanticTransactionMessage,
  onInspectionFieldChange,
  layoutSide = 'left',
  onClose,
  style,
}: CellDetailPanelProps) {
  const reduced = useReducedMotion();
  const live = cell.death_at_ms === null;
  const enhancedDetail = Boolean(semanticSource && semanticPhase);
  const age = formatAge(cell.born_at_ms, Date.now());
  const [scanClock, setScanClock] = useState(() => {
    const atMs = nowPerf();
    return { cellId: cell.id, epochMs: atMs, nowMs: atMs };
  });
  const [selectedFieldState, setSelectedFieldState] = useState<{
    cellId: number;
    field: CellInspectionFacet | null;
  }>(() => ({ cellId: cell.id, field: null }));
  const selectedField = selectedFieldState.cellId === cell.id
    ? selectedFieldState.field
    : null;

  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const identity = useMemo(
    () => deriveCellConsensusIdentity(cell, recentLinks),
    [cell, recentLinks],
  );
  const traceSelected = identity.observedWrite?.seq === tracedWriteSeq;
  const showTracePlate = Boolean(traceSelected && traceReadout);
  const selectedIdentityProofBinding = identityProofBinding?.cellId === cell.id
    ? identityProofBinding
    : null;
  const identityProofComplete = cellIdentityProofBindingComplete(
    selectedIdentityProofBinding,
  );
  const inspectedCellById = useMemo(() => {
    if (routeCellById?.get(cell.id) === cell) return routeCellById;
    const cells = new Map(routeCellById);
    cells.set(cell.id, cell);
    return cells;
  }, [cell, routeCellById]);
  const resolvedCausalLens = useMemo(
    () => causalLens ?? deriveCellCausalLens(
      cell,
      recentLinks,
      inspectedCellById,
    ),
    [causalLens, cell, inspectedCellById, recentLinks],
  );
  const order = CONSENSUS_BRAID_FIELDS;
  const agreementTarget = consensusBraidAgreementTarget(visual);

  useEffect(() => {
    onInspectionFieldChange?.(selectedField);
  }, [onInspectionFieldChange, selectedField]);

  useEffect(() => {
    if (reduced) return;
    const epochMs = nowPerf();
    const update = () => setScanClock({
      cellId: cell.id,
      epochMs,
      nowMs: nowPerf(),
    });
    setScanClock({ cellId: cell.id, epochMs, nowMs: epochMs });
    const interval = window.setInterval(update, 80);
    const stop = window.setTimeout(() => {
      window.clearInterval(interval);
      update();
    }, order.length * PROBE_STEP_S * 1000 + 80);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [cell.id, reduced, order.length]);

  const DECODE: Record<CellInspectionFacet, RowDecode> = {
    capacity: { label: 'CAPACITY', value: formatCkb(cell.capacity) },
    asset: {
      label: 'ASSET',
      value: formatAssetKind(cell.asset_kind),
      color: cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.dim,
    },
    lock: {
      label: 'LOCK',
      value: formatLockKind(cell.lock_kind),
      color: cell.lock_kind ? LOCK_COLORS[cell.lock_kind] : HUD_COLORS.dim,
    },
    data: {
      label: 'DATA',
      value: formatCellData(cell.data_hex),
      color: HUD_COLORS.nominal,
    },
    state: {
      label: 'STATE',
      value: live ? '● LIVE' : '◇ SPENT',
      color: live ? HUD_COLORS.nominal : HUD_COLORS.caution,
    },
    born: { label: 'COMMIT', value: `#${cell.birth_block}` },
  };
  const activeClock = scanClock.cellId === cell.id
    ? scanClock
    : { cellId: cell.id, epochMs: scanClock.nowMs, nowMs: scanClock.nowMs };
  const scan = probeScan(
    activeClock.epochMs,
    reduced ? 0 : activeClock.nowMs,
    order.length,
    reduced,
  );
  const statusText = scan.classified
    ? 'SCAN LOCKED · CONTENT IDENTITY MAPPED'
    : scan.status === 'unidentified'
      ? 'IDENTITY UNRESOLVED'
      : `CELLULAR SCAN ${scan.pct}%`;
  const statusColor = scan.classified ? HUD_COLORS.nominal : HUD_COLORS.cyanWire;
  const activateField = (field: CellInspectionFacet) => {
    if (!scan.classified) return;
    setSelectedFieldState((current) => ({
      cellId: cell.id,
      field: current.cellId === cell.id && current.field === field ? null : field,
    }));
    const proofKind: CellIdentityProofKind | null = field === 'state'
      ? 'address'
      : field === 'data'
        ? 'content'
        : field === 'born'
          ? 'anchor'
          : null;
    if (proofKind) onIdentityProofRead?.(proofKind, cell.id, reduced);
  };

  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';
  const rootWidth = enhancedDetail ? 800 : 700;
  const portraitWidth = enhancedDetail ? 280 : 260;
  const portraitLeft = rootWidth - portraitWidth;
  const anatomyWidth = enhancedDetail ? 500 : 410;
  const anatomyHeight = enhancedDetail
    ? verticalLayout ? 364 : 280
    : verticalLayout ? 202 : 200;
  const bottomTop = enhancedDetail
    ? verticalLayout ? 452 : 388
    : verticalLayout ? 288 : 380;
  // Indexed content adds deterministic decode, heuristic, and role rows to the
  // no-scroll memory satellite. Keep enough bounded space for those rows plus
  // the narrower recall/trace state instead of clipping them at the old height.
  const bottomHeight = enhancedDetail
    ? verticalLayout ? 232 : 400
    : verticalLayout ? 212 : 260;
  const rootHeight = bottomTop + bottomHeight;
  const identityLeft = enhancedDetail ? 180 : 140;
  const identityWidth = rootWidth - identityLeft;
  const secondaryLeft = enhancedDetail ? 440 : 340;
  const secondaryWidth = rootWidth - secondaryLeft;
  const lineageWidth = showTracePlate
    ? enhancedDetail ? 420 : 320
    : enhancedDetail ? 560 : 480;
  const readableScale = verticalLayout ? 1 : 1.2;
  const readableWidth = `${(100 / readableScale).toFixed(2)}%`;
  const fromFanEdge = (left: number): CSSProperties => (
    layoutSide === 'right' ? { right: left } : { left }
  );
  const satelliteBase: CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,.56))',
  };
  const fanCoordinate = (coordinate: number): number => (
    layoutSide === 'right' ? rootWidth - coordinate : coordinate
  );

  return (
    <div
      data-cell-detail-scan-field="true"
      data-cell-detail-enhanced={enhancedDetail ? 'true' : 'false'}
      data-cell-detail-layout={verticalLayout ? 'vertical' : layoutSide}
      data-cell-detail-readability="large"
      style={{
        position: 'relative',
        width: rootWidth,
        height: rootHeight,
        maxWidth: 'calc(100vw - 28px)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        filter: `drop-shadow(0 0 14px ${rgba(HUD_COLORS.cyanWire, 0.06)})`,
        animation: reduced
          ? undefined
          : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
        ...style,
      }}
    >
      {!verticalLayout ? (
        <>
          <span
            aria-hidden="true"
            data-cell-inspection-orbit-path="identity"
            style={{ position: 'absolute', zIndex: 0, left: fanCoordinate(portraitLeft + portraitWidth / 2), top: 57, width: 1, height: 31, background: `linear-gradient(180deg,${rgba(HUD_COLORS.orange, 0.14)},${rgba(HUD_COLORS.orange, 0.7)})`, boxShadow: `0 0 6px ${rgba(HUD_COLORS.orange, 0.28)}` }}
          />
          <span
            aria-hidden="true"
            data-cell-inspection-orbit-path="anatomy"
            style={{ position: 'absolute', zIndex: 0, left: layoutSide === 'right' ? rootWidth - portraitLeft : anatomyWidth, top: 88 + anatomyHeight / 2, width: portraitLeft - anatomyWidth, height: 1, background: `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.65)},${rgba(HUD_COLORS.cyanWire, 0.12)})`, boxShadow: `0 0 6px ${rgba(HUD_COLORS.cyanWire, 0.22)}` }}
          />
          <span
            aria-hidden="true"
            data-cell-inspection-orbit-path="lineage"
            style={{ position: 'absolute', zIndex: 0, left: fanCoordinate(72), top: 88 + anatomyHeight, width: 1, height: bottomTop - 88 - anatomyHeight, background: `linear-gradient(180deg,${rgba('#AA88FF', 0.16)},${rgba('#AA88FF', 0.68)})`, boxShadow: `0 0 6px ${rgba('#AA88FF', 0.24)}` }}
          />
          {showTracePlate ? (
            <span
              aria-hidden="true"
              data-cell-inspection-orbit-path="trace"
              style={{ position: 'absolute', zIndex: 0, left: fanCoordinate(portraitLeft + portraitWidth / 2), top: 88 + portraitWidth, width: 1, height: bottomTop - 88 - portraitWidth, background: `linear-gradient(180deg,${rgba(HUD_COLORS.cyanWire, 0.62)},${rgba(HUD_COLORS.cyanWire, 0.12)})`, boxShadow: `0 0 6px ${rgba(HUD_COLORS.cyanWire, 0.22)}` }}
            />
          ) : null}
        </>
      ) : null}

      <section
        data-cell-inspection-satellite="identity"
        data-cell-scan-identity
        style={{
          ...satelliteBase,
          ...(verticalLayout
            ? { left: 0, top: 0, width: '100%', minHeight: 56 }
            : { ...fromFanEdge(identityLeft), top: 0, width: identityWidth, minHeight: 58 }),
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 10px',
          minWidth: 0,
          padding: '9px 38px 8px 16px',
          borderLeft: `1px solid ${rgba(HUD_COLORS.orange, 0.5)}`,
          background: 'linear-gradient(100deg,rgba(7,5,11,.94),rgba(6,7,15,.72) 76%,transparent)',
          clipPath: 'polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)',
        }}
      >
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.tech, fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>
          CELL // #{cell.id}
        </span>
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.cjk, fontSize: 11, opacity: 0.78 }}>
          共识细胞
        </span>
        <span title={cell.content_hash} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: HUD_COLORS.dim, fontSize: 9.5, letterSpacing: 0.8 }}>
          {cell.content_hash.slice(2, 10)}:{cell.out_point.index}
        </span>
        <span style={{ marginLeft: 'auto', color: live ? HUD_COLORS.nominal : HUD_COLORS.caution, fontSize: 10.5, letterSpacing: 0.9 }}>
          {live ? '● LIVE' : '◇ SPENT'} · AGE {age}
        </span>
        <button
          type="button"
          aria-label="close"
          title="Close · ESC or click outside"
          onClick={onClose}
          style={{ position: 'absolute', top: 5, right: 8, width: 28, height: 28, padding: 0, border: 0, background: 'transparent', color: HUD_COLORS.dim, font: `15px ${HUD_FONTS.mono}`, cursor: 'crosshair', pointerEvents: 'auto' }}
        >
          ×
        </button>
      </section>

      <section
        aria-label="Interactive Cell scan"
        data-cell-detail-module="specimen"
        data-cell-inspection-satellite="specimen"
        data-cell-portrait-frame
        style={{
          ...satelliteBase,
          ...(verticalLayout
            ? { left: 0, top: 72, width: '50%', maxWidth: 190 }
            : { ...fromFanEdge(portraitLeft), top: 88, width: portraitWidth }),
          aspectRatio: '1 / 1',
          overflow: 'hidden',
          border: `1px solid ${rgba(HUD_COLORS.orange, 0.24)}`,
          background: `radial-gradient(circle at 50% 52%,${rgba(HUD_COLORS.cyanWire, 0.075)},rgba(1,4,12,.72) 55%,rgba(1,3,9,.22) 76%,transparent)`,
          boxShadow: `inset 0 0 26px ${rgba(HUD_COLORS.cyanWire, 0.08)},0 0 20px ${rgba(HUD_COLORS.orange, 0.06)}`,
        }}
      >
        <div style={{ position: 'absolute', zIndex: 3, left: 12, top: 10, right: 12, display: 'flex', alignItems: 'baseline', gap: 8, pointerEvents: 'none' }}>
          <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.tech, fontSize: verticalLayout ? 10.5 : 12, fontWeight: 700, letterSpacing: verticalLayout ? 1.25 : 1.65, whiteSpace: 'nowrap' }}>CELL SCAN</span>
          <span data-cell-scan-drag-affordance style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: verticalLayout ? 7.2 : 8.5, letterSpacing: verticalLayout ? 0.5 : 0.8, whiteSpace: 'nowrap' }}>{verticalLayout ? 'ORBIT ↔' : 'DRAG TO ORBIT ↔'}</span>
        </div>
        <CellNucleusPortrait
          cell={cell}
          reducedMotion={reduced}
          scanEpochMs={activeClock.epochMs}
          focusField={scan.classified ? selectedField : null}
          traceReadout={traceReadout}
          traceResponseRef={traceResponseRef}
          traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
          identityProofBinding={selectedIdentityProofBinding}
          onIdentityProofRead={onIdentityProofRead
            ? (kind) => onIdentityProofRead(kind, cell.id, reduced)
            : undefined}
          onInteractionChange={onScanInteractionChange}
        />
        <span
          aria-hidden="true"
          data-cell-specimen-scan-light
          style={{ position: 'absolute', zIndex: 2, left: 5, right: 5, top: 0, height: 1, background: `linear-gradient(90deg,transparent,${rgba(HUD_COLORS.cyanWire, 0.85)},${rgba(HUD_COLORS.orange, 0.46)},transparent)`, boxShadow: `0 0 9px ${rgba(HUD_COLORS.cyanWire, 0.7)}`, opacity: 0.8, animation: reduced ? undefined : 'cknerv-cell-specimen-sweep 2.8s linear infinite', pointerEvents: 'none' }}
        />
        <span style={portraitBracket('tl')} /><span style={portraitBracket('tr')} />
        <span style={portraitBracket('bl')} /><span style={portraitBracket('br')} />
      </section>

      <section
        aria-label="Cellular scan"
        data-cell-detail-module="anatomy"
        data-cell-inspection-satellite="anatomy"
        data-cellular-scan-state={scan.classified ? 'locked' : 'scanning'}
        data-cellular-scan-progress={scan.pct}
        style={{
          ...satelliteBase,
          ...(verticalLayout
            ? { right: 0, top: 72, width: '47%', height: anatomyHeight }
            : { ...fromFanEdge(0), top: 88, width: anatomyWidth, height: anatomyHeight }),
          overflow: 'hidden',
          padding: '12px 12px 10px 18px',
          borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.22)}`,
          borderBottom: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.12)}`,
          background: `linear-gradient(100deg,rgba(1,6,15,.9),rgba(2,10,21,.72) 72%,${rgba(HUD_COLORS.cyanWire, 0.035)})`,
          clipPath: 'polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)',
        }}
      >
        <span
          aria-hidden="true"
          data-cellular-scan-beam
          style={{ position: 'absolute', zIndex: 2, left: `${scan.pct}%`, top: 0, bottom: 0, width: 1, background: `linear-gradient(180deg,transparent,${HUD_COLORS.cyanWire},transparent)`, boxShadow: `0 0 12px ${HUD_COLORS.cyanWire}`, opacity: scan.classified ? 0.18 : 0.7, transition: reduced ? undefined : 'left 80ms linear, opacity 220ms ease', pointerEvents: 'none' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '3px 9px', marginBottom: 7 }}>
          <span style={{ color: statusColor, fontSize: 10, letterSpacing: 1.1, textShadow: `0 0 7px ${rgba(statusColor, 0.42)}` }}>
            {statusText}
          </span>
          <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontSize: 8.4, letterSpacing: 0.7 }}>
            A-LATTICE · {scan.reveal}/{order.length}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: verticalLayout ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: '4px 10px' }}>
          {order.map((field, index) => (
            <CellScanFact
              key={field}
              field={field}
              {...DECODE[field]}
              revealed={reduced || index < scan.reveal}
              selected={field === selectedField}
              interactive={scan.classified}
              onActivate={() => activateField(field)}
            />
          ))}
        </div>
        {semanticSource && semanticPhase ? (
          <CellSemanticsReadout
            source={semanticSource}
            phase={semanticPhase}
            record={semanticRecord}
            message={semanticMessage}
            transactionPhase={semanticTransactionPhase}
            transactionRecord={semanticTransactionRecord}
            transactionMessage={semanticTransactionMessage}
            spatial
            scanIntegrated
            scanNarrow={verticalLayout}
            style={verticalLayout
              ? { marginTop: 7 }
              : { marginTop: 7, width: '76.92%', zoom: 1.3 }}
          />
        ) : null}
      </section>

      <section
        aria-label="Cell lineage"
        data-cell-detail-module="lineage"
        data-cell-inspection-satellite="lineage"
        data-cell-scan-shard="lineage"
        style={{
          ...satelliteBase,
          ...(verticalLayout
            ? { left: 0, top: bottomTop, width: showTracePlate ? '49%' : '100%', height: bottomHeight }
            : { ...fromFanEdge(0), top: bottomTop, width: lineageWidth, height: bottomHeight }),
          overflow: 'hidden',
          padding: '8px 10px 11px 12px',
          borderLeft: `1px solid ${rgba('#AA88FF', 0.42)}`,
          borderTop: `1px solid ${rgba('#AA88FF', 0.16)}`,
          borderBottom: `1px solid ${rgba('#AA88FF', 0.1)}`,
          background: `linear-gradient(105deg,rgba(3,3,13,.97),rgba(4,4,16,.92) 78%,${rgba('#AA88FF', 0.045)})`,
          clipPath: 'polygon(0 0,calc(100% - 11px) 0,100% 11px,100% 100%,0 100%)',
        }}
      >
        <div data-cell-detail-readable-scale="true" style={{ width: readableWidth, zoom: readableScale }}>
          <ConsensusIdentityPlate
            identity={identity}
            dataHex={cell.data_hex}
            semanticSource={semanticSource}
            semanticPhase={semanticPhase}
            semanticRecord={semanticRecord}
            semanticMessage={semanticMessage}
            causalLens={resolvedCausalLens}
            causalNavigation={causalNavigation}
            reveal={scan.classified ? 1 : scan.pct / 100}
            statusText={statusText}
            statusColor={statusColor}
            reducedMotion={reduced}
            focusedField={selectedField}
            identityProofBinding={selectedIdentityProofBinding}
            onInspectAddress={scan.classified ? () => activateField('state') : undefined}
            onInspectContent={scan.classified ? () => activateField('data') : undefined}
            onInspectAnchor={scan.classified ? () => activateField('born') : undefined}
            onRecallWrite={identity.observedWrite && onTraceWrite
              ? () => onTraceWrite(identity.observedWrite!.seq)
              : undefined}
            recallEnabled={scan.classified && identityProofComplete}
            traceSource={traceSource}
            traceSelected={traceSelected}
            traceReadout={traceReadout}
            traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
            traceEvidencePreviewSourceId={traceEvidencePreviewSourceId}
            onTraceEvidenceFocusChange={onTraceEvidenceFocusChange}
            traceRouteHopFocus={traceRouteHopFocus}
            onTraceRouteHopFocusChange={onTraceRouteHopFocusChange}
            traceRouteHopLock={traceRouteHopLock}
            onTraceRouteHopLockChange={onTraceRouteHopLockChange}
            routeCellById={inspectedCellById}
            agreementCount={agreementTarget}
            compact
            spatial
            contentWide={verticalLayout}
          />
        </div>
      </section>

      {showTracePlate && traceReadout ? (
        <section
          aria-label="Consensus memory trace"
          data-cell-detail-module="trace"
          data-cell-inspection-satellite="trace"
          data-cell-scan-shard="trace"
          style={{
            ...satelliteBase,
            ...(verticalLayout
              ? { right: 0, top: bottomTop, width: '49%', height: bottomHeight }
              : { ...fromFanEdge(secondaryLeft), top: bottomTop, width: secondaryWidth, height: bottomHeight }),
            overflow: 'visible',
            padding: '8px 10px 10px 12px',
            borderLeft: `1px solid ${rgba('#AA88FF', 0.5)}`,
            borderTop: `1px solid ${rgba('#AA88FF', 0.2)}`,
            borderBottom: `1px solid ${rgba('#AA88FF', 0.12)}`,
            background: 'linear-gradient(105deg,rgba(4,3,14,.98),rgba(7,5,18,.94) 78%,rgba(170,136,255,.055))',
            clipPath: 'polygon(0 0,calc(100% - 11px) 0,100% 11px,100% 100%,0 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, color: '#C7B9FF', fontFamily: HUD_FONTS.tech, fontSize: 8.4, fontWeight: 700, letterSpacing: 1.2 }}>
            <span>MEMORY TRACE</span>
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: 6.8, fontWeight: 400, letterSpacing: 0.55 }}>
              LIVE EVIDENCE
            </span>
          </div>
          <div data-cell-detail-readable-scale="true" style={{ width: readableWidth, zoom: readableScale }}>
            <ConsensusMemoryTracePlate
              readout={traceReadout}
              reducedMotion={reduced}
              targetContentHash={identity.contentHash}
              agreementCount={agreementTarget}
              focusedSourceId={traceEvidenceFocusSourceId}
              previewSourceId={traceEvidencePreviewSourceId}
              onFocusChange={onTraceEvidenceFocusChange}
              focusedHop={traceRouteHopFocus}
              onHopFocusChange={onTraceRouteHopFocusChange}
              lockedHop={traceRouteHopLock}
              onHopLockChange={onTraceRouteHopLockChange}
              routeCellById={inspectedCellById}
            />
          </div>
        </section>
      ) : null}

    </div>
  );
}
