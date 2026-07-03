import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChainEntry, Peer, ChainNode, Cell } from '@cknerv/types';
import { summarizeNetwork } from '../../derives/peers.derive';
import { fleetConsensus, pingStats, versionSpread } from '../../derives/fleetTelemetry';
import { ecgCondition, expectedBlockMs, windowMeanMs, ECG_WINDOW, type EcgCondition } from '../../derives/ecgCondition';
import { alertLevel } from '../../derives/alertLevel';
import type { CellsStats } from '../../derives/cellsStats.derive';
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
const MESH_ZONE_STYLE: CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-start' };
const PANEL_FLOW: CSSProperties = { position: 'relative' };

export default function HudOverlay({ chain, peers, localNode, cellsStats, selectedCell, selectedNode, selectedPeer, onClearSelection, backfill, build, colonyCount }: {
  chain: ChainEntry; peers: Peer[]; localNode: ChainNode | undefined; cellsStats: CellsStats;
  selectedCell?: Cell | null; selectedNode?: ChainNode | null; selectedPeer?: Peer | null;
  onClearSelection?: () => void; backfill?: { done: number; total: number } | null;
  build?: BuildInfo;
  /** Whole inferred-colony node count for NetworkPanel's honest footnote. */
  colonyCount?: number;
}) {
  useEffect(() => { injectHudTheme(document); }, []);

  const reduced = useReducedMotion();
  const prevCond = useRef<EcgCondition>('FINE');
  const churn = useCellChurn(chain.tip, cellsStats.born, cellsStats.dead);

  // session uptime + a 1s tick so msSinceLast / flatline re-evaluate
  const mountAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

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
      <div style={MESH_RAIL_STYLE}>
        <div style={MESH_ZONE_STYLE}>
          {selectedCell && <CellDetailPanel cell={selectedCell} onClose={onClearSelection ?? (() => {})} style={PANEL_FLOW} />}
          <CellsPanel stats={cellsStats} churn={churn} reducedMotion={reduced} style={PANEL_FLOW} />
        </div>
        <div style={MESH_ZONE_STYLE}>
          {selectedNode ? (
            <NodeDetailPanel node={selectedNode} chain={chain} onClose={onClearSelection ?? (() => {})} style={PANEL_FLOW} />
          ) : selectedPeer ? (
            <PeerDetailPanel peer={selectedPeer} chain={chain} onClose={onClearSelection ?? (() => {})} style={PANEL_FLOW} />
          ) : null}
          <NetworkPanel summary={summary} consensus={consensus} ping={ping} vers={vers} syncRatio={syncRatio} colonyCount={colonyCount} style={PANEL_FLOW} />
        </div>
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
