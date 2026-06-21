// Default SPA for the `cknerv` binary. Bootstraps from the chain + cells
// snapshots, then subscribes to the live WS streams so the cell galaxy
// fills in and block pulses fire as the chain advances. Renders a 3D
// canvas (CellGalaxy canopy) alongside the DOM `HudOverlay` (a sibling of
// the canvas) that carries the always-on telemetry panels (blockchain /
// network / cells stats). The in-canvas `<Hud>` now only holds the
// selection-detail panels (cell / node / peer) and the backfill/seeding
// indicator. The leva knobs panel is hidden by default (toggle with
// backtick) — see Tweaks.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Hud, OrbitControls, OrthographicCamera, Stars } from '@react-three/drei';
import {
  aggregateCellsStats,
  blockArrivalSchedule,
  rankPeers,
  peerWorldPosition,
  BackfillHud,
  CellDetailHud,
  CellDetailHudOverlay,
  CellGalaxy,
  CellGalaxyProvider,
  CellLifeDetail3D,
  DendriticBurst,
  HudOverlay,
  NeuralNetwork,
  PeerConstellation,
  SimClockTicker,
  type ScanStateRef,
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
import VersionMarker from './VersionMarker';
import ChainNodeDetailHud from './ChainNodeDetailHud';
import PeerDetailHud from './PeerDetailHud';
import { resolveGalaxyConfig } from './runtime-config';

/** CellGalaxy emits `cell:<id>` for a clicked cell and the bare node id
 *  for a clicked CKB icosahedron. The prefix discriminates the two. */
const CELL_SELECT_PREFIX = 'cell:';

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

export default function App({
  initialChain,
  initialChainNodes,
  initialPeers,
  initialChainRevision,
  initialCells,
  initialCellsRevision,
}: AppProps) {
  const galaxyConfig = resolveGalaxyConfig();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  // Per-block propagation schedule, recomputed when a new block pulse lands. Drives
  // the local node's apply-delay (CellGalaxy) and the entry peer (PeerConstellation)
  // from one source so both layers agree. Computed over the same ranked + capped set
  // PeerConstellation renders, so entryId always references an on-screen peer.
  const blockSchedule = useMemo(
    () => blockArrivalSchedule(rankPeers(peers), cellsCache.lastPulseAtMs),
    [peers, cellsCache.lastPulseAtMs],
  );
  // The per-block ENTRY peer (first to receive the block) owns the canopy
  // brightness wave — the local node is just an ordinary peer that receives it,
  // never the hub/origin. Resolve the entry peer's world position + receive time
  // from the schedule so CellGalaxy fires the wave from there instead of the
  // local centre. null entryId (no peers) → CellGalaxy falls back to the local
  // origin/timing, preserving single-node behaviour.
  const entryWorld = useMemo(() => {
    if (blockSchedule.entryId == null) return null;
    const entryPeer = peers.find((p) => p.node_id === blockSchedule.entryId);
    return entryPeer ? peerWorldPosition(entryPeer) : null;
  }, [peers, blockSchedule.entryId]);
  const entryArrivalS =
    blockSchedule.entryId != null
      ? blockSchedule.arrivals[blockSchedule.entryId] ?? 0
      : 0;
  // The observed local node anchors the constellation + supplies the
  // version used for peer version-mismatch coloring. Prefer an explicit id
  // lookup over positional [0] so a registry reorder can't silently anchor
  // the wrong node; fall back to the first entry.
  const localNode =
    chainNodes.find((n) => n.id === 'ckb:local') ?? chainNodes[0];

  // Shared per-cell flash buffers, owned here so the NeuralNetwork overlay
  // can write cell→cell pulse arrivals into the same Float32Array CellShell
  // reads. burstArrivalRef carries terminal arrivals to DendriticBurst.
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef<boolean>(false);
  const burstArrivalRef = useRef<
    Map<number, { firedAt: number; color: [number, number, number] }>
  >(new Map());
  // The 3D cell-life scan sub-scene (CellLifeDetail3D) writes its GoL grid +
  // generation here each frame; CellDetailHudOverlay polls it (~10 Hz) to
  // draw the scan readout without forcing React re-renders.
  const scanStateRef = useRef<ScanStateRef | null>(null);

  // ckb node ids drive the icosahedra scatter inside the cell canopy. The
  // CkbDirectAdapter registers `ckb:local` on boot; fall back to a single
  // anchor so the galaxy always has one even before the registry arrives.
  const ckbNodeIds = useMemo(() => {
    const ids = chainNodes.map((n) => n.id);
    return ids.length > 0 ? ids : ['ckb:local'];
  }, [chainNodes]);

  const cellsStats = useMemo(
    () =>
      aggregateCellsStats(
        cellsCache.cells,
        cellsCache.totalBirths,
        cellsCache.totalDeaths,
      ),
    [cellsCache.cells, cellsCache.totalBirths, cellsCache.totalDeaths],
  );

  // Resolve the current selection into either a cell or a chain node.
  const selectedCell = useMemo(() => {
    if (!selectedId || !selectedId.startsWith(CELL_SELECT_PREFIX)) return null;
    const id = Number(selectedId.slice(CELL_SELECT_PREFIX.length));
    return Number.isFinite(id) ? cellsCache.cells.get(id) ?? null : null;
  }, [selectedId, cellsCache.cells]);
  const selectedNode = useMemo(() => {
    if (
      !selectedId ||
      selectedId.startsWith(CELL_SELECT_PREFIX) ||
      selectedId.startsWith('peer:')
    )
      return null;
    return chainNodes.find((n) => n.id === selectedId) ?? null;
  }, [selectedId, chainNodes]);
  const selectedPeer = useMemo(() => {
    if (!selectedId || !selectedId.startsWith('peer:')) return null;
    const id = selectedId.slice('peer:'.length);
    return peers.find((p) => p.node_id === id) ?? null;
  }, [selectedId, peers]);

  // In-canvas HUD layout — the always-on BLOCKCHAIN/NETWORK/CELLS panels now
  // live in the DOM HudOverlay; what remains here is the selection detail
  // panel (lower-left) and the backfill banner. Widths match the simulator's
  // defaults so the HUD copy fits without truncation.
  const DETAIL_PANEL_W = 250;
  const HUD_VIEWPORT_W = 1280;
  const HUD_VIEWPORT_H = 720;
  const detailX = -HUD_VIEWPORT_W / 2 + 20;
  const detailY = -HUD_VIEWPORT_H / 2 + 210;
  // 3D cell-life scan viewport — stacked just above the cell detail text
  // panel in the lower-left column.
  const SCAN_VIEWPORT_W = DETAIL_PANEL_W;
  const SCAN_VIEWPORT_H = 200;
  const DETAIL_GAP = 14;
  const scanViewportY = detailY + SCAN_VIEWPORT_H + DETAIL_GAP;

  return (
    <>
      {/* Leva knobs panel (DOM overlay) — hidden by default, backtick toggles. */}
      <Tweaks />
      <VersionMarker />
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />

      <CellGalaxyProvider value={cellsCache}>
        <Canvas
          camera={{ position: [110, 108, 110], fov: 50, near: 1, far: 3000 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: '#02030a' }}
          onPointerMissed={() => setSelectedId(null)}
        >
          {/* Advances the module-level simClock once per frame so every
              useSimFrame animation (CellGalaxy, BlockBeam, GlowNode,
              NeuralNetwork, PeerConstellation) actually plays. Must live
              under the r3f context; mount exactly once. */}
          <SimClockTicker />

          <Stars
            radius={400}
            depth={120}
            count={2000}
            factor={2}
            saturation={0}
            fade
            speed={0.3}
          />

          <CellGalaxy
            ckbNodeIds={ckbNodeIds}
            localReceiveDelayS={blockSchedule.localReceiveDelayS}
            entryWorld={entryWorld}
            entryArrivalS={entryArrivalS}
            selectedId={selectedId}
            onSelect={setSelectedId}
            cellFlashRef={cellFlashRef}
            flashDirtyRef={flashDirtyRef}
            overlay={
              <>
                {/* Cell→cell nerve pulses: each landed tx routes a bead
                    from its input cells to its outputs through the neighbour
                    graph, flashing cells en route and bursting at the
                    terminal. Ported from ckb-rcg's NeuralNetwork. */}
                <NeuralNetwork
                  cellFlashRef={cellFlashRef}
                  flashDirtyRef={flashDirtyRef}
                  burstArrivalRef={burstArrivalRef}
                  topology={galaxyConfig.topology}
                  pulses={galaxyConfig.pulses}
                />
                <DendriticBurst arrivalRef={burstArrivalRef} />
              </>
            }
          />

          {/* Real P2P peers ringing the local hub: radius = latency,
              color = direction / version-mismatch, with churn fade and a
              per-block inward convergence pulse. */}
          <PeerConstellation
            peers={peers}
            tip={chain.tip}
            localVersion={localNode?.version ?? ''}
            selectedId={selectedId}
            onSelect={setSelectedId}
            blockPulseAtMs={cellsCache.lastPulseAtMs}
            entryPeerId={blockSchedule.entryId}
            arrivals={blockSchedule.arrivals}
            senders={blockSchedule.senders}
          />

          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            minDistance={4}
            maxDistance={400}
            // Aim at the content's vertical center (chain plane y=22, cell
            // canopy y=38) instead of the world origin, so the scene sits
            // centered rather than pushed to the top. Matches CAMERA_PRESETS.default.
            target={[0, 18, 0]}
          />

          <Hud renderPriority={1}>
            <OrthographicCamera
              makeDefault
              left={-HUD_VIEWPORT_W / 2}
              right={HUD_VIEWPORT_W / 2}
              top={HUD_VIEWPORT_H / 2}
              bottom={-HUD_VIEWPORT_H / 2}
              near={-1000}
              far={1000}
              position={[0, 0, 100]}
            />
            <BackfillHud x={0} y={HUD_VIEWPORT_H / 2 - 60} width={260} />
            {selectedCell ? (
              <CellDetailHud
                cell={selectedCell}
                onClose={() => setSelectedId(null)}
                x={detailX}
                y={detailY}
                width={DETAIL_PANEL_W}
              />
            ) : null}
            {selectedCell ? (
              <>
                {/* Floating 3D cell-life scan: a Game-of-Life automaton
                    seeded from the cell's content_hash, with a bracket/text
                    overlay polling the shared scanStateRef. */}
                <CellLifeDetail3D
                  cell={selectedCell}
                  x={detailX}
                  y={scanViewportY}
                  width={SCAN_VIEWPORT_W}
                  height={SCAN_VIEWPORT_H}
                  scanStateRef={scanStateRef}
                />
                <CellDetailHudOverlay
                  scanStateRef={scanStateRef}
                  x={detailX}
                  y={scanViewportY}
                  width={SCAN_VIEWPORT_W}
                  height={SCAN_VIEWPORT_H}
                />
              </>
            ) : null}
            {selectedNode ? (
              <ChainNodeDetailHud
                node={selectedNode}
                chain={chain}
                x={detailX}
                y={detailY}
                width={DETAIL_PANEL_W}
              />
            ) : null}
            {selectedPeer ? (
              <PeerDetailHud
                peer={selectedPeer}
                chain={chain}
                x={detailX}
                y={detailY}
                width={DETAIL_PANEL_W}
              />
            ) : null}
          </Hud>
        </Canvas>
      </CellGalaxyProvider>
    </>
  );
}
