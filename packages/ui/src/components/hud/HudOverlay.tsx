import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ScriptFamilyCensusRecord,
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
import { alertLevel, reorgAlertStanding } from '../../derives/alertLevel';
import { useHeldAlert } from '../../hooks/useHeldAlert';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { CellPopulationFieldModel } from '../../derives/cellPopulationField.derive';
import type { BlockProducerView } from '../../derives/blockProducers.derive';
import { useBootSequence } from '../../boot/bootSequence';
import {
  HUD_COLORS,
  HUD_FONTS,
  HUD_MOTION,
  injectHudTheme,
  rgba,
  viewportMinusSafeArea,
} from './hudTheme';
import { revealStageStyle } from './primitives';
import StatusStrip, {
  STATUS_STRIP_HEIGHTS,
  type BuildInfo,
  type HudPanelControl,
} from './StatusStrip';
// ⚠️ From the hook's own file, and never re-exported through `StatusStrip`.
// `HudOverlay.clock.test.tsx` replaces that module with a default-only
// counting factory, so a named import taken from it would arrive `undefined`
// in exactly the suite that renders this component the most.
import {
  STATUS_STRIP_FOLD_ESTIMATE_QUERY,
  useStatusStripFold,
} from './useStatusStripFold';
import BlockchainReadout, {
  CHAIN_PANEL_DENSE_WIDTH_PX,
  CHAIN_PANEL_WIDTH_PX,
} from './BlockchainReadout';
import BlockCadenceEcg from './BlockCadenceEcg';
import DaoStatePanel from './DaoStatePanel';
import { canRenderDaoStateReadout } from './DaoStateReadout';
import NetworkPanel from './NetworkPanel';
import BackfillBar from './BackfillBar';
import BootSequenceBanner from './BootSequenceBanner';
import StageComposingBanner from './StageComposingBanner';
import { TOP_BAND_HEIGHT } from './TopBand';
import { createStageComposeWatch, sampleStageCompose } from '../../boot/stageCompose';
import CellsPanel from './CellsPanel';
import StageCapacityPanel from './StageCapacityPanel';
import RenderStatsPanel from './RenderStatsPanel';
import { useCellChurn } from './useCellChurn';
import WarningBar, { WARNING_BAR_HEIGHT, warningBarStanding } from './WarningBar';
import { REDUCED_MOTION_QUERY, useReducedMotion } from './useReducedMotion';
import { useMediaQuery } from './useMediaQuery';
import {
  deriveStreamHealthPhase,
  deriveStreamHealthSummary,
  type StreamHealthChannels,
} from '../../derives/streamHealth.derive';
import StreamHealthBanner from './StreamHealthBanner';
import { subscribeHudClock, useHudClockMs, useHudClockSelector } from './hudClock';
import { invalidateHudOcclusionRects } from '../hudOcclusion';
import { useHudCameraFrame, type HudCameraFrame } from './useHudCameraFrame';

// We're "syncing" (catching up, benign) if the node is in IBD, our tip trails the
// network best-known by more than a couple of blocks, or most peers are ahead of us.
const SYNC_LAG_THRESHOLD = 2; // blocks behind best-known before we count as syncing
const SYNC_AHEAD_RATIO = 0.5; // fraction of peers ahead of our tip = we're behind

// `fontFamily` is on the ROOT for a reason that took a scan to find (report
// F, F-3): a HUD element that names no face inherits the BODY's, and
// `index.html` sets the body to `ui-monospace, monospace` — the OS monospace,
// which carries no `◇`. Two of them were drawing in it, in the two components
// that sit closest to the frame (`BackfillBar`'s tell glyph and `TopBand`'s),
// and nothing said so: they looked like every other HUD element on screen
// because the fallback happened to be a monospace too.
//
// One line here covers every inheritor, including the ones nobody has written
// yet, and it is `mono` because that is what a HUD leaf that says nothing is
// asking for — the readout voice. A leaf that wants a different one still says
// so; this is the floor, not a decision taken away from it.
//
// ——— And the frame stands inside the SAFE AREA, not inside the viewport ———
//
// `ui-app/index.html` asks for `viewport-fit=cover`. That is a promise to
// paint edge to edge and a debt taken on in the same breath: the page is then
// handed the whole screen INCLUDING whatever a system surface is sitting on,
// and the only thing it gets back is a measurement of where those parts are
// (`env(safe-area-inset-*)`). iPadOS 26 Safari floats its toolbar OVER the
// page rather than standing above it, and 2026-09-09 measured what the unpaid
// debt costs: on an 11" iPad in landscape the toolbar covers the page's top
// ~33 px, so all 36 px of the status strip sat under it and the only thing
// that reached the screen was its 1 px accent rail. Every control the
// instrument has — the PANELS menu, the stage-cells slider, the quality
// selector, the ckbadger chip, both links — lives in that row, so an iPad
// could read the HUD and touch none of it.
//
// All four sides, because it is one reason and not four: a rail standing
// 14 px off the page edge (`RAIL_INSET_PX`) is measuring from an edge the
// reader can SEE, and on a covered edge that measurement is a fiction. On a
// desktop every inset resolves to `0px` and this is `inset: 0` again, pixel
// for pixel — the rule costs nothing where nothing is covered.
//
// ⚠️ The CANVAS underneath is deliberately NOT inset. The ground the galaxy
// is painted on is meant to run under the system's chrome, full bleed; it is
// the instrument's READINGS that move in. And this is the HUD frame only:
// `INSPECTION_LAYER_STYLE` (`sceneInspection.tsx`) stays at `inset: 0` because
// a card is placed by its cell's PROJECTED screen position, so insetting that
// layer would slide every card off the thing it points at.
const ROOT_STYLE: CSSProperties = {
  position: 'fixed',
  top: 'env(safe-area-inset-top, 0px)',
  right: 'env(safe-area-inset-right, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
  left: 'env(safe-area-inset-left, 0px)',
  zIndex: 15,
  pointerEvents: 'none',
  userSelect: 'none',
  overflow: 'hidden',
  fontFamily: HUD_FONTS.mono,
};
// The scan lines are the first thing the root paints and the only thing under
// them is the root's own transparent ground: every band, rail and panel below
// carries a z-index or arrives later in the tree, so all of them paint above.
// No blend mode, therefore — an `overlay` against a zero-alpha backdrop
// resolves to the plain source-over already written here, and asking for one
// costs the compositor an isolated full-viewport blending group per frame.
//
// ⭐ AND THEY STAY UNDER REDUCED MOTION (D-11, and `MOTION_POLICY` in
// `hudTheme.ts`). This layer used to be removed for a visitor who asked for
// stillness, which was the policy exactly inverted: it is a static gradient —
// it does not move, it has never moved, and there is nothing in it to stop —
// while twelve thousand cells kept spinning under it (report E, E-6).
// Reduced motion is about MOTION. Texture is what the instrument is made of,
// and taking it away turned the request into a different, quieter HUD nobody
// asked for.
const SCAN_STYLE: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', background: `repeating-linear-gradient(0deg,${rgba(HUD_COLORS.heroInk, 0.035)} 0 1px,transparent 1px 3px)`, opacity: 0.5 };
/** How far each rail stands off the page edge. One number: the two rails are
 *  one frame, and the collapse rule below measures the stage BETWEEN them. */
const RAIL_INSET_PX = 14;
// Right-edge MESH RAIL: the CELL zone stacked over the PEER zone, right-anchored.
// Each zone is a flex row [detail | mesh] (network detail fans LEFT of its mesh); the
// rail is a flex column so the zones stack and details top-align to their mesh
// with no height math. Panels flow via PANEL_FLOW (position:relative) instead of
// self-positioning. Container shrink-wraps and pins its right edge, so the meshes
// never shift when a detail appears — the row just grows leftward.
const MESH_RAIL_STYLE: CSSProperties = { position: 'absolute', top: 42, right: RAIL_INSET_PX, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' };
const LEFT_PANEL_GAP_PX = 12;
// Left HUD layout: the upper information cluster may scroll, while PULSE uses an
// auto margin as a true bottom-left anchor. The two regions share one bounded
// flex column, so an unusually tall CKB/DAO readout can never overlap ECG·04.
const LEFT_HUD_STYLE: CSSProperties = { position: 'absolute', left: RAIL_INSET_PX, bottom: 14, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', minHeight: 0 };
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
const CHAIN_PANEL_STYLE: CSSProperties = { ...PANEL_FLOW, width: `min(${CHAIN_PANEL_WIDTH_PX}px, ${viewportMinusSafeArea('width', 58)})` };
const CHAIN_PANEL_DENSE_STYLE: CSSProperties = { ...PANEL_FLOW, width: `min(${CHAIN_PANEL_DENSE_WIDTH_PX}px, ${viewportMinusSafeArea('width', 58)})` };
// ECG·04 is the lower companion to CKB·01, not a footer for the whole
// CKB + DAO cluster. Keep their outer edges aligned even when DAO·05 is
// visible or CKB·01 is temporarily hidden from the panel menu.
const PULSE_PANEL_STYLE: CSSProperties = { ...PANEL_FLOW, width: `min(${CHAIN_PANEL_WIDTH_PX}px, ${viewportMinusSafeArea('width', 58)})` };
const PULSE_PANEL_DENSE_STYLE: CSSProperties = { ...PANEL_FLOW, width: `min(${CHAIN_PANEL_DENSE_WIDTH_PX}px, ${viewportMinusSafeArea('width', 58)})` };

/** What a `HudPanel` adds around its declared measure: `13px 15px` of padding
 *  on a box that is not `border-box`, so 30 px of width. Restated here rather
 *  than imported as a style — the primitive states it as a CSS shorthand, and
 *  the arithmetic below needs a number. A test renders a `HudPanel` and fails
 *  if the two ever disagree. */
const HUD_PANEL_FRAME_PX = 30;
/** The mesh rail's own measure, restated from `CellsPanel` / `NetworkPanel`
 *  (which state it twice between them). Same bargain as the frame above: the
 *  toll is a test that renders both panels and reads the width they actually
 *  set. */
const MESH_PANEL_WIDTH_PX = 302;

/** The page the two rails take when neither has collapsed: an inset, a chain
 *  panel and its frame on the left; a mesh panel and its frame and an inset on
 *  the right. 730 px, at every viewport — which is the whole trouble. */
const RAILS_FULL_WIDTH_PX = RAIL_INSET_PX * 2
  + (CHAIN_PANEL_WIDTH_PX + HUD_PANEL_FRAME_PX)
  + (MESH_PANEL_WIDTH_PX + HUD_PANEL_FRAME_PX);

/** The stage a card needs to stand BESIDE the thing it points at: the narrow
 *  card's own measure, the tether the placement solver leaves between a card
 *  and its entity, and a margin so the card lands on stage rather than flush
 *  against a rail. `CellDetailPanel.CARD_WIDTH_PX` and
 *  `sceneInspection.INSPECTOR_GAP_PX` are the two authorities; both are
 *  restated here and both are tolled by a test that imports them.
 *
 * ⚠️ Restated, not imported, and the reason is A1's: `INSPECTOR_GAP_PX` lives
 * in `sceneInspection.tsx`, which pulls in `@react-three/fiber`. The DOM-only
 * HUD root does not acquire an R3F import to say how wide a card is.
 *
 * ⚠️ And it is the card's FULL narrow measure, not the compact floor the card
 * falls to under it (`CellDetailPanel.CARD_COMPACT_MIN_WIDTH_PX`, 640). The
 * compact card is what a stage the rails have ALREADY left answers with; a
 * rail that stayed up because 640 would have fitted would be a rail buying its
 * own room out of the register's line length. The rails give way first. */
const RAILS_COLLAPSE_CARD_PX = 728;
const RAILS_COLLAPSE_TETHER_PX = 42;
const RAILS_COLLAPSE_MARGIN_PX = 24;
const RAILS_COLLAPSE_HOLE_PX = RAILS_COLLAPSE_CARD_PX
  + RAILS_COLLAPSE_TETHER_PX
  + RAILS_COLLAPSE_MARGIN_PX;

/** The widest page whose rails collapse: the one where the stage between two
 *  FULL rails is a pixel short of holding a card beside its cell. `max-width`
 *  is inclusive, hence the −1; a page one pixel wider keeps its rails and
 *  still has room. */
const RAILS_COLLAPSE_MAX_WIDTH_PX = RAILS_FULL_WIDTH_PX + RAILS_COLLAPSE_HOLE_PX - 1;
const RAILS_COLLAPSE_QUERY = `(max-width: ${RAILS_COLLAPSE_MAX_WIDTH_PX}px)`;

export {
  HUD_PANEL_FRAME_PX,
  MESH_PANEL_WIDTH_PX,
  RAILS_FULL_WIDTH_PX,
  RAILS_COLLAPSE_HOLE_PX,
  RAILS_COLLAPSE_MARGIN_PX,
  RAILS_COLLAPSE_MAX_WIDTH_PX,
};

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

// ⚠️ `sound` IS IN THE REGISTRY AND IS NOT A HUD PANEL. SND·06 is the app-side
// Jukebox chip, and it held a module number the registry's own menu could not
// show — a code says "I am one of the modules", and a module the module list
// does not list is a number wearing a costume (report E, E-11; the user's
// D-14). The visibility lives here with the other seven because the REGISTRY is
// one thing; what the flag reaches is a callback, since the chip is mounted by
// the app.
const HUD_PANEL_IDS = ['chain', 'stage', 'render', 'dao', 'pulse', 'cells', 'peers', 'sound'] as const;
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
  sound: true,
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
//
// ⚠️ AND THE ORDER IS THE RAIL'S, NOT A LIST'S. That claim was false on
// screen: the eye read 01 → 03 → 02 → 05 → 04, because CELL·03 stood ABOVE
// PEER·02 on the mesh rail, and a count-off that zig-zags teaches nothing
// (report A, A-7). The right rail is swapped — PEER·02 over CELL·03 — so the
// mesh half now counts down the way it is read.
//
// ⚠️ THE BOTTOM STACK IS NOT, and the difference is the user's D-17 ruling.
// DAO·05 above ECG·04 is a position somebody chose; renumbering the two to
// tidy the count-off would move identities that live in memory notes, tests
// and the PANELS menu for the sake of one ritual. **The codes are identities,
// not positions.** What this order is, then, is the module registry read in
// its own order — which the rail now agrees with for the pair where agreeing
// cost one line of JSX.
// ⚠️ `sound` is deliberately absent: the count-off lights the panels the HUD
// itself brings up, and the chip is neither on a rail nor drawn by this file.
const BOOT_MODULE_ORDER: readonly HudPanelId[] = [
  'chain', 'peers', 'cells', 'pulse', 'dao', 'stage', 'render',
];
/** One module per beat, and the beat is `HUD_MOTION.flip` — a module coming
 *  up is a state change with no travel, which is the rung's whole definition.
 *  Seven beats plus the reveal the last one takes to finish arriving lands the
 *  ritual just inside 1.1s; a default boot (STAGE·07 / GL·08 off) counts to
 *  four and is done in well under a second. It was 130, ten off the rung and
 *  a number nothing else in the HUD wore (E1). */
const BOOT_SLOT_MS = HUD_MOTION.flip;

// ——— Boot readout linger ————————————————————————————————————
/** How long the finished boot sequence keeps the top slot after its last line
 *  ticks over. The whole trail lit is the only frame in which a visitor can see
 *  what actually happened while they waited, and on a fast local boot that
 *  frame would otherwise last a few milliseconds. Nothing waits on it — the
 *  galaxy has been on screen behind the band since `first_light`. Skipped
 *  entirely under reduced motion, where a banner that outstays its state is
 *  just a banner that will not leave. */
const BOOT_READOUT_LINGER_MS = HUD_MOTION.linger;

/** Does this session want the ritual at all? Read once, synchronously, from
 *  the same query `useReducedMotion` seeds itself with — that hook answers on
 *  the first committed frame now (E2), so this could read the hook; it does
 *  not, because the ritual is a decision the session makes ONCE and a hook
 *  that flips mid-session would restart a count-off that is already over.
 *  `bootRitual` below is what tracks the live setting.
 *
 *  ⚠️ Not `mediaQueryMatches` inverted: no `matchMedia` at all (jsdom, an
 *  ancient browser) is not a request for stillness, and the helper answers
 *  `false` for "cannot ask" — which would read here as "wants motion stopped".
 *  Spelled out rather than negated. */
function prefersFullMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function HudOverlay({ chain, peers, localNode, hostedName, cellsStats, stageScripts, cellPopulation, cellCount, cellCapacity, enrichmentSource, assetEcosystem, protocolEra, daoState, activityFeed, transactionHorizon, networkAtlas, scriptRegistry, scriptFamilyCensus, backfill, streamHealth, build, topBarActions, colonyCount, producerView, onSoundVisibleChange, onCameraFrame }: {
  chain: ChainEntry; peers: Peer[]; localNode: ChainNode | undefined; cellsStats: CellsStats;
  /** Public service name; the tab continues to report the observed tip. */
  hostedName?: string;
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
  scriptFamilyCensus?: ScriptFamilyCensusRecord | null;
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
  /** SND·06's switch, because the module it names is mounted by the app.
   *  The registry stays here — one list, one menu, one "diverged" reading —
   *  and this is the one entry whose flag has to travel back out. */
  onSoundVisibleChange?: (visible: boolean) => void;
  /** Measured rail footprint, available before the scene's first paint and
   *  updated only for viewport or user-selected panel-layout changes. */
  onCameraFrame?: (frame: HudCameraFrame) => void;
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
  // The fullscreen startup layer hands off on the first completed main-scene
  // draw. Diagnostic phases may continue afterwards (fabric, data plane,
  // first-light smoothness), but they must not suppress normal runtime bands.
  const bootReadoutVisible = !boot.viewPresented && (boot.active || bootLingering);

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
  // narrows and scrolls instead of fanning. Tunable breakpoint, and the RAIL'S
  // alone: it used to fold the top bar as well, next to a flat `1280px` query
  // that existed so "the control-dense top bar reflows before the panel rail
  // does". That was an ordering wish rather than a measurement, and it is what
  // folded every iPad but the 13" in landscape — the strip's one row wants
  // ~1,079 px and an 11" iPad hands it 1,194. The strip has its own reason to
  // fold now, and it reads it off the row (below).
  const narrowRail = useMediaQuery('(max-width: 1100px)');
  // …and at a width of its own the rails themselves collapse: the mesh panels
  // drop to a header, a hero and one row, and CKB·01's three lower sections
  // fold to their headers and their counts. Its own query rather than a share
  // of the top bar's: what the strip does with its controls and what a rail
  // does with a stage are two decisions, and they will not always break at one
  // number.
  //
  // The number is DERIVED and not chosen (`RAILS_COLLAPSE_MAX_WIDTH_PX`,
  // 1,523 px today). The first cut of this rule was a flat `1280px`, picked
  // because 1,280 was the laptop stage the round put in scope; but what a rail
  // owes the stage is not a screen size, it is a clearance. A card stands
  // BESIDE the cell it points at, and it can only do that if the stage between
  // the rails can hold card + tether + margin. So the rails collapse exactly
  // when they would otherwise take that away — at `25c7d5a` a 1,440 px page
  // left 710 px of stage for a 728 px card, and the card had nowhere to be but
  // on top of a rail.
  //
  // ⚠️ It is a step, and an honest reading owns it: two rail measures and one
  // threshold mean the stage GROWS by 164 px as the page narrows past 1,524,
  // and the card's own ladder answers that by going wide again. Any collapse
  // rule with two fixed measures has that step somewhere; this one puts it
  // where the alternative is a composition that does not exist — below the
  // threshold a card cannot stand beside its cell at all — rather than where
  // the only loss is some clear stage.
  const railsCollapsed = useMediaQuery(RAILS_COLLAPSE_QUERY);
  // Phones get a third priority row so display/quality controls never depend
  // on an initially hidden horizontal-scroll position.
  const mobileTopBar = useMediaQuery('(max-width: 560px)');
  // ——— And the top bar folds for want of room, which is a measurement ———
  //
  // `useStatusStripFold` owns the rule and argues it in full; what happens
  // here is that the overlay renders the strip a second time as a hidden
  // PROBE (below), hands the hook the probe's box and its own — the strip
  // spans this root, so the root's `clientWidth` is the room the row has —
  // and folds when what the row wants no longer fits. Until a box has been
  // laid out the hook answers with the estimate, which is the same query the
  // boot band in `index.html` runs, so the band and the strip stand at the
  // same height across the handover.
  //
  // ⚠️ `mobileTopBar` still ORs in, and it is not the same kind of statement.
  // The phone layout is three priority rows in a different order — a design
  // for a touch screen, not an answer to a fit question — so it stays a media
  // query and wins over the measurement.
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRailRef = useRef<HTMLDivElement>(null);
  const stripProbeRef = useRef<HTMLDivElement>(null);
  const stripEstimate = useMediaQuery(STATUS_STRIP_FOLD_ESTIMATE_QUERY);
  const stripFolded = useStatusStripFold(stripProbeRef, rootRef, stripEstimate);
  const compactTopBar = mobileTopBar || stripFolded;
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
  // ——— One clock, and it is the galaxy's ————————————————————————————————
  //
  // The count-off used to start the moment the HUD mounted — when the SNAPSHOT
  // had decoded, before the GL context existed — so the instrument finished
  // "coming up" three to four seconds before the thing it instruments appeared
  // (report E, E-3: the canvas at +1.0 s, the band gone at +5.2 s, the ritual
  // over by +0.9 s). Two count-offs ran at once in two vocabularies: module
  // codes on the rails, phase names in the band, neither reading the other.
  //
  // So the rails wait until the current Canvas has actually presented, with
  // FIRST LIGHT retained as the older smooth-frame diagnostic exit. A panel
  // saying CKB·01 IS UP while the stage behind it is still black would make
  // the instrument lie about its own state.
  //
  // ⚠️ AND IT NEVER WAITS FOREVER, which took two conditions rather than one.
  // A HUD that joined after the page was up sees a record that is no longer
  // active — but a FAILED boot keeps `active` true for the session on purpose
  // ("a boot that reported a fault never completes"), so a record-only gate
  // would leave every panel ghosted for as long as the tab is open. Any fault
  // ends the wait too: the galaxy is not coming, and a HUD that refuses to
  // light is a worse answer than one that lights early.
  const galaxyLit = boot.phases.some(
    (phase) => phase.id === 'first_light' && phase.state === 'done',
  );
  const bootFaulted = boot.phases.some((phase) => phase.state === 'failed');
  const bootWaiting = bootRitual && !boot.viewPresented && boot.active
    && !galaxyLit && !bootFaulted;
  const bootCounting = bootRitual && !bootWaiting && bootLit < bootRoster.length;
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
    const lit = !(bootCounting || bootWaiting) || slot < 0 || slot < bootLit;
    const { opacity, transition } = revealStageStyle(lit);
    return { ...base, opacity, transition, pointerEvents: lit ? base?.pointerEvents : 'none' };
  };

  // Menu order is module-number order — the codes ARE the registry, so the
  // list reads 01→08 regardless of which rail a panel docks on, and ·06 is in
  // it: the Jukebox chip is app-side but it wears a module code, and a
  // registry that skips one of its own numbers is a registry with a hole in
  // it. Memoized on the
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
      defaultVisible: DEFAULT_PANEL_VISIBILITY.chain,
    },
    {
      id: 'peers',
      code: 'PEER·02',
      label: 'PEER MESH',
      visible: panelVisibility.peers,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.peers,
    },
    {
      id: 'cells',
      code: 'CELL·03',
      label: 'CELL MESH',
      visible: panelVisibility.cells,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.cells,
    },
    {
      id: 'pulse',
      code: 'ECG·04',
      label: 'PULSE',
      visible: panelVisibility.pulse,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.pulse,
    },
    ...(daoPanelAvailable ? [{
      id: 'dao',
      code: 'DAO·05',
      label: 'NERVOS DAO',
      visible: panelVisibility.dao,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.dao,
    }] : []),
    {
      id: 'sound',
      code: 'SND·06',
      label: 'JUKEBOX',
      visible: panelVisibility.sound,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.sound,
    },
    {
      id: 'stage',
      code: 'STAGE·07',
      label: 'STAGE SAMPLE',
      visible: panelVisibility.stage,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.stage,
    },
    {
      id: 'render',
      code: 'GL·08',
      label: 'RENDER STATS',
      visible: panelVisibility.render,
      defaultVisible: DEFAULT_PANEL_VISIBILITY.render,
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
  const cameraLayoutKey = `${railsCollapsed}:${HUD_PANEL_IDS.filter((id) => panelVisibility[id]).join(',')}`;
  useHudCameraFrame(rootRef, leftRailRef, railRef, cameraLayoutKey, onCameraFrame);
  const [railScrolls, setRailScrolls] = useState(false);
  const prevCond = useRef<EcgCondition>('FINE');
  const churn = useCellChurn(chain.tip, cellsStats.born, cellsStats.dead);

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

  // ——— A reorg is an event, and an event needs a depth and a dwell ————————
  //
  // Two things were wrong with `chain.reorgs - previous` and they were wrong in
  // opposite directions (report E, E-8). It measured how many reorg EVENTS
  // landed in one batch, which is 1 for every real reorg — so the ramp's upper
  // rungs could not be reached and every one-block fork raised the full band.
  // And the count was caught up in an effect after the commit, so the alarm it
  // raised lived exactly one render: 109 sub-second amber blinks in one
  // session's history, not one of them a designed alarm.
  //
  // The delta stays, because it is what says an event HAPPENED — a `reorgs`
  // that went up is a witness, and nothing else in the entity is. What the
  // depth comes from is the reducer's own subtraction against `from_block`.
  // A snapshot that arrives with a higher count and no depth is not a witness
  // to anything, so it reads as the shallowest reorg there is.
  const prevReorgs = useRef(chain.reorgs);
  const reorgDepth = chain.reorgs > prevReorgs.current
    ? Math.max(1, chain.last_reorg_depth ?? 1)
    : 0;

  // Both walk `peers` (with allocations/sorts); key them on their actual
  // inputs instead of recomputing for unrelated overlay updates.
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
  // …and the dwell, which is the other half: `useHeldAlert` keeps whatever this
  // computes on screen for `HUD_MOTION.hold` before it is allowed to fall, and
  // lets an escalation past immediately.
  const alert = useHeldAlert(alertLevel({ ecg: condition, reorgDepth, syncing }));
  const syncRatio = chain.best_known_block > 0 ? Math.min(1, chain.tip / chain.best_known_block) : 1;

  // Two bands, one stack — and the geometry lives here, below the alert, because
  // it is the alert that everything under the top slot has to clear.
  //
  // ⭐ AND THE BAND IS NOT PART OF IT. It used to be: whichever banner stood in
  // the slot pushed both rails down by its 30px and let them spring back when
  // it stopped speaking. On an ordinary cold start that is one 30px jump of the
  // whole HUD somewhere around fifty seconds in — the composing chapter's
  // settle clock re-arms on every convergence burst (`boot/stageCompose.ts`),
  // so the band stands for the whole window and then leaves — and it moves TIP,
  // EPOCH and every other number out from under a reader's eye at the one
  // moment nothing at all is happening. The band is chrome over the stage now
  // (`TopBand.tsx` draws it so it can pass over a rail and land as nothing), so
  // the rails stand where they stand and nothing they hold ever moves for it.
  //
  // The alarm is the second band and was the half nobody carried: the bar knew
  // to sit under a banner, and nothing knew to sit under the bar. It is also
  // the ONE tenant of this corner that still moves the content, and it should:
  // a raised alarm is the news, not chrome over it, and it is the surface a
  // reader must not have to look behind. So its height comes from the bar
  // itself, and whether it is standing comes from the same predicate the bar
  // uses to decide it renders at all — the layout and the band can then never
  // disagree about whether the slot is occupied.
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
  /** Something is standing in the top slot, whichever tenant is speaking. The
   *  rails no longer ask — but the alarm does, because it is the second band in
   *  a stack of two and has to sit under whichever one is there. */
  const topBandVisible = bootReadoutVisible || stageComposingVisible;
  /** Where the alarm stands: on the band's shoulders when one is speaking, on
   *  the strip's when none is. One expression, read by the bar that draws there
   *  and by the rails that clear it, so the two can never disagree. */
  const alarmTop = topBarHeight
    + (topBandVisible || streamInterrupted ? TOP_BAND_HEIGHT : 0);
  /** …and where the instruments begin: 12px under the last thing that claims
   *  room. A band claims none. */
  const contentTop = alarmStanding
    ? alarmTop + WARNING_BAR_HEIGHT + 12
    : topBarHeight + 12;
  const railStyle: CSSProperties = narrowRail
    ? { ...MESH_RAIL_STYLE, top: contentTop, maxHeight: viewportMinusSafeArea('height', contentTop + 14), overflowX: 'hidden', overflowY: 'auto', pointerEvents: railScrolls ? 'auto' : 'none', scrollbarWidth: 'thin', scrollbarColor: `${rgba(HUD_COLORS.orange, 0.35)} transparent` }
    : { ...MESH_RAIL_STYLE, top: contentTop };

  // SND·06's flag out to the app that mounts it. An effect and not a render
  // call, because publishing during a render is a write to somebody else's
  // state mid-render; the chip appearing one frame late is invisible and
  // correct.
  useEffect(() => {
    onSoundVisibleChange?.(panelVisibility.sound);
  }, [onSoundVisibleChange, panelVisibility.sound]);

  // ——— THE TAB IS A READOUT TOO ————————————————————————————————————————————
  //
  // The document title was `cknerv`, lowercase, written once in `index.html`
  // and never touched again (report E, E-13) — so a reader with this dashboard
  // in a background tab, which is most of what a chain visualiser is FOR, had
  // no reading at all. The tip is the one number that answers "is it still
  // alive" without switching windows, and it is the same number CKB·01 opens
  // with. Same case, same separator, same `#` the whole HUD spells a height
  // with.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const name = hostedName === undefined ? 'CKNERV' : `CKNERV · ${hostedName}`;
    document.title = `${name} · #${chain.tip.toLocaleString('en-US')}`;
  }, [chain.tip, hostedName]);

  // persist the across-render baselines after each commit
  useEffect(() => { prevReorgs.current = chain.reorgs; }, [chain.reorgs]);
  useEffect(() => { prevCond.current = condition; }, [condition]);

  // Tell the inspector's occlusion reader that the HUD's own boxes moved.
  // Resize and visibility it can see for itself; a React commit it cannot —
  // nothing in the DOM announces one, and the alternative is polling the HUD
  // with `getBoundingClientRect` forever for the handful of moments a panel
  // actually moves. The dependency list is exactly what changes the set of
  // panels or where they start: which modules are on stage, whether the rails
  // are narrow or the top bar compact, how far down the content begins (a
  // banner claiming the top slot moves every panel under it), and the
  // count-off, which brings the panels in one at a time. The reader is
  // rAF-coalesced and does nothing at all while no card is open, so a burst of
  // these costs one measurement or none.
  useEffect(() => {
    invalidateHudOcclusionRects();
  }, [
    panelVisibility,
    daoPanelAvailable,
    narrowRail,
    compactTopBar,
    railsCollapsed,
    contentTop,
    railScrolls,
    bootLit,
  ]);

  /** Everything the strip is told that is not which layout to wear — built
   *  once and spread into both copies, so the probe measures the row the
   *  reader is actually looking at and the two `memo`s see one set of
   *  identities. */
  const stripProps = {
    build,
    cellCount: cellCount ?? cellsStats.inView,
    cellCapacity,
    enrichmentSource,
    actions: topBarActions,
    panelControls,
    onPanelVisibilityChange: setPanelVisible,
  };

  return (
    <div
      ref={rootRef}
      style={ROOT_STYLE}
      data-stream-phase={streamPhase ?? undefined}
      data-hud-boot={bootWaiting ? 'waiting' : bootCounting ? 'counting' : 'done'}
    >
      <div style={SCAN_STYLE} />
      {/* Chrome and safety surfaces are exempt from the ritual: a status
          strip, an alert, a frozen-stream banner and a backfill readout are
          how you find out something is wrong, and nothing that reports a
          fault may be dimmed for style. */}
      {/* One props object, two strips: the one a reader sees and the one the
          fold is measured on. A fresh object per render costs nothing — what
          `memo` compares is the VALUES, and every one of them is a value, a
          record or a callback this body already held by identity, which is
          why a clock tick still reaches neither strip.
          The probe comes AFTER the real strip on purpose: it wears its own
          class and no landmark role, but a document order that put it first
          would still hand the first `[data-status-layout]` or the first
          `.cknerv-status-strip-probe`-adjacent selector to a box nobody can
          see. First in the tree is the strip, always.
          ⚠️ And `topBarActions` is therefore MOUNTED TWICE — once visible,
          once hidden and inert. That is the point (a chip in that slot is one
          of the things that can push the row past its room), and it is a
          contract on the prop: whatever the app puts there must be safe to
          mount twice. */}
      <StatusStrip
        {...stripProps}
        compact={compactTopBar}
        mobile={mobileTopBar}
      />
      <StatusStrip {...stripProps} probe probeRef={stripProbeRef} />
      {/* One voice in the top slot. While the page is coming up the boot
          sequence owns it outright: `CONNECTING DATA PLANE` and the replay
          plate's block count are already lines INSIDE the sequence
          (`data_plane`, `seeding`), and the arrangement they replace was
          measured shouting CONNECTING over a galaxy that had finished
          rendering half a second earlier.
          Once the fullscreen layer hands off, diagnostic phases no longer own
          this slot; stream health and stage composition can report the live
          application even when first-light smoothness is still pending. Like
          the chrome above it this band is exempt from the count-off — it
          reports a state, and nothing that reports a state is dimmed for style. */}
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
      {/* One band, one shift, and the shift is the ALARM's: whichever tenant is
          standing in the slot moves the alert down by its 30px, and they are
          never two at a time. The other half of that rule — this bar's own 34px
          moving everything below it — is `contentTop` above, taken from the bar
          rather than typed again here. Nothing in either number is the band's:
          it is an overlay and clears nobody. */}
      <WarningBar level={alert.level} trigger={alert.trigger} reducedMotion={reduced} top={alarmTop} />
      {chainPanelVisible
      || panelVisibility.stage
      || panelVisibility.render
      || daoPanelVisible
      || panelVisibility.pulse ? (
        <div
          ref={leftRailRef}
          data-hud-left-rail
          style={{ ...LEFT_HUD_STYLE, top: contentTop, maxWidth: viewportMinusSafeArea('width', 28) }}
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
                    scriptFamilyCensus={scriptFamilyCensus}
                    protocolEra={protocolEra}
                    activityFeed={activityFeed}
                    transactionHorizon={transactionHorizon}
                    compactActivity={shortViewport}
                    folded={railsCollapsed}
                    reorgLive={reorgAlertStanding(alert)}
                    style={railsCollapsed ? CHAIN_PANEL_DENSE_STYLE : CHAIN_PANEL_STYLE}
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
                    style={railsCollapsed ? PULSE_PANEL_DENSE_STYLE : PULSE_PANEL_STYLE}
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
                    style={railsCollapsed ? PULSE_PANEL_DENSE_STYLE : PULSE_PANEL_STYLE}
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
          {/* ⭐ PEER·02 STANDS OVER CELL·03, which is a swap and not a
              preference. The eye reads this rail top-down, so the codes on it
              ran 03 then 02 — and the count-off below claims the panels light
              "in module order", which made the ritual zig-zag: top-left,
              right-BOTTOM, right-TOP (report A, A-7). One flex column, one
              line, and the numbers now go down the rail the way they are
              read. The bottom stack keeps its own codes: DAO·05 sitting above
              ECG·04 is a user ruling about where the DAO belongs, and a code
              is an identity that lives in memory notes, tests and the panel
              menu — moving one to make a position tidy is the tail wagging the
              dog (the user's D-17). */}
          {panelVisibility.peers ? (
            <div data-hud-panel="peers" style={bootPanelStyle('peers')}>
              <NetworkPanel summary={summary} consensus={consensus} syncRatio={syncRatio} enrichmentSource={enrichmentSource} networkAtlas={networkAtlas} producers={producerView} dense={railsCollapsed} style={PANEL_FLOW} />
            </div>
          ) : null}
          {panelVisibility.cells ? (
            <div data-hud-panel="cells" style={bootPanelStyle('cells')}>
              <CellsPanel
                stats={cellsStats}
                churn={churn}
                reducedMotion={reduced}
                dense={railsCollapsed}
                style={PANEL_FLOW}
              />
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
