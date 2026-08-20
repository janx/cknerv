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
// drives grow and retract, `edgeBezier` draws the same curve, and
// `fabricLuminance` supplies both the brightness band and the de-glare. One
// extra draw call; no new line-rendering system.
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
  BRIDGE_WIDTH_RATIO,
  bridgeRenderState,
  makeBridgeStrokeState,
  writeBridgeStroke,
  type BridgeStrokeState,
} from './bridgeStroke';
import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';
import { commitLayer, makeFatLineLayer } from './NeuralFabric';

/** GPU allocation: 2,000 bridges' worth of sub-segments. Live strokes are
 *  capped at `BRIDGE_BUDGET` (1,600), so the remaining quarter is headroom for
 *  strokes retracting through a churn or a reorg. Past it the emit clips
 *  retracting strokes — living ones are written first. */
const BRIDGE_MAX_SEGMENTS = BRIDGE_ALLOCATION_BRIDGES * FABRIC_SAMPLES_PER_EDGE;

/** Memo caches are keyed by Cell id and a Cell that leaves the stage never
 *  comes back with a different position, so nothing ever invalidates an entry
 *  — which over a long session is a leak rather than a cache. Both are pure
 *  memos, so dropping them wholesale is free. */
const MEMO_CAP = 200_000;

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
      // No inspection transition and no GPU lifecycle — a bridge cannot enter
      // the inspection field and its lifecycle is driven on the CPU here.
      false,
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
  const animatingRef = useRef(false);
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
    if (!dirtyRef.current && !animatingRef.current) return;

    const now = simClock.elapsedSec;
    const strokes = strokesRef.current;
    const positions = layer.positions;
    const colors = layer.colors;
    const widths = layer.widths;
    const sample = sampleRef.current;
    const baseEnergy = LIVE.cell.fabricAlpha;
    const centerDim = LIVE.cell.centerDim;
    let count = 0;
    let animating = false;

    // Living strokes first: an allocation overflow may clip an afterimage,
    // never live form.
    for (const stroke of strokes.values()) {
      if (stroke.dyingAt !== null) continue;
      const render = bridgeRenderState(stroke, now);
      if (render.animating) animating = true;
      count += writeBridgeStroke(
        positions, colors, widths, count, BRIDGE_MAX_SEGMENTS,
        stroke, render, baseEnergy, centerDim, sample,
      );
    }
    for (const [key, stroke] of strokes) {
      if (stroke.dyingAt === null) continue;
      const render = bridgeRenderState(stroke, now);
      if (render.reap) {
        strokes.delete(key);
        continue;
      }
      animating = true;
      count += writeBridgeStroke(
        positions, colors, widths, count, BRIDGE_MAX_SEGMENTS,
        stroke, render, baseEnergy, centerDim, sample,
      );
    }

    layer.count = count;
    commitLayer(layer);
    animatingRef.current = animating;
    dirtyRef.current = false;
  });

  return <primitive object={layer.mesh} />;
}
