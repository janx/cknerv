// Orchestrator for the Cell consensus-flow overlay.
//
// Pipeline:
//   1. cellsCache changes → rebuild the spatial neighbour graph and
//      hand the new edge set to NeuralFabric.
//   2. Each new CellLink delta → planPulses derives source cells from
//      parent tx siblings + finds shortest paths to the new outputs
//      through the neighbour graph. Each pulse is queued.
//   3. Per frame, every active pulse advances by elapsed/HOP_MS hops,
//      lights up the current hop's edge in the active fabric layer,
//      drives the packet-head glyph, flashes the cells it crosses,
//      and stamps a write seal when it lands on the terminal.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useConsensusMemoryFocusRef } from '../hooks/consensusMemoryFocusContext';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { buildNeighborGraph, emptyNeighborGraph, type NeighborGraph } from '../geometry/neighborGraph';
import { type Pulse, type PulsePlanningOptions } from './pulseRunner';
import { planLinkBatch, tickBlockIfAdvanced } from './pulseBatch';
import { pulseStats } from './pulseStats';
import { diffCells, snapshotCells, type CellSnapshotEntry } from './cellsDelta';
import { planMeshUpdate, shouldReconcile } from './livingMeshDriver';
import NeuralFabric, { type NeuralFabricHandles } from './NeuralFabric';
import { bezierAt, bezierControl, fabricEdgeSeed } from '../geometry/edgeBezier';
import { SpikePool } from './spikePool';
import type { Vec3 } from '../types';
import {
  CONSENSUS_PULSE_POLICY,
  consensusMemoryCellResponse,
  consensusMemoryEvidenceFocusScale,
  consensusMemoryRouteHopAdjacentSegments,
  consensusMemoryPulseActivityScale,
  consensusMemoryRouteHandoffScale,
  consensusMemoryTraceRouteForTarget,
  consensusMemoryTraceReadout,
  consensusMemoryTraceRequestKey,
  consensusMemoryTraceResonance,
  consensusMemoryTraceFocusStrength,
  deriveConsensusMemoryTraceFocus,
  validateConsensusMemoryRouteHopFocus,
  planConsensusMemoryTrace,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryCellResponse,
  type ConsensusMemoryCellResponseRef,
  type ConsensusMemoryEvidenceResponse,
  type ConsensusMemoryTargetResponse,
  type ConsensusPulseMode,
} from './consensusMemoryTrace';
import ConsensusMemoryMarkers from './ConsensusMemoryMarkers';
import ConsensusRouteHopMarker from './ConsensusRouteHopMarker';

const SPIKE_POOL_CAPACITY = 1024;

/** Soft cap on concurrent pulses. Anything above this drops oldest
 *  first — keeps the visual coherent during burst-block activity. */
const MAX_ACTIVE_PULSES = 256;

/** Wavefront glyph scale. Live writes use the pale data lozenge; historical
 *  recall uses a smaller segmented phase knot. The curve carries the route. */
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
/** Full recalled route afterimage, below the travelling wavefront energy. */
const MEMORY_RESONANCE_BRIGHT = 1.35;
/** Broad afterimage rather than the tight travelling-wave tail. */
const MEMORY_RESONANCE_TAIL_DECAY = 0.65;
/** Lift inspected edges above recall afterimage without becoming a write flash. */
const MEMORY_ROUTE_HOP_INSPECT_BRIGHT = 2.05;
const MEMORY_ROUTE_HOP_INSPECT_TAIL_DECAY = 0.18;
const RIPPLE_STAGGER_MS = 60;      // per-birth grow-in delay within a block
const RECONCILE_EVERY_N_BLOCKS = 6; // canonical drift repair cadence

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
  /** Explicit user-requested replay of one retained historical link. */
  traceRequest?: ConsensusMemoryTraceRequest | null;
  /** Optional recall-only route cap; live traffic keeps its own pulse budget. */
  traceMaxPulses?: number;
  /** Reports completion or an unavailable route so UI active state can exit. */
  onTraceComplete?: (request: ConsensusMemoryTraceRequest) => void;
  /**
   * Publishes semantic target-stage changes from the authoritative route clock.
   * This is intentionally low-frequency: frame-level convergence stays in R3F.
   */
  onTraceReadoutChange?: (readout: ConsensusMemoryTraceReadout | null) => void;
  /** Frame-level target response shared with secondary render roots. */
  traceTargetResponseRef?: ConsensusMemoryCellResponseRef;
  /** One verified routed source isolated by the evidence ledger. */
  traceEvidenceFocusSourceId?: number | null;
  /** One verified Cell address inside that source's exact retained route. */
  traceRouteHopFocus?: ConsensusMemoryRouteHopFocus | null;
  /** Click-locked hop only; hover preview must not stamp a spatial glyph. */
  traceRouteHopLock?: ConsensusMemoryRouteHopFocus | null;
  /** Mirror target-signature inspection into the evidence ledger only. */
  onTraceAgreementPreviewChange?: (sourceId: number | null) => void;
  /** Switch a target agreement signature onto its verified source route. */
  onTraceRouteHopLockChange?: (
    focus: ConsensusMemoryRouteHopFocus | null,
  ) => void;
}

interface ActivePulse extends Pulse {
  startSec: number;
  mode: ConsensusPulseMode;
  /** ② Highest hop index already reinforced, so each edge a pulse crosses
   *  bumps its vein's usage exactly once (the head hop only advances). */
  lastReinforcedHop?: number;
}

export default function NeuralNetwork({
  cellFlashRef,
  flashDirtyRef,
  burstArrivalRef,
  topology,
  pulses,
  traceRequest = null,
  traceMaxPulses,
  onTraceComplete,
  onTraceReadoutChange,
  traceTargetResponseRef,
  traceEvidenceFocusSourceId = null,
  traceRouteHopFocus = null,
  traceRouteHopLock = null,
  onTraceAgreementPreviewChange,
  onTraceRouteHopLockChange,
}: NeuralNetworkProps = {}) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxy();
  const sharedTraceFocusRef = useConsensusMemoryFocusRef();
  const { effective: quality } = useQualityRuntime();
  const particleCapMul = QUALITY_PRESETS[quality].particleCapMul;

  // Living mesh: the neighbour graph is maintained INCREMENTALLY from the
  // per-frame cells diff rather than rebuilt wholesale on every membership
  // change. Each birth adds its k-NN out-edges (grown in with a ripple
  // stagger), each real death retracts + flashes its edges, each cap
  // eviction quietly fades them. The risky orchestration — mutating the
  // graph plus building the fabric instruction maps — lives in the pure,
  // unit-tested planMeshUpdate; this effect is a thin driver over the fabric
  // handles. graphRef is mutated in place so the pulse-planning effect (and
  // the per-frame loop) always route over a fresh adjacency — the stale-graph
  // race the throttled rebuild used to open is closed.
  //
  // The add-only incremental path never grows the symmetric in-edges an
  // existing cell would gain from a newcomer, so every RECONCILE_EVERY_N_BLOCKS
  // blocks' worth of births we rebuild the canonical graph and diff it back
  // through setFabric — repairing the accrued drift, off the race path.
  const graphRef = useRef<NeighborGraph>(emptyNeighborGraph());
  const prevCellsRef = useRef<Map<number, CellSnapshotEntry>>(new Map());
  const bootstrappedRef = useRef(false);
  const blockCountRef = useRef(0);
  useEffect(() => {
    const cells = cellsCache.cells;
    const now = simClock.elapsedSec;
    const handles = fabricHandlesRef.current;
    const opts = { k: topology?.neighborK, maxEdgeLength: topology?.maxEdgeLength };

    if (!bootstrappedRef.current) {
      if (cells.size === 0) return; // wait for first populated frame
      graphRef.current = buildNeighborGraph(cells, opts);
      handles?.setFabric(graphRef.current, cells, now);
      prevCellsRef.current = snapshotCells(cells);
      bootstrappedRef.current = true;
      return;
    }

    const diff = diffCells(prevCellsRef.current, cells);
    prevCellsRef.current = snapshotCells(cells);
    if (diff.born.length === 0 && diff.died.length === 0 && diff.evicted.length === 0) return;

    // All graph mutation + fabric-instruction building happens in the pure
    // planMeshUpdate (unit-tested); the effect just drives the handles.
    const u = planMeshUpdate(diff, graphRef.current, cells, now, opts, RIPPLE_STAGGER_MS);
    if (u.addedEdges.length > 0) handles?.growEdges(u.addedEdges, cells, u.bornAtByKey, u.dirByKey);
    if (u.deathKeys.length > 0) handles?.killEdges(u.deathKeys, now, 'death', u.deathEndByKey);
    if (u.evictKeys.length > 0) handles?.killEdges(u.evictKeys, now, 'gc');

    // Periodic canonical reconciliation (off the race path).
    blockCountRef.current += diff.born.length; // proxy: births ≈ per-block activity
    if (shouldReconcile(blockCountRef.current, RECONCILE_EVERY_N_BLOCKS)) {
      blockCountRef.current = 0;
      graphRef.current = buildNeighborGraph(cells, opts);
      handles?.setFabric(graphRef.current, cells, now); // diff animates drift as grow/gc-fade
    }
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
      pulsesRef.current.push({ ...p, startSec, mode: 'live' });
    }
    // Soft cap — drop oldest if we're way over.
    const maxActivePulses = Math.max(
      1,
      Math.floor((pulses?.maxActivePulses ?? MAX_ACTIVE_PULSES) * particleCapMul),
    );
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
    particleCapMul,
  ]);

  // User-driven historical recall. It prefers retained spent inputs and falls
  // back to explicitly-labelled parent siblings only after those inputs leave
  // the cache. `memory` policy forbids reinforcement, Cell flashes, and seals.
  const lastTraceKeyRef = useRef<string | null>(null);
  const activeTraceRequestRef = useRef<ConsensusMemoryTraceRequest | null>(null);
  const traceFocusRef = useRef<ConsensusMemoryTraceFocus | null>(null);
  const [traceFocus, setTraceFocus] = useState<ConsensusMemoryTraceFocus | null>(null);
  const traceReadoutSignatureRef = useRef('none');
  const traceTargetSnapshotRef = useRef<ConsensusMemoryTargetResponse>({
    targetCellId: -1,
    response: {
      role: 'target',
      strength: 0,
      phase: 0,
      convergence: 0,
      evidence: [],
      evidenceFocusSourceId: null,
    },
  });
  useEffect(() => {
    const focus = traceFocusRef.current;
    if (!focus) return;
    const sourceId = traceEvidenceFocusSourceId !== null
      && Number.isFinite(traceEvidenceFocusSourceId)
      && focus.sources.some((source) => source.id === traceEvidenceFocusSourceId)
      ? traceEvidenceFocusSourceId
      : null;
    focus.evidenceFocusSourceId = sourceId;
    const validatedRouteHop = validateConsensusMemoryRouteHopFocus(
      focus,
      traceRouteHopFocus,
    );
    focus.routeHopFocus = validatedRouteHop?.sourceId === sourceId
      ? validatedRouteHop
      : null;
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = focus;
  }, [
    sharedTraceFocusRef,
    traceEvidenceFocusSourceId,
    traceFocus,
    traceRouteHopFocus,
  ]);
  const publishTraceTargetResponse = useCallback((
    targetCellId: number | null,
    response: ConsensusMemoryCellResponse | null,
  ) => {
    if (!traceTargetResponseRef) return;
    if (targetCellId === null || response?.role !== 'target') {
      traceTargetResponseRef.current = null;
      return;
    }
    const snapshot = traceTargetSnapshotRef.current;
    snapshot.targetCellId = targetCellId;
    snapshot.response.strength = response.strength;
    snapshot.response.phase = response.phase;
    snapshot.response.convergence = response.convergence;
    snapshot.response.evidenceFocusSourceId = response.evidenceFocusSourceId ?? null;
    const evidence = snapshot.response.evidence as ConsensusMemoryEvidenceResponse[];
    evidence.length = response.evidence?.length ?? 0;
    response.evidence?.forEach((source, index) => {
      const target = evidence[index] ?? {
        sourceId: source.sourceId,
        ordinal: source.ordinal,
        contentHash: source.contentHash,
        convergence: source.convergence,
      };
      target.sourceId = source.sourceId;
      target.ordinal = source.ordinal;
      target.contentHash = source.contentHash;
      target.convergence = source.convergence;
      evidence[index] = target;
    });
    traceTargetResponseRef.current = snapshot;
  }, [traceTargetResponseRef]);
  const publishTraceReadout = useCallback((
    readout: ConsensusMemoryTraceReadout | null,
  ) => {
    if (!onTraceReadoutChange) return;
    const signature = readout
      ? [
        readout.key,
        readout.targetCellId,
        readout.stage,
        readout.arrivedSourceCount,
        readout.resolvedSourceCount,
        readout.sourceCount,
        ...readout.evidence.map((source) => `${source.sourceId}:${source.state}`),
      ].join(':')
      : 'none';
    if (traceReadoutSignatureRef.current === signature) return;
    traceReadoutSignatureRef.current = signature;
    onTraceReadoutChange(readout);
  }, [onTraceReadoutChange]);
  useEffect(() => () => {
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
    publishTraceTargetResponse(null, null);
  }, [publishTraceTargetResponse, sharedTraceFocusRef]);
  useEffect(() => {
    if (!traceRequest) {
      pulsesRef.current = pulsesRef.current.filter((pulse) => pulse.mode !== 'memory');
      lastTraceKeyRef.current = null;
      activeTraceRequestRef.current = null;
      traceFocusRef.current = null;
      if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
      publishTraceTargetResponse(null, null);
      setTraceFocus(null);
      publishTraceReadout(null);
      return;
    }
    const key = consensusMemoryTraceRequestKey(traceRequest);
    if (lastTraceKeyRef.current === key) return;
    // A replay replaces the previous recollection. Live traffic remains in
    // flight, but stale historical paths cannot overlap the new selection.
    pulsesRef.current = pulsesRef.current.filter((pulse) => pulse.mode !== 'memory');
    lastTraceKeyRef.current = key;
    activeTraceRequestRef.current = null;
    const link = cellsCache.recentLinks.find(
      (candidate) => candidate.seq === traceRequest.linkSeq,
    );
    if (!link) {
      traceFocusRef.current = null;
      if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
      publishTraceTargetResponse(null, null);
      setTraceFocus(null);
      publishTraceReadout(null);
      onTraceComplete?.(traceRequest);
      return;
    }

    const trace = planConsensusMemoryTrace(
      link,
      cellsCache.cells,
      graphRef.current,
      {
        maxHops: topology?.maxHops,
        maxPulses: traceMaxPulses ?? pulses?.maxPulsesPerLink,
        targetCellId: traceRequest.targetCellId,
      },
    );
    const startSec = simClock.elapsedSec;
    const focus = deriveConsensusMemoryTraceFocus(trace, startSec, key);
    traceFocusRef.current = focus;
    if (sharedTraceFocusRef) sharedTraceFocusRef.current = focus;
    setTraceFocus(focus);
    if (!focus) {
      publishTraceTargetResponse(null, null);
      publishTraceReadout(null);
      onTraceComplete?.(traceRequest);
      return;
    }
    activeTraceRequestRef.current = traceRequest;
    const targetCellId = traceRequest.targetCellId ?? focus.targetIds[0];
    const initialTargetResponse = targetCellId === undefined
      ? null
      : consensusMemoryCellResponse(focus, targetCellId, startSec);
    publishTraceTargetResponse(targetCellId ?? null, initialTargetResponse);
    publishTraceReadout(targetCellId === undefined
      ? null
      : consensusMemoryTraceReadout(focus, targetCellId, startSec));
    for (const pulse of trace.pulses) {
      pulsesRef.current.push({ ...pulse, startSec, mode: 'memory' });
    }

    const maxActivePulses = Math.max(
      1,
      Math.floor((pulses?.maxActivePulses ?? MAX_ACTIVE_PULSES) * particleCapMul),
    );
    if (pulsesRef.current.length > maxActivePulses) {
      pulsesRef.current.splice(0, pulsesRef.current.length - maxActivePulses);
    }
  }, [
    traceRequest?.linkSeq,
    traceRequest?.targetCellId,
    traceRequest?.nonce,
    cellsCache.recentLinks,
    cellsCache.cells,
    topology?.maxHops,
    traceMaxPulses,
    pulses?.maxPulsesPerLink,
    pulses?.maxActivePulses,
    particleCapMul,
    onTraceComplete,
    publishTraceReadout,
    publishTraceTargetResponse,
    sharedTraceFocusRef,
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

  // One batched glyph pool for the moving protocol packets.
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
  // cells, then stamp a consensus write seal at the terminal.
  useSimFrame((state) => {
    const now = simClock.elapsedSec;
    spikePool.beginFrame();
    const handles = fabricHandlesRef.current;
    const cells = cellsCache.cells;
    const activeFocus = traceFocusRef.current;
    if (activeFocus && now >= activeFocus.endsAtSec) {
      const completedRequest = activeTraceRequestRef.current;
      pulsesRef.current = pulsesRef.current.filter((pulse) => pulse.mode !== 'memory');
      activeTraceRequestRef.current = null;
      traceFocusRef.current = null;
      if (sharedTraceFocusRef) sharedTraceFocusRef.current = null;
      publishTraceTargetResponse(null, null);
      setTraceFocus(null);
      publishTraceReadout(null);
      if (completedRequest) onTraceComplete?.(completedRequest);
    }
    const currentFocus = traceFocusRef.current;
    const currentRequest = activeTraceRequestRef.current;
    const readoutTargetId = currentRequest?.targetCellId
      ?? currentFocus?.targetIds[0];
    let currentTargetResponse: ConsensusMemoryCellResponse | null = null;
    if (currentFocus && readoutTargetId !== undefined) {
      const response = consensusMemoryCellResponse(
        currentFocus,
        readoutTargetId,
        now,
      );
      currentTargetResponse = response?.role === 'target' ? response : null;
      publishTraceTargetResponse(readoutTargetId, currentTargetResponse);
      publishTraceReadout(consensusMemoryTraceReadout(
        currentFocus,
        readoutTargetId,
        now,
      ));
    }
    const focusStrength = consensusMemoryTraceFocusStrength(
      traceFocusRef.current,
      now,
    );

    // Drive growth/decay animation on the persistent fabric layer.
    // Internally gated: no-op when nothing is animating and nothing
    // has changed since last commit, so this is free in steady state.
    handles?.setRecallFocus(focusStrength);
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
      const policy = CONSENSUS_PULSE_POLICY[pulse.mode];
      const activityScale = consensusMemoryPulseActivityScale(
        pulse.mode,
        focusStrength,
      );
      const evidenceActivityScale = pulse.mode === 'memory'
        ? consensusMemoryEvidenceFocusScale(
          pulse.path[0] ?? null,
          currentFocus?.evidenceFocusSourceId ?? null,
        )
        : 1;
      const routeActivityScale = activityScale * evidenceActivityScale;
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
        if (pulse.mode === 'memory') {
          const resonance = consensusMemoryTraceResonance(
            (now - arriveAt) * 1000,
          );
          if (resonance > 0) {
            stillActive.push(pulse);
            const targetResponse = term === readoutTargetId
              ? currentTargetResponse
              : consensusMemoryCellResponse(activeFocus, term, now);
            const handoffScale = consensusMemoryRouteHandoffScale(
              targetResponse?.role === 'target'
                ? targetResponse.convergence
                : 0,
            );
            if (handles) {
              for (let h = 0; h < totalHops; h++) {
                const fromId = pulse.path[h];
                const toId = pulse.path[h + 1];
                if (!cells.has(fromId) || !cells.has(toId)) continue;
                const hopAdjacency = adjacency.get(fromId);
                if (!hopAdjacency?.has(toId)) continue;
                handles.pushActiveHop(
                  {
                    fromCellId: fromId,
                    toCellId: toId,
                    frontT: 1,
                    brightness: MEMORY_RESONANCE_BRIGHT
                      * resonance
                      * handoffScale
                      * evidenceActivityScale,
                    tailDecay: MEMORY_RESONANCE_TAIL_DECAY,
                    color: pulse.color,
                  },
                  cells,
                );
              }
            }
          }
          continue;
        }
        if (policy.stampWrite && burstArrivalRef?.current) {
          const prev = burstArrivalRef.current.get(term);
          if (!prev || arriveAt > prev.firedAt) {
            burstArrivalRef.current.set(term, {
              firedAt: arriveAt,
              color: pulse.color,
            });
          }
        }
        // Final cell flash on the terminal too.
        if (policy.flashCells && cellFlashRef?.current) {
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

      // Reinforce the route this packet is traversing — once per edge crossed
      // (headHop only advances). Repeatedly-travelled routes accumulate glow
      // and persist; the fabric self-organizes toward live block/tx flow.
      if (policy.reinforce && headHop > (pulse.lastReinforcedHop ?? -1)) {
        handles?.reinforce(headFromId, headToId);
        pulse.lastReinforcedHop = headHop;
      }

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
              brightness: brightness * routeActivityScale,
              color: pulse.color,
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
          size: pulse.mode === 'memory' ? SPIKE_SIZE * 0.74 : SPIKE_SIZE,
          alpha: (pulse.mode === 'memory' ? SPIKE_ALPHA * 0.72 : SPIKE_ALPHA)
            * routeActivityScale,
          whiteBias: pulse.mode === 'memory' ? 0.5 : 0.95,
          glyph: pulse.mode === 'memory' ? 'memory' : 'packet',
        });
      }

      // Cell flash on the cell we *arrive at* during this hop. Schedule
      // exactly when subT crosses 1 (= when we land on the next cell).
      if (policy.flashCells && cellFlashRef?.current) {
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

    // A route-ledger hover reads the exact retained route independently of
    // packet progress. Only the one or two live graph edges adjacent to that
    // verified Cell are lifted, so an untraversed or stale edge is never drawn.
    const routeHopFocus = currentFocus?.routeHopFocus ?? null;
    if (handles && currentFocus && routeHopFocus && focusStrength > 0) {
      const source = currentFocus.sources.find(
        ({ id }) => id === routeHopFocus.sourceId,
      );
      const inspectedRoute = source
        ? consensusMemoryTraceRouteForTarget(source, routeHopFocus.targetCellId)
        : null;
      if (
        inspectedRoute
        && inspectedRoute.path[routeHopFocus.hopIndex] === routeHopFocus.cellId
      ) {
        for (const segmentIndex of consensusMemoryRouteHopAdjacentSegments(
          routeHopFocus,
          inspectedRoute.path,
        )) {
          const fromCellId = inspectedRoute.path[segmentIndex];
          const toCellId = inspectedRoute.path[segmentIndex + 1];
          if (!cells.has(fromCellId) || !cells.has(toCellId)) continue;
          if (!adjacency.get(fromCellId)?.has(toCellId)) continue;
          handles.pushActiveHop({
            fromCellId,
            toCellId,
            frontT: 1,
            brightness: MEMORY_ROUTE_HOP_INSPECT_BRIGHT * focusStrength,
            tailDecay: MEMORY_ROUTE_HOP_INSPECT_TAIL_DECAY,
            color: inspectedRoute.color,
          }, cells);
        }
      }
    }

    handles?.flushActive();
    spikePool.endFrame(state.size.height, state.viewport.dpr ?? 1);
  });

  return (
    <>
      <NeuralFabric onReady={onFabricReady} />
      <primitive object={spikePool.mesh} />
      <ConsensusMemoryMarkers
        focus={traceFocus}
        evidenceFocusSourceId={traceEvidenceFocusSourceId}
      />
      <ConsensusRouteHopMarker
        focus={traceFocus}
        lockedHop={traceRouteHopLock}
        focusedSourceId={traceEvidenceFocusSourceId}
        onAgreementPreviewChange={onTraceAgreementPreviewChange}
        onAgreementLockChange={onTraceRouteHopLockChange}
      />
    </>
  );
}
