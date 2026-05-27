// Minimal default SPA for the `cknerv` binary. Bootstraps from the
// chain + cells snapshots, mounts a 3D canvas with the CellGalaxy
// canopy, and renders two HUD panels (network + cells stats). No
// live deltas, no selection details, no RCG overlays — those are
// out of scope for the C2 MVP per the Phase C plan.

import { useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Hud, OrbitControls, OrthographicCamera, Stars } from '@react-three/drei';
import {
  aggregateCellsStats,
  CellGalaxy,
  CellGalaxyProvider,
  CellsHud,
  CkbNetworkHud,
} from '@cknerv/ui';
import {
  fromCellsSnapshot,
  type CellGalaxyCache,
} from '@cknerv/cache';
import type {
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
} from '@cknerv/types';

interface AppProps {
  /** Initial Chain entity from `/api/entities/chain/snapshot`. */
  initialChain: ChainEntry;
  /** Initial chain-node registry (one entry per RPC the adapter is observing). */
  initialChainNodes: ChainNode[];
  /** Initial cell-galaxy projection snapshot from
   *  `/api/projections/cells/snapshot`. */
  initialCells: CellGalaxySnapshot;
  /** Revision attached to the cells snapshot — fed into the cache so a
   *  future WS-stream layer can resume with `?since=`. */
  initialCellsRevision: number;
}

export default function App({
  initialChain,
  initialChainNodes,
  initialCells,
  initialCellsRevision,
}: AppProps) {
  // Snapshot-only for MVP. Streaming deltas (chain + projection) is a
  // C3+ concern.
  const [chain] = useState<ChainEntry>(initialChain);
  const [chainNodes] = useState<ChainNode[]>(initialChainNodes);
  const [cellsCache] = useState<CellGalaxyCache>(() =>
    fromCellsSnapshot(initialCellsRevision, initialCells),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // CellGalaxy expects shared per-cell flash buffers owned by the
  // consumer (so overlay layers like NeuralNetwork can write into the
  // same Float32Array CellShell reads). MVP has no overlays, but the
  // refs are still required props — wire empty ones.
  const cellFlashRef = useRef<Map<number, number>>(new Map());
  const flashDirtyRef = useRef<boolean>(false);

  // ckb node ids drive the icosahedra scatter inside the cell canopy.
  // The CkbDirectAdapter registers `ckb:local` on boot; pull whatever
  // chain_nodes the snapshot carries plus a single fallback so the
  // galaxy always has at least one anchor.
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

  // HUD layout — left column hosts the network panel, right column
  // hosts the cells stats. Width values match the simulator's defaults
  // so the HUD copy fits without truncation.
  const NETWORK_PANEL_W = 240;
  const NETWORK_PANEL_H = 256;
  const CELLS_PANEL_W = 220;
  const HUD_VIEWPORT_W = 1280;
  const HUD_VIEWPORT_H = 720;
  const networkX = -HUD_VIEWPORT_W / 2 + 20;
  const networkY = HUD_VIEWPORT_H / 2 - 20;
  const cellsX = HUD_VIEWPORT_W / 2 - CELLS_PANEL_W - 20;
  const cellsY = HUD_VIEWPORT_H / 2 - 20;

  return (
    <CellGalaxyProvider value={cellsCache}>
      <Canvas
        camera={{ position: [110, 108, 110], fov: 50, near: 1, far: 3000 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: '#02030a' }}
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
        </Hud>
      </Canvas>
    </CellGalaxyProvider>
  );
}
