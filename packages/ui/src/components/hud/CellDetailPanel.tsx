import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { Cell, CellLink } from '@cknerv/types';
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
  consensusBraidFrequencies,
  consensusBraidStrandCount,
  type ConsensusBraidField,
} from '../../derives/consensusBraid.derive';
import {
  cellIdentityProofBindingComplete,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '../../derives/cellIdentityProof.derive';

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

// Consensus field → decoded readout. These six rows are the readable grammar of
// A, not an anatomical classification layered over the Cell.
type RowDecode = { label: string; value: string; color?: string };
type Field = ConsensusBraidField;

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

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
  onClose,
  style,
}: {
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
  onClose: () => void;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const live = cell.death_at_ms === null;
  const now = Date.now();
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
  const frequencies = consensusBraidFrequencies(visual.assetClass);
  const strandCount = consensusBraidStrandCount(visual.lockClass);
  const agreementTarget = consensusBraidAgreementTarget(visual);

  // After decoding, a row directly focuses its corresponding A layer.
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  useEffect(() => setSelectedField(null), [cell.id]);
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
  const selectField = (f: Field) => setSelectedField((cur) => (cur === f ? null : f));

  const DECODE: Record<Field, RowDecode> = {
    capacity: {
      label: 'CAPACITY',
      value: `${formatCkb(cell.capacity)} · ${visual.mass.toFixed(2)}×`,
    },
    asset: {
      label: 'ASSET',
      value: `${formatAssetKind(cell.asset_kind)} · ƒ${frequencies.join(':')}`,
      color: cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.dim,
    },
    lock: {
      label: 'LOCK',
      value: `${formatLockKind(cell.lock_kind)} · ${strandCount} paths`,
      color: cell.lock_kind ? LOCK_COLORS[cell.lock_kind] : HUD_COLORS.dim,
    },
    data: {
      label: 'DATA',
      value: `${formatDataSize(cell.data_hex)} · ${agreementTarget} knots`,
      color: HUD_COLORS.nominal,
    },
    state: {
      label: 'STATE',
      value: live ? '● LIVE' : '◇ SPENT',
      color: live ? HUD_COLORS.nominal : HUD_COLORS.caution,
    },
    born: { label: 'COMMIT', value: `#${cell.birth_block}` },
  };

  // Scan state for THIS render. During decoding it walks the six visible A
  // layers; after classification, clicking a row becomes the focus source.
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
  const focusField = interactive
    ? selectedField
    : order[Math.min(p.activeIndex, order.length - 1)] ?? null;

  // All seven readout rows remain mounted and opacity-gated. The six encoded
  // rows resolve in the same order that the portrait emphasizes their layers;
  // AGE is temporal context and always shown. Immutable address + content
  // identity have moved into the consensus-memory plate below.
  const rows: Array<RowDecode & { on: boolean; field?: Field }> = [
    ...order.map((field, index) => ({
      ...DECODE[field],
      on: index < p.reveal,
      field,
    })),
    { label: 'AGE', value: formatAge(cell.born_at_ms, now), on: true },
  ];

  return (
    <HudPanel style={{
      width: 270,
      pointerEvents: 'auto',
      background: 'linear-gradient(180deg, rgba(0,2,9,.88) 0%, rgba(0,3,11,.78) 58%, rgba(1,4,12,.86) 100%)',
      boxShadow: `-14px 0 30px rgba(0,0,0,.2), inset 0 0 34px ${HUD_COLORS.cyanWire}08`,
      transformOrigin: 'right top',
      animation: reduced
        ? undefined
        : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
      ...style,
    }}>
      <CloseButton onClose={onClose} />
      <PanelHeader en="CELL" cjk="共识细胞" idx={`0x${cell.content_hash.slice(2, 10)}`} accent={HUD_COLORS.orange} />
      {/* The scan now acts on A itself: each phase emphasizes one encoded layer. */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
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
        {rows.map((row) => {
          const clickable = interactive && !!row.field;
          const sel = !!row.field && row.field === selectedField;
          return (
            <div
              key={row.label}
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
        onInspectAddress={interactive ? () => selectField('state') : undefined}
        onInspectContent={interactive ? () => selectField('data') : undefined}
        onInspectAnchor={interactive ? () => selectField('born') : undefined}
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
      />
    </HudPanel>
  );
}
