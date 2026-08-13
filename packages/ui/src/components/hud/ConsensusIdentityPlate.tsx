import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  Cell,
  CellSemanticRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import type { CellConsensusIdentity } from '../../derives/cellConsensusIdentity.derive';
import type { CellCausalLens } from '../../derives/cellCausalLens.derive';
import {
  CELL_IDENTITY_PROOF_KINDS,
  cellIdentityProofBindingComplete,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '../../derives/cellIdentityProof.derive';
import {
  consensusMemoryEvidenceBindings,
  consensusMemoryEvidenceCssColor,
  consensusMemoryEvidenceFingerprint,
} from '../../derives/consensusMemoryEvidence.derive';
import type {
  ConsensusMemoryRouteHopFocus,
  ConsensusMemoryTraceEvidence,
  ConsensusMemoryTraceReadout,
  ConsensusMemoryTraceSource,
  ConsensusMemoryTraceStage,
} from '../../nerve/consensusMemoryTrace';
import {
  consensusMemoryRouteHopFocusEqual,
  deriveConsensusMemoryRouteHopFocus,
  deriveConsensusMemoryRouteHopInspection,
  deriveConsensusMemoryRouteHopWindow,
  stepConsensusMemoryRouteHopFocus,
} from '../../nerve/consensusMemoryTrace';
import {
  CONSENSUS_ROUTE_HOP_PULSE_MS,
  consensusMemoryRouteHopPulseKey,
} from '../../nerve/consensusRouteHopPulse';
import { formatBlockRef, formatOutpoint } from './cellFormat';
import { SpatialPlateHeader } from './primitives';
import CellCausalLensReadout, {
  type CellCausalNavigationReadout,
} from './CellCausalLensReadout';
import CellContentMemory from './CellContentMemory';
import type { CellSemanticsPhase } from './CellSemanticsReadout';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from './hudTheme';

const CYAN = HUD_COLORS.cyanWire;
const VIOLET = HUD_COLORS.memory;
const GOLD = HUD_COLORS.orange;
const LOCKED_GOLD = HUD_COLORS.lockedGold;
const ROUTE_LENS_MIN_CELLS = 9;
const ROUTE_SCROLL_EDGE_EPSILON_PX = 1;
const ROUTE_SCROLL_ANCHOR_INSET_PX = 4;
const IDENTITY_PROOF_META: Record<CellIdentityProofKind, {
  code: 'WHERE' | 'WHAT' | 'WHEN';
  color: string;
}> = {
  address: { code: 'WHERE', color: HUD_COLORS.cyanInk },
  content: { code: 'WHAT', color: HUD_COLORS.memoryInk },
  anchor: { code: 'WHEN', color: HUD_COLORS.goldInk },
};

type RouteHopPulseStyle = CSSProperties & {
  '--route-hop-pulse-color': string;
};

function routeHopPulseStyle(
  color: string,
  reducedMotion: boolean,
): CSSProperties {
  if (reducedMotion) return {};
  return {
    '--route-hop-pulse-color': color,
    animation: `cknerv-route-hop-lock-pulse ${CONSENSUS_ROUTE_HOP_PULSE_MS}ms cubic-bezier(.18,.72,.2,1) both`,
  } as RouteHopPulseStyle;
}

function syncRouteLedgerScrollAffordance(node: HTMLDivElement): void {
  const viewport = node.closest<HTMLElement>(
    '[data-memory-evidence-route-scroll-viewport="true"]',
  );
  if (!viewport) return;
  const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  const scrollTop = Math.min(maxScrollTop, Math.max(0, node.scrollTop));
  const scrollable = maxScrollTop > ROUTE_SCROLL_EDGE_EPSILON_PX;
  const hasBefore = scrollable
    && scrollTop > ROUTE_SCROLL_EDGE_EPSILON_PX;
  const hasAfter = scrollable
    && scrollTop < maxScrollTop - ROUTE_SCROLL_EDGE_EPSILON_PX;
  const progress = scrollable ? scrollTop / maxScrollTop : 0;
  viewport.dataset.memoryEvidenceRouteScrollable = String(scrollable);
  viewport.dataset.memoryEvidenceRouteScrollBefore = String(hasBefore);
  viewport.dataset.memoryEvidenceRouteScrollAfter = String(hasAfter);
  viewport.style.setProperty(
    '--route-ledger-scroll-progress',
    `${(progress * 100).toFixed(2)}%`,
  );
}

function alignLockedRouteHopInspector(
  node: HTMLDivElement,
  reducedMotion: boolean,
): boolean {
  const inspector = node.querySelector<HTMLElement>(
    '[data-memory-evidence-route-hop-inspector="true"]',
  );
  const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  if (!inspector || maxScrollTop <= ROUTE_SCROLL_EDGE_EPSILON_PX) return false;
  const anchorTop = inspector.offsetTop;
  const anchorHeight = inspector.offsetHeight;
  const anchorBottom = anchorTop + anchorHeight;
  const centeredInset = Math.max(0, (node.clientHeight - anchorHeight) / 2);
  const visibilityInset = Math.min(
    ROUTE_SCROLL_ANCHOR_INSET_PX,
    centeredInset,
  );
  const visibleTop = node.scrollTop + visibilityInset;
  const visibleBottom = node.scrollTop + node.clientHeight
    - visibilityInset;
  if (anchorTop >= visibleTop && anchorBottom <= visibleBottom) return false;
  const target = Math.min(
    maxScrollTop,
    Math.max(0, anchorTop - centeredInset),
  );
  if (!reducedMotion && typeof node.scrollTo === 'function') {
    node.scrollTo({ top: target, behavior: 'smooth' });
  } else {
    node.scrollTop = target;
  }
  return true;
}

const MEMORY_READ_STAGES: ReadonlyArray<{
  stage: ConsensusMemoryTraceStage;
  code: string;
  label: string;
  color: string;
}> = [
  { stage: 'reading', code: '01', label: 'READING', color: CYAN },
  { stage: 'converging', code: '02', label: 'CONVERGING', color: VIOLET },
  { stage: 'locked', code: '03', label: 'LOCKED', color: LOCKED_GOLD },
];

function fingerprintBody(hash: string): string {
  return hash.replace(/^0x/i, '').toUpperCase();
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function routeDurationReadout(durationMs: number): string {
  const clamped = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return clamped < 1_000
    ? `${Math.round(clamped)} MS`
    : `${(clamped / 1_000).toFixed(2)} S`;
}

function recallActionCopy({
  enabled,
  identityComplete,
  identityPhase,
  traceSelected,
  traceReadout,
  traceSource,
}: {
  enabled: boolean;
  identityComplete: boolean;
  identityPhase: CellIdentityProofBinding['phase'] | null;
  traceSelected: boolean;
  traceReadout: ConsensusMemoryTraceReadout | null;
  traceSource: ConsensusMemoryTraceSource;
}): string {
  if (!enabled) {
    return identityComplete
      ? '↳ TRACE READY AFTER IDENTITY MAP'
      : '↳ VERIFY WHERE / WHAT / WHEN TO RECALL';
  }
  if (traceSelected) {
    if (traceReadout?.stage === 'reading') {
      return '↳ READING RETAINED RECORD · EXIT';
    }
    if (traceReadout?.stage === 'converging') {
      return `↳ CONVERGING ${traceReadout.arrivedSourceCount}/${traceReadout.sourceCount} EVIDENCE · EXIT`;
    }
    if (traceReadout?.stage === 'locked') {
      return '↳ CONSENSUS LOCKED · EXIT';
    }
    return '↳ MEMORY ROUTE PLANNING · EXIT';
  }
  if (identityPhase === 'retained') {
    if (traceSource === 'witness') {
      return '↳ RETAINED MEMORY · REPLAY LINEAGE WITNESS';
    }
    if (traceSource === 'input') {
      return '↳ RETAINED MEMORY · REPLAY CAUSAL PATH';
    }
    return '↳ RETAINED MEMORY · REPLAY TRACE';
  }
  if (traceSource === 'witness') {
    return '↳ IDENTITY BOUND · RECALL LINEAGE WITNESS';
  }
  if (traceSource === 'input') {
    return '↳ IDENTITY BOUND · RECALL CAUSAL PATH';
  }
  return '↳ IDENTITY BOUND · RECALL RETAINED TRACE';
}

function RouteHopInspector({
  readout,
  evidence,
  lockedHop,
  pulseKey,
  routeCellById,
  sourceColor,
  reducedMotion,
}: {
  readout: ConsensusMemoryTraceReadout;
  evidence: ConsensusMemoryTraceEvidence;
  lockedHop: ConsensusMemoryRouteHopFocus;
  pulseKey: string;
  routeCellById?: ReadonlyMap<number, Cell>;
  sourceColor: string;
  reducedMotion: boolean;
}) {
  const inspection = deriveConsensusMemoryRouteHopInspection(
    readout,
    lockedHop,
  );
  if (!inspection) return null;
  const record = routeCellById?.get(inspection.cellId) ?? null;
  const evidenceFallback = inspection.role === 'source';
  const contentHash = record?.content_hash
    ?? (evidenceFallback ? evidence.contentHash : null);
  const anchorBlock = record?.birth_block
    ?? (evidenceFallback ? evidence.sourceBirthBlock : null);
  const recordState = record
    ? record.death_at_ms === null ? 'LIVE' : 'SPENT'
    : evidenceFallback
      ? 'EVIDENCE'
      : 'OUT OF VIEW';
  const recordAvailability = record
    ? 'available'
    : evidenceFallback
      ? 'evidence-only'
      : 'unavailable';
  const roleCopy = inspection.role === 'source'
    ? {
        semantic: 'provenance',
        label: 'EVIDENCE SOURCE',
        note: 'REAL RETAINED EVIDENCE',
        color: sourceColor,
      }
    : inspection.role === 'target'
      ? {
          semantic: 'record',
          label: 'MAINTAINED RECORD',
          note: 'REAL TARGET RECORD',
          color: LOCKED_GOLD,
        }
      : {
          semantic: 'display-carrier',
          label: 'DISPLAY CARRIER',
          note: 'VISUAL LANE · NO CAUSAL CLAIM',
          color: CYAN,
        };
  const fingerprint = contentHash
    ? consensusMemoryEvidenceFingerprint(contentHash)
    : 'UNAVAILABLE';
  const anchor = anchorBlock === null
    ? recordState
    : `BLOCK ${formatBlockRef(anchorBlock)} · ${recordState}`;
  const recordTitle = record
    ? `${record.out_point.tx_hash}#${record.out_point.index}`
    : evidenceFallback
      ? `${evidence.sourceOutPoint.tx_hash}#${evidence.sourceOutPoint.index}`
      : undefined;

  return (
    <div
      role="group"
      aria-label={`Locked hop ${inspection.hopIndex}, ${roleCopy.label.toLowerCase()}, Cell ${inspection.cellId}`}
      data-memory-evidence-route-hop-inspector="true"
      data-memory-evidence-route-hop-role={inspection.role}
      data-memory-evidence-route-hop-semantic={roleCopy.semantic}
      data-memory-evidence-route-hop-record={recordAvailability}
      data-memory-evidence-route-hop-content-hash={contentHash ?? undefined}
      data-memory-evidence-route-hop-distance-source={inspection.distanceFromSource}
      data-memory-evidence-route-hop-distance-target={inspection.distanceToTarget}
      data-memory-evidence-route-pulse-key={pulseKey}
      style={{
        position: 'relative',
        marginTop: 5,
        padding: '5px 6px 4px',
        borderTop: `1px solid ${roleCopy.color}52`,
        borderLeft: `1px solid ${roleCopy.color}78`,
        background: `linear-gradient(105deg, ${roleCopy.color}12, rgba(3,8,20,.72) 58%, ${sourceColor}08)`,
        boxShadow: `inset 5px 0 12px ${roleCopy.color}08`,
        fontFamily: HUD_FONTS.mono,
      }}
    >
      <span
        key={pulseKey}
        aria-hidden="true"
        data-memory-evidence-route-pulse-surface="true"
        style={{
          position: 'absolute',
          inset: -1,
          borderTop: `1px solid ${roleCopy.color}52`,
          borderLeft: `1px solid ${roleCopy.color}78`,
          background: `linear-gradient(105deg, ${roleCopy.color}12, transparent 62%)`,
          boxShadow: `inset 5px 0 12px ${roleCopy.color}0b`,
          pointerEvents: 'none',
          ...routeHopPulseStyle(roleCopy.color, reducedMotion),
        }}
      />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span
          aria-hidden="true"
          style={{
            width: 4,
            height: 4,
            border: `1px solid ${roleCopy.color}`,
            boxShadow: `0 0 7px ${roleCopy.color}88`,
            transform: 'rotate(45deg)',
          }}
        />
        <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, fontWeight: 700, letterSpacing: 0.82, color: roleCopy.color }}>
          HOP SEMANTICS
        </span>
        <span style={{ marginLeft: 'auto', fontSize: HUD_TYPE.micro, letterSpacing: 0.48, color: roleCopy.color }}>
          {roleCopy.label}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '54px minmax(0, 1fr)',
          gap: '2px 6px',
          marginTop: 4,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 0.34,
        }}
      >
        <span style={{ color: HUD_COLORS.dim }}>OWN CONTENT</span>
        <span title={contentHash ?? undefined} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', color: contentHash ? HUD_COLORS.cyanInk : HUD_COLORS.dim }}>
          {fingerprint}
        </span>
        <span style={{ color: HUD_COLORS.dim }}>CHAIN ANCHOR</span>
        <span title={recordTitle} style={{ textAlign: 'right', color: record ? HUD_COLORS.ink : HUD_COLORS.dim }}>
          {anchor}
        </span>
      </div>
      <div
        data-memory-evidence-route-hop-binding="true"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
          alignItems: 'baseline',
          gap: 5,
          marginTop: 4,
          paddingTop: 3,
          borderTop: `1px solid ${roleCopy.color}22`,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 0.28,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: HUD_COLORS.dim }}>
          {inspection.previousCellId === null
            ? '◆ SOURCE'
            : `← #${inspection.previousCellId}`}
        </span>
        <span style={{ color: roleCopy.color }}>
          H{String(inspection.hopIndex).padStart(2, '0')} · #{inspection.cellId}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', color: HUD_COLORS.dim }}>
          {inspection.nextCellId === null
            ? 'TARGET ◆'
            : `#${inspection.nextCellId} →`}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3, fontSize: HUD_TYPE.micro, letterSpacing: 0.32 }}>
        <span style={{ color: roleCopy.color }}>{roleCopy.note}</span>
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim }}>
          {inspection.distanceFromSource} FROM SOURCE · {inspection.distanceToTarget} TO TARGET
        </span>
      </div>
    </div>
  );
}

function EvidenceRouteLedger({
  evidence,
  sourceColor,
  id,
  readout,
  focusedHop,
  onHopFocusChange,
  lockedHop,
  onHopLockChange,
  routeCellById,
  reducedMotion,
}: {
  evidence: ConsensusMemoryTraceEvidence;
  sourceColor: string;
  id: string;
  readout: ConsensusMemoryTraceReadout;
  focusedHop: ConsensusMemoryRouteHopFocus | null;
  onHopFocusChange?: (focus: ConsensusMemoryRouteHopFocus | null) => void;
  lockedHop: ConsensusMemoryRouteHopFocus | null;
  onHopLockChange?: (focus: ConsensusMemoryRouteHopFocus | null) => void;
  routeCellById?: ReadonlyMap<number, Cell>;
  reducedMotion: boolean;
}) {
  const routeScrollRef = useRef<HTMLDivElement>(null);
  const lastIndex = evidence.route.length - 1;
  const focusedRouteHop = focusedHop?.traceKey === readout.key
    && focusedHop.sourceId === evidence.sourceId
    && focusedHop.targetCellId === evidence.route.at(-1)
    && evidence.route[focusedHop.hopIndex] === focusedHop.cellId
    ? focusedHop
    : null;
  const lockedRouteHop = lockedHop?.traceKey === readout.key
    && lockedHop.sourceId === evidence.sourceId
    && lockedHop.targetCellId === evidence.route.at(-1)
    && evidence.route[lockedHop.hopIndex] === lockedHop.cellId
    ? lockedHop
    : null;
  const focusIsLocked = consensusMemoryRouteHopFocusEqual(
    focusedRouteHop,
    lockedRouteHop,
  );
  const routeLens = lockedRouteHop
    && evidence.route.length >= ROUTE_LENS_MIN_CELLS
    ? deriveConsensusMemoryRouteHopWindow(
      evidence.route.length,
      lockedRouteHop.hopIndex,
    )
    : null;
  const visibleHopIndices = routeLens?.indices
    ?? evidence.route.map((_, index) => index);
  const lockedProgress = lockedRouteHop && lastIndex > 0
    ? lockedRouteHop.hopIndex / lastIndex
    : 0;
  const lockedPulseKey = consensusMemoryRouteHopPulseKey(lockedRouteHop);
  useEffect(() => {
    const node = routeScrollRef.current;
    if (!node) return undefined;
    const sync = () => syncRouteLedgerScrollAffordance(node);
    const align = () => {
      alignLockedRouteHopInspector(node, reducedMotion);
      sync();
    };
    align();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(sync);
    resizeObserver?.observe(node);
    window.addEventListener('resize', align);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', align);
    };
  }, [evidence.route.length, lockedRouteHop?.hopIndex, reducedMotion]);
  return (
    <div
      id={id}
      className={`cknerv-memory-route-ledger${routeLens ? ' cknerv-memory-route-ledger-lens' : ''}`}
      data-hud-occlusion="true"
      data-memory-evidence-route-ledger="true"
      data-memory-evidence-route-cell-count={evidence.route.length}
      style={{
        zIndex: 4,
        gridColumn: '1 / -1',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '6px 7px 7px',
        borderTop: `1px solid ${sourceColor}7a`,
        borderBottom: `1px solid ${CYAN}30`,
        borderLeft: `1px solid ${sourceColor}4f`,
        background: 'linear-gradient(110deg, rgba(1,4,12,.97), rgba(3,8,20,.94))',
        boxShadow: `-8px 0 24px rgba(0,0,0,.3), inset 8px 0 18px ${sourceColor}0b`,
        color: HUD_COLORS.dim,
        whiteSpace: 'normal',
        textAlign: 'left',
      }}
    >
      <span
        aria-hidden="true"
        className="cknerv-memory-route-connector"
        style={{
          position: 'absolute',
          right: -30,
          top: 9,
          width: 30,
          borderTop: `1px solid ${sourceColor}66`,
        }}
      />
      <span
        aria-hidden="true"
        className="cknerv-memory-route-connector-tail"
        style={{
          position: 'absolute',
          right: -30,
          top: 9,
          borderRight: `1px solid ${sourceColor}42`,
        }}
      />
      <span style={{ display: 'flex', flex: '0 0 auto', alignItems: 'baseline', gap: 7, marginBottom: 5 }}>
        <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, fontWeight: 700, letterSpacing: 0.9, color: sourceColor }}>
          ROUTE LEDGER
        </span>
        <span
          title={focusedRouteHop
            ? `Hop ${focusedRouteHop.hopIndex}: Cell #${focusedRouteHop.cellId}`
            : undefined}
          style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.35, color: focusedRouteHop ? HUD_COLORS.ink : HUD_COLORS.cyanInk }}
        >
          {focusedRouteHop
            ? `${focusIsLocked ? 'LOCK ' : ''}H${String(focusedRouteHop.hopIndex).padStart(2, '0')} · CELL #${focusedRouteHop.cellId}`
            : `${String(evidence.route.length).padStart(2, '0')} CELLS · H${String(evidence.hopCount).padStart(2, '0')}`}
        </span>
      </span>
      <div
        className="cknerv-memory-route-ledger-viewport"
        data-memory-evidence-route-scroll-viewport="true"
        data-memory-evidence-route-scrollable="false"
        data-memory-evidence-route-scroll-before="false"
        data-memory-evidence-route-scroll-after="false"
      >
        <div
          ref={routeScrollRef}
          className="cknerv-memory-route-ledger-scroll"
          data-memory-evidence-route-scroll="true"
          onScroll={(event) => {
            syncRouteLedgerScrollAffordance(event.currentTarget);
          }}
        >
        {routeLens && lockedRouteHop ? (
        <span
          role="progressbar"
          aria-label={`Locked route position, hop ${lockedRouteHop.hopIndex} of ${lastIndex}`}
          aria-valuemin={0}
          aria-valuemax={lastIndex}
          aria-valuenow={lockedRouteHop.hopIndex}
          data-memory-evidence-route-progress="true"
          data-memory-evidence-route-progress-hop={lockedRouteHop.hopIndex}
          data-memory-evidence-route-progress-max={lastIndex}
          data-memory-evidence-route-progress-value={lockedProgress.toFixed(4)}
          style={{
            display: 'block',
            margin: '0 0 6px',
            padding: '4px 5px 5px',
            border: `1px solid ${sourceColor}2e`,
            background: `linear-gradient(90deg, ${sourceColor}0d, ${LOCKED_GOLD}0a)`,
            fontFamily: HUD_FONTS.mono,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              fontSize: HUD_TYPE.micro,
              letterSpacing: 0.42,
              color: HUD_COLORS.dim,
            }}
          >
            <span>SOURCE</span>
            <span style={{ marginLeft: 'auto', color: LOCKED_GOLD }}>
              H{String(lockedRouteHop.hopIndex).padStart(2, '0')} / H{String(lastIndex).padStart(2, '0')}
            </span>
            <span style={{ marginLeft: 'auto' }}>TARGET</span>
          </span>
          <span
            aria-hidden="true"
            style={{
              position: 'relative',
              display: 'block',
              height: 5,
              marginTop: 3,
              borderTop: `1px solid ${CYAN}2b`,
              borderBottom: `1px solid ${CYAN}1a`,
              background: `linear-gradient(90deg, ${sourceColor}38 0 ${lockedProgress * 100}%, ${CYAN}10 ${lockedProgress * 100}% 100%)`,
            }}
          >
            <span
              data-memory-evidence-route-progress-marker="true"
              style={{
                position: 'absolute',
                left: `${lockedProgress * 100}%`,
                top: '50%',
                width: 5,
                height: 5,
                border: `1px solid ${LOCKED_GOLD}`,
                background: '#07101B',
                boxShadow: `0 0 8px ${LOCKED_GOLD}aa`,
                transform: 'translate(-50%, -50%) rotate(45deg)',
                transition: reducedMotion ? undefined : 'left 180ms ease-out',
              }}
            />
          </span>
        </span>
        ) : null}
        <span
          className="cknerv-memory-route-cells"
          data-memory-evidence-route-cells="true"
          data-memory-evidence-route-mode={routeLens ? 'lens' : 'full'}
          data-memory-evidence-route-window-start={routeLens?.startIndex}
          data-memory-evidence-route-window-end={routeLens?.endIndex}
          data-memory-evidence-route-hidden-before={routeLens?.hiddenBefore}
          data-memory-evidence-route-hidden-after={routeLens?.hiddenAfter}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            alignItems: 'center',
            gap: '3px 4px',
            maxHeight: routeLens ? 'none' : 48,
            overflowX: 'hidden',
            overflowY: routeLens ? 'visible' : 'auto',
            padding: routeLens ? '4px 3px 3px' : '0 2px 0 0',
            border: routeLens ? `1px solid ${LOCKED_GOLD}20` : undefined,
            background: routeLens
              ? `linear-gradient(90deg, ${sourceColor}0d, ${LOCKED_GOLD}0b, ${sourceColor}0d)`
              : undefined,
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.micro,
            lineHeight: 1.15,
            scrollbarWidth: 'thin',
            scrollbarColor: `${sourceColor}55 transparent`,
          }}
        >
        {routeLens ? (
          <span
            data-memory-evidence-route-window-context="true"
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'baseline',
              marginBottom: 2,
              fontSize: HUD_TYPE.micro,
              letterSpacing: 0.38,
              color: HUD_COLORS.dim,
            }}
          >
            <span>
              {routeLens.hiddenBefore > 0
                ? `← SOURCE · ${routeLens.hiddenBefore} PRIOR`
                : '◆ SOURCE IN VIEW'}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              {routeLens.hiddenAfter > 0
                ? `${routeLens.hiddenAfter} NEXT · TARGET →`
                : 'TARGET IN VIEW ◆'}
            </span>
          </span>
        ) : null}
        {visibleHopIndices.map((index) => {
          const cellId = evidence.route[index];
          const role = index === 0
            ? 'source'
            : index === lastIndex
              ? 'target'
              : 'transit';
          const nodeColor = role === 'source'
            ? sourceColor
            : role === 'target'
              ? HUD_COLORS.cyanInk
              : HUD_COLORS.dim;
          const indexCopy = role === 'source'
            ? 'S'
            : role === 'target'
              ? 'T'
              : String(index).padStart(2, '0');
          const hopFocus = deriveConsensusMemoryRouteHopFocus(
            readout,
            evidence.sourceId,
            index,
          );
          const active = focusedRouteHop?.hopIndex === index;
          const locked = lockedRouteHop?.hopIndex === index;
          const focusState = locked ? 'locked' : active ? 'preview' : 'idle';
          return (
            <span
              key={`${cellId}:${index}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
            >
              {index > 0 ? (
                <span aria-hidden="true" style={{ color: sourceColor, opacity: 0.46 }}>
                  →
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`${onHopLockChange ? (locked ? 'Release' : 'Lock') : 'Focus'} route hop ${index} of ${lastIndex}, ${role} Cell ${cellId}`}
                aria-pressed={onHopLockChange ? locked : active}
                data-memory-evidence-route-cell={cellId}
                data-memory-evidence-route-hop={index}
                data-memory-evidence-route-role={role}
                data-memory-evidence-route-focus={focusState}
                data-memory-evidence-route-lock={locked ? 'locked' : 'unlocked'}
                data-memory-evidence-route-pulse-key={
                  locked ? lockedPulseKey ?? undefined : undefined
                }
                title={`Hop ${index}: Cell #${cellId} (${role}) · click to ${onHopLockChange ? (locked ? 'release' : 'lock') : 'focus'}`}
                disabled={
                  !hopFocus
                  || (!onHopFocusChange && !onHopLockChange)
                }
                onPointerEnter={() => onHopFocusChange?.(hopFocus)}
                onPointerLeave={(event) => {
                  if (
                    typeof document !== 'undefined'
                    && document.activeElement === event.currentTarget
                  ) return;
                  onHopFocusChange?.(null);
                }}
                onFocus={() => onHopFocusChange?.(hopFocus)}
                onBlur={() => onHopFocusChange?.(null)}
                onClick={() => {
                  if (onHopLockChange) {
                    onHopLockChange(locked ? null : hopFocus);
                    if (locked) onHopFocusChange?.(null);
                  } else {
                    onHopFocusChange?.(hopFocus);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && lockedRouteHop) {
                    event.preventDefault();
                    event.stopPropagation();
                    onHopLockChange?.(null);
                    onHopFocusChange?.(null);
                    return;
                  }
                  const direction = event.key === 'ArrowLeft'
                    ? -1
                    : event.key === 'ArrowRight'
                      ? 1
                      : 0;
                  if (direction === 0 || !hopFocus) return;
                  const next = stepConsensusMemoryRouteHopFocus(
                    readout,
                    hopFocus,
                    direction,
                  );
                  if (!next) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onHopLockChange?.(next);
                  onHopFocusChange?.(next);
                  event.currentTarget.closest(
                    '[data-memory-evidence-route-ledger="true"]',
                  )?.querySelector<HTMLElement>(
                    `[data-memory-evidence-route-hop="${next.hopIndex}"]`,
                  )?.focus();
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 2,
                  margin: 0,
                  padding: '1px 2px',
                  border: 0,
                  borderBottom: `1px solid ${locked || active ? sourceColor : `${nodeColor}66`}`,
                  outline: locked
                    ? `1px solid ${LOCKED_GOLD}`
                    : active
                      ? `1px solid ${sourceColor}88`
                      : 'none',
                  outlineOffset: 1,
                  background: locked
                    ? `linear-gradient(90deg, ${sourceColor}38, ${LOCKED_GOLD}18)`
                    : active
                      ? `${sourceColor}24`
                      : `${nodeColor}0b`,
                  boxShadow: locked
                    ? `0 0 10px ${sourceColor}72, inset 0 0 5px ${LOCKED_GOLD}24`
                    : active
                      ? `0 0 8px ${sourceColor}55`
                      : undefined,
                  font: 'inherit',
                  lineHeight: 'inherit',
                  color: locked ? LOCKED_GOLD : active ? HUD_COLORS.ink : nodeColor,
                  cursor: onHopFocusChange || onHopLockChange
                    ? 'crosshair'
                    : 'default',
                  transition: reducedMotion
                    ? undefined
                    : 'color 120ms ease, background 120ms ease, box-shadow 120ms ease',
                  ...(locked
                    ? routeHopPulseStyle(LOCKED_GOLD, reducedMotion)
                    : {}),
                }}
              >
                <span style={{ opacity: 0.64 }}>{indexCopy}</span>
                <span>#{cellId}</span>
              </button>
            </span>
          );
        })}
        </span>
        {lockedRouteHop && lockedPulseKey ? (
          <RouteHopInspector
            readout={readout}
            evidence={evidence}
            lockedHop={lockedRouteHop}
            pulseKey={lockedPulseKey}
            routeCellById={routeCellById}
            sourceColor={sourceColor}
            reducedMotion={reducedMotion}
          />
        ) : null}
        {lockedRouteHop ? (
          <span
            data-memory-evidence-route-lock-status="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 5,
              paddingTop: 4,
              borderTop: `1px solid ${LOCKED_GOLD}28`,
              fontFamily: HUD_FONTS.mono,
              fontSize: HUD_TYPE.micro,
              letterSpacing: 0.42,
              color: LOCKED_GOLD,
            }}
          >
            <span>◆ ROUTE LOCK</span>
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim }}>
              ←/→ STEP · ESC RELEASE
            </span>
          </span>
        ) : null}
        </div>
        <span
          aria-hidden="true"
          className="cknerv-memory-route-scroll-edge cknerv-memory-route-scroll-edge-before"
          style={{ transition: reducedMotion ? undefined : 'opacity 140ms ease' }}
        />
        <span
          aria-hidden="true"
          className="cknerv-memory-route-scroll-edge cknerv-memory-route-scroll-edge-after"
          style={{ transition: reducedMotion ? undefined : 'opacity 140ms ease' }}
        />
        <span
          aria-hidden="true"
          className="cknerv-memory-route-scroll-position"
          data-memory-evidence-route-scroll-position="true"
        >
          <span className="cknerv-memory-route-scroll-position-marker" />
        </span>
      </div>
    </div>
  );
}

function IdentityBraid({
  identity,
  reducedMotion,
  traceSelected,
  identityProofBinding,
  compact = false,
}: {
  identity: CellConsensusIdentity;
  reducedMotion: boolean;
  traceSelected: boolean;
  identityProofBinding: CellIdentityProofBinding | null;
  compact?: boolean;
}) {
  const nibbles = fingerprintBody(identity.contentHash)
    .slice(0, 12)
    .split('')
    .map((hex) => Number.parseInt(hex, 16) || 0);
  const observed = identity.observedWrite !== null;
  const proofComplete = cellIdentityProofBindingComplete(identityProofBinding);
  const knotColor = traceSelected
    ? VIOLET
    : identityProofBinding?.phase === 'retained'
      ? GOLD
      : proofComplete
        ? HUD_COLORS.cyanInk
        : observed
          ? GOLD
          : CYAN;
  const proofNodes = [
    { kind: 'address', cx: 108, cy: 12 },
    { kind: 'content', cx: 130, cy: 12 },
    { kind: 'anchor', cx: 119, cy: 31 },
  ] as const;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 238 42"
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: compact ? 32 : 42, overflow: 'visible' }}
    >
      {/* Content-derived register marks: identity, not an activity meter. */}
      {nibbles.map((value, index) => {
        const x = 14 + index * 19;
        const height = 3 + (value / 15) * 8;
        return (
          <line
            key={index}
            x1={x}
            x2={x}
            y1={21 - height / 2}
            y2={21 + height / 2}
            stroke={index % 3 === 0 ? VIOLET : CYAN}
            strokeOpacity={0.12 + (value / 15) * 0.2}
            strokeWidth="1"
          />
        );
      })}

      {/* A's canonical grammar in miniature: independent cool paths agree at
          one content knot, then remain addressable as a persistent record. */}
      <path d="M4 7 C54 7 78 21 119 21 S184 35 234 35" fill="none" stroke={CYAN} strokeOpacity=".5" strokeWidth="1" />
      <path d="M4 21 C58 21 84 21 119 21 S180 21 234 21" fill="none" stroke={HUD_COLORS.cyanInk} strokeOpacity=".34" strokeWidth=".8" />
      <path d="M4 35 C54 35 78 21 119 21 S184 7 234 7" fill="none" stroke={VIOLET} strokeOpacity=".48" strokeWidth="1" />
      <path d="M4 7 C54 7 78 21 119 21" fill="none" stroke={CYAN} strokeOpacity=".1" strokeWidth="5" />
      <path d="M4 35 C54 35 78 21 119 21" fill="none" stroke={VIOLET} strokeOpacity=".1" strokeWidth="5" />

      {[7, 21, 35].map((y, index) => (
        <circle key={`in-${y}`} cx="4" cy={y} r="1.6" fill={index === 2 ? VIOLET : CYAN} opacity=".7" />
      ))}
      {[7, 21, 35].map((y, index) => (
        <circle key={`out-${y}`} cx="234" cy={y} r="1.35" fill={index === 0 ? VIOLET : CYAN} opacity=".45" />
      ))}
      <circle cx="119" cy="21" r="7" fill={knotColor} opacity={observed ? '.08' : '.045'} />
      <circle
        cx="119"
        cy="21"
        r="2.4"
        fill={knotColor}
        opacity=".9"
        style={{ animation: reducedMotion ? undefined : 'cknerv-hud-breathe 1.8s ease-in-out infinite' }}
      />
      <path d="M119 15 L125 21 L119 27 L113 21 Z" fill="none" stroke={knotColor} strokeOpacity=".72" strokeWidth=".7" />
      {proofNodes.map(({ kind, cx, cy }) => {
        const proof = IDENTITY_PROOF_META[kind];
        const resolved = identityProofBinding?.resolvedKinds.includes(kind)
          ?? false;
        return (
          <circle
            key={kind}
            data-memory-identity-proof-node={kind}
            data-memory-identity-proof-node-state={
              resolved ? 'resolved' : 'pending'
            }
            cx={cx}
            cy={cy}
            r={resolved ? 1.65 : 1.15}
            fill={resolved ? proof.color : 'transparent'}
            stroke={proof.color}
            strokeOpacity={resolved ? 0.9 : 0.18}
            strokeWidth=".7"
          />
        );
      })}
    </svg>
  );
}

function EvidenceLedger({
  readout,
  targetContentHash,
  agreementCount,
  reducedMotion,
  focusedSourceId,
  previewSourceId,
  onFocusChange,
  focusedHop,
  onHopFocusChange,
  lockedHop,
  onHopLockChange,
  routeCellById,
}: {
  readout: ConsensusMemoryTraceReadout;
  targetContentHash: string;
  agreementCount: number;
  reducedMotion: boolean;
  focusedSourceId: number | null;
  previewSourceId: number | null;
  onFocusChange?: (sourceId: number | null) => void;
  focusedHop: ConsensusMemoryRouteHopFocus | null;
  onHopFocusChange?: (focus: ConsensusMemoryRouteHopFocus | null) => void;
  lockedHop: ConsensusMemoryRouteHopFocus | null;
  onHopLockChange?: (focus: ConsensusMemoryRouteHopFocus | null) => void;
  routeCellById?: ReadonlyMap<number, Cell>;
}) {
  const [expandedEvidenceKey, setExpandedEvidenceKey] = useState<string | null>(null);
  const lockedEvidenceKey = lockedHop?.traceKey === readout.key
    && readout.evidence.some(
      (evidence) => evidence.sourceId === lockedHop.sourceId,
    )
    ? `${readout.key}:${lockedHop.sourceId}`
    : null;
  useEffect(() => {
    if (lockedEvidenceKey !== null) setExpandedEvidenceKey(lockedEvidenceKey);
  }, [lockedEvidenceKey]);
  const bindings = consensusMemoryEvidenceBindings(
    targetContentHash,
    readout.evidence,
    agreementCount,
  );
  const evidenceLabel = readout.sourceKind === 'input'
    ? 'RETAINED INPUTS'
    : 'LINEAGE WITNESSES';
  // The ledger below can only list cells a route departs from. What the
  // transaction actually SPENT is answered by the link's own anchors, and for
  // all but the freshest records none of it is still routable — so without
  // this line a witness-carried recall names its carriers and never once names
  // the inputs, even though the record knows them exactly.
  const ledgerSourceIds = new Set(
    readout.evidence.map((evidence) => evidence.sourceId),
  );
  const unroutedInputs = readout.consumedInputs.filter(
    (input) => !ledgerSourceIds.has(input.id),
  );
  const scenePreviewSourceId = previewSourceId !== null
    && readout.evidence.some((evidence) => evidence.sourceId === previewSourceId)
    ? previewSourceId
    : null;

  return (
    <div
      data-memory-evidence-ledger="true"
      style={{ marginTop: 5, paddingTop: 4, borderTop: `1px solid ${CYAN}18` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 0.85, color: HUD_COLORS.dim }}>
          {evidenceLabel}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.45, color: CYAN, opacity: 0.68 }}>
          EVIDENCE → AGREEMENT
        </span>
      </div>
      {unroutedInputs.length > 0 ? (
        <div
          data-memory-consumed-inputs="true"
          data-memory-consumed-input-count={unroutedInputs.length}
          title={unroutedInputs.map((input) => input.contentHash).join('\n')}
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'baseline',
            marginBottom: 3,
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 0.4,
          }}
        >
          <span style={{ fontFamily: HUD_FONTS.tech, letterSpacing: 0.85, color: HUD_COLORS.dim, whiteSpace: 'nowrap' }}>
            SPENT INPUTS
          </span>
          <span
            style={{
              marginLeft: 'auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'right',
              color: HUD_COLORS.dim,
              opacity: 0.86,
            }}
          >
            {unroutedInputs
              .map((input) => consensusMemoryEvidenceFingerprint(input.contentHash))
              .join(' · ')}
          </span>
        </div>
      ) : null}
      {bindings.map((binding) => {
        const evidence = readout.evidence[binding.evidenceIndex];
        const sourceColor = consensusMemoryEvidenceCssColor(binding.evidenceIndex);
        const sourceOutpoint = formatOutpoint(
          evidence.sourceOutPoint.tx_hash,
          evidence.sourceOutPoint.index,
        );
        const routeTargetId = evidence.route.at(-1) ?? readout.targetCellId;
        const routeDuration = routeDurationReadout(evidence.routeDurationMs);
        const resolved = evidence.state === 'resolved';
        const evidenceStateCopy = resolved
          ? 'VERIFIED'
          : evidence.state === 'arrived'
            ? 'ARRIVED'
            : 'ROUTING';
        const evidenceStateColor = resolved
          ? LOCKED_GOLD
          : evidence.state === 'arrived'
            ? HUD_COLORS.cyanInk
            : sourceColor;
        const active = focusedSourceId === evidence.sourceId;
        const previewed = scenePreviewSourceId === evidence.sourceId
          && !active;
        const retained = active
          && scenePreviewSourceId !== null
          && scenePreviewSourceId !== evidence.sourceId;
        const focusState = previewed
          ? 'preview'
          : retained
            ? 'retained'
            : active
              ? 'active'
              : focusedSourceId !== null || scenePreviewSourceId !== null
                ? 'passive'
                : 'idle';
        const stateCopy = previewed ? 'INSPECT' : evidenceStateCopy;
        const stateColor = previewed ? sourceColor : evidenceStateColor;
        const evidenceKey = `${readout.key}:${evidence.sourceId}`;
        const expanded = active
          && (lockedEvidenceKey ?? expandedEvidenceKey) === evidenceKey;
        const routeLedgerId = `memory-route-ledger-${evidence.sourceId}-${evidence.ordinal}`;
        const lockedForEvidence = lockedHop?.traceKey === readout.key
          && lockedHop.sourceId === evidence.sourceId
          && lockedHop.targetCellId === routeTargetId;
        const lockedElsewhere = lockedHop?.traceKey === readout.key
          && lockedHop.sourceId !== evidence.sourceId;
        const activate = () => {
          if (lockedElsewhere) return;
          setExpandedEvidenceKey((current) => (
            current !== null && current !== evidenceKey ? null : current
          ));
          onFocusChange?.(evidence.sourceId);
        };
        return (
          <div
            key={evidence.sourceId}
            data-memory-evidence-wrapper={evidence.ordinal}
            onPointerLeave={(event) => {
              if (typeof document === 'undefined') {
                onFocusChange?.(null);
                onHopFocusChange?.(null);
                return;
              }
              if (event.currentTarget.contains(document.activeElement)) return;
              const keyboardSourceId = Number(
                (document.activeElement as HTMLElement | null)
                  ?.dataset.memoryEvidenceSource,
              );
              onFocusChange?.(
                Number.isFinite(keyboardSourceId) ? keyboardSourceId : null,
              );
              onHopFocusChange?.(null);
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && event.currentTarget.contains(next)) return;
              if (!lockedForEvidence) {
                setExpandedEvidenceKey((current) => (
                  current === evidenceKey ? null : current
                ));
              }
              onFocusChange?.(null);
              onHopFocusChange?.(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !expanded) return;
              event.stopPropagation();
              setExpandedEvidenceKey(null);
              onHopFocusChange?.(null);
              if (lockedForEvidence) onHopLockChange?.(null);
              event.currentTarget.querySelector<HTMLElement>(
                '[data-memory-evidence]',
              )?.focus();
            }}
            style={{
              position: 'relative',
              width: '100%',
              opacity: focusState === 'passive'
                ? 0.34
                : retained
                  ? 0.62
                  : 1,
              transition: reducedMotion ? undefined : 'opacity 140ms ease',
            }}
          >
            <button
              type="button"
              aria-label={`Focus evidence ${String(evidence.ordinal).padStart(2, '0')}, source Cell ${evidence.sourceId}, ${evidence.hopCount} hops in ${routeDuration}, source ${evidence.sourceOutPoint.tx_hash}#${evidence.sourceOutPoint.index}, agreement knot ${String(binding.knotIndex + 1).padStart(2, '0')}; ${expanded ? 'collapse' : 'expand'} complete route`}
              aria-pressed={active}
              aria-expanded={expanded}
              aria-controls={routeLedgerId}
              data-memory-evidence={evidence.ordinal}
              data-memory-evidence-source={evidence.sourceId}
              data-memory-evidence-knot={binding.knotIndex + 1}
              data-memory-evidence-state={evidence.state}
              data-memory-evidence-focus={focusState}
              data-memory-evidence-scene-preview={previewed ? 'true' : undefined}
              data-memory-evidence-route={evidence.route.join('>')}
              data-memory-evidence-route-hops={evidence.hopCount}
              data-memory-evidence-route-duration-ms={evidence.routeDurationMs}
              data-memory-evidence-source-outpoint={`${evidence.sourceOutPoint.tx_hash}#${evidence.sourceOutPoint.index}`}
              title={`${evidence.contentHash} · ${evidence.sourceOutPoint.tx_hash}#${evidence.sourceOutPoint.index}`}
              disabled={!onFocusChange || lockedElsewhere}
              onPointerEnter={activate}
              onFocus={activate}
              onClick={() => {
                if (expanded) {
                  onHopFocusChange?.(null);
                  if (lockedForEvidence) onHopLockChange?.(null);
                }
                setExpandedEvidenceKey((current) => (
                  current === evidenceKey ? null : evidenceKey
                ));
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '25px minmax(0, 1fr) auto',
                alignItems: 'baseline',
                width: '100%',
                minHeight: 13,
                margin: 0,
                padding: '0 0 0 4px',
                border: 0,
                borderLeft: previewed
                  ? `2px solid ${sourceColor}`
                  : `1px solid ${active ? sourceColor : `${sourceColor}88`}`,
                borderRadius: 0,
                outline: previewed
                  ? `1px solid ${sourceColor}70`
                  : active
                    ? `1px solid ${sourceColor}${retained ? '26' : '44'}`
                    : 'none',
                outlineOffset: -1,
                background: previewed
                  ? `linear-gradient(90deg, ${sourceColor}30, ${sourceColor}10 72%, transparent)`
                  : active
                    ? `linear-gradient(90deg, ${sourceColor}${retained ? '12' : '22'}, ${sourceColor}08 68%, transparent)`
                    : 'transparent',
                boxShadow: previewed
                  ? `inset 3px 0 0 ${sourceColor}, 0 0 11px ${sourceColor}2c`
                  : active
                    ? `inset 2px 0 0 ${sourceColor}, 0 0 9px ${sourceColor}${retained ? '10' : '1c'}`
                    : undefined,
                fontFamily: HUD_FONTS.mono,
                whiteSpace: 'nowrap',
                textAlign: 'left',
                cursor: onFocusChange && !lockedElsewhere ? 'pointer' : 'default',
                transition: reducedMotion ? undefined : 'background 140ms ease, box-shadow 140ms ease',
              }}
            >
              <span style={{ fontSize: HUD_TYPE.micro, color: sourceColor }}>
                E{String(evidence.ordinal).padStart(2, '0')}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: HUD_TYPE.micro, letterSpacing: 0.22, color: HUD_COLORS.ink }}>
                {consensusMemoryEvidenceFingerprint(evidence.contentHash)}
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: HUD_TYPE.micro, letterSpacing: 0.35 }}>
                <span style={{ color: sourceColor }}>
                  ◇K{String(binding.knotIndex + 1).padStart(2, '0')}
                </span>
                <span style={{ color: stateColor }}>
                  {stateCopy}
                </span>
              </span>
              {active ? (
                <span
                  data-memory-evidence-route-proof="true"
                  style={{
                    gridColumn: '1 / -1',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: '1px 7px',
                    minWidth: 0,
                    margin: '2px 4px 2px 0',
                    paddingTop: 3,
                    borderTop: `1px solid ${sourceColor}2e`,
                    fontSize: HUD_TYPE.micro,
                    letterSpacing: 0.3,
                    color: HUD_COLORS.dim,
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: sourceColor }}>
                    CELL #{evidence.sourceId} → #{routeTargetId}
                  </span>
                  <span>
                    {String(evidence.hopCount).padStart(2, '0')} HOPS · {routeDuration} · ROUTE {expanded ? '−' : '+'}
                  </span>
                  <span
                    title={`${evidence.sourceOutPoint.tx_hash}#${evidence.sourceOutPoint.index}`}
                    style={{
                      gridColumn: '1 / -1',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    SOURCE {sourceOutpoint} · BLOCK #{evidence.sourceBirthBlock}
                  </span>
                </span>
              ) : null}
            </button>
            {expanded ? (
              <EvidenceRouteLedger
                id={routeLedgerId}
                evidence={evidence}
                sourceColor={sourceColor}
                readout={readout}
                focusedHop={focusedHop}
                onHopFocusChange={onHopFocusChange}
                lockedHop={lockedHop}
                onHopLockChange={onHopLockChange}
                routeCellById={routeCellById}
                reducedMotion={reducedMotion}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ConsensusMemoryTracePlate({
  readout,
  reducedMotion,
  targetContentHash,
  agreementCount,
  focusedSourceId,
  previewSourceId,
  onFocusChange,
  focusedHop,
  onHopFocusChange,
  lockedHop,
  onHopLockChange,
  routeCellById,
}: {
  readout: ConsensusMemoryTraceReadout;
  reducedMotion: boolean;
  targetContentHash: string;
  agreementCount: number;
  focusedSourceId: number | null;
  previewSourceId: number | null;
  onFocusChange?: (sourceId: number | null) => void;
  focusedHop: ConsensusMemoryRouteHopFocus | null;
  onHopFocusChange?: (focus: ConsensusMemoryRouteHopFocus | null) => void;
  lockedHop: ConsensusMemoryRouteHopFocus | null;
  onHopLockChange?: (focus: ConsensusMemoryRouteHopFocus | null) => void;
  routeCellById?: ReadonlyMap<number, Cell>;
}) {
  const activeIndex = MEMORY_READ_STAGES.findIndex(
    ({ stage }) => stage === readout.stage,
  );
  const summary = readout.stage === 'reading'
    ? ['SCANNING RETAINED RECORD', `EVIDENCE 0/${readout.sourceCount}`]
    : readout.stage === 'converging'
      ? [
        'RECONCILING EVIDENCE',
        `ARRIVED ${readout.arrivedSourceCount}/${readout.sourceCount}`,
      ]
      : [
        'CONSENSUS RECORD RESOLVED',
        `VERIFIED ${readout.resolvedSourceCount}/${readout.sourceCount}`,
      ];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${readout.stage}; ${summary[1]}`}
      data-memory-read-state={readout.stage}
      data-memory-arrived={readout.arrivedSourceCount}
      data-memory-resolved={readout.resolvedSourceCount}
      style={{
        marginTop: 5,
        padding: '6px 0 5px',
        borderTop: `1px solid ${CYAN}22`,
        borderBottom: `1px solid ${LOCKED_GOLD}16`,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {MEMORY_READ_STAGES.map((item, index) => {
          const state = index < activeIndex
            ? 'past'
            : index === activeIndex
              ? 'active'
              : 'future';
          const on = state !== 'future';
          const active = state === 'active';
          return (
            <div
              key={item.stage}
              data-memory-stage={item.stage}
              data-memory-stage-state={state}
              style={{ minWidth: 0, color: item.color, opacity: active ? 1 : on ? 0.55 : 0.2 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', height: 7 }}>
                <span style={{
                  flex: '0 0 auto',
                  width: active ? 5 : 3,
                  height: active ? 5 : 3,
                  border: `1px solid ${item.color}`,
                  background: on ? item.color : 'transparent',
                  boxShadow: active ? `0 0 7px ${item.color}` : undefined,
                  transform: 'rotate(45deg)',
                  transition: reducedMotion ? undefined : 'all 180ms ease',
                }} />
                {index < MEMORY_READ_STAGES.length - 1 ? (
                  <span style={{ flex: 1, height: 1, marginLeft: 4, background: item.color, opacity: on ? 0.45 : 0.16 }} />
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, opacity: 0.58 }}>
                  {item.code}
                </span>
                <span style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, fontWeight: active ? 700 : 500, letterSpacing: active ? 0.78 : 0.48 }}>
                  {item.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 5, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.45 }}>
        <span style={{ color: MEMORY_READ_STAGES[activeIndex]?.color ?? CYAN }}>
          {summary[0]}
        </span>
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.ink }}>
          {summary[1]}
        </span>
      </div>
      <EvidenceLedger
        readout={readout}
        targetContentHash={targetContentHash}
        agreementCount={agreementCount}
        reducedMotion={reducedMotion}
        focusedSourceId={focusedSourceId}
        previewSourceId={previewSourceId}
        onFocusChange={onFocusChange}
        focusedHop={focusedHop}
        onHopFocusChange={onHopFocusChange}
        lockedHop={lockedHop}
        onHopLockChange={onHopLockChange}
        routeCellById={routeCellById}
      />
    </div>
  );
}

export default function ConsensusIdentityPlate({
  identity,
  dataHex,
  semanticSource,
  semanticPhase,
  semanticRecord,
  semanticMessage,
  causalLens = null,
  causalNavigation = null,
  reveal,
  statusText,
  statusColor,
  reducedMotion,
  identityProofBinding = null,
  onRecallWrite,
  recallEnabled = true,
  traceSource = 'none',
  traceSelected = false,
  traceReadout = null,
  traceEvidenceFocusSourceId = null,
  traceEvidencePreviewSourceId = null,
  onTraceEvidenceFocusChange,
  traceRouteHopFocus = null,
  onTraceRouteHopFocusChange,
  traceRouteHopLock = null,
  onTraceRouteHopLockChange,
  routeCellById,
  agreementCount,
  compact = false,
  spatial = false,
  contentWide = false,
}: {
  identity: CellConsensusIdentity;
  dataHex: string;
  semanticSource?: EnrichmentSourceStatus;
  semanticPhase?: CellSemanticsPhase;
  semanticRecord?: CellSemanticRecord | null;
  semanticMessage?: string | null;
  causalLens?: CellCausalLens | null;
  causalNavigation?: CellCausalNavigationReadout | null;
  reveal: number;
  statusText: string;
  statusColor: string;
  reducedMotion: boolean;
  identityProofBinding?: CellIdentityProofBinding | null;
  onRecallWrite?: () => void;
  recallEnabled?: boolean;
  traceSource?: ConsensusMemoryTraceSource;
  traceSelected?: boolean;
  traceReadout?: ConsensusMemoryTraceReadout | null;
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
  routeCellById?: ReadonlyMap<number, Cell>;
  agreementCount: number;
  compact?: boolean;
  /** Transparent scan-field treatment instead of a self-contained HUD card. */
  spatial?: boolean;
  /** Places raw bytes beside indexed analysis on wide layouts. */
  contentWide?: boolean;
}) {
  const observed = identity.observedWrite;
  const selectedIdentityProofBinding = identityProofBinding;
  const identityProofComplete = cellIdentityProofBindingComplete(
    selectedIdentityProofBinding,
  );
  const identityProofCount =
    selectedIdentityProofBinding?.resolvedKinds.length ?? 0;
  const lifecycleColor = identity.lifecycle === 'live'
    ? HUD_COLORS.nominal
    : HUD_COLORS.caution;
  const memoryProgress = reducedMotion ? 1 : clampUnit(reveal);
  const contentReveal = clampUnit(memoryProgress / 0.72);
  const causalRevealed = memoryProgress >= 0.76;
  const traceRevealed = memoryProgress >= 0.9;
  const memoryLocked = memoryProgress >= 1;
  const memoryStatusColor = memoryLocked ? lifecycleColor : CYAN;
  // WHERE / WHAT / WHEN read-marks in proof order — the same ◆/◇ the scan
  // facts wear, so the unlock is legible instead of an unexplained ritual.
  const proofGlyphs = (['address', 'content', 'anchor'] as const)
    .map((kind) => (
      selectedIdentityProofBinding?.resolvedKinds.includes(kind) ? '◆' : '◇'
    ))
    .join('');
  const spatialTraceState = !traceSelected
    ? !identityProofComplete
      ? `VERIFY ${proofGlyphs} ${identityProofCount}/3`
      : `${traceSource === 'witness' ? 'WITNESS' : traceSource === 'input' ? 'CAUSAL' : 'TRACE'} ${selectedIdentityProofBinding?.phase === 'retained' ? 'RETAINED' : 'READY'}`
    : traceReadout?.stage === 'converging'
      ? `${traceReadout.arrivedSourceCount}/${traceReadout.sourceCount} ARRIVED`
      : traceReadout?.stage === 'locked'
        ? `${traceReadout.resolvedSourceCount}/${traceReadout.sourceCount} VERIFIED`
        : (traceReadout?.stage ?? 'PLANNING').toUpperCase();
  const shell: CSSProperties = {
    position: 'relative',
    marginTop: spatial ? 0 : compact ? 6 : 9,
    padding: spatial ? '4px 5px 7px 0' : compact ? '6px 7px 5px' : '8px 9px 7px',
    overflow: 'visible',
    borderTop: spatial ? 0 : `1px solid ${CYAN}30`,
    borderBottom: spatial ? 0 : `1px solid ${VIOLET}26`,
    backgroundColor: spatial ? 'transparent' : 'rgba(1,4,12,.84)',
    backgroundImage: spatial
      ? `linear-gradient(90deg,${VIOLET}08,transparent 76%)`
      : `radial-gradient(circle at 50% 34%, ${CYAN}12 0, transparent 37%), linear-gradient(90deg, transparent, ${VIOLET}0b 48%, transparent)`,
    boxShadow: spatial ? undefined : `inset 0 0 18px ${CYAN}08`,
  };

  return (
    <div
      data-consensus-memory="true"
      data-consensus-memory-density={spatial ? 'spatial' : compact ? 'compact' : 'standard'}
      data-consensus-memory-state={memoryLocked ? 'locked' : 'scanning'}
      data-consensus-memory-progress={Math.round(memoryProgress * 100)}
      data-memory-identity-binding={spatial ? 'true' : undefined}
      data-memory-identity-phase={spatial
        ? selectedIdentityProofBinding?.phase ?? 'collecting'
        : undefined}
      data-memory-identity-count={spatial ? identityProofCount : undefined}
      data-memory-identity-complete={spatial
        ? identityProofComplete ? 'true' : 'false'
        : undefined}
      style={shell}
    >
      <span style={{ position: 'absolute', left: 0, top: 0, width: 8, height: 8, borderLeft: `1px solid ${CYAN}99`, borderTop: `1px solid ${CYAN}99` }} />
      <span style={{ position: 'absolute', right: 0, bottom: 0, width: 8, height: 8, borderRight: `1px solid ${VIOLET}88`, borderBottom: `1px solid ${VIOLET}88` }} />

      <SpatialPlateHeader
        en="CONSENSUS MEMORY"
        accent={VIOLET}
        marginBottom={0}
        status={(
          <span style={{ whiteSpace: 'nowrap', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.8, color: memoryStatusColor, textShadow: `0 0 6px ${memoryStatusColor}66` }}>
            {memoryLocked ? 'LOCKED' : `READING ${Math.round(memoryProgress * 100)}%`}
            {' · '}{identity.lifecycle === 'live' ? 'LIVE RECORD' : 'SPENT RECORD'}
          </span>
        )}
      />

      {!spatial ? (
        <IdentityBraid
          identity={identity}
          reducedMotion={reducedMotion}
          traceSelected={traceSelected}
          identityProofBinding={selectedIdentityProofBinding}
          compact={compact}
        />
      ) : null}

      <div
        data-consensus-memory-primary="true"
        style={{ minWidth: 0 }}
      >
        {spatial ? (
          <CellContentMemory
            dataHex={dataHex}
            source={semanticSource}
            phase={semanticPhase}
            record={semanticRecord}
            message={semanticMessage}
            wide={contentWide}
            reveal={contentReveal}
          />
        ) : null}
      </div>

      {causalLens ? (
        <div
          data-consensus-memory-reveal="causal"
          data-consensus-memory-reveal-state={causalRevealed
            ? 'resolved'
            : 'scanning'}
          style={{ display: causalRevealed ? 'block' : 'none' }}
        >
          <CellCausalLensReadout
            lens={causalLens}
            reveal={memoryProgress}
            navigation={causalNavigation}
            compact={compact}
            summary={spatial}
          />
        </div>
      ) : null}

      {!spatial ? <div
        data-memory-identity-binding="true"
        data-memory-identity-phase={
          selectedIdentityProofBinding?.phase ?? 'collecting'
        }
        data-memory-identity-count={identityProofCount}
        data-memory-identity-complete={
          identityProofComplete ? 'true' : 'false'
        }
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) auto',
          alignItems: 'baseline',
          gap: 5,
          marginTop: compact ? 4 : 5,
          paddingTop: compact ? 4 : 5,
          borderTop: `1px solid ${CYAN}18`,
          fontFamily: HUD_FONTS.mono,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 0.48,
        }}
      >
        {CELL_IDENTITY_PROOF_KINDS.map((kind) => {
          const proof = IDENTITY_PROOF_META[kind];
          const resolved = selectedIdentityProofBinding?.resolvedKinds
            .includes(kind) ?? false;
          return (
            <span
              key={kind}
              data-memory-identity-proof={kind}
              data-memory-identity-proof-state={
                resolved ? 'resolved' : 'pending'
              }
              style={{
                color: resolved ? proof.color : HUD_COLORS.dim,
                textShadow: resolved ? `0 0 6px ${proof.color}66` : undefined,
                opacity: resolved ? 1 : 0.56,
              }}
            >
              {resolved ? '◆' : '◇'} {proof.code}
            </span>
          );
        })}
        <span style={{
          color: identityProofComplete ? HUD_COLORS.cyanInk : HUD_COLORS.dim,
          textAlign: 'right',
        }}>
          {identityProofCount}/3
        </span>
        <span
          style={{
            gridColumn: '1 / -1',
            color: identityProofComplete
              ? selectedIdentityProofBinding?.phase === 'retained'
                ? GOLD
                : HUD_COLORS.cyanInk
              : HUD_COLORS.dim,
            letterSpacing: 0.62,
          }}
        >
          {selectedIdentityProofBinding?.phase === 'retained'
            ? 'IDENTITY + CONSENSUS MEMORY RETAINED'
            : selectedIdentityProofBinding?.phase === 'recalling'
              ? 'IDENTITY BOUND · RECALLING MAINTAINED RECORD'
              : identityProofComplete
                ? 'IDENTITY BOUND · MEMORY ROUTE READY'
                : 'RESOLVE ALL IDENTITY FACETS TO RECALL'}
        </span>
      </div> : null}

      {!spatial || observed ? <div
        data-consensus-memory-reveal="trace"
        data-consensus-memory-reveal-state={!spatial || traceRevealed
          ? 'resolved'
          : 'scanning'}
        style={{ display: !spatial || traceRevealed ? 'block' : 'none', marginTop: compact ? 4 : 5, paddingTop: spatial ? 2 : compact ? 4 : 5, borderTop: `1px solid ${CYAN}18` }}
      >
        {!spatial ? <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.45, color: statusColor, textShadow: `0 0 6px ${statusColor}55` }}>
          {statusText}
        </span> : null}
        {!spatial && traceSelected && traceReadout ? (
          <ConsensusMemoryTracePlate
            readout={traceReadout}
            reducedMotion={reducedMotion}
            targetContentHash={identity.contentHash}
            agreementCount={agreementCount}
            focusedSourceId={traceEvidenceFocusSourceId}
            previewSourceId={traceEvidencePreviewSourceId}
            onFocusChange={onTraceEvidenceFocusChange}
            focusedHop={traceRouteHopFocus}
            onHopFocusChange={onTraceRouteHopFocusChange}
            lockedHop={traceRouteHopLock}
            onHopLockChange={onTraceRouteHopLockChange}
            routeCellById={routeCellById}
          />
        ) : null}
        {observed && onRecallWrite ? (
          <button
            type="button"
            aria-label={traceSelected ? 'exit causal recall' : 'recall causal path'}
            data-write-observed="true"
            data-trace-available="true"
            data-trace-source={traceSource}
            data-trace-selected={traceSelected ? 'true' : 'false'}
            data-trace-state={traceSelected ? 'active' : 'ready'}
            data-trace-stage={traceSelected ? traceReadout?.stage ?? 'planning' : 'ready'}
            title={spatial && !identityProofComplete
              ? 'ARM MEMORY TRACE · read the three identity proofs by selecting STATE (WHERE), DATA (WHAT) and COMMIT (WHEN) in CELL IDENTITY'
              : observed.txHash}
            onClick={onRecallWrite}
            disabled={!recallEnabled}
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', gap: '2px 8px', width: '100%', margin: spatial ? 0 : '4px 0 0', padding: spatial ? '3px 2px' : '3px 0 2px', border: 0, borderTop: spatial ? 0 : `1px solid ${traceSelected ? VIOLET : GOLD}24`, background: traceSelected ? `${VIOLET}12` : 'transparent', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.35, color: traceSelected ? HUD_COLORS.memoryInk : GOLD, textShadow: `0 0 6px ${traceSelected ? VIOLET : GOLD}55`, whiteSpace: 'nowrap', cursor: recallEnabled ? 'pointer' : 'default', textAlign: 'left', opacity: recallEnabled ? 1 : 0.62 }}
          >
            <span>{spatial ? 'MEMORY TRACE' : 'WRITE OBSERVED'}</span>
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.goldInk }}>
              {formatBlockRef(observed.block)} · {observed.inputCount}→{observed.outputCount}{spatial ? ` · ${spatialTraceState}` : ''}
            </span>
            {!spatial ? <span style={{ gridColumn: '1 / -1', color: traceSelected ? VIOLET : CYAN, letterSpacing: 0.8 }}>
              {recallActionCopy({
                enabled: recallEnabled,
                identityComplete: identityProofComplete,
                identityPhase: selectedIdentityProofBinding?.phase ?? null,
                traceSelected,
                traceReadout,
                traceSource,
              })}
            </span> : null}
          </button>
        ) : observed ? (
          <div
            data-write-observed="true"
            title={observed.txHash}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.35, color: GOLD, textShadow: `0 0 6px ${GOLD}55`, whiteSpace: 'nowrap' }}
          >
            <span>{spatial ? 'MEMORY TRACE' : 'WRITE OBSERVED'}</span>
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.goldInk }}>
              {formatBlockRef(observed.block)} · {observed.inputCount}→{observed.outputCount}
            </span>
          </div>
        ) : null}
      </div> : null}
    </div>
  );
}
