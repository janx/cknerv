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
} from '../materials/blockBeamMaterial';
import {
  BEAM_CHARGE_DUR_S,
  BEAM_GROW_DUR_S,
  BEAM_HOLD_DUR_S,
  BEAM_STRIKE_DUR_S,
} from '../ui/topologyConstants';

export interface BlockBeamProps {
  /** Miner icosahedron world coords. The cylinder's base anchors here;
   *  its top grows toward (originWorld.x, targetY, originWorld.z). */
  originWorld: [number, number, number];
  /** Cylinder top y in world coords. Fixed at CELLS_Y by the caller. */
  targetY: number;
  /** Per-miner fire trigger. CellGalaxy writes `{ firedAt:
   *  simClock.elapsedSec }` on each block originating from this miner;
   *  BlockBeam reads it every frame and nulls it out when the animation
   *  expires. Same shape as `chainNodeFlashRefs`. */
  fireRef: React.MutableRefObject<{ firedAt: number } | null>;
}

/** Inner-core cylinder radius — the bright white-to-cyan filament. */
const CORE_RADIUS_W = 0.22;
/** Mid-halo cylinder radius — the soft cyan plasma sheath. ~3.6× the
 *  core. */
const HALO_RADIUS_W = 0.80;
/** Outer-glow cylinder radius — the broad atmospheric bleed. ~5.7×
 *  the core. Provides the "pushing into space" volumetric feel that
 *  the halo alone cannot deliver. */
const OUTER_GLOW_RADIUS_W = 1.25;
/** Peak diameter (world units) of the charging-light sprite at the
 *  miner during the charge phase. ~1.1× the strike splash so the
 *  gather reads as a substantial buildup. */
const CHARGE_SPRITE_PEAK_SIZE = 4.0;

/**
 * Per-miner energy column. One Mesh (cylinder) + one Sprite (strike
 * splash) co-driven by a single phase computation. Both objects live
 * in world space — the parent must NOT mount BlockBeam inside the
 * rotating cells group, or the column will rotate away from its
 * miner anchor.
 *
 * Visibility and uniform writes happen entirely inside `useSimFrame`.
 * When idle (`fireRef.current === null`), the meshes are hidden and
 * the body returns early. When expired (age ≥ grow + strike), the
 * body nulls `fireRef.current` so the next idle frame is a no-op.
 */
const PHASE_CFG = {
  chargeDur: BEAM_CHARGE_DUR_S,
  growDur: BEAM_GROW_DUR_S,
  holdDur: BEAM_HOLD_DUR_S,
  strikeDur: BEAM_STRIKE_DUR_S,
};

export default function BlockBeam({ originWorld, targetY, fireRef }: BlockBeamProps) {
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
    const m = makeBlockBeamOuterGlowMaterial();
    m.uniforms.uTotalHeight.value = targetY - originWorld[1];
    return m;
  }, [targetY, originWorld]);

  // Texture shared between the strike-splash at the impact point and
  // the charging-light sprite at the miner — both are soft
  // white→cyan radial gradients, the size + alpha curves are what
  // distinguish them visually.
  const splashTexture = useMemo(makeStrikeSplashSpriteTexture, []);
  const splashMaterial = useMemo(() => {
    return new THREE.SpriteMaterial({
      map: splashTexture,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0,
    });
  }, [splashTexture]);
  const chargeMaterial = useMemo(() => {
    return new THREE.SpriteMaterial({
      map: splashTexture,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      opacity: 0,
    });
  }, [splashTexture]);

  useEffect(() => () => {
    coreMaterial.dispose();
    haloMaterial.dispose();
    outerGlowMaterial.dispose();
    splashTexture.dispose();
    splashMaterial.dispose();
    chargeMaterial.dispose();
  }, [coreMaterial, haloMaterial, outerGlowMaterial, splashTexture, splashMaterial, chargeMaterial]);

  useSimFrame(() => {
    const coreMesh = coreMeshRef.current;
    const haloMesh = haloMeshRef.current;
    const outerGlowMesh = outerGlowMeshRef.current;
    const splash = splashSpriteRef.current;
    const charge = chargeSpriteRef.current;
    if (!coreMesh || !haloMesh || !outerGlowMesh || !splash || !charge) return;

    const trigger = fireRef.current;
    if (!trigger) {
      coreMesh.visible = false;
      haloMesh.visible = false;
      outerGlowMesh.visible = false;
      splash.visible = false;
      charge.visible = false;
      coreMaterial.uniforms.uAge.value = -1;
      haloMaterial.uniforms.uAge.value = -1;
      outerGlowMaterial.uniforms.uAge.value = -1;
      return;
    }

    const age = simClock.elapsedSec - trigger.firedAt;
    const phase = computeBeamPhase(age, PHASE_CFG);

    if (phase.expired) {
      fireRef.current = null;
      coreMesh.visible = false;
      haloMesh.visible = false;
      outerGlowMesh.visible = false;
      splash.visible = false;
      charge.visible = false;
      coreMaterial.uniforms.uAge.value = -1;
      haloMaterial.uniforms.uAge.value = -1;
      outerGlowMaterial.uniforms.uAge.value = -1;
      return;
    }

    coreMesh.visible = phase.visible;
    haloMesh.visible = phase.visible;
    outerGlowMesh.visible = phase.visible;
    coreMaterial.uniforms.uAge.value = age;
    haloMaterial.uniforms.uAge.value = age;
    outerGlowMaterial.uniforms.uAge.value = age;

    splash.visible = phase.spriteVisible;
    if (phase.spriteVisible) {
      const sizeWorld = phase.spriteSize * STRIKE_SPRITE_PEAK_SIZE;
      splash.scale.set(sizeWorld, sizeWorld, 1);
      splashMaterial.opacity = phase.spriteAlpha;
    }

    charge.visible = phase.chargeVisible;
    if (phase.chargeVisible) {
      const sizeWorld = phase.chargeSize * CHARGE_SPRITE_PEAK_SIZE;
      charge.scale.set(sizeWorld, sizeWorld, 1);
      chargeMaterial.opacity = phase.chargeAlpha;
    }
  });

  return (
    <>
      {/* Outermost glow — broad atmospheric bleed, very faint, pure
          cyan. Renders first (lowest renderOrder). */}
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
      {/* Mid halo — soft cyan plasma sheath. Fades to nothing at the
          silhouette so the cylinder edge isn't a hard boundary. */}
      <mesh
        ref={haloMeshRef}
        position={originWorld}
        scale={[HALO_RADIUS_W, 1, HALO_RADIUS_W]}
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
        scale={[CORE_RADIUS_W, 1, CORE_RADIUS_W]}
        material={coreMaterial}
        frustumCulled={false}
        renderOrder={-1}
        visible={false}
      >
        <cylinderGeometry args={[1, 1, 1, 16, 12, true]} />
      </mesh>
      {/* Strike splash — blooms at the impact point on the cell plane
          when the beam arrives. */}
      <sprite
        ref={splashSpriteRef}
        position={[originWorld[0], targetY, originWorld[2]]}
        material={splashMaterial}
        renderOrder={-1}
        visible={false}
      />
      {/* Charging light point — gathers energy at the miner during
          the charge phase, collapses on burst as the beam launches. */}
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
