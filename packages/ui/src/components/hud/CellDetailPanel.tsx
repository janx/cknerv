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
import ConsensusIdentityPlate from './ConsensusIdentityPlate';
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

type RowDecode = { label: string; value: string; color?: string };
export type CellInspectionFacet = ConsensusBraidField;

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
  semanticSource?: EnrichmentSourceStatus;
  semanticPhase?: CellSemanticsPhase;
  semanticRecord?: CellSemanticRecord | null;
  semanticMessage?: string | null;
  semanticTransactionPhase?: CellSemanticsPhase;
  semanticTransactionRecord?: TransactionSemanticRecord | null;
  semanticTransactionMessage?: string | null;
  /** Mirrors a selected readout facet into the real scene Cell scan field. */
  onInspectionFieldChange?: (field: CellInspectionFacet | null) => void;
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
        minHeight: 34,
        margin: 0,
        padding: '4px 5px 4px 9px',
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
      <span style={{ display: 'block', fontSize: 6.5, letterSpacing: 1.1, color: HUD_COLORS.dim }}>
        {label}
      </span>
      <span
        title={value}
        style={{ display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 8.5, color: selected ? accent : color ?? HUD_COLORS.ink }}
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
  semanticSource,
  semanticPhase,
  semanticRecord,
  semanticMessage,
  semanticTransactionPhase,
  semanticTransactionRecord,
  semanticTransactionMessage,
  onInspectionFieldChange,
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

  return (
    <div
      data-cell-detail-scan-field="true"
      data-cell-detail-enhanced={enhancedDetail ? 'true' : 'false'}
      style={{
        position: 'relative',
        width: enhancedDetail ? 500 : 470,
        maxWidth: 'calc(100vw - 28px)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        filter: `drop-shadow(0 8px 18px rgba(0,0,0,.62)) drop-shadow(0 0 12px ${rgba(HUD_COLORS.cyanWire, 0.08)})`,
        animation: reduced
          ? undefined
          : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 14, width: 42, height: 1, background: `linear-gradient(90deg,${HUD_COLORS.orange},transparent)` }}
      />
      <div
        data-cell-scan-identity
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          minWidth: 0,
          padding: '5px 30px 5px 50px',
          background: 'linear-gradient(90deg,rgba(1,5,13,.86),rgba(1,5,13,.58) 72%,transparent)',
        }}
      >
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.tech, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.8 }}>
          CELL // #{cell.id}
        </span>
        <span style={{ color: HUD_COLORS.orange, fontFamily: HUD_FONTS.cjk, fontSize: 8, opacity: 0.72 }}>
          共识细胞
        </span>
        <span title={cell.content_hash} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: HUD_COLORS.dim, fontSize: 7.3, letterSpacing: 0.75 }}>
          {cell.content_hash.slice(2, 10)}:{cell.out_point.index}
        </span>
        <span style={{ marginLeft: 'auto', color: live ? HUD_COLORS.nominal : HUD_COLORS.caution, fontSize: 7.8, letterSpacing: 0.8 }}>
          {live ? '● LIVE' : '◇ SPENT'} · AGE {age}
        </span>
      </div>
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        style={{ position: 'absolute', top: 1, right: 0, width: 24, height: 24, padding: 0, border: 0, background: 'transparent', color: HUD_COLORS.dim, font: `10px ${HUD_FONTS.mono}`, cursor: 'crosshair', pointerEvents: 'auto' }}
      >
        ×
      </button>

      <section
        aria-label="Cellular scan"
        data-cell-detail-module="anatomy"
        data-cellular-scan-state={scan.classified ? 'locked' : 'scanning'}
        data-cellular-scan-progress={scan.pct}
        style={{
          position: 'relative',
          marginTop: 2,
          padding: '8px 10px 8px 18px',
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
          <span style={{ color: statusColor, fontSize: 7.3, letterSpacing: 1.05, textShadow: `0 0 7px ${rgba(statusColor, 0.42)}` }}>
            {statusText}
          </span>
          <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontSize: 6.3, letterSpacing: 0.65 }}>
            A-LATTICE / 结构扫描 · {scan.reveal}/{order.length}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '3px 8px' }}>
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
      </section>

      <div
        data-cell-detail-evidence-field
        style={{ display: 'grid', gridTemplateColumns: enhancedDetail ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: '8px 12px', alignItems: 'start', marginTop: 7 }}
      >
        <section
          aria-label="Cell lineage"
          data-cell-detail-module="lineage"
          data-cell-scan-shard="lineage"
          style={{
            minWidth: 0,
            maxHeight: enhancedDetail ? 245 : 320,
            overflowX: 'hidden',
            overflowY: 'auto',
            padding: '6px 8px 9px 10px',
            borderLeft: `1px solid ${rgba('#AA88FF', 0.36)}`,
            background: `linear-gradient(105deg,rgba(4,3,15,.88),rgba(5,4,17,.62) 78%,${rgba('#AA88FF', 0.025)})`,
            clipPath: 'polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)',
            scrollbarWidth: 'none',
            maskImage: 'linear-gradient(180deg,#000 0,#000 calc(100% - 12px),transparent 100%)',
            pointerEvents: 'auto',
          }}
        >
          <ConsensusIdentityPlate
            identity={identity}
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
            traceSelected={identity.observedWrite?.seq === tracedWriteSeq}
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
          />
        </section>

        {semanticSource && semanticPhase ? (
          <section
            aria-label="Cell indexed context"
            data-cell-detail-module="context"
            data-cell-scan-shard="context"
            style={{
              minWidth: 0,
              maxHeight: 245,
              overflowX: 'hidden',
              overflowY: 'auto',
              padding: '6px 8px 9px 10px',
              borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.36)}`,
              background: `linear-gradient(105deg,rgba(1,6,15,.88),rgba(2,9,20,.62) 78%,${rgba(HUD_COLORS.cyanWire, 0.025)})`,
              clipPath: 'polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)',
              scrollbarWidth: 'none',
              maskImage: 'linear-gradient(180deg,#000 0,#000 calc(100% - 12px),transparent 100%)',
              pointerEvents: 'auto',
            }}
          >
            <CellSemanticsReadout
              source={semanticSource}
              phase={semanticPhase}
              record={semanticRecord}
              message={semanticMessage}
              transactionPhase={semanticTransactionPhase}
              transactionRecord={semanticTransactionRecord}
              transactionMessage={semanticTransactionMessage}
              spatial
              style={{ margin: 0 }}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
