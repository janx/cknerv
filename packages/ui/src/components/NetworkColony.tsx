// NetworkColony — the assembled P2P "colony" that replaces the retired
// hub-and-spoke peer constellation. The peer network has its OWN visual language,
// a *data-flow mesh* (soft current along straight links), deliberately unlike the
// cells' neural galaxy (sharp spikes on curved dendrites). It composes:
//   • ColonyEdges — ALL edges as ONE glow-line primitive on a confidence gradient
//     (measured brighter, inferred fainter) carrying an ambient data-flow current
//     PLUS a per-block bright surge that flows outward along the propagation tree.
//   • ColonyNodes — the faint inferred cloud + bright measured nodes, unified as
//     ONE glow primitive on a confidence gradient (rendered OVER the edges). A
//     new block sends a radial brightness shockwave across these existing nodes;
//     the local "you" is the galaxy's anchor, not drawn here.
//   • ColonyCourierLayer — a faint glint accent riding the edge surge: a small,
//     dimmed glow-mote flung node→node along the shortest-path tree, timed by the
//     flood arrivals. The edge surge traces the actual route while the node
//     shockwave supplies the broad network response.
//   • BlockDeliveryLayer — one galaxy-facing carrier glyph per measured worker
//     (timed by cf.arrivals) plus the local source. Each glyph tightens, rises
//     contracting, and at contact is released as a front of that same
//     interrupted rim + real Cell illumination.
//
// Block wiring (ported from the retired hub-and-spoke layer): on each new block
// pulse we stamp `pulseRef` with { at: simClock.elapsedSec, entryId: cf.entryId };
// the delivery layer reads it every frame. Deliveries run off `colonyFlood`, so
// the measured workers already feed the galaxy on the flood's timing.
//
// Catch-up quiescence: during a backfill / large-restore-gap the cells projection
// SUPPRESSES the block Pulse delta server-side (cknerv-core projection/cells.rs:
// the Pulse delta is only pushed while `backfill.is_none()`), so `blockPulseAtMs`
// (= cellsCache.lastPulseAtMs) FREEZES. Every pulse effect below keys on it, so
// the flood + carriers are ALREADY quiet during catch-up (frozen pulse ⇒ no
// strobe). We ALSO gate every pulse effect on `backfillActive` as a defensive
// safety belt: should a pulse ever advance mid-backfill, we CONSUME it (advance
// the local guard so the backlog can't replay as one strobe when `backfill`
// clears) but do NOT fire — matching advanceLinkCursor's nerve suppression.
//
// The block wavefront belongs to the peer network: ColonyEdges carries the
// graph-accurate surge, ColonyNodes carries the broad brightness shockwave, and
// ColonyCourierLayer adds a faint glint. Each owner keys its clock on
// `blockPulseAtMs` and gates on `backfillActive` (consume-then-bail);
// NetworkColony keeps `cf`/`blockPulseAtMs`/`backfillActive` to feed the peer
// effects and to stamp its own `pulseRef` for delivery into the Cell field.
import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSimClock } from '../tweaks/SimClockScope';
import { useCellGalaxyOptional } from '../hooks/cellGalaxyContext';
import type { NetworkTopology, Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import ColonyNodes from './ColonyNodes';
import ColonyEdges from './ColonyEdges';
import ColonyCourierLayer from './ColonyCourierLayer';
import BlockDeliveryLayer, { type BlockDeliveryPulse } from './BlockDeliveryLayer';
import { consensusBlockColor } from '../derives/consensusFlow.derive';
import { dampContextEnergy } from '../nerve/contextDamp';
import {
  cellDetailPeerContextEnergy,
  cellDetailPeerLinkContextEnergy,
} from '../derives/sceneView.derive';
import type { CellFlashDirtyIdsRef } from './cellFlash';

interface NetworkColonyProps {
  topology: NetworkTopology;
  cf: ColonyFlood;
  /** Increments on each new block; stamps the delivery pulse. */
  blockPulseAtMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Galaxy's cell.id → scene-seconds flash map (owned by App/CellGalaxy). Each
   *  delivered carrier ignites the cells it lands on by writing here — the galaxy
   *  visibly RECEIVES the delivery through its existing flare path. */
  cellFlashRef: React.MutableRefObject<Map<number, number>>;
  flashDirtyRef: React.MutableRefObject<boolean>;
  flashDirtyIdsRef?: CellFlashDirtyIdsRef;
  /** Local node version — drives measured version-mismatch coloring (violet). */
  localVersion: string;
  /** Shared camera-distance focus. Optional keeps standalone scenes unchanged. */
  cellDetailViewFocusRef?: { readonly current: number };
  /** Optional overlay rendered inside the colony's group, so consumer layers
   *  (e.g. the peer inspection anchor) sit in colony space without coupling
   *  NetworkColony to them. Passive: the colony reads nothing from it. */
  overlay?: ReactNode;
}

function NetworkColony({
  topology,
  cf,
  blockPulseAtMs,
  selectedId,
  onSelect,
  cellFlashRef,
  flashDirtyRef,
  flashDirtyIdsRef,
  localVersion,
  cellDetailViewFocusRef,
  overlay,
}: NetworkColonyProps) {
  const simClock = useSimClock();
  // Calm catch-up signal (same flag beams/nerves already respect). Read via the
  // NON-throwing hook so the exported NetworkColony still mounts standalone
  // (galaxy-less scenes / tests) — matching its child BlockDeliveryLayer, which
  // is deliberately optional-context; a throwing read here would defeat that.
  const cellsCache = useCellGalaxyOptional();
  const backfillActive = !!cellsCache?.backfill;
  const nodeContextEnergyRef = useRef(1);
  const linkContextEnergyRef = useRef(1);
  useFrame((_, deltaSeconds) => {
    // Camera navigation is input, not simulation. When the camera closes on a
    // Cell, passive P2P structure recedes while block surges/couriers retain
    // full event energy. A peer selection keeps its own link context at full
    // energy, so the inspected node's neighbourhood stays legible up close.
    const detailFocus = selectedId === null
      ? cellDetailViewFocusRef?.current ?? 0
      : 0;
    nodeContextEnergyRef.current = dampContextEnergy(
      nodeContextEnergyRef.current,
      cellDetailPeerContextEnergy(detailFocus),
      deltaSeconds,
    );
    linkContextEnergyRef.current = dampContextEnergy(
      linkContextEnergyRef.current,
      cellDetailPeerLinkContextEnergy(detailFocus),
      deltaSeconds,
    );
  });

  // Per-block pulse: the delivery layer reads `at` (when it fired) and `entryId`
  // (the flood origin). Per-worker arrival times come from `cf.arrivals`.
  const pulseRef = useRef<BlockDeliveryPulse | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    // Consume the pulse even while backfilling so the backlog can't replay as one
    // strobe when `backfill` clears (mirrors advanceLinkCursor's cursor advance),
    // then bail WITHOUT stamping pulseRef → BlockDeliveryLayer fires no carriers.
    lastPulseRef.current = blockPulseAtMs;
    if (backfillActive) return;
    pulseRef.current = {
      at: simClock.elapsedSec,
      entryId: cf.entryId,
      color: consensusBlockColor(blockPulseAtMs),
    };
    // cf.entryId + backfillActive are read from the latest closure when
    // blockPulseAtMs advances (App recomputes cf + backfill + bumps blockPulseAtMs
    // from the same cells-cache render), so [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // ALL colony node launch points, keyed by node id. The courier hops the FULL
  // shortest-path tree (inferred nodes relay too), so it needs every node's
  // position. BlockDeliveryLayer safely SHARES this map: its planDeliveries only
  // emits a carrier for ids present in cf.arrivals (measured), and measured ⊆ all
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
      <ColonyEdges
        topology={topology}
        cf={cf}
        blockPulseAtMs={blockPulseAtMs}
        backfillActive={backfillActive}
        contextEnergyRef={linkContextEnergyRef}
      />
      <ColonyNodes
        topology={topology}
        cf={cf}
        blockPulseAtMs={blockPulseAtMs}
        backfillActive={backfillActive}
        selectedId={selectedId}
        onSelect={onSelect}
        localVersion={localVersion}
        contextEnergyRef={nodeContextEnergyRef}
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
        flashDirtyIdsRef={flashDirtyIdsRef}
      />
      {overlay}
    </group>
  );
}

// Memoized alongside the other two scene roots. This body is short, but the
// four layers it mounts are not, and reconciling them cost a render apiece for
// every App state change that never touched the colony. `topology` and `cf` are
// already memoized upstream on a peer content signature, so a poll that finds
// the same peers now stops here. The backfill flag still arrives by context.
export default memo(NetworkColony);
