// 次级神经 — the secondary nerves of the transition band.
//
// One capsule-line layer of mixed-register strokes: each begins on a real
// staged Cell and ends part-way along a fibre of the unresolved-population
// halo. See `geometry/bridgeEdges.ts` for why such a stroke is legitimate at
// all and `bridgeStroke.ts` for the three drawing rules that keep it honest.
//
// ## Why a sibling of NeuralFabric rather than a sixth layer inside it
//
// NeuralFabric's five layers share ONE machine: a persistent `edgeStates` map
// keyed by canonical Cell pairs, fixed GPU slots, cohort staggering, a hidden
// reaper, the GPU-parametric lifecycle bake, an inspection-transition
// snapshot pair, and a recall aperture. A bridge has none of those. It has no
// second Cell, so it cannot be keyed like an edge, cannot enter the
// inspection field, cannot be recalled, and must never be routed or
// reinforced — which is not a feature it happens to lack but the register
// boundary itself. Threading a class through that machine that has to opt out
// of most of it is how the boundary gets eroded by the next refactor.
//
// So the reuse is at the level of the PARTS, which is where it belongs:
// `makeFatLineLayer` builds the layer, `optimizeScreenSpaceCapsuleMaterial`
// (inside it) gives the same two-triangle capsule, `fabricEdgeRenderState`
// drives grow and retract, `edgeBezier` draws the same curve, `fabricSlots`
// says which span of the buffers a stroke owns and which runs of them an
// upload is worth making, and `fabricLuminance` supplies both the brightness
// band and the de-glare. One extra draw call; no new line-rendering system.
//
// ⭐ The slot layout is the part that arrived last and it is worth saying why.
// A bridge's lifecycle runs on the CPU here (see the `makeFatLineLayer` call
// below), which is fine and stays — what was not fine is that one stroke
// somewhere in its 1.2 s growth made the layer repack and re-upload ALL of
// itself, every frame, for ~70 frames after every block. Ninety-five percent
// of that traffic was strokes restating where they already were. The fabric
// retired the same pattern for the same reason; this class now borrows the
// answer along with the rest of the parts.
//
// ⭐ The BUILD had the same disease one level up, and it was retired the same
// way (2026-08-28). Every completed topology build re-ran the selection over
// ~12,000 hosts, and a selection that moved a handful of strokes armed a walk
// that re-wrote every span and re-uploaded the whole populated prefix (~350
// KB) to move them. Now a host REGISTRY (`syncBridgeHosts`) persists across
// builds and says exactly whether anything the selection reads has changed —
// a build that changed nothing runs no selection at all — and a build that
// did change something hands the layer the strokes it moved, which are
// ADMITTED into spans of their own: a birth takes a parked hole first and the
// end of the prefix next (the fabric's `allocateFabricSlot` rule), a death
// retracts in the span it already has, and nothing else is written. The full
// walk survives for the two cases that are genuinely about every stroke: a
// knob drag, which moves every stroke's energy, and an allocation overflow,
// where the walk is the compaction and hands spans to living strokes first.
//
// ⭐ The one part this class needed that did not exist is per-instance WIDTH
// (`enableTaperedCapsuleWidthMaterial`), and it was built the same way: two
// more attributes and three more shader patches on the SAME capsule material,
// behind a flag every other layer leaves off. A bridge is the only stroke in
// the frame that is not one width from end to end — see
// `BRIDGE_TIP_WIDTH_RATIO` — and that is a property of the register boundary
// too: the two ends are not the same kind of thing.
//
// The layer mounts wherever NeuralNetwork mounts, which is inside CellGalaxy's
// rotating group — the same frame the halo is placed in and the Cells are
// drawn in, so no position in this file is ever transformed.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

import { neverRaycast } from '../components/CellPopulationField';
import {
  BRIDGE_ALLOCATION_BRIDGES,
  buildBridgeAnchorIndex,
  createBridgeHostSyncJob,
  bridgeKey,
  createBridgeSelectionJob,
  createBridgeHostRegistry,
  runBridgeSelectionJobSlice,
  runBridgeHostSyncJobSlice,
  type BridgeAnchorIndex,
  type BridgeHostPlan,
  type BridgeHostSources,
  type BridgeHostSyncJob,
  type BridgeSelection,
  type BridgeSelectionJob,
} from '../geometry/bridgeEdges';
import type { PassiveSelection } from '../geometry/neighborGraph';
import { usePopulationPlacement } from '../geometry/populationPlacementStore';
import {
  cellDetailFabricEnergyGain,
  cellDetailFabricWidthScale,
} from '../derives/sceneView.derive';
import { LIVE } from '../tweaks/liveTweaks';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  PERFORMANCE_PROBE_LABELS,
  beginCpuProbe,
  endCpuProbe,
} from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyInstanceGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';
import {
  BRIDGE_SLOT_UPLOAD_BYTES,
  bridgeStats,
  bridgeUploadBytes,
  type BridgeFullWalkReason,
} from './bridgeStats';
import { blockFrameNowMs, blockFrameStats } from './blockFrameStats';
import {
  BRIDGE_STEP_ESTIMATE_MS,
  bridgeInputVersionMatches,
  bridgeRunDecision,
  nextBridgeStep,
  type BridgeBuildStep,
  type PendingBridgeBuild,
} from './bridgeSchedule';
import {
  FRAME_BUDGET_BRIDGE_STEP,
  mayStartFrameWork,
  spendFrameBudget,
} from './frameBudget';
import {
  BRIDGE_NO_SLOT,
  BRIDGE_WIDTH_RATIO,
  bridgeRenderStateInto,
  createBridgeReconcileJob,
  runBridgeReconcileJobSlice,
  type BridgeReconcileJob,
  writeBridgeStroke,
  type BridgeStrokeState,
} from './bridgeStroke';
import { reportBootBridgeSelected } from '../boot/nerveRestGate';
import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';
import {
  GROWTH_MS,
  makeEdgeRenderScratch,
  type EdgeRender,
} from './fabricEdgeRender';
import {
  FABRIC_SLOT_SEGMENTS,
  mergeFabricSlotRanges,
  slotUploadPolicy,
  type FabricSlotRange,
} from './fabricSlots';
import {
  commitLayer,
  fillFabricSlotRemainder,
  makeFatLineLayer,
  type FatLineLayer,
} from './NeuralFabric';

/** GPU allocation: 2,000 bridges' worth of sub-segments, which is 2,000 of
 *  the fixed spans below. Live strokes are capped at `BRIDGE_BUDGET` (1,600),
 *  so the remaining quarter is headroom for strokes retracting through a churn
 *  or a reorg. Past it a stroke gets no span at all — spans go to living
 *  strokes first, so what an overflow drops is an afterimage. */
const BRIDGE_MAX_SEGMENTS = BRIDGE_ALLOCATION_BRIDGES * FABRIC_SAMPLES_PER_EDGE;

/**
 * One stroke's reserved span, in segments — the fabric's own slot, because it
 * is the same number for the same reason: one curve at
 * `FABRIC_SAMPLES_PER_EDGE` samples. `writeBridgeStroke` writes that many or
 * none at all, so a fixed span per stroke is exact rather than generous, and
 * `BRIDGE_ALLOCATION_BRIDGES` slots is precisely the allocation above.
 *
 * ⭐ What the fixed span buys is the thing the fabric bought with it
 * (`fabricSlots.ts`): a stroke that is growing or retracting rewrites ITS OWN
 * span and nobody else's. One stroke in its 1.2 s growth used to hold the
 * whole layer open — ~1,600 strokes repacked and 358 KB re-uploaded every
 * frame for ~70 frames a block, to move the handful that were actually
 * moving.
 */
const BRIDGE_SLOT_SEGMENTS = FABRIC_SLOT_SEGMENTS;

/** A moving frame marks positions, colours and the width lane — three
 *  bufferSubData calls a range at 224 B a slot. Exported for the policy
 *  tests; the merge itself is the fabric family's (see `fabricSlots`). */
export const BRIDGE_UPLOAD_POLICY = slotUploadPolicy(BRIDGE_SLOT_UPLOAD_BYTES, 3);

/** Target wall time per selector frame. The cursor checks time between
 * deterministic 32-operation quanta and records the unavoidable overshoot. */
export const BRIDGE_SELECTION_SLICE_MS = 2;

/** Park a run of segments: the fabric's own parking — zero colours, endpoints
 *  far outside the frustum — plus the one lane this class owns on top of it.
 *  A parked run is degenerate in every channel, so a hole in the slot space
 *  rasterizes nothing whatever a driver decides to do with it. */
function parkBridgeSegments(
  layer: FatLineLayer,
  fromSegment: number,
  toSegment: number,
): void {
  // `fillFabricSlotRemainder` fills from its own cursor to the end segment.
  // The layer's `count` is the drawn prefix here and is not what is moving,
  // so the cursor it advances is a local one.
  fillFabricSlotRemainder(
    { positions: layer.positions, colors: layer.colors, count: fromSegment },
    toSegment,
  );
  const widths = layer.widths;
  if (widths === undefined) return;
  for (let segment = fromSegment; segment < toSegment; segment += 1) {
    widths[segment * 2] = 0;
    widths[segment * 2 + 1] = 0;
  }
}

/** Draw one stroke into the span it owns, parking whatever the write did not
 *  reach. A stroke writes its full sample count or nothing at all, so the
 *  parking is the INVISIBLE case — a stroke on the frame it was born, or every
 *  stroke at `fabricAlpha` 0 — and it is not optional: the span may still hold
 *  the stroke that lived there before the last compaction. */
function drawBridgeSlot(
  layer: FatLineLayer,
  stroke: BridgeStrokeState,
  render: EdgeRender,
  baseEnergy: number,
  centerDim: number,
  sample: Float32Array,
): void {
  const from = stroke.slot * BRIDGE_SLOT_SEGMENTS;
  const to = from + BRIDGE_SLOT_SEGMENTS;
  const written = writeBridgeStroke(
    layer.positions, layer.colors, layer.widths, from, to,
    stroke, render, baseEnergy, centerDim, sample,
  );
  if (written < BRIDGE_SLOT_SEGMENTS) {
    parkBridgeSegments(layer, from + written, to);
  }
}

/** Hand a stroke the next span and draw it there, returning the next free
 *  slot — the full walk's allocator. Past the allocation the stroke is left
 *  unslotted and undrawn, which is where the class's overflow rule lands: the
 *  walk offers spans to living strokes first, so what an overflow drops is an
 *  afterimage. */
function admitBridgeSlot(
  layer: FatLineLayer,
  stroke: BridgeStrokeState,
  render: EdgeRender,
  slot: number,
  baseEnergy: number,
  centerDim: number,
  sample: Float32Array,
): number {
  if (slot >= BRIDGE_ALLOCATION_BRIDGES) {
    stroke.slot = BRIDGE_NO_SLOT;
    return slot;
  }
  stroke.slot = slot;
  drawBridgeSlot(layer, stroke, render, baseEnergy, centerDim, sample);
  return slot + 1;
}

/**
 * A span for one stroke born between two full walks — the fabric's
 * `allocateFabricSlot` rule. A hole a reap left below the populated prefix
 * is reused before the prefix grows, so hole debt is paid by the next birth
 * rather than carried; the prefix advances only past the last hole and never
 * past the allocation. {@link BRIDGE_NO_SLOT} at capacity: the caller falls
 * back to the compacting full walk, which is the one place living strokes
 * are allowed to displace afterimages.
 */
function allocateBridgeSlot(layer: FatLineLayer, free: number[]): number {
  const reused = free.pop();
  if (reused !== undefined) return reused;
  const next = layer.count / BRIDGE_SLOT_SEGMENTS;
  if (next >= BRIDGE_ALLOCATION_BRIDGES) return BRIDGE_NO_SLOT;
  layer.count += BRIDGE_SLOT_SEGMENTS;
  return next;
}

/** Upload only the given SLOT ranges. The strokes that did not move kept
 *  their spans, so the populated prefix and the instance count are unchanged
 *  and the three lanes are cleared-and-marked exactly once each, as they are
 *  on any other frame. The width lane rides the positions here too: a tapered
 *  stroke's width is a function of where it is along its own curve. Returns
 *  the bytes flagged. */
function commitBridgeSlotRanges(
  layer: FatLineLayer,
  ranges: readonly FabricSlotRange[],
): number {
  // The instance count follows the prefix on every commit, marks or not: an
  // admission grows `layer.count`, and the draw's truth should not depend on
  // whether the frame that grew it also had bytes to flag (it always does —
  // an admitted span is drawn or parked the same frame — but the count is
  // not the place to rely on that).
  layer.geometry.instanceCount = layer.count;
  if (ranges.length === 0) return 0;
  layer.posBuf.clearUpdateRanges();
  layer.colBuf.clearUpdateRanges();
  layer.widthBuf?.clearUpdateRanges();
  let segments = 0;
  for (const range of ranges) {
    layer.posBuf.addUpdateRange(range.start * 6, range.count * 6);
    layer.colBuf.addUpdateRange(range.start * 6, range.count * 6);
    layer.widthBuf?.addUpdateRange(range.start * 2, range.count * 2);
    segments += range.count;
  }
  layer.posBuf.needsUpdate = true;
  layer.colBuf.needsUpdate = true;
  if (layer.widthBuf) layer.widthBuf.needsUpdate = true;
  return bridgeUploadBytes(segments);
}

/** One armed build part-way through `bridgeSchedule`'s three steps.
 *
 *  Its `spentMs` / `stepMaxMs` are the gauge's two readings for the build,
 *  and they SURVIVE a restart on purpose: a newer arm throws away the work of
 *  the sequence it replaced, but not the fact that the main thread spent it.
 *  The build that finishes owns the whole cost the class paid getting there,
 *  and the ring keeps one entry per build either way. */
interface RunningBridgeBuild {
  readonly pending: PendingBridgeBuild & {
    readonly anchorIndex: BridgeAnchorIndex;
    readonly cells: BridgeHostSources;
    readonly edges: PassiveSelection['edges'];
  };
  /** The step this sequence will run NEXT. */
  step: BridgeBuildStep;
  /** What step B chose, waiting for step C to reconcile it. */
  selection: BridgeSelection | null;
  syncJob: BridgeHostSyncJob | null;
  selectionJob: BridgeSelectionJob | null;
  reconcileJob: BridgeReconcileJob | null;
  spentMs: number;
  stepMaxMs: number;
}

export interface CellBridgeNervesProps {
  /** Immutable staged Cells captured when the topology build landed. */
  cellsRef: { readonly current: BridgeHostSources };
  /** The DRAWN passive fabric selection, for host degree — a Cell whose
   *  neighbours exist but were never selected looks exactly as bare as one
   *  with no neighbours. */
  passiveGraphRef: { readonly current: PassiveSelection };
  /** Atomically published after both immutable refs above. */
  inputVersionRef?: { readonly current: number };
  /** Bumped by the owner whenever both refs above hold a completed build. */
  version: number;
  /** The display graph version whose fabric grow/kill has fully landed — the
   *  owner drains that work across frames, so a published `version` can be
   *  ahead of the strokes this class chooses its hosts by. `-1` before the
   *  first build lands. Optional keeps standalone scenes unchanged. */
  fabricLandedVersionRef?: { readonly current: number };
  /** Shared camera-distance focus, so the class keeps its rung on the width
   *  and energy ladder when the detail view pulls the fabric down. */
  cellDetailViewFocusRef?: { readonly current: number };
}

export default function CellBridgeNerves({
  cellsRef,
  passiveGraphRef,
  inputVersionRef,
  version,
  fabricLandedVersionRef,
  cellDetailViewFocusRef,
}: CellBridgeNervesProps) {
  const simClock = useSimClock();
  const { size } = useThree();
  const placement = usePopulationPlacement();

  const layer = useMemo(() => {
    const built = makeFatLineLayer(
      BRIDGE_MAX_SEGMENTS,
      LIVE.cell.fabricWidth * BRIDGE_WIDTH_RATIO,
      'screen',
      // The passive fabric's two-triangle screen capsule. Not `worldUnits`: a
      // bridge is a screen-space stroke like every other nerve in the frame.
      true,
      // No GPU lifecycle — a bridge's lifecycle is driven on the CPU here,
      // one moving stroke at a time into the span that stroke owns.
      false,
      // ⭐ The one thing this class does that no other stroke in the scene
      // does: `linewidth` becomes the KNOT width and each sub-segment scales
      // it, so the stroke thins from the Cell to the halo. See
      // `BRIDGE_TIP_WIDTH_RATIO` for why the class needed a mark rather than
      // a rung.
      true,
    );
    // Render-only, and structurally so: no pointer handler is ever attached,
    // this object is not in `ScreenSpaceHitIndex`, and `LineSegments2` ships a
    // real raycast that would otherwise offer a hit surface the moment the
    // tree moved. See `neverRaycast` for why FALSE and not undefined.
    built.mesh.raycast = neverRaycast;
    return built;
  }, []);
  // True per-draw GPU timing for the one bridge draw when the opt-in render
  // probe owns a timer-query context, composed with LineSegments2's own
  // before-render hook and skipped while the instance count is zero.
  const bridgeGpuProbe = useMemo(() => createNonEmptyInstanceGpuProbeCallbacks(
    layer.mesh,
    createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.bridgeNerves),
  ), [layer]);

  const strokesRef = useRef<Map<string, BridgeStrokeState>>(new Map());
  /** The selection's input across builds — see `syncBridgeHosts`. */
  const registryRef = useRef(createBridgeHostRegistry());
  const coverageCacheRef = useRef<Map<number, number>>(new Map());
  const planCacheRef = useRef<Map<number, BridgeHostPlan>>(new Map());
  /** The anchor index the last selection ran against, and how many bridges
   *  it chose — what a skipped build reports to the boot gate in place of the
   *  selection it did not need to run. */
  const selectedAgainstRef = useRef<BridgeAnchorIndex | null>(null);
  const selectedCountRef = useRef(0);
  /** The build a React commit armed and no frame has run yet — the deferred
   *  slot of `bridgeSchedule`. Exactly one: a newer arm REPLACES an older
   *  one, so a build superseded before its own fabric landed never selects
   *  (the newer arm's selection reads the same registry it would have). */
  const pendingBuildRef = useRef<
    (PendingBridgeBuild & {
      readonly anchorIndex: BridgeAnchorIndex;
      readonly cells: BridgeHostSources;
      readonly edges: PassiveSelection['edges'];
    }) | null
  >(null);
  /** Arm serials: the one the last commit issued, and the one the last frame
   *  consumed. See `bridgeSchedule` for why the arm and not the version. */
  const armRef = useRef(0);
  const ranArmRef = useRef(0);
  /** The build part-way through its three phases, at most one slice a frame.
   *  Null between sequences; REPLACED (never queued behind) by a newer arm,
   *  so the hosts of two versions can never be mixed inside one selection. */
  const runningRef = useRef<RunningBridgeBuild | null>(null);
  /** What each step cost the last time it ran — the estimate the frame budget
   *  is asked with. Seeded from the class's own initial split, then measured. */
  const stepCostMsRef = useRef<Record<BridgeBuildStep, number>>({
    ...BRIDGE_STEP_ESTIMATE_MS,
  });
  /** Strokes the last build moved that no frame has admitted yet. */
  const pendingRef = useRef<BridgeStrokeState[]>([]);
  /** Arms the full walk, and says why. Null between walks. */
  const fullWalkRef = useRef<BridgeFullWalkReason | null>(null);
  /** The strokes still moving — the whole of what a frame between two builds
   *  looks at. A stroke enters when a build moves it and leaves on the frame
   *  it settles or reaps. A Set rather than a list because a build can move
   *  a stroke that is still moving — born, then displaced inside its 1.2 s
   *  growth — and it has to be listed exactly once. */
  const animatingRef = useRef<Set<BridgeStrokeState>>(new Set());
  /** Slots below the populated prefix whose stroke reaped: the holes the next
   *  births take before the prefix grows. Emptied by every full walk. */
  const freeSlotsRef = useRef<number[]>([]);
  /** Reused so a growth window allocates nothing per frame. */
  const dirtySlotsRef = useRef<number[]>([]);
  const sampleRef = useRef(new Float32Array(3));
  // One reused EdgeRender for the per-frame bridge walk: each render is consumed
  // synchronously (drawn, then its `animating`/`reap` flags read) before the
  // next stroke overwrites it, so the walk allocates no EdgeRender at all.
  const renderScratchRef = useRef(makeEdgeRenderScratch());
  const lastTweakRef = useRef({
    alpha: LIVE.cell.fabricAlpha,
    centerDim: LIVE.cell.centerDim,
  });

  const anchorIndex = useMemo(() => {
    if (!placement || placement.count === 0) return null;
    // The plans below are anchored in THIS index; a new placement invalidates
    // every one of them.
    planCacheRef.current = new Map();
    return buildBridgeAnchorIndex(placement);
  }, [placement]);

  useEffect(() => {
    layer.material.resolution.set(size.width, size.height);
  }, [size, layer.material]);

  useEffect(() => () => {
    layer.geometry.dispose();
    layer.material.dispose();
  }, [layer]);

  // Camera navigation is input, not simulation — raw frame, like the fabric's
  // own view weight, and gated on the two values it is a pure function of.
  const lastViewWeightRef = useRef({ focus: Number.NaN, width: Number.NaN });
  const applyViewWeight = useCallback(() => {
    const focus = cellDetailViewFocusRef?.current ?? 0;
    const width = LIVE.cell.fabricWidth;
    const last = lastViewWeightRef.current;
    if (last.focus === focus && last.width === width) return;
    last.focus = focus;
    last.width = width;
    const energyGain = cellDetailFabricEnergyGain(focus);
    layer.material.color.setRGB(energyGain, energyGain, energyGain);
    layer.material.linewidth = width
      * BRIDGE_WIDTH_RATIO
      * cellDetailFabricWidthScale(focus);
  }, [cellDetailViewFocusRef, layer.material]);
  useFrame(applyViewWeight);

  // Re-select for a completed topology build whose hosts moved — never in the
  // React commit that published the build, and no longer all in one frame
  // either. Hosts are keyed on the DRAWN fabric, and the owner drains a
  // build's grow and kill across the frames AFTER that commit, so a selection
  // run there would read a fabric that is provably one to three frames behind.
  // And the body is 19.7 ms at the median (33.2 at the worst) on the very
  // frame the fabric drain and the live-plan slice also want, so it runs as
  // `bridgeSchedule`'s three phases — sync, select, reconcile — one bounded
  // slice per frame at most, each asking the frame budget before it starts.
  //
  // ⚠️ The build every step runs for is the one the ARM named, and both halves
  // of it are destructured out of the running record on purpose: the body
  // cannot see the render's current `anchorIndex` or `version` at all, so it
  // cannot select for a build other than its own. Cells and passive edges are
  // the immutable pair captured by that arm's version tag; a later worker may
  // publish its refs before React renders the new version without changing a
  // sync already waiting for the fabric drain.
  const runBridgeBuild = useCallback((running: RunningBridgeBuild) => {
    const { anchorIndex, version } = running.pending;
    const step = running.step;
    // T1's gauge, now per STEP: a block frame is only as short as its longest
    // task, so what has to be measured is each step's own span — including
    // step A's skip return, which is the steady state of a composed stage and
    // the path a gauge that only saw the slow one would lie about. The sum of
    // the steps and the longest of them close the build in the `finally`
    // below. The span travels WITH the body: left around the arming it would
    // report the two writes that arm it and hide everything they defer.
    const stepStartedAtMs = blockFrameNowMs();
    let finished = false;
    let repeatStep = false;
    try {
      if (step === 'sync') {
        const registry = registryRef.current;
        // Two opt-in CPU spans, one per population: the registry sync runs on
        // every build, the selection only when the sync says a host moved, and
        // a mean over both would be a mean of nothing.
        const hostsProbe = beginCpuProbe(
          PERFORMANCE_PROBE_LABELS.bridgeHostsSync,
        );
        running.syncJob ??= createBridgeHostSyncJob(
          registry, running.pending.cells, running.pending.edges,
        );
        const syncProgress = runBridgeHostSyncJobSlice(
          running.syncJob, BRIDGE_SELECTION_SLICE_MS, blockFrameNowMs,
        );
        endCpuProbe(hostsProbe);
        if (!syncProgress.done) {
          repeatStep = true;
        }
        // ⭐ The skip. The registry is exact about what the selection reads, so
        // a build that moved no host against the same anchors would select the
        // same bridges, reconcile them to zero movement, and leave the layer as
        // it is — the steady state of a composed stage, and every refill build
        // on a cold server. None of that work is done, and the two steps behind
        // this one are never even started. The boot record still hears from
        // this build: first report wins in the gate, and the answer is the last
        // selection's, which is what this build's would have been.
        if (syncProgress.done
          && !running.syncJob.moved
          && selectedAgainstRef.current === anchorIndex) {
          const now = simClock.elapsedSec;
          bridgeStats.observeBuild(true, 0);
          if (version >= 1) {
            reportBootBridgeSelected(
              selectedCountRef.current > 0 ? now + GROWTH_MS / 1000 : now,
            );
          }
          finished = true;
        }
      } else if (step === 'select') {
        // ⚠️ The span is the SELECTION alone now — the reconcile is a step of
        // its own and has the step gauge for a reading. That is the honest
        // shape: this probe's mean used to fold in a reconcile that costs
        // single-digit percent of it.
        const selectProbe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.bridgeSelect);
        running.selectionJob ??= createBridgeSelectionJob(
          registryRef.current.hosts.values(), anchorIndex, {
            coverageCache: coverageCacheRef.current,
            planCache: planCacheRef.current,
          },
        );
        const progress = runBridgeSelectionJobSlice(
          running.selectionJob, BRIDGE_SELECTION_SLICE_MS, blockFrameNowMs,
        );
        if (progress.done) running.selection = running.selectionJob.result;
        else repeatStep = true;
        endCpuProbe(selectProbe);
      } else {
        const selection = running.selection;
        // A step B that threw leaves nothing to reconcile, and the sequence
        // closes rather than retrying a step that has already failed.
        if (selection !== null) {
          const now = simClock.elapsedSec;
          running.reconcileJob ??= createBridgeReconcileJob(
            strokesRef.current, selection.bridges, now, pendingRef.current,
          );
          const reconcileProgress = runBridgeReconcileJobSlice(
            running.reconcileJob, BRIDGE_SELECTION_SLICE_MS, blockFrameNowMs,
          );
          if (!reconcileProgress.done) {
            repeatStep = true;
          } else {
          // ⚠️ Written HERE and not beside the selection: these two are what
          // the skip above tests, so they may only claim what the layer
          // actually holds. A sequence a newer arm replaced between B and C
          // chose bridges that were never reconciled, and a `selectedAgainst`
          // written for it would let the next build skip onto a layer that
          // holds the selection before last.
          selectedAgainstRef.current = anchorIndex;
          selectedCountRef.current = selection.bridges.length;

          // ⚠️ Only the strokes the selection MOVED reach the layer, through
          // `pending`: a birth, a revival mid-retract, a death. The admission
          // pass below — same frame, a few lines down — takes them into spans
          // of their own and writes nothing else: a build that moves six
          // strokes writes six, not the ~1,600 the full walk used to restate.
          // The knob gate in the frame is the other arm and stays
          // unconditional: a knob moves every stroke's energy at once.
          const changed = running.reconcileJob.changed;
          bridgeStats.observeBuild(false, changed);
          // The boot record's outer-nerve deadline. The first selection against
          // a real topology build (version 0 is the pre-build mount pass over
          // an empty host map) is the boot cohort of bridges: born just above,
          // fully grown one GROWTH_MS later — or nothing to grow, in which case
          // the deadline is already met. First report wins in the gate, so the
          // refill churn that keeps re-selecting on a cold server never
          // stretches the boot readout.
          if (version >= 1) {
            reportBootBridgeSelected(
              selection.bridges.length > 0 ? now + GROWTH_MS / 1000 : now,
            );
          }
          }
        }
        finished = !repeatStep;
      }
    } finally {
      const elapsedMs = blockFrameNowMs() - stepStartedAtMs;
      // What this step cost is what the next ask for it predicts, and what the
      // frame's shared ledger charges the class for.
      stepCostMsRef.current[step] = elapsedMs;
      spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, elapsedMs);
      running.spentMs += elapsedMs;
      if (elapsedMs > running.stepMaxMs) running.stepMaxMs = elapsedMs;
      // A step is spent whether it returned or threw — a sequence that retried
      // a step which had already failed would fail on every frame from here on.
      const next = finished ? null : (repeatStep ? step : nextBridgeStep(step));
      if (next === null) {
        if (runningRef.current === running) runningRef.current = null;
        blockFrameStats.observeBridge(running.spentMs, running.stepMaxMs);
      } else {
        running.step = next;
      }
    }
  }, [cellsRef, passiveGraphRef, simClock]);

  // The React commit that publishes a build ARMS the slot and does nothing
  // else — two writes, no host sync, no selection, no reconcile. The same
  // triggers as before (a new build, or a new anchor index the plans are
  // rebuilt against); the deps that only ever supply refs stay listed so the
  // set of things that re-select is unchanged to the letter.
  useEffect(() => {
    if (anchorIndex === null) return;
    if (inputVersionRef
      && !bridgeInputVersionMatches(version, inputVersionRef.current)) return;
    armRef.current += 1;
    pendingBuildRef.current = {
      anchorIndex,
      version,
      arm: armRef.current,
      cells: cellsRef.current,
      edges: passiveGraphRef.current.edges,
    };
  }, [anchorIndex, version, cellsRef, passiveGraphRef, inputVersionRef, simClock]);

  useSimFrame(() => {
    // ⭐ The bridge frames. One STEP per frame, ahead of everything else this
    // class does, because the strokes step C moves have to reach the admission
    // pass below on the SAME frame — a build used to select and admit inside
    // one block frame and it still does, just not inside the React commit and
    // no longer inside one frame. The owner's fabric drain runs at frame
    // priority −1, so the version it lands is already published when this
    // reads it. On every other frame this is two null reads and a comparison.
    const pendingBuild = pendingBuildRef.current;
    if (pendingBuild !== null && bridgeRunDecision(
      pendingBuild,
      // No ref at all is a scene with no fabric drain behind it (the lab
      // scenes): nothing to wait for, so the first frame runs it.
      fabricLandedVersionRef?.current ?? Number.POSITIVE_INFINITY,
      ranArmRef.current,
    )) {
      // Consumed BEFORE the body, so a throw inside a step cannot leave an arm
      // that re-runs on every frame from here on.
      ranArmRef.current = pendingBuild.arm;
      pendingBuildRef.current = null;
      // ⚠️ A newer arm RESTARTS the sequence at step A instead of continuing
      // it: a selection over one build's hosts reconciled onto another
      // build's strokes is a layer of two versions, which is the one thing
      // the arm has always guaranteed against. What the abandoned steps cost
      // the main thread travels with the restart — the ring keeps one entry
      // per BUILD, and that entry owes the whole of what the class spent.
      const abandoned = runningRef.current;
      runningRef.current = {
        pending: pendingBuild,
        step: 'sync',
        selection: null,
        syncJob: null,
        selectionJob: null,
        reconcileJob: null,
        spentMs: abandoned?.spentMs ?? 0,
        stepMaxMs: abandoned?.stepMaxMs ?? 0,
      };
    }
    // One step, and only on a frame with room for it: the live-plan slice and
    // the fabric drain both outrank this class, and the deferral is bounded so
    // a build always finishes (`frameBudget`).
    const running = runningRef.current;
    if (running !== null && mayStartFrameWork(
      FRAME_BUDGET_BRIDGE_STEP,
      stepCostMsRef.current[running.step],
    )) {
      runBridgeBuild(running);
    }

    // A knob drag in a settled scene still has to land, exactly as the
    // fabric's `lastCellTweakRef` gate does.
    const tweaks = lastTweakRef.current;
    if (
      tweaks.alpha !== LIVE.cell.fabricAlpha
      || tweaks.centerDim !== LIVE.cell.centerDim
    ) {
      tweaks.alpha = LIVE.cell.fabricAlpha;
      tweaks.centerDim = LIVE.cell.centerDim;
      fullWalkRef.current = 'repaint';
    }
    const animating = animatingRef.current;
    const pending = pendingRef.current;
    if (
      fullWalkRef.current === null
      && pending.length === 0
      && animating.size === 0
    ) return;

    const now = simClock.elapsedSec;
    const strokes = strokesRef.current;
    const sample = sampleRef.current;
    const renderScratch = renderScratchRef.current;
    const baseEnergy = LIVE.cell.fabricAlpha;
    const centerDim = LIVE.cell.centerDim;
    const free = freeSlotsRef.current;

    // Admission: the strokes the last build moved, and no other. A birth (or
    // a revived stroke the allocation had dropped) takes a span; a death and
    // a revival keep the span they have. Every one of them joins the moving
    // set, and the pass below draws it this frame — the birth frame writes
    // nothing and parks the span, exactly as the walk did. Only an
    // allocation overflow falls through to the walk, which is the compaction.
    let admitted = 0;
    if (fullWalkRef.current === null && pending.length > 0) {
      for (const stroke of pending) {
        if (stroke.dyingAt === null && stroke.slot === BRIDGE_NO_SLOT) {
          const slot = allocateBridgeSlot(layer, free);
          if (slot === BRIDGE_NO_SLOT) {
            fullWalkRef.current = 'overflow';
            break;
          }
          stroke.slot = slot;
        }
        animating.add(stroke);
      }
      if (fullWalkRef.current === null) {
        admitted = pending.length;
        pending.length = 0;
      }
    }

    if (fullWalkRef.current !== null) {
      // Every stroke's energy changed (a knob drag), or the allocation
      // overflowed. Spans are handed out afresh from zero, so this walk is
      // also the compaction: every hole is reclaimed, and living strokes
      // come first so an overflow may clip an afterimage, never live form.
      const reason = fullWalkRef.current;
      pending.length = 0;
      free.length = 0;
      animating.clear();
      let slot = 0;
      for (const stroke of strokes.values()) {
        if (stroke.dyingAt !== null) continue;
        const render = bridgeRenderStateInto(renderScratch, stroke, now);
        slot = admitBridgeSlot(
          layer, stroke, render, slot, baseEnergy, centerDim, sample,
        );
        if (render.animating) animating.add(stroke);
      }
      for (const [key, stroke] of strokes) {
        if (stroke.dyingAt === null) continue;
        const render = bridgeRenderStateInto(renderScratch, stroke, now);
        if (render.reap) {
          strokes.delete(key);
          continue;
        }
        slot = admitBridgeSlot(
          layer, stroke, render, slot, baseEnergy, centerDim, sample,
        );
        if (render.animating) animating.add(stroke);
      }
      layer.count = slot * BRIDGE_SLOT_SEGMENTS;
      commitLayer(layer);
      bridgeStats.observeFullWalk(
        reason, slot, bridgeUploadBytes(layer.count), slot,
      );
      fullWalkRef.current = null;
      return;
    }

    // Between two builds only the strokes that are moving are touched, each
    // inside the span it already owns. At any moment of a growth window that
    // is a small minority of the layer, and rewriting the rest said nothing.
    const dirtySlots = dirtySlotsRef.current;
    dirtySlots.length = 0;
    for (const stroke of animating) {
      const render = bridgeRenderStateInto(renderScratch, stroke, now);
      if (render.reap) {
        // The afterimage's last frame. Its span goes degenerate before the
        // stroke lets go of it, or the final retract geometry stays lit until
        // some later birth happens to reuse the slot — and the slot becomes
        // that hole, first in line for the next birth.
        if (stroke.slot !== BRIDGE_NO_SLOT) {
          const from = stroke.slot * BRIDGE_SLOT_SEGMENTS;
          parkBridgeSegments(layer, from, from + BRIDGE_SLOT_SEGMENTS);
          dirtySlots.push(stroke.slot);
          free.push(stroke.slot);
          stroke.slot = BRIDGE_NO_SLOT;
        }
        strokes.delete(bridgeKey(stroke.cellId, stroke.anchorIndex));
        animating.delete(stroke);
        continue;
      }
      if (stroke.slot !== BRIDGE_NO_SLOT) {
        drawBridgeSlot(layer, stroke, render, baseEnergy, centerDim, sample);
        dirtySlots.push(stroke.slot);
      }
      // Drawn before the test rather than after it: the frame a stroke settles
      // on is the frame its finished geometry lands. It leaves after that.
      if (!render.animating) animating.delete(stroke);
    }
    // Reused holes put the moving set out of slot order, so the merge sorts
    // before it decides which runs to bridge — which it always did.
    const bytes = commitBridgeSlotRanges(
      layer, mergeFabricSlotRanges(dirtySlots, BRIDGE_UPLOAD_POLICY),
    );
    if (admitted > 0) {
      bridgeStats.observeAdmission(
        dirtySlots.length,
        bytes,
        layer.count / BRIDGE_SLOT_SEGMENTS,
        free.length,
      );
    } else {
      bridgeStats.observeMovingFrame(dirtySlots.length, bytes);
    }
  });

  return <primitive object={layer.mesh} {...bridgeGpuProbe} />;
}
