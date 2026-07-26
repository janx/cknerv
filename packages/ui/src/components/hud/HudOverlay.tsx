import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ChainEntry, Peer, ChainNode, Cell, CellLink } from '@cknerv/types';
import type {
  ConsensusMemoryCellResponseRef,
  ConsensusMemoryRouteHopFocus,
  ConsensusMemoryTraceReadout,
  ConsensusMemoryTraceSource,
} from '../../nerve/consensusMemoryTrace';
import { summarizeNetwork } from '../../derives/peers.derive';
import { fleetConsensus, pingStats, versionSpread } from '../../derives/fleetTelemetry';
import { ecgCondition, expectedBlockMs, windowMeanMs, ECG_WINDOW, type EcgCondition } from '../../derives/ecgCondition';
import { alertLevel } from '../../derives/alertLevel';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type {
  CellIdentityProofBinding,
  CellIdentityProofKind,
} from '../../derives/cellIdentityProof.derive';
import type { CellCausalLens } from '../../derives/cellCausalLens.derive';
import type {
  CellCausalNavigationReadout,
} from './CellCausalLensReadout';
import { injectHudTheme } from './hudTheme';
import StatusStrip, { type BuildInfo } from './StatusStrip';
import BlockchainReadout from './BlockchainReadout';
import BlockCadenceEcg from './BlockCadenceEcg';
import NetworkPanel from './NetworkPanel';
import CellDetailPanel from './CellDetailPanel';
import NodeDetailPanel from './NodeDetailPanel';
import PeerDetailPanel from './PeerDetailPanel';
import BackfillBar from './BackfillBar';
import CellsPanel from './CellsPanel';
import { useCellChurn } from './useCellChurn';
import WarningBar from './WarningBar';
import { useReducedMotion } from './useReducedMotion';
import { useMediaQuery } from './useMediaQuery';

// We're "syncing" (catching up, benign) if the node is in IBD, our tip trails the
// network best-known by more than a couple of blocks, or most peers are ahead of us.
const SYNC_LAG_THRESHOLD = 2; // blocks behind best-known before we count as syncing
const SYNC_AHEAD_RATIO = 0.5; // fraction of peers ahead of our tip = we're behind

const ROOT_STYLE: CSSProperties = { position: 'fixed', inset: 0, zIndex: 15, pointerEvents: 'none', overflow: 'hidden' };
const SCAN_STYLE: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)', mixBlendMode: 'overlay', opacity: 0.5 };
// Right-edge MESH RAIL: the CELL zone stacked over the PEER zone, right-anchored.
// Each zone is a flex row [detail | mesh] (detail fans LEFT of its own mesh); the
// rail is a flex column so the zones stack and details top-align to their mesh
// with no height math. Panels flow via PANEL_FLOW (position:relative) instead of
// self-positioning. Container shrink-wraps and pins its right edge, so the meshes
// never shift when a detail appears — the row just grows leftward.
const MESH_RAIL_STYLE: CSSProperties = { position: 'absolute', top: 42, right: 14, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' };
// Narrow: the selected detail owns the immediately visible rail area; its mesh
// follows below. This keeps the consensus-memory readout in the first viewport
// instead of spending that space on the summary that opened it.
const MESH_ZONE_COL: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' };
const PANEL_FLOW: CSSProperties = { position: 'relative' };

export default function HudOverlay({ chain, peers, localNode, cellsStats, selectedCell, cellRecordsById, recentCellLinks, cellCausalLens, cellCausalNavigation, tracedCellWriteSeq, cellTraceSource, cellTraceReadout, cellTraceResponseRef, cellTraceEvidenceFocusSourceId, cellTraceEvidencePreviewSourceId, onCellTraceEvidenceFocusChange, cellTraceRouteHopFocus, onCellTraceRouteHopFocusChange, cellTraceRouteHopLock, onCellTraceRouteHopLockChange, cellIdentityProofBinding, onTraceCellWrite, onCellIdentityProofRead, selectedNode, selectedPeer, onClearSelection, onClearCell, onClearNet, backfill, build, colonyCount }: {
  chain: ChainEntry; peers: Peer[]; localNode: ChainNode | undefined; cellsStats: CellsStats;
  selectedCell?: Cell | null;
  /** Current Cell projection records for exact route-hop inspection. */
  cellRecordsById?: ReadonlyMap<number, Cell>;
  /** Retained causal links used only to prove an exact selected-Cell origin. */
  recentCellLinks?: readonly CellLink[];
  /** Shared selected-Cell causal evidence rendered in both HUD and scene. */
  cellCausalLens?: CellCausalLens | null;
  /** Local back/forward path through explicitly visited causal endpoints. */
  cellCausalNavigation?: CellCausalNavigationReadout | null;
  tracedCellWriteSeq?: number | null;
  cellTraceSource?: ConsensusMemoryTraceSource;
  cellTraceReadout?: ConsensusMemoryTraceReadout | null;
  cellTraceResponseRef?: ConsensusMemoryCellResponseRef;
  cellTraceEvidenceFocusSourceId?: number | null;
  cellTraceEvidencePreviewSourceId?: number | null;
  onCellTraceEvidenceFocusChange?: (sourceId: number | null) => void;
  cellTraceRouteHopFocus?: ConsensusMemoryRouteHopFocus | null;
  onCellTraceRouteHopFocusChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
  cellTraceRouteHopLock?: ConsensusMemoryRouteHopFocus | null;
  onCellTraceRouteHopLockChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
  cellIdentityProofBinding?: CellIdentityProofBinding | null;
  onTraceCellWrite?: (linkSeq: number) => void;
  onCellIdentityProofRead?: (
    kind: CellIdentityProofKind,
    cellId: number,
    reducedMotion: boolean,
  ) => void;
  selectedNode?: ChainNode | null; selectedPeer?: Peer | null;
  /** Clear-all fallback (cell + net). Kept for the shared @cknerv/ui API. */
  onClearSelection?: () => void;
  /** Clear just the cell / just the network selection — the two detail panels
   *  can now show at once (cell + node/peer), so each × clears its own axis.
   *  Each falls back to onClearSelection when not provided. */
  onClearCell?: () => void; onClearNet?: () => void;
  backfill?: { done: number; total: number } | null;
  build?: BuildInfo;
  /** Whole inferred-colony node count for NetworkPanel's honest footnote. */
  colonyCount?: number;
}) {
  useEffect(() => { injectHudTheme(document); }, []);

  // Per-axis clear for the two independent detail panels; fall back to the
  // single onClearSelection (shared @cknerv/ui API / non-split callers).
  const clearCell = onClearCell ?? onClearSelection ?? (() => {});
  const clearNet = onClearNet ?? onClearSelection ?? (() => {});

  const reduced = useReducedMotion();
  // Below ~1100px the left-fanning detail would reach the left-hand panels, so
  // dock it below its mesh instead (stays on the right edge). Tunable breakpoint.
  const narrowRail = useMediaQuery('(max-width: 1100px)');
  // A rail zone: the MESH panel defines the zone's box. WIDE — its detail fans
  // LEFT of the mesh via ABSOLUTE positioning, so a tall detail (the specimen
  // portrait!) never inflates the zone height and never pushes the stacked meshes
  // apart (that was the "cell detail appears → PEER MESH shoved down + big gap"
  // bug). NARROW — selected detail comes first, then its mesh (the rail scrolls).
  const meshZone = (detail: ReactNode, mesh: ReactNode): ReactNode =>
    narrowRail ? (
      <div style={MESH_ZONE_COL}>{detail}{mesh}</div>
    ) : (
      <div style={{ position: 'relative' }}>
        {mesh}
        {detail ? <div style={{ position: 'absolute', right: '100%', top: 0, marginRight: 12 }}>{detail}</div> : null}
      </div>
    );
  // When narrow, the rail docks details BELOW their mesh and can grow taller than
  // the viewport (esp. with both details open). Cap its height + let it scroll,
  // but only capture pointer events (needed to scroll) when it actually overflows,
  // so click-through to the 3D scene is preserved the rest of the time.
  const railRef = useRef<HTMLDivElement>(null);
  const [railScrolls, setRailScrolls] = useState(false);
  const railStyle: CSSProperties = narrowRail
    ? { ...MESH_RAIL_STYLE, maxHeight: 'calc(100vh - 56px)', overflowX: 'hidden', overflowY: 'auto', pointerEvents: railScrolls ? 'auto' : 'none', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,152,48,.35) transparent' }
    : MESH_RAIL_STYLE;
  const prevCond = useRef<EcgCondition>('FINE');
  const churn = useCellChurn(chain.tip, cellsStats.born, cellsStats.dead);

  // session uptime + a 1s tick so msSinceLast / flatline re-evaluate
  const mountAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  // Re-measure rail overflow on mode / selection change and each 1s tick (the
  // latter catches viewport resize within a second). setRailScrolls no-ops when
  // unchanged, so this doesn't churn renders.
  useEffect(() => {
    const el = railRef.current;
    setRailScrolls(!!el && narrowRail && el.scrollHeight > el.clientHeight + 1);
  }, [narrowRail, selectedCell, selectedNode, selectedPeer, now]);

  // reorg delta across renders
  const prevReorgs = useRef(chain.reorgs);
  const reorgDepth = Math.max(0, chain.reorgs - prevReorgs.current);

  const summary = summarizeNetwork(peers, chain, localNode);
  const consensus = fleetConsensus(peers, chain.tip);
  const ping = pingStats(peers);
  const vers = versionSpread(peers);
  const targetMs = expectedBlockMs(chain.epoch.length);
  // clamp >=0: last_block_ts_ms is fresh receive time but `now` only re-ticks once
  // a second, so right after a block `now - last` is briefly negative (negative hero).
  const msSinceLast = chain.last_block_ts_ms ? Math.max(0, now - chain.last_block_ts_ms) : 0;
  const blocksBehind = Math.max(0, chain.best_known_block - chain.tip);
  const syncing = chain.ibd || blocksBehind > SYNC_LAG_THRESHOLD || consensus.aheadRatio > SYNC_AHEAD_RATIO;
  const condition = ecgCondition({ intervalsMs: chain.recent_block_intervals_ms, targetMs, msSinceLast, syncing, prev: prevCond.current });
  const avgMs = windowMeanMs(chain.recent_block_intervals_ms, ECG_WINDOW);
  const alert = alertLevel({ ecg: condition, reorgDepth, syncing });
  const syncRatio = chain.best_known_block > 0 ? Math.min(1, chain.tip / chain.best_known_block) : 1;

  // persist the across-render baselines after each commit
  useEffect(() => { prevReorgs.current = chain.reorgs; }, [chain.reorgs]);
  useEffect(() => { prevCond.current = condition; }, [condition]);

  return (
    <div style={ROOT_STYLE}>
      {!reduced && <div style={SCAN_STYLE} />}
      <StatusStrip level={alert.level} uptimeMs={now - mountAt.current} build={build} />
      <WarningBar level={alert.level} trigger={alert.trigger} reducedMotion={reduced} />
      <BlockchainReadout chain={chain} style={{ left: 14, top: 42 }} />
      {/* MESH RAIL — the two mesh panels juxtaposed as a pair, each with its
          detail docked alongside. CELL zone (galaxy) over PEER zone (colony);
          within a zone the selected entity's detail fans LEFT of its own mesh.
          The local NODE and remote PEER details both belong to the PEER zone. */}
      <div ref={railRef} className="cknerv-mesh-rail" style={railStyle}>
        {meshZone(
          selectedCell ? (
            <CellDetailPanel
              key={selectedCell.id}
              cell={selectedCell}
              routeCellById={cellRecordsById}
              recentLinks={recentCellLinks}
              causalLens={cellCausalLens}
              causalNavigation={cellCausalNavigation}
              tracedWriteSeq={tracedCellWriteSeq}
              traceSource={cellTraceSource}
              traceReadout={cellTraceReadout}
              traceResponseRef={cellTraceResponseRef}
              traceEvidenceFocusSourceId={cellTraceEvidenceFocusSourceId}
              traceEvidencePreviewSourceId={cellTraceEvidencePreviewSourceId}
              onTraceEvidenceFocusChange={onCellTraceEvidenceFocusChange}
              traceRouteHopFocus={cellTraceRouteHopFocus}
              onTraceRouteHopFocusChange={onCellTraceRouteHopFocusChange}
              traceRouteHopLock={cellTraceRouteHopLock}
              onTraceRouteHopLockChange={onCellTraceRouteHopLockChange}
              identityProofBinding={cellIdentityProofBinding}
              onTraceWrite={onTraceCellWrite}
              onIdentityProofRead={onCellIdentityProofRead}
              onClose={clearCell}
              style={PANEL_FLOW}
            />
          ) : null,
          <CellsPanel stats={cellsStats} churn={churn} reducedMotion={reduced} style={PANEL_FLOW} />,
        )}
        {meshZone(
          selectedNode ? <NodeDetailPanel node={selectedNode} chain={chain} onClose={clearNet} style={PANEL_FLOW} />
            : selectedPeer ? <PeerDetailPanel peer={selectedPeer} chain={chain} onClose={clearNet} style={PANEL_FLOW} />
            : null,
          <NetworkPanel summary={summary} consensus={consensus} ping={ping} vers={vers} syncRatio={syncRatio} colonyCount={colonyCount} style={PANEL_FLOW} />,
        )}
      </div>
      <BlockCadenceEcg
        intervalsMs={chain.recent_block_intervals_ms}
        sizes={chain.recent_block_sizes}
        txCounts={chain.recent_block_tx_counts}
        lastBlockTsMs={chain.last_block_ts_ms ?? null}
        targetMs={targetMs}
        avgMs={avgMs}
        gapMs={msSinceLast}
        condition={condition}
        reducedMotion={reduced}
        style={{ left: 14, bottom: 14 }}
      />
      <BackfillBar backfill={backfill ?? null} />
    </div>
  );
}
