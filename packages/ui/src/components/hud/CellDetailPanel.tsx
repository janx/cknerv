import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
  formatBlockRef,
  formatDataSize,
  formatLockKind,
  formatAssetKind,
  LOCK_COLORS,
  ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import {
  CloseButton,
  SpatialPlateHeader,
  spatialPlate,
  spatialPlateBackground,
} from './primitives';
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

type CellScanFactProps = RowDecode & {
  field: CellInspectionFacet;
  revealed: boolean;
  selected: boolean;
  interactive: boolean;
  onActivate: () => void;
};

const CellScanFact = memo(function CellScanFact({
  field,
  label,
  value,
  color,
  revealed,
  selected,
  interactive,
  onActivate,
}: CellScanFactProps) {
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
}, (previous, next) => (
  previous.field === next.field
  && previous.label === next.label
  && previous.value === next.value
  && previous.color === next.color
  && previous.revealed === next.revealed
  && previous.selected === next.selected
  && previous.interactive === next.interactive
));

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
  // Composition backfill emits born_at_ms 0 for records born before the
  // retained window — an epoch-relative age would read as decades.
  const lifetime = cell.born_at_ms > 0
    ? `AGE ${formatAge(cell.born_at_ms, Date.now())}`
    : `SINCE ${formatBlockRef(cell.birth_block)}`;
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
  const handlePortraitIdentityProofRead = useCallback((
    kind: CellIdentityProofKind,
  ) => {
    onIdentityProofRead?.(kind, cell.id, reduced);
  }, [cell.id, onIdentityProofRead, reduced]);
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
    born: { label: 'COMMIT', value: formatBlockRef(cell.birth_block) },
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
    ? 'CELL IDENTITY LOCKED'
    : scan.status === 'unidentified'
      ? 'CELL IDENTITY SCANNING'
      : `CELL IDENTITY ${scan.pct}%`;
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
  const secondaryWidth = 360;
  const lineageWidth = showTracePlate
    ? enhancedDetail ? 420 : 320
    : enhancedDetail ? 560 : 480;
  const readableScale = verticalLayout ? 1 : 1.2;
  const readableWidth = `${(100 / readableScale).toFixed(2)}%`;
  const semanticScanStyle = useMemo<CSSProperties>(
    () => verticalLayout
      ? { marginTop: 7 }
      : { marginTop: 7, width: '76.92%', zoom: 1.3 },
    [verticalLayout],
  );
  const satelliteBase: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  };
  // One shared grid: a text column and a portrait column under a full-width
  // header, the bottom shard spanning both. Mirroring for a right-side fan is
  // column order, not per-satellite coordinate math — the portrait column
  // always sits on the edge nearest the inspected Cell.
  const portraitFirst = verticalLayout || layoutSide === 'right';
  const constellationColumns = verticalLayout
    ? '190px minmax(0, 1fr)'
    : portraitFirst
      ? `${portraitWidth}px minmax(0, 1fr)`
      : `minmax(0, 1fr) ${portraitWidth}px`;
  const constellationAreas = portraitFirst
    ? '"header header" "portrait anatomy" "bottom bottom"'
    : '"header header" "anatomy portrait" "bottom bottom"';
  const bottomGridColumns = verticalLayout
    ? showTracePlate
      ? 'repeat(2, minmax(0, 1fr))'
      : 'minmax(0, 1fr)'
    : showTracePlate
      ? layoutSide === 'right'
        ? `${secondaryWidth}px 20px ${lineageWidth}px`
        : `${lineageWidth}px 20px ${secondaryWidth}px`
      : `${lineageWidth}px`;
  const lineageGridColumn = !verticalLayout
    && showTracePlate
    && layoutSide === 'right'
    ? 3
    : 1;
  const traceGridColumn = verticalLayout || layoutSide !== 'right' ? 2 : 1;

  return (
    <div
      data-cell-detail-scan-field="true"
      data-cell-detail-enhanced={enhancedDetail ? 'true' : 'false'}
      data-cell-detail-layout={verticalLayout ? 'vertical' : layoutSide}
      data-cell-detail-readability="large"
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: constellationColumns,
        gridTemplateAreas: constellationAreas,
        columnGap: verticalLayout ? 14 : 20,
        rowGap: 12,
        alignItems: 'start',
        width: rootWidth,
        maxWidth: 'calc(100vw - 28px)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow around the constellation replaces a separate
        // filter surface for every satellite.
        filter: `drop-shadow(0 8px 16px rgba(0,0,0,.56)) drop-shadow(0 0 14px ${rgba(HUD_COLORS.cyanWire, 0.06)})`,
        animation: reduced
          ? undefined
          : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
        ...style,
      }}
    >
      <section
        data-cell-inspection-satellite="identity"
        data-cell-scan-identity
        style={{
          ...satelliteBase,
          gridArea: 'header',
          minHeight: verticalLayout ? 56 : 58,
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 10px',
          minWidth: 0,
          padding: '9px 38px 8px 16px',
          ...spatialPlate(HUD_COLORS.orange),
        }}
      >
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.display, fontSize: 13, fontWeight: 600, letterSpacing: 2, textShadow: '0 0 9px rgba(255,152,48,.45)' }}>
          CELL // #{cell.id}
        </span>
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.cjk, fontSize: 11, opacity: 0.78 }}>
          共识细胞
        </span>
        <span title={cell.content_hash} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: HUD_COLORS.dim, fontSize: 9.5, letterSpacing: 0.8 }}>
          {cell.content_hash.slice(2, 10)}:{cell.out_point.index}
        </span>
        <span style={{ marginLeft: 'auto', color: live ? HUD_COLORS.nominal : HUD_COLORS.caution, fontSize: 10.5, letterSpacing: 0.9 }}>
          {live ? '● LIVE' : '◇ SPENT'} · {lifetime}
        </span>
        <span style={{ position: 'absolute', top: 7, right: 30, fontFamily: HUD_FONTS.mono, fontSize: 8.5, letterSpacing: 1, color: '#5a6470' }}>
          SCAN·06
        </span>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      <section
        aria-label="Interactive Cell scan"
        data-cell-detail-module="specimen"
        data-cell-inspection-satellite="specimen"
        data-cell-portrait-frame
        style={{
          ...satelliteBase,
          gridArea: 'portrait',
          width: '100%',
          aspectRatio: '1 / 1',
          overflow: 'hidden',
          border: `1px solid ${rgba(HUD_COLORS.orange, 0.24)}`,
          // Directional plate, matching the sibling satellites — NOT a radial
          // field. The circular idiom in this viewport belongs to the content
          // address halo (the one ring that reads as data).
          background: spatialPlateBackground(HUD_COLORS.cyanWire),
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
            ? handlePortraitIdentityProofRead
            : undefined}
          onInteractionChange={onScanInteractionChange}
        />
        {/* Ambient specimen sweep — it loops for as long as the panel is open
          * and deliberately outlives the probe walk, so a classified specimen
          * still reads as live instrumentation. It animates transform/opacity
          * only (never `top`), which is what keeps it off the layout path. */}
        <span
          key={cell.id}
          aria-hidden="true"
          data-cell-specimen-scan-light
          style={{ position: 'absolute', zIndex: 2, left: 5, right: 5, top: '9%', height: '82%', opacity: 0.8, animation: reduced ? undefined : 'cknerv-cell-specimen-sweep 2.8s linear infinite', pointerEvents: 'none', willChange: reduced ? undefined : 'transform, opacity' }}
        >
          <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg,transparent,${rgba(HUD_COLORS.cyanWire, 0.85)},${rgba(HUD_COLORS.orange, 0.46)},transparent)`, boxShadow: `0 0 9px ${rgba(HUD_COLORS.cyanWire, 0.7)}` }} />
        </span>
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
          gridArea: 'anatomy',
          alignSelf: 'stretch',
          minHeight: verticalLayout ? 202 : 200,
          overflow: 'hidden',
          padding: '12px 12px 10px 18px',
          ...spatialPlate(HUD_COLORS.cyanWire),
        }}
      >
        <span
          aria-hidden="true"
          data-cellular-scan-beam
          style={{ position: 'absolute', zIndex: 2, left: 0, top: 0, bottom: 0, width: '100%', transform: `translate3d(${scan.pct}%,0,0)`, opacity: scan.classified ? 0.18 : 0.7, transition: reduced ? undefined : 'transform 80ms linear, opacity 220ms ease', pointerEvents: 'none', willChange: reduced || scan.classified ? undefined : 'transform, opacity' }}
        >
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: `linear-gradient(180deg,transparent,${HUD_COLORS.cyanWire},transparent)`, boxShadow: `0 0 12px ${HUD_COLORS.cyanWire}` }} />
        </span>
        <SpatialPlateHeader
          en="CELL IDENTITY"
          cjk="细胞身份"
          accent={HUD_COLORS.cyanWire}
          status={(
            <span
              data-cell-identity-scan-status="true"
              style={{ color: statusColor, fontSize: 8.2, letterSpacing: 0.72, textShadow: `0 0 7px ${rgba(statusColor, 0.42)}` }}
            >
              {scan.classified ? 'LOCKED' : `SCANNING ${scan.pct}%`}
              {' · '}A-LATTICE {scan.reveal}/{order.length}
            </span>
          )}
        />
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
            birthBlock={cell.birth_block}
            message={semanticMessage}
            transactionPhase={semanticTransactionPhase}
            transactionRecord={semanticTransactionRecord}
            transactionMessage={semanticTransactionMessage}
            spatial
            scanIntegrated
            scanNarrow={verticalLayout}
            style={semanticScanStyle}
          />
        ) : null}
      </section>

      <div
        data-cell-detail-bottom-widgets="true"
        style={{
          position: 'relative',
          gridArea: 'bottom',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: bottomGridColumns,
          columnGap: verticalLayout && showTracePlate ? '2%' : 0,
          alignItems: 'start',
          justifyContent: !verticalLayout && !showTracePlate && layoutSide === 'right'
            ? 'end'
            : 'start',
          minWidth: 0,
          pointerEvents: 'none',
        }}
      >
        <section
          aria-label="Consensus memory"
          data-cell-detail-module="lineage"
          data-cell-inspection-satellite="lineage"
          data-cell-scan-shard="lineage"
          data-cell-detail-size="content"
          style={{
            ...satelliteBase,
            position: 'relative',
            gridColumn: lineageGridColumn,
            width: 'auto',
            overflow: 'visible',
            padding: '8px 10px 11px 12px',
            ...spatialPlate('#AA88FF'),
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
              identityProofBinding={selectedIdentityProofBinding}
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
            data-cell-detail-size="content"
            style={{
              ...satelliteBase,
              position: 'relative',
              gridColumn: traceGridColumn,
              width: 'auto',
              overflow: 'visible',
              padding: '8px 10px 10px 12px',
              ...spatialPlate('#AA88FF'),
            }}
          >
            <SpatialPlateHeader
              en="MEMORY TRACE"
              accent="#AA88FF"
              titleColor="#C7B9FF"
              marginBottom={0}
              status={(
                <span style={{ color: HUD_COLORS.dim, fontFamily: HUD_FONTS.mono, fontSize: 6.8, letterSpacing: 0.55 }}>
                  LIVE EVIDENCE
                </span>
              )}
            />
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

    </div>
  );
}
