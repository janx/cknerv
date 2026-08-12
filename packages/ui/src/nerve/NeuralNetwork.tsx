// Orchestrator for the Cell consensus-flow overlay.
//
// Pipeline:
//   1. cellsCache changes → maintain the complete routing graph, then derive
//      a sparse passive graph over the exact CellGalaxy display subset.
//   2. Each new CellLink delta → planPulses derives source cells from
//      parent tx siblings + finds shortest paths to the new outputs
//      through the neighbour graph. Each pulse is queued.
//   3. Per frame, every active pulse advances by elapsed/HOP_MS hops,
//      lights up the current hop's edge in the active fabric layer,
//      drives the packet-head glyph, flashes the cells it crosses,
//      and stamps a write seal when it lands on the terminal.

import {
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
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { galaxyFrame } from '../tweaks/galaxyFrame';
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
  createTopologyJournal,
  feedDisplayGraphJournal,
  feedTopologyJournal,
  invalidateTopologyJournal,
} from '../geometry/topologyJournal';
import { fabricStats } from './fabricStats';
import {
  resolveCellDisplayLimit,
  useCellDisplayRuntime,
} from '../tweaks/cellDisplay';
import { emptyNeighborGraph, type NeighborGraph } from '../geometry/neighborGraph';
import { createNeighborGraphBuilder } from '../geometry/neighborGraphBuilder';
import {
  cellRenderMap,
  createCellRenderSetState,
  syncCellRenderSet,
} from '../geometry/cellRenderSet';
import { type Pulse, type PulsePlanningOptions } from './pulseRunner';
import {
  planLinkBatch,
  prunePulsesFromBlock,
  scheduleLivePulseStartSec,
  tickBlockIfAdvanced,
} from './pulseBatch';
import { pulseStats } from './pulseStats';
import {
  planMeshUpdate,
  shouldBulkRebuildRoutingGraph,
} from './livingMeshDriver';
import NeuralFabric, { type NeuralFabricHandles } from './NeuralFabric';
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
  consensusMemoryRouteHopAdjacentSegments,
  consensusMemoryPulseActivityScale,
  consensusMemoryRouteHandoffScale,
  consensusMemoryTraceRouteForTarget,
  consensusMemoryTraceReadout,
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
import {
  deriveCellInspectionField,
  type CellInspectionField,
} from './cellInspectionField';
import type { Cell } from '@cknerv/types';

const SPIKE_POOL_CAPACITY = 1024;

/** Soft cap on concurrent pulses. Anything above this drops oldest
 *  first — keeps the visual coherent during burst-block activity. */
const MAX_ACTIVE_PULSES = 256;

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
  /** Exact selected Cell used to derive a bounded real-adjacency field. */
  inspectionCellId?: number | null;
  /** Shared with CellGalaxy so body points and passive fibres read one field
   * without duplicating the neighbour graph or triggering React frame state. */
  inspectionFieldRef?: React.MutableRefObject<CellInspectionField | null>;
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
}

export default function NeuralNetwork({
  cellCapacity,
  cellFlashRef,
  flashDirtyRef,
  flashDirtyIdsRef,
  burstArrivalRef,
  topology,
  pulses,
  livePulseDelayS = 0,
  inspectionCellId = null,
  inspectionFieldRef,
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
  // The display graph additionally re-selects when the nerve tuning moves;
  // the routing graph keys on spatial topology alone (tuning never touches
  // routing, so a knob drag must not trigger a kNN rebuild).
  const displaySelectionKey = `${topologyKey}|n${resolvedNerveBudget}`
    + `:c${nerveCoverageShare}:t${nerveTrunkShare}:w${nerveTwigShare}`;

  // The complete neighbour graph is maintained incrementally for causal pulse
  // routing. Passive rendering is deliberately separate: it is rebuilt over
  // the exact CellGalaxy display subset, then thinned to a bounded grown arbor
  // plus a small deterministic cross-link sample. Hidden cache
  // entries therefore cannot leave visible fibres behind.
  //
  // Live changes stay incremental. Full canonical rebuilds run in a latest-
  // only Worker for bootstrap, recovery, or explicit topology changes; doing
  // them on every birth would continually cancel useful topology work.
  const graphRef = useRef<NeighborGraph>(emptyNeighborGraph());
  const passiveGraphRef = useRef<NeighborGraph>(emptyNeighborGraph());
  /** Consecutive delta-applied builds since the last full setFabric
   * reconcile (see the delta path below). */
  const fabricDeltaStreakRef = useRef(0);
  /** O(churn) topology journals for the two graph builders (Step B):
   * accumulated per cache generation, handed to build() and cleared
   * speculatively at issuance — every failure path (supersession, worker
   * loss, sync fallback) funnels through the worker generation check into a
   * full re-pack, so lost entries can never corrupt topology. The display
   * feed consumes the server display journal (entered→upserts, exited→
   * removes, updated→upserts); the routing journal stays on the canonical
   * cache journal. */
  const routingJournalRef = useRef(createTopologyJournal());
  const displayFeedRef = useRef(createDisplayGraphJournalFeed());
  /** Bumped whenever a (re)mounted fabric rehydrates via onFabricReady.
   * A build response may apply a selection DELTA only when no rehydration
   * happened since the previous response was applied — a remount between
   * responses rebuilds the fabric from the then-current ref, and a delta on
   * top of that stale base would drift silently (the allocation-remount /
   * response race clipped the fabric at the old class in live testing). */
  const fabricEpochRef = useRef(0);
  const fabricEpochAppliedRef = useRef(0);
  const displayGraphRef = useRef<NeighborGraph>(emptyNeighborGraph());
  const displayCellsRef = useRef<Map<number, Cell>>(new Map());
  const displayRenderSetRef = useRef(createCellRenderSetState());
  const fabricHandlesRef = useRef<NeuralFabricHandles | null>(null);
  const inspectionFieldSnapshotRef = useRef<CellInspectionField | null>(null);
  const bootstrappedRef = useRef(false);
  const routingGraphReadyRef = useRef(false);
  const routedCellsTokenRef = useRef<object | null>(null);
  const routingTopologyRef = useRef('');
  const displayTopologyRef = useRef('');
  const displayTopologyVersionRef = useRef(-1);
  const displayInspectionCellIdRef = useRef<number | null>(null);
  const displayBootstrappedRef = useRef(false);
  const routingBuildGenerationRef = useRef(0);
  const displayBuildGenerationRef = useRef(0);
  const latestCellsTokenRef = useRef(cellsCache.cellsToken);
  const latestRoutingTopologyRef = useRef(topologyKey);
  const latestInspectionCellIdRef = useRef(inspectionCellId);
  const latestInspectionFieldRef = useRef(inspectionFieldRef);
  const displayRequestedCellsRef = useRef<Map<number, Cell> | null>(null);
  const displayRequestedTopologyRef = useRef('');
  const displayRequestedTopologyVersionRef = useRef(-1);
  const routingGraphBuilder = useMemo(() => createNeighborGraphBuilder(), []);
  const displayGraphBuilder = useMemo(() => createNeighborGraphBuilder(), []);
  const [routingGraphVersion, setRoutingGraphVersion] = useState(0);

  latestCellsTokenRef.current = cellsCache.cellsToken;
  latestRoutingTopologyRef.current = topologyKey;
  latestInspectionCellIdRef.current = inspectionCellId;
  latestInspectionFieldRef.current = inspectionFieldRef;

  useEffect(() => () => {
    routingBuildGenerationRef.current += 1;
    displayBuildGenerationRef.current += 1;
    // `cancel` releases Workers while remaining reusable for React Strict
    // Mode's development-only setup→cleanup→setup effect replay.
    routingGraphBuilder.cancel();
    displayGraphBuilder.cancel();
    displayRequestedCellsRef.current = null;
    displayRequestedTopologyVersionRef.current = -1;
  }, [displayGraphBuilder, routingGraphBuilder]);

  const scheduleRoutingGraphBuild = useCallback((
    cells: ReadonlyMap<number, Cell>,
    cellsToken: object,
    nextTopologyKey: string,
  ) => {
    const generation = routingBuildGenerationRef.current + 1;
    routingBuildGenerationRef.current = generation;
    routingGraphReadyRef.current = false;
    void routingGraphBuilder.build(cells, {
      topology: {
        k: topology?.neighborK,
        maxEdgeLength: topology?.maxEdgeLength,
      },
      // The routing graph always builds from the retained map, so the cache
      // journal applies directly. Packed synchronously inside build();
      // cleared speculatively right after (see journal ref docs).
      cellsJournal: consumeTopologyJournal(routingJournalRef.current),
      // Patch-deserialize against the graph being replaced: unchanged nodes
      // reuse their neighbour Sets, so a per-block completion costs
      // O(changed) instead of O(V+E). The old graph is discarded on swap.
      reuseFrom: () => ({ graph: graphRef.current, passiveGraph: null }),
    }).then((result) => {
      if (
        result === null
        || routingBuildGenerationRef.current !== generation
        || latestCellsTokenRef.current !== cellsToken
        || latestRoutingTopologyRef.current !== nextTopologyKey
      ) return;
      graphRef.current = result.graph;
      routedCellsTokenRef.current = cellsToken;
      routingTopologyRef.current = nextTopologyKey;
      bootstrappedRef.current = true;
      routingGraphReadyRef.current = true;
      setRoutingGraphVersion((version) => version + 1);
    }).catch((error: unknown) => {
      if (routingBuildGenerationRef.current !== generation) return;
      routingGraphReadyRef.current = false;
      console.error('failed to build Cell routing topology', error);
    });
  }, [
    routingGraphBuilder,
    topology?.neighborK,
    topology?.maxEdgeLength,
  ]);

  const syncDisplayFabric = useCallback(() => {
    // Accumulate this cache generation into the display-graph journal
    // BEFORE consuming the render set, so a build issued below carries the
    // exact O(churn) change set (StrictMode re-runs dedupe by token).
    feedDisplayGraphJournal(displayFeedRef.current, cellsCache);
    const renderUpdate = syncCellRenderSet(
      displayRenderSetRef.current,
      cellsCache,
      cellDisplayLimit,
    );
    const visibleCells = renderUpdate.cells;
    const topologyChanged = (
      !displayBootstrappedRef.current
      || displayTopologyRef.current !== displaySelectionKey
      || displayTopologyVersionRef.current !== renderUpdate.topologyVersion
    );
    const inspectionChanged = (
      displayInspectionCellIdRef.current !== inspectionCellId
    );

    // New births append behind the bounded visible prefix in the usual 20K
    // cache. They still join the complete routing graph below, but must not
    // rebuild the unchanged 6K display graph or restart every fibre lifecycle.
    if (!topologyChanged && !inspectionChanged) {
      if (inspectionFieldRef) {
        inspectionFieldRef.current = inspectionFieldSnapshotRef.current;
      }
      return;
    }

    if (topologyChanged) {
      const requestedCells = displayRequestedCellsRef.current;
      const requestMatches = (
        requestedCells !== null
        && displayRequestedTopologyRef.current === displaySelectionKey
        && displayRequestedTopologyVersionRef.current
          === renderUpdate.topologyVersion
      );
      if (requestMatches) return;

      // Fallback full coverage: the display list IS the canonical map's
      // cells, so reuse the retained Map instead of materialising a copy
      // per block. Under a display plane membership mixes residents in, so
      // the staged list always materialises its own map (identity frozen
      // per request for the completion-time guards below).
      const displayPlaneActive = cellsCache.displayBudget !== null;
      const displayCells =
        !displayPlaneActive && visibleCells.length === cellsCache.cells.size
          ? cellsCache.cells
          : cellRenderMap(visibleCells);
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
        // Under a display plane the journal is ALWAYS a valid delta feed —
        // the server display journal describes the staged membership churn
        // exactly, so a full pack happens only on bootstrap/reset/chain
        // breaks. The canonical fallback keeps its old regime: delta at
        // full coverage, explicit invalidation for a truncated prefix
        // (whose churn the cache journal does not describe).
        cellsJournal: displayPlaneActive || displayCells === cellsCache.cells
          ? consumeTopologyJournal(displayFeedRef.current.journal)
          : invalidateTopologyJournal(displayFeedRef.current.journal),
        preferredEdges: passiveGraphRef.current.edges,
        // Patch-deserialize both display CSRs against the graphs being
        // replaced (read at completion): per-block churn touches a small
        // fraction of nodes, so the Set/object churn collapses to O(changed).
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
        ) return;
        const passiveGraph = result.passiveGraph ?? emptyNeighborGraph();
        displayRequestedCellsRef.current = null;
        displayRequestedTopologyVersionRef.current = -1;
        displayGraphRef.current = result.graph;
        passiveGraphRef.current = passiveGraph;
        fabricStats.passiveSelectionEdges = passiveGraph.edges.length;
        displayCellsRef.current = displayCells;
        displayTopologyRef.current = displaySelectionKey;
        displayTopologyVersionRef.current = requestedTopologyVersion;
        const wasBootstrapped = displayBootstrappedRef.current;
        displayBootstrappedRef.current = true;
        const handles = fabricHandlesRef.current;
        // Selection deltas from the worker session let ordinary per-block
        // churn skip the O(selection) full-set diff. The eager living-mesh
        // driver may occasionally grow an edge the final selection never
        // confirms, so every 16th delta application reconciles with one
        // full setFabric — bounded drift, amortized cost.
        const delta = result.passiveDelta;
        const epochClean =
          fabricEpochRef.current === fabricEpochAppliedRef.current;
        fabricEpochAppliedRef.current = fabricEpochRef.current;
        if (
          handles
          && wasBootstrapped
          && epochClean
          && delta !== null
        ) {
          fabricDeltaStreakRef.current += 1;
          if (delta.removed.length > 0) {
            handles.killEdges(
              delta.removed.map((edge) => `${edge.from}:${edge.to}`),
              simClock.elapsedSec,
              'gc',
            );
          }
          if (delta.added.length > 0) {
            const bornAtByKey = new Map<string, number>();
            const dirByKey = new Map<string, 1 | -1>();
            for (const edge of delta.added) {
              const key = `${edge.from}:${edge.to}`;
              bornAtByKey.set(key, simClock.elapsedSec);
              dirByKey.set(key, 1);
            }
            handles.growEdges(delta.added, displayCells, bornAtByKey, dirByKey);
          }
          // Periodic reconcile: while deltas chain, drift can only be EXTRA
          // fabric edges (eager living-mesh growth the selection never
          // confirmed) — missing edges are impossible, so pruning extras
          // replaces the old full re-admission (which cost a 300-500ms
          // admission storm every 16th block at the High tier).
          if (fabricDeltaStreakRef.current >= 16) {
            fabricDeltaStreakRef.current = 0;
            const selectionKeys = new Set<string>();
            for (const edge of passiveGraph.edges) {
              selectionKeys.add(`${edge.from}:${edge.to}`);
            }
            const extras = handles
              .collectLiveEdgeKeys()
              .filter((key) => !selectionKeys.has(key));
            if (extras.length > 0) {
              handles.killEdges(extras, simClock.elapsedSec, 'gc');
            }
          }
        } else {
          fabricDeltaStreakRef.current = 0;
          handles?.setFabric(
            passiveGraph,
            displayCells,
            simClock.elapsedSec,
          );
        }
        const selectedCellId = latestInspectionCellIdRef.current;
        const next = deriveCellInspectionField(result.graph, selectedCellId);
        displayInspectionCellIdRef.current = selectedCellId;
        inspectionFieldSnapshotRef.current = next;
        const targetRef = latestInspectionFieldRef.current;
        if (targetRef) targetRef.current = next;
        fabricHandlesRef.current?.setInspectionField(next);
        invalidate();
      }).catch((error: unknown) => {
        if (displayBuildGenerationRef.current !== generation) return;
        displayRequestedCellsRef.current = null;
        displayRequestedTopologyVersionRef.current = -1;
        console.error('failed to build Cell display topology', error);
      });
      return;
    }

    if (displayRequestedCellsRef.current !== null) {
      displayBuildGenerationRef.current += 1;
      displayRequestedCellsRef.current = null;
      displayRequestedTopologyVersionRef.current = -1;
      displayGraphBuilder.cancel();
    }
    const next = deriveCellInspectionField(
      displayGraphRef.current,
      inspectionCellId,
    );

    displayInspectionCellIdRef.current = inspectionCellId;
    inspectionFieldSnapshotRef.current = next;
    if (inspectionFieldRef) inspectionFieldRef.current = next;
    fabricHandlesRef.current?.setInspectionField(next);
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
    inspectionCellId,
    inspectionFieldRef,
    invalidate,
    topology?.neighborK,
    topology?.maxEdgeLength,
  ]);

  useEffect(() => {
    const cells = cellsCache.cells;
    const now = simClock.elapsedSec;
    const opts = { k: topology?.neighborK, maxEdgeLength: topology?.maxEdgeLength };

    if (!bootstrappedRef.current) {
      if (cells.size === 0) {
        // An authoritative empty snapshot can supersede a populated bootstrap
        // request before it completes. Stop that stale CPU work, then wait for
        // the first populated frame as before.
        routingBuildGenerationRef.current += 1;
        routingGraphBuilder.cancel();
        return;
      }
      scheduleRoutingGraphBuild(cells, cellsCache.cellsToken, topologyKey);
      return;
    }

    if (
      cellsCache.cellChanges.reset
      || routingTopologyRef.current !== topologyKey
    ) {
      scheduleRoutingGraphBuild(cells, cellsCache.cellsToken, topologyKey);
      return;
    }

    const diff = cellsCache.cellChanges;
    feedTopologyJournal(routingJournalRef.current, cellsCache);
    if (routedCellsTokenRef.current === cellsCache.cellsToken) return;
    if (
      !routingGraphReadyRef.current
      || diff.baseToken !== routedCellsTokenRef.current
    ) {
      // React may coalesce multiple external-store updates. A journal is safe
      // only when it starts from the exact Cell Map already represented by the
      // live graph; otherwise rebuild once instead of applying a partial diff
      // across a skipped cache state.
      scheduleRoutingGraphBuild(cells, cellsCache.cellsToken, topologyKey);
      return;
    }

    // The pure driver mutates the routing graph immediately, closing the
    // stale-graph window for pulses. Passive fibres are reconciled below from
    // the authoritative display subset in one animated setFabric diff.
    const bulkRebuild = shouldBulkRebuildRoutingGraph(
      diff.born.length,
      cells.size,
    );
    const update = planMeshUpdate(
      bulkRebuild ? { ...diff, born: [] } : diff,
      graphRef.current,
      cells,
      now,
      opts,
      RIPPLE_STAGGER_MS,
    );
    if (bulkRebuild) {
      // Backfill/high-output batches otherwise scan the entire retained map
      // once per birth. Preserve death keys from the old graph above, then
      // replace routing state with one canonical off-thread spatial rebuild.
      scheduleRoutingGraphBuild(cells, cellsCache.cellsToken, topologyKey);
    } else {
      routedCellsTokenRef.current = cellsCache.cellsToken;
    }
    if (update.deathKeys.length > 0) {
      fabricHandlesRef.current?.killEdges(
        update.deathKeys,
        now,
        'death',
        update.deathEndByKey,
      );
    }

  }, [
    cellsCache.cellChanges,
    cellsCache.cells,
    cellsCache.cellsToken,
    routingGraphBuilder,
    scheduleRoutingGraphBuild,
    topologyKey,
    topology?.neighborK,
    topology?.maxEdgeLength,
  ]);

  useEffect(() => {
    syncDisplayFabric();
  }, [syncDisplayFabric]);

  useEffect(() => () => {
    if (
      inspectionFieldRef
      && inspectionFieldRef.current === inspectionFieldSnapshotRef.current
    ) {
      inspectionFieldRef.current = null;
    }
  }, [inspectionFieldRef]);

  // Pulse queue. Pulses are removed when their head reaches the
  // terminal cell (or after a generous fallback lifetime).
  const pulsesRef = useRef<ActivePulse[]>([]);
  const sparePulsesRef = useRef<ActivePulse[]>([]);
  const handledLinkPruneRef = useRef(cellsCache.linkPrune);
  const lastLinksSeqRef = useRef<number>(cellsCache.linksSeq);
  useEffect(() => {
    if (cellsCache.pulseLinks.length === 0) {
      // Snapshot hydration (including a lag recovery) replaces the evidence
      // archive but intentionally carries no live events. Rebase the local
      // cursor so historical records can never replay as current traffic.
      lastLinksSeqRef.current = cellsCache.linksSeq;
      return;
    }
    // Do not consume the bounded event queue against an obsolete/empty graph.
    // The build completion version reruns this effect with the latest queue.
    if (!routingGraphReadyRef.current) return;
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
    // Decide which links fire + plan their pulses. While a backfill/catch-up
    // is active this returns planned=[] but still advances the cursor, so the
    // storm is suppressed and the window does not replay when `backfill`
    // clears. Drop reasons + per-block rollup are recorded into pulseStats.
    const { planned, nextSeq } = planLinkBatch(
      cellsCache.pulseLinks,
      lastLinksSeqRef.current,
      !!cellsCache.backfill,
      cellsCache.cells,
      graphRef.current,
      {
        maxHops: topology?.maxHops,
        maxPulsesPerLink: pulses?.maxPulsesPerLink,
        maxSourcesPerParent: pulses?.maxSourcesPerParent,
      },
      pulseStats,
    );
    lastLinksSeqRef.current = nextSeq;
    // All links in this synchronous batch share one clock read — simClock only
    // advances per frame, so stamping once == the prior per-link stamping.
    const startSec = scheduleLivePulseStartSec(
      simClock.elapsedSec,
      livePulseDelayS,
    );
    for (const p of planned) {
      pulsesRef.current.push({ ...p, startSec, mode: 'live' });
    }
    // Soft cap — drop oldest if we're way over.
    const maxActivePulses = Math.max(
      1,
      Math.floor((pulses?.maxActivePulses ?? MAX_ACTIVE_PULSES) * particleCapMul),
    );
    if (pulsesRef.current.length > maxActivePulses) {
      const overflow = pulsesRef.current.length - maxActivePulses;
      pulsesRef.current.splice(0, overflow);
    }
  }, [
    cellsCache.pulseLinks,
    cellsCache.linksSeq,
    cellsCache.cells,
    cellsCache.backfill,
    topology?.maxHops,
    pulses?.maxPulsesPerLink,
    pulses?.maxSourcesPerParent,
    pulses?.maxActivePulses,
    livePulseDelayS,
    particleCapMul,
    routingGraphVersion,
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
  const traceReadoutSignatureRef = useRef('none');
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
  const publishTraceReadout = useCallback((
    readout: ConsensusMemoryTraceReadout | null,
  ) => {
    if (!onTraceReadoutChange) return;
    const signature = readout
      ? [
        readout.key,
        readout.targetCellId,
        readout.stage,
        readout.arrivedSourceCount,
        readout.resolvedSourceCount,
        readout.sourceCount,
        ...readout.evidence.map((source) => `${source.sourceId}:${source.state}`),
      ].join(':')
      : 'none';
    if (traceReadoutSignatureRef.current === signature) return;
    traceReadoutSignatureRef.current = signature;
    onTraceReadoutChange(readout);
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
    // Preserve the request until the canonical graph is ready. Marking it
    // unavailable against the bootstrap graph would prevent the same key from
    // being retried when the Worker completes.
    if (!routingGraphReadyRef.current) return;
    const key = consensusMemoryTraceRequestKey(traceRequest);
    const link = cellsCache.recentLinks.find(
      (candidate) => candidate.seq === traceRequest.linkSeq,
    );
    if (!link) {
      const alreadyUnavailable = lastTraceKeyRef.current === key
        && activeTraceRequestRef.current === null
        && traceFocusRef.current === null;
      if (alreadyUnavailable) return;
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

    const trace = planConsensusMemoryTrace(
      link,
      cellsCache.cells,
      graphRef.current,
      {
        maxHops: topology?.maxHops,
        maxPulses: traceMaxPulses ?? pulses?.maxPulsesPerLink,
        targetCellId: traceRequest.targetCellId,
      },
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
    if (pulsesRef.current.length > maxActivePulses) {
      pulsesRef.current.splice(0, pulsesRef.current.length - maxActivePulses);
    }
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
    routingGraphVersion,
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
  useFrame((_, rawDeltaSeconds) => {
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
        const cells = cellsCache.cells;
        const adjacency = graphRef.current.adjacency;
        const distancePresentation = traceDistancePresentationRef.current;
        for (const edge of deriveConsensusMemoryRouteHopPulseEdges(
          verified,
          route.path,
          pulseClock.frame,
        )) {
          if (!cells.has(edge.fromCellId) || !cells.has(edge.toCellId)) continue;
          if (!adjacency.get(edge.fromCellId)?.has(edge.toCellId)) continue;
          handles.pushActiveHop({
            fromCellId: edge.fromCellId,
            toCellId: edge.toCellId,
            mode: 'lock',
            frontT: edge.frontT,
            direction: edge.direction,
            brightness: MEMORY_ROUTE_HOP_LOCK_PULSE_BRIGHT
              * pulseClock.frame.strength
              * focusStrength
              * distancePresentation.routeEnergyScale,
            tailDecay: MEMORY_ROUTE_HOP_LOCK_PULSE_TAIL_DECAY,
            color: route.color,
          }, cells);
        }
      }
    }
    handles?.flushRouteHopPulse();
  }, CONSENSUS_ROUTE_HOP_PULSE_FRAME_PRIORITY);

  const onFabricReady = useCallback((handles: NeuralFabricHandles) => {
    fabricHandlesRef.current = handles;
    fabricEpochRef.current += 1;
    // Rehydrate only the bounded passive view. Causal routing continues to
    // read the complete graphRef and full cache independently.
    handles.setFabric(
      passiveGraphRef.current,
      displayCellsRef.current,
      simClock.elapsedSec,
    );
    handles.setInspectionField(inspectionFieldSnapshotRef.current);
  }, []);

  // Per-frame: roll every active pulse forward, light up the current
  // hop's edge, push the spike head sprite, flash the receiving
  // cells, then stamp a consensus write seal at the terminal.
  useSimFrame((state) => {
    const now = simClock.elapsedSec;
    spikePool.beginFrame();
    const handles = fabricHandlesRef.current;
    const cells = cellsCache.cells;
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
      const response = consensusMemoryCellResponse(
        currentFocus,
        readoutTargetId,
        now,
      );
      currentTargetResponse = response?.role === 'target' ? response : null;
      if (currentRequest) {
        publishTraceTargetResponse(readoutTargetId, currentTargetResponse);
        publishTraceReadout(consensusMemoryTraceReadout(
          currentFocus,
          readoutTargetId,
          now,
        ));
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
    for (const candidateFocus of [traceFocusRef.current, departingFocus]) {
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
    // (cell GC, rebuild after membership delta) the pulse — or that
    // individual trail hop — extinguishes. Single calculation path:
    // the same adjacency the fabric layer is rendering, so the
    // active layer can never light up a fibre that isn't there.
    const adjacency = graphRef.current.adjacency;
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
      if (totalHops <= 0) continue;
      // Pulse hasn't started yet (still in its jitter delay).
      if (elapsedMs < 0) {
        // A packet that was never visible should not depart after its recall
        // has already been released.
        if (pulse.release) continue;
        stillActive.push(pulse);
        continue;
      }
      const hopMs = pulse.hopMs;
      const hopFloat = elapsedMs / hopMs;
      const headHop = Math.floor(hopFloat);
      const subT = hopFloat - headHop;

      // Has the pulse arrived at the terminal cell?
      if (headHop >= totalHops) {
        const term = pulse.path[totalHops];
        const arriveAt =
          pulse.startSec + (pulse.startDelayMs + totalHops * hopMs) / 1000;
        if (pulse.mode === 'memory') {
          const resonance = consensusMemoryTraceResonance(
            (now - arriveAt) * 1000,
          );
          if (resonance > 0) {
            stillActive.push(pulse);
            const targetResponse = pulseMatchesFocus && term === readoutTargetId
              ? currentTargetResponse
              : pulseMatchesFocus
                ? consensusMemoryCellResponse(currentFocus, term, now)
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
                  {
                    fromCellId: fromId,
                    toCellId: toId,
                    mode: 'memory',
                    frontT: 1,
                    brightness: MEMORY_RESONANCE_BRIGHT
                      * resonance
                      * handoffScale
                      * routeActivityScale,
                    tailDecay: MEMORY_RESONANCE_TAIL_DECAY,
                    color: pulse.color,
                  },
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
      // and we render nothing for this frame.
      const headFromId = pulse.path[headHop];
      const headToId = pulse.path[headHop + 1];
      if (!cells.has(headFromId) || !cells.has(headToId)) continue;
      const headAdj = adjacency.get(headFromId);
      if (!headAdj || !headAdj.has(headToId)) continue;

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
        for (let h = 0; h <= headHop && h < totalHops; h++) {
          const ageHops = headHop - h;
          if (ageHops > TRAIL_HOPS) continue;
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
          const isHead = ageHops === 0;
          const frontT = isHead ? subT : 1.0;
          const brightness = isHead
            ? HOP_HEAD_BRIGHT
            : HOP_TAIL_BRIGHT * Math.exp(-ageHops * HOP_TAIL_DECAY);
          handles.pushActiveHop(
            {
              fromCellId: hFromId,
              toCellId: hToId,
              mode: pulse.mode,
              frontT,
              brightness: brightness * routeActivityScale,
              color: pulse.color,
            },
            cells,
          );
        }
      }

      // Small accent sprite at the wavefront position on the head
      // hop's Bezier (NOT the chord). Sub-segment lighting does most
      // of the work; this just adds a sharp focal point at the lead.
      const fromCell = cells.get(pulse.path[headHop]);
      const toCell = cells.get(pulse.path[headHop + 1]);
      if (fromCell && toCell) {
        const seed = fabricEdgeSeed(pulse.path[headHop], pulse.path[headHop + 1]);
        bezierControlInto(
          spikeControl,
          fromCell.pos_seed[0], fromCell.pos_seed[1], fromCell.pos_seed[2],
          toCell.pos_seed[0], toCell.pos_seed[1], toCell.pos_seed[2],
          seed,
        );
        bezierAtInto(
          spikePosition,
          fromCell.pos_seed[0], fromCell.pos_seed[1], fromCell.pos_seed[2],
          spikeControl[0], spikeControl[1], spikeControl[2],
          toCell.pos_seed[0], toCell.pos_seed[1], toCell.pos_seed[2],
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
        const arrivingCellId = pulse.path[headHop + 1];
        const arriveAt =
          pulse.startSec + (pulse.startDelayMs + (headHop + 1) * hopMs) / 1000;
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
          handles.pushActiveHop({
            fromCellId,
            toCellId,
            mode: 'memory',
            frontT: 1,
            brightness: MEMORY_ROUTE_HOP_INSPECT_BRIGHT
              * focusStrength
              * brightnessScale
              * distancePresentation.routeEnergyScale,
            tailDecay: MEMORY_ROUTE_HOP_INSPECT_TAIL_DECAY,
            color: resolved.route.color,
          }, cells);
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
          handles.pushActiveHop({
            fromCellId,
            toCellId,
            mode: 'memory',
            frontT: 1,
            brightness: MEMORY_SOURCE_HANDOFF_FLARE_BRIGHT
              * focusStrength
              * flareScale
              * distancePresentation.routeEnergyScale,
            tailDecay: MEMORY_SOURCE_HANDOFF_FLARE_TAIL_DECAY,
            color: resolved.route.color,
          }, cells);
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
  });

  return (
    <>
      <NeuralFabric
        key={fabricAllocation}
        allocationEdges={fabricAllocation}
        onReady={onFabricReady}
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
