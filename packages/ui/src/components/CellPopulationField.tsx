import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import {
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
} from '../geometry/populationFieldPlacement';
// Type-only, so the worker module's body never lands in the main bundle —
// it is reached exclusively through `new URL(...)` below.
import type {
  PopulationFieldWorkerRequest,
  PopulationFieldWorkerResponse,
} from '../geometry/populationField.worker';
import {
  makePopulationFibreMaterial,
  makePopulationPointMaterial,
  populationEmissionForGain,
  populationFibreEmissionForGain,
} from '../materials/populationFieldMaterial';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../materials/pointSpritePresentation';

interface PlacedGeometry {
  /** The population itself. */
  points: THREE.BufferGeometry;
  /** The filaments, as an index buffer over the SAME position attribute. */
  fibres: THREE.BufferGeometry;
}

interface PlacementCounts {
  count: number;
  segmentCount: number;
  streamlines: number;
  work: number;
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
function neverRaycast(): void {}

/**
 * The unresolved population, drawn as real filaments in the same world the
 * Cells live in — the same law, the same material family, the same rotating
 * frame.
 *
 * The layer is two draws over ONE buffer of positions: the points, and the
 * fibres that connect consecutive points on a filament. The fibres are what
 * make it read as tissue rather than as spray. Measured at the production
 * camera, the points alone carry an orientation coherence of 0.196 against a
 * Poisson floor of 0.194 — a density modulation cannot look like a drawn
 * thread, and at ~2.5 points per pixel the noise of an independent draw eats
 * every modulation there is. With the fibres the same field measures 0.333.
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
  const [placed, setPlaced] = useState<PlacedGeometry | null>(null);
  const placementRef = useRef<PlacementCounts | null>(null);
  const startedRef = useRef(false);

  // Placement, off the main thread. Walking 105K points of filament against a
  // twelve-octave field is ~150 ms of CPU — a long task arriving at exactly
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
    if (typeof Worker === 'undefined') return undefined;
    startedRef.current = true;

    const worker = new Worker(
      new URL('../geometry/populationField.worker.ts', import.meta.url),
      { type: 'module', name: 'cknerv-population-field' },
    );
    let cancelled = false;
    worker.onmessage = (event: MessageEvent<PopulationFieldWorkerResponse>) => {
      const response = event.data;
      worker.terminate();
      if (cancelled || response?.kind !== 'placed') return;
      // ONE position attribute, shared by both draws. The fibres are an index
      // buffer over exactly the points that are drawn, which is both the
      // cheapest way to carry them — 8 bytes a segment against 24 — and the
      // structural guarantee that no fibre can reach anything but a halo
      // point: there is no other vertex for an index to name.
      const position = new THREE.BufferAttribute(response.positions, 3);
      const points = new THREE.BufferGeometry();
      points.setAttribute('position', position);
      // The buffer is sized for the requested count; a pass that hit its work
      // ceiling reports fewer. Every prefix is a filament the walk finished,
      // so a short buffer is a thinner field, never a wrong one.
      points.setDrawRange(0, response.count);

      const fibres = new THREE.BufferGeometry();
      fibres.setAttribute('position', position);
      fibres.setIndex(new THREE.BufferAttribute(response.segments, 1));
      fibres.setDrawRange(0, response.segmentCount * 2);

      placementRef.current = {
        count: response.count,
        segmentCount: response.segmentCount,
        streamlines: response.streamlines,
        work: response.work,
      };
      setPlaced({ points, fibres });
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
  }, [wanted]);

  useEffect(() => () => { material.dispose(); }, [material]);
  useEffect(() => () => { fibreMaterial.dispose(); }, [fibreMaterial]);
  // Both geometries share one position attribute, so they are disposed
  // together and in one synchronous cleanup — no frame can land between the
  // two calls, and the second `dispose` finds the shared buffer already gone.
  useEffect(() => () => {
    placed?.points.dispose();
    placed?.fibres.dispose();
  }, [placed]);

  // Dev counter, following the `__pulseStats()` precedent. It reports what the
  // placement pass produced; it never affects a number the HUD prints.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const global = window as unknown as Record<string, unknown>;
    global.__populationFieldStats = () => ({
      placement: placementRef.current,
      requested: POPULATION_FIELD_POINTS,
      emission: material.uniforms.uEmission.value,
      fibreEmission: fibreMaterial.uniforms.uEmission.value,
    });
    return () => { delete global.__populationFieldStats; };
  }, [material, fibreMaterial]);

  // Four uniform writes. There is no march, no offscreen target, no
  // composite, and no per-frame work proportional to anything — the geometry
  // is static and the layer's only frame cost is its two draws.
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
    fibreMaterial.uniforms.uEmission.value = populationFibreEmissionForGain(gain);
  });

  if (!placed || !wanted) return null;

  return (
    <>
      {/* The filaments, one sample under their own points: a one-pixel line
          against the fabric's 2.5-pixel capsule, flat along its whole length,
          with no taper and no brightening at a vertex. The stroke is the
          figure — a halo point must never look like a node with edges
          radiating from it. Every index addresses a point in the same buffer,
          so no fibre reaches an addressable Cell. */}
      <lineSegments
        geometry={placed.fibres}
        material={fibreMaterial}
        frustumCulled={false}
        raycast={neverRaycast}
        renderOrder={-2}
      />
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
