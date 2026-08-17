import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { FIELD_HALF_X, FIELD_HALF_Z } from '../helix';
import {
  advanceTissueFieldBake,
  createTissueFieldBake,
  type TissueFieldBakeState,
} from '../geometry/tissueFieldBake';
import {
  createPopulationBloomPool,
  populationBloomLife,
  populationBloomStats,
  type PopulationBloomPool,
} from '../geometry/populationFieldBlooms';
import {
  makePopulationCompositeMaterial,
  makePopulationDensityMaterial,
  POPULATION_FIELD_BLOOM_MS,
  POPULATION_FIELD_EXTINCTION,
  POPULATION_FIELD_GRAIN_RATE,
  POPULATION_FIELD_MAX_BLOOMS,
  POPULATION_FIELD_SLAB_HALF_Y,
} from '../materials/populationFieldMaterial';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { useSimClock } from '../tweaks/SimClockScope';

/** Presentation-only cascade. Quality may reduce bake resolution, march
 *  steps, and composite cost — it may NOT remove the field, change a count,
 *  change stage membership, or make the medium indistinguishable from
 *  absence. Every preset renders the same addressable stage and states the
 *  same population. */
const POPULATION_FIELD_QUALITY = {
  high: { bake: 512, steps: 8, densityDivisor: 4 },
  med: { bake: 256, steps: 6, densityDivisor: 4 },
  low: { bake: 256, steps: 4, densityDivisor: 6 },
} as const;

/** Bake rows per frame. Measured at ~0.14 ms per row, so eight rows is about
 *  a millisecond — invisible against a frame, and a 512² bake lands in
 *  roughly a second. There is no field until it does, which is the correct
 *  state: a half-baked field would be a half-true one. */
const BAKE_ROWS_PER_FRAME = 8;

const BLOOM_DURATION_SEC = POPULATION_FIELD_BLOOM_MS / 1000;

export interface CellPopulationFieldProps {
  /** Compressed optical-depth multiplier from
   *  `deriveCellPopulationField`. Zero means the stage covers its scope and
   *  there is nothing unresolved to draw. */
  gain: number;
  /** Ring-allocated membership blooms, written by the Cell layer as the
   *  display plane's membership changes. */
  bloomPool?: PopulationBloomPool | null;
  /** Freeze the grain and the bloom phase at a deterministic point. Extent,
   *  amount, and every count are unaffected. */
  reducedMotion?: boolean;
}

/** Local-frame slab half-extents. `helix` is the sole authority on the
 *  footprint: the medium is bounded by the same envelope and deliberately
 *  omits the halo outliers, so it under-claims at the rim rather than
 *  extending it. */
const SLAB_HALF = new THREE.Vector3(
  FIELD_HALF_X,
  POPULATION_FIELD_SLAB_HALF_Y,
  FIELD_HALF_Z,
);

/** The medium is an aggregate. It is not a Cell, it has no id, and it must
 *  never return a hit — `ScreenSpaceHitIndex` plus `CellPicker` remain the
 *  sole Cell hit surface. */
function neverRaycast(): void {}

const SCRATCH_SIZE = new THREE.Vector2();
const SCRATCH_NDC = new THREE.Vector3();
const SCRATCH_CLEAR = new THREE.Color();

/**
 * The unresolved population, drawn as one continuous medium inside the same
 * tissue envelope the Cells occupy.
 *
 * Mounts inside the rotating Cell group, BELOW the Cell bodies. It reads a
 * pure model and a baked positional law; it never reads an enrichment source,
 * never allocates an id, never enters the picker, the topology worker, route
 * planning, or any pulse queue, and it does not respond to chain events —
 * a block affects specific Cells, and brightening an aggregate would claim
 * that unknown Cells participated.
 */
export default function CellPopulationField({
  gain,
  bloomPool = null,
  reducedMotion = false,
}: CellPopulationFieldProps) {
  const gl = useThree((state) => state.gl);
  const simClock = useSimClock();
  const { effective: quality } = useQualityRuntime();
  const preset = POPULATION_FIELD_QUALITY[quality];

  const densityMaterial = useMemo(() => makePopulationDensityMaterial(), []);
  const compositeMaterial = useMemo(() => makePopulationCompositeMaterial(), []);
  const geometry = useMemo(
    () => new THREE.BoxGeometry(
      SLAB_HALF.x * 2,
      SLAB_HALF.y * 2,
      SLAB_HALF.z * 2,
    ),
    [],
  );

  // The density pass renders its own scene so it can be drawn into an
  // offscreen target with the main camera. Its box tracks the composite
  // box's world matrix exactly, so both passes describe the same volume in
  // the same rotating frame.
  const densityScene = useMemo(() => {
    const scene = new THREE.Scene();
    scene.matrixWorldAutoUpdate = false;
    return scene;
  }, []);
  const densityMesh = useMemo(() => {
    const mesh = new THREE.Mesh(geometry, densityMaterial);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.raycast = neverRaycast;
    return mesh;
  }, [geometry, densityMaterial]);
  useEffect(() => {
    densityScene.add(densityMesh);
    return () => { densityScene.remove(densityMesh); };
  }, [densityScene, densityMesh]);

  const densityTarget = useMemo(
    () => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    }),
    [],
  );

  const compositeRef = useRef<THREE.Mesh>(null);
  const bakeRef = useRef<TissueFieldBakeState | null>(null);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const inverseWorld = useMemo(() => new THREE.Matrix4(), []);
  const localCamera = useMemo(() => new THREE.Vector3(), []);

  // March steps are a per-frame uniform, not a reason to re-bake.
  useEffect(() => {
    densityMaterial.uniforms.uSteps.value = preset.steps;
  }, [preset.steps, densityMaterial]);

  // Re-bake only when the RESOLUTION actually changes, and only when the
  // current bake is not already at it. `med` and `low` share a 256 bake and
  // differ only in march steps, so without this guard an adaptive med<->low
  // flip discards a finished bake and re-runs 65,536 field evaluations for a
  // byte-identical result — spending ~1 ms a frame for a second precisely
  // when the frame budget is already blown, which is what triggered the
  // downgrade. The previous texture stays bound until its replacement lands,
  // so a preset transition never blinks the field out.
  useEffect(() => {
    const bake = bakeRef.current;
    if (bake && bake.resolution === preset.bake) return;
    bakeRef.current = createTissueFieldBake(preset.bake);
  }, [preset.bake]);

  useEffect(() => () => {
    geometry.dispose();
    densityMaterial.dispose();
    compositeMaterial.dispose();
    densityTarget.dispose();
    textureRef.current?.dispose();
    textureRef.current = null;
  }, [geometry, densityMaterial, compositeMaterial, densityTarget]);

  // Dev counter, following the `__pulseStats()` precedent. Reports the bloom
  // clamp; it never affects a number the HUD prints.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const global = window as unknown as Record<string, unknown>;
    global.__populationFieldStats = () => ({
      bake: bakeRef.current
        ? { resolution: bakeRef.current.resolution, rows: bakeRef.current.rows, done: bakeRef.current.done }
        : null,
      quality,
      blooms: bloomPool
        ? populationBloomStats(bloomPool, simClock.elapsedSec, BLOOM_DURATION_SEC)
        : null,
    });
    return () => { delete global.__populationFieldStats; };
  }, [bloomPool, quality, simClock]);

  // Raw useFrame, not useSimFrame: the density march tracks the CAMERA, which
  // keeps moving while time is paused. Priority 0, so this runs before the
  // main render — R3F's own, or the one CellPortraitInset takes over.
  useFrame((state) => {
    const composite = compositeRef.current;
    if (!composite) return;

    // 1. Advance the bake against its per-frame budget.
    const bake = bakeRef.current;
    if (bake && !bake.done) {
      advanceTissueFieldBake(bake, BAKE_ROWS_PER_FRAME);
      if (bake.done) {
        const texture = new THREE.DataTexture(
          bake.data,
          bake.resolution,
          bake.resolution,
          THREE.RGBAFormat,
          THREE.HalfFloatType,
        );
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        textureRef.current?.dispose();
        textureRef.current = texture;
        densityMaterial.uniforms.uField.value = texture;
      }
    }

    // 2. Absence is a legal state: no bake yet, or nothing unresolved to
    //    state. Either way the field draws nothing at all.
    const active = textureRef.current !== null && gain > 0;
    composite.visible = active;
    if (!active) return;

    // 3. Density march, offscreen at a fraction of native.
    // The DRAWING BUFFER, not size x dpr: three floors that product, so a
    // fractional CSS size or a 1.5x ratio makes the two disagree by a pixel
    // and skews every screen-space lookup in the composite.
    gl.getDrawingBufferSize(SCRATCH_SIZE);
    const pixelRatio = gl.getPixelRatio();
    const deviceWidth = Math.max(1, SCRATCH_SIZE.x);
    const deviceHeight = Math.max(1, SCRATCH_SIZE.y);
    const targetWidth = Math.max(1, Math.floor(deviceWidth / preset.densityDivisor));
    const targetHeight = Math.max(1, Math.floor(deviceHeight / preset.densityDivisor));
    if (
      densityTarget.width !== targetWidth
      || densityTarget.height !== targetHeight
    ) {
      densityTarget.setSize(targetWidth, targetHeight);
    }

    // React runs child effects before parent ones, so this callback is
    // registered ahead of the Cell layer's — the group's rotation is still
    // last frame's when it is read here. Deliberate: both passes sample by
    // SCREEN position, so a one-frame-old medium is self-consistent, and the
    // galaxy turns far too slowly for the lag to be visible on a formless
    // field. Do not "fix" it by reaching into the Cell layer's frame order.
    composite.updateWorldMatrix(true, false);
    densityMesh.matrixWorld.copy(composite.matrixWorld);
    inverseWorld.copy(composite.matrixWorld).invert();
    localCamera.copy(state.camera.position).applyMatrix4(inverseWorld);

    densityMaterial.uniforms.uHalf.value = SLAB_HALF;
    densityMaterial.uniforms.uLocalCamera.value = localCamera;
    densityMaterial.uniforms.uOpticalDepth.value = gain * POPULATION_FIELD_EXTINCTION;

    const previousTarget = gl.getRenderTarget();
    const previousAutoClear = gl.autoClear;
    const previousClearAlpha = gl.getClearAlpha();
    gl.getClearColor(SCRATCH_CLEAR);
    // Cleared explicitly to zero rather than to whatever the renderer's clear
    // colour happens to be. R IS the coverage: a non-black ambient clear
    // would put unresolved matter over the entire screen, and nothing else in
    // the scene would look wrong enough to point at this.
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(densityTarget);
    gl.autoClear = true;
    // gl.info is untouched here — RenderStatsSampler owns that accounting and
    // this pass accumulates into its window like any other multi-pass frame.
    gl.render(densityScene, state.camera);
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(SCRATCH_CLEAR, previousClearAlpha);
    gl.autoClear = previousAutoClear;

    // 4. Composite uniforms: the grain is applied at native pixel scale, so
    //    it needs the DEVICE resolution, not the CSS one.
    const uniforms = compositeMaterial.uniforms;
    uniforms.uDensity.value = densityTarget.texture;
    uniforms.uResolution.value.set(deviceWidth, deviceHeight);
    // Reduced motion freezes the grain at a deterministic phase. Extent,
    // amount, and every count stay exactly where they were.
    // Wrapped: the phase feeds an integer hash, and an unbounded counter
    // walks out of the range a highp float can separate after a couple of
    // weeks of uptime — at which point the grain quietly stops reseeding.
    uniforms.uGrainPhase.value = reducedMotion
      ? 0
      : Math.floor(simClock.elapsedSec * POPULATION_FIELD_GRAIN_RATE) % 4096;

    // 5. Membership blooms, projected on the CPU. Sixty-four projections is
    //    nothing; sixty-four world-space ray tests per pixel would not be.
    let count = 0;
    if (bloomPool) {
      const now = simClock.elapsedSec;
      const slots = uniforms.uBlooms.value;
      for (let slot = 0; slot < bloomPool.capacity; slot += 1) {
        if (count >= POPULATION_FIELD_MAX_BLOOMS) break;
        const life = populationBloomLife(bloomPool, slot, now, BLOOM_DURATION_SEC);
        if (life < 0 || life >= 1) continue;
        const base = slot * 3;
        SCRATCH_NDC.set(
          bloomPool.positions[base],
          bloomPool.positions[base + 1],
          bloomPool.positions[base + 2],
        );
        SCRATCH_NDC.applyMatrix4(composite.matrixWorld).project(state.camera);
        // Behind the camera, or off the sides. An off-screen bloom would
        // otherwise hold one of the 64 slots against a bloom that is visible.
        if (SCRATCH_NDC.z > 1) continue;
        if (Math.abs(SCRATCH_NDC.x) > 1.4 || Math.abs(SCRATCH_NDC.y) > 1.4) continue;
        // One phase drives the whole bloom. Freezing the fade envelope while
        // the radius kept growing left it expanding at near-full strength and
        // then popping out when the pool retired it — more motion, not less.
        const phase = reducedMotion ? 0.5 : life;
        // A dissolve is broader and softer than a condense: leaving is a
        // spreading-out, arriving is a gathering-in.
        const kind = bloomPool.kind[slot];
        const radius = (kind < 0 ? 34 : 24) * pixelRatio * (0.55 + phase * 0.75);
        slots[count].set(SCRATCH_NDC.x, SCRATCH_NDC.y, phase, radius);
        count += 1;
      }
    }
    uniforms.uBloomCount.value = count;
  });

  return (
    <mesh
      ref={compositeRef}
      geometry={geometry}
      material={compositeMaterial}
      frustumCulled={false}
      raycast={neverRaycast}
      // Under the Cell bodies (renderOrder 0) and the protocol flare (1), and
      // after the opaque chain layer. That stack is the layer contract.
      renderOrder={-1}
      visible={false}
    />
  );
}
