import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ChainEntry,
  Peer,
  ChainNode,
  DaoStateRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import type { ActiveReplayProgress } from '@cknerv/cache';
import { summarizeNetwork } from '../../derives/peers.derive';
import { fleetConsensus, pingStats, versionSpread } from '../../derives/fleetTelemetry';
import { ecgCondition, expectedBlockMs, windowMeanMs, ECG_WINDOW, type EcgCondition } from '../../derives/ecgCondition';
import { alertLevel } from '../../derives/alertLevel';
import type { CellsStats } from '../../derives/cellsStats.derive';
import { injectHudTheme } from './hudTheme';
import StatusStrip, {
  STATUS_STRIP_HEIGHTS,
  type BuildInfo,
  type HudPanelControl,
} from './StatusStrip';
import BlockchainReadout from './BlockchainReadout';
import BlockCadenceEcg from './BlockCadenceEcg';
import DaoStatePanel from './DaoStatePanel';
import { canRenderDaoStateReadout } from './DaoStateReadout';
import NetworkPanel from './NetworkPanel';
import NodeDetailPanel from './NodeDetailPanel';
import PeerDetailPanel from './PeerDetailPanel';
import BackfillBar from './BackfillBar';
import CellsPanel from './CellsPanel';
import { useCellChurn } from './useCellChurn';
import WarningBar from './WarningBar';
import { useReducedMotion } from './useReducedMotion';
import { useMediaQuery } from './useMediaQuery';
import {
  deriveStreamHealthSummary,
  type StreamHealthChannels,
} from '../../derives/streamHealth.derive';
import StreamHealthBanner from './StreamHealthBanner';

// We're "syncing" (catching up, benign) if the node is in IBD, our tip trails the
// network best-known by more than a couple of blocks, or most peers are ahead of us.
const SYNC_LAG_THRESHOLD = 2; // blocks behind best-known before we count as syncing
const SYNC_AHEAD_RATIO = 0.5; // fraction of peers ahead of our tip = we're behind

const ROOT_STYLE: CSSProperties = { position: 'fixed', inset: 0, zIndex: 15, pointerEvents: 'none', overflow: 'hidden' };
const SCAN_STYLE: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)', mixBlendMode: 'overlay', opacity: 0.5 };
// Right-edge MESH RAIL: the CELL zone stacked over the PEER zone, right-anchored.
// Each zone is a flex row [detail | mesh] (network detail fans LEFT of its mesh); the
// rail is a flex column so the zones stack and details top-align to their mesh
// with no height math. Panels flow via PANEL_FLOW (position:relative) instead of
// self-positioning. Container shrink-wraps and pins its right edge, so the meshes
// never shift when a detail appears — the row just grows leftward.
const MESH_RAIL_STYLE: CSSProperties = { position: 'absolute', top: 42, right: 14, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' };
const LEFT_PANEL_GAP_PX = 12;
const CHAIN_PANEL_WIDTH_PX = 340;
const DAO_PANEL_WIDTH_PX = 300;
// Left HUD layout: the upper information cluster may scroll, while PULSE uses an
// auto margin as a true bottom-left anchor. The two regions share one bounded
// flex column, so an unusually tall CKB/DAO readout can never overlap ECG·04.
const LEFT_HUD_STYLE: CSSProperties = { position: 'absolute', left: 14, bottom: 14, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', minHeight: 0 };
const CHAIN_CLUSTER_STYLE: CSSProperties = { display: 'flex', flex: '1 1 auto', flexDirection: 'row', gap: LEFT_PANEL_GAP_PX, alignItems: 'flex-start', minHeight: 0, maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden', overscrollBehavior: 'contain', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,152,48,.35) transparent', pointerEvents: 'auto' };
// Narrow: the selected network detail owns the immediately visible rail area;
// its mesh follows below.
const MESH_ZONE_COL: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' };
const PANEL_FLOW: CSSProperties = { position: 'relative' };

const HUD_PANEL_IDS = ['chain', 'dao', 'pulse', 'cells', 'peers'] as const;
type HudPanelId = typeof HUD_PANEL_IDS[number];
type HudPanelVisibility = Record<HudPanelId, boolean>;
const DEFAULT_PANEL_VISIBILITY: HudPanelVisibility = {
  chain: true,
  dao: true,
  pulse: true,
  cells: true,
  peers: true,
};

function isHudPanelId(id: string): id is HudPanelId {
  return (HUD_PANEL_IDS as readonly string[]).includes(id);
}

export default function HudOverlay({ chain, peers, localNode, cellsStats, cellCount, cellCapacity, enrichmentSource, assetEcosystem, protocolEra, daoState, activityFeed, transactionHorizon, networkAtlas, cellInspectionActive = false, selectedNode, selectedPeer, onClearSelection, onClearNet, backfill, streamHealth, build, topBarActions, colonyCount }: {
  chain: ChainEntry; peers: Peer[]; localNode: ChainNode | undefined; cellsStats: CellsStats;
  /** Records available to CellGalaxy before the top-bar display cap. */
  cellCount?: number;
  /** Resolved server live-Cell cap exposed to the top-bar controller. */
  cellCapacity?: number;
  enrichmentSource?: EnrichmentSourceStatus;
  assetEcosystem?: AssetEcosystemRecord | null;
  protocolEra?: ProtocolEraRecord | null;
  daoState?: DaoStateRecord | null;
  activityFeed?: ActivityFeedRecord | null;
  transactionHorizon?: TransactionHorizonRecord | null;
  networkAtlas?: NetworkAtlasRecord | null;
  /** Lets the scene scan become the visual focus without hiding telemetry. */
  cellInspectionActive?: boolean;
  selectedNode?: ChainNode | null; selectedPeer?: Peer | null;
  /** Clear-all fallback for shared consumers with one network selection axis. */
  onClearSelection?: () => void;
  onClearNet?: () => void;
  backfill?: ActiveReplayProgress | null;
  /** Browser transport health for the independent chain and cells streams.
   * Kept separate from node sync/IBD so a frozen dashboard cannot look
   * nominal, and a syncing node is not mislabeled as a broken connection. */
  streamHealth?: StreamHealthChannels;
  build?: BuildInfo;
  /** Product-owned controls inserted into the shared status strip. */
  topBarActions?: ReactNode;
  /** Whole inferred-colony node count for NetworkPanel's honest footnote. */
  colonyCount?: number;
}) {
  useEffect(() => { injectHudTheme(document); }, []);

  // Cell inspection is scene-anchored; only node / peer detail remains here.
  const clearNet = onClearNet ?? onClearSelection ?? (() => {});

  const reduced = useReducedMotion();
  // Below ~1100px the left-fanning detail would reach the left-hand panels, so
  // dock it below its mesh instead (stays on the right edge). Tunable breakpoint.
  const narrowRail = useMediaQuery('(max-width: 1100px)');
  // The control-dense top bar needs to reflow before the panel rail itself does;
  // this also leaves headroom for transient stream/source chips.
  const compactTopBarWidth = useMediaQuery('(max-width: 1280px)');
  // Phones get a third priority row so display/quality controls never depend
  // on an initially hidden horizontal-scroll position.
  const mobileTopBar = useMediaQuery('(max-width: 560px)');
  const compactTopBar = mobileTopBar || narrowRail || compactTopBarWidth;
  const shortViewport = useMediaQuery('(max-height: 860px)');
  const [panelVisibility, setPanelVisibility] = useState<HudPanelVisibility>(
    DEFAULT_PANEL_VISIBILITY,
  );
  const daoPanelAvailable = canRenderDaoStateReadout(enrichmentSource, daoState);
  const chainPanelVisible = panelVisibility.chain;
  const daoPanelVisible = panelVisibility.dao && daoPanelAvailable;
  // ECG·04 is the lower companion to CKB·01, not a footer for the whole
  // CKB + DAO cluster. Keep their outer edges aligned even when DAO·05 is
  // visible or CKB·01 is temporarily hidden from the panel menu.
  const pulsePanelWidth = `min(${CHAIN_PANEL_WIDTH_PX}px, calc(100vw - 58px))`;
  const panelControls: HudPanelControl[] = [
    {
      id: 'chain',
      code: 'CKB·01',
      label: 'COMMON KNOWLEDGE BASE',
      visible: panelVisibility.chain,
    },
    ...(daoPanelAvailable ? [{
      id: 'dao',
      code: 'DAO·05',
      label: 'NERVOS DAO',
      visible: panelVisibility.dao,
    }] : []),
    {
      id: 'pulse',
      code: 'ECG·04',
      label: 'PULSE',
      visible: panelVisibility.pulse,
    },
    {
      id: 'cells',
      code: 'MESH·03',
      label: 'CELL MESH',
      visible: panelVisibility.cells,
    },
    {
      id: 'peers',
      code: 'MESH·02',
      label: 'PEER MESH',
      visible: panelVisibility.peers,
    },
  ];
  const setPanelVisible = (id: string, visible: boolean) => {
    if (!isHudPanelId(id)) return;
    setPanelVisibility((current) => ({ ...current, [id]: visible }));
  };
  // A rail zone: the MESH panel defines the zone's box. WIDE — network detail
  // fans left via absolute positioning. NARROW — detail comes first, then its
  // mesh, and the rail scrolls only when needed.
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
  const prevCond = useRef<EcgCondition>('FINE');
  const churn = useCellChurn(chain.tip, cellsStats.born, cellsStats.dead);

  // session uptime + a 1s tick so msSinceLast / flatline re-evaluate
  const mountAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const streamSummary = streamHealth
    ? deriveStreamHealthSummary(streamHealth, now)
    : null;
  const streamInterrupted = !!streamSummary && streamSummary.phase !== 'live';
  const mobileBarHasContext = Boolean(
    enrichmentSource || topBarActions,
  );
  const topBarHeight = mobileTopBar
    ? mobileBarHasContext
      ? STATUS_STRIP_HEIGHTS.mobileContext
      : STATUS_STRIP_HEIGHTS.mobile
    : compactTopBar
      ? STATUS_STRIP_HEIGHTS.compact
      : STATUS_STRIP_HEIGHTS.wide;
  const contentTop = topBarHeight + (streamInterrupted ? 42 : 12);
  const ambientHudStyle: CSSProperties = {
    opacity: cellInspectionActive ? 0.22 : 1,
    filter: cellInspectionActive ? 'saturate(0.55) brightness(0.72)' : undefined,
    transition: reduced ? undefined : 'opacity 180ms ease, filter 180ms ease',
  };
  const railStyle: CSSProperties = narrowRail
    ? { ...MESH_RAIL_STYLE, ...ambientHudStyle, top: contentTop, maxHeight: `calc(100vh - ${contentTop + 14}px)`, overflowX: 'hidden', overflowY: 'auto', pointerEvents: railScrolls ? 'auto' : 'none', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,152,48,.35) transparent' }
    : { ...MESH_RAIL_STYLE, ...ambientHudStyle, top: contentTop };

  // Re-measure rail overflow on mode / selection change and each 1s tick (the
  // latter catches viewport resize within a second). setRailScrolls no-ops when
  // unchanged, so this doesn't churn renders.
  useEffect(() => {
    const el = railRef.current;
    setRailScrolls(!!el && narrowRail && el.scrollHeight > el.clientHeight + 1);
  }, [narrowRail, panelVisibility.cells, panelVisibility.peers, selectedNode, selectedPeer, now]);

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
    <div
      style={ROOT_STYLE}
      data-stream-phase={streamSummary?.phase}
    >
      {!reduced && <div style={SCAN_STYLE} />}
      <StatusStrip
        level={alert.level}
        uptimeMs={now - mountAt.current}
        build={build}
        cellCount={cellCount ?? cellsStats.inView}
        cellCapacity={cellCapacity}
        enrichmentSource={enrichmentSource}
        actions={topBarActions}
        panelControls={panelControls}
        onPanelVisibilityChange={setPanelVisible}
        compact={compactTopBar}
        mobile={mobileTopBar}
      />
      {streamSummary ? (
        <StreamHealthBanner
          summary={streamSummary}
          reducedMotion={reduced}
          top={topBarHeight}
        />
      ) : null}
      <WarningBar level={alert.level} trigger={alert.trigger} reducedMotion={reduced} top={topBarHeight + (streamInterrupted ? 30 : 0)} />
      {chainPanelVisible
      || daoPanelVisible
      || panelVisibility.pulse ? (
        <div
          data-hud-left-rail
          style={{ ...LEFT_HUD_STYLE, ...ambientHudStyle, top: contentTop, maxWidth: 'calc(100vw - 28px)' }}
        >
          {chainPanelVisible || daoPanelVisible ? (
            <div
              className="cknerv-chain-cluster"
              data-hud-chain-cluster
              style={CHAIN_CLUSTER_STYLE}
            >
              {chainPanelVisible ? (
                <div
                  className="cknerv-chain-panel-scroll"
                  data-hud-panel="chain"
                  data-chain-panel-scroll
                  style={{
                    flex: '0 0 auto',
                    minHeight: 0,
                    maxHeight: '100%',
                    overflowX: 'hidden',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,152,48,.35) transparent',
                  }}
                >
                  <BlockchainReadout
                    chain={chain}
                    cellsStats={cellsStats}
                    enrichmentSource={enrichmentSource}
                    assetEcosystem={assetEcosystem}
                    protocolEra={protocolEra}
                    activityFeed={activityFeed}
                    transactionHorizon={transactionHorizon}
                    compactActivity={shortViewport}
                    style={{ ...PANEL_FLOW, width: `min(${CHAIN_PANEL_WIDTH_PX}px, calc(100vw - 58px))` }}
                  />
                </div>
              ) : null}
              {daoPanelVisible ? (
                <div
                  className="cknerv-chain-panel-scroll"
                  data-hud-panel="dao"
                  style={{
                    flex: '0 0 auto',
                    minHeight: 0,
                    maxHeight: '100%',
                    overflowX: 'hidden',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,152,48,.35) transparent',
                  }}
                >
                  <DaoStatePanel
                    source={enrichmentSource}
                    record={daoState}
                    nowMs={now}
                    style={{ ...PANEL_FLOW, width: `min(${DAO_PANEL_WIDTH_PX}px, calc(100vw - 58px))` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {panelVisibility.pulse ? (
            <div
              data-hud-panel="pulse"
              data-hud-pulse-anchor
              style={{ position: 'relative', flex: '0 0 auto', marginTop: 'auto', maxWidth: '100%' }}
            >
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
                style={{ ...PANEL_FLOW, width: pulsePanelWidth }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {/* MESH RAIL — fixed summary telemetry only. Cell inspection now follows
          the selected Cell in scene space; node / peer detail stays with the
          PEER zone because those entities belong to the network rail. */}
      {panelVisibility.cells || panelVisibility.peers ? (
        <div ref={railRef} className="cknerv-mesh-rail" style={railStyle}>
          {panelVisibility.cells ? meshZone(
            null,
            <div data-hud-panel="cells">
              <CellsPanel
                stats={cellsStats}
                churn={churn}
                reducedMotion={reduced}
                style={PANEL_FLOW}
              />
            </div>,
          ) : null}
          {panelVisibility.peers ? meshZone(
            selectedNode ? <NodeDetailPanel node={selectedNode} chain={chain} onClose={clearNet} style={PANEL_FLOW} />
              : selectedPeer ? <PeerDetailPanel peer={selectedPeer} chain={chain} onClose={clearNet} style={PANEL_FLOW} />
              : null,
            <div data-hud-panel="peers">
              <NetworkPanel summary={summary} consensus={consensus} ping={ping} vers={vers} syncRatio={syncRatio} colonyCount={colonyCount} enrichmentSource={enrichmentSource} networkAtlas={networkAtlas} style={PANEL_FLOW} />
            </div>,
          ) : null}
        </div>
      ) : null}
      <BackfillBar
        backfill={backfill ?? null}
        style={{ top: topBarHeight + (streamInterrupted ? 40 : 10) }}
      />
    </div>
  );
}
