// NetworkColony — the assembled P2P "colony" that replaces the retired
// hub-and-spoke PeerConstellation. It composes:
//   • ColonyEdges — the gossamer inferred mesh + one live belt per measured edge
//   • ColonyNodes — the faint inferred cloud + bright measured crystals + the
//     local "you" marker (rendered OVER the edges)
//   • BlockDeliveryLayer — one bolus per measured worker (timed by cf.arrivals)
//     plus the local hero (cf.localReceiveDelayS), lobbed up into the cell
//     canopy and igniting the cells each lands on.
//
// Block wiring is ported from PeerConstellation (:155-232): on each new block
// pulse we stamp `pulseRef` with { at: simClock.elapsedSec, entryId: cf.entryId };
// the delivery layer reads it every frame. Boluses run off `colonyFlood`, so the
// measured workers already feed the galaxy on the flood's timing.
//
// `flashRef` / `edgePulseRef` are created here, handed to ColonyNodes/ColonyEdges
// (which bind their real GPU buffers into them via useLayoutEffect), and passed
// through — but they stay INERT this task. Task 9's wavefront flood writes them
// off cf.colonyArrivalS / cf.colonyPredecessor.
import { useEffect, useMemo, useRef } from 'react';
import { simClock } from '../tweaks/simClock';
import type { NetworkTopology, Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import ColonyNodes from './ColonyNodes';
import ColonyEdges from './ColonyEdges';
import BlockDeliveryLayer from './BlockDeliveryLayer';

interface NetworkColonyProps {
  topology: NetworkTopology;
  cf: ColonyFlood;
  /** Increments on each new block; stamps the delivery pulse. */
  blockPulseAtMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Galaxy's cell.id → scene-seconds flash map (owned by App/CellGalaxy). Each
   *  delivered bolus ignites the cells it lands on by writing here — the galaxy
   *  visibly RECEIVES the delivery through its existing flare path. */
  cellFlashRef: React.MutableRefObject<Map<number, number>>;
  flashDirtyRef: React.MutableRefObject<boolean>;
  /** Local node version — drives measured version-mismatch coloring (violet). */
  localVersion: string;
}

export default function NetworkColony({
  topology,
  cf,
  blockPulseAtMs,
  selectedId,
  onSelect,
  cellFlashRef,
  flashDirtyRef,
  localVersion,
}: NetworkColonyProps) {
  // Per-block pulse: the delivery layer reads `at` (when it fired) and `entryId`
  // (the flood origin). Per-worker arrival times come from `cf.arrivals`. Same
  // effect shape as PeerConstellation:155-168.
  const pulseRef = useRef<{ at: number; entryId: string | null } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs > lastPulseRef.current) {
      lastPulseRef.current = blockPulseAtMs;
      pulseRef.current = { at: simClock.elapsedSec, entryId: cf.entryId };
    }
    // cf.entryId is read from the latest closure when blockPulseAtMs advances (App
    // recomputes cf + bumps blockPulseAtMs from the same cells-cache render), so
    // [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // Measured-worker launch points (bolus origins), keyed by node id.
  const posById = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const n of topology.nodes) if (n.kind === 'measured') m.set(n.id, n.pos);
    return m;
  }, [topology]);
  // The single local/hero origin. inferredTopology always emits exactly one
  // 'local' node; guard defensively so a degenerate topology renders no hero
  // rather than crashing.
  const localOrigins = useMemo<Vec3[]>(() => {
    const local = topology.nodes.find((n) => n.kind === 'local');
    return local ? [local.pos] : [];
  }, [topology]);

  // Flash / edge-pulse buffers owned here; ColonyNodes / ColonyEdges bind their
  // real GPU arrays into these refs (useLayoutEffect handoff). INERT this task —
  // Task 9's flood writes them off cf's colony maps.
  const flashRef = useRef<Float32Array>(new Float32Array(0));
  const edgePulseRef = useRef<Float32Array>(new Float32Array(0));

  return (
    <group>
      <ColonyEdges
        topology={topology}
        edgePulseRef={edgePulseRef}
        localVersion={localVersion}
      />
      <ColonyNodes
        topology={topology}
        flashRef={flashRef}
        selectedId={selectedId}
        onSelect={onSelect}
        localVersion={localVersion}
      />
      <BlockDeliveryLayer
        posById={posById}
        arrivals={cf.arrivals}
        localOrigins={localOrigins}
        localReceiveDelayS={cf.localReceiveDelayS}
        pulseRef={pulseRef}
        cellFlashRef={cellFlashRef}
        flashDirtyRef={flashDirtyRef}
      />
    </group>
  );
}
