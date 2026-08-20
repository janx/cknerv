import { useEffect, useMemo, useRef, useState } from 'react';
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
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
// Type-only, so the worker module's body never lands in the main bundle —
// it is reached exclusively through `new URL(...)` below.
import type {
  PopulationFieldWorkerRequest,
  PopulationFieldWorkerResponse,
} from '../geometry/populationField.worker';
import {
  makeScreenSpaceCapsuleGeometry,
  syncScreenSpaceCapsuleViewport,
} from '../geometry/screenSpaceCapsuleLine';
import {
  makePopulationBackboneMaterial,
  makePopulationFibreMaterial,
  makePopulationPointMaterial,
  populationEmissionForGain,
  populationFibreEmissionForGain,
  populationFibreSizeRatio,
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
 * shipped budget that is 0.384 MB against the 1.26 MB a duplicate of the whole
 * position buffer would cost, 30% of it.
 *
 * What the second buffer carries is the size RATIO, not the taper. The shader
 * squares the interpolated value, because mix() is linear and interpolating an
 * already-squared taper would dim the middle of every segment — the fibre
 * shader has always done it this way, and `populationFibreSizeRatio` is that
 * number named so this class cannot drift from it.
 *
 * Pure, and exported for the test that checks the second half of that
 * sentence: the taper at each end of a capsule must equal
 * `populationFibreTaper` of the weight the hairlines share.
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
    taper[s * 2] = populationFibreSizeRatio(placement.weights[a]);
    taper[s * 2 + 1] = populationFibreSizeRatio(placement.weights[b]);
  }
  return { endpoints, taper };
}

/**
 * The third draw, built once from a finished placement.
 *
 * The taper rides `instanceColorStart/End` as ONE component rather than three.
 * GL fills a `vec3` attribute's missing components with `(0, 1)` and the
 * fragment reads only `.r`, so it costs two floats a segment instead of six —
 * 0.128 MB rather than 0.384 MB at the shipped budget.
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
  /** Compressed amount from `deriveCellPopulationField`. Zero means the stage
   *  covers its scope and there is nothing unresolved to state — nothing is
   *  placed, and nothing is drawn. */
  gain: number;
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
  gain,
}: CellPopulationFieldProps) {
  const material = useMemo(() => makePopulationPointMaterial(), []);
  const fibreMaterial = useMemo(() => makePopulationFibreMaterial(), []);
  const backboneMaterial = useMemo(() => makePopulationBackboneMaterial(), []);
  const [placed, setPlaced] = useState<PlacedGeometry | null>(null);
  const placementRef = useRef<PlacementCounts | null>(null);
  const startedRef = useRef(false);
  const { effective: quality } = useQualityRuntime();
  const pointsGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const fibresGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const backboneLayerRef = useRef<BackboneLayer | null>(null);
  // The promoted index buffer itself, kept because the trim reads it and the
  // capsule geometry does not carry it — the instance data was expanded from
  // it and the pairs are not recoverable from the expansion.
  const backboneIndexRef = useRef<Uint32Array>(new Uint32Array(0));
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
  const wanted = gain > 0;
  useEffect(() => {
    if (!wanted || startedRef.current) return undefined;
    startedRef.current = true;

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
      adopt(published);
      return undefined;
    }
    if (typeof Worker === 'undefined') return undefined;

    const worker = new Worker(
      new URL('../geometry/populationField.worker.ts', import.meta.url),
      { type: 'module', name: 'cknerv-population-field' },
    );
    let cancelled = false;
    worker.onmessage = (event: MessageEvent<PopulationFieldWorkerResponse>) => {
      const response = event.data;
      worker.terminate();
      if (cancelled || response?.kind !== 'placed') return;
      const placement: PopulationPlacementSnapshot = {
        positions: response.positions,
        segments: response.segments,
        backboneSegments: response.backboneSegments,
        backboneSegmentCount: response.backboneSegmentCount,
        residualSegments: response.residualSegments,
        residualSegmentCount: response.residualSegmentCount,
        backboneComponents: response.backboneComponents,
        weights: response.weights,
        count: response.count,
        segmentCount: response.segmentCount,
        streamlines: response.streamlines,
        work: response.work,
      };
      // Published BEFORE this layer builds its geometries, so the bridge
      // layer and this one can never be looking at different buffers even for
      // one frame.
      setPopulationPlacement(placement);
      adopt(placement);
    };
    const request: PopulationFieldWorkerRequest = {
      kind: 'place',
      points: POPULATION_FIELD_POINTS,
      seed: POPULATION_FIELD_SEED,
    };
    worker.postMessage(request);

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [wanted, backboneMaterial]);

  // The preset's share of the placement, applied as a draw range rather than a
  // re-placement: the buffers are already resident and a prefix is a complete
  // thinner field, so a preset change costs three integer writes and no worker
  // pass. This is the only lever the cascade has on this layer, and before it
  // existed the cascade had none — see `populationCapMul` for the measurement.
  useEffect(() => {
    if (placed === null) return;
    const counts = placementRef.current;
    if (!counts) return;
    const points = Math.max(0, Math.min(
      counts.count,
      Math.round(counts.count * populationCapMul),
    ));
    const index = placed.fibres.getIndex();
    // BOTH halves of the partition trim on the same rule and against the same
    // point prefix. Each is a subsequence of a buffer that is monotone
    // non-decreasing in its larger endpoint, and a subsequence of a monotone
    // sequence is monotone, so the binary search is still exact on each — and
    // a segment it keeps has BOTH endpoints under the prefix, so no preset can
    // leave a promoted strand hanging off a point that is not drawn.
    const segments = index
      ? populationSegmentsForPointPrefix(
        index.array as unknown as ArrayLike<number>,
        counts.residualSegmentCount,
        points,
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
  }, [placed, populationCapMul]);

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
    const pixelRatio = resolvePointSpritePixelRatio(state.gl.getPixelRatio());
    material.uniforms.uPixelRatio.value = pixelRatio;
    material.uniforms.uViewportHeight.value = pointSpriteDeviceViewportHeight(
      state.size.height,
      pixelRatio,
    );
    material.uniforms.uEmission.value = populationEmissionForGain(gain);
    // The fibres ride the same amount curve, so scope changes never pull the
    // strokes and the grain on them apart.
    const fibreEmission = populationFibreEmissionForGain(gain);
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
        frustumCulled={false}
        raycast={neverRaycast}
        renderOrder={-2}
      />
      {/* The strands that carry the read, at the ladder's last screen-space
          rung — 1.6 CSS pixels against the bridge's 2.0, and DPR-aware where
          the hairline above is not. A `gl.LINES` stroke is one DEVICE pixel,
          so it was the only element in the frame that thinned as the
          framebuffer grew; at 4K it had a quarter of the areal weight the
          layer's alpha was calibrated with, which is why the outermost band
          read as beads with no nerves and why no alpha raise reached it.
          Whole strands are promoted and never scattered segments — a dashed
          promotion is that same bead failure in a new costume — and they LEAVE
          the index above rather than sitting over it. Same emission, same
          tissue taper, same hue, same blend: wider, never brighter. */}
      <primitive object={placed.backbone.mesh} />
      <points
        geometry={placed.points}
        material={material}
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
