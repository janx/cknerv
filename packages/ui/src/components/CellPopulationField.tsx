import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import {
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
  populationSegmentsForPointPrefix,
} from '../geometry/populationFieldPlacement';
import {
  getPopulationPlacement,
  setPopulationPlacement,
  type PopulationPlacementSnapshot,
} from '../geometry/populationPlacementStore';
import { beginPopulationFieldPlacement } from '../geometry/populationFieldSession';
import {
  reportBootPopulationExpected,
  reportBootPopulationReady,
} from '../boot/nerveRestGate';
import {
  populationClosePosePrefixMul,
  populationFieldFillPixelRatio,
  populationHairlinePrefix,
  populationSpriteMulForCap,
  QUALITY_PRESETS,
  useQualityRuntime,
} from '../tweaks/qualityPresets';
import { blendQualityMul, qualityCrossfade } from '../tweaks/adaptiveQuality';
import { LIVE } from '../tweaks/liveTweaks';
import { haloThreadViewLevel } from '../nerve/fabricLuminance';
import { PERFORMANCE_PROBE_LABELS } from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyInstanceGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';
import {
  makeScreenSpaceCapsuleGeometry,
  syncScreenSpaceCapsuleViewport,
} from '../geometry/screenSpaceCapsuleLine';
import {
  makePopulationBackboneMaterial,
  makePopulationFibreMaterial,
  makePopulationPointMaterial,
  POPULATION_BACKBONE_WIDTH_PX,
  POPULATION_FIELD_POINT_SIZE_MAX,
  POPULATION_FIELD_POINT_SIZE_MIN,
  populationEmissionForGain,
  populationFibreEmissionForGain,
  populationStrokeSizeRatio,
} from '../materials/populationFieldMaterial';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../materials/pointSpritePresentation';

interface PlacedGeometry {
  /** The population itself. */
  points: THREE.BufferGeometry;
  /** The residual filaments, as an index buffer over the SAME position
   *  attribute — everything the backbone selection did not promote. */
  fibres: THREE.BufferGeometry;
  /** The promoted strands, as screen-space capsules. */
  backbone: BackboneLayer;
}

/** The third draw: one instanced capsule mesh over the promoted segments. */
interface BackboneLayer {
  geometry: LineSegmentsGeometry;
  mesh: LineSegments2;
  /** Promoted segments in the buffer, before any preset trims it. */
  count: number;
}

interface PlacementCounts {
  count: number;
  segmentCount: number;
  backboneSegmentCount: number;
  residualSegmentCount: number;
  backboneComponents: number;
  streamlines: number;
  work: number;
}

/** Instance data for the capsule pass: two endpoints and two taper ratios per
 *  promoted segment. */
export interface PopulationBackboneInstances {
  /** `6 * backboneSegmentCount` — start xyz then end xyz. */
  endpoints: Float32Array;
  /** `2 * backboneSegmentCount` — the SIZE RATIO at each endpoint. */
  taper: Float32Array;
}

/**
 * Expand the promoted segments into instance data for the capsule pass.
 *
 * ⚠️ This is the one place the layer copies a position, and it is unavoidable
 * rather than sloppy: `LineSegmentsGeometry` reads `instanceStart`/
 * `instanceEnd` as two interleaved VIEWS of one buffer at a fixed stride, so
 * it can only ever name CONSECUTIVE vertex pairs. The halo's segment buffer
 * names arbitrary pairs — a fork's first segment reaches back to the parent
 * point it branched from, and a join reaches back to a strand the walk passed
 * — so the promoted subset has to be written out. Only the SUBSET is: at the
 * shipped budget that is 0.48 MB against the 1.26 MB a duplicate of the whole
 * position buffer would cost, 38% of it.
 *
 * What the second buffer carries is the size RATIO, not the taper. The shader
 * squares the interpolated value, because mix() is linear and interpolating an
 * already-squared taper would dim the middle of every segment — the fibre
 * shader has always done it this way, and `populationStrokeSizeRatio` is that
 * number named so this class cannot drift from it.
 *
 * ⭐ That helper is also where `POPULATION_STROKE_TAPER_FLOOR` reaches this
 * half of the partition. The hairline bounds its ratio in a vertex stage; this
 * class has no vertex stage of its own to bound it in — the capsule patch
 * reads the ratio straight out of `instanceColorStart/End` — so the bound is
 * applied here, at the one place this class computes the number. One floor,
 * two draws, and the bead's own `populationFibreSizeRatio` untouched beside
 * them.
 *
 * Pure, and exported for the test that checks the second half of that
 * sentence: the taper at each end of a capsule must equal
 * `populationStrokeTaper` of the weight the hairlines share.
 */
export function populationBackboneInstanceData(
  placement: PopulationPlacementSnapshot,
): PopulationBackboneInstances {
  const count = placement.backboneSegmentCount;
  const endpoints = new Float32Array(count * 6);
  const taper = new Float32Array(count * 2);
  for (let s = 0; s < count; s += 1) {
    const a = placement.backboneSegments[s * 2];
    const b = placement.backboneSegments[s * 2 + 1];
    endpoints[s * 6] = placement.positions[a * 3];
    endpoints[s * 6 + 1] = placement.positions[a * 3 + 1];
    endpoints[s * 6 + 2] = placement.positions[a * 3 + 2];
    endpoints[s * 6 + 3] = placement.positions[b * 3];
    endpoints[s * 6 + 4] = placement.positions[b * 3 + 1];
    endpoints[s * 6 + 5] = placement.positions[b * 3 + 2];
    taper[s * 2] = populationStrokeSizeRatio(placement.weights[a]);
    taper[s * 2 + 1] = populationStrokeSizeRatio(placement.weights[b]);
  }
  return { endpoints, taper };
}

/**
 * The third draw, built once from a finished placement.
 *
 * The taper rides `instanceColorStart/End` as ONE component rather than three.
 * GL fills a `vec3` attribute's missing components with `(0, 1)` and the
 * fragment reads only `.r`, so it costs two floats a segment instead of six —
 * 0.16 MB rather than 0.48 MB at the shipped budget.
 */
function makeBackboneLayer(
  placement: PopulationPlacementSnapshot,
  material: LineMaterial,
): BackboneLayer {
  const count = placement.backboneSegmentCount;
  const { endpoints, taper } = populationBackboneInstanceData(placement);
  // Static, unlike the fabric's: this geometry is written once and a preset
  // change moves `instanceCount` and nothing else.
  const endpointBuf = new THREE.InstancedInterleavedBuffer(endpoints, 6, 1);
  const taperBuf = new THREE.InstancedInterleavedBuffer(taper, 2, 1);
  const geometry = makeScreenSpaceCapsuleGeometry();
  geometry.setAttribute(
    'instanceStart',
    new THREE.InterleavedBufferAttribute(endpointBuf, 3, 0),
  );
  geometry.setAttribute(
    'instanceEnd',
    new THREE.InterleavedBufferAttribute(endpointBuf, 3, 3),
  );
  geometry.setAttribute(
    'instanceColorStart',
    new THREE.InterleavedBufferAttribute(taperBuf, 1, 0),
  );
  geometry.setAttribute(
    'instanceColorEnd',
    new THREE.InterleavedBufferAttribute(taperBuf, 1, 1),
  );
  // Never culled and never picked, so this is only ever a placeholder that
  // stops Three computing bounds over the instance buffer.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);
  geometry.instanceCount = count;

  const mesh = new LineSegments2(geometry, material);
  // The cloud spans the halo envelope and the camera can sit inside it —
  // the same reason the points skip the frustum test.
  mesh.frustumCulled = false;
  mesh.raycast = neverRaycast;
  // The halo's own family, under the Cell bodies and under this layer's own
  // points. The partition means the capsules and the hairlines never deposit
  // the same stroke, so their order relative to each other is immaterial.
  mesh.renderOrder = -2;
  // `LineSegments2.onBeforeRender` is the authority on `resolution` — it
  // writes the CSS-pixel viewport immediately before every draw, which is
  // what makes `linewidth` a CSS-pixel quantity and therefore DPR-aware. The
  // capsule shader needs the device-pixel origin as well, and that is this
  // wrapper's only job.
  const viewport = new THREE.Vector4();
  const updateLineResolution = mesh.onBeforeRender.bind(mesh);
  mesh.onBeforeRender = (renderer) => {
    updateLineResolution(renderer);
    renderer.getViewport(viewport);
    syncScreenSpaceCapsuleViewport(
      material,
      renderer.getPixelRatio(),
      viewport.x,
      viewport.y,
    );
  };
  return { geometry, mesh, count };
}

export interface CellPopulationFieldProps {
  /** Live compressed amount from `deriveCellPopulationField`, owned by the
   *  caller and read in the frame loop. It moves every block, so it arrives by
   *  ref, never as a value prop, so a per-block change never re-renders
   *  `CellGalaxy` (memo). Absent, or `.current` 0, states nothing: with
   *  `active` false the layer places and draws nothing at all. */
  gainRef?: { readonly current: number };
  /** Whether there is an unresolved population to place at all (`gain > 0`).
   *  The placement gate reads this and not the ref, because placement must be
   *  reactive; it is stable across blocks (it flips only when the amount
   *  crosses zero), which is why it can be a prop without defeating the memo. */
  active: boolean;
  /** ⟨D-10 · knob b⟩ The camera's own place on the overview↔detail curve, the
   *  same ref `NeuralFabric`, `NetworkColony` and `CellBridgeNerves` already
   *  take. Absent means overview, which is what an unwired caller should get:
   *  the knob's default is 1, so an absent ref still draws today's picture. */
  cellDetailViewFocusRef?: { readonly current: number };
}

/** The halo is an aggregate. It is not a Cell, it has no id, and it must never
 *  return a hit — `ScreenSpaceHitIndex` plus the Cell hit surface remain the
 *  sole pick path.
 *
 *  Structurally this layer is already unreachable: it registers no pointer
 *  handler, so it never joins the event system's interaction list, and it is a
 *  sibling of the handler-bearing pick object rather than a descendant of it.
 *  The override is defensive, and BOTH of this layer's objects need it — unlike
 *  a bare Object3D, `THREE.Points` ships a real default raycast against a
 *  one-world-unit sphere per vertex and `THREE.LineSegments` ships one against
 *  `Raycaster.params.Line.threshold`, which are far looser surfaces than any
 *  mesh would offer if either ever moved in the tree. */
export function neverRaycast(): false {
  // FALSE, not undefined. `Raycaster.intersect` stops descending only on an
  // explicit `false`; returning nothing leaves `propagate` true, so the
  // override would cover this object and not anything ever nested under it.
  // Both objects are leaves today and the distinction is inert — which is
  // exactly why it has to be written down rather than relied on.
  return false;
}

/**
 * The unresolved population, drawn as real filaments in the same world the
 * Cells live in — the same law, the same material family, the same rotating
 * frame.
 *
 * The layer is three draws over ONE buffer of positions: the points, and the
 * fibres that connect consecutive points on a filament — the fibres split
 * between a one-device-pixel line pass and a DPR-aware capsule pass over the
 * promoted strands, which is a PARTITION and not an overlay (see
 * `geometry/populationBackbone.ts` for the width class and why it exists).
 * The fibres are what make it read as tissue rather than as spray. Measured at
 * the production camera the points alone measure an orientation coherence of
 * 0.184, which is the Poisson floor to three decimals, and so does the
 * 260,000-point spray this replaced — a density modulation cannot look like a
 * drawn thread, and at ~2.5 points per pixel the noise of an independent draw
 * eats every modulation there is. With the fibres the same field measures
 * 0.333.
 *
 * It replaces a screen-space construction that could not be made to read as
 * part of this scene, for two structural reasons that no amount of tuning
 * addressed and that no screenshot could show. Everything else here is
 * world-anchored: Cells and fabric rotate with the galaxy, carry parallax, and
 * interleave in depth. A screen-locked layer shimmers in place while they
 * move, so the eye files it as a filter over the image rather than as matter
 * in the image. And a procedural texture cannot match sprite geometry, so the
 * two stayed separate materials with a boundary between them.
 *
 * Now there is no boundary, because there is no second material.
 *
 * The layer carries no ids, registers no pointer handlers, answers no raycast,
 * and does not respond to chain events — a block affects specific Cells, and
 * brightening an aggregate would claim that unknown Cells participated in it.
 * It states an amount and a shape, and nothing else.
 */
export default function CellPopulationField({
  gainRef,
  active,
  cellDetailViewFocusRef,
}: CellPopulationFieldProps) {
  const material = useMemo(() => makePopulationPointMaterial(), []);
  const fibreMaterial = useMemo(() => makePopulationFibreMaterial(), []);
  const backboneMaterial = useMemo(() => makePopulationBackboneMaterial(), []);
  // True per-draw GPU timings when the opt-in render probe owns a timer-query
  // context. No CPU wall-time stand-in: unsupported contexts simply export no
  // GPU samples. Three calls these object hooks around the exact draw that the
  // label names; disabled callbacks stop at the probe's boolean gate.
  const populationGpuProbes = useMemo(() => ({
    points: createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.populationPoints),
    residualFibres: createGpuProbeCallbacks(
      PERFORMANCE_PROBE_LABELS.populationResidualFibres,
    ),
  }), []);
  const [placed, setPlaced] = useState<PlacedGeometry | null>(null);
  // The capsule mesh already owns LineSegments2's resolution callback plus
  // the device-viewport wrapper installed by makeBackboneLayer. Compose with
  // that hook instead of replacing it, and exclude zero-instance trims from
  // the GPU percentile.
  const backboneGpuProbe = useMemo(() => (
    placed
      ? createNonEmptyInstanceGpuProbeCallbacks(
        placed.backbone.mesh,
        createGpuProbeCallbacks(
          PERFORMANCE_PROBE_LABELS.populationBackboneCapsules,
        ),
      )
      : undefined
  ), [placed]);
  const placementRef = useRef<PlacementCounts | null>(null);
  const { effective: quality } = useQualityRuntime();
  const pointsGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const fibresGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const backboneLayerRef = useRef<BackboneLayer | null>(null);
  // The promoted index buffer itself, kept because the trim reads it and the
  // capsule geometry does not carry it — the instance data was expanded from
  // it and the pairs are not recoverable from the expansion.
  const backboneIndexRef = useRef<Uint32Array>(new Uint32Array(0));
  // ⟨D-3⟩ The live sprite multiplier from the last tier crossfade step, held so
  // the capsule width can take the per-frame device-pixel fill budget below.
  const spriteMulRef = useRef(1);
  // ⟨D-2⟩ The buffer density the last trim was cut for. The frame loop is the
  // only place this layer can read a DPR, and the trim runs inside it, so the
  // ratio arrives by ref rather than as an argument — `applyTrim` stays a
  // function of the tier alone, which is what its ramp calls it with.
  const trimPixelRatioRef = useRef(1);
  // ⟨close pose⟩ The camera's place on the overview↔detail curve the last trim
  // was cut at, by REF for the same reason the ratio is: the trim's argument is
  // the tier and nothing else. Mirrored out of the prop ref every frame, so the
  // value the trim folds by is exactly the one the key below compared.
  const trimFocusRef = useRef(0);
  const populationCapMul = QUALITY_PRESETS[quality].populationCapMul;

  // Placement, off the main thread. Walking 105K points of filament against a
  // twelve-octave field is ~116 ms of CPU — a long task arriving at exactly
  // the moment the page is still assembling itself — and spreading it across
  // frames would trade that for seconds of absence. Absence is a legal state
  // for this layer, so the field simply is not there until the buffers land,
  // and then it is there completely.
  //
  // Started on the first frame that has something unresolved to state. A stage
  // that covers its scope places nothing and spins nothing up.
  // NO once-latch on this effect, deliberately. The cleanup below CANCELS a
  // session in flight, so a run whose delivery was cancelled must be
  // re-runnable — a ref latch here left the store null for the life of the
  // tab whenever the effect re-ran mid-placement (StrictMode's dev probe
  // being the guaranteed case: mount, cleanup-cancel, remount, latched skip
  // — and both layers silently gone). Steady state still places exactly
  // once: re-runs only happen on a dep change, and the published-adoption
  // branch answers those without a second pass.
  // The placement gate. `active` is `gain > 0` decided by the caller — a prop
  // and not the live ref, because placement must be REACTIVE (it spins the
  // worker up on the first frame with something to state, and cancels a run in
  // flight). It is stable across blocks (it flips only on the zero crossing),
  // so it re-runs this effect on exactly the transitions `gain > 0` did before.
  const wanted = active;
  useEffect(() => {
    if (!wanted) return undefined;

    // ONE position attribute, shared by the point and line draws. The fibres
    // are an index
    // buffer over exactly the points that are drawn, which is both the
    // cheapest way to carry them — 8 bytes a segment against 24 — and the
    // structural guarantee that no fibre can reach anything but a halo
    // point: there is no other vertex for an index to name.
    const adopt = (placement: PopulationPlacementSnapshot): void => {
      backboneIndexRef.current = placement.backboneSegments;
      const position = new THREE.BufferAttribute(placement.positions, 3);
      // The taper, baked at placement from the tissue each point sits in.
      // Both of these draws bind it off ONE attribute: the points spend it on
      // size, the fibres on alpha, and the two laws are the same curve so the
      // ratio of stroke to bead never moves along the taper. The capsule pass
      // reads the same weights through its own instance buffer, off the same
      // helper, for the same reason.
      const weight = new THREE.BufferAttribute(placement.weights, 1);
      const points = new THREE.BufferGeometry();
      points.setAttribute('position', position);
      points.setAttribute('aWeight', weight);
      // The buffer is sized for the requested count; a pass that hit its work
      // ceiling reports fewer. Every prefix is a filament the walk finished,
      // so a short buffer is a thinner field, never a wrong one.
      points.setDrawRange(0, placement.count);

      const fibres = new THREE.BufferGeometry();
      fibres.setAttribute('position', position);
      // The SAME attribute object as the points bind — shared, not copied, so
      // the taper costs the fibres no upload and no memory at all.
      fibres.setAttribute('aWeight', weight);
      // The RESIDUAL half of the partition, not the whole segment buffer: a
      // promoted strand leaves this index entirely. Overlaying instead would
      // deposit the same stroke twice into a bounded accumulation, and the
      // backbone would read as brighter rather than as wider — which is the
      // one thing this class must not do.
      fibres.setIndex(new THREE.BufferAttribute(placement.residualSegments, 1));
      fibres.setDrawRange(0, placement.residualSegmentCount * 2);

      placementRef.current = {
        count: placement.count,
        segmentCount: placement.segmentCount,
        backboneSegmentCount: placement.backboneSegmentCount,
        residualSegmentCount: placement.residualSegmentCount,
        backboneComponents: placement.backboneComponents,
        streamlines: placement.streamlines,
        work: placement.work,
      };
      setPlaced({
        points,
        fibres,
        backbone: makeBackboneLayer(placement, backboneMaterial),
      });
    };

    // A placement already on the store is THE placement — the pass is pure in
    // (count, seed), so re-running it could only produce the same buffers at
    // the cost of a second long task, and a remount would draw nothing until
    // it finished. Absence-until-landed stays true of the FIRST mount, which
    // is the one the state exists for.
    const published = getPopulationPlacement();
    if (published) {
      // Latched AFTER the guards above: the boot gate waits for every
      // placement it is told to expect, so `expected` may only be reported
      // on a path whose `ready` is guaranteed — adoption here, or a session
      // whose every failure path falls back to the main thread below.
      reportBootPopulationExpected();
      adopt(published);
      reportBootPopulationReady(published.count);
      return undefined;
    }
    if (typeof Worker === 'undefined') return undefined;
    reportBootPopulationExpected();

    const worker = new Worker(
      new URL('../geometry/populationField.worker.ts', import.meta.url),
      { type: 'module', name: 'cknerv-population-field' },
    );
    // The conversation — including every failure path — lives in
    // `populationFieldSession`, which is testable where an R3F layer is not.
    // A worker that never answers used to leave the placement store null for
    // the life of the tab, taking the bridge nerve tier down with the halo.
    const session = beginPopulationFieldPlacement({
      worker,
      request: {
        kind: 'place',
        points: POPULATION_FIELD_POINTS,
        seed: POPULATION_FIELD_SEED,
      },
      onPlaced: (placement) => {
        // Published BEFORE this layer builds its geometries, so the bridge
        // layer and this one can never be looking at different buffers even
        // for one frame.
        setPopulationPlacement(placement);
        adopt(placement);
        reportBootPopulationReady(placement.count);
      },
    });

    return () => {
      session.cancel();
      worker.terminate();
    };
  }, [wanted, backboneMaterial]);

  // The preset's share of the placement, applied as a draw range rather than a
  // re-placement: the buffers are already resident and a prefix is a complete
  // thinner field, so a preset change costs three integer writes and no worker
  // pass. This is the only lever the cascade has on this layer, and before it
  // existed the cascade had none — see `populationCapMul` for the measurement.
  const applyTrim = useCallback((capMul: number) => {
    if (placed === null) return;
    const counts = placementRef.current;
    if (!counts) return;
    const tierPoints = Math.max(0, Math.min(
      counts.count,
      Math.round(counts.count * capMul),
    ));
    // ⟨close pose⟩ …and the whole prefix folds along the overview↔detail curve
    // this layer already takes. The two ceilings this file carries are pose-
    // blind — the fill budget bounds a footprint, ⟨D-2⟩ bounds a count on a
    // dense buffer — and a close camera magnifies the beads that are there
    // rather than adding any, so the three halo draws went 5.0 → 8–10 ms and
    // the scene pass 7.6 → 16–17 ms·GHz at a dolly (review B3).
    //
    // ONE multiplier, on the POINT prefix, keyed on the ref and on nothing
    // else: the file's ⟨D-10⟩ note below forbids a second camera-keyed law on
    // the stroke classes, and it does not need one — both classes are cut from
    // this prefix, so the hairlines take ⟨D-2⟩'s share OF the folded prefix
    // and the capsules take the folded prefix itself. The sub-prefix
    // guarantee below is unchanged, and so is the sprite: the level is the
    // TIER's business (`populationSpriteMulForCap` reads `capMul`, never
    // this), because a tier claims a smaller amount from one camera while a
    // close pose is the reader moving in.
    const points = Math.round(
      tierPoints * populationClosePosePrefixMul(trimFocusRef.current),
    );
    const index = placed.fibres.getIndex();
    // ⟨D-2⟩ …and the hairlines trim against a prefix OF that prefix on a buffer
    // denser than the reference: the one-device-pixel pass is the element
    // ⟨D-3⟩'s fill budget cannot reach (it writes no footprint — a `gl.LINES`
    // stroke is one device pixel by construction), and at 2× it is the single
    // most expensive draw in the frame. `populationHairlinePrefix` states the
    // law and the measurement once, beside the fill budget it completes. At or
    // below the reference this IS `points` and the range below is
    // byte-identical to the pre-D-2 path.
    const hairlinePoints = populationHairlinePrefix(
      points,
      trimPixelRatioRef.current,
    );
    // BOTH halves of the partition trim on the same rule and against a point
    // prefix. Each is a subsequence of a buffer that is monotone
    // non-decreasing in its larger endpoint, and a subsequence of a monotone
    // sequence is monotone, so the binary search is still exact on each — and
    // a segment it keeps has BOTH endpoints under the prefix it was given, so
    // no preset can leave a promoted strand hanging off a point that is not
    // drawn. The hairline prefix is a SUB-prefix of the bead prefix, so the
    // same guarantee covers it unchanged.
    const segments = index
      ? populationSegmentsForPointPrefix(
        index.array as unknown as ArrayLike<number>,
        counts.residualSegmentCount,
        hairlinePoints,
      )
      : 0;
    const backbone = populationSegmentsForPointPrefix(
      backboneIndexRef.current,
      counts.backboneSegmentCount,
      points,
    );
    placed.points.setDrawRange(0, points);
    placed.fibres.setDrawRange(0, segments * 2);
    // One integer, exactly like the two draw ranges beside it: the instance
    // buffer was written in the segment buffer's own order, so a prefix of it
    // is precisely the trimmed set.
    placed.backbone.geometry.instanceCount = backbone;
    pointsGeometryRef.current = placed.points;
    fibresGeometryRef.current = placed.fibres;
    backboneLayerRef.current = placed.backbone;
  }, [placed]);

  // ——— A tier arrives over `linger`, not between two frames ————————————
  //
  // The switch used to be a cut: three quarters of the halo gone inside one
  // raf, which on a settled page reads as something breaking rather than as a
  // control acting. The two knobs that carry this layer's picture are
  // continuous, so the tier travels along them — `blendQualityMul` is
  // geometric because both are multipliers — and the frame loop below applies
  // whatever the ramp is holding.
  //
  // Refs and not state: this runs inside `useFrame`, and a tier arriving over
  // 42 frames may not re-render the tree 42 times.
  const capTarget = populationCapMul;
  const capRamp = useRef({ from: capTarget, to: capTarget, startedAt: 0 });
  const capApplied = useRef(-1);
  // ⟨D-2⟩ The other half of the trim's key. The tier is not the only thing that
  // moves the hairline range: crossing the reference DPR does too, and a tier
  // crossfade is one way to cross it (each preset caps the renderer at its own
  // `maxDpr`, so `high → low` on a 2× display walks 2 → 1). `null` until the
  // first trim, so the opening cut is never mistaken for a settled state.
  const denseApplied = useRef<boolean | null>(null);
  // ⟨close pose⟩ The third term of the key, and the one that never settles on
  // its own: the tier is a ramp that ends and the density is a boolean, while
  // the focus travels for as long as a hand is on the wheel. `-1` is outside
  // the curve's range, so the first frame always cuts.
  const focusApplied = useRef(-1);
  useEffect(() => {
    const ramp = capRamp.current;
    if (ramp.to === capTarget) return;
    // From WHERE IT IS, not from where the last target was: a tier that
    // changes twice inside one fade continues from the picture on screen.
    ramp.from = blendQualityMul(
      ramp.from,
      ramp.to,
      qualityCrossfade(performance.now() - ramp.startedAt),
    );
    ramp.to = capTarget;
    ramp.startedAt = performance.now();
  }, [capTarget]);

  // The first application is a cut and has to be: a page opening at `med` has
  // no previous picture to travel from.
  useEffect(() => {
    if (placed === null) return;
    capApplied.current = -1;
    denseApplied.current = null;
    focusApplied.current = -1;
  }, [placed]);

  useEffect(() => () => { material.dispose(); }, [material]);
  useEffect(() => () => { fibreMaterial.dispose(); }, [fibreMaterial]);
  useEffect(() => () => { backboneMaterial.dispose(); }, [backboneMaterial]);
  // The points and the fibres share one position attribute, so they are
  // disposed together and in one synchronous cleanup — no frame can land
  // between the calls, and the second `dispose` finds the shared buffer
  // already gone.
  useEffect(() => () => {
    placed?.points.dispose();
    placed?.fibres.dispose();
    // The capsule pass owns its own instance buffers — it is the one part of
    // this layer that does not share the placement's — so it is disposed here
    // rather than freed with them.
    placed?.backbone.geometry.dispose();
  }, [placed]);

  // Dev counter, following the `__pulseStats()` precedent. It reports what the
  // placement pass produced; it never affects a number the HUD prints.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const global = window as unknown as Record<string, unknown>;
    global.__populationFieldStats = () => ({
      placement: placementRef.current,
      requested: POPULATION_FIELD_POINTS,
      // What the preset actually draws, so a live look can tell the cascade
      // reached this layer without reading a buffer.
      drawn: {
        points: pointsGeometryRef.current?.drawRange.count ?? 0,
        segments: (fibresGeometryRef.current?.drawRange.count ?? 0) / 2,
        // The capsule pass, reported beside the hairlines it was taken out
        // of, so a live look can read the partition without a buffer.
        backbone: backboneLayerRef.current?.geometry.instanceCount ?? 0,
      },
      emission: material.uniforms.uEmission.value,
      fibreEmission: fibreMaterial.uniforms.uEmission.value,
      // Equal to `fibreEmission` by construction, and printed so a live look
      // can see that it is: the backbone is wider, never brighter.
      backboneEmission: backboneMaterial.uniforms.uEmission.value,
      backboneWidthPx: backboneMaterial.linewidth,
      // The taper, so a live look can tell which build is on screen without
      // reading a shader. It reports what the layer was given; it never
      // affects a number the HUD prints.
      taper: {
        sizeMin: material.uniforms.uSizeMin.value,
        sizeMax: material.uniforms.uSizeMax.value,
        minPointPx: material.uniforms.uMinPointPx.value,
      },
    });
    return () => { delete global.__populationFieldStats; };
  }, [material, fibreMaterial, backboneMaterial]);

  // Five uniform writes. There is no march, no offscreen target, no
  // composite, and no per-frame work proportional to anything — the geometry
  // is static and the layer's only frame cost is its three draws.
  //
  // Raw useFrame rather than the sim clock: nothing here is animated, and the
  // sprite footprint has to track a viewport or DPR change even while time is
  // paused.
  useFrame((state) => {
    // The live amount, read here so a per-block change reaches the corona's
    // emission without a React commit — the caller mirrors it into this ref
    // every block while `memo(CellGalaxy)` holds the render.
    const gain = gainRef?.current ?? 0;
    // The tier, wherever its crossfade has got to. Two multipliers ride it:
    // the draw-range prefix (the cost) and the sprite radius (the level), and
    // they are two views of one number — `populationSpriteMulForCap` states
    // the relation once, in the file that owns the measurement it rests on.
    const ramp = capRamp.current;
    const capMul = blendQualityMul(
      ramp.from,
      ramp.to,
      qualityCrossfade(performance.now() - ramp.startedAt),
    );
    const pixelRatio = resolvePointSpritePixelRatio(state.gl.getPixelRatio());
    // ⟨D-3⟩ The field sizes itself at the reference-DPR fill budget, so a 2×
    // buffer spends no more halo fill than the reference monitor. At or below
    // the reference this IS the true ratio and every quantity below is
    // byte-identical to the pre-D-3 path.
    const fillPixelRatio = populationFieldFillPixelRatio(pixelRatio);
    // ⟨D-2⟩ The trim is keyed on the tier AND on the buffer density, because
    // the hairline range is a function of both. Denseness is the boolean the
    // range actually turns on — `fillPixelRatio < pixelRatio` is exactly "above
    // the reference" — so a DPR that moves inside one regime (2 → 3) is not a
    // change to re-cut for, and a settled page still does nothing at all.
    const denseBuffer = fillPixelRatio < pixelRatio;
    trimPixelRatioRef.current = pixelRatio;
    // ⟨close pose⟩ The third term. The focus moves CONTINUOUSLY along a dolly,
    // so it is keyed the way the tier is — an epsilon on the applied value,
    // never raw equality — and on the same 0.0005, which through the fold's own
    // slope (1 − floor = 0.6) is a finer step than the tier's, never a coarser
    // one. A settled camera holds it exactly, so a settled page is still three
    // draws and no work: unlike the ramp this term never ends on its own, and
    // equality on a float that a smoothstep writes every frame would re-cut for
    // the last bit of the mantissa.
    const focus = cellDetailViewFocusRef?.current ?? 0;
    trimFocusRef.current = focus;
    if (
      Math.abs(capMul - capApplied.current) > 0.0005
      || denseBuffer !== denseApplied.current
      || Math.abs(focus - focusApplied.current) > 0.0005
    ) {
      capApplied.current = capMul;
      denseApplied.current = denseBuffer;
      focusApplied.current = focus;
      applyTrim(capMul);
      const spriteMul = populationSpriteMulForCap(capMul);
      spriteMulRef.current = spriteMul;
      material.uniforms.uSizeMin.value = POPULATION_FIELD_POINT_SIZE_MIN * spriteMul;
      material.uniforms.uSizeMax.value = POPULATION_FIELD_POINT_SIZE_MAX * spriteMul;
    }
    material.uniforms.uPixelRatio.value = fillPixelRatio;
    material.uniforms.uViewportHeight.value = pointSpriteDeviceViewportHeight(
      state.size.height,
      fillPixelRatio,
    );
    // The capsule pass takes the same widening as the beads (its half of the
    // curve carries REACH; a filament thinned to a quarter of its beads reads
    // as the field not going that far), and the same ⟨D-3⟩ fill budget: its
    // device WIDTH is held to the reference DPR, while its length — like the
    // one-pixel hairline, deliberately untouched — is geometric and rides the
    // buffer. At or below the reference the scale is × 1, byte-identical.
    backboneMaterial.linewidth = POPULATION_BACKBONE_WIDTH_PX
      * spriteMulRef.current
      * (fillPixelRatio / Math.max(pixelRatio, 1e-6));
    // ⟨ruling 22⟩ The galaxy's radiance rides the amount curve, because this
    // layer states its level in ONE place and all three of its passes read it.
    // Default 1 = today's picture.
    material.uniforms.uEmission.value = populationEmissionForGain(
      gain,
      LIVE.cell.galaxyRadiance,
    );
    // ⟨D-10 · knob c⟩ The far half's spend, on the beads only: the strokes
    // are a fixed index buffer whose light is already governed by the tissue
    // taper, and the reading D-4 measured is an ACCUMULATION artefact of a
    // population — more bodies per pixel where perspective compresses them.
    // A second, camera-keyed taper on the stroke classes would be a second law
    // on the one channel this file spent four rounds reducing to one.
    material.uniforms.uDepthEnergy.value = LIVE.cell.bodyDepthEnergy;
    // The fibres ride the same amount curve, so scope changes never pull the
    // strokes and the grain on them apart.
    // ⟨D-10 · knob b⟩ …and BOTH stroke classes take the overview cap, for the
    // same reason they take one emission: they are one partition of one set of
    // strokes, and a cap on half of them would make the corona's own two
    // widths two different claims. D-8's line is "state the halo's amount in
    // LEVEL, not in reach", so this is the only thing it touches — the
    // placement, the extent and the beads are untouched. Default 1.
    // …untouched BY THE KNOB, which is what the paragraph above is about. The
    // ⟨close pose⟩ fold in the trim rides this same ref and does cut beads, and
    // the two are not in conflict: the knob is a CLAIM about the halo's amount,
    // so it may only ever spend a level, while the fold is a fill ceiling that
    // claims nothing — the field keeps its whole envelope because a prefix of
    // the placement is a complete thinner field. One curve, two laws, and this
    // is the SAME `focus` the trim folded on, read once a frame: a second read
    // could only ever let them disagree about where the camera is.
    const threadLevel = haloThreadViewLevel(
      LIVE.cell.haloThreadOverview,
      focus,
    );
    const fibreEmission = populationFibreEmissionForGain(
      gain,
      LIVE.cell.galaxyRadiance,
    ) * threadLevel;
    fibreMaterial.uniforms.uEmission.value = fibreEmission;
    // The SAME value, not a scaled one. The two classes are one partition of
    // one set of strokes, and the only thing that separates them is width.
    backboneMaterial.uniforms.uEmission.value = fibreEmission;
  });

  if (!placed || !wanted) return null;

  return (
    <>
      {/* The filaments, one sample under their own points: a one-pixel line
          against the fabric's 2.5-pixel capsule. It takes the SAME tissue
          taper the points ride, in the only currency a line has — alpha, at
          the point's own footprint falloff — so stroke and bead dim together
          and their ratio never moves along it. That constant ratio is what
          "no endpoint emphasis of any kind" actually asks for: there is no
          falloff toward a vertex and no brightening at one, and a strand's
          last points fade only because the weight they SHARE with their beads
          was faded. The stroke is the figure — a halo point must never look
          like a node with edges radiating from it. Every index addresses a
          point in the same buffer, so no fibre reaches an addressable Cell.
          Its hue is the STROKE class's, not the beads' — the core fabric's own
          vessel colour, so a filament reads as a nerve rather than as more of
          the tissue it runs through. */}
      <lineSegments
        geometry={placed.fibres}
        material={fibreMaterial}
        {...populationGpuProbes.residualFibres}
        frustumCulled={false}
        raycast={neverRaycast}
        renderOrder={-2}
      />
      {/* The strands that carry the read, at the ladder's last screen-space
          rung — 1.8 CSS pixels, which is also where the bridge's own taper
          lands when it merges into one of these strands, and DPR-aware where
          the hairline above is not. A `gl.LINES` stroke is one DEVICE pixel,
          so it was the only element in the frame that thinned as the
          framebuffer grew; at 4K it had a quarter of the areal weight the
          layer's alpha was calibrated with, which is why the outermost band
          read as beads with no nerves and why no alpha raise reached it.
          Whole strands are promoted and never scattered segments — a dashed
          promotion is that same bead failure in a new costume — and they LEAVE
          the index above rather than sitting over it. Same emission, same
          tissue taper, same hue, same blend: wider, never brighter. */}
      <primitive
        object={placed.backbone.mesh}
        {...backboneGpuProbe}
      />
      <points
        geometry={placed.points}
        material={material}
        {...populationGpuProbes.points}
        // The cloud spans the halo envelope and the camera can sit inside it.
        // Skipping the frustum test also means the bounding sphere is never
        // computed, which would otherwise be a pass over every point.
        frustumCulled={false}
        raycast={neverRaycast}
        // Under the Cell bodies (renderOrder 0) and the protocol flare (1),
        // and after the opaque chain layer. That stack is the layer contract,
        // and the chain mesh stays visible through this because the layer only
        // ever adds light.
        renderOrder={-1}
      />
    </>
  );
}
