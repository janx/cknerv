// Default SPA for the `cknerv` binary. Bootstraps from the chain + cells
// snapshots, then subscribes to the live WS streams so the cell galaxy
// fills in and block pulses fire as the chain advances. Renders a 3D
// canvas (CellGalaxy canopy) alongside the DOM `HudOverlay` (a sibling of
// the canvas) that carries the always-on telemetry panels (blockchain /
// network / cells stats) plus node / peer detail and the backfill/seeding
// indicator. Cell inspection opens one detail constellation tethered to the
// selected scene Cell. The leva knobs panel is hidden by default (toggle with
// backtick) — see Tweaks.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ElementRef,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import {
  aggregateCellsStats,
  AdaptiveQualityController,
  CELLS_Y,
  CELL_SELECTION_PREFIX,
  cellDetailViewFocus,
  cellFieldContactDelayS,
  chainNodeWorldPosition,
  canRecallConsensusMemory,
  cellIdentityProofBindingComplete,
  consensusMemoryRouteHopFocusEqual,
  consensusMemoryTraceRequestKey,
  deriveCellCausalLens,
  deriveConsensusMemoryRouteHopFocus,
  colonyFlood,
  deriveConsensusMemoryTraceEndpoints,
  findCellOriginLink,
  inferredTopology,
  CellGalaxy,
  CellGalaxyProvider,
  CellCausalLensLayer,
  CellInspectionAnchor,
  CellInspectionOverlay,
  createCellInspectionHandles,
  CellSemanticOrbit,
  ConsensusRouteCamera,
  ConsensusWriteSeal,
  HudOverlay,
  NetworkColony,
  NeuralNetwork,
  QUALITY_PRESETS,
  RenderStatsPanel,
  RenderStatsSampler,
  SimClockTicker,
  setQualityMode,
  TweakSync,
  UNIVERSE_SEED_FALLBACK,
  useQualityRuntime,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryTraceOutcome,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryTargetResponse,
  type CellInspectionField,
  type CellInspectionHandles,
  type CellIdentityProofEvent,
  type CellIdentityProofKind,
} from '@cknerv/ui';
import {
  connectCellsStream,
  connectEntityStream,
  connectSemanticsStream,
  emptySemanticsCache,
  fetchCellSemantics,
  fetchTransactionSemantics,
  fromCellsSnapshot,
  outPointKey,
  type CellGalaxyCache,
  type ChainCache,
  type SemanticsCache,
  type StreamHealth,
} from '@cknerv/cache';
import type {
  Cell,
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
  Peer,
  CellSemanticRecord,
  TransactionSemanticRecord,
} from '@cknerv/types';
import Tweaks from './Tweaks';
import Jukebox from './Jukebox';
import {
  INITIAL_CELL_IDENTITY_JOURNEY_STATE,
  cellIdentityJourneyReducer,
} from './cell-identity-journey-state';
import {
  INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
  cellCausalNavigationReducer,
  cellCausalNavigationStep,
} from './cell-causal-navigation-state';
import {
  beginOrbitGesture,
  changeOrbitGesture,
  createOrbitGestureState,
  endOrbitGesture,
  orbitGestureSuppressesPointerAction,
} from './orbit-gesture-state';
import {
  CELL_MEMORY_RECALL_MAX_PULSES,
  INITIAL_CELL_MEMORY_RECALL_STATE,
  cellMemoryRecallReducer,
  cellMemoryRecallWriteSeqForTarget,
} from './cell-memory-recall-state';
import {
  cellMemoryRouteAnchor,
  restoreCellMemoryRouteAnchor,
  type CellMemoryRouteAnchor,
} from './cell-memory-route-continuity';
import {
  hasQuerySwitch,
  resolveCanvasDpr,
  resolveQualityOverride,
} from './render-quality';
import {
  resolveBuildVersion,
  buildCommitHref,
  resolveEnrichmentConfig,
  resolveGalaxyConfig,
} from './runtime-config';

interface AppProps {
  /** Initial Chain entity from `/api/entities/chain/snapshot`. */
  initialChain: ChainEntry;
  /** Initial chain-node registry (one entry per RPC the adapter observes). */
  initialChainNodes: ChainNode[];
  /** Initial peer list from `/api/entities/chain/snapshot`. */
  initialPeers: Peer[];
  /** Revision attached to the chain snapshot — the WS stream resumes from
   *  here with `?since=` so there's no gap between bootstrap and live. */
  initialChainRevision: number;
  /** Initial cell-galaxy projection snapshot from
   *  `/api/projections/cells/snapshot`. */
  initialCells: CellGalaxySnapshot;
  /** Revision attached to the cells snapshot — same `?since=` resume role. */
  initialCellsRevision: number;
}

const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, CELLS_Y, 0];
const STREAM_STALE_AFTER_MS = 15_000;

function CellDetailViewTracker({
  controlsRef,
  focusRef,
}: {
  controlsRef: { readonly current: ElementRef<typeof OrbitControls> | null };
  focusRef: { current: number };
}) {
  useFrame(({ camera }) => {
    const target = controlsRef.current?.target;
    const targetX = target?.x ?? DEFAULT_CAMERA_TARGET[0];
    const targetY = target?.y ?? DEFAULT_CAMERA_TARGET[1];
    const targetZ = target?.z ?? DEFAULT_CAMERA_TARGET[2];
    focusRef.current = cellDetailViewFocus(Math.hypot(
      camera.position.x - targetX,
      camera.position.y - targetY,
      camera.position.z - targetZ,
    ));
  });
  return null;
}

function initialStreamHealth(): StreamHealth {
  return {
    phase: 'connecting',
    attempt: 0,
    lastMessageAtMs: null,
    reason: 'initial',
  };
}

export default function App({
  initialChain,
  initialChainNodes,
  initialPeers,
  initialChainRevision,
  initialCells,
  initialCellsRevision,
}: AppProps) {
  const galaxyConfig = resolveGalaxyConfig();
  const enrichmentConfig = resolveEnrichmentConfig();
  const qualityOverride = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : resolveQualityOverride(window.location.search)
  ), []);
  useEffect(() => {
    if (qualityOverride) setQualityMode(qualityOverride);
  }, [qualityOverride]);
  const qualityRuntime = useQualityRuntime();
  const qualityCascade = QUALITY_PRESETS[qualityRuntime.effective];
  const orbitControlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [cellScanInteractionActive, setCellScanInteractionActive] = useState(
    false,
  );
  const cellDetailViewFocusRef = useRef(0);
  // One channel for the split Cell inspector: the in-Canvas anchor writes
  // card/connector styles through it, the DOM card registers its nodes into
  // it. Created once for the app's lifetime.
  const cellInspectionHandlesRef = useRef<CellInspectionHandles | null>(null);
  if (cellInspectionHandlesRef.current === null) {
    cellInspectionHandlesRef.current = createCellInspectionHandles();
  }
  const cellInspectionHandles = cellInspectionHandlesRef.current;
  const [orbitInteractionRevision, noteOrbitInteraction] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const orbitGestureRef = useRef(createOrbitGestureState());
  // CellPicker still raycasts pointer-down/click for correct R3F selection,
  // then skips its O(N) screen projections once OrbitControls reports real
  // camera movement. This ref changes outside React's render path.
  const orbitPickingSuspendedRef = useRef(false);
  const beginOrbitInteraction = useCallback(() => {
    orbitPickingSuspendedRef.current = false;
    beginOrbitGesture(orbitGestureRef.current);
  }, []);
  const changeOrbitInteraction = useCallback(() => {
    if (orbitGestureRef.current.active) {
      orbitPickingSuspendedRef.current = true;
    }
    if (changeOrbitGesture(orbitGestureRef.current)) noteOrbitInteraction();
  }, []);
  const endOrbitInteraction = useCallback(() => {
    orbitPickingSuspendedRef.current = false;
    endOrbitGesture(orbitGestureRef.current, performance.now());
  }, []);
  const forceRenderStats = useMemo(() => (
    typeof window !== 'undefined'
    && hasQuerySwitch(window.location.search, 'render-stats')
  ), []);
  const canvasDpr = resolveCanvasDpr(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    qualityCascade.maxDpr,
  );
  // Live caches, seeded from the bootstrap snapshots so the first paint is
  // already populated, then updated in place by the WS streams below. A
  // fresh cache object on every delta re-renders the tree; CellGalaxy reads
  // the new cells via useCellGalaxy() and animates births/deaths + pulses.
  const [chainCache, setChainCache] = useState<ChainCache>(() => ({
    revision: initialChainRevision,
    chain: initialChain,
    chainNodes: initialChainNodes,
    // Seeded from the bootstrap snapshot; the WS stream's first snapshot /
    // peers_updated delta keeps this live thereafter.
    peers: initialPeers,
  }));
  const initialCellsCacheRef = useRef<CellGalaxyCache | null>(null);
  const initialCellsCache = initialCellsCacheRef.current
    ?? fromCellsSnapshot(initialCellsRevision, initialCells, {
      recentLinksCapacity: galaxyConfig.recentLinksCap,
      linkRingCapacity: galaxyConfig.pulses.linkRingCapacity,
    });
  initialCellsCacheRef.current = initialCellsCache;
  const [cellsCache, setCellsCache] = useState<CellGalaxyCache>(
    initialCellsCache,
  );
  const initialSemanticsCacheRef = useRef<SemanticsCache | null>(null);
  if (initialSemanticsCacheRef.current === null) {
    const initial = emptySemanticsCache();
    initialSemanticsCacheRef.current = enrichmentConfig.enabled
      ? {
        ...initial,
        source: {
          source: enrichmentConfig.source ?? 'enrichment',
          status: 'connecting',
          capabilities: [],
        },
      }
      : initial;
  }
  const initialSemanticsCache = initialSemanticsCacheRef.current;
  const [semanticsCache, setSemanticsCache] = useState<SemanticsCache>(
    initialSemanticsCache,
  );
  const [chainStreamHealth, setChainStreamHealth] = useState<StreamHealth>(
    initialStreamHealth,
  );
  const [cellsStreamHealth, setCellsStreamHealth] = useState<StreamHealth>(
    initialStreamHealth,
  );
  const retainedCellRecordsRef = useRef(cellsCache.cells);
  retainedCellRecordsRef.current = cellsCache.cells;
  // Cell and network ids retain separate state shapes because their scene
  // layers use different records. Selection itself is exclusive: entering a
  // Cell detail clears node/peer detail, while choosing a network entity closes
  // the Cell field so the scene always has one primary inspection target.
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [cellCausalNavigation, dispatchCellCausalNavigation] = useReducer(
    cellCausalNavigationReducer,
    INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
  );
  const [cellIdentityProof, setCellIdentityProof] = useState<
    CellIdentityProofEvent | null
  >(null);
  const cellIdentityProofSequenceRef = useRef(0);
  const [cellIdentityJourney, dispatchCellIdentityJourney] = useReducer(
    cellIdentityJourneyReducer,
    INITIAL_CELL_IDENTITY_JOURNEY_STATE,
  );
  const cellIdentityProofBinding = cellIdentityJourney.binding;
  const [memoryRecall, dispatchMemoryRecall] = useReducer(
    cellMemoryRecallReducer,
    INITIAL_CELL_MEMORY_RECALL_STATE,
  );
  const memoryTraceRequest = memoryRecall.request;
  const [memoryTraceReadout, setMemoryTraceReadout] = useState<
    ConsensusMemoryTraceReadout | null
  >(null);
  const [memoryEvidenceFocusSourceId, setMemoryEvidenceFocusSourceId] = useState<
    number | null
  >(null);
  const [memoryAgreementPreviewSourceId, setMemoryAgreementPreviewSourceId] =
    useState<number | null>(null);
  const [memoryRouteHopPreview, setMemoryRouteHopPreview] = useState<
    ConsensusMemoryRouteHopFocus | null
  >(null);
  const [memoryRouteHopLock, setMemoryRouteHopLock] = useState<
    ConsensusMemoryRouteHopFocus | null
  >(null);
  const memoryRouteHopAnchorRef = useRef<CellMemoryRouteAnchor | null>(null);
  const memoryTraceTargetResponseRef = useRef<
    ConsensusMemoryTargetResponse | null
  >(null);
  const clearCellSelection = useCallback(() => {
    // Closing is also an interaction-boundary reset. The nested Cell Scan can
    // disappear while it owns pointer capture, before its delayed R3F teardown
    // reports onEnd; never let that keep the main OrbitControls disabled.
    setCellScanInteractionActive(false);
    memoryRouteHopAnchorRef.current = null;
    setCellIdentityProof(null);
    dispatchCellIdentityJourney({ type: 'clear' });
    dispatchCellCausalNavigation({ type: 'clear' });
    setSelectedCellId(null);
    dispatchMemoryRecall({ type: 'cancel' });
  }, []);
  const inspectCell = useCallback((nextCellId: number) => {
    if (!Number.isSafeInteger(nextCellId) || nextCellId < 0) return;
    const selectionId = `${CELL_SELECTION_PREFIX}${nextCellId}`;
    dispatchCellIdentityJourney({
      type: 'select',
      cellId: nextCellId,
      atMs: performance.now(),
    });
    setCellIdentityProof((current) => (
      current?.cellId === nextCellId ? current : null
    ));
    setSelectedCellId((current) => {
      if (current !== selectionId) memoryRouteHopAnchorRef.current = null;
      return selectionId;
    });
    // Selecting another Cell is inspection, not yet a record replacement.
    // Keep the verified recall alive until the user explicitly recalls the
    // new Cell, so NeuralNetwork can stage two independent record layers.
    dispatchMemoryRecall({ type: 'inspect', targetCellId: nextCellId });
  }, []);
  const handleSelect = useCallback((id: string | null) => {
    if (
      id == null
      || orbitGestureSuppressesPointerAction(
        orbitGestureRef.current,
        performance.now(),
      )
    ) return;
    if (id.startsWith(CELL_SELECTION_PREFIX)) {
      const nextCellId = Number(id.slice(CELL_SELECTION_PREFIX.length));
      if (!Number.isSafeInteger(nextCellId) || nextCellId < 0) return;
      setSelectedNetId(null);
      dispatchCellCausalNavigation({ type: 'select', cellId: nextCellId });
      inspectCell(nextCellId);
    } else {
      clearCellSelection();
      setSelectedNetId(id);
    }
  }, [clearCellSelection, inspectCell]);
  const navigateCausalCell = useCallback((cellId: number) => {
    if (orbitGestureSuppressesPointerAction(
      orbitGestureRef.current,
      performance.now(),
    )) return;
    if (!retainedCellRecordsRef.current.has(cellId)) return;
    const encodedCurrent = selectedCellId?.startsWith(CELL_SELECTION_PREFIX)
      ? Number(selectedCellId.slice(CELL_SELECTION_PREFIX.length))
      : Number.NaN;
    const fromCellId = Number.isSafeInteger(encodedCurrent)
      ? encodedCurrent
      : null;
    dispatchCellCausalNavigation({
      type: 'navigate',
      fromCellId,
      targetCellId: cellId,
    });
    inspectCell(cellId);
  }, [inspectCell, selectedCellId]);
  const confirmCellIdentityProof = useCallback((
    kind: CellIdentityProofKind,
    cellId: number,
    reducedMotion: boolean,
  ) => {
    if (selectedCellId !== `${CELL_SELECTION_PREFIX}${cellId}`) return;
    const emittedAtMs = performance.now();
    cellIdentityProofSequenceRef.current += 1;
    setCellIdentityProof({
      kind,
      cellId,
      sequence: cellIdentityProofSequenceRef.current,
      emittedAtMs,
      reducedMotion,
    });
    dispatchCellIdentityJourney({
      type: 'resolve',
      kind,
      cellId,
      atMs: emittedAtMs,
      reducedMotion,
    });
  }, [selectedCellId]);

  // Subscribe once on mount. Each stream opens with `?since=<bootstrap
  // revision>` so the server replays missed deltas (or re-snapshots) with
  // no gap, then streams live. Disconnect on unmount.
  useEffect(() => {
    const entity = connectEntityStream(
      '/api/entities/chain/stream',
      {
        revision: initialChainRevision,
        chain: initialChain,
        chainNodes: initialChainNodes,
        peers: initialPeers,
      },
      setChainCache,
      {
        onHealth: setChainStreamHealth,
        staleAfterMs: STREAM_STALE_AFTER_MS,
      },
    );
    const cells = connectCellsStream(
      '/api/projections/cells/stream',
      initialCellsCache,
      setCellsCache,
      {
        recentLinksCapacity: galaxyConfig.recentLinksCap,
        linkRingCapacity: galaxyConfig.pulses.linkRingCapacity,
        onHealth: setCellsStreamHealth,
        staleAfterMs: STREAM_STALE_AFTER_MS,
      },
    );
    const semantics = enrichmentConfig.enabled
      ? connectSemanticsStream(
        '/api/projections/semantics/stream',
        initialSemanticsCache,
        setSemanticsCache,
      )
      : null;
    return () => {
      entity.disconnect();
      cells.disconnect();
      semantics?.disconnect();
    };
    // Seeds are mount-time constants; subscribe exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chain = chainCache.chain;
  const chainNodes = chainCache.chainNodes;
  const peers = chainCache.peers;
  // The observed local node anchors the constellation + supplies the
  // version used for peer version-mismatch coloring. Prefer an explicit id
  // lookup over positional [0] so a registry reorder can't silently anchor
  // the wrong node; fall back to the first entry.
  const localNode =
    chainNodes.find((n) => n.id === 'ckb:local') ?? chainNodes[0];

  // Shared per-cell flash buffers, owned here so the NeuralNetwork overlay
  // can write cell→cell pulse arrivals into the same Float32Array CellShell
  // reads. burstArrivalRef carries terminal arrivals to ConsensusWriteSeal.
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef<boolean>(false);
  const flashDirtyIdsRef = useRef<Set<number>>(new Set());
  const cellInspectionFieldRef = useRef<CellInspectionField | null>(null);
  const burstArrivalRef = useRef<
    Map<number, { firedAt: number; color: [number, number, number] }>
  >(new Map());

  // ckb node ids drive the icosahedra scatter inside the cell canopy. The
  // CkbDirectAdapter registers `ckb:local` on boot; fall back to a single
  // anchor so the galaxy always has one even before the registry arrives.
  // Keyed on the id CONTENT, not the chainNodes array identity: node-info
  // polls (version/connections) replace the array without changing the id
  // set, and this list feeds localCkbPos → the whole P2P topology memo.
  const ckbNodeIdsSig = useMemo(
    () => chainNodes.map((n) => n.id).join(' '),
    [chainNodes],
  );
  const ckbNodeIds = useMemo(() => {
    const ids = ckbNodeIdsSig.length > 0 ? ckbNodeIdsSig.split(' ') : [];
    return ids.length > 0 ? ids : ['ckb:local'];
  }, [ckbNodeIdsSig]);

  // Single seed source for chain-node placement, fed to BOTH CellGalaxy and
  // NetworkColony so carrier launch points and the galaxy stay locked to the
  // same layout (they'd diverge if only one got a real seed). The backend
  // universe_seed isn't plumbed to the SPA yet; when it is, source it HERE and
  // both move together.
  const universeSeed = UNIVERSE_SEED_FALLBACK;

  // World position of the `ckb:local` icosahedron — computed the SAME way
  // CellGalaxy places its labeled CkbNodeAnchor (chainNodeWorldPosition at the
  // `ckb:local` index, same count + seed). Fed to the colony as the local node's
  // position so the ONE visible "you" is that labeled cyan anchor: the measured
  // belts converge on it.
  // Memoized for a stable identity so it doesn't churn the topology every poll.
  const localCkbPos = useMemo(
    () => chainNodeWorldPosition(Math.max(0, ckbNodeIds.indexOf('ckb:local')), ckbNodeIds.length, universeSeed),
    [ckbNodeIds, universeSeed],
  );

  // The P2P colony topology (inferred cloud/mesh + measured core + local marker)
  // and the per-block flood over it. `peers` gets a NEW array identity on every
  // ~4s poll even when its content is unchanged (the store wholesale-replaces
  // the list), so memoize `topology` on a STABLE CONTENT SIGNATURE, not the array
  // identity — otherwise the inferred geometry (and Task 9's in-flight flood
  // flash/pulse buffers) would rebuild/reset every poll. No-op re-clones now keep
  // the same `topology` object; genuine peer changes still rebuild (accepted).
  // The signature includes ONLY the fields the colony actually renders from the
  // topology snapshot: node_id (identity), latency_ms (measured position),
  // direction + version (measured colour via peerColorKind). `best_known` is
  // deliberately EXCLUDED — nothing rendered reads it (sync-brightness was
  // dropped), and it advances ~every block, so including it would rebuild the
  // topology mid-flood and truncate the in-flight wavefront every block. If
  // sync-based brightness is ever restored, drive it via a ref, not this sig.
  const peersSig = useMemo(
    () =>
      peers
        .map((p) => `${p.node_id}|${p.latency_ms ?? ''}|${p.direction}|${p.version ?? ''}`)
        .join(';'),
    [peers],
  );
  const topology = useMemo(
    () => inferredTopology(peers, universeSeed, localNode?.id ?? 'ckb:local', localCkbPos),
    // peers is read via the stable peersSig; keying on `peers` directly would
    // rebuild the geometry every poll. localCkbPos is stably memoized (no churn).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peersSig, universeSeed, localNode?.id, localCkbPos],
  );
  const cf = useMemo(
    () => colonyFlood(topology, cellsCache.lastPulseAtMs),
    [topology, cellsCache.lastPulseAtMs],
  );
  const livePulseDelayS = cellFieldContactDelayS(cf.localReceiveDelayS);

  const cellsStats = useMemo(
    () =>
      aggregateCellsStats(
        cellsCache.cells,
        cellsCache.totalBirths,
        cellsCache.totalDeaths,
      ),
    [cellsCache.cells, cellsCache.totalBirths, cellsCache.totalDeaths],
  );

  const compositionCellsById = useMemo(() => {
    const cells = new Map<number, Cell>();
    const composition = semanticsCache.galaxyComposition;
    if (!composition) return cells;
    for (const cell of [
      ...composition.dao,
      ...composition.typed,
      ...composition.plain,
    ]) cells.set(cell.id, cell);
    return cells;
  }, [semanticsCache.galaxyComposition]);

  // Resolve the two selections. Cell = the galaxy axis; node/peer share the
  // network axis (selectedNetId holds a node id or a `peer:` id, never a cell).
  const selectedCell = useMemo(() => {
    if (!selectedCellId || !selectedCellId.startsWith(CELL_SELECTION_PREFIX)) return null;
    const id = Number(selectedCellId.slice(CELL_SELECTION_PREFIX.length));
    return Number.isFinite(id)
      ? cellsCache.cells.get(id) ?? compositionCellsById.get(id) ?? null
      : null;
  }, [selectedCellId, cellsCache.cells, compositionCellsById]);
  const cachedSelectedCellSemantics = selectedCell
    ? semanticsCache.cells.get(outPointKey(selectedCell.out_point)) ?? null
    : null;
  const [selectedSemanticsLookup, setSelectedSemanticsLookup] = useState<{
    key: string | null;
    phase: 'waiting' | 'loading' | 'ready' | 'unavailable' | 'error';
    record: CellSemanticRecord | null;
    message: string | null;
  }>({ key: null, phase: 'waiting', record: null, message: null });
  const selectedOutPointKey = selectedCell
    ? outPointKey(selectedCell.out_point)
    : null;
  useEffect(() => {
    if (!enrichmentConfig.enabled || !selectedCell || !selectedOutPointKey) {
      setSelectedSemanticsLookup({
        key: null,
        phase: 'waiting',
        record: null,
        message: null,
      });
      return;
    }
    if (cachedSelectedCellSemantics) {
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: 'ready',
        record: cachedSelectedCellSemantics,
        message: null,
      });
      return;
    }
    const source = semanticsCache.source;
    if (!source.validated_anchor) {
      const hardFailure = source.status === 'error'
        || source.status === 'incompatible';
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: hardFailure ? 'error' : 'waiting',
        record: null,
        message: source.message ?? null,
      });
      return;
    }

    const controller = new AbortController();
    setSelectedSemanticsLookup({
      key: selectedOutPointKey,
      phase: 'loading',
      record: null,
      message: null,
    });
    void fetchCellSemantics(selectedCell.out_point, {
      signal: controller.signal,
    }).then((record) => {
      if (controller.signal.aborted) return;
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: record ? 'ready' : 'unavailable',
        record,
        message: record ? null : 'no semantic context is available for this Cell',
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setSelectedSemanticsLookup({
        key: selectedOutPointKey,
        phase: 'error',
        record: null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [
    cachedSelectedCellSemantics,
    enrichmentConfig.enabled,
    selectedCell,
    selectedOutPointKey,
    semanticsCache.source.message,
    semanticsCache.source.status,
    semanticsCache.source.validated_anchor,
  ]);
  const selectedCellSemantics = selectedSemanticsLookup.key === selectedOutPointKey
    ? selectedSemanticsLookup.record
    : cachedSelectedCellSemantics;
  const selectedCellSemanticsPhase = selectedSemanticsLookup.key === selectedOutPointKey
    ? selectedSemanticsLookup.phase
    : cachedSelectedCellSemantics
      ? 'ready'
      : 'waiting';
  const selectedTransactionHash = selectedCell?.out_point.tx_hash ?? null;
  const transactionSemanticsEnabled = enrichmentConfig.enabled
    && semanticsCache.source.capabilities.includes('transaction_detail');
  const cachedSelectedTransactionSemantics = selectedTransactionHash
    ? semanticsCache.transactions.get(selectedTransactionHash) ?? null
    : null;
  const [selectedTransactionLookup, setSelectedTransactionLookup] = useState<{
    key: string | null;
    phase: 'waiting' | 'loading' | 'ready' | 'unavailable' | 'error';
    record: TransactionSemanticRecord | null;
    message: string | null;
  }>({ key: null, phase: 'waiting', record: null, message: null });
  useEffect(() => {
    if (!transactionSemanticsEnabled || !selectedTransactionHash) {
      setSelectedTransactionLookup({
        key: null,
        phase: 'waiting',
        record: null,
        message: null,
      });
      return;
    }
    if (cachedSelectedTransactionSemantics) {
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: 'ready',
        record: cachedSelectedTransactionSemantics,
        message: null,
      });
      return;
    }
    const source = semanticsCache.source;
    if (!source.validated_anchor) {
      const hardFailure = source.status === 'error'
        || source.status === 'incompatible';
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: hardFailure ? 'error' : 'waiting',
        record: null,
        message: source.message ?? null,
      });
      return;
    }

    const controller = new AbortController();
    setSelectedTransactionLookup({
      key: selectedTransactionHash,
      phase: 'loading',
      record: null,
      message: null,
    });
    void fetchTransactionSemantics(selectedTransactionHash, {
      signal: controller.signal,
    }).then((record) => {
      if (controller.signal.aborted) return;
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: record ? 'ready' : 'unavailable',
        record,
        message: record ? null : 'no origin transaction context is available',
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setSelectedTransactionLookup({
        key: selectedTransactionHash,
        phase: 'error',
        record: null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [
    cachedSelectedTransactionSemantics,
    selectedTransactionHash,
    semanticsCache.source.message,
    semanticsCache.source.status,
    semanticsCache.source.validated_anchor,
    transactionSemanticsEnabled,
  ]);
  const selectedTransactionSemantics =
    selectedTransactionLookup.key === selectedTransactionHash
      ? selectedTransactionLookup.record
      : cachedSelectedTransactionSemantics;
  const selectedTransactionSemanticsPhase =
    selectedTransactionLookup.key === selectedTransactionHash
      ? selectedTransactionLookup.phase
      : cachedSelectedTransactionSemantics
        ? 'ready'
        : 'waiting';
  const selectedCausalLens = useMemo(
    () => selectedCell
      ? deriveCellCausalLens(
        selectedCell,
        cellsCache.recentLinks,
        cellsCache.cells,
      )
      : null,
    [selectedCell, cellsCache.cells, cellsCache.recentLinks],
  );
  const causalBackStep = cellCausalNavigationStep(
    cellCausalNavigation,
    -1,
    (cellId) => cellsCache.cells.has(cellId),
  );
  const causalForwardStep = cellCausalNavigationStep(
    cellCausalNavigation,
    1,
    (cellId) => cellsCache.cells.has(cellId),
  );
  const navigateCausalBack = useCallback(() => {
    if (!causalBackStep) return;
    dispatchCellCausalNavigation({
      type: 'move',
      index: causalBackStep.index,
    });
    inspectCell(causalBackStep.cellId);
  }, [causalBackStep, inspectCell]);
  const navigateCausalForward = useCallback(() => {
    if (!causalForwardStep) return;
    dispatchCellCausalNavigation({
      type: 'move',
      index: causalForwardStep.index,
    });
    inspectCell(causalForwardStep.cellId);
  }, [causalForwardStep, inspectCell]);
  const selectedCausalNavigation = selectedCell
    && cellCausalNavigation.entries[cellCausalNavigation.index]
      === selectedCell.id
    && cellCausalNavigation.entries.length > 1
    ? {
      position: cellCausalNavigation.index + 1,
      total: cellCausalNavigation.entries.length,
      backCellId: causalBackStep?.cellId ?? null,
      forwardCellId: causalForwardStep?.cellId ?? null,
      onBack: navigateCausalBack,
      onForward: navigateCausalForward,
    }
    : null;
  const selectedOriginLink = useMemo(
    () => selectedCell
      ? findCellOriginLink(selectedCell, cellsCache.recentLinks)
      : null,
    [selectedCell, cellsCache.recentLinks],
  );
  const selectedOriginTrace = useMemo(
    () => selectedOriginLink
      ? deriveConsensusMemoryTraceEndpoints(selectedOriginLink, cellsCache.cells)
      : null,
    [selectedOriginLink, cellsCache.cells],
  );
  const selectedOriginTraceable = !!selectedCell
    && !!selectedOriginTrace
    && selectedOriginTrace.sourceKind !== 'none'
    && selectedOriginTrace.retainedOutputIds.includes(selectedCell.id);
  const memoryRecordIdentity = memoryTraceRequest
    ? `${memoryTraceRequest.linkSeq}:${memoryTraceRequest.targetCellId}`
    : null;
  const memoryRecordSwitchPending = memoryTraceRequest !== null
    && selectedCell !== null
    && selectedCell.id !== memoryTraceRequest.targetCellId;
  useEffect(() => {
    const targetCellId = memoryTraceRequest?.targetCellId;
    if (
      memoryTraceRequest
      && typeof targetCellId === 'number'
      && cellIdentityProofBinding?.cellId === targetCellId
      && cellIdentityProofBindingComplete(cellIdentityProofBinding)
    ) {
      dispatchCellIdentityJourney({
        type: 'recall-start',
        cellId: targetCellId,
        requestKey: consensusMemoryTraceRequestKey(memoryTraceRequest),
        atMs: performance.now(),
      });
    } else if (
      memoryTraceRequest === null
      && cellIdentityProofBinding?.phase === 'recalling'
    ) {
      dispatchCellIdentityJourney({
        type: 'recall-stop',
        atMs: performance.now(),
      });
    }
  }, [
    cellIdentityProofBinding,
    memoryTraceRequest,
  ]);
  const selectedMemoryTraceReadout = useMemo(() => {
    if (!selectedCell || !memoryTraceRequest || !memoryTraceReadout) return null;
    return memoryTraceReadout.targetCellId === selectedCell.id
      && memoryTraceReadout.key === consensusMemoryTraceRequestKey(memoryTraceRequest)
      ? memoryTraceReadout
      : null;
  }, [selectedCell, memoryTraceRequest, memoryTraceReadout]);
  useEffect(() => {
    const validate = (
      current: ConsensusMemoryRouteHopFocus | null,
    ): ConsensusMemoryRouteHopFocus | null => {
      if (!current) return null;
      const verified = deriveConsensusMemoryRouteHopFocus(
        selectedMemoryTraceReadout,
        current.sourceId,
        current.hopIndex,
      );
      return consensusMemoryRouteHopFocusEqual(verified, current)
        ? verified
        : null;
    };
    setMemoryRouteHopPreview(validate);
    setMemoryRouteHopLock((current) => {
      const verified = validate(current);
      if (verified) {
        memoryRouteHopAnchorRef.current = cellMemoryRouteAnchor(verified);
        return verified;
      }
      const restored = restoreCellMemoryRouteAnchor(
        memoryRouteHopAnchorRef.current,
        selectedMemoryTraceReadout,
      );
      if (restored) {
        memoryRouteHopAnchorRef.current = cellMemoryRouteAnchor(restored);
      }
      return restored;
    });
  }, [selectedMemoryTraceReadout]);
  const memoryRouteHopFocus = memoryRouteHopPreview ?? memoryRouteHopLock;
  useEffect(() => {
    setMemoryEvidenceFocusSourceId((current) => {
      const preferredSourceId = memoryRouteHopFocus?.sourceId ?? current;
      return preferredSourceId !== null
        && selectedMemoryTraceReadout?.evidence.some(
          (evidence) => evidence.sourceId === preferredSourceId,
        )
        ? preferredSourceId
        : null;
    });
  }, [memoryRouteHopFocus, selectedMemoryTraceReadout]);
  useEffect(() => {
    setMemoryAgreementPreviewSourceId((current) => (
      current !== null
      && selectedMemoryTraceReadout?.evidence.some(
        (evidence) => evidence.sourceId === current,
      )
        ? current
        : null
    ));
  }, [selectedMemoryTraceReadout]);
  const previewMemoryTraceAgreement = useCallback((sourceId: number | null) => {
    const verifiedSourceId = sourceId !== null
      && selectedMemoryTraceReadout?.evidence.some(
        (evidence) => evidence.sourceId === sourceId,
      )
      ? sourceId
      : null;
    setMemoryAgreementPreviewSourceId(verifiedSourceId);
  }, [selectedMemoryTraceReadout]);
  const focusMemoryTraceEvidence = useCallback((sourceId: number | null) => {
    const lockedSourceId = memoryRouteHopLock?.sourceId ?? null;
    if (lockedSourceId !== null && sourceId !== lockedSourceId) {
      setMemoryEvidenceFocusSourceId(lockedSourceId);
      setMemoryRouteHopPreview(null);
      return;
    }
    if (sourceId === null) {
      setMemoryEvidenceFocusSourceId(null);
      setMemoryRouteHopPreview(null);
      return;
    }
    const verifiedSourceId = selectedMemoryTraceReadout?.evidence.some(
      (evidence) => evidence.sourceId === sourceId,
    )
      ? sourceId
      : null;
    setMemoryEvidenceFocusSourceId(verifiedSourceId);
    setMemoryRouteHopPreview((current) => (
      current?.sourceId === verifiedSourceId ? current : null
    ));
  }, [memoryRouteHopLock, selectedMemoryTraceReadout]);
  const focusMemoryTraceRouteHop = useCallback((
    candidate: ConsensusMemoryRouteHopFocus | null,
  ) => {
    if (!candidate) {
      setMemoryRouteHopPreview(null);
      return;
    }
    if (
      memoryRouteHopLock
      && candidate.sourceId !== memoryRouteHopLock.sourceId
    ) {
      setMemoryRouteHopPreview(null);
      return;
    }
    const verified = deriveConsensusMemoryRouteHopFocus(
      selectedMemoryTraceReadout,
      candidate.sourceId,
      candidate.hopIndex,
    );
    if (
      !verified
      || verified.traceKey !== candidate.traceKey
      || verified.targetCellId !== candidate.targetCellId
      || verified.cellId !== candidate.cellId
    ) {
      setMemoryRouteHopPreview(null);
      return;
    }
    setMemoryEvidenceFocusSourceId(verified.sourceId);
    setMemoryRouteHopPreview(verified);
  }, [memoryRouteHopLock, selectedMemoryTraceReadout]);
  const lockMemoryTraceRouteHop = useCallback((
    candidate: ConsensusMemoryRouteHopFocus | null,
  ) => {
    if (!candidate) {
      memoryRouteHopAnchorRef.current = null;
      setMemoryRouteHopLock(null);
      return;
    }
    const verified = deriveConsensusMemoryRouteHopFocus(
      selectedMemoryTraceReadout,
      candidate.sourceId,
      candidate.hopIndex,
    );
    if (!verified || !consensusMemoryRouteHopFocusEqual(verified, candidate)) {
      memoryRouteHopAnchorRef.current = null;
      setMemoryRouteHopLock(null);
      return;
    }
    setMemoryEvidenceFocusSourceId(verified.sourceId);
    memoryRouteHopAnchorRef.current = cellMemoryRouteAnchor(verified);
    setMemoryRouteHopLock(verified);
  }, [selectedMemoryTraceReadout]);
  const recallSelectedCellOrigin = useCallback((linkSeq: number) => {
    if (
      !selectedCell
      || cellIdentityProofBinding?.cellId !== selectedCell.id
      || !cellIdentityProofBindingComplete(cellIdentityProofBinding)
    ) return;
    const link = cellsCache.recentLinks.find((candidate) => candidate.seq === linkSeq);
    if (
      !link
      || !canRecallConsensusMemory(link, cellsCache.cells, selectedCell.id)
    ) return;
    dispatchMemoryRecall({
      type: 'toggle',
      linkSeq,
      targetCellId: selectedCell.id,
    });
  }, [
    cellIdentityProofBinding,
    selectedCell,
    cellsCache.cells,
    cellsCache.recentLinks,
  ]);
  const completeMemoryRecall = useCallback((
    request: ConsensusMemoryTraceRequest,
    outcome: ConsensusMemoryTraceOutcome,
  ) => {
    dispatchMemoryRecall({ type: 'complete', request });
    if (outcome === 'unavailable') return;
    if (typeof request.targetCellId !== 'number') return;
    dispatchCellIdentityJourney({
      type: 'recall-retained',
      cellId: request.targetCellId,
      requestKey: consensusMemoryTraceRequestKey(request),
      atMs: performance.now(),
    });
  }, []);
  const selectedNode = useMemo(() => {
    if (!selectedNetId || selectedNetId.startsWith('peer:')) return null;
    return chainNodes.find((n) => n.id === selectedNetId) ?? null;
  }, [selectedNetId, chainNodes]);
  const selectedPeer = useMemo(() => {
    if (!selectedNetId || !selectedNetId.startsWith('peer:')) return null;
    const id = selectedNetId.slice('peer:'.length);
    return peers.find((p) => p.node_id === id) ?? null;
  }, [selectedNetId, peers]);

  // Stable identities: HudOverlay is memoized, so its object/callback props
  // must not be re-created per App render.
  const build = useMemo(() => {
    const buildVersion = resolveBuildVersion();
    return { version: buildVersion, href: buildCommitHref(buildVersion) };
  }, []);
  const hudStreamHealth = useMemo(
    () => ({ chain: chainStreamHealth, cells: cellsStreamHealth }),
    [chainStreamHealth, cellsStreamHealth],
  );
  const clearNetSelection = useCallback(() => setSelectedNetId(null), []);

  return (
    <>
      {/* Leva knobs panel (DOM overlay) — hidden by default, backtick toggles. */}
      <Tweaks />
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        cellCount={cellsCache.cells.size}
        cellCapacity={galaxyConfig.cellCap}
        enrichmentSource={enrichmentConfig.enabled ? semanticsCache.source : undefined}
        assetEcosystem={enrichmentConfig.enabled
          ? semanticsCache.assetEcosystem
          : undefined}
        daoState={enrichmentConfig.enabled
          ? semanticsCache.daoState
          : undefined}
        protocolEra={enrichmentConfig.enabled
          ? semanticsCache.protocolEra
          : undefined}
        activityFeed={enrichmentConfig.enabled
          ? semanticsCache.activityFeed
          : undefined}
        transactionHorizon={enrichmentConfig.enabled
          ? semanticsCache.transactionHorizon
          : undefined}
        networkAtlas={enrichmentConfig.enabled
          ? semanticsCache.networkAtlas
          : undefined}
        cellInspectionActive={selectedCell !== null}
        selectedNode={selectedNode}
        selectedPeer={selectedPeer}
        onClearNet={clearNetSelection}
        backfill={cellsCache.backfill}
        streamHealth={hudStreamHealth}
        build={build}
        colonyCount={topology.nodes.length}
      />
      <Jukebox />
      {/* Render-stats HUD overlay (DOM sibling of HudOverlay, NOT in-Canvas):
          visible through the ` panel toggle or ?render-stats=1. */}
      <RenderStatsPanel forceVisible={forceRenderStats} />

      <CellGalaxyProvider value={cellsCache}>
        <Canvas
          camera={{ position: [110, 108, 110], fov: 50, near: 1, far: 3000 }}
          gl={{ antialias: true, alpha: true }}
          dpr={canvasDpr}
          style={{ background: '#02030a' }}
          onPointerMissed={() => {
            // The inspection card is a Canvas sibling, so its clicks can no
            // longer surface here as scene misses.
            if (orbitGestureSuppressesPointerAction(
              orbitGestureRef.current,
              performance.now(),
            )) return;
            clearCellSelection();
            setSelectedNetId(null);
          }}
        >
          {/* Advances the module-level simClock once per frame so every
              useSimFrame animation (CellGalaxy, BlockDeliveryLayer, GlowNode,
              NeuralNetwork, NetworkColony) actually plays. Must live
              under the r3f context; mount exactly once. */}
          <SimClockTicker />
          <CellDetailViewTracker
            controlsRef={orbitControlsRef}
            focusRef={cellDetailViewFocusRef}
          />
          {/* Auto mode samples raw frame time with long hysteresis. Manual
              high/med/low in the backtick panel overrides it immediately. */}
          {qualityOverride ? null : <AdaptiveQualityController />}
          {/* Mirrors the backtick leva panel into the LIVE tuning store.
              Re-renders only on knob drag (no per-frame cost); mount once. */}
          <TweakSync />
          {/* Samples gl.info when the ` panel toggle or ?render-stats=1 is on;
              inert otherwise. Mount once. */}
          <RenderStatsSampler forceEnabled={forceRenderStats} />

          <Stars
            radius={400}
            depth={120}
            count={qualityCascade.starsCount}
            factor={2}
            saturation={0}
            fade
            speed={0.3}
          />

          {/* CellGalaxy owns exact ledger-apply feedback only. The broad
              new-block brightness shockwave now belongs to NetworkColony. */}
          <CellGalaxy
            ckbNodeIds={ckbNodeIds}
            universeSeed={universeSeed}
            cellCapacity={galaxyConfig.cellCap}
            galaxyComposition={semanticsCache.galaxyComposition}
            localReceiveDelayS={cf.localReceiveDelayS}
            selectedId={selectedNetId}
            selectedCellId={selectedCellId}
            identityProof={cellIdentityProof}
            identityProofBinding={cellIdentityProofBinding}
            onSelect={handleSelect}
            cellFlashRef={cellFlashRef}
            flashDirtyRef={flashDirtyRef}
            flashDirtyIdsRef={flashDirtyIdsRef}
            inspectionFieldRef={cellInspectionFieldRef}
            pickingSuspendedRef={orbitPickingSuspendedRef}
            overlay={
              <>
                {selectedCell ? (
                  <CellInspectionAnchor
                    key={selectedCell.id}
                    cell={selectedCell}
                    handles={cellInspectionHandles}
                  />
                ) : null}
                {selectedCell && selectedCellSemantics ? (
                  <CellSemanticOrbit
                    cell={selectedCell}
                    record={selectedCellSemantics}
                    source={semanticsCache.source}
                  />
                ) : null}
                {selectedCausalLens ? (
                  <CellCausalLensLayer
                    key={selectedCausalLens.key}
                    lens={selectedCausalLens}
                    onNavigateCell={navigateCausalCell}
                  />
                ) : null}
                {/* Cell→cell consensus packets: each observed transaction
                    routes its carrier from input cells to outputs through the
                    shared neighbour graph, illuminating the maintained data
                    structure before the terminal write seal resolves. */}
                <NeuralNetwork
                  cellCapacity={galaxyConfig.cellCap}
                  galaxyComposition={semanticsCache.galaxyComposition}
                  cellFlashRef={cellFlashRef}
                  flashDirtyRef={flashDirtyRef}
                  flashDirtyIdsRef={flashDirtyIdsRef}
                  burstArrivalRef={burstArrivalRef}
                  topology={galaxyConfig.topology}
                  pulses={galaxyConfig.pulses}
                  livePulseDelayS={livePulseDelayS}
                  inspectionCellId={selectedCell?.id ?? null}
                  inspectionFieldRef={cellInspectionFieldRef}
                  cellDetailViewFocusRef={cellDetailViewFocusRef}
                  traceRequest={memoryTraceRequest}
                  traceMaxPulses={CELL_MEMORY_RECALL_MAX_PULSES}
                  traceHoldForRecordSwitch={memoryRecordSwitchPending}
                  onTraceComplete={completeMemoryRecall}
                  onTraceReadoutChange={setMemoryTraceReadout}
                  traceTargetResponseRef={memoryTraceTargetResponseRef}
                  traceEvidenceFocusSourceId={memoryEvidenceFocusSourceId}
                  traceRouteHopFocus={memoryRouteHopFocus}
                  traceRouteHopLock={memoryRouteHopLock}
                  onTraceAgreementPreviewChange={previewMemoryTraceAgreement}
                  onTraceRouteHopLockChange={lockMemoryTraceRouteHop}
                />
                <ConsensusWriteSeal arrivalRef={burstArrivalRef} />
              </>
            }
          />

          {/* The P2P colony: a broad inferred glow-node cloud + gossamer glow-line
              mesh, the bright measured glow-nodes set within it (one confidence
              gradient; the local node is the galaxy's labeled anchor, not drawn
              here). Each block sends a courier cascade through the mesh
              (colonyFlood tree); each measured peer and the local anchor weave a
              protocol carrier into the Cell field as the front reaches it. */}
          <NetworkColony
            topology={topology}
            cf={cf}
            blockPulseAtMs={cellsCache.lastPulseAtMs}
            selectedId={selectedNetId}
            onSelect={handleSelect}
            cellFlashRef={cellFlashRef}
            flashDirtyRef={flashDirtyRef}
            flashDirtyIdsRef={flashDirtyIdsRef}
            localVersion={localNode?.version ?? ''}
            cellInspectionActive={selectedCell !== null}
            cellDetailViewFocusRef={cellDetailViewFocusRef}
          />

          {/* Opening or switching Cell detail is camera-passive. Only explicit
              memory recall / route-lock state may drive this controller; the
              unfiltered readout also keeps an active frame stable while the
              user inspects a different Cell. */}
          <ConsensusRouteCamera
            focus={memoryRouteHopLock}
            controlsRef={orbitControlsRef}
            manualRevision={orbitInteractionRevision}
            recordIdentity={memoryRecordIdentity}
            recordTargetCellId={memoryTraceRequest?.targetCellId ?? null}
            recordTraceReadout={memoryTraceReadout}
          />

          <OrbitControls
            ref={orbitControlsRef}
            enabled={!cellScanInteractionActive}
            enableDamping
            dampingFactor={0.08}
            minDistance={4}
            maxDistance={400}
            // Dolly toward the Cell canopy, the scene's primary inspection
            // surface. The peer plane remains visible below in the overview.
            // Matches CAMERA_PRESETS.default.
            target={DEFAULT_CAMERA_TARGET}
            onStart={beginOrbitInteraction}
            onChange={changeOrbitInteraction}
            onEnd={endOrbitInteraction}
          />
        </Canvas>
      </CellGalaxyProvider>

      {/* DOM half of the Cell inspector — a Canvas sibling, positioned each
          frame by the CellInspectionAnchor inside the Galaxy overlay. */}
      {selectedCell ? (
        <CellInspectionOverlay
          key={selectedCell.id}
          handles={cellInspectionHandles}
          cell={selectedCell}
          routeCellById={cellsCache.cells}
          recentLinks={cellsCache.recentLinks}
          causalLens={selectedCausalLens}
          causalNavigation={selectedCausalNavigation}
          tracedWriteSeq={cellMemoryRecallWriteSeqForTarget(
            memoryTraceRequest,
            selectedCell.id,
          )}
          traceSource={selectedOriginTrace?.sourceKind ?? 'none'}
          traceReadout={selectedMemoryTraceReadout}
          traceResponseRef={memoryTraceTargetResponseRef}
          traceEvidenceFocusSourceId={memoryEvidenceFocusSourceId}
          traceEvidencePreviewSourceId={memoryAgreementPreviewSourceId}
          onTraceEvidenceFocusChange={focusMemoryTraceEvidence}
          traceRouteHopFocus={memoryRouteHopFocus}
          onTraceRouteHopFocusChange={focusMemoryTraceRouteHop}
          traceRouteHopLock={memoryRouteHopLock}
          onTraceRouteHopLockChange={lockMemoryTraceRouteHop}
          identityProofBinding={cellIdentityProofBinding}
          onTraceWrite={selectedOriginTraceable
            ? recallSelectedCellOrigin
            : undefined}
          onIdentityProofRead={confirmCellIdentityProof}
          semanticSource={enrichmentConfig.enabled
            ? semanticsCache.source
            : undefined}
          semanticPhase={enrichmentConfig.enabled
            ? selectedCellSemanticsPhase
            : undefined}
          semanticRecord={selectedCellSemantics}
          semanticMessage={selectedSemanticsLookup.message}
          semanticTransactionPhase={transactionSemanticsEnabled
            ? selectedTransactionSemanticsPhase
            : undefined}
          semanticTransactionRecord={selectedTransactionSemantics}
          semanticTransactionMessage={selectedTransactionLookup.message}
          onScanInteractionChange={setCellScanInteractionActive}
          onClose={clearCellSelection}
        />
      ) : null}
    </>
  );
}
