// NetworkColony — the assembled P2P "colony" that replaces the retired
// hub-and-spoke peer constellation. It composes:
//   • ColonyEdges — ALL edges as ONE static glow-line primitive on a confidence
//     gradient (measured brighter, inferred fainter); no per-block pulse
//   • ColonyNodes — the faint inferred cloud + bright measured nodes, unified as
//     ONE glow primitive on a confidence gradient (rendered OVER the edges); the
//     local "you" is the galaxy's anchor, not drawn here
//   • ColonyCourierLayer — the block flood: a thrown glow-mote + comet tail flung
//     node→node outward from the flood origin along the shortest-path tree
//     (colonyCourierSchedule), timed by the flood arrivals. Owns its own pulse.
//   • BlockDeliveryLayer — one bolus per measured worker (timed by cf.arrivals)
//     plus the local hero (cf.localReceiveDelayS), lobbed up into the cell
//     canopy and igniting the cells each lands on.
//
// Block wiring (ported from the retired hub-and-spoke layer): on each new block
// pulse we stamp `pulseRef` with { at: simClock.elapsedSec, entryId: cf.entryId };
// the delivery layer reads it every frame. Boluses run off `colonyFlood`, so the
// measured workers already feed the galaxy on the flood's timing.
//
// Catch-up quiescence: during a backfill / large-restore-gap the cells projection
// SUPPRESSES the block Pulse delta server-side (cknerv-core projection/cells.rs:
// the Pulse delta is only pushed while `backfill.is_none()`), so `blockPulseAtMs`
// (= cellsCache.lastPulseAtMs) FREEZES. Every pulse effect below keys on it, so
// the flood + boluses are ALREADY quiet during catch-up (frozen pulse ⇒ no
// strobe). We ALSO gate every pulse effect on `backfillActive` as a defensive
// safety belt: should a pulse ever advance mid-backfill, we CONSUME it (advance
// the local guard so the backlog can't replay as one strobe when `backfill`
// clears) but do NOT fire — matching advanceLinkCursor's nerve suppression.
//
// The block flood no longer lives in the edges/nodes: both ColonyEdges (static
// glow-lines) and ColonyNodes (static glow-nodes) are flood-free — the spreading
// wavefront is owned entirely by the courier / BlockDeliveryLayer. So neither takes
// block timing; NetworkColony keeps `cf`/`blockPulseAtMs`/`backfillActive` only to
// stamp `pulseRef` (and feed `cf.arrivals`) for the delivery layer.
import { useEffect, useMemo, useRef } from 'react';
import { simClock } from '../tweaks/simClock';
import { useCellGalaxyOptional } from '../hooks/cellGalaxyContext';
import type { NetworkTopology, Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import ColonyNodes from './ColonyNodes';
import ColonyEdges from './ColonyEdges';
import ColonyCourierLayer from './ColonyCourierLayer';
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
  // Calm catch-up signal (same flag beams/nerves already respect). Read via the
  // NON-throwing hook so the exported NetworkColony still mounts standalone
  // (galaxy-less scenes / tests) — matching its child BlockDeliveryLayer, which
  // is deliberately optional-context; a throwing read here would defeat that.
  const cellsCache = useCellGalaxyOptional();
  const backfillActive = !!cellsCache?.backfill;

  // Per-block pulse: the delivery layer reads `at` (when it fired) and `entryId`
  // (the flood origin). Per-worker arrival times come from `cf.arrivals`.
  const pulseRef = useRef<{ at: number; entryId: string | null } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    // Consume the pulse even while backfilling so the backlog can't replay as one
    // strobe when `backfill` clears (mirrors advanceLinkCursor's cursor advance),
    // then bail WITHOUT stamping pulseRef → BlockDeliveryLayer fires no boluses.
    lastPulseRef.current = blockPulseAtMs;
    if (backfillActive) return;
    pulseRef.current = { at: simClock.elapsedSec, entryId: cf.entryId };
    // cf.entryId + backfillActive are read from the latest closure when
    // blockPulseAtMs advances (App recomputes cf + backfill + bumps blockPulseAtMs
    // from the same cells-cache render), so [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // ALL colony node launch points, keyed by node id. The courier hops the FULL
  // shortest-path tree (inferred nodes relay too), so it needs every node's
  // position. BlockDeliveryLayer safely SHARES this map: its planDeliveries only
  // emits a bolus for ids present in cf.arrivals (measured), and measured ⊆ all
  // nodes — the extra inferred/local keys are skipped (no arrival → no delivery,
  // and the local id is fed separately via localOrigins), so the delivery set is
  // byte-identical to the old measured-only map.
  const posById = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const n of topology.nodes) m.set(n.id, n.pos);
    return m;
  }, [topology]);
  // The single local/hero origin. inferredTopology always emits exactly one
  // 'local' node; guard defensively so a degenerate topology renders no hero
  // rather than crashing.
  const localOrigins = useMemo<Vec3[]>(() => {
    const local = topology.nodes.find((n) => n.kind === 'local');
    return local ? [local.pos] : [];
  }, [topology]);

  return (
    <group>
      <ColonyEdges topology={topology} />
      <ColonyNodes
        topology={topology}
        selectedId={selectedId}
        onSelect={onSelect}
        localVersion={localVersion}
      />
      <ColonyCourierLayer
        cf={cf}
        posById={posById}
        blockPulseAtMs={blockPulseAtMs}
        backfillActive={backfillActive}
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
