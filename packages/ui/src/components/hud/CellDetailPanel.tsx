import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type {
  Cell,
  CellLink,
  CellSemanticRecord,
  EnrichmentSourceStatus,
  TransactionSemanticRecord,
} from '@cknerv/types';
import {
  formatCkb, formatAge, formatDataSize,
  formatLockKind, formatAssetKind, LOCK_COLORS, ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait from './CellNucleusPortrait';
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

const BRACKET = 9; // corner bracket arm length (px)
const AMBER = HUD_COLORS.orange;
const EMPTY_RECENT_LINKS: readonly CellLink[] = [];

function cornerBracket(corner: 'tl' | 'tr' | 'bl' | 'br'): CSSProperties {
  const vy: CSSProperties = corner[0] === 't' ? { top: 0 } : { bottom: 0 };
  const hx: CSSProperties = corner[1] === 'l' ? { left: 0 } : { right: 0 };
  const bw =
    corner === 'tl' ? '1px 0 0 1px' : corner === 'tr' ? '1px 1px 0 0' :
    corner === 'bl' ? '0 0 1px 1px' : '0 1px 1px 0';
  return { position: 'absolute', width: BRACKET, height: BRACKET, borderColor: AMBER, borderStyle: 'solid', borderWidth: bw, opacity: 0.75, ...vy, ...hx };
}

// On-chain field → user-facing fact. A row may focus the matching portrait
// layer, but renderer-only topology values never leak into the readout.
type RowDecode = { label: string; value: string; color?: string };
type Field = ConsensusBraidField;
type DetailSection = 'anatomy' | 'context' | 'lineage';

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
  onClose: () => void;
  style?: CSSProperties;
}

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function formatCellData(dataHex: string): string {
  const size = formatDataSize(dataHex);
  if (size === '0 B') return 'Empty';
  return dataHex.endsWith('…') ? `${size} observed` : size;
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
  onClose,
  style,
}: CellDetailPanelProps) {
  const reduced = useReducedMotion();
  const live = cell.death_at_ms === null;
  const now = Date.now();
  const enhancedDetail = Boolean(semanticSource && semanticPhase);
  const age = formatAge(cell.born_at_ms, now);
  const defaultSection: DetailSection = enhancedDetail ? 'context' : 'anatomy';
  const [sectionState, setSectionState] = useState<{
    cellId: number;
    section: DetailSection;
  }>(() => ({ cellId: cell.id, section: defaultSection }));
  const storedSection = sectionState.cellId === cell.id
    ? sectionState.section
    : defaultSection;
  const activeSection = storedSection === 'context' && !enhancedDetail
    ? 'anatomy'
    : storedSection;
  const selectSection = (section: DetailSection) => {
    setSectionState({ cellId: cell.id, section });
  };
  // One scan epoch per selected Cell. Epoch + current time reset together when
  // the effect actually mounts, so a busy main thread cannot skip unseen scan
  // phases between render and first paint. The short-lived 12.5 fps ticker
  // advances only the six-field pass and stops after classification.
  const [scanClock, setScanClock] = useState(() => {
    const atMs = nowPerf();
    return { cellId: cell.id, epochMs: atMs, nowMs: atMs };
  });

  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const identity = useMemo(
    () => deriveCellConsensusIdentity(cell, recentLinks),
    [cell, recentLinks],
  );
  const selectedIdentityProofBinding =
    identityProofBinding?.cellId === cell.id ? identityProofBinding : null;
  const identityProofComplete = cellIdentityProofBindingComplete(
    selectedIdentityProofBinding,
  );
  const inspectedCellById = useMemo(() => {
    if (routeCellById?.get(cell.id) === cell) return routeCellById;
    const cells = new Map(routeCellById);
    // The selected target is authoritative even when callers omit routeCellById
    // or pass a snapshot that predates the current detail selection.
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

  // After decoding, a row directly focuses its corresponding A layer.
  const [selectedFieldState, setSelectedFieldState] = useState<{
    cellId: number;
    field: Field | null;
  }>(() => ({ cellId: cell.id, field: null }));
  const selectedField = selectedFieldState.cellId === cell.id
    ? selectedFieldState.field
    : null;
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
  const selectField = (field: Field) => setSelectedFieldState((current) => ({
    cellId: cell.id,
    field: current.cellId === cell.id && current.field === field
      ? null
      : field,
  }));

  const DECODE: Record<Field, RowDecode> = {
    capacity: {
      label: 'CAPACITY',
      value: formatCkb(cell.capacity),
    },
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
      value: `${live ? '● LIVE' : '◇ SPENT'}${enhancedDetail ? ` · ${age}` : ''}`,
      color: live ? HUD_COLORS.nominal : HUD_COLORS.caution,
    },
    born: { label: 'COMMIT', value: `#${cell.birth_block}` },
  };

  // Scan state for THIS render. It reveals the six decoded readout rows while
  // leaving the portrait stable; only an explicit row action focuses one of
  // A's layers after classification.
  const activeClock = scanClock.cellId === cell.id
    ? scanClock
    : { cellId: cell.id, epochMs: scanClock.nowMs, nowMs: scanClock.nowMs };
  const p = probeScan(
    activeClock.epochMs,
    reduced ? 0 : activeClock.nowMs,
    order.length,
    reduced,
  );
  const statusText = p.classified
    ? '✓ CONTENT IDENTITY MAPPED'
    : p.status === 'unidentified'
      ? 'IDENTITY UNRESOLVED'
      : `READING IDENTITY ${p.pct}%`;
  const statusColor = p.classified ? HUD_COLORS.nominal : HUD_COLORS.cyanWire;
  const interactive = p.classified;
  const focusField = interactive ? selectedField : null;

  // The six fact rows remain mounted and opacity-gated. They resolve in
  // field order without driving auxiliary portrait lines. Standard mode keeps
  // AGE on its own row; enhanced mode folds it into STATE to avoid repeating
  // temporal context across the taller semantic stack. Immutable address and
  // content identity live in the consensus-memory plate below.
  const rows: Array<RowDecode & { on: boolean; field?: Field }> = [
    ...order.map((field, index) => ({
      ...DECODE[field],
      on: index < p.reveal || (enhancedDetail && field === 'state'),
      field,
    })),
    ...(enhancedDetail ? [] : [{ label: 'AGE', value: age, on: true }]),
  ];

  const tabs: Array<{ id: DetailSection; label: string; meta: string }> = [
    { id: 'anatomy', label: 'ANATOMY', meta: '结构' },
    ...(enhancedDetail
      ? [{ id: 'context' as const, label: 'CONTEXT', meta: '语义' }]
      : []),
    { id: 'lineage', label: 'LINEAGE', meta: '因果' },
  ];
  const inspectField = (field: Field) => {
    selectField(field);
    selectSection('anatomy');
  };

  return (
    <HudPanel style={{
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      width: 500,
      maxWidth: 'calc(100vw - 28px)',
      maxHeight: 'calc(100vh - 124px)',
      boxSizing: 'border-box',
      padding: '12px 14px 14px',
      pointerEvents: 'auto',
      overflow: 'hidden',
      background: 'linear-gradient(145deg, rgba(0,2,9,.975) 0%, rgba(0,5,14,.95) 58%, rgba(2,5,13,.975) 100%)',
      border: `1px solid ${HUD_COLORS.cyanWire}18`,
      boxShadow: `0 18px 55px rgba(0,0,0,.46), 0 0 26px ${HUD_COLORS.cyanWire}0b, inset 0 0 34px ${HUD_COLORS.cyanWire}08`,
      transformOrigin: 'center center',
      animation: reduced
        ? undefined
        : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
      ...style,
    }}>
      <CloseButton onClose={onClose} />
      <PanelHeader
        en="CELL"
        cjk="共识细胞"
        idx={`#${cell.id} · ${cell.content_hash.slice(2, 10)}`}
        accent={live ? HUD_COLORS.nominal : HUD_COLORS.caution}
      />

      {/* Selection stays visually tied to one canonical Cell. These four facts
          remain visible while the deeper modules switch underneath. */}
      <div
        data-cell-detail-summary
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 1,
          margin: '-2px 0 8px',
          border: `1px solid ${HUD_COLORS.cyanWire}12`,
          background: `${HUD_COLORS.cyanWire}05`,
        }}
      >
        {[
          ['STATE', live ? '● LIVE' : '◇ SPENT', live ? HUD_COLORS.nominal : HUD_COLORS.caution],
          ['CAPACITY', formatCkb(cell.capacity), HUD_COLORS.ink],
          ['ASSET', formatAssetKind(cell.asset_kind), cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.dim],
          ['AGE', age, HUD_COLORS.ink],
        ].map(([label, value, color]) => (
          <div
            key={label}
            style={{ minWidth: 0, padding: '5px 6px 4px', borderRight: label === 'AGE' ? undefined : `1px solid ${HUD_COLORS.cyanWire}0d` }}
          >
            <span style={{ display: 'block', color: HUD_COLORS.dim, fontSize: 6.5, letterSpacing: 1.05 }}>{label}</span>
            <span title={value} style={{ display: 'block', marginTop: 2, color, fontSize: 8.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
          </div>
        ))}
      </div>

      <div
        role="tablist"
        aria-label="Cell detail sections"
        data-cell-detail-sections
        style={{ display: 'flex', flex: '0 0 auto', gap: 3, marginBottom: 8 }}
      >
        {tabs.map((tab, index) => {
          const selected = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`cell-detail-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`cell-detail-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectSection(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
                );
                const current = buttons.indexOf(event.currentTarget);
                if (current < 0 || buttons.length === 0) return;
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                const next = buttons[(current + direction + buttons.length) % buttons.length];
                next?.click();
                next?.focus();
              }}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                height: 24,
                border: `1px solid ${selected ? HUD_COLORS.orange : `${HUD_COLORS.cyanWire}18`}`,
                background: selected ? `${HUD_COLORS.orange}16` : 'rgba(1,4,12,.48)',
                color: selected ? HUD_COLORS.orange : HUD_COLORS.dim,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 7.2,
                letterSpacing: 1.05,
              }}
            >
              <span>{String(index + 1).padStart(2, '0')} · {tab.label}</span>
              <span style={{ marginLeft: 5, opacity: 0.55 }}>{tab.meta}</span>
            </button>
          );
        })}
      </div>

      <div
        data-cell-detail-module-viewport
        style={{ minHeight: 0, overflowX: 'hidden', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(125,249,255,.24) transparent' }}
      >
        <section
          id="cell-detail-anatomy"
          role="tabpanel"
          aria-label="Cell anatomy"
          aria-labelledby="cell-detail-tab-anatomy"
          hidden={activeSection !== 'anatomy'}
          data-cell-detail-module="anatomy"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, .82fr) minmax(180px, 1fr)', gap: 12, alignItems: 'start' }}>
            {/* Entry decoding leaves A stable; explicit row selection owns focus. */}
            <div
              data-cell-portrait-frame
              data-cell-detail-density="contextual"
              style={{ position: 'relative', width: '100%', maxWidth: '100%', margin: 0 }}
            >
              <CellNucleusPortrait
                cell={cell}
                reducedMotion={reduced}
                scanEpochMs={activeClock.epochMs}
                focusField={focusField}
                traceReadout={traceReadout}
                traceResponseRef={traceResponseRef}
                traceEvidenceFocusSourceId={traceEvidenceFocusSourceId}
                identityProofBinding={selectedIdentityProofBinding}
                onIdentityProofRead={onIdentityProofRead
                  ? (kind) => onIdentityProofRead(kind, cell.id, reduced)
                  : undefined}
              />
              <span style={cornerBracket('tl')} /><span style={cornerBracket('tr')} />
              <span style={cornerBracket('bl')} /><span style={cornerBracket('br')} />
            </div>
            <div key={cell.id}>
              <div style={{ marginBottom: 4, color: statusColor, fontSize: 7, letterSpacing: 1 }}>{statusText}</div>
              {rows.map((row) => {
                const clickable = interactive && !!row.field;
                const sel = !!row.field && row.field === selectedField;
                return (
                  <div
                    key={row.label}
                    data-cell-detail-field={row.field}
                    onClick={clickable ? () => selectField(row.field!) : undefined}
                    style={{
                      opacity: reduced || row.on ? 1 : 0.16,
                      transition: reduced ? undefined : 'opacity 320ms ease',
                      cursor: clickable ? 'pointer' : undefined,
                      background: sel ? `${HUD_COLORS.cyanWire}1f` : undefined,
                      boxShadow: sel ? `inset 2px 0 0 ${HUD_COLORS.cyanWire}` : undefined,
                    }}
                  >
                    <StatRow label={row.label} valueColor={row.color}>{row.value}</StatRow>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {semanticSource && semanticPhase ? (
          <section
            id="cell-detail-context"
            role="tabpanel"
            aria-label="Cell indexed context"
            aria-labelledby="cell-detail-tab-context"
            hidden={activeSection !== 'context'}
            data-cell-detail-module="context"
          >
            <CellSemanticsReadout
              source={semanticSource}
              phase={semanticPhase}
              record={semanticRecord}
              message={semanticMessage}
              transactionPhase={semanticTransactionPhase}
              transactionRecord={semanticTransactionRecord}
              transactionMessage={semanticTransactionMessage}
              style={{ margin: 0 }}
            />
          </section>
        ) : null}

        <section
          id="cell-detail-lineage"
          role="tabpanel"
          aria-label="Cell lineage"
          aria-labelledby="cell-detail-tab-lineage"
          hidden={activeSection !== 'lineage'}
          data-cell-detail-module="lineage"
        >
          <ConsensusIdentityPlate
            identity={identity}
            causalLens={resolvedCausalLens}
            causalNavigation={causalNavigation}
            reveal={p.classified ? 1 : p.pct / 100}
            statusText={statusText}
            statusColor={statusColor}
            reducedMotion={reduced}
            focusedField={selectedField}
            identityProofBinding={selectedIdentityProofBinding}
            onInspectAddress={interactive ? () => inspectField('state') : undefined}
            onInspectContent={interactive ? () => inspectField('data') : undefined}
            onInspectAnchor={interactive ? () => inspectField('born') : undefined}
            onRecallWrite={identity.observedWrite && onTraceWrite
              ? () => onTraceWrite(identity.observedWrite!.seq)
              : undefined}
            recallEnabled={interactive && identityProofComplete}
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
            compact={enhancedDetail}
          />
        </section>
      </div>
    </HudPanel>
  );
}
