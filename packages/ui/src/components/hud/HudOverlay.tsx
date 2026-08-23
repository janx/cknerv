import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ScriptRegistryRecord,
  ChainEntry,
  Peer,
  ChainNode,
  DaoStateRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
  ProtocolEraRecord,
  ScriptCensus,
  TransactionHorizonRecord,
} from '@cknerv/types';
import type { ActiveReplayProgress } from '@cknerv/cache';
import { summarizeNetwork } from '../../derives/peers.derive';
import { fleetConsensus } from '../../derives/fleetTelemetry';
import { ecgCondition, expectedBlockMs, windowMeanMs, ECG_WINDOW, type EcgCondition } from '../../derives/ecgCondition';
import { alertLevel } from '../../derives/alertLevel';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { CellPopulationFieldModel } from '../../derives/cellPopulationField.derive';
import { injectHudTheme } from './hudTheme';
import { revealStageStyle } from './primitives';
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
import BackfillBar from './BackfillBar';
import CellsPanel from './CellsPanel';
import StageCapacityPanel from './StageCapacityPanel';
import RenderStatsPanel from './RenderStatsPanel';
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

const ROOT_STYLE: CSSProperties = { position: 'fixed', inset: 0, zIndex: 15, pointerEvents: 'none', userSelect: 'none', overflow: 'hidden' };
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
// Left HUD layout: the upper information cluster may scroll, while PULSE uses an
// auto margin as a true bottom-left anchor. The two regions share one bounded
// flex column, so an unusually tall CKB/DAO readout can never overlap ECG·04.
const LEFT_HUD_STYLE: CSSProperties = { position: 'absolute', left: 14, bottom: 14, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', minHeight: 0 };
// The cluster stretches to reserve the vertical space above PULSE. It must
// stay click-through: otherwise its transparent tail intercepts CellGalaxy
// pointer events far below the actual CKB / DAO panels. The concrete scroll
// panes opt back into pointer input individually.
/** One scrollable column per cluster panel, so a short viewport scrolls the
 *  panel instead of clipping it. */
const PANEL_SCROLL_STYLE: CSSProperties = {
  flex: '0 0 auto',
  minHeight: 0,
  maxHeight: '100%',
  overflowX: 'hidden',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(255,152,48,.35) transparent',
  pointerEvents: 'auto',
};

const CHAIN_CLUSTER_STYLE: CSSProperties = { display: 'flex', flex: '1 1 auto', flexDirection: 'row', gap: LEFT_PANEL_GAP_PX, alignItems: 'flex-start', minHeight: 0, maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden', overscrollBehavior: 'contain', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,152,48,.35) transparent', pointerEvents: 'none' };
const PANEL_FLOW: CSSProperties = { position: 'relative' };
const PULSE_ANCHOR_STYLE: CSSProperties = { position: 'relative', flex: '0 0 auto', maxWidth: '100%' };

const HUD_PANEL_IDS = ['chain', 'stage', 'render', 'dao', 'pulse', 'cells', 'peers'] as const;
type HudPanelId = typeof HUD_PANEL_IDS[number];
type HudPanelVisibility = Record<HudPanelId, boolean>;
const DEFAULT_PANEL_VISIBILITY: HudPanelVisibility = {
  chain: true,
  // The two dev instruments are opt-in: they dock beside CKB·01 when asked
  // for and cost nothing when not.
  stage: false,
  render: false,
  dao: true,
  pulse: true,
  cells: true,
  peers: true,
};

function isHudPanelId(id: string): id is HudPanelId {
  return (HUD_PANEL_IDS as readonly string[]).includes(id);
}

// ——— Boot count-off —————————————————————————————————————————
// A module registry is a list of numbers until you watch it come up. Once per
// session the panels light in module order — CKB·01 → MESH·02 → MESH·03 →
// ECG·04 → DAO·05 → STAGE·07 → GL·08 — so the codes stop being decoration and
// become the order the instrument boots in. It is the same reveal the
// inspection cards perform: every panel is mounted at final geometry on the
// first frame and only the ink arrives, because a reveal that moves layout is
// a reveal that shoves whatever you had started reading.
const BOOT_MODULE_ORDER: readonly HudPanelId[] = [
  'chain', 'peers', 'cells', 'pulse', 'dao', 'stage', 'render',
];
/** One module per beat. Seven beats plus the 260ms the last one takes to
 *  finish arriving lands the whole ritual just inside 1.2s; a default boot
 *  (STAGE·07 / GL·08 off) counts to four and is done in well under a second. */
const BOOT_SLOT_MS = 130;

/** Does this session want the ritual at all? Read once, synchronously, because
 *  `useReducedMotion` is mount-safe by design and cannot answer before the
 *  first paint — and someone who asked motion to stop must not be shown even
 *  one ghosted frame. No `matchMedia` at all (jsdom, an ancient browser) is
 *  not a request for stillness, so the ritual runs. */
function prefersFullMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function HudOverlay({ chain, peers, localNode, cellsStats, stageScripts, cellPopulation, cellCount, cellCapacity, enrichmentSource, assetEcosystem, protocolEra, daoState, activityFeed, transactionHorizon, networkAtlas, scriptRegistry, backfill, streamHealth, build, topBarActions, colonyCount }: {
  chain: ChainEntry; peers: Peer[]; localNode: ChainNode | undefined; cellsStats: CellsStats;
  /** The staged set counted by script identity, for the panel named after it.
   *  A different scope from `cellsStats.scripts`, which the backend counts
   *  over its whole retained window; the two never share a bar. */
  stageScripts?: ScriptCensus;
  /** How much of the Cell set this dashboard has individualized, and at what
   *  scope. Omitted by a consumer that derives none; the panel is then absent
   *  rather than guessing. */
  cellPopulation?: CellPopulationFieldModel | null;
  /** Records available to CellGalaxy before the top-bar display cap. */
  cellCount?: number;
  /** Resolved server live-Cell cap exposed to the top-bar controller. */
  cellCapacity?: number;
  enrichmentSource?: EnrichmentSourceStatus;
  assetEcosystem?: AssetEcosystemRecord | null;
  scriptRegistry?: ScriptRegistryRecord | null;
  protocolEra?: ProtocolEraRecord | null;
  daoState?: DaoStateRecord | null;
  activityFeed?: ActivityFeedRecord | null;
  transactionHorizon?: TransactionHorizonRecord | null;
  networkAtlas?: NetworkAtlasRecord | null;
  backfill?: ActiveReplayProgress | null;
  /** Browser transport health for the independent chain and cells streams.
   * Kept separate from node sync/IBD so a frozen dashboard cannot look
   * nominal, and a syncing node is not mislabeled as a broken connection. */
  streamHealth?: StreamHealthChannels;
  build?: BuildInfo;
  /** Product-owned controls inserted into the shared status strip. */
  topBarActions?: ReactNode;
  /** Whole inferred-colony node count — a count of what the scene draws, so
   *  it reads in the stage instrument and not in the peer mesh summary. */
  colonyCount?: number;
}) {
  useEffect(() => { injectHudTheme(document); }, []);

  const reduced = useReducedMotion();
  // Below ~1100px the rail's summaries would crowd the left-hand panels, so it
  // narrows and scrolls instead of fanning. Tunable breakpoint.
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

  // Whether this session performs the boot count-off is settled on the first
  // render (see `prefersFullMotion`); `reduced` then keeps it honest if the OS
  // setting flips mid-session.
  const [bootRitualArmed] = useState(prefersFullMotion);
  const bootRitual = bootRitualArmed && !reduced;
  // The roster is exactly the modules that were on stage when the session
  // opened, in module order. Hidden panels leave no dead slot behind: with
  // STAGE·07 and GL·08 off by default a normal boot counts to four — five once
  // DAO·05 has already validated — and finishes that much sooner. Captured
  // once, so nothing that arrives later can renumber a module mid-count.
  const [bootRoster] = useState<readonly HudPanelId[]>(() => BOOT_MODULE_ORDER
    .filter((id) => (id === 'dao' ? daoPanelVisible : panelVisibility[id])));
  const [bootLit, setBootLit] = useState(0);
  const bootCounting = bootRitual && bootLit < bootRoster.length;
  // One timeout alive at a time, re-armed by its own result: the ritual costs
  // exactly one re-render per module and stops re-arming when the roster runs
  // out, leaving the 1 Hz uptime tick as the HUD's only steady-state heartbeat.
  useEffect(() => {
    if (!bootCounting) return;
    const id = setTimeout(() => setBootLit((lit) => lit + 1), BOOT_SLOT_MS);
    return () => clearTimeout(id);
  }, [bootCounting, bootLit]);
  /** One panel wrapper's dress during the count-off. Opacity and pointer-events
   *  only — the wrapper keeps its own geometry and its own pointer contract and
   *  merely borrows the house ghost, so nothing moves while the HUD fills in.
   *  Deliberately *not* `revealStageAttributes`: a card's ghost is a fact the
   *  probe has not read yet and belongs out of the accessibility tree, but a
   *  booting panel is fully readable — flickering it out of that tree for half
   *  a second would be pure hostility. A module absent from the roster (DAO·05
   *  arriving with its record, a dev instrument summoned from the menu) was
   *  never part of this count and simply appears, lit. */
  const bootPanelStyle = (
    id: HudPanelId,
    base?: CSSProperties,
  ): CSSProperties | undefined => {
    if (!bootRitual) return base;
    const slot = bootRoster.indexOf(id);
    const lit = !bootCounting || slot < 0 || slot < bootLit;
    const { opacity, transition } = revealStageStyle(lit);
    return { ...base, opacity, transition, pointerEvents: lit ? base?.pointerEvents : 'none' };
  };

  // ECG·04 is the lower companion to CKB·01, not a footer for the whole
  // CKB + DAO cluster. Keep their outer edges aligned even when DAO·05 is
  // visible or CKB·01 is temporarily hidden from the panel menu.
  const pulsePanelWidth = `min(${CHAIN_PANEL_WIDTH_PX}px, calc(100vw - 58px))`;
  // Menu order is module-number order — the codes ARE the registry, so the
  // list reads 01→08 regardless of which rail a panel docks on. ·06 is the
  // app-side Jukebox chip, which has no HUD visibility entry.
  const panelControls: HudPanelControl[] = [
    {
      id: 'chain',
      code: 'CKB·01',
      label: 'COMMON KNOWLEDGE BASE',
      visible: panelVisibility.chain,
    },
    {
      id: 'peers',
      code: 'MESH·02',
      label: 'PEER MESH',
      visible: panelVisibility.peers,
    },
    {
      id: 'cells',
      code: 'MESH·03',
      label: 'CELL MESH',
      visible: panelVisibility.cells,
    },
    {
      id: 'pulse',
      code: 'ECG·04',
      label: 'PULSE',
      visible: panelVisibility.pulse,
    },
    ...(daoPanelAvailable ? [{
      id: 'dao',
      code: 'DAO·05',
      label: 'NERVOS DAO',
      visible: panelVisibility.dao,
    }] : []),
    {
      id: 'stage',
      code: 'STAGE·07',
      label: 'STAGE SAMPLE',
      visible: panelVisibility.stage,
    },
    {
      id: 'render',
      code: 'GL·08',
      label: 'RENDER STATS',
      visible: panelVisibility.render,
    },
  ];
  const setPanelVisible = (id: string, visible: boolean) => {
    if (!isHudPanelId(id)) return;
    setPanelVisibility((current) => ({ ...current, [id]: visible }));
  };
  // The rail used to wrap each summary in a zone so a detail card could fan
  // out beside it. Every detail now follows its own entity in scene space, so
  // the summaries are the rail's whole content and need no zone around them.
  // It can still outgrow the viewport when narrow: cap its height + let it
  // scroll, but only capture pointer events (needed to scroll) when it really
  // overflows, so click-through to the 3D scene is preserved the rest of the
  // time.
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
  const railStyle: CSSProperties = narrowRail
    ? { ...MESH_RAIL_STYLE, top: contentTop, maxHeight: `calc(100vh - ${contentTop + 14}px)`, overflowX: 'hidden', overflowY: 'auto', pointerEvents: railScrolls ? 'auto' : 'none', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,152,48,.35) transparent' }
    : { ...MESH_RAIL_STYLE, top: contentTop };

  // Re-measure rail overflow on mode / selection change and each 1s tick (the
  // latter catches viewport resize within a second). setRailScrolls no-ops when
  // unchanged, so this doesn't churn renders.
  useEffect(() => {
    const el = railRef.current;
    setRailScrolls(!!el && narrowRail && el.scrollHeight > el.clientHeight + 1);
  }, [narrowRail, panelVisibility.cells, panelVisibility.peers, now]);

  // reorg delta across renders
  const prevReorgs = useRef(chain.reorgs);
  const reorgDepth = Math.max(0, chain.reorgs - prevReorgs.current);

  // Both walk `peers` (with allocations/sorts); the 1 Hz uptime tick
  // re-renders this component with unchanged data, so key them on their
  // actual inputs instead of recomputing per render.
  const summary = useMemo(
    () => summarizeNetwork(peers, chain, localNode),
    [peers, chain, localNode],
  );
  const consensus = useMemo(
    () => fleetConsensus(peers, chain.tip),
    [peers, chain.tip],
  );
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
      data-hud-boot={bootCounting ? 'counting' : 'done'}
    >
      {!reduced && <div style={SCAN_STYLE} />}
      {/* Chrome and safety surfaces are exempt from the ritual: a status
          strip, an alert, a frozen-stream banner and a backfill readout are
          how you find out something is wrong, and nothing that reports a
          fault may be dimmed for style. */}
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
      || panelVisibility.stage
      || panelVisibility.render
      || daoPanelVisible
      || panelVisibility.pulse ? (
        <div
          data-hud-left-rail
          style={{ ...LEFT_HUD_STYLE, top: contentTop, maxWidth: 'calc(100vw - 28px)' }}
        >
          {chainPanelVisible || panelVisibility.stage || panelVisibility.render ? (
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
                  style={bootPanelStyle('chain', PANEL_SCROLL_STYLE)}
                >
                  <BlockchainReadout
                    chain={chain}
                    cellPopulation={cellPopulation}
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
              {/* The two opt-in dev instruments dock in a row beside CKB·01,
                  keeping the bottom-right corner free for the Jukebox chip. */}
              {panelVisibility.stage ? (
                <div
                  className="cknerv-chain-panel-scroll"
                  data-hud-panel="stage"
                  style={bootPanelStyle('stage', PANEL_SCROLL_STYLE)}
                >
                  <StageCapacityPanel
                    stats={cellsStats}
                    stageScripts={stageScripts}
                    scriptRegistry={scriptRegistry}
                    model={cellPopulation}
                    colonyCount={colonyCount}
                    style={PANEL_FLOW}
                  />
                </div>
              ) : null}
              {panelVisibility.render ? (
                <div
                  className="cknerv-chain-panel-scroll"
                  data-hud-panel="render"
                  style={bootPanelStyle('render', PANEL_SCROLL_STYLE)}
                >
                  <RenderStatsPanel style={PANEL_FLOW} />
                </div>
              ) : null}
            </div>
          ) : null}
          {daoPanelVisible || panelVisibility.pulse ? (
            <div
              data-hud-bottom-stack
              style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: LEFT_PANEL_GAP_PX, alignItems: 'flex-start', minHeight: 0, maxWidth: '100%', flex: '0 0 auto' }}
            >
              {daoPanelVisible ? (
                <div
                  className="cknerv-chain-panel-scroll"
                  data-hud-panel="dao"
                  style={bootPanelStyle('dao', PANEL_SCROLL_STYLE)}
                >
                  <DaoStatePanel
                    source={enrichmentSource}
                    record={daoState}
                    nowMs={now}
                    style={{ ...PANEL_FLOW, width: pulsePanelWidth }}
                  />
                </div>
              ) : null}
              {panelVisibility.pulse ? (
                <div
                  data-hud-panel="pulse"
                  data-hud-pulse-anchor
                  style={bootPanelStyle('pulse', PULSE_ANCHOR_STYLE)}
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
        </div>
      ) : null}
      {/* MESH RAIL — fixed summary telemetry only. Cell, peer and local-node
          detail all follow their entity in scene space now; nothing docks
          beside a summary here any more. */}
      {panelVisibility.cells || panelVisibility.peers ? (
        <div ref={railRef} className="cknerv-mesh-rail" style={railStyle}>
          {panelVisibility.cells ? (
            <div data-hud-panel="cells" style={bootPanelStyle('cells')}>
              <CellsPanel
                stats={cellsStats}
                churn={churn}
                reducedMotion={reduced}
                style={PANEL_FLOW}
              />
            </div>
          ) : null}
          {panelVisibility.peers ? (
            <div data-hud-panel="peers" style={bootPanelStyle('peers')}>
              <NetworkPanel summary={summary} consensus={consensus} syncRatio={syncRatio} enrichmentSource={enrichmentSource} networkAtlas={networkAtlas} style={PANEL_FLOW} />
            </div>
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

// Memoized: App re-renders on selection/scene state that never reaches the
// HUD — no scene selection is a prop here at all any more — so with the
// App-side props held stable (build / streamHealth), this shallow compare
// limits HUD re-renders to genuine data changes plus the internal 1 Hz tick.
export default memo(HudOverlay);
