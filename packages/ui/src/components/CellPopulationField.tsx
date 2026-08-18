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
  makePopulationPointMaterial,
  POPULATION_FIELD_EMISSION,
} from '../materials/populationFieldMaterial';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../materials/pointSpritePresentation';

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
 *  The override is defensive, and for a point cloud it is worth having twice
 *  over — unlike a bare Object3D, points ship a real default raycast against a
 *  one-world-unit sphere per vertex, which is a far looser surface than any
 *  mesh would offer if this ever moved in the tree. */
function neverRaycast(): void {}

/**
 * The unresolved population, drawn as real points in the same world the Cells
 * live in — the same law, the same material family, the same rotating frame.
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
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const placementRef = useRef<{ count: number; tries: number } | null>(null);
  const startedRef = useRef(false);

  // Placement, off the main thread. Five million candidates against a
  // twelve-octave field is about a second of CPU — a long task arriving at
  // exactly the moment the page is still assembling itself — and spreading it
  // across frames would trade that for ten seconds of absence. Absence is a
  // legal state for this layer, so the field simply is not there until the
  // buffer lands, and then it is there completely.
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
      const placed = new THREE.BufferGeometry();
      placed.setAttribute(
        'position',
        new THREE.BufferAttribute(response.positions, 3),
      );
      // The buffer is sized for the requested count; a pass that hit its try
      // ceiling reports fewer. Every prefix is an unbiased sample of the same
      // distribution, so a short buffer is a thinner field, never a wrong one.
      placed.setDrawRange(0, response.count);
      placementRef.current = {
        count: response.count,
        tries: response.tries,
      };
      setGeometry(placed);
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
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  // Dev counter, following the `__pulseStats()` precedent. It reports what the
  // placement pass produced; it never affects a number the HUD prints.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const global = window as unknown as Record<string, unknown>;
    global.__populationFieldStats = () => ({
      placement: placementRef.current,
      requested: POPULATION_FIELD_POINTS,
      emission: material.uniforms.uEmission.value,
    });
    return () => { delete global.__populationFieldStats; };
  }, [material]);

  // Three uniform writes. There is no march, no offscreen target, no
  // composite, and no per-frame work proportional to anything — the geometry
  // is static and the layer's only frame cost is its draw.
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
    material.uniforms.uEmission.value = Math.max(0, gain)
      * POPULATION_FIELD_EMISSION;
  });

  if (!geometry || !wanted) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      // The cloud spans the halo envelope and the camera can sit inside it.
      // Skipping the frustum test also means the bounding sphere is never
      // computed, which would otherwise be a pass over every point.
      frustumCulled={false}
      raycast={neverRaycast}
      // Under the Cell bodies (renderOrder 0) and the protocol flare (1), and
      // after the opaque chain layer. That stack is the layer contract, and
      // the chain mesh stays visible through this because the layer only ever
      // adds light.
      renderOrder={-1}
    />
  );
}
