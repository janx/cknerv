import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChainEntry, Peer, ChainNode, Cell } from '@cknerv/types';
import { summarizeNetwork } from '../../derives/peers.derive';
import { fleetConsensus, pingStats, versionSpread } from '../../derives/fleetTelemetry';
import { ecgCondition, expectedBlockMs, type EcgCondition } from '../../derives/ecgCondition';
import { alertLevel } from '../../derives/alertLevel';
import type { CellsStats } from '../../derives/cellsStats.derive';
import { injectHudTheme } from './hudTheme';
import StatusStrip from './StatusStrip';
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

export default function HudOverlay({ chain, peers, localNode, cellsStats, selectedCell, selectedNode, selectedPeer, onClearSelection, backfill }: {
  chain: ChainEntry; peers: Peer[]; localNode: ChainNode | undefined; cellsStats: CellsStats;
  selectedCell?: Cell | null; selectedNode?: ChainNode | null; selectedPeer?: Peer | null;
  onClearSelection?: () => void; backfill?: { done: number; total: number } | null;
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
  useEffect(() => { prevReorgs.current = chain.reorgs; }, [chain.reorgs]);

  const summary = summarizeNetwork(peers, chain, localNode);
  const consensus = fleetConsensus(peers, chain.tip);
  const ping = pingStats(peers);
  const vers = versionSpread(peers);
  const targetMs = expectedBlockMs(chain.epoch.length);
  const msSinceLast = chain.last_block_ts_ms ? now - chain.last_block_ts_ms : 0;
  const blocksBehind = Math.max(0, chain.best_known_block - chain.tip);
  const syncing = chain.ibd || blocksBehind > SYNC_LAG_THRESHOLD || consensus.aheadRatio > SYNC_AHEAD_RATIO;
  const condition = ecgCondition({ intervalsMs: chain.recent_block_intervals_ms, targetMs, msSinceLast, syncing, prev: prevCond.current });
  const alert = alertLevel({ ecg: condition, reorgDepth, syncing });
  useEffect(() => { prevCond.current = condition; }, [condition]);
  const syncRatio = chain.best_known_block > 0 ? Math.min(1, chain.tip / chain.best_known_block) : 1;

  return (
    <div style={ROOT_STYLE}>
      {!reduced && <div style={SCAN_STYLE} />}
      <StatusStrip level={alert.level} uptimeMs={now - mountAt.current} />
      <WarningBar level={alert.level} trigger={alert.trigger} reducedMotion={reduced} />
      <BlockchainReadout chain={chain} style={{ left: 14, top: 42 }} />
      <CellsPanel stats={cellsStats} churn={churn} reducedMotion={reduced} style={{ right: 14, top: 42 }} />
      <BlockCadenceEcg tip={chain.tip} condition={condition} reducedMotion={reduced} />
      <NetworkPanel summary={summary} consensus={consensus} ping={ping} vers={vers} syncRatio={syncRatio} style={{ right: 14, bottom: 40 }} />
      <BackfillBar backfill={backfill ?? null} />
      {selectedCell ? (
        <CellDetailPanel cell={selectedCell} onClose={onClearSelection ?? (() => {})} style={{ right: 14, top: 330 }} />
      ) : selectedNode ? (
        <NodeDetailPanel node={selectedNode} chain={chain} onClose={onClearSelection ?? (() => {})} style={{ right: 14, top: 330 }} />
      ) : selectedPeer ? (
        <PeerDetailPanel peer={selectedPeer} chain={chain} onClose={onClearSelection ?? (() => {})} style={{ right: 14, top: 330 }} />
      ) : null}
    </div>
  );
}
