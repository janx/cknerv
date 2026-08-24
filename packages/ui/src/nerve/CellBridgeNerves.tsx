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
import type { Cell } from '@cknerv/types';

import { neverRaycast } from '../components/CellPopulationField';
import {
  BRIDGE_ALLOCATION_BRIDGES,
  buildBridgeAnchorIndex,
  bridgeKey,
  selectBridgeEdges,
  type BridgeHostCell,
  type BridgeHostPlan,
} from '../geometry/bridgeEdges';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { usePopulationPlacement } from '../geometry/populationPlacementStore';
import {
  cellDetailFabricEnergyGain,
  cellDetailFabricWidthScale,
} from '../derives/sceneView.derive';
import { LIVE } from '../tweaks/liveTweaks';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  BRIDGE_NO_SLOT,
  BRIDGE_WIDTH_RATIO,
  bridgeRenderState,
  makeBridgeStrokeState,
  writeBridgeStroke,
  type BridgeStrokeState,
} from './bridgeStroke';
import { reportBootBridgeSelected } from '../boot/nerveRestGate';
import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';
import { GROWTH_MS, type EdgeRender } from './fabricEdgeRender';
import {
  FABRIC_SLOT_SEGMENTS,
  mergeFabricSlotRanges,
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

/** Memo caches are keyed by Cell id and a Cell that leaves the stage never
 *  comes back with a different position, so nothing ever invalidates an entry
 *  — which over a long session is a leak rather than a cache. Both are pure
 *  memos, so dropping them wholesale is free. */
const MEMO_CAP = 200_000;

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
 *  slot. Past the allocation the stroke is left unslotted and undrawn, which
 *  is where the class's overflow rule lands: the walk offers spans to living
 *  strokes first, so what an overflow drops is an afterimage. */
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

/** Upload only the given SLOT ranges. The strokes that did not move kept
 *  their spans, so the populated prefix and the instance count are unchanged
 *  and the three lanes are cleared-and-marked exactly once each, as they are
 *  on any other frame. The width lane rides the positions here too: a tapered
 *  stroke's width is a function of where it is along its own curve. */
function commitBridgeSlotRanges(
  layer: FatLineLayer,
  ranges: readonly FabricSlotRange[],
): void {
  if (ranges.length === 0) return;
  layer.posBuf.clearUpdateRanges();
  layer.colBuf.clearUpdateRanges();
  layer.widthBuf?.clearUpdateRanges();
  for (const range of ranges) {
    layer.posBuf.addUpdateRange(range.start * 6, range.count * 6);
    layer.colBuf.addUpdateRange(range.start * 6, range.count * 6);
    layer.widthBuf?.addUpdateRange(range.start * 2, range.count * 2);
  }
  layer.posBuf.needsUpdate = true;
  layer.colBuf.needsUpdate = true;
  if (layer.widthBuf) layer.widthBuf.needsUpdate = true;
  layer.geometry.instanceCount = layer.count;
}

export interface CellBridgeNervesProps {
  /** The staged Cell map the topology build packed. Read at `version`. */
  cellsRef: { readonly current: ReadonlyMap<number, Cell> };
  /** The DRAWN passive fabric selection, for host degree — a Cell whose
   *  neighbours exist but were never selected looks exactly as bare as one
   *  with no neighbours. */
  passiveGraphRef: { readonly current: NeighborGraph };
  /** Bumped by the owner whenever both refs above hold a completed build. */
  version: number;
  /** Shared camera-distance focus, so the class keeps its rung on the width
   *  and energy ladder when the detail view pulls the fabric down. */
  cellDetailViewFocusRef?: { readonly current: number };
}

export default function CellBridgeNerves({
  cellsRef,
  passiveGraphRef,
  version,
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

  const strokesRef = useRef<Map<string, BridgeStrokeState>>(new Map());
  const coverageCacheRef = useRef<Map<number, number>>(new Map());
  const planCacheRef = useRef<Map<number, BridgeHostPlan>>(new Map());
  const dirtyRef = useRef(false);
  /** The strokes still moving, in ascending slot order — and the whole of what
   *  a frame between two builds looks at. Every full walk rebuilds it; a
   *  stroke leaves on the frame it settles or reaps and re-enters only through
   *  another full walk, because a build is the only thing that can start an
   *  animation here. */
  const animatingRef = useRef<BridgeStrokeState[]>([]);
  /** Reused so a growth window allocates nothing per frame. */
  const dirtySlotsRef = useRef<number[]>([]);
  const sampleRef = useRef(new Float32Array(3));
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

  // Re-select on every completed topology build. Hosts are keyed on the DRAWN
  // fabric, so this has to follow the same build the fabric does.
  useEffect(() => {
    if (anchorIndex === null) return;
    const cells = cellsRef.current;
    const graph = passiveGraphRef.current;
    const degree = new Map<number, number>();
    for (const edge of graph.edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
    const hosts: BridgeHostCell[] = [];
    for (const cell of cells.values()) {
      // A dead-but-not-yet-collected Cell contributes no fabric edge, and it
      // must contribute no bridge either — a retracting fibre that a rebuild
      // resurrects is the exact bug `buildNeighborGraph` guards against.
      if (cell.death_at_ms != null) continue;
      hosts.push({
        id: cell.id,
        x: cell.pos_seed[0],
        y: cell.pos_seed[1],
        z: cell.pos_seed[2],
        degree: degree.get(cell.id) ?? 0,
      });
    }

    if (coverageCacheRef.current.size > MEMO_CAP) {
      coverageCacheRef.current = new Map();
    }
    if (planCacheRef.current.size > MEMO_CAP) {
      planCacheRef.current = new Map();
    }
    const selection = selectBridgeEdges(hosts, anchorIndex, {
      coverageCache: coverageCacheRef.current,
      planCache: planCacheRef.current,
    });

    const now = simClock.elapsedSec;
    const strokes = strokesRef.current;
    const live = new Set<string>();
    for (const bridge of selection.bridges) {
      const key = bridgeKey(bridge.cellId, bridge.anchorIndex);
      live.add(key);
      const existing = strokes.get(key);
      if (existing === undefined) {
        strokes.set(key, makeBridgeStrokeState(bridge, now));
        continue;
      }
      // A host re-admitted before its retract finished keeps growing from
      // where it is rather than restarting: the clock is left alone.
      existing.dyingAt = null;
    }
    for (const [key, stroke] of strokes) {
      if (live.has(key) || stroke.dyingAt !== null) continue;
      stroke.dyingAt = now;
    }
    // The boot record's outer-nerve deadline. The first selection against a
    // real topology build (version 0 is the pre-build mount pass over an
    // empty host map) is the boot cohort of bridges: born just above, fully
    // grown one GROWTH_MS later — or nothing to grow, in which case the
    // deadline is already met. First report wins in the gate, so the refill
    // churn that keeps re-selecting on a cold server never stretches the
    // boot readout.
    if (version >= 1) {
      reportBootBridgeSelected(
        selection.bridges.length > 0 ? now + GROWTH_MS / 1000 : now,
      );
    }
    dirtyRef.current = true;
  }, [anchorIndex, version, cellsRef, passiveGraphRef, simClock]);

  useSimFrame(() => {
    // A knob drag in a settled scene still has to land, exactly as the
    // fabric's `lastCellTweakRef` gate does.
    const tweaks = lastTweakRef.current;
    if (
      tweaks.alpha !== LIVE.cell.fabricAlpha
      || tweaks.centerDim !== LIVE.cell.centerDim
    ) {
      tweaks.alpha = LIVE.cell.fabricAlpha;
      tweaks.centerDim = LIVE.cell.centerDim;
      dirtyRef.current = true;
    }
    const animating = animatingRef.current;
    if (!dirtyRef.current && animating.length === 0) return;

    const now = simClock.elapsedSec;
    const strokes = strokesRef.current;
    const sample = sampleRef.current;
    const baseEnergy = LIVE.cell.fabricAlpha;
    const centerDim = LIVE.cell.centerDim;

    if (dirtyRef.current) {
      // The stroke SET changed (a topology build) or every stroke's energy did
      // (a knob drag). Spans are handed out here and NOWHERE else, so this
      // walk is also the compaction: the holes a window's reaps left behind
      // are reclaimed by the next build, and hole debt can never outlive one.
      animating.length = 0;
      let slot = 0;
      // Living strokes first: an allocation overflow may clip an afterimage,
      // never live form.
      for (const stroke of strokes.values()) {
        if (stroke.dyingAt !== null) continue;
        const render = bridgeRenderState(stroke, now);
        slot = admitBridgeSlot(
          layer, stroke, render, slot, baseEnergy, centerDim, sample,
        );
        if (render.animating) animating.push(stroke);
      }
      for (const [key, stroke] of strokes) {
        if (stroke.dyingAt === null) continue;
        const render = bridgeRenderState(stroke, now);
        if (render.reap) {
          strokes.delete(key);
          continue;
        }
        slot = admitBridgeSlot(
          layer, stroke, render, slot, baseEnergy, centerDim, sample,
        );
        if (render.animating) animating.push(stroke);
      }
      layer.count = slot * BRIDGE_SLOT_SEGMENTS;
      commitLayer(layer);
      dirtyRef.current = false;
      return;
    }

    // Between two builds only the strokes that are moving are touched, each
    // inside the span it already owns. At any moment of a growth window that
    // is a small minority of the layer, and rewriting the rest said nothing.
    const dirtySlots = dirtySlotsRef.current;
    dirtySlots.length = 0;
    let kept = 0;
    for (let index = 0; index < animating.length; index += 1) {
      const stroke = animating[index];
      const render = bridgeRenderState(stroke, now);
      if (render.reap) {
        // The afterimage's last frame. Its span goes degenerate before the
        // stroke lets go of it, or the final retract geometry stays lit until
        // some later build happens to reuse the slot.
        if (stroke.slot !== BRIDGE_NO_SLOT) {
          const from = stroke.slot * BRIDGE_SLOT_SEGMENTS;
          parkBridgeSegments(layer, from, from + BRIDGE_SLOT_SEGMENTS);
          dirtySlots.push(stroke.slot);
        }
        strokes.delete(bridgeKey(stroke.cellId, stroke.anchorIndex));
        continue;
      }
      if (stroke.slot !== BRIDGE_NO_SLOT) {
        drawBridgeSlot(layer, stroke, render, baseEnergy, centerDim, sample);
        dirtySlots.push(stroke.slot);
      }
      // Drawn before the test rather than after it: the frame a stroke settles
      // on is the frame its finished geometry lands. It leaves after that.
      if (render.animating) {
        animating[kept] = stroke;
        kept += 1;
      }
    }
    animating.length = kept;
    // Already ascending — spans were handed out in walk order and this walk
    // preserves it — so the merge is only deciding which runs to bridge.
    commitBridgeSlotRanges(layer, mergeFabricSlotRanges(dirtySlots));
  });

  return <primitive object={layer.mesh} />;
}
