import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { computeBeamPhase } from '../materials/blockBeamPhase';
import {
  makeBlockBeamHaloMaterial,
  makeBlockBeamMaterial,
  makeBlockBeamOuterGlowMaterial,
  makeStrikeSplashSpriteTexture,
  STRIKE_SPRITE_PEAK_SIZE,
  BEAM_FLOW_SPEED,
} from '../materials/blockBeamMaterial';
import {
  BEAM_GROW_DUR_S,
  BEAM_HOLD_DUR_S,
  BEAM_STRIKE_DUR_S,
  BEAM_CHARGE_DUR_S,
} from '../ui/topologyConstants';

export interface BlockBeamProps {
  /** Anchor world coords. The cylinders' base sits here; tops grow toward
   *  (originWorld.x, targetY, originWorld.z). */
  originWorld: [number, number, number];
  /** Cylinder top y in world coords (CELLS_Y by the caller). */
  targetY: number;
  /** Per-node fire trigger. The parent writes `{ firedAt }` when the node
   *  receives the block; BlockBeam reads it every frame and nulls it on
   *  expiry. A future `firedAt` sits idle until it arrives. */
  fireRef: React.MutableRefObject<{ firedAt: number } | null>;
  /** Inner-core cylinder radius (world units). Default = hero CORE_RADIUS_W. */
  coreRadius?: number;
  /** Mid-halo cylinder radius (world units). Default = hero HALO_RADIUS_W. */
  haloRadius?: number;
  /** Render the broad outer-glow cylinder. Peers pass false (one fewer
   *  material + draw, lighter silhouette). Default true (hero). */
  showOuterGlow?: boolean;
  /** Peak strike-splash diameter (world units). Default STRIKE_SPRITE_PEAK_SIZE. */
  splashPeakSize?: number;
  /** Grow-window duration (s). Default BEAM_GROW_DUR_S. Peers jitter this. */
  growDur?: number;
  /** Hold duration (s). Default BEAM_HOLD_DUR_S. */
  holdDur?: number;
  /** Strike-window duration (s). Default BEAM_STRIKE_DUR_S. Keep > holdDur. */
  strikeDur?: number;
  /** Core scrolling-flow speed (wu/s). Default BEAM_FLOW_SPEED. */
  flowSpeed?: number;
  /** Charge-glow radius (world units) seated at the node center. Default
   *  CHARGE_RADIUS_W (hero-sized). Peers pass a smaller value. */
  chargeRadius?: number;
  /** Pre-roll charge duration (s). Default BEAM_CHARGE_DUR_S. */
  chargeDur?: number;
}

/** Inner-core cylinder radius — the bright white-to-cyan filament. */
const CORE_RADIUS_W = 0.22;
/** Mid-halo cylinder radius — the soft cyan plasma sheath. ~3.6× the core. */
const HALO_RADIUS_W = 0.80;
/** Outer-glow cylinder radius — the broad atmospheric bleed. ~5.7× the core. */
const OUTER_GLOW_RADIUS_W = 1.25;
/** Charge-glow radius — the energy that gathers inside the node before the
 *  burst. ≈ the CKB icosahedron radius so the glow reads as filling the node. */
const CHARGE_RADIUS_W = 2.4;
/** How long the charge "releases" (pops + fades) after the beam launches. */
const CHARGE_RELEASE_S = 0.12;

// One splash texture shared by every BlockBeam (hero + all peer tributaries):
// a soft white→cyan radial gradient, immutable. Built lazily on first use so
// ~80 peer beams don't each allocate a 256² canvas; lives for the app's
// lifetime and is intentionally never disposed.
let sharedSplashTexture: THREE.Texture | null = null;
function getSplashTexture(): THREE.Texture {
  if (!sharedSplashTexture) sharedSplashTexture = makeStrikeSplashSpriteTexture();
  return sharedSplashTexture;
}

/**
 * Per-node energy column. Cylinders (core/halo, optional outer-glow) + a
 * strike-splash sprite, co-driven by one phase computation. All objects live
 * in world space — the parent must NOT mount BlockBeam inside a rotating
 * group, or the column rotates away from its anchor. Visibility + uniform
 * writes happen entirely inside useSimFrame; idle (`fireRef.current === null`)
 * hides everything and returns early.
 */
export default function BlockBeam({
  originWorld,
  targetY,
  fireRef,
  coreRadius = CORE_RADIUS_W,
  haloRadius = HALO_RADIUS_W,
  showOuterGlow = true,
  splashPeakSize = STRIKE_SPRITE_PEAK_SIZE,
  growDur = BEAM_GROW_DUR_S,
  holdDur = BEAM_HOLD_DUR_S,
  strikeDur = BEAM_STRIKE_DUR_S,
  flowSpeed = BEAM_FLOW_SPEED,
  chargeRadius = CHARGE_RADIUS_W,
  chargeDur = BEAM_CHARGE_DUR_S,
}: BlockBeamProps) {
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const haloMeshRef = useRef<THREE.Mesh>(null);
  const outerGlowMeshRef = useRef<THREE.Mesh>(null);
  const splashSpriteRef = useRef<THREE.Sprite>(null);
  const chargeSpriteRef = useRef<THREE.Sprite>(null);

  const coreMaterial = useMemo(() => {
    const m = makeBlockBeamMaterial();
    m.uniforms.uTotalHeight.value = targetY - originWorld[1];
    return m;
  }, [targetY, originWorld]);

  const haloMaterial = useMemo(() => {
    const m = makeBlockBeamHaloMaterial();
    m.uniforms.uTotalHeight.value = targetY - originWorld[1];
    return m;
  }, [targetY, originWorld]);

  const outerGlowMaterial = useMemo(() => {
    if (!showOuterGlow) return null;
    const m = makeBlockBeamOuterGlowMaterial();
    m.uniforms.uTotalHeight.value = targetY - originWorld[1];
    return m;
  }, [targetY, originWorld, showOuterGlow]);

  const splashMaterial = useMemo(() => {
    return new THREE.SpriteMaterial({
      map: getSplashTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0,
    });
  }, []);

  // Charge-pre-roll glow — same shared white→cyan splash texture, seated at the
  // node center. Brightens + swells as the charge builds, then pops + fades as
  // the beam erupts. Opacity/scale are written per frame.
  const chargeMaterial = useMemo(() => {
    return new THREE.SpriteMaterial({
      map: getSplashTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0,
    });
  }, []);

  useEffect(() => () => {
    coreMaterial.dispose();
    haloMaterial.dispose();
    outerGlowMaterial?.dispose();
    splashMaterial.dispose();
    chargeMaterial.dispose();
    // sharedSplashTexture is a module singleton — intentionally not disposed.
  }, [coreMaterial, haloMaterial, outerGlowMaterial, splashMaterial, chargeMaterial]);

  useSimFrame(() => {
    const coreMesh = coreMeshRef.current;
    const haloMesh = haloMeshRef.current;
    const outerGlowMesh = outerGlowMeshRef.current; // null when showOuterGlow=false
    const splash = splashSpriteRef.current;
    if (!coreMesh || !haloMesh || !splash) return;

    const trigger = fireRef.current;
    if (!trigger) {
      coreMesh.visible = false;
      haloMesh.visible = false;
      if (outerGlowMesh) outerGlowMesh.visible = false;
      splash.visible = false;
      coreMaterial.uniforms.uAge.value = -1;
      haloMaterial.uniforms.uAge.value = -1;
      if (outerGlowMaterial) outerGlowMaterial.uniforms.uAge.value = -1;
      if (chargeSpriteRef.current) chargeSpriteRef.current.visible = false;
      chargeMaterial.opacity = 0;
      return;
    }

    // Per-instance shape, applied every frame (cheap uniform writes) so the parent
    // can vary the beam's tempo/flow per block without rebuilding materials.
    coreMaterial.uniforms.uGrowDur.value = growDur;
    coreMaterial.uniforms.uHoldDur.value = holdDur;
    coreMaterial.uniforms.uStrikeDur.value = strikeDur;
    coreMaterial.uniforms.uFlowSpeed.value = flowSpeed;
    haloMaterial.uniforms.uGrowDur.value = growDur;
    haloMaterial.uniforms.uHoldDur.value = holdDur;
    haloMaterial.uniforms.uStrikeDur.value = strikeDur;
    if (outerGlowMaterial) {
      outerGlowMaterial.uniforms.uGrowDur.value = growDur;
      outerGlowMaterial.uniforms.uHoldDur.value = holdDur;
      outerGlowMaterial.uniforms.uStrikeDur.value = strikeDur;
    }

    const age = simClock.elapsedSec - trigger.firedAt;
    const phase = computeBeamPhase(age, { growDur, holdDur, strikeDur, chargeDur });

    if (phase.expired) {
      fireRef.current = null;
      coreMesh.visible = false;
      haloMesh.visible = false;
      if (outerGlowMesh) outerGlowMesh.visible = false;
      splash.visible = false;
      coreMaterial.uniforms.uAge.value = -1;
      haloMaterial.uniforms.uAge.value = -1;
      if (outerGlowMaterial) outerGlowMaterial.uniforms.uAge.value = -1;
      if (chargeSpriteRef.current) chargeSpriteRef.current.visible = false;
      chargeMaterial.opacity = 0;
      return;
    }

    coreMesh.visible = phase.visible;
    haloMesh.visible = phase.visible;
    coreMaterial.uniforms.uAge.value = age;
    haloMaterial.uniforms.uAge.value = age;
    if (outerGlowMesh && outerGlowMaterial) {
      outerGlowMesh.visible = phase.visible;
      outerGlowMaterial.uniforms.uAge.value = age;
    }

    splash.visible = phase.spriteVisible;
    if (phase.spriteVisible) {
      const sizeWorld = phase.spriteSize * splashPeakSize;
      splash.scale.set(sizeWorld, sizeWorld, 1);
      splashMaterial.opacity = phase.spriteAlpha;
    }

    // Charge glow: gather inside the node during the pre-roll (phase.charging),
    // then a brief release pop as the column erupts (age ∈ [0, CHARGE_RELEASE_S)).
    const charge = chargeSpriteRef.current;
    if (charge) {
      if (phase.charging) {
        charge.visible = true;
        const e = phase.chargeT * phase.chargeT; // ease-in: energy accelerating
        const sizeW = chargeRadius * (0.35 + 0.65 * e);
        charge.scale.set(sizeW, sizeW, 1);
        chargeMaterial.opacity = e;
      } else if (age >= 0 && age < CHARGE_RELEASE_S) {
        charge.visible = true;
        const rt = age / CHARGE_RELEASE_S; // pop outward + fade
        const sizeW = chargeRadius * (1.0 + 0.6 * rt);
        charge.scale.set(sizeW, sizeW, 1);
        chargeMaterial.opacity = 1.0 - rt;
      } else {
        charge.visible = false;
        chargeMaterial.opacity = 0;
      }
    }
  });

  return (
    <>
      {/* Outermost glow — broad atmospheric bleed (hero only). */}
      {showOuterGlow && outerGlowMaterial ? (
        <mesh
          ref={outerGlowMeshRef}
          position={originWorld}
          scale={[OUTER_GLOW_RADIUS_W, 1, OUTER_GLOW_RADIUS_W]}
          material={outerGlowMaterial}
          frustumCulled={false}
          renderOrder={-3}
          visible={false}
        >
          <cylinderGeometry args={[1, 1, 1, 16, 12, true]} />
        </mesh>
      ) : null}
      {/* Mid halo — soft cyan plasma sheath. */}
      <mesh
        ref={haloMeshRef}
        position={originWorld}
        scale={[haloRadius, 1, haloRadius]}
        material={haloMaterial}
        frustumCulled={false}
        renderOrder={-2}
        visible={false}
      >
        <cylinderGeometry args={[1, 1, 1, 16, 12, true]} />
      </mesh>
      {/* Inner core — bright filament with scrolling flow streaks. */}
      <mesh
        ref={coreMeshRef}
        position={originWorld}
        scale={[coreRadius, 1, coreRadius]}
        material={coreMaterial}
        frustumCulled={false}
        renderOrder={-1}
        visible={false}
      >
        <cylinderGeometry args={[1, 1, 1, 16, 12, true]} />
      </mesh>
      {/* Strike splash — blooms at the impact point when the beam arrives. */}
      <sprite
        ref={splashSpriteRef}
        position={[originWorld[0], targetY, originWorld[2]]}
        material={splashMaterial}
        renderOrder={-1}
        visible={false}
      />
      {/* Charge pre-roll glow — gathers inside the node, then releases as the
          column erupts. Seated at the node center (originWorld). */}
      <sprite
        ref={chargeSpriteRef}
        position={originWorld}
        material={chargeMaterial}
        renderOrder={-1}
        visible={false}
      />
    </>
  );
}
