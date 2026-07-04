// Orchestrator for the cells neural network.
//
// Pipeline:
//   1. cellsCache changes → rebuild the spatial neighbour graph and
//      hand the new edge set to NeuralFabric.
//   2. Each new CellLink delta → planPulses derives source cells from
//      parent tx siblings + finds shortest paths to the new outputs
//      through the neighbour graph. Each pulse is queued.
//   3. Per frame, every active pulse advances by elapsed/HOP_MS hops,
//      lights up the current hop's edge in the active fabric layer,
//      drives the spike head sprite, flashes the cells it crosses,
//      and triggers a DendriticBurst when it lands on the terminal.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { buildNeighborGraph, emptyNeighborGraph, type NeighborGraph } from '../geometry/neighborGraph';
import { type Pulse, type PulsePlanningOptions } from './pulseRunner';
import { planLinkBatch, tickBlockIfAdvanced } from './pulseBatch';
import { pulseStats } from './pulseStats';
import NeuralFabric, { type NeuralFabricHandles } from './NeuralFabric';
import { bezierAt, bezierControl, fabricEdgeSeed } from '../geometry/edgeBezier';
import { SpikePool } from './spikePool';
import type { Vec3 } from '../types';

const SPIKE_POOL_CAPACITY = 1024;

/** Soft cap on concurrent pulses. Anything above this drops oldest
 *  first — keeps the visual coherent during burst-block activity. */
const MAX_ACTIVE_PULSES = 256;

/** Small white-hot accent sprite at the wavefront position. Only
 *  there to give the leading edge a sharp focal point — the lit
 *  curve does the heavy lifting visually. */
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
/** Throttle the spatial-graph rebuild. With ~1500 cells, k-NN +
 *  MST stitching costs ~30-60 ms; the cells projection emits a
 *  delta several times a second, so without throttling we'd burn
 *  hundreds of ms per second on rebuilds we don't need. */
const REBUILD_THROTTLE_MS = 250;

interface NeuralNetworkProps {
  cellFlashRef?: React.RefObject<Map<number, number>>;
  flashDirtyRef?: React.MutableRefObject<boolean>;
  burstArrivalRef?: React.RefObject<Map<number, { firedAt: number; color: Vec3 }>>;
  topology?: {
    neighborK?: number;
    maxEdgeLength?: number;
    maxHops?: number;
  };
  pulses?: PulsePlanningOptions & {
    maxActivePulses?: number;
  };
}

interface ActivePulse extends Pulse {
  startSec: number;
}

export default function NeuralNetwork({
  cellFlashRef,
  flashDirtyRef,
  burstArrivalRef,
  topology,
  pulses,
}: NeuralNetworkProps = {}) {
  const cellsCache = useCellGalaxy();

  // Neighbour graph rebuilds only when cell *membership* (the set of
  // ids) actually changes — i.e. on birth/gc deltas. Death and tag
  // deltas leave the id set + every cell's pos_seed identical, so the
  // graph and fabric layout are unaffected and the rebuild would be
  // pure waste. Profile-confirmed: setFabric + buildNeighborGraph were
  // the dominant single-frame freezes (up to 244ms) before this skip.
  //
  // The build itself is still O(N²) on raw cells.size, and the
  // cells projection fires deltas several times a second. The throttle
  // is now a debounce inside the membership-changed path: when births/
  // GCs cluster, we coalesce them.
  const graphRef = useRef<NeighborGraph>(emptyNeighborGraph());
  const lastRebuildAtRef = useRef<number>(0);
  const pendingRebuildRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** FNV-1a-ish hash over (size, ids). Cheap (one O(N) pass over keys),
   *  order-invariant via XOR. Sentinel `-1` triggers the first build. */
  const lastMembershipHashRef = useRef<number>(-1);
  useEffect(() => {
    // Compute a hash that captures the SET of cell ids. Death and tag
    // deltas don't change keys → hash unchanged → skip rebuild.
    let idsXor = 0;
    for (const id of cellsCache.cells.keys()) {
      idsXor ^= id;
    }
    const membershipHash = (cellsCache.cells.size * 0x100000) ^ idsXor;
    if (membershipHash === lastMembershipHashRef.current) return;
    lastMembershipHashRef.current = membershipHash;

    function doRebuild() {
      pendingRebuildRef.current = null;
      graphRef.current = buildNeighborGraph(cellsCache.cells, {
        k: topology?.neighborK,
        maxEdgeLength: topology?.maxEdgeLength,
      });
      fabricHandlesRef.current?.setFabric(
        graphRef.current,
        cellsCache.cells,
        simClock.elapsedSec,
      );
      lastRebuildAtRef.current = performance.now();
    }
    const now = performance.now();
    const sinceLast = now - lastRebuildAtRef.current;
    if (pendingRebuildRef.current) {
      clearTimeout(pendingRebuildRef.current);
      pendingRebuildRef.current = null;
    }
    if (sinceLast >= REBUILD_THROTTLE_MS) {
      doRebuild();
    } else {
      pendingRebuildRef.current = setTimeout(
        doRebuild,
        REBUILD_THROTTLE_MS - sinceLast,
      );
    }
    return () => {
      if (pendingRebuildRef.current) {
        clearTimeout(pendingRebuildRef.current);
        pendingRebuildRef.current = null;
      }
    };
  }, [cellsCache.revision, cellsCache.cells, topology?.neighborK, topology?.maxEdgeLength]);

  // Pulse queue. Pulses are removed when their head reaches the
  // terminal cell (or after a generous fallback lifetime).
  const pulsesRef = useRef<ActivePulse[]>([]);
  const lastLinksSeqRef = useRef<number>(0);
  useEffect(() => {
    // Decide which links fire + plan their pulses. While a backfill/catch-up
    // is active this returns planned=[] but still advances the cursor, so the
    // storm is suppressed and the window does not replay when `backfill`
    // clears. Drop reasons + per-block rollup are recorded into pulseStats.
    const { planned, nextSeq } = planLinkBatch(
      cellsCache.recentLinks,
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
    const startSec = simClock.elapsedSec;
    for (const p of planned) {
      pulsesRef.current.push({ ...p, startSec });
    }
    // Soft cap — drop oldest if we're way over.
    const maxActivePulses = pulses?.maxActivePulses ?? MAX_ACTIVE_PULSES;
    if (pulsesRef.current.length > maxActivePulses) {
      const overflow = pulsesRef.current.length - maxActivePulses;
      pulsesRef.current.splice(0, overflow);
    }
  }, [
    cellsCache.recentLinks,
    cellsCache.cells,
    cellsCache.backfill,
    topology?.maxHops,
    pulses?.maxPulsesPerLink,
    pulses?.maxSourcesPerParent,
    pulses?.maxActivePulses,
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

  // SpikePool sprites for the moving Na+ heads.
  const spikePool = useMemo(() => new SpikePool(SPIKE_POOL_CAPACITY), []);
  useEffect(() => () => spikePool.dispose(), [spikePool]);

  // NeuralFabric hands us imperative draw handles via onReady.
  const fabricHandlesRef = useRef<NeuralFabricHandles | null>(null);
  const onFabricReady = useCallback((handles: NeuralFabricHandles) => {
    fabricHandlesRef.current = handles;
    // Re-derive immediately in case cellsCache had already populated
    // before the fabric mounted.
    handles.setFabric(graphRef.current, cellsCache.cells, simClock.elapsedSec);
  }, [cellsCache.cells]);

  // Per-frame: roll every active pulse forward, light up the current
  // hop's edge, push the spike head sprite, flash the receiving
  // cells, fire DendriticBurst at the terminal.
  useSimFrame((state) => {
    const now = simClock.elapsedSec;
    spikePool.beginFrame();
    const handles = fabricHandlesRef.current;
    const cells = cellsCache.cells;

    // Drive growth/decay animation on the persistent fabric layer.
    // Internally gated: no-op when nothing is animating and nothing
    // has changed since last commit, so this is free in steady state.
    handles?.emitFabric(now);

    // Live adjacency snapshot for this frame. Pulses ride only edges
    // that exist in this graph; when a hop's edge has been dropped
    // (cell GC, rebuild after membership delta) the pulse — or that
    // individual trail hop — extinguishes. Single calculation path:
    // the same adjacency the fabric layer is rendering, so the
    // active layer can never light up a fibre that isn't there.
    const adjacency = graphRef.current.adjacency;
    const stillActive: ActivePulse[] = [];
    for (const pulse of pulsesRef.current) {
      // Each pulse has its own start delay (jitter) and hop duration
      // (speed scale). Subtract the delay before checking elapsed.
      const rawElapsedMs = (now - pulse.startSec) * 1000;
      const elapsedMs = rawElapsedMs - pulse.startDelayMs;
      const totalHops = pulse.path.length - 1; // edges, not nodes
      if (totalHops <= 0) continue;
      // Pulse hasn't started yet (still in its jitter delay).
      if (elapsedMs < 0) {
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
        if (burstArrivalRef?.current) {
          const prev = burstArrivalRef.current.get(term);
          if (!prev || arriveAt > prev.firedAt) {
            burstArrivalRef.current.set(term, {
              firedAt: arriveAt,
              color: pulse.color,
            });
          }
        }
        // Final cell flash on the terminal too.
        if (cellFlashRef?.current) {
          const prev = cellFlashRef.current.get(term) ?? -1e9;
          if (arriveAt > prev) {
            cellFlashRef.current.set(term, arriveAt);
            if (flashDirtyRef) flashDirtyRef.current = true;
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
              frontT,
              brightness,
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
        const [cx, cy, cz] = bezierControl(
          fromCell.pos_seed[0], fromCell.pos_seed[1], fromCell.pos_seed[2],
          toCell.pos_seed[0], toCell.pos_seed[1], toCell.pos_seed[2],
          seed,
        );
        const [x, y, z] = bezierAt(
          fromCell.pos_seed[0], fromCell.pos_seed[1], fromCell.pos_seed[2],
          cx, cy, cz,
          toCell.pos_seed[0], toCell.pos_seed[1], toCell.pos_seed[2],
          subT,
        );
        spikePool.push({
          position: [x, y, z],
          color: pulse.color,
          size: SPIKE_SIZE,
          alpha: SPIKE_ALPHA,
          whiteBias: 0.95,
        });
      }

      // Cell flash on the cell we *arrive at* during this hop. Schedule
      // exactly when subT crosses 1 (= when we land on the next cell).
      if (cellFlashRef?.current) {
        const arrivingCellId = pulse.path[headHop + 1];
        const arriveAt =
          pulse.startSec + (pulse.startDelayMs + (headHop + 1) * hopMs) / 1000;
        const prev = cellFlashRef.current.get(arrivingCellId) ?? -1e9;
        if (arriveAt > prev) {
          cellFlashRef.current.set(arrivingCellId, arriveAt);
          if (flashDirtyRef) flashDirtyRef.current = true;
        }
      }
    }
    pulsesRef.current = stillActive;

    handles?.flushActive();
    spikePool.endFrame(state.size.height, state.viewport.dpr ?? 1);
  });

  return (
    <>
      <NeuralFabric onReady={onFabricReady} />
      <primitive object={spikePool.mesh} />
    </>
  );
}
