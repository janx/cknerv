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
import type { Group } from 'three';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useCellGalaxyOptional } from '../hooks/cellGalaxyContext';
import { LIVE } from '../tweaks/liveTweaks';
import { colonyFrame } from '../tweaks/colonyFrame';
import type { NetworkTopology, Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import type { ProducerStanding } from '../derives/blockProducers.derive';
import ColonyNodes from './ColonyNodes';
import ColonyEdges from './ColonyEdges';
import ColonyIntakeMotes from './ColonyIntakeMotes';
import ColonyCourierLayer from './ColonyCourierLayer';
import BlockDeliveryLayer, { type BlockDeliveryPulse } from './BlockDeliveryLayer';
import { consensusBlockColor } from '../derives/consensusFlow.derive';
import { dampContextEnergy } from '../nerve/contextDamp';
import {
  dampCellGalaxyRotationScale,
  networkColonyRotationScaleTarget,
} from '../derives/cellInteraction.derive';
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
  /** The chain's recent miners, LIVE. Passed straight through to the intake
   *  layer, which draws each one's streams at a rate its share of the window
   *  sets: the topology is keyed on the producer key set alone (a per-block key
   *  would rebuild the colony's geometry once a block and truncate every
   *  in-flight wave), so the standings hanging off the staged nodes are stale
   *  between key-set changes and this is the live reading.
   *
   *  ⚠️ It is `BlockProducerView`'s `staging` array — key-ascending, the same
   *  sequence the topology was built from — and never `ranked`, which is
   *  ordered by a tally. Nothing below reads it positionally today; the intake
   *  planner walks EDGE order and looks each miner's share up by key. */
  producers?: readonly ProducerStanding[] | null;
  /** Shared camera-distance focus. Optional keeps standalone scenes unchanged. */
  cellDetailViewFocusRef?: { readonly current: number };
  /** Optional overlay rendered inside the colony's ROTATING group, so
   *  consumer layers (e.g. the peer inspection anchor) sit in colony space —
   *  and turn with it — without coupling NetworkColony to them. Passive: the
   *  colony reads nothing from it. */
  overlay?: ReactNode;
  /** The colony counter-rotates against the cell canopy by default (same
   *  rate knob, opposite sign). Review labs opt out: their two-anchor chain
   *  registry stands the local node OFF the rotation axis, and a fixed review
   *  framing must not have its subject carried out of shot. */
  rotationEnabled?: boolean;
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
  producers,
  cellDetailViewFocusRef,
  overlay,
  rotationEnabled = true,
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
  // The colony's structural body (edges + nodes + inspection anchors) turns
  // as one piece inside this group; the courier glints and the delivery
  // carriers stay OUTSIDE in world space (their per-frame billboard math is
  // world-frame) and follow the turn by reading `colonyFrame.rotationY`.
  const rotationGroupRef = useRef<Group>(null);
  const rotationScaleRef = useRef(1);
  // Counter-rotation: the canopy's own rate knob with the sign flipped, so
  // the two planes slowly shear against each other instead of reading as
  // one rigid body. A peer/sighted selection eases the colony to the same
  // inspection tempo a Cell selection gives the canopy. The axis is the
  // world Y axis the canopy turns about; App pins the colony's local node
  // onto the chain anchor at that axis, so the world-mounted icosahedron
  // never detaches from the measured belts converging on it.
  //
  // ⚠️ The SIM clock, on the canopy's own dt, because "the same knob with the
  // sign flipped" is a contract about two planes and not about one of them: on
  // the raw clock the colony went on turning against a frozen canopy under a
  // pause or any timeScale, and every world-space reader of
  // `colonyFrame.rotationY` — delivery launches, courier hops — is itself on
  // the sim clock and snapped back on resume. The colony now freezes with the
  // canopy under the Time controls, which is what the shear means.
  //
  // Ahead of the raw frame below, which publishes the angle: this component's
  // callbacks run before its children's, so the couriers and the delivery
  // layer read the turn this frame took rather than the last one.
  useSimFrame((_, dt) => {
    const rotationGroup = rotationGroupRef.current;
    if (!rotationGroup || !rotationEnabled) return;
    rotationScaleRef.current = dampCellGalaxyRotationScale(
      rotationScaleRef.current,
      networkColonyRotationScaleTarget(selectedId),
      dt,
    );
    rotationGroup.rotation.y -= LIVE.galaxy.rotationRate
      * rotationScaleRef.current
      * dt;
  });
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
    // Mirror to the shared frame so the world-space sibling layers can carry
    // colony-frame positions through the live rotation. Raw and
    // unconditional, where the turn itself is neither: the group holds 0 when
    // rotation is disabled, and the singleton must not keep a stale angle from
    // a previously mounted colony — including while time is paused, when the
    // turn above does not run at all.
    const rotationGroup = rotationGroupRef.current;
    if (rotationGroup) colonyFrame.rotationY = rotationGroup.rotation.y;
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
      {/* The colony's structural body — every drawn node and edge, plus the
          inspection anchors tethering DOM cards to nodes — counter-rotates
          as one piece. Static geometry rides the group transform for free;
          picking raycasts and the anchors' matrixWorld projections follow it
          without any per-layer math. */}
      <group ref={rotationGroupRef}>
        <ColonyEdges
          topology={topology}
          cf={cf}
          blockPulseAtMs={blockPulseAtMs}
          backfillActive={backfillActive}
          contextEnergyRef={linkContextEnergyRef}
        />
        {/* Drawn between the links and the marks, because that is what it is:
            a mote riding a link, swallowed by the node at its end. */}
        <ColonyIntakeMotes
          topology={topology}
          producers={producers}
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
        {overlay}
      </group>
      {/* World space, deliberately outside the rotating group: both layers
          rebuild world-frame billboard bases from the camera every frame and
          bridge into galaxy-frame math (`galaxyFrame`), so they carry the
          colony-frame positions through the rotation themselves by reading
          `colonyFrame.rotationY` instead of inheriting a parent transform
          their math would then have to undo. */}
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
    </group>
  );
}

// Memoized alongside the other two scene roots. This body is short, but the
// four layers it mounts are not, and reconciling them cost a render apiece for
// every App state change that never touched the colony. `topology` and `cf` are
// already memoized upstream on a peer content signature, so a poll that finds
// the same peers now stops here. The backfill flag still arrives by context.
export default memo(NetworkColony);
