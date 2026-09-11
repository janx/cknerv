// Orchestrator for the Cell consensus-flow overlay.
//
// Pipeline:
//   1. cellsCache changes → maintain ONE neighbour graph over the exact
//      CellGalaxy display subset, then derive a sparse passive graph from it.
//      Everything downstream reads that single graph: a pulse can only exist
//      where the viewer can see the fibre it rides.
//   2. Each new CellLink delta → planPulses departs one packet from each
//      cell the tx consumed (the input anchors' own addresses) and finds
//      shortest paths to the new outputs through the neighbour graph.
//      Each pulse is queued.
//   3. Per frame, every active pulse advances by elapsed/HOP_MS hops,
//      lights up the current hop's edge in the active fabric layer,
//      drives the packet-head glyph, flashes the cells it crosses,
//      and stamps a write seal when it lands on the terminal.

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useConsensusMemoryFocusRef } from '../hooks/consensusMemoryFocusContext';
import { useReducedMotion } from '../components/hud/useReducedMotion';
import {
  markCellFlashDirty,
  type CellFlashDirtyIdsRef,
} from '../components/cellFlash';
import { reportBootGraphApplied } from '../boot/nerveRestGate';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import {
  PERFORMANCE_PROBE_LABELS,
  beginCpuProbe,
  endCpuProbe,
  measureCpuProbe,
} from '../tweaks/performanceProbeStore';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { fabricAllocationEdges } from './fabricCapacity';
import {
  NERVE_SCREEN_BUDGET,
  NERVE_SCREEN_BUDGET_MAX,
  NERVE_SCREEN_BUDGET_MIN,
  passiveEdgeBudget,
} from '../geometry/passiveNeighborGraph';
import {
  LIVE,
  getNerveTuningVersion,
  subscribeNerveTuning,
} from '../tweaks/liveTweaks';
import {
  consumeTopologyJournal,
  createDisplayGraphJournalFeed,
  feedDisplayGraphJournal,
  invalidateTopologyJournal,
} from '../geometry/topologyJournal';
import { fabricStats } from './fabricStats';
import { blockFrameNowMs, blockFrameStats } from './blockFrameStats';
import {
  resolveCellDisplayLimit,
  useCellDisplayRuntime,
} from '../tweaks/cellDisplay';
import {
  emptyLivingNeighborGraph,
  emptyPassiveSelection,
  type LivingNeighborGraph,
  type PassiveSelection,
} from '../geometry/neighborGraph';
import { createNeighborGraphBuilder } from '../geometry/neighborGraphBuilder';
import {
  cellRenderClampActive,
  createCellRenderMapState,
  createCellRenderSetState,
  resolveStagedCell,
  syncCellRenderMap,
  syncCellRenderSet,
} from '../geometry/cellRenderSet';
import {
  type Pulse,
  type PulseOrigin,
  type PulsePlanningOptions,
} from './pulseRunner';
import {
  ghostLegDurationMs,
  makePulseLegHead,
  PULSE_LEG_GHOST,
  pulseLegArrivalMs,
  pulseLegExtinguishes,
  pulseLegHeadInto,
  pulseTerminalArrivalMs,
} from './pulseSchedule';
import {
  evictPulseOverflow,
  openLinkBatch,
  prunePulsesFromBlock,
  scheduleLivePulseStartSec,
  tickBlockIfAdvanced,
} from './pulseBatch';
import {
  LIVE_PLAN_BUDGET_MS,
  createLivePulseQueue,
  enqueueLivePulseBatch,
  livePlanBudgetMs,
  pruneLivePulseQueue,
  stepLivePulseQueue,
  type LivePulseStepContext,
} from './livePulseQueue';
import { pulseStats } from './pulseStats';
import {
  planDisplayMeshDiff,
  planMeshUpdate,
} from './livingMeshDriver';
import {
  FRAME_BUDGET_BRIDGE_STEP,
  FRAME_BUDGET_FABRIC_DRAIN,
  FRAME_BUDGET_PLAN_SLICE,
  beginFrameBudget,
  frameBudgetRemainingMs,
  mayStartFrameWork,
  reserveFrameBudget,
  spendFrameBudget,
} from './frameBudget';
import {
  FABRIC_LANDING_BUDGET_MS,
  createFabricLandingQueue,
  drainFabricLandingQueue,
  enqueueFabricLanding,
  fabricLandingBudgetMs,
  resetFabricLandingQueue,
} from './fabricLandingQueue';
import CellBridgeNerves from './CellBridgeNerves';
import NeuralFabric, {
  makeActiveHopScratch,
  writeActiveHop,
  type NeuralFabricHandles,
} from './NeuralFabric';
import {
  bezierAtInto,
  bezierControlInto,
  fabricEdgeSeed,
} from '../geometry/edgeBezier';
import { consensusRouteHopWorldPosition } from '../derives/consensusRouteCamera.derive';
import { SpikePool } from './spikePool';
import type { Vec3 } from '../types';
import {
  CONSENSUS_PULSE_POLICY,
  consensusMemoryCellResponse,
  consensusMemoryCellResponseForFrame,
  consensusMemoryRouteHopAdjacentSegments,
  consensusMemoryPulseActivityScale,
  consensusMemoryRouteHandoffScale,
  consensusMemoryTraceRouteForTarget,
  consensusMemoryTraceReadout,
  consensusMemoryTraceReadoutChanged,
  consensusMemoryTraceReadoutInto,
  cloneConsensusMemoryTraceReadout,
  makeConsensusMemoryTraceReadoutScratch,
  makeConsensusMemoryTraceReadoutSignature,
  consensusMemoryTraceRequestKey,
  consensusMemoryTraceResonance,
  consensusMemoryTraceEntryScale,
  consensusMemoryTraceFocusStrength,
  deriveConsensusMemoryTraceFocus,
  validateConsensusMemoryRouteHopFocus,
  planConsensusMemoryTrace,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceOutcome,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryCellResponse,
  type ConsensusMemoryCellResponseRef,
  type ConsensusMemoryEvidenceResponse,
  type ConsensusMemoryTargetResponse,
  type ConsensusPulseMode,
} from './consensusMemoryTrace';
import ConsensusMemoryMarkers from './ConsensusMemoryMarkers';
import ConsensusRouteHopMarker from './ConsensusRouteHopMarker';
import {
  advanceConsensusMemorySourceHandoffTime,
  consensusMemorySourceHandoffActive,
  consensusMemorySourceHandoffEvidenceScale,
  consensusMemorySourceHandoffLockScale,
  consensusMemorySourceHandoffRouteFlareScale,
  reconcileConsensusMemorySourceHandoff,
  type ConsensusMemorySourceHandoff,
  type ConsensusMemorySourceHandoffSide,
} from './consensusMemorySourceHandoff';
import {
  CONSENSUS_MEMORY_TRACE_RELEASE_SECONDS,
  consensusMemoryTraceShapeKey,
  consensusMemoryTraceVisualRouteHopFocus,
  consensusMemoryTraceReleaseStrength,
  deriveConsensusMemoryTraceReentryFocus,
  deriveConsensusMemoryTraceReleaseEnvelope,
  deriveConsensusMemoryTraceReleaseFocus,
  type ConsensusMemoryTraceReleaseEnvelope,
} from './consensusMemoryTraceContinuity';
import {
  deriveConsensusMemoryRecordBridge,
  deriveConsensusMemoryRecordParkFocus,
} from './consensusMemoryRecordBridge';
import {
  CONSENSUS_MEMORY_NEAR_PRESENTATION,
  deriveConsensusMemoryDistancePresentation,
} from './consensusMemoryDistancePresentation';
import { deriveConsensusMemoryAperture } from './consensusMemoryAperture';
import {
  CONSENSUS_ROUTE_HOP_PULSE_FRAME_PRIORITY,
  advanceConsensusMemoryRouteHopPulseClock,
  deriveConsensusMemoryRouteHopPulseEdges,
  type ConsensusMemoryRouteHopPulseClock,
} from './consensusRouteHopPulse';
import type { Cell } from '@cknerv/types';

const SPIKE_POOL_CAPACITY = 1024;

/** Soft cap on concurrent pulses. Anything above this drops oldest
 *  first — keeps the visual coherent during burst-block activity.
 *  Exported as the authority ui-app's runtime-config default mirrors. */
export const MAX_ACTIVE_PULSES = 256;

/** Wavefront glyph scale. Live writes use the pale data lozenge; historical
 *  recall uses a smaller segmented phase knot. The curve carries the route. */
const SPIKE_SIZE = 1.6;
const SPIKE_ALPHA = 4.5;

/** Brightness multiplier on the lit fabric for the head hop (the
 *  one currently being traversed). The fabric brightness gradient
 *  inside that hop already decays exponentially from the wavefront,
 *  so this is just the overall intensity. */
const HOP_HEAD_BRIGHT = 2.2;
/** Multiplier for the trailing hops (already-traversed). Falls off
 *  exponentially with hop age — see HOP_TAIL_DECAY. */
const HOP_TAIL_BRIGHT = 1.4;
/** Per-hop decay factor for the trailing wake. trail_brightness =
 *  HOP_TAIL_BRIGHT × exp(-ageHops × HOP_TAIL_DECAY). */
const HOP_TAIL_DECAY = 0.65;
/** How many past hops still glow behind the leading hop. */
const TRAIL_HOPS = 5;
/** Full recalled route afterimage, below the travelling wavefront energy. */
const MEMORY_RESONANCE_BRIGHT = 1.35;
/** Broad afterimage rather than the tight travelling-wave tail. */
const MEMORY_RESONANCE_TAIL_DECAY = 0.65;
/** Lift inspected edges above recall afterimage without becoming a write flash. */
const MEMORY_ROUTE_HOP_INSPECT_BRIGHT = 2.05;
const MEMORY_ROUTE_HOP_INSPECT_TAIL_DECAY = 0.18;
/** Narrow address echo converging on a click-locked route Cell. */
const MEMORY_ROUTE_HOP_LOCK_PULSE_BRIGHT = 2.8;
const MEMORY_ROUTE_HOP_LOCK_PULSE_TAIL_DECAY = 6.5;
/** Brief route-wide glow used only while one verified source replaces another. */
const MEMORY_SOURCE_HANDOFF_FLARE_BRIGHT = 1.18;
const MEMORY_SOURCE_HANDOFF_FLARE_TAIL_DECAY = 0.42;
const RIPPLE_STAGGER_MS = 60;      // per-birth grow-in delay within a block
/** Shared empties for living-mesh calls that carry only one lifecycle side —
 *  a removal batch never reads the Cell map, a birth batch never removes. */
const NO_CELLS: ReadonlyMap<number, Cell> = new Map();
const NO_CELL_IDS: readonly number[] = Object.freeze([] as number[]);

interface NeuralNetworkProps {
  /** Server projection cap used by CellGalaxy's AUTO display budget. Passive
   * fibres resolve the same budget so hidden Cells never leave visible hair. */
  cellCapacity?: number;
  cellFlashRef?: React.RefObject<Map<number, number>>;
  flashDirtyRef?: React.MutableRefObject<boolean>;
  flashDirtyIdsRef?: CellFlashDirtyIdsRef;
  burstArrivalRef?: React.RefObject<Map<number, { firedAt: number; color: Vec3 }>>;
  topology?: {
    neighborK?: number;
    maxEdgeLength?: number;
    maxHops?: number;
  };
  pulses?: PulsePlanningOptions & {
    maxActivePulses?: number;
  };
  /**
   * Scene-time delay applied only to newly observed live links. The dashboard
   * aligns this with the local carrier's Cell-field contact; standalone
   * consumers default to immediate live traffic.
   */
  livePulseDelayS?: number;
  /** Shared camera-distance focus; affects only the passive fabric layer. */
  cellDetailViewFocusRef?: { readonly current: number };
  /** Explicit user-requested replay of one retained historical link. */
  traceRequest?: ConsensusMemoryTraceRequest | null;
  /** Optional recall-only route cap; live traffic keeps its own pulse budget. */
  traceMaxPulses?: number;
  /** Keep a quiet old record while the user maps a different selected Cell. */
  traceHoldForRecordSwitch?: boolean;
  /** Reports completion or invalidation so UI active state can exit safely. */
  onTraceComplete?: (
    request: ConsensusMemoryTraceRequest,
    outcome: ConsensusMemoryTraceOutcome,
  ) => void;
  /**
   * Publishes semantic target-stage changes from the authoritative route clock.
   * This is intentionally low-frequency: frame-level convergence stays in R3F.
   */
  onTraceReadoutChange?: (readout: ConsensusMemoryTraceReadout | null) => void;
  /** Frame-level target response shared with secondary render roots. */
  traceTargetResponseRef?: ConsensusMemoryCellResponseRef;
  /** One verified routed source isolated by the evidence ledger. */
  traceEvidenceFocusSourceId?: number | null;
  /** One verified Cell address inside that source's exact retained route. */
  traceRouteHopFocus?: ConsensusMemoryRouteHopFocus | null;
  /** Click-locked hop only; hover preview must not stamp a spatial glyph. */
  traceRouteHopLock?: ConsensusMemoryRouteHopFocus | null;
  /** Mirror target-signature inspection into the evidence ledger only. */
  onTraceAgreementPreviewChange?: (sourceId: number | null) => void;
  /** Switch a target agreement signature onto its verified source route. */
  onTraceRouteHopLockChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
}

interface ActivePulse extends Pulse {
  startSec: number;
  mode: ConsensusPulseMode;
  /** Replay identity; live traffic deliberately has no historical key. */
  traceKey?: string;
  /** Visual-only exit envelope for an already verified memory packet. */
  release?: ConsensusMemoryTraceReleaseEnvelope & {
    evidenceScale: number;
    routeHandoffScale: number;
  };
  /** ② Highest hop index already reinforced, so each edge a pulse crosses
   *  bumps its vein's usage exactly once (the head hop only advances). */
  lastReinforcedHop?: number;
  /** Leading `origin.pos → path[0]` leg, resolved once at admission. Absent
   *  on pulses with no origin (memory traces, rim rescues), which then keep
   *  the pre-ghost schedule byte for byte. */
  ghost?: ActivePulseGhost;
}

/** The ghost leg a metabolic packet departs on. BOTH ends are values: the
 *  origin cell is already dead, and re-reading `path[0]` from a stage that
 *  may have dropped it would let the one leg with no recovery vanish
 *  mid-flight. `path[0]`'s address never moves, so caching it changes
 *  nothing but the failure mode. */
interface ActivePulseGhost {
  /** Duration (ms), the fabric's own stride scaled by the leg's length. */
  ms: number;
  /** The cell this packet left. Held here rather than read back off the
   *  pulse so that "a ghost has an origin" is a fact of the type. */
  origin: PulseOrigin;
  /** `path[0]`'s world address at admission. */
  to: Vec3;
}

/** Resolve a planned pulse's ghost leg against the map its route was planned
 *  on. Absent when the pulse names no origin; absent too if `path[0]` is not
 *  in that map, in which case the packet flies the pre-ghost schedule rather
 *  than one built on a guessed address. */
function resolvePulseGhost(
  pulse: Pulse,
  cells: ReadonlyMap<number, Cell>,
): ActivePulseGhost | undefined {
  const origin = pulse.origin;
  if (!origin) return undefined;
  const entry = cells.get(pulse.path[0])?.pos_seed;
  if (!entry) return undefined;
  const to: Vec3 = [entry[0], entry[1], entry[2]];
  const ghostLen = Math.hypot(
    to[0] - origin.pos[0],
    to[1] - origin.pos[1],
    to[2] - origin.pos[2],
  );
  return { ms: ghostLegDurationMs(pulse.hopMs, ghostLen), origin, to };
}

function NeuralNetwork({
  cellCapacity,
  cellFlashRef,
  flashDirtyRef,
  flashDirtyIdsRef,
  burstArrivalRef,
  topology,
  pulses,
  livePulseDelayS = 0,
  cellDetailViewFocusRef,
  traceRequest = null,
  traceMaxPulses,
  traceHoldForRecordSwitch = false,
  onTraceComplete,
  onTraceReadoutChange,
  traceTargetResponseRef,
  traceEvidenceFocusSourceId = null,
  traceRouteHopFocus = null,
  traceRouteHopLock = null,
  onTraceAgreementPreviewChange,
  onTraceRouteHopLockChange,
}: NeuralNetworkProps = {}) {
  const simClock = useSimClock();
  const reducedMotion = useReducedMotion();
  const invalidate = useThree((state) => state.invalidate);
  const cellsCache = useCellGalaxy();
  const sharedTraceFocusRef = useConsensusMemoryFocusRef();
  const { effective: quality } = useQualityRuntime();
  const cellDisplayRuntime = useCellDisplayRuntime();
  const cellDisplayLimit = resolveCellDisplayLimit(
    cellDisplayRuntime,
    cellCapacity,
    cellsCache.displayBudget?.cells,
  );
  // The nerve screen budget and selection shares are live-tunable (backtick
  // panel). LIVE mutates in place, so the version counter is the change
  // signal; a change flows into displaySelectionKey below and schedules one
  // incremental display rebuild.
  const nerveTuningVersion = useSyncExternalStore(
    subscribeNerveTuning,
    getNerveTuningVersion,
    getNerveTuningVersion,
  );
  const {
    screenBudget: nerveScreenBudget,
    coverageShare: nerveCoverageShare,
    trunkShare: nerveTrunkShare,
    twigShare: nerveTwigShare,
  } = useMemo(
    () => ({ ...LIVE.nerve }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version stamps the in-place LIVE mutation
    [nerveTuningVersion],
  );
  // The server display plane owns the nerve screen budget when it streams
  // one (`displayBudget.nerveEdges`); the module constant remains the
  // fallback for old servers. A live-tuned knob (moved off its default)
  // keeps priority — tuned behavior is unchanged.
  const serverNerveEdges = cellsCache.displayBudget?.nerveEdges;
  const effectiveNerveScreenBudget =
    nerveScreenBudget === NERVE_SCREEN_BUDGET
    && serverNerveEdges !== undefined
    && Number.isFinite(serverNerveEdges)
      ? Math.max(
        NERVE_SCREEN_BUDGET_MIN,
        Math.min(NERVE_SCREEN_BUDGET_MAX, Math.floor(serverNerveEdges)),
      )
      : nerveScreenBudget;
  const resolvedNerveBudget = passiveEdgeBudget(
    cellDisplayLimit,
    effectiveNerveScreenBudget,
  );
  // Fabric GPU allocation quantizes the resolved nerve budget to discrete
  // classes; a short settle keeps a live-tuning drag from remounting the
  // fabric at every class boundary it sweeps through. The remount (React
  // key below) is the sanctioned allocation rebuild: one mount always
  // holds exactly one allocation.
  const targetAllocationEdges = fabricAllocationEdges(resolvedNerveBudget);
  const [fabricAllocation, setFabricAllocation] = useState(targetAllocationEdges);
  useEffect(() => {
    if (targetAllocationEdges === fabricAllocation) return undefined;
    const settle = setTimeout(
      () => setFabricAllocation(targetAllocationEdges),
      400,
    );
    return () => clearTimeout(settle);
  }, [targetAllocationEdges, fabricAllocation]);
  const particleCapMul = QUALITY_PRESETS[quality].particleCapMul;
  const topologyKey = `${topology?.neighborK ?? ''}:${topology?.maxEdgeLength ?? ''}`;
  // Spatial topology alone decides the graph; the passive selection on top of
  // it additionally re-selects when the nerve tuning moves, so a knob drag
  // rethins the fibres without paying for a kNN rebuild.
  const displaySelectionKey = `${topologyKey}|n${resolvedNerveBudget}`
    + `:c${nerveCoverageShare}:t${nerveTrunkShare}:w${nerveTwigShare}`;

  // One graph, built over the exact CellGalaxy display subset and maintained
  // incrementally between builds. The passive layer is a SELECTION from it —
  // a bounded grown arbor plus a small deterministic cross-link sample — not a
  // second graph, so a lit hop and the fibre under it can never disagree.
  //
  // Live changes stay incremental. Full rebuilds run in a latest-only Worker
  // for bootstrap, recovery, or explicit topology changes; doing them on every
  // birth would continually cancel useful topology work.
  const passiveGraphRef = useRef<PassiveSelection>(emptyPassiveSelection());
  /** The fabric half of every landed build, waiting for frames to apply it.
   * The landing task keeps the graph swap (a consumer reading the version has
   * to find the graph there); the grow/kill it selects drains from here under
   * a per-frame wall budget, because the two together were one 48 ms task and
   * a task cannot yield to itself. The consecutive-delta streak that fires the
   * periodic reconcile lives INSIDE the queue, with the work it counts. */
  const fabricLandingQueueRef = useRef(createFabricLandingQueue());
  /** The display graph version whose kills, grows and reconcile have all been
   * applied to the fabric — `-1` until the first build lands. Published for
   * the layers that must not read a selection the fabric has not caught up
   * with yet; a remount, which rehydrates the fabric wholesale, carries it
   * straight to the newest enqueued version. */
  const fabricLandedVersionRef = useRef(-1);
  /** What the last drain cost, in wall milliseconds — the estimate the frame's
   * shared heavy-work ledger is asked with. Seeded at the queue's own budget
   * floor, then measured; a drain that has never run cannot be predicted by
   * anything better than what it is allowed to spend. */
  const fabricDrainCostMsRef = useRef<number>(FABRIC_LANDING_BUDGET_MS);
  /** Mirror of `displayGraphVersion` readable inside the landing microtask,
   * so the queued item can name the version it will have landed. */
  const displayGraphVersionRef = useRef(0);
  /** O(churn) topology journals for the two graph builders (Step B):
   * accumulated per cache generation, handed to build() and cleared
   * speculatively at issuance — every failure path (supersession, worker
   * loss, sync fallback) funnels through the worker generation check into a
   * full re-pack, so lost entries can never corrupt topology. The feed
   * consumes the server display journal (entered→upserts, exited→removes,
   * updated→upserts), falling back to the canonical cache journal when no
   * display plane is present. */
  const displayFeedRef = useRef(createDisplayGraphJournalFeed());
  /** Bumped whenever a (re)mounted fabric rehydrates via onFabricReady.
   * A build response may apply a selection DELTA only when no rehydration
   * happened since the previous response was applied — a remount between
   * responses rebuilds the fabric from the then-current ref, and a delta on
   * top of that stale base would drift silently (the allocation-remount /
   * response race clipped the fabric at the old class in live testing). */
  const fabricEpochRef = useRef(0);
  const fabricEpochAppliedRef = useRef(0);
  /** Adjacency only, plus the eager mesh's undo log; a chained worker build
   * PATCHES this object in place (the result's `graph` is then this same
   * object), a whole build replaces it. */
  const displayGraphRef = useRef<LivingNeighborGraph>(emptyLivingNeighborGraph());
  const displayCellsRef = useRef<Map<number, Cell>>(new Map());
  /** Immutable render-set publication belonging to the landed graph. Bridge
   * syncs can span frames, so they must not iterate the stage Map that the
   * next cache generation patches before its worker result lands. */
  const displayBridgeCellsRef = useRef<readonly Cell[]>([]);
  /** Same generation as `displayBridgeCellsRef`, with an owned edge array:
   * chained worker landings patch the live passive selection in place. */
  const displayBridgePassiveRef = useRef<PassiveSelection>({ edges: [] });
  /** Version tag committed after both immutable bridge inputs above. */
  const displayBridgeVersionRef = useRef(0);
  const displayRenderSetRef = useRef(createCellRenderSetState());
  /** The staged id→Cell map the topology builder packs, kept in step with
   * the cursor above at O(churn). Only used while the staged list is not
   * simply the retained canonical map (see the resolve below); a generation
   * spent in that regime resolves through one rebuild on the way back. */
  const displayCellMapRef = useRef(createCellRenderMapState());
  const fabricHandlesRef = useRef<NeuralFabricHandles | null>(null);
  const displayTopologyRef = useRef('');
  const displayTopologyVersionRef = useRef(-1);
  const displayBootstrappedRef = useRef(false);
  const displayBuildGenerationRef = useRef(0);
  const displayRequestedCellsRef = useRef<Map<number, Cell> | null>(null);
  const displayRequestedTopologyRef = useRef('');
  const displayRequestedTopologyVersionRef = useRef(-1);
  const displayGraphBuilder = useMemo(() => createNeighborGraphBuilder({
    recoveryBudgetMs: () => (
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 0
        : frameBudgetRemainingMs(FRAME_BUDGET_BRIDGE_STEP)
    ),
    recoverySpendMs: (elapsedMs) => {
      spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, elapsedMs);
    },
  }), []);
  /** Bumped when a display build swaps the graph pulses ride, so link batches
   *  that arrive in the same commit plan against the graph that just landed. */
  const [displayGraphVersion, setDisplayGraphVersion] = useState(0);

  useEffect(() => () => {
    displayBuildGenerationRef.current += 1;
    // `releaseWorker` ends the Worker thread and its retained session while
    // leaving the builder usable, which React Strict Mode's development-only
    // setup→cleanup→setup effect replay needs (`dispose` is terminal — every
    // later build would resolve null).
    displayGraphBuilder.releaseWorker();
    displayRequestedCellsRef.current = null;
    displayRequestedTopologyVersionRef.current = -1;
  }, [displayGraphBuilder]);

  const syncDisplayFabric = useCallback(() => {
    // Accumulate this cache generation into the display-graph journal
    // BEFORE consuming the render set, so a build issued below carries the
    // exact O(churn) change set (StrictMode re-runs dedupe by token).
    const feed = feedDisplayGraphJournal(displayFeedRef.current, cellsCache);
    const meshNow = simClock.elapsedSec;
    const meshOpts = {
      k: topology?.neighborK,
      maxEdgeLength: topology?.maxEdgeLength,
    };
    // Eager living-mesh maintenance of the display graph, replayed from the
    // same generation the journal above accumulated. `chained` is the licence:
    // a broken chain means the next build re-bases the graph wholesale, so
    // replaying a partial diff onto it would drift silently.
    const meshDiff = (
      feed.fresh && feed.chained && displayBootstrappedRef.current
    )
      ? (feed.regime === 'display'
        ? planDisplayMeshDiff(
          cellsCache.displayChanges,
          displayGraphRef.current,
          (id) => resolveStagedCell(cellsCache, id),
        )
        // No server display plane: membership is a prefix of the retained map,
        // so the cell journal already IS this graph's lifecycle diff.
        : cellsCache.cellChanges)
      : null;
    // Removals run AHEAD of the topology gate below. A member dying does not
    // change membership, so no build is issued for it — yet its fibres have to
    // retract now. Births are admitted further down, where the render set that
    // resolves them exists.
    if (meshDiff && (meshDiff.died.length > 0 || meshDiff.evicted.length > 0)) {
      const removal = planMeshUpdate(
        { born: NO_CELL_IDS, died: meshDiff.died, evicted: meshDiff.evicted },
        displayGraphRef.current,
        NO_CELLS,
        meshNow,
        meshOpts,
        RIPPLE_STAGGER_MS,
      );
      if (removal.deathKeys.length > 0) {
        fabricHandlesRef.current?.killEdges(
          removal.deathKeys,
          meshNow,
          'death',
          removal.deathEndByKey,
        );
      }
    }
    const renderUpdate = syncCellRenderSet(
      displayRenderSetRef.current,
      cellsCache,
      cellDisplayLimit,
    );
    const visibleCells = renderUpdate.cells;
    // Fallback full coverage: the display list IS the canonical map's cells,
    // so reuse the retained Map instead of materialising a copy per block.
    // Under a display plane membership mixes residents in, so the staged
    // list keeps its own map — PATCHED from the update above rather than
    // rebuilt, which is why it is resolved here and not past the gates
    // below: those skip generations whose list still moved, and the patch
    // has to see every one of them (a skipped generation is detected and
    // costs one rebuild, but that is the cost this exists to avoid).
    const displayPlaneActive = cellsCache.displayBudget !== null;
    const displayCells =
      !displayPlaneActive && visibleCells.length === cellsCache.cells.size
        ? cellsCache.cells
        : syncCellRenderMap(displayCellMapRef.current, renderUpdate);
    const topologyChanged = (
      !displayBootstrappedRef.current
      || displayTopologyRef.current !== displaySelectionKey
      || displayTopologyVersionRef.current !== renderUpdate.topologyVersion
    );

    // A canonical birth that the plane does not stage changes nothing here:
    // membership is what this graph is built from, so an unchanged stage must
    // not rebuild it and restart every fibre lifecycle.
    if (!topologyChanged) return;

    const requestedCells = displayRequestedCellsRef.current;
    const requestMatches = (
      requestedCells !== null
      && displayRequestedTopologyRef.current === displaySelectionKey
      && displayRequestedTopologyVersionRef.current
        === renderUpdate.topologyVersion
    );
    if (requestMatches) return;

    // The manual display-limit clamp truncates the staged list, so the
    // journal below describes churn this build cannot express (see the
    // cellsJournal branch).
    const clampActive = cellRenderClampActive(cellsCache, cellDisplayLimit);
    // Admit this generation's newborns into the display graph on the exact
    // map the build below packs, closing the window between the delta and
    // the worker completion. Graph-only: resting fibres still grow from the
    // authoritative passive selection, so an edge the selection never
    // confirms is never rendered. A bucketed grid answers every birth from
    // its 3×3 neighbourhood, so the whole batch is admitted eagerly however
    // large — there is no longer a size past which newborns wait unroutable
    // for the worker (and its endpoint-missing tail) to land.
    if (
      meshDiff
      && meshDiff.born.length > 0
    ) {
      planMeshUpdate(
        { born: meshDiff.born, died: NO_CELL_IDS, evicted: NO_CELL_IDS },
        displayGraphRef.current,
        displayCells,
        meshNow,
        meshOpts,
        RIPPLE_STAGGER_MS,
      );
    }
    // The map moves with the graph it defines, at request time rather than
    // at completion. A pulse planned this tick targets cells born this tick,
    // and its hops resolve their geometry from here — waiting for the worker
    // would extinguish exactly the pulses a new block just created.
    // Membership only ever moves here: a generation the gates above skipped
    // could not have changed the staged ids (that is what versions the
    // topology), so the patch it applied to the map replaced Cell VALUES
    // whose id and pos_seed are unchanged by construction.
    displayCellsRef.current = displayCells;
    const requestedTopologyVersion = renderUpdate.topologyVersion;
    displayRequestedCellsRef.current = displayCells;
    displayRequestedTopologyRef.current = displaySelectionKey;
    displayRequestedTopologyVersionRef.current = requestedTopologyVersion;
    const generation = displayBuildGenerationRef.current + 1;
    displayBuildGenerationRef.current = generation;
    void displayGraphBuilder.build(displayCells, {
      topology: {
        k: topology?.neighborK,
        maxEdgeLength: topology?.maxEdgeLength,
      },
      includePassive: true,
      // The resolved screen budget and shares ride every request: the
      // worker holds its own module instances, so the panel's LIVE values
      // can only reach the selection through here.
      passiveEdgeBudget: resolvedNerveBudget,
      passiveTuning: {
        coverageShare: nerveCoverageShare,
        trunkShare: nerveTrunkShare,
        twigShare: nerveTwigShare,
      },
      // Under a display plane the journal is a valid delta feed — the
      // server display journal describes the staged membership churn
      // exactly, so a full pack happens only on bootstrap/reset/chain
      // breaks. The two TRUNCATED-PREFIX regimes are the exception, and
      // both invalidate: the manual clamp under a plane, and partial
      // canonical coverage without one. Their windows are prefixes of a
      // membership the journal describes in full, so a delta would patch
      // a base the clamp never reached.
      cellsJournal: (displayPlaneActive && !clampActive)
        || displayCells === cellsCache.cells
        ? consumeTopologyJournal(displayFeedRef.current.journal)
        : invalidateTopologyJournal(displayFeedRef.current.journal),
      preferredEdges: passiveGraphRef.current.edges,
      recoveryCells: visibleCells,
      // Read at completion: a chained response PATCHES both in place — the
      // display adjacency node by node, the passive list as a sorted merge —
      // so per-block churn costs O(changed) and no Map, Set or edge record
      // is rebuilt for a node or edge that did not move.
      reuseFrom: () => ({
        graph: displayGraphRef.current,
        passiveGraph: passiveGraphRef.current,
      }),
    }).then((result) => {
      if (
        result === null
        || displayBuildGenerationRef.current !== generation
        || displayRequestedCellsRef.current !== displayCells
        || displayRequestedTopologyRef.current !== displaySelectionKey
        || displayRequestedTopologyVersionRef.current
          !== requestedTopologyVersion
      ) {
        // Nothing landed, so the mark the message handler took has no task to
        // close; leaving it open would measure the NEXT landing from here.
        blockFrameStats.discardLanding();
        return;
      }
      // The GRAPH half of a landed build: the swap, the version bump, and the
      // refs a consumer reads at that version. The fabric half — the delta
      // grow/kill, or the full setFabric reconcile — is enqueued below and
      // drained by the frame loop, because the two together made one task of
      // up to 48 ms and a task cannot yield to itself. Off, the probe returns
      // before any clock read.
      const commitProbe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.fabricCommit);
      const passiveGraph = result.passiveGraph ?? emptyPassiveSelection();
      displayRequestedCellsRef.current = null;
      displayRequestedTopologyVersionRef.current = -1;
      displayGraphRef.current = result.graph;
      displayBridgeCellsRef.current = visibleCells;
      displayBridgePassiveRef.current = { edges: passiveGraph.edges.slice() };
      // The mirror moves with the state, and the queued item is named by it:
      // the setter's value is not readable from inside this microtask, and the
      // fabric's landed version has to be comparable with the very number the
      // graph's consumers are handed.
      const landedVersion = displayGraphVersionRef.current + 1;
      displayBridgeVersionRef.current = landedVersion;
      displayGraphVersionRef.current = landedVersion;
      setDisplayGraphVersion(landedVersion);
      // The boot record's fabric line OPENS here, on the graph landing — and
      // closes in the nerve-rest gate, once the admitted edges have grown and
      // the outer tiers (halo placement, first bridges) are at rest on
      // screen. Not on worker health and not on edges existing: a field too
      // small to wire is still a fabric that finished being built, and a
      // worker that died resolves the same promise from the synchronous
      // fallback. First apply wins, so later builds cost one boolean.
      reportBootGraphApplied();
      passiveGraphRef.current = passiveGraph;
      fabricStats.passiveSelectionEdges = passiveGraph.edges.length;
      // The fabric's WIDTH tier is a property of the whole drawn selection,
      // and the queued delta below never hands the layer that selection — so
      // it is published here, on every completed build, beside the gauge that
      // measures the same thing. One threshold for the whole selection, so it
      // is a graph fact and belongs on the graph half of the landing.
      fabricHandlesRef.current?.setTrunkTier(passiveGraph);
      // Already set at request time; re-asserted here because the guards
      // above are what prove THIS response is the live one.
      displayCellsRef.current = displayCells;
      displayTopologyRef.current = displaySelectionKey;
      displayTopologyVersionRef.current = requestedTopologyVersion;
      const wasBootstrapped = displayBootstrappedRef.current;
      displayBootstrappedRef.current = true;
      // Selection deltas from the worker session let ordinary per-block
      // churn skip the O(selection) full-set diff. A delta is only applicable
      // over the base it was stated against: an unbootstrapped display has no
      // such base, and a dirty epoch means the fabric remounted and rehydrated
      // from the published selection since the last landing. Either way the
      // item lands as one full setFabric instead — which is also what the
      // queue counts as the reconcile that clears its delta streak.
      const delta = result.passiveDelta;
      const epochClean =
        fabricEpochRef.current === fabricEpochAppliedRef.current;
      fabricEpochAppliedRef.current = fabricEpochRef.current;
      // O(1): the item holds references to the arrays the worker already
      // produced. Nothing is translated, allocated per edge, or handed to the
      // fabric here — that is precisely the work this task no longer does.
      enqueueFabricLanding(fabricLandingQueueRef.current, {
        version: landedVersion,
        cells: displayCells,
        passiveGraph,
        delta: wasBootstrapped && epochClean ? delta : null,
      });
      endCpuProbe(commitProbe);
      invalidate();
      // The worker landing task ends here. This `.then` is a microtask of the
      // very task the worker's message handler opened, so handler entry → here
      // is that task's wall time — now the GRAPH half alone, which is what the
      // gauge has to keep reading for the split to be readable at all.
      blockFrameStats.observeLanding();
    }).catch((error: unknown) => {
      blockFrameStats.discardLanding();
      if (displayBuildGenerationRef.current !== generation) return;
      displayRequestedCellsRef.current = null;
      displayRequestedTopologyVersionRef.current = -1;
      console.error('failed to build Cell display topology', error);
    });
  }, [
    cellDisplayLimit,
    cellsCache.cellChanges,
    cellsCache.cells,
    cellsCache.cellsToken,
    cellsCache.displayBudget,
    cellsCache.displayChanges,
    cellsCache.displayResidents,
    cellsCache.displayToken,
    displayGraphBuilder,
    displaySelectionKey,
    resolvedNerveBudget,
    nerveCoverageShare,
    nerveTrunkShare,
    nerveTwigShare,
    invalidate,
    topology?.neighborK,
    topology?.maxEdgeLength,
  ]);

  useEffect(() => {
    // One opt-in CPU span per cache generation: the journal feed, the eager
    // mesh diff, the render-set sync and the build request together. Off,
    // this is the bare call.
    measureCpuProbe(PERFORMANCE_PROBE_LABELS.syncDisplayFabric, syncDisplayFabric);
  }, [syncDisplayFabric]);

  // Pulse queue. Pulses are removed when their head reaches the
  // terminal cell (or after a generous fallback lifetime).
  const pulsesRef = useRef<ActivePulse[]>([]);
  const sparePulsesRef = useRef<ActivePulse[]>([]);
  const handledLinkPruneRef = useRef(cellsCache.linkPrune);
  const lastLinksSeqRef = useRef<number>(cellsCache.linksSeq);
  // Block-guarantee watermark: the highest height that already produced a
  // pulse (fired or rescued), so a later batch slice of the same block
  // never rescues twice. Rewound by the linkPrune handler on reorgs and
  // reset whenever the evidence archive is wholesale replaced.
  const lastGuaranteedBlockRef = useRef(0);
  const lastLinksEpochRef = useRef(cellsCache.linksEpoch);
  // Opened link batches awaiting their planning slices (see the frame step
  // below). Lives with the instance and is never cleared by an effect: a
  // dependency re-run of the opening effect must not drop a batch a previous
  // run opened, and an unmount takes the queue with it.
  const livePlanQueueRef = useRef(createLivePulseQueue());
  /** What the last planning slice cost — the frame ledger's estimate for this
   * consumer, seeded at the slice's own budget floor. A slice is budget plus
   * one route search, so the measured number is always the honest one. */
  const planSliceCostMsRef = useRef<number>(LIVE_PLAN_BUDGET_MS);
  const livePlanStep = useMemo<LivePulseStepContext>(() => ({
    nowSec: 0,
    nowMs: () => performance.now(),
    budgetMs: LIVE_PLAN_BUDGET_MS,
    stats: pulseStats,
    lastGuaranteedBlock: () => lastGuaranteedBlockRef.current,
    // The only site that admits origin-bearing pulses, so the only site that
    // has to resolve a ghost. The batch carries the map the routes were
    // planned against, so `path[0]` is present there by construction.
    admit: (pulse, batch) => {
      pulsesRef.current.push({
        ...pulse,
        startSec: batch.startSec,
        mode: 'live',
        ghost: resolvePulseGhost(pulse, batch.cells),
      });
    },
    // A batch from a replaced evidence archive still plans (its pair is
    // still a valid stage), but the archive reset zeroed the watermark and
    // an old-chain height must not be written back over that.
    complete: (guaranteed, batch) => {
      if (batch.linksEpoch === lastLinksEpochRef.current) {
        lastGuaranteedBlockRef.current = guaranteed;
      }
    },
  }), []);
  useEffect(() => {
    if (cellsCache.linksEpoch !== lastLinksEpochRef.current) {
      // The evidence archive was wholesale replaced: snapshot hydration
      // re-sequences link seqs from 1, so the cursor's old lineage is
      // meaningless — even when React batches the hydration with the first
      // live link delta and the empty-queue render below is never seen.
      // Rebase to just before the ring head (nothing retained is skipped,
      // nothing gone can read as an eviction gap) and let the guarantee
      // watermark re-learn: the new chain view may sit at lower heights.
      lastLinksEpochRef.current = cellsCache.linksEpoch;
      lastLinksSeqRef.current = Math.max(
        0,
        (cellsCache.pulseLinks[0]?.seq ?? cellsCache.linksSeq + 1) - 1,
      );
      lastGuaranteedBlockRef.current = 0;
    }
    if (cellsCache.pulseLinks.length === 0) {
      // Snapshot hydration (including a lag recovery) replaces the evidence
      // archive but intentionally carries no live events. Rebase the local
      // cursor so historical records can never replay as current traffic.
      lastLinksSeqRef.current = cellsCache.linksSeq;
      return;
    }
    // Do not consume the bounded event queue before there is a graph to route
    // through. The build completion version reruns this effect with the latest
    // queue. Only emptiness has to be gated now — the eager driver keeps the
    // graph current between builds, so it is never merely obsolete.
    if (!displayBootstrappedRef.current) return;
    const newestPulseSeq = cellsCache.pulseLinks.at(-1)?.seq ?? 0;
    if (newestPulseSeq < lastLinksSeqRef.current) {
      // A full snapshot can re-sequence the local evidence archive. WebSocket
      // messages normally render the empty queue first, but recover safely if
      // React batches that snapshot with the first subsequent Link delta.
      lastLinksSeqRef.current = Math.max(
        0,
        (cellsCache.pulseLinks[0]?.seq ?? 1) - 1,
      );
    }
    // Decide which links fire. While a backfill/catch-up is active this fires
    // nothing but still advances the cursor, so the storm is suppressed and
    // the window does not replay when `backfill` clears. The cursor moves
    // NOW; the planning it opens — one route search per origin over the
    // whole stage — is sliced across the following frames by the step
    // below, inside the slack before the packets depart. Drop reasons +
    // per-block rollup are recorded into pulseStats as each link plans.
    const { toFire, nextSeq } = openLinkBatch(
      cellsCache.pulseLinks,
      lastLinksSeqRef.current,
      !!cellsCache.backfill,
      pulseStats,
    );
    lastLinksSeqRef.current = nextSeq;
    if (toFire.length === 0) return;
    // All links in this batch share one clock read — simClock only advances
    // per frame, so stamping once == the prior per-link stamping. Stamped at
    // ARRIVAL, not when a slice gets to the link: however many frames the
    // planning takes, every packet keeps the departure it always had.
    const startSec = scheduleLivePulseStartSec(
      simClock.elapsedSec,
      livePulseDelayS,
    );
    // Sources and routes come from the DISPLAY pair — the staged map and the
    // graph built from it. A pulse only reads as consensus flow if the viewer
    // can see the fibre it rides, and the retained map holds four cells
    // off-stage for every one on it. Pairing them also makes residents
    // routable: they are most of the stage and `cellsCache.cells` never held
    // them at all. The pair is captured HERE, at request time, BY REFERENCE:
    // a chained build patches this graph's adjacency in place (and the staged
    // map is patched in place too), so a slice that plans after a build lands
    // searches the landed graph — live edges only, never one the build just
    // removed. Only a whole rebuild replaces the object, leaving a batch
    // opened before it on the graph it captured; the frame loop validates
    // every hop against the live graph either way.
    enqueueLivePulseBatch(
      livePlanQueueRef.current,
      toFire,
      displayCellsRef.current,
      displayGraphRef.current,
      {
        maxHops: topology?.maxHops,
        maxPulsesPerLink: pulses?.maxPulsesPerLink,
        maxOriginsPerLink: pulses?.maxOriginsPerLink,
      },
      startSec,
      cellsCache.linksEpoch,
    );
    // A demand-driven canvas has to keep rendering until the batch closes.
    invalidate();
  }, [
    cellsCache.pulseLinks,
    cellsCache.linksSeq,
    cellsCache.linksEpoch,
    cellsCache.backfill,
    topology?.maxHops,
    pulses?.maxPulsesPerLink,
    pulses?.maxOriginsPerLink,
    livePulseDelayS,
    invalidate,
    displayGraphVersion,
  ]);

  // User-driven historical recall. It prefers retained spent inputs and falls
  // back to explicitly-labelled parent siblings only after those inputs leave
  // the cache. `memory` policy forbids reinforcement, Cell flashes, and seals.
  const lastTraceKeyRef = useRef<string | null>(null);
  const activeTraceRequestRef = useRef<ConsensusMemoryTraceRequest | null>(null);
  const traceFocusRef = useRef<ConsensusMemoryTraceFocus | null>(null);
  const [traceFocus, setTraceFocus] = useState<ConsensusMemoryTraceFocus | null>(null);
  const traceDistancePresentationRef = useRef(
    CONSENSUS_MEMORY_NEAR_PRESENTATION,
  );
  const departingTraceFocusRef = useRef<ConsensusMemoryTraceFocus | null>(null);
  const [departingTraceFocus, setDepartingTraceFocus] =
    useState<ConsensusMemoryTraceFocus | null>(null);
  const traceAperture = useMemo(
    () => deriveConsensusMemoryAperture(traceFocus, cellsCache.cells),
    [traceFocus, cellsCache.cells],
  );
  const departingTraceAperture = useMemo(
    () => deriveConsensusMemoryAperture(departingTraceFocus, cellsCache.cells),
    [departingTraceFocus, cellsCache.cells],
  );
  const [traceDisplayRouteHopLock, setTraceDisplayRouteHopLock] =
    useState<ConsensusMemoryRouteHopFocus | null>(null);
  const [traceDisplayEvidenceSourceId, setTraceDisplayEvidenceSourceId] =
    useState<number | null>(null);
  const previousRouteHopLockRef = useRef<ConsensusMemoryRouteHopFocus | null>(null);
  const sourceHandoffRef = useRef<ConsensusMemorySourceHandoff | null>(null);
  const sourceHandoffTimeRef = useRef(0);
  const sourceHandoffFrameRef = useRef<number | null>(null);
  const traceReadoutSignatureRef = useRef(
    makeConsensusMemoryTraceReadoutSignature(),
  );
  // Frame-rate readout storage. The published copy is always an owned
  // allocation; this one exists only to answer "did anything change".
  const traceReadoutScratchRef = useRef(
    makeConsensusMemoryTraceReadoutScratch(),
  );
  const traceTargetSnapshotRef = useRef<ConsensusMemoryTargetResponse>({
    targetCellId: -1,
    response: {
      role: 'target',
      strength: 0,
      phase: 0,
      convergence: 0,
      evidence: [],
      evidenceFocusSourceId: null,
    },
  });
  useEffect(() => {
    const previousLock = previousRouteHopLockRef.current;
    const nextState = reconcileConsensusMemorySourceHandoff(
      previousLock,
      traceDisplayRouteHopLock,
      sourceHandoffRef.current,
      0,
      { reducedMotion },
    );
    previousRouteHopLockRef.current = nextState.lock;
    sourceHandoffRef.current = nextState.handoff;
    if (!nextState.changed) return;
    sourceHandoffTimeRef.current = 0;
    if (sourceHandoffFrameRef.current !== null) {
      if (typeof window !== 'undefined') {
        window.cancelAnimationFrame(sourceHandoffFrameRef.current);
      }
      sourceHandoffFrameRef.current = null;
    }
    const sourceHandoff = nextState.handoff;
    if (!sourceHandoff || typeof window === 'undefined') return;
    let previousFrameAtMs = window.performance.now();
    const animateHandoff = (frameAtMs: number) => {
      if (sourceHandoffRef.current !== sourceHandoff) return;
      sourceHandoffTimeRef.current = advanceConsensusMemorySourceHandoffTime(
        sourceHandoff,
        sourceHandoffTimeRef.current,
        (frameAtMs - previousFrameAtMs) / 1_000,
      );
      previousFrameAtMs = frameAtMs;
      invalidate();
      if (sourceHandoffTimeRef.current < sourceHandoff.endsAtSec) {
        sourceHandoffFrameRef.current = window.requestAnimationFrame(animateHandoff);
      } else {
        sourceHandoffFrameRef.current = null;
      }
    };
    invalidate();
    sourceHandoffFrameRef.current = window.requestAnimationFrame(animateHandoff);
  }, [invalidate, reducedMotion, traceDisplayRouteHopLock]);
  useEffect(() => () => {
    if (sourceHandoffFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(sourceHandoffFrameRef.current);
    }
    sourceHandoffFrameRef.current = null;
  }, []);
  useEffect(() => {
    if (!reducedMotion) return;
    departingTraceFocusRef.current = null;
    setDepartingTraceFocus(null);
  }, [reducedMotion]);
  useEffect(() => {
    const focus = traceFocusRef.current;
    if (!focus || !traceRequest) return;
    const sourceId = traceEvidenceFocusSourceId !== null
      && Number.isFinite(traceEvidenceFocusSourceId)
      && focus.sources.some((source) => source.id === traceEvidenceFocusSourceId)
      ? traceEvidenceFocusSourceId
      : null;
    focus.evidenceFocusSourceId = sourceId;
    const validatedRouteHop = validateConsensusMemoryRouteHopFocus(
      focus,
      traceRouteHopFocus,
    );
    focus.routeHopFocus = validatedRouteHop?.sourceId === sourceId
      ? validatedRouteHop
      : null;
    const validatedLock = validateConsensusMemoryRouteHopFocus(
      focus,
      traceRouteHopLock,
    );
    setTraceDisplayEvidenceSourceId(sourceId);
    setTraceDisplayRouteHopLock(validatedLock);
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = focus;
  }, [
    sharedTraceFocusRef,
    traceEvidenceFocusSourceId,
    traceFocus,
    traceRequest,
    traceRouteHopFocus,
    traceRouteHopLock,
  ]);
  const publishTraceTargetResponse = useCallback((
    targetCellId: number | null,
    response: ConsensusMemoryCellResponse | null,
  ) => {
    if (!traceTargetResponseRef) return;
    if (targetCellId === null || response?.role !== 'target') {
      traceTargetResponseRef.current = null;
      return;
    }
    const snapshot = traceTargetSnapshotRef.current;
    snapshot.targetCellId = targetCellId;
    snapshot.response.strength = response.strength;
    snapshot.response.phase = response.phase;
    snapshot.response.convergence = response.convergence;
    snapshot.response.evidenceFocusSourceId = response.evidenceFocusSourceId ?? null;
    const evidence = snapshot.response.evidence as ConsensusMemoryEvidenceResponse[];
    evidence.length = response.evidence?.length ?? 0;
    response.evidence?.forEach((source, index) => {
      const target = evidence[index] ?? {
        sourceId: source.sourceId,
        ordinal: source.ordinal,
        contentHash: source.contentHash,
        convergence: source.convergence,
      };
      target.sourceId = source.sourceId;
      target.ordinal = source.ordinal;
      target.contentHash = source.contentHash;
      target.convergence = source.convergence;
      evidence[index] = target;
    });
    traceTargetResponseRef.current = snapshot;
  }, [traceTargetResponseRef]);
  /** `borrowed` marks frame scratch: it is copied before it can reach React
   *  state, since the next frame overwrites it in place. */
  const publishTraceReadout = useCallback((
    readout: ConsensusMemoryTraceReadout | null,
    borrowed = false,
  ) => {
    if (!onTraceReadoutChange) return;
    if (!consensusMemoryTraceReadoutChanged(
      traceReadoutSignatureRef.current,
      readout,
    )) return;
    onTraceReadoutChange(
      readout && borrowed
        ? cloneConsensusMemoryTraceReadout(readout)
        : readout,
    );
  }, [onTraceReadoutChange]);
  const invalidateMemoryTrace = useCallback((
    request: ConsensusMemoryTraceRequest | null,
  ) => {
    if (request) {
      lastTraceKeyRef.current = consensusMemoryTraceRequestKey(request);
    }
    activeTraceRequestRef.current = null;
    pulsesRef.current = pulsesRef.current.filter(
      (pulse) => pulse.mode !== 'memory',
    );
    departingTraceFocusRef.current = null;
    traceFocusRef.current = null;
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
    publishTraceTargetResponse(null, null);
    setDepartingTraceFocus(null);
    setTraceFocus(null);
    setTraceDisplayEvidenceSourceId(null);
    setTraceDisplayRouteHopLock(null);
    publishTraceReadout(null);
    invalidate();
    if (request) onTraceComplete?.(request, 'unavailable');
  }, [
    invalidate,
    onTraceComplete,
    publishTraceReadout,
    publishTraceTargetResponse,
    sharedTraceFocusRef,
  ]);
  useEffect(() => () => {
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
    publishTraceTargetResponse(null, null);
  }, [publishTraceTargetResponse, sharedTraceFocusRef]);
  const releaseMemoryPulses = useCallback((
    nowSec: number,
    focus: ConsensusMemoryTraceFocus | null,
  ) => {
    const release = deriveConsensusMemoryTraceReleaseEnvelope(nowSec, {
      reducedMotion,
    });
    if (!release) {
      pulsesRef.current = pulsesRef.current.filter(
        (pulse) => pulse.mode !== 'memory',
      );
      return;
    }
    for (const pulse of pulsesRef.current) {
      if (pulse.mode !== 'memory' || pulse.release) continue;
      const sourceId = pulse.path[0] ?? null;
      const targetId = pulse.path[pulse.path.length - 1] ?? null;
      const targetResponse = targetId === null
        ? null
        : consensusMemoryCellResponse(focus, targetId, nowSec);
      pulse.release = {
        ...release,
        evidenceScale: consensusMemorySourceHandoffEvidenceScale(
          sourceId,
          focus?.evidenceFocusSourceId ?? null,
          sourceHandoffRef.current,
          sourceHandoffTimeRef.current,
        ),
        routeHandoffScale: consensusMemoryRouteHandoffScale(
          targetResponse?.role === 'target'
            ? targetResponse.convergence
            : 0,
        ),
      };
    }
  }, [reducedMotion]);
  useLayoutEffect(() => {
    const prune = cellsCache.linkPrune;
    if (!prune || handledLinkPruneRef.current === prune) return;
    handledLinkPruneRef.current = prune;
    pulsesRef.current = prunePulsesFromBlock(
      pulsesRef.current,
      prune.fromBlock,
    );
    // Links still waiting for their planning slice are the same stale
    // evidence: dropped before they can ever be admitted.
    pruneLivePulseQueue(livePlanQueueRef.current, prune.fromBlock);
    // Replayed heights must re-qualify for the block guarantee: rewind the
    // watermark below the rewrite boundary.
    lastGuaranteedBlockRef.current = Math.min(
      lastGuaranteedBlockRef.current,
      prune.fromBlock - 1,
    );

    const activeFocus = traceFocusRef.current;
    if (activeFocus && activeFocus.linkBlock >= prune.fromBlock) {
      invalidateMemoryTrace(activeTraceRequestRef.current);
      return;
    }

    const departingFocus = departingTraceFocusRef.current;
    if (departingFocus && departingFocus.linkBlock >= prune.fromBlock) {
      departingTraceFocusRef.current = null;
      setDepartingTraceFocus(null);
    }
    invalidate();
  }, [cellsCache.linkPrune, invalidate, invalidateMemoryTrace]);
  useEffect(() => {
    if (!traceRequest) {
      lastTraceKeyRef.current = null;
      const completedRequest = activeTraceRequestRef.current;
      const currentFocus = traceFocusRef.current;
      activeTraceRequestRef.current = null;
      publishTraceTargetResponse(null, null);
      publishTraceReadout(null);
      // Cache revisions may rerun this effect while an exit is already fading.
      // Only the active→idle edge may create a new release envelope.
      if (!completedRequest) {
        if (!currentFocus) {
          if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
          setTraceFocus(null);
        }
        return;
      }
      releaseMemoryPulses(simClock.elapsedSec, currentFocus);
      const releaseFocus = deriveConsensusMemoryTraceReleaseFocus(
        currentFocus
          ? { ...currentFocus, routeHopFocus: traceDisplayRouteHopLock }
          : null,
        simClock.elapsedSec,
        { reducedMotion },
      );
      traceFocusRef.current = releaseFocus;
      if (sharedTraceFocusRef) sharedTraceFocusRef.current = releaseFocus;
      setTraceFocus(releaseFocus);
      if (!releaseFocus) {
        setTraceDisplayEvidenceSourceId(null);
        setTraceDisplayRouteHopLock(null);
      }
      return;
    }
    // Preserve the request until there is a graph to recall through. Marking
    // it unavailable against the bootstrap graph would prevent the same key
    // from being retried when the Worker completes.
    if (!displayBootstrappedRef.current) return;
    const key = consensusMemoryTraceRequestKey(traceRequest);
    const link = cellsCache.recentLinks.find(
      (candidate) => candidate.seq === traceRequest.linkSeq,
    );
    if (!link) {
      const alreadyUnavailable = lastTraceKeyRef.current === key
        && activeTraceRequestRef.current === null
        && traceFocusRef.current === null;
      if (alreadyUnavailable) return;
      pulseStats.bumpRecall('link-missing');
      // Missing evidence is not an aesthetic exit. A reorg invalidates the
      // claim immediately, including packets and afterimages already queued.
      invalidateMemoryTrace(traceRequest);
      return;
    }
    if (lastTraceKeyRef.current === key) return;
    // The previous verified route becomes a fading afterimage while the fresh
    // route begins. Live traffic remains in flight and is never rewritten.
    const startSec = simClock.elapsedSec;
    const previousFocus = traceFocusRef.current;
    releaseMemoryPulses(startSec, previousFocus);
    lastTraceKeyRef.current = key;
    activeTraceRequestRef.current = null;

    // Recall rides the same pair as live traffic. A remembered route the
    // viewer cannot see is not a recall, so an old link whose endpoints have
    // left the stage now resolves to no route rather than to one drawn across
    // unrendered space.
    const trace = planConsensusMemoryTrace(
      link,
      displayCellsRef.current,
      displayGraphRef.current,
      {
        maxHops: topology?.maxHops,
        maxPulses: traceMaxPulses ?? pulses?.maxPulsesPerLink,
        targetCellId: traceRequest.targetCellId,
      },
    );
    // Split the failures apart, because they call for different repairs: a
    // recall with no source lost its endpoints to the stage, while one with
    // sources but no route lost the fibres between them.
    pulseStats.bumpRecall(
      trace.pulses.length > 0
        ? 'recalled'
        : trace.sourceKind === 'none'
          ? 'no-source'
          : 'no-route',
    );
    const plannedFocus = deriveConsensusMemoryTraceFocus(trace, startSec, key);
    const recordBridge = deriveConsensusMemoryRecordBridge(
      previousFocus,
      plannedFocus,
      startSec,
      { reducedMotion },
    );
    const focus = plannedFocus
      ? recordBridge?.arrivingFocus
        ?? deriveConsensusMemoryTraceReentryFocus(
          plannedFocus,
          previousFocus,
          startSec,
          { reducedMotion },
        )
      : null;
    if (recordBridge) {
      departingTraceFocusRef.current = recordBridge.departingFocus;
      setDepartingTraceFocus(recordBridge.departingFocus);
    } else if (
      consensusMemoryTraceShapeKey(previousFocus)
      !== consensusMemoryTraceShapeKey(plannedFocus)
    ) {
      departingTraceFocusRef.current = null;
      setDepartingTraceFocus(null);
    }
    traceFocusRef.current = focus;
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = focus;
    setTraceFocus(focus);
    if (!focus) {
      setTraceDisplayEvidenceSourceId(null);
      setTraceDisplayRouteHopLock(null);
      publishTraceTargetResponse(null, null);
      publishTraceReadout(null);
      onTraceComplete?.(traceRequest, 'unavailable');
      return;
    }
    setTraceDisplayEvidenceSourceId(focus.evidenceFocusSourceId);
    setTraceDisplayRouteHopLock(focus.routeHopFocus);
    activeTraceRequestRef.current = traceRequest;
    const targetCellId = traceRequest.targetCellId ?? focus.targetIds[0];
    const initialTargetResponse = targetCellId === undefined
      ? null
      : consensusMemoryCellResponse(focus, targetCellId, startSec);
    publishTraceTargetResponse(targetCellId ?? null, initialTargetResponse);
    publishTraceReadout(targetCellId === undefined
      ? null
      : consensusMemoryTraceReadout(focus, targetCellId, startSec));
    for (const pulse of trace.pulses) {
      pulsesRef.current.push({
        ...pulse,
        startSec,
        mode: 'memory',
        traceKey: key,
      });
    }

    const maxActivePulses = Math.max(
      1,
      Math.floor((pulses?.maxActivePulses ?? MAX_ACTIVE_PULSES) * particleCapMul),
    );
    // Same guarantee-aware shedding as the live-batch site: a recall flood
    // must not evict a pending rescue (some block's only light).
    pulsesRef.current = evictPulseOverflow(pulsesRef.current, maxActivePulses);
  }, [
    traceRequest?.linkSeq,
    traceRequest?.targetCellId,
    traceRequest?.nonce,
    cellsCache.recentLinks,
    cellsCache.cells,
    topology?.maxHops,
    traceMaxPulses,
    pulses?.maxPulsesPerLink,
    pulses?.maxActivePulses,
    particleCapMul,
    invalidate,
    invalidateMemoryTrace,
    onTraceComplete,
    publishTraceReadout,
    publishTraceTargetResponse,
    reducedMotion,
    releaseMemoryPulses,
    displayGraphVersion,
    sharedTraceFocusRef,
    traceDisplayRouteHopLock,
  ]);

  // Dev metric: count every block that arrives (one `pulse` delta each,
  // incl. empty blocks) so pulseStats can derive the per-block silent rate.
  // The first observed value only seeds the ref (it is the bootstrap pulse,
  // not a new block during this session).
  const lastSeenPulseAtRef = useRef<number>(0);
  useEffect(() => {
    lastSeenPulseAtRef.current = tickBlockIfAdvanced(
      cellsCache.lastPulseAtMs,
      lastSeenPulseAtRef.current,
      pulseStats,
    );
  }, [cellsCache.lastPulseAtMs]);

  // One batched glyph pool for the moving protocol packets.
  const spikePool = useMemo(() => new SpikePool(SPIKE_POOL_CAPACITY), []);
  const spikeControl = useMemo(() => new Float32Array(3), []);
  const spikePosition = useMemo(() => new Float32Array(3), []);
  // One scratch head for the whole walk: it touches every active pulse each
  // frame, and a per-pulse result object would allocate at frame rate.
  const legHead = useMemo(() => makePulseLegHead(), []);
  // One scratch hop for every push below (both frame callbacks, which run
  // one after the other and consume it synchronously): a storm frame pushes
  // up to MAX_ACTIVE_PULSES × (head + TRAIL_HOPS) hops, and a literal per
  // push was one object per hop per frame.
  const hopScratch = useMemo(() => makeActiveHopScratch(), []);
  useEffect(() => () => spikePool.dispose(), [spikePool]);

  // NeuralFabric hands us imperative draw handles via onReady.
  const renderedTraceRouteHopLock = consensusMemoryTraceVisualRouteHopFocus(
    traceFocus,
    traceDisplayRouteHopLock,
  );
  const routeHopPulseRef =
    useRef<ConsensusMemoryRouteHopPulseClock | null>(null);

  // Lock acknowledgement is an input response, so it keeps raw wall-clock
  // time even when the replay simulation is paused. Its own tiny layer means
  // clearing it cannot overwrite live writes or recalled-route afterimages.
  // Negative priority publishes the clock before default-priority consumers.
  useFrame(({ clock }, rawDeltaSeconds) => {
    // One clock read per frame, taken FIRST (this subscriber runs at priority
    // −1): it is what lets a landing between two frames be read back as the
    // rAF interval that contained it, and it finalises the gap of a landing
    // the previous frame opened. Allocation-free.
    blockFrameStats.markFrame();
    // ...and the same first-subscriber position opens the frame's shared
    // ledger of heavy block work. Every consumer of it — the drain below, the
    // live-plan slice, the bridge class's step — asks and reports against
    // THIS frame from here on. Three writes, no allocation.
    beginFrameBudget(clock.elapsedTime);
    // Planning runs later at default priority but is the only heavy work with
    // a departure clock. Promise its measured slice before the drain or bridge
    // can spend that room; an empty queue leaves no reservation.
    if (livePlanQueueRef.current.batches.length > 0) {
      reserveFrameBudget(FRAME_BUDGET_PLAN_SLICE, planSliceCostMsRef.current);
    }
    const pulseClock = advanceConsensusMemoryRouteHopPulseClock(
      routeHopPulseRef.current,
      renderedTraceRouteHopLock,
      rawDeltaSeconds,
      reducedMotion,
    );
    routeHopPulseRef.current = pulseClock;

    const handles = fabricHandlesRef.current;
    const currentFocus = traceFocusRef.current;
    if (
      handles
      && pulseClock?.frame.state === 'active'
      && currentFocus
    ) {
      const verified = validateConsensusMemoryRouteHopFocus(
        currentFocus,
        pulseClock.focus,
      );
      const source = verified
        ? currentFocus.sources.find(({ id }) => id === verified.sourceId)
        : null;
      const route = source && verified
        ? consensusMemoryTraceRouteForTarget(source, verified.targetCellId)
        : null;
      const focusStrength = consensusMemoryTraceFocusStrength(
        currentFocus,
        simClock.elapsedSec,
      );
      if (verified && route && focusStrength > 0.001) {
        const cells = displayCellsRef.current;
        const adjacency = displayGraphRef.current.adjacency;
        const distancePresentation = traceDistancePresentationRef.current;
        for (const edge of deriveConsensusMemoryRouteHopPulseEdges(
          verified,
          route.path,
          pulseClock.frame,
        )) {
          if (!cells.has(edge.fromCellId) || !cells.has(edge.toCellId)) continue;
          if (!adjacency.get(edge.fromCellId)?.has(edge.toCellId)) continue;
          handles.pushActiveHop(writeActiveHop(
            hopScratch,
            edge.fromCellId,
            edge.toCellId,
            'lock',
            edge.frontT,
            MEMORY_ROUTE_HOP_LOCK_PULSE_BRIGHT
              * pulseClock.frame.strength
              * focusStrength
              * distancePresentation.routeEnergyScale,
            route.color,
            edge.direction,
            MEMORY_ROUTE_HOP_LOCK_PULSE_TAIL_DECAY,
          ), cells);
        }
      }
    }
    handles?.flushRouteHopPulse();

    // The fabric half of every landed build, applied here instead of inside
    // the worker's message task. Ordered before the live-plan slice (default
    // priority, this callback is −1) so a frame that both drains and plans
    // spends its two budgets in that order rather than racing them, and the
    // budget is read from the interval this frame actually followed. The queue
    // is normally empty: one length check per frame, no allocation.
    const landingQueue = fabricLandingQueueRef.current;
    if (
      landingQueue.items.length > 0
      && handles
      && mayStartFrameWork(
        FRAME_BUDGET_FABRIC_DRAIN,
        fabricDrainCostMsRef.current,
      )
    ) {
      const drainStartedAtMs = blockFrameNowMs();
      drainFabricLandingQueue(landingQueue, {
        handles,
        // Its own budget, capped by what the frame has left for it. The drain
        // is normally the first heavy consumer of a frame and takes the whole
        // of its share — but a 30 Hz frame's quarter-interval is larger than
        // the frame's entire heavy budget, and a drain that spends the plan
        // slice out of its own frame is the trade the ledger exists to
        // refuse. Zero still lands one step: the queue always makes progress.
        budgetMs: Math.min(
          fabricLandingBudgetMs(rawDeltaSeconds * 1000),
          frameBudgetRemainingMs(FRAME_BUDGET_FABRIC_DRAIN),
        ),
        // Drain-time clocks: a birth animates from the frame it enters on,
        // never from the landing it waited behind.
        nowSec: simClock.elapsedSec,
        nowMs: blockFrameNowMs,
      });
      const drainMs = blockFrameNowMs() - drainStartedAtMs;
      fabricDrainCostMsRef.current = drainMs;
      spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, drainMs);
      fabricLandedVersionRef.current = landingQueue.landedVersion;
      // Under a demand frameloop nothing else would ask for the frame that
      // finishes the queue.
      if (landingQueue.items.length > 0) invalidate();
    } else if (landingQueue.items.length > 0) {
      // Nothing landed this frame — a missing fabric, or a frame the ledger
      // held this consumer back on. The queue is not empty, so ask for the
      // next frame rather than waiting for something else to.
      invalidate();
    }
  }, CONSENSUS_ROUTE_HOP_PULSE_FRAME_PRIORITY);

  const onFabricReady = useCallback((handles: NeuralFabricHandles) => {
    fabricHandlesRef.current = handles;
    fabricEpochRef.current += 1;
    // Rehydrate only the bounded passive view; the graph and the staged map
    // it was built from are untouched, so routes in flight keep their footing.
    handles.setFabric(
      passiveGraphRef.current,
      displayCellsRef.current,
      simClock.elapsedSec,
    );
    // The rehydrate above IS the newest enqueued item's outcome — it applies
    // the same published selection — so every queued delta is now a patch
    // against a base that no longer exists. Drop them and carry the landed
    // version forward, or a consumer waiting on it would wait forever.
    resetFabricLandingQueue(fabricLandingQueueRef.current);
    fabricLandedVersionRef.current =
      fabricLandingQueueRef.current.landedVersion;
  }, []);

  // Per-frame planning slice for the opened link batches. Registered BEFORE
  // the pulse walk below, so a packet planned this frame is in the pool
  // before the walk that would move it; on the raw frame rather than the
  // sim frame, because planning is main-thread work, not animation — a
  // paused clock only means no departure can press. Each slice spends a
  // wall-relative budget (a fraction of the last frame interval, floored at
  // `LIVE_PLAN_BUDGET_MS`), always makes progress, and DEFERS the remainder —
  // a batch past its departure margin included — to the next frame rather than
  // draining it in one long grain; no packet is dropped and no departure clock
  // moves. The queue is normally empty: one length check per frame.
  useFrame((_state, delta) => {
    const queue = livePlanQueueRef.current;
    if (queue.batches.length === 0) return;
    // The frame's shared ledger, asked at the TOP of the precedence ladder:
    // this consumer's packets carry departure clocks nothing here may move, so
    // it is charged only against what it has itself spent this frame — the
    // drain and the bridge step cannot push a deadline out of its own frame.
    // What it does owe them is the reporting below, which is how they learn
    // how much of the frame is left.
    if (!mayStartFrameWork(
      FRAME_BUDGET_PLAN_SLICE,
      planSliceCostMsRef.current,
    )) {
      invalidate();
      return;
    }
    const sliceStartedAtMs = blockFrameNowMs();
    // Opt-in CPU span over the slice, taken only on frames that plan, so its
    // mean is a slice mean and not one over the empty frames between.
    const sliceProbe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.livePlanSlice);
    livePlanStep.nowSec = simClock.elapsedSec;
    // Budget from the LAST frame's raw interval: a slower or busier frame may
    // plan more, so a 30 Hz machine spends its departure slack instead of
    // reaching the deadline. `delta` is r3f's raw clock delta, in seconds.
    livePlanStep.budgetMs = livePlanBudgetMs(delta * 1000);
    const report = stepLivePulseQueue(queue, livePlanStep);
    endCpuProbe(sliceProbe);
    const sliceMs = blockFrameNowMs() - sliceStartedAtMs;
    planSliceCostMsRef.current = sliceMs;
    spendFrameBudget(FRAME_BUDGET_PLAN_SLICE, sliceMs);
    // T1 gauges (measurement only): how often a slice was forced past its
    // budget on the departure deadline, and the window's longest planner step.
    if (report.forcedByDeadline) pulseStats.observeForcedByDeadline();
    // T6b: the max carries WHICH step it was and whether the router walked it
    // cold, so an outlier grain names its own cause on a release build.
    pulseStats.observeStepMs(
      report.maxStepMs,
      report.maxStepKind,
      report.maxStepCold,
    );
    if (report.admitted > 0) {
      // Soft cap — drop oldest if we're way over, shedding rescue pulses
      // last (each is some block's only light).
      const maxActivePulses = Math.max(
        1,
        Math.floor(
          (pulses?.maxActivePulses ?? MAX_ACTIVE_PULSES) * particleCapMul,
        ),
      );
      pulsesRef.current = evictPulseOverflow(
        pulsesRef.current,
        maxActivePulses,
      );
    }
    if (report.pending) invalidate();
  });

  // Per-frame: roll every active pulse forward, light up the current
  // hop's edge, push the spike head sprite, flash the receiving
  // cells, then stamp a consensus write seal at the terminal.
  useSimFrame((state) => {
    const activePulseFrameProbe = beginCpuProbe(
      PERFORMANCE_PROBE_LABELS.activePulseFrame,
    );
    try {
      const now = simClock.elapsedSec;
      spikePool.beginFrame();
      const handles = fabricHandlesRef.current;
      // Endpoint geometry for every hop below. Paired with the display graph on
      // purpose: a hop is drawn only where both the fibre and its two cells are
      // on screen, and residents (most of the stage) live only in this map.
      const cells = displayCellsRef.current;
      const departingFocus = departingTraceFocusRef.current;
      if (departingFocus && now >= departingFocus.endsAtSec) {
        departingTraceFocusRef.current = null;
        setDepartingTraceFocus(null);
      }
      let activeFocus = traceFocusRef.current;
      if (
        activeFocus
        && activeTraceRequestRef.current
        && traceHoldForRecordSwitch
        && activeFocus.visualContinuity?.mode !== 'park'
        && now >= activeFocus.endsAtSec - CONSENSUS_MEMORY_TRACE_RELEASE_SECONDS
      ) {
        const parkedFocus = deriveConsensusMemoryRecordParkFocus(
          activeFocus,
          now,
          { reducedMotion },
        );
        if (parkedFocus) {
          activeFocus = parkedFocus;
          traceFocusRef.current = parkedFocus;
          if (sharedTraceFocusRef) sharedTraceFocusRef.current = parkedFocus;
          setTraceFocus(parkedFocus);
        }
      }
      if (activeFocus && now >= activeFocus.endsAtSec) {
        const completedRequest = activeTraceRequestRef.current;
        pulsesRef.current = pulsesRef.current.filter((pulse) => pulse.mode !== 'memory');
        activeTraceRequestRef.current = null;
        traceFocusRef.current = null;
        if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
        publishTraceTargetResponse(null, null);
        setTraceFocus(null);
        setTraceDisplayEvidenceSourceId(null);
        setTraceDisplayRouteHopLock(null);
        publishTraceReadout(null);
        if (completedRequest) onTraceComplete?.(completedRequest, 'complete');
      }
      const currentFocus = traceFocusRef.current;
      const currentRequest = activeTraceRequestRef.current;
      const readoutTargetId = currentRequest?.targetCellId
        ?? currentFocus?.targetIds[0];
      let currentTargetResponse: ConsensusMemoryCellResponse | null = null;
      if (currentFocus && readoutTargetId !== undefined) {
        const response = consensusMemoryCellResponseForFrame(
          currentFocus,
          readoutTargetId,
          now,
        );
        currentTargetResponse = response?.role === 'target' ? response : null;
        if (currentRequest) {
          publishTraceTargetResponse(readoutTargetId, currentTargetResponse);
          publishTraceReadout(
            consensusMemoryTraceReadoutInto(
              traceReadoutScratchRef.current,
              currentFocus,
              readoutTargetId,
              now,
            ),
            true,
          );
        }
      }
      const focusStrength = consensusMemoryTraceFocusStrength(
        traceFocusRef.current,
        now,
      );
      const departingFocusStrength = consensusMemoryTraceFocusStrength(
        departingTraceFocusRef.current,
        now,
      );
      const presentationFocusStrength = Math.max(
        focusStrength,
        departingFocusStrength,
      );
      let memoryCameraDistance = CONSENSUS_MEMORY_NEAR_PRESENTATION.cameraDistance;
      let hasMemoryTarget = false;
      // The live focus, then the departing one — two reads, no pair array
      // (this ran on every frame, pulses or none).
      for (let side = 0; side < 2; side += 1) {
        const candidateFocus = side === 0 ? traceFocusRef.current : departingFocus;
        if (!candidateFocus) continue;
        for (const targetId of candidateFocus.targetIds) {
          const target = cells.get(targetId);
          if (!target) continue;
          const world = consensusRouteHopWorldPosition(
            target.pos_seed,
            galaxyFrame.rotationY,
          );
          const distance = Math.hypot(
            state.camera.position.x - world[0],
            state.camera.position.y - world[1],
            state.camera.position.z - world[2],
          );
          if (!Number.isFinite(distance)) continue;
          hasMemoryTarget = true;
          memoryCameraDistance = Math.max(memoryCameraDistance, distance);
        }
      }
      const distancePresentation = hasMemoryTarget
        ? deriveConsensusMemoryDistancePresentation(memoryCameraDistance)
        : CONSENSUS_MEMORY_NEAR_PRESENTATION;
      traceDistancePresentationRef.current = distancePresentation;

      // Drive growth/decay plus the trace-clock aperture on the persistent
      // fabric layer. Internally gated: no-op when neither can change and
      // nothing has changed since the last commit, so steady state stays free.
      handles?.setRecallAperture(
        traceAperture,
        focusStrength,
        departingTraceAperture,
        departingFocusStrength,
      );
      handles?.setMemoryRouteWidthScale(distancePresentation.routeWidthScale);
      handles?.emitFabric(now);

      // Live adjacency snapshot for this frame. Pulses ride only edges
      // that exist in this graph; when a hop's edge has been dropped
      // (cell GC, rebuild after membership delta, exit from the stage) the
      // pulse — or that individual trail hop — extinguishes. Single
      // calculation path: this is the graph the fabric layer is built from
      // AND the graph the routes were planned on, so the active layer can
      // never light up a fibre that isn't there.
      const adjacency = displayGraphRef.current.adjacency;
      const framePulses = pulsesRef.current;
      const stillActive = sparePulsesRef.current;
      stillActive.length = 0;
      for (const pulse of framePulses) {
        const policy = CONSENSUS_PULSE_POLICY[pulse.mode];
        const releaseScale = pulse.mode === 'memory'
          ? consensusMemoryTraceReleaseStrength(pulse.release, now)
          : 1;
        if (releaseScale <= 0.001) continue;
        const activityScale = consensusMemoryPulseActivityScale(
          pulse.mode,
          presentationFocusStrength,
        );
        const pulseMatchesFocus = pulse.mode === 'memory'
          && pulse.traceKey === currentFocus?.key;
        const recordEntryScale = pulseMatchesFocus
          ? consensusMemoryTraceEntryScale(currentFocus, now)
          : 1;
        const evidenceActivityScale = pulse.mode === 'memory'
          ? pulse.release?.evidenceScale
            ?? (pulseMatchesFocus
              ? consensusMemorySourceHandoffEvidenceScale(
                pulse.path[0] ?? null,
                currentFocus?.evidenceFocusSourceId ?? null,
                sourceHandoffRef.current,
                sourceHandoffTimeRef.current,
              )
              : 1)
          : 1;
        const routeActivityScale = activityScale
          * evidenceActivityScale
          * releaseScale
          * recordEntryScale
          * (pulse.mode === 'memory'
            ? distancePresentation.routeEnergyScale
            : 1);
        // Each pulse has its own start delay (jitter) and hop duration
        // (speed scale). Subtract the delay before checking elapsed.
        const rawElapsedMs = (now - pulse.startSec) * 1000;
        const elapsedMs = rawElapsedMs - pulse.startDelayMs;
        const totalHops = pulse.path.length - 1; // edges, not nodes
        // An empty path is not renderable at all; a one-node path is, because a
        // ghost carries it (the entry node IS the destination). Never index
        // path[-1] either way.
        if (totalHops < 0) continue;
        // Pulse hasn't started yet (still in its jitter delay).
        if (elapsedMs < 0) {
          // A packet that was never visible should not depart after its recall
          // has already been released.
          if (pulse.release) continue;
          stillActive.push(pulse);
          continue;
        }
        const hopMs = pulse.hopMs;
        // The ghost is part of the journey, not an overlay: every hop boundary
        // and the terminal arrival shift by its duration.
        const ghost = pulse.ghost;
        const ghostMs = ghost?.ms ?? 0;
        const head = pulseLegHeadInto(
          legHead,
          totalHops,
          hopMs,
          ghostMs,
          elapsedMs,
        );
        const headHop = head.leg;
        const subT = head.subT;

        // Has the pulse arrived at the terminal cell?
        if (head.arrived) {
          const term = pulse.path[totalHops];
          const arriveAt =
            pulse.startSec
            + (
              pulse.startDelayMs
              + pulseTerminalArrivalMs(totalHops, hopMs, ghostMs)
            ) / 1000;
          if (pulse.mode === 'memory') {
            const resonance = consensusMemoryTraceResonance(
              (now - arriveAt) * 1000,
            );
            if (resonance > 0) {
              stillActive.push(pulse);
              const targetResponse = pulseMatchesFocus && term === readoutTargetId
                ? currentTargetResponse
                : pulseMatchesFocus
                  ? consensusMemoryCellResponseForFrame(currentFocus, term, now)
                  : null;
              const handoffScale = pulse.release?.routeHandoffScale
                ?? consensusMemoryRouteHandoffScale(
                  targetResponse?.role === 'target'
                    ? targetResponse.convergence
                    : 0,
                );
              if (handles) {
                for (let h = 0; h < totalHops; h++) {
                  const fromId = pulse.path[h];
                  const toId = pulse.path[h + 1];
                  if (!cells.has(fromId) || !cells.has(toId)) continue;
                  const hopAdjacency = adjacency.get(fromId);
                  if (!hopAdjacency?.has(toId)) continue;
                  handles.pushActiveHop(
                    writeActiveHop(
                      hopScratch,
                      fromId,
                      toId,
                      'memory',
                      1,
                      MEMORY_RESONANCE_BRIGHT
                        * resonance
                        * handoffScale
                        * routeActivityScale,
                      pulse.color,
                      undefined,
                      MEMORY_RESONANCE_TAIL_DECAY,
                    ),
                    cells,
                  );
                }
              }
            }
            continue;
          }
          if (policy.stampWrite && burstArrivalRef?.current) {
            const prev = burstArrivalRef.current.get(term);
            if (!prev || arriveAt > prev.firedAt) {
              burstArrivalRef.current.set(term, {
                firedAt: arriveAt,
                color: pulse.color,
              });
            }
          }
          // Final cell flash on the terminal too.
          if (policy.flashCells && cellFlashRef?.current) {
            const prev = cellFlashRef.current.get(term) ?? -1e9;
            if (arriveAt > prev) {
              cellFlashRef.current.set(term, arriveAt);
              markCellFlashDirty(term, flashDirtyRef, flashDirtyIdsRef);
            }
          }
          continue; // pulse done
        }

        // Validate the head hop's edge against the live graph. If the
        // pulse is currently flying along a fibre that no longer
        // exists (edge dropped on rebuild, endpoint cell GC'd), the
        // pulse extinguishes — we do NOT push it back into stillActive
        // and we render nothing for this frame. The ghost leg is exempt: it
        // rides no fibre, so no fibre can be taken from it.
        const headFromId = pulse.path[headHop];
        const headToId = pulse.path[headHop + 1];
        if (pulseLegExtinguishes(headHop)) {
          if (!cells.has(headFromId) || !cells.has(headToId)) continue;
          const headAdj = adjacency.get(headFromId);
          if (!headAdj || !headAdj.has(headToId)) continue;
        }

        stillActive.push(pulse);

        // Reinforce the route this packet is traversing — once per edge crossed
        // (headHop only advances). Repeatedly-travelled routes accumulate glow
        // and persist; the fabric self-organizes toward live block/tx flow.
        if (policy.reinforce && headHop > (pulse.lastReinforcedHop ?? -1)) {
          handles?.reinforce(headFromId, headToId);
          pulse.lastReinforcedHop = headHop;
        }

        // For each hop in the visible window, draw the lit Bezier
        // sub-segments. The head hop's wavefront position is `subT`;
        // older hops are fully traversed (frontT = 1) but dimmer with
        // distance from the lead.
        if (handles) {
          // The wake starts one leg earlier when a ghost carried the departure,
          // so the tail still reaches back to the dying cell's own address.
          const firstLeg = ghost ? PULSE_LEG_GHOST : 0;
          for (let h = firstLeg; h <= headHop && h < totalHops; h++) {
            const ageHops = headHop - h;
            if (ageHops > TRAIL_HOPS) continue;
            const isHead = ageHops === 0;
            const frontT = isHead ? subT : 1.0;
            const brightness = isHead
              ? HOP_HEAD_BRIGHT
              : HOP_TAIL_BRIGHT * Math.exp(-ageHops * HOP_TAIL_DECAY);
            if (ghost && h === PULSE_LEG_GHOST) {
              handles.pushActiveHop(
                writeActiveHop(
                  hopScratch,
                  ghost.origin.anchorId,
                  pulse.path[0],
                  pulse.mode,
                  frontT,
                  brightness * routeActivityScale,
                  pulse.color,
                  undefined,
                  undefined,
                  ghost.origin.pos,
                  ghost.to,
                ),
                cells,
              );
              continue;
            }
            const hFromId = pulse.path[h];
            const hToId = pulse.path[h + 1];
            // Trail hops are individually gated — a wake segment over
            // a now-removed edge is dropped rather than rendered over
            // empty space. Head hop already passed the same check
            // above; this is the equivalent check for ageHops > 0.
            if (ageHops > 0) {
              if (!cells.has(hFromId) || !cells.has(hToId)) continue;
              const hAdj = adjacency.get(hFromId);
              if (!hAdj || !hAdj.has(hToId)) continue;
            }
            handles.pushActiveHop(
              writeActiveHop(
                hopScratch,
                hFromId,
                hToId,
                pulse.mode,
                frontT,
                brightness * routeActivityScale,
                pulse.color,
              ),
              cells,
            );
          }
        }

        // Small accent sprite at the wavefront position on the head
        // hop's Bezier (NOT the chord). Sub-segment lighting does most
        // of the work; this just adds a sharp focal point at the lead.
        const onGhost = ghost !== undefined && headHop === PULSE_LEG_GHOST;
        const fromPos = onGhost
          ? ghost.origin.pos
          : cells.get(headFromId)?.pos_seed;
        const toPos = onGhost ? ghost.to : cells.get(headToId)?.pos_seed;
        if (fromPos && toPos) {
          // path[headHop + 1] is path[0] on the ghost leg, and the origin's
          // anchor id stands in for the absent path[-1]: one stable seed per
          // packet, so its bow does not change shape as it flies.
          const seed = fabricEdgeSeed(
            onGhost ? ghost.origin.anchorId : headFromId,
            pulse.path[headHop + 1],
          );
          bezierControlInto(
            spikeControl,
            fromPos[0], fromPos[1], fromPos[2],
            toPos[0], toPos[1], toPos[2],
            seed,
          );
          bezierAtInto(
            spikePosition,
            fromPos[0], fromPos[1], fromPos[2],
            spikeControl[0], spikeControl[1], spikeControl[2],
            toPos[0], toPos[1], toPos[2],
            subT,
          );
          spikePool.pushValues(
            spikePosition[0],
            spikePosition[1],
            spikePosition[2],
            pulse.color,
            pulse.mode === 'memory'
              ? SPIKE_SIZE * 0.74 * distancePresentation.spikeScale
              : SPIKE_SIZE,
            (pulse.mode === 'memory' ? SPIKE_ALPHA * 0.72 : SPIKE_ALPHA)
              * routeActivityScale,
            pulse.mode === 'memory' ? 0.5 : 0.95,
            pulse.mode === 'memory' ? 'memory' : 'packet',
          );
        }

        // Cell flash on the cell we *arrive at* during this hop. Schedule
        // exactly when subT crosses 1 (= when we land on the next cell).
        if (policy.flashCells && cellFlashRef?.current) {
          // path[0] is an arrival like any other once a ghost precedes it.
          const arrivingCellId = pulse.path[headHop + 1];
          const arriveAt =
            pulse.startSec
            + (
              pulse.startDelayMs
              + pulseLegArrivalMs(hopMs, ghostMs, headHop)
            ) / 1000;
          const prev = cellFlashRef.current.get(arrivingCellId) ?? -1e9;
          if (arriveAt > prev) {
            cellFlashRef.current.set(arrivingCellId, arriveAt);
            markCellFlashDirty(
              arrivingCellId,
              flashDirtyRef,
              flashDirtyIdsRef,
            );
          }
        }
      }
      pulsesRef.current = stillActive;
      framePulses.length = 0;
      sparePulsesRef.current = framePulses;

      // A route-ledger hover reads the exact retained route independently of
      // packet progress. Only the one or two live graph edges adjacent to that
      // verified Cell are lifted, so an untraversed or stale edge is never drawn.
      const routeHopFocus = currentFocus?.routeHopFocus ?? null;
      if (handles && currentFocus && focusStrength > 0) {
        const routeForFocus = (candidate: ConsensusMemoryRouteHopFocus) => {
          const verified = validateConsensusMemoryRouteHopFocus(
            currentFocus,
            candidate,
          );
          const source = verified
            ? currentFocus.sources.find(({ id }) => id === verified.sourceId)
            : null;
          const route = source && verified
            ? consensusMemoryTraceRouteForTarget(source, verified.targetCellId)
            : null;
          return verified && route ? { focus: verified, route } : null;
        };
        const pushAdjacentRoute = (
          candidate: ConsensusMemoryRouteHopFocus,
          brightnessScale: number,
        ) => {
          if (brightnessScale <= 0.001) return;
          const resolved = routeForFocus(candidate);
          if (!resolved) return;
          for (const segmentIndex of consensusMemoryRouteHopAdjacentSegments(
            resolved.focus,
            resolved.route.path,
          )) {
            const fromCellId = resolved.route.path[segmentIndex];
            const toCellId = resolved.route.path[segmentIndex + 1];
            if (!cells.has(fromCellId) || !cells.has(toCellId)) continue;
            if (!adjacency.get(fromCellId)?.has(toCellId)) continue;
            handles.pushActiveHop(writeActiveHop(
              hopScratch,
              fromCellId,
              toCellId,
              'memory',
              1,
              MEMORY_ROUTE_HOP_INSPECT_BRIGHT
                * focusStrength
                * brightnessScale
                * distancePresentation.routeEnergyScale,
              resolved.route.color,
              undefined,
              MEMORY_ROUTE_HOP_INSPECT_TAIL_DECAY,
            ), cells);
          }
        };
        const pushRouteFlare = (
          candidate: ConsensusMemoryRouteHopFocus,
          side: ConsensusMemorySourceHandoffSide,
          handoff: ConsensusMemorySourceHandoff,
        ) => {
          const resolved = routeForFocus(candidate);
          if (!resolved) return;
          const segmentCount = resolved.route.path.length - 1;
          for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
            const flareScale = consensusMemorySourceHandoffRouteFlareScale(
              side,
              segmentIndex,
              segmentCount,
              handoff,
              sourceHandoffTimeRef.current,
            );
            if (flareScale <= 0.001) continue;
            const fromCellId = resolved.route.path[segmentIndex];
            const toCellId = resolved.route.path[segmentIndex + 1];
            if (!cells.has(fromCellId) || !cells.has(toCellId)) continue;
            if (!adjacency.get(fromCellId)?.has(toCellId)) continue;
            handles.pushActiveHop(writeActiveHop(
              hopScratch,
              fromCellId,
              toCellId,
              'memory',
              1,
              MEMORY_SOURCE_HANDOFF_FLARE_BRIGHT
                * focusStrength
                * flareScale
                * distancePresentation.routeEnergyScale,
              resolved.route.color,
              undefined,
              MEMORY_SOURCE_HANDOFF_FLARE_TAIL_DECAY,
            ), cells);
          }
        };
        const handoff = sourceHandoffRef.current;
        if (consensusMemorySourceHandoffActive(
          handoff,
          currentFocus.evidenceFocusSourceId,
          sourceHandoffTimeRef.current,
        )) {
          pushAdjacentRoute(
            handoff.from,
            consensusMemorySourceHandoffLockScale(
              'from',
              handoff,
              sourceHandoffTimeRef.current,
            ),
          );
          pushAdjacentRoute(
            handoff.to,
            consensusMemorySourceHandoffLockScale(
              'to',
              handoff,
              sourceHandoffTimeRef.current,
            ),
          );
          pushRouteFlare(handoff.from, 'from', handoff);
          pushRouteFlare(handoff.to, 'to', handoff);
        } else if (routeHopFocus) {
          pushAdjacentRoute(routeHopFocus, 1);
        }
      }

      handles?.flushActive();
      spikePool.endFrame(state.size.height, state.viewport.dpr ?? 1);
    } finally {
      endCpuProbe(activePulseFrameProbe);
    }
  });

  return (
    <>
      <NeuralFabric
        key={fabricAllocation}
        allocationEdges={fabricAllocation}
        onReady={onFabricReady}
        cellDetailViewFocusRef={cellDetailViewFocusRef}
      />
      {/* 次级神经: strokes from fabric-sparse staged Cells into the
          unresolved-population halo. Fed from the same completed build the
          fabric is — hosts are chosen by DRAWN fabric degree, so the two have
          to agree on which build that is — and render-only past that point:
          no route, no pulse, no reinforcement, no inspection, no recall, no
          pick ever traverses one. */}
      <CellBridgeNerves
        cellsRef={displayBridgeCellsRef}
        passiveGraphRef={displayBridgePassiveRef}
        inputVersionRef={displayBridgeVersionRef}
        version={displayGraphVersion}
        fabricLandedVersionRef={fabricLandedVersionRef}
        cellDetailViewFocusRef={cellDetailViewFocusRef}
      />
      <primitive object={spikePool.mesh} />
      <ConsensusMemoryMarkers
        focus={departingTraceFocus}
        evidenceFocusSourceId={departingTraceFocus?.evidenceFocusSourceId ?? null}
        distancePresentationRef={traceDistancePresentationRef}
        recordTransition="departing"
      />
      <ConsensusMemoryMarkers
        focus={traceFocus}
        evidenceFocusSourceId={traceDisplayEvidenceSourceId}
        sourceHandoffRef={sourceHandoffRef}
        sourceHandoffTimeRef={sourceHandoffTimeRef}
        distancePresentationRef={traceDistancePresentationRef}
        recordTransition={
          traceFocus?.visualContinuity?.mode === 'entry'
            ? 'arriving'
            : traceFocus?.visualContinuity?.mode === 'park'
              ? 'parked'
              : 'native'
        }
      />
      <ConsensusRouteHopMarker
        focus={traceFocus}
        lockedHop={renderedTraceRouteHopLock}
        focusedSourceId={traceDisplayEvidenceSourceId}
        pulseClockRef={routeHopPulseRef}
        sourceHandoffRef={sourceHandoffRef}
        sourceHandoffTimeRef={sourceHandoffTimeRef}
        onAgreementPreviewChange={onTraceAgreementPreviewChange}
        onAgreementLockChange={onTraceRouteHopLockChange}
      />
    </>
  );
}

// Memoized for the same reason as CellGalaxy: every prop here is a ref, a
// module constant, a scalar or a memoized value in the dashboard, so a chain
// poll or a stream-health flip changes none of them — and this body is the
// longest of the three roots. Cells still arrive by context, which reaches a
// bailed-out consumer unchanged.
export default memo(NeuralNetwork);
