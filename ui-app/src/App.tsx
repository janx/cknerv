// Default SPA for the `cknerv` binary. Bootstraps from the chain + cells
// snapshots, then subscribes to the live WS streams so the cell galaxy
// fills in and block pulses fire as the chain advances. Renders a 3D
// canvas (CellGalaxy canopy), two HUD panels (network + cells stats), and
// a selection detail panel — CellDetailHud for a clicked cell, or a
// chain-node panel for a clicked CKB icosahedron. The leva knobs panel is
// hidden by default (toggle with backtick) — see Tweaks.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Hud, OrbitControls, OrthographicCamera, Stars } from '@react-three/drei';
import {
  aggregateCellsStats,
  BackfillHud,
  CellDetailHud,
  CellDetailHudOverlay,
  CellGalaxy,
  CellGalaxyProvider,
  CellLifeDetail3D,
  CellsHud,
  CkbNetworkHud,
  DendriticBurst,
  NeuralNetwork,
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
} from '@cknerv/types';
import Tweaks from './Tweaks';
import VersionMarker from './VersionMarker';
import ChainNodeDetailHud from './ChainNodeDetailHud';
import { resolveGalaxyConfig } from './runtime-config';

/** CellGalaxy emits `cell:<id>` for a clicked cell and the bare node id
 *  for a clicked CKB icosahedron. The prefix discriminates the two. */
const CELL_SELECT_PREFIX = 'cell:';

interface AppProps {
  /** Initial Chain entity from `/api/entities/chain/snapshot`. */
  initialChain: ChainEntry;
  /** Initial chain-node registry (one entry per RPC the adapter observes). */
  initialChainNodes: ChainNode[];
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
    // Peers are ephemeral (never bootstrapped); the WS stream's first
    // snapshot / peers_updated delta fills this in.
    peers: [],
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
        peers: [],
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
    if (!selectedId || selectedId.startsWith(CELL_SELECT_PREFIX)) return null;
    return chainNodes.find((n) => n.id === selectedId) ?? null;
  }, [selectedId, chainNodes]);

  // HUD layout — left column hosts the network panel, right column hosts
  // the cells stats, and the selection detail panel sits lower-left (clear
  // of the network panel above it). Widths match the simulator's defaults
  // so the HUD copy fits without truncation.
  const NETWORK_PANEL_W = 240;
  const NETWORK_PANEL_H = 256;
  const CELLS_PANEL_W = 220;
  const DETAIL_PANEL_W = 250;
  const HUD_VIEWPORT_W = 1280;
  const HUD_VIEWPORT_H = 720;
  const networkX = -HUD_VIEWPORT_W / 2 + 20;
  const networkY = HUD_VIEWPORT_H / 2 - 20;
  const cellsX = HUD_VIEWPORT_W / 2 - CELLS_PANEL_W - 20;
  const cellsY = HUD_VIEWPORT_H / 2 - 20;
  const detailX = -HUD_VIEWPORT_W / 2 + 20;
  const detailY = -HUD_VIEWPORT_H / 2 + 210;
  // 3D cell-life scan viewport — stacked just above the cell detail text
  // panel in the lower-left column, clear of the network panel above it.
  const SCAN_VIEWPORT_W = DETAIL_PANEL_W;
  const SCAN_VIEWPORT_H = 200;
  const DETAIL_GAP = 14;
  const scanViewportY = detailY + SCAN_VIEWPORT_H + DETAIL_GAP;

  return (
    <>
      {/* Leva knobs panel (DOM overlay) — hidden by default, backtick toggles. */}
      <Tweaks />
      <VersionMarker />

      <CellGalaxyProvider value={cellsCache}>
        <Canvas
          camera={{ position: [110, 108, 110], fov: 50, near: 1, far: 3000 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: '#02030a' }}
          onPointerMissed={() => setSelectedId(null)}
        >
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

          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            minDistance={4}
            maxDistance={400}
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
            <CkbNetworkHud
              x={networkX}
              y={networkY}
              width={NETWORK_PANEL_W}
              height={NETWORK_PANEL_H}
              chain={chain}
            />
            <CellsHud
              x={cellsX}
              y={cellsY}
              width={CELLS_PANEL_W}
              stats={cellsStats}
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
          </Hud>
        </Canvas>
      </CellGalaxyProvider>
    </>
  );
}
