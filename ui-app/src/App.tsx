// Default SPA for the `cknerv` binary. Bootstraps from the chain + cells
// snapshots, then subscribes to the live WS streams so the cell galaxy
// fills in and block pulses fire as the chain advances. Renders a 3D
// canvas (CellGalaxy canopy) alongside the DOM `HudOverlay` (a sibling of
// the canvas) that carries the always-on telemetry panels (blockchain /
// network / cells stats) plus the selection-detail panels (cell / node /
// peer) and the backfill/seeding indicator. The leva knobs panel is hidden
// by default (toggle with backtick) — see Tweaks.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ElementRef,
} from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import {
  aggregateCellsStats,
  AdaptiveQualityController,
  CELL_SELECTION_PREFIX,
  chainNodeWorldPosition,
  canRecallConsensusMemory,
  consensusMemoryRouteHopFocusEqual,
  consensusMemoryTraceRequestKey,
  deriveConsensusMemoryRouteHopFocus,
  colonyFlood,
  deriveConsensusMemoryTraceEndpoints,
  findCellOriginLink,
  inferredTopology,
  CellGalaxy,
  CellGalaxyProvider,
  ConsensusRouteCamera,
  ConsensusWriteSeal,
  HudOverlay,
  NetworkColony,
  NeuralNetwork,
  QUALITY_PRESETS,
  RenderStatsPanel,
  RenderStatsSampler,
  SimClockTicker,
  TweakSync,
  UNIVERSE_SEED_FALLBACK,
  useQualityRuntime,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryTargetResponse,
} from '@cknerv/ui';
import {
  connectCellsStream,
  connectEntityStream,
  fromCellsSnapshot,
  type CellGalaxyCache,
  type ChainCache,
} from '@cknerv/cache';
import type {
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
  Peer,
} from '@cknerv/types';
import Tweaks from './Tweaks';
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
import { hasQuerySwitch, resolveCanvasDpr } from './render-quality';
import { resolveBuildVersion, buildCommitHref, resolveGalaxyConfig } from './runtime-config';

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

const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 18, 0];

export default function App({
  initialChain,
  initialChainNodes,
  initialPeers,
  initialChainRevision,
  initialCells,
  initialCellsRevision,
}: AppProps) {
  const galaxyConfig = resolveGalaxyConfig();
  const qualityRuntime = useQualityRuntime();
  const qualityCascade = QUALITY_PRESETS[qualityRuntime.effective];
  const orbitControlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [orbitInteractionRevision, noteOrbitInteraction] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
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
  const [cellsCache, setCellsCache] = useState<CellGalaxyCache>(() =>
    fromCellsSnapshot(initialCellsRevision, initialCells, {
      linkRingCapacity: galaxyConfig.pulses.linkRingCapacity,
    }),
  );
  // Two independent selections so a cell (galaxy axis) and a network entity
  // (node/peer axis) can be inspected side-by-side. Clicks route by id prefix:
  // `cell:` → cell axis; a node id / `peer:` → net axis (node and peer share it,
  // one network entity at a time). The axes drive the two HUD detail zones
  // independently.
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
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
  const handleSelect = useCallback((id: string | null) => {
    if (id == null) return;
    if (id.startsWith(CELL_SELECTION_PREFIX)) {
      setSelectedCellId((current) => {
        if (current !== id) memoryRouteHopAnchorRef.current = null;
        return id;
      });
      // Selecting another Cell is inspection, not yet a record replacement.
      // Keep the verified recall alive until the user explicitly recalls the
      // new Cell, so NeuralNetwork can stage two independent record layers.
      dispatchMemoryRecall({
        type: 'inspect',
        targetCellId: Number(id.slice(CELL_SELECTION_PREFIX.length)),
      });
    }
    else setSelectedNetId(id);
  }, []);

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
    );
    const cells = connectCellsStream(
      '/api/projections/cells/stream',
      fromCellsSnapshot(initialCellsRevision, initialCells, {
        linkRingCapacity: galaxyConfig.pulses.linkRingCapacity,
      }),
      setCellsCache,
      { linkRingCapacity: galaxyConfig.pulses.linkRingCapacity },
    );
    return () => {
      entity.disconnect();
      cells.disconnect();
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
  const burstArrivalRef = useRef<
    Map<number, { firedAt: number; color: [number, number, number] }>
  >(new Map());

  // ckb node ids drive the icosahedra scatter inside the cell canopy. The
  // CkbDirectAdapter registers `ckb:local` on boot; fall back to a single
  // anchor so the galaxy always has one even before the registry arrives.
  const ckbNodeIds = useMemo(() => {
    const ids = chainNodes.map((n) => n.id);
    return ids.length > 0 ? ids : ['ckb:local'];
  }, [chainNodes]);

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
  // belts converge on it. (The block brightness shockwave no longer anchors here
  // — it erupts from each block's origin peer; see entryPeerWorld below.)
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
  // Galaxy shockwave anchor. The canopy brightness wave erupts from the block's
  // ORIGIN PEER — cf.entryId, the flood root, biased FAR from us — at its
  // galaxy-contact point (the peer's xz lands on the cells-canopy rim, since
  // COLONY_RADIUS echoes the canopy footprint), then sweeps inward and reaches
  // our local cells naturally. Each block floods from a different origin, so the
  // wave tracks where THAT block entered the network instead of always erupting
  // from dead centre. This restores CellGalaxy's two-origin design — wave = entry
  // peer, local reaction = our node — which had collapsed onto the on-axis local
  // node (i.e. the galaxy centre).
  //
  // heroWorld (our local marker) is the fallback when there's no flood origin yet
  // (single node / no peers); null → CellGalaxy uses its own local origin/timing.
  const heroWorld = useMemo(
    () => topology.nodes.find((n) => n.kind === 'local')?.pos ?? null,
    [topology],
  );
  const entryPeerWorld = useMemo(
    () =>
      cf.entryId
        ? topology.nodes.find((n) => n.id === cf.entryId)?.pos ?? heroWorld
        : heroWorld,
    [cf.entryId, topology, heroWorld],
  );
  // The origin peer is the flood root (colonyArrivalS ≈ 0), so the wave departs
  // ~SHOCKWAVE_FIRE_DELAY_S after the pulse and sweeps across to us — not only at
  // the moment WE apply the block. Fall back to our own receive delay when there
  // is no flood origin.
  const entryArrivalS = cf.entryId
    ? cf.colonyArrivalS[cf.entryId] ?? 0
    : cf.localReceiveDelayS;

  const cellsStats = useMemo(
    () =>
      aggregateCellsStats(
        cellsCache.cells,
        cellsCache.totalBirths,
        cellsCache.totalDeaths,
      ),
    [cellsCache.cells, cellsCache.totalBirths, cellsCache.totalDeaths],
  );

  // Resolve the two selections. Cell = the galaxy axis; node/peer share the
  // network axis (selectedNetId holds a node id or a `peer:` id, never a cell).
  const selectedCell = useMemo(() => {
    if (!selectedCellId || !selectedCellId.startsWith(CELL_SELECTION_PREFIX)) return null;
    const id = Number(selectedCellId.slice(CELL_SELECTION_PREFIX.length));
    return Number.isFinite(id) ? cellsCache.cells.get(id) ?? null : null;
  }, [selectedCellId, cellsCache.cells]);
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
    if (!selectedCell) return;
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
  }, [selectedCell, cellsCache.cells, cellsCache.recentLinks]);
  const completeMemoryRecall = useCallback((request: ConsensusMemoryTraceRequest) => {
    dispatchMemoryRecall({ type: 'complete', request });
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

  const buildVersion = resolveBuildVersion();
  const build = { version: buildVersion, href: buildCommitHref(buildVersion) };

  return (
    <>
      {/* Leva knobs panel (DOM overlay) — hidden by default, backtick toggles. */}
      <Tweaks />
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        selectedCell={selectedCell}
        cellRecordsById={cellsCache.cells}
        recentCellLinks={cellsCache.recentLinks}
        tracedCellWriteSeq={cellMemoryRecallWriteSeqForTarget(
          memoryTraceRequest,
          selectedCell?.id,
        )}
        cellTraceSource={selectedOriginTrace?.sourceKind ?? 'none'}
        cellTraceReadout={selectedMemoryTraceReadout}
        cellTraceResponseRef={memoryTraceTargetResponseRef}
        cellTraceEvidenceFocusSourceId={memoryEvidenceFocusSourceId}
        cellTraceEvidencePreviewSourceId={memoryAgreementPreviewSourceId}
        onCellTraceEvidenceFocusChange={focusMemoryTraceEvidence}
        cellTraceRouteHopFocus={memoryRouteHopFocus}
        onCellTraceRouteHopFocusChange={focusMemoryTraceRouteHop}
        cellTraceRouteHopLock={memoryRouteHopLock}
        onCellTraceRouteHopLockChange={lockMemoryTraceRouteHop}
        onTraceCellWrite={selectedOriginTraceable
          ? recallSelectedCellOrigin
          : undefined}
        selectedNode={selectedNode}
        selectedPeer={selectedPeer}
        onClearCell={() => {
          memoryRouteHopAnchorRef.current = null;
          setSelectedCellId(null);
          dispatchMemoryRecall({ type: 'cancel' });
        }}
        onClearNet={() => setSelectedNetId(null)}
        backfill={cellsCache.backfill}
        build={build}
        colonyCount={topology.nodes.length}
      />
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
            memoryRouteHopAnchorRef.current = null;
            setSelectedCellId(null);
            setSelectedNetId(null);
            dispatchMemoryRecall({ type: 'cancel' });
          }}
        >
          {/* Advances the module-level simClock once per frame so every
              useSimFrame animation (CellGalaxy, BlockDeliveryLayer, GlowNode,
              NeuralNetwork, NetworkColony) actually plays. Must live
              under the r3f context; mount exactly once. */}
          <SimClockTicker />
          {/* Auto mode samples raw frame time with long hysteresis. Manual
              high/med/low in the backtick panel overrides it immediately. */}
          <AdaptiveQualityController />
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

          {/* The canopy brightness shockwave erupts from the block's ORIGIN PEER
              (cf.entryId) at its galaxy-contact point and sweeps inward — see the
              entryPeerWorld note above. localReceiveDelayS still times OUR local
              reaction (halo + local-ignition at the local node). Prop names kept
              for the shared @cknerv/ui API. */}
          <CellGalaxy
            ckbNodeIds={ckbNodeIds}
            universeSeed={universeSeed}
            localReceiveDelayS={cf.localReceiveDelayS}
            entryWorld={entryPeerWorld}
            entryArrivalS={entryArrivalS}
            selectedId={selectedNetId}
            selectedCellId={selectedCellId}
            onSelect={handleSelect}
            cellFlashRef={cellFlashRef}
            flashDirtyRef={flashDirtyRef}
            overlay={
              <>
                {/* Cell→cell consensus packets: each observed transaction
                    routes its carrier from input cells to outputs through the
                    shared neighbour graph, illuminating the maintained data
                    structure before the terminal write seal resolves. */}
                <NeuralNetwork
                  cellFlashRef={cellFlashRef}
                  flashDirtyRef={flashDirtyRef}
                  burstArrivalRef={burstArrivalRef}
                  topology={galaxyConfig.topology}
                  pulses={galaxyConfig.pulses}
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
            localVersion={localNode?.version ?? ''}
          />

          <ConsensusRouteCamera
            focus={memoryRouteHopLock}
            controlsRef={orbitControlsRef}
            manualRevision={orbitInteractionRevision}
            recordIdentity={memoryRecordIdentity}
            recordTargetCellId={memoryTraceRequest?.targetCellId ?? null}
            recordTraceReadout={selectedMemoryTraceReadout}
            recordSwitchPending={memoryRecordSwitchPending}
          />

          <OrbitControls
            ref={orbitControlsRef}
            enableDamping
            dampingFactor={0.08}
            minDistance={4}
            maxDistance={400}
            // Aim at the content's vertical center (chain plane y=22, cell
            // canopy y=38) instead of the world origin, so the scene sits
            // centered rather than pushed to the top. Matches CAMERA_PRESETS.default.
            target={DEFAULT_CAMERA_TARGET}
            onStart={noteOrbitInteraction}
          />
        </Canvas>
      </CellGalaxyProvider>
    </>
  );
}
