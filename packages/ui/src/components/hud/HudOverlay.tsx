import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { BlockProducerView } from '../../derives/blockProducers.derive';
import { useBootSequence } from '../../boot/bootSequence';
import { HUD_COLORS, injectHudTheme, rgba } from './hudTheme';
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
import BootSequenceBanner from './BootSequenceBanner';
import StageComposingBanner from './StageComposingBanner';
import { createStageComposeWatch, sampleStageCompose } from '../../boot/stageCompose';
import CellsPanel from './CellsPanel';
import StageCapacityPanel from './StageCapacityPanel';
import RenderStatsPanel from './RenderStatsPanel';
import { useCellChurn } from './useCellChurn';
import WarningBar, { WARNING_BAR_HEIGHT, warningBarStanding } from './WarningBar';
import { useReducedMotion } from './useReducedMotion';
import { useMediaQuery } from './useMediaQuery';
import {
  deriveStreamHealthPhase,
  deriveStreamHealthSummary,
  type StreamHealthChannels,
} from '../../derives/streamHealth.derive';
import StreamHealthBanner from './StreamHealthBanner';
import { subscribeHudClock, useHudClockMs, useHudClockSelector } from './hudClock';

// We're "syncing" (catching up, benign) if the node is in IBD, our tip trails the
// network best-known by more than a couple of blocks, or most peers are ahead of us.
const SYNC_LAG_THRESHOLD = 2; // blocks behind best-known before we count as syncing
const SYNC_AHEAD_RATIO = 0.5; // fraction of peers ahead of our tip = we're behind

const ROOT_STYLE: CSSProperties = { position: 'fixed', inset: 0, zIndex: 15, pointerEvents: 'none', userSelect: 'none', overflow: 'hidden' };
// The scan lines are the first thing the root paints and the only thing under
// them is the root's own transparent ground: every band, rail and panel below
// carries a z-index or arrives later in the tree, so all of them paint above.
// No blend mode, therefore — an `overlay` against a zero-alpha backdrop
// resolves to the plain source-over already written here, and asking for one
// costs the compositor an isolated full-viewport blending group per frame.
const SCAN_STYLE: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: `repeating-linear-gradient(0deg,${rgba(HUD_COLORS.heroInk, 0.035)} 0 1px,transparent 1px 3px)`, opacity: 0.5 };
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
  scrollbarColor: `${rgba(HUD_COLORS.orange, 0.35)} transparent`,
  pointerEvents: 'auto',
};

const CHAIN_CLUSTER_STYLE: CSSProperties = { display: 'flex', flex: '1 1 auto', flexDirection: 'row', gap: LEFT_PANEL_GAP_PX, alignItems: 'flex-start', minHeight: 0, maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden', overscrollBehavior: 'contain', scrollbarWidth: 'thin', scrollbarColor: `${rgba(HUD_COLORS.orange, 0.35)} transparent`, pointerEvents: 'none' };
const PANEL_FLOW: CSSProperties = { position: 'relative' };
const PULSE_ANCHOR_STYLE: CSSProperties = { position: 'relative', flex: '0 0 auto', maxWidth: '100%' };
// The panel widths are constants, so their flow styles are constants too: a
// memoized panel handed a fresh `{ ...PANEL_FLOW, width }` per render is not
// memoized at all.
const CHAIN_PANEL_STYLE: CSSProperties = { ...PANEL_FLOW, width: `min(${CHAIN_PANEL_WIDTH_PX}px, calc(100vw - 58px))` };
// ECG·04 is the lower companion to CKB·01, not a footer for the whole
// CKB + DAO cluster. Keep their outer edges aligned even when DAO·05 is
// visible or CKB·01 is temporarily hidden from the panel menu.
const PULSE_PANEL_STYLE: CSSProperties = { ...PANEL_FLOW, width: `min(${CHAIN_PANEL_WIDTH_PX}px, calc(100vw - 58px))` };

/** The stream banner with its own clock: its `LAST FRAME` age is the one
 *  reading in the top slot that changes every second, so the summary is
 *  derived here, in a leaf, and the overlay renders nothing for the tick. The
 *  banner itself renders nothing while every channel is live. */
function LiveStreamHealthBanner({ channels, reducedMotion, top }: {
  channels: StreamHealthChannels;
  reducedMotion: boolean;
  top: number;
}) {
  const nowMs = useHudClockMs();
  const summary = useMemo(
    () => deriveStreamHealthSummary(channels, nowMs),
    [channels, nowMs],
  );
  return <StreamHealthBanner summary={summary} reducedMotion={reducedMotion} top={top} />;
}

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
// session the panels light in module order — CKB·01 → PEER·02 → CELL·03 →
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

// ——— Boot readout linger ————————————————————————————————————
/** How long the finished boot sequence keeps the top slot after its last line
 *  ticks over. The whole trail lit is the only frame in which a visitor can see
 *  what actually happened while they waited, and on a fast local boot that
 *  frame would otherwise last a few milliseconds. Nothing waits on it — the
 *  galaxy has been on screen behind the band since `first_light`. Skipped
 *  entirely under reduced motion, where a banner that outstays its state is
 *  just a banner that will not leave. */
const BOOT_READOUT_LINGER_MS = 700;

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

function HudOverlay({ chain, peers, localNode, cellsStats, stageScripts, cellPopulation, cellCount, cellCapacity, enrichmentSource, assetEcosystem, protocolEra, daoState, activityFeed, transactionHorizon, networkAtlas, scriptRegistry, backfill, streamHealth, build, topBarActions, colonyCount, producerView }: {
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
  /** Who has been making the chain's blocks lately, with the window every
   *  share is measured over. Chain-derived and local-first — it needs no
   *  crawler — so it reads in the peer mesh beside the other network facts. */
  producerView?: BlockProducerView | null;
}) {
  useEffect(() => { injectHudTheme(document); }, []);

  const reduced = useReducedMotion();

  // The page's own boot record. The store is module-level and lives in this
  // package, so the slot arbitration below needs nothing from the app — and one
  // subscription here serves both the decision and the banner.
  const boot = useBootSequence();
  const [bootLingering, setBootLingering] = useState(false);
  const bootWasActive = useRef(false);
  useEffect(() => {
    if (boot.active) { bootWasActive.current = true; return; }
    // A HUD that mounted after the record closed has nothing to hold: it never
    // showed the sequence, so there is no last frame of it to let anyone read.
    if (!bootWasActive.current || reduced) return;
    setBootLingering(true);
    const id = setTimeout(() => {
      bootWasActive.current = false;
      setBootLingering(false);
    }, BOOT_READOUT_LINGER_MS);
    return () => clearTimeout(id);
  }, [boot.active, reduced]);
  const bootReadoutVisible = boot.active || bootLingering;

  // The boot readout's second chapter. A freshly started server announces its
  // dashboard before its composition is back — so the page it auto-opens boots
  // against a placeholder world, and the Cells, edges and bridges that arrive
  // afterwards used to sprout with nothing on screen naming them. The boot
  // record itself must not be held open for that (it reports what the PAGE
  // did, and on a cold server the composition converges for minutes), so the
  // band changes chapter instead: same slot, same object, one word different.
  // `boot/stageCompose.ts` owns the decision; a resolved watch stops the
  // sampling interval and is terminal for the session.
  const [stageCompose, setStageCompose] = useState(createStageComposeWatch);
  const stagedLive = cellPopulation?.stagedLive ?? null;
  const stageBudget = cellPopulation?.stageBudget ?? null;
  const stageCurated = cellPopulation?.stagedResidentLive ?? null;
  const stageComposed = cellPopulation?.stagedCurated ?? false;
  const stageComposedAtMs = cellPopulation?.stageComposedAtMs ?? null;
  useEffect(() => {
    if (stageCompose.phase === 'resolved') return undefined;
    const sample = () => setStageCompose((watch) => sampleStageCompose(watch, {
      nowMs: Date.now(),
      stagedLive,
      budget: stageBudget,
      curatedLive: stageCurated,
      composed: stageComposed,
      composedAtMs: stageComposedAtMs,
    }));
    sample();
    // The settle resolve needs time to pass, not props to change.
    const id = setInterval(sample, 1_000);
    return () => clearInterval(id);
  }, [
    stagedLive,
    stageBudget,
    stageCurated,
    stageComposed,
    stageComposedAtMs,
    stageCompose.phase,
  ]);

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
  // out, leaving this body with no steady-state heartbeat at all — the 1 Hz
  // clock lives in `hudClock` and reaches only the spans that print it.
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

  // Menu order is module-number order — the codes ARE the registry, so the
  // list reads 01→08 regardless of which rail a panel docks on. ·06 is the
  // app-side Jukebox chip, which has no HUD visibility entry. Memoized on the
  // visibility record: the strip that renders it is memoized, and a fresh
  // array per render would hand it a new prop every time.
  //
  // ⭐ THE PREFIX NAMES THE SUBJECT, NOT THE FAMILY. ·02 and ·03 shared a
  // `MESH·0x` prefix for as long as their being a PAIR was the interesting
  // thing about them, and it cost both of them the one job a code has: two
  // adjacent panels on the same rail, addressed by strings that differ in a
  // single digit, in a menu where the label is the only thing telling them
  // apart. `PEER·02` and `CELL·03` say which plane each one reads before the
  // label does. Nothing about the pair is lost — they are still the HUD's two
  // meshes, still the only two panels that tint their tag, and the tint is
  // what carries the pairing now, in the two colours the meshes wear on stage.
  const panelControls = useMemo<HudPanelControl[]>(() => [
    {
      id: 'chain',
      code: 'CKB·01',
      label: 'COMMON KNOWLEDGE BASE',
      visible: panelVisibility.chain,
    },
    {
      id: 'peers',
      code: 'PEER·02',
      label: 'PEER MESH',
      visible: panelVisibility.peers,
    },
    {
      id: 'cells',
      code: 'CELL·03',
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
  ], [panelVisibility, daoPanelAvailable]);
  const setPanelVisible = useCallback((id: string, visible: boolean) => {
    if (!isHudPanelId(id)) return;
    setPanelVisibility((current) => ({ ...current, [id]: visible }));
  }, []);
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

  // The session's start; the uptime counts from it inside the status strip's
  // own leaf. No clock is held here: this root used to tick `Date.now()` as
  // state once a second, and every panel it owns re-rendered for the four
  // spans that print a time. Those spans subscribe to the shared HUD clock
  // themselves now (`hudClock`), and this body renders when data changes — or
  // when the one time-derived word below, the cadence condition, flips.
  const mountAt = useRef(Date.now());
  // The phase needs no clock — it is the worst channel's own word — and it is
  // what the layout below clears its rails under. The silence beside it is
  // the banner's business, in its own leaf.
  const streamPhase = streamHealth ? deriveStreamHealthPhase(streamHealth) : null;
  const streamInterrupted = streamPhase !== null && streamPhase !== 'live';
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
  // Re-measure rail overflow on mode / selection change and on each 1 Hz tick
  // of the shared clock (the latter catches viewport resize within a second),
  // subscribed from inside the effect so the tick never renders this body.
  // setRailScrolls no-ops when unchanged, so this doesn't churn renders.
  useEffect(() => {
    const measure = () => {
      const el = railRef.current;
      setRailScrolls(!!el && narrowRail && el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    return subscribeHudClock(measure);
  }, [narrowRail, panelVisibility.cells, panelVisibility.peers]);

  // reorg delta across renders
  const prevReorgs = useRef(chain.reorgs);
  const reorgDepth = Math.max(0, chain.reorgs - prevReorgs.current);

  // Both walk `peers` (with allocations/sorts); the 1 Hz uptime tick
  // re-renders this component with unchanged data, so key them on their
  // actual inputs instead of recomputing per render.
  const summary = useMemo(
    () => summarizeNetwork(peers, chain, localNode),
    // Keyed on the three chain fields the summary reads, not on the entity:
    // `chain` is shallow-cloned by every batch that touches it (a mempool tick
    // above all), and PEER·02 is memoized behind this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peers, chain.tip, chain.best_known_block, chain.ibd, localNode],
  );
  const consensus = useMemo(
    () => fleetConsensus(peers, chain.tip),
    [peers, chain.tip],
  );
  const targetMs = expectedBlockMs(chain.epoch.length);
  const blocksBehind = Math.max(0, chain.best_known_block - chain.tip);
  const syncing = chain.ibd || blocksBehind > SYNC_LAG_THRESHOLD || consensus.aheadRatio > SYNC_AHEAD_RATIO;
  // The condition word rides the clock — a silent chain flatlines by the
  // second passing — so it is a selector on the shared tick: the string is
  // re-derived per tick and this body re-renders only when it flips. The gap
  // clamps at 0 because last_block_ts_ms is fresh receive time and the clock
  // only re-ticks once a second, so right after a block the difference is
  // briefly negative.
  const intervalsMs = chain.recent_block_intervals_ms;
  const lastBlockTsMs = chain.last_block_ts_ms;
  const condition = useHudClockSelector((nowMs) => ecgCondition({
    intervalsMs,
    targetMs,
    msSinceLast: lastBlockTsMs ? Math.max(0, nowMs - lastBlockTsMs) : 0,
    syncing,
    prev: prevCond.current,
  }));
  const avgMs = windowMeanMs(chain.recent_block_intervals_ms, ECG_WINDOW);
  const alert = alertLevel({ ecg: condition, reorgDepth, syncing });
  const syncRatio = chain.best_known_block > 0 ? Math.min(1, chain.tip / chain.best_known_block) : 1;

  // Two bands, one stack — and the geometry lives here, below the alert, because
  // it is the alert that everything under the top slot has to clear.
  //
  // Same one-band-one-shift rule the WarningBar takes: whichever banner is
  // standing in the slot pushes what follows clear of it. Without the boot term
  // the rails jump up the moment `data_plane` goes live — measured seconds
  // before `fabric` closes the sequence — and tuck their titles 18px under a
  // band that is still very much standing.
  //
  // The alarm is the second band and was the half nobody carried: the bar knew
  // to sit under a banner, and nothing knew to sit under the bar. So its height
  // comes from the bar itself, and whether it is standing comes from the same
  // predicate the bar uses to decide it renders at all — the layout and the
  // band can then never disagree about whether the slot is occupied.
  const alarmStanding = warningBarStanding(alert.level);
  const alarmBandHeight = alarmStanding ? WARNING_BAR_HEIGHT : 0;

  // One voice in the slot, and the boot record has the first claim on it: a
  // page that is still coming up says so before it says anything about the
  // world it is coming up into. Every fault surface outranks the chapter too —
  // a stream fault, a replay or a raised alarm is a different kind of news, and
  // two of them are drawn in this same band.
  const stageComposingVisible = stageCompose.visible
    && !bootReadoutVisible
    && !streamInterrupted
    && !backfill
    && !alarmStanding;
  /** Something is standing in the top slot, whichever tenant is speaking.
   *  Everything below it clears the same 30px either way — the composing
   *  chapter is the band, not a plate floating under it, so a layout that
   *  cleared only the boot chapter would tuck the rails under a live band. */
  const topBandVisible = bootReadoutVisible || stageComposingVisible;
  const contentTop = topBarHeight
    + (topBandVisible || streamInterrupted ? 42 : 12)
    + alarmBandHeight;
  const railStyle: CSSProperties = narrowRail
    ? { ...MESH_RAIL_STYLE, top: contentTop, maxHeight: `calc(100vh - ${contentTop + 14}px)`, overflowX: 'hidden', overflowY: 'auto', pointerEvents: railScrolls ? 'auto' : 'none', scrollbarWidth: 'thin', scrollbarColor: `${rgba(HUD_COLORS.orange, 0.35)} transparent` }
    : { ...MESH_RAIL_STYLE, top: contentTop };

  // persist the across-render baselines after each commit
  useEffect(() => { prevReorgs.current = chain.reorgs; }, [chain.reorgs]);
  useEffect(() => { prevCond.current = condition; }, [condition]);

  return (
    <div
      style={ROOT_STYLE}
      data-stream-phase={streamPhase ?? undefined}
      data-hud-boot={bootCounting ? 'counting' : 'done'}
    >
      {!reduced && <div style={SCAN_STYLE} />}
      {/* Chrome and safety surfaces are exempt from the ritual: a status
          strip, an alert, a frozen-stream banner and a backfill readout are
          how you find out something is wrong, and nothing that reports a
          fault may be dimmed for style. */}
      <StatusStrip
        level={alert.level}
        uptimeSinceMs={mountAt.current}
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
      {/* One voice in the top slot. While the page is coming up the boot
          sequence owns it outright: `CONNECTING DATA PLANE` and the replay
          plate's block count are already lines INSIDE the sequence
          (`data_plane`, `seeding`), and the arrangement they replace was
          measured shouting CONNECTING over a galaxy that had finished
          rendering half a second earlier.
          The deliberate edge: a failed boot never completes, so the sequence
          holds the slot for the session and keeps the other two suppressed. A
          boot that died is the louder fault, and two banners disagreeing about
          which emergency is the emergency is how a reader learns to ignore
          both. Like the chrome above it this band is exempt from the count-off
          — it reports a state, and nothing that reports a state is dimmed for
          style. */}
      {bootReadoutVisible ? (
        <BootSequenceBanner
          boot={boot}
          top={topBarHeight}
          dense={compactTopBar}
          reducedMotion={reduced}
        />
      ) : null}
      {/* The record's second chapter, and the reason it is a chapter rather
          than a plate underneath: the composition landing is the same story
          the boot lines were telling, told one step further on. It waits for
          the boot chapter to finish — including its held last frame — so the
          band never changes its mind about which of the two it is. */}
      {stageComposingVisible ? (
        <StageComposingBanner
          staged={stagedLive}
          budget={stageBudget}
          curated={stageCurated}
          composed={stageComposed}
          top={topBarHeight}
        />
      ) : null}
      {streamHealth && !topBandVisible ? (
        <LiveStreamHealthBanner
          channels={streamHealth}
          reducedMotion={reduced}
          top={topBarHeight}
        />
      ) : null}
      {/* One band, one shift: whichever tenant is standing in the slot moves
          the alert down by its 30px, and they are never two at a time.
          The other half of that rule — this band's own 34px moving everything
          below it — is `alarmBandHeight` above, taken from the bar rather than
          typed again here. */}
      <WarningBar level={alert.level} trigger={alert.trigger} reducedMotion={reduced} top={topBarHeight + (topBandVisible || streamInterrupted ? 30 : 0)} />
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
                    style={CHAIN_PANEL_STYLE}
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
                    style={PULSE_PANEL_STYLE}
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
                    condition={condition}
                    reducedMotion={reduced}
                    style={PULSE_PANEL_STYLE}
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
              <NetworkPanel summary={summary} consensus={consensus} syncRatio={syncRatio} enrichmentSource={enrichmentSource} networkAtlas={networkAtlas} producers={producerView} style={PANEL_FLOW} />
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Held while the boot readout is up: the same replay is already the
          sequence's `seeding` line, with the same done/total off the same
          mirror. */}
      {bootReadoutVisible ? null : (
        <BackfillBar
          backfill={backfill ?? null}
          style={{ top: topBarHeight + (streamInterrupted ? 40 : 10) + alarmBandHeight }}
        />
      )}
    </div>
  );
}

// Memoized: App re-renders on selection/scene state that never reaches the
// HUD — no scene selection is a prop here at all any more — so with the
// App-side props held stable (build / streamHealth), this shallow compare
// limits HUD re-renders to genuine data changes. The 1 Hz clock is not one of
// them: it reaches its leaves through `hudClock`, never this body.
export default memo(HudOverlay);
