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
  makeBeamSourceOrbMaterial,
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
  /** Source-orb size basis (world units). The energy orb at the foot is sized
   *  off this; default CHARGE_RADIUS_W (hero). Peers pass a smaller value. */
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
/** Source-orb size basis — the energy orb at the beam's foot is sized off this
 *  (≈ half it). ≈ the CKB icosahedron radius. */
const CHARGE_RADIUS_W = 2.4;
/** Ignite-bloom window (s) right after launch, before the source settles to
 *  its steady sustain glow. */
const IGNITE_S = 0.12;
/** Steady source-orb opacity during the beam's sustain — the root the column
 *  is fed from — relative to the ignite peak of 1.0. */
const SOURCE_SUSTAIN = 0.45;
/** Spend window (s) at retract start: the orb flares then collapses to nothing
 *  (a mirror of the gather), quick so it doesn't linger as the beam drains up. */
const SPEND_S = 0.18;

/** Unit sphere shared by every beam's source orb (scaled per frame). Module
 *  singleton — built once, never disposed. */
const SOURCE_ORB_GEOM = new THREE.SphereGeometry(1, 24, 16);

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
  const chargeOrbRef = useRef<THREE.Mesh>(null);

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

  // Energy-source orb — a soft glowing sphere at the node that spans the whole
  // beam: condenses + brightens during the charge (visible 聚能), blooms at
  // ignite, then settles to a steady breathing "root" the column erupts from
  // and is fed by, fading as the base retracts. Its rounded form caps the foot.
  // uOpacity + mesh scale are written per frame.
  const orbMaterial = useMemo(() => makeBeamSourceOrbMaterial(), []);

  // Per-beam phase so the source-glow breathing isn't synced across all nodes.
  const breathePhase = useMemo(
    () => originWorld[0] * 0.7 + originWorld[2] * 1.3,
    [originWorld],
  );

  useEffect(() => () => {
    coreMaterial.dispose();
    haloMaterial.dispose();
    outerGlowMaterial?.dispose();
    splashMaterial.dispose();
    orbMaterial.dispose();
    // shared textures + the orb geometry are module singletons — not disposed.
  }, [coreMaterial, haloMaterial, outerGlowMaterial, splashMaterial, orbMaterial]);

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
      if (chargeOrbRef.current) chargeOrbRef.current.visible = false;
      orbMaterial.uniforms.uOpacity.value = 0;
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
      if (chargeOrbRef.current) chargeOrbRef.current.visible = false;
      orbMaterial.uniforms.uOpacity.value = 0;
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

    // Energy-source orb at the node: ONE glowing sphere spanning the whole
    // event — gather (condense + brighten) → ignite (bloom) → sustain (a steady
    // breathing root the column erupts from) → fade as the base retracts. Its
    // rounded form caps the foot; the condense + brighten is the visible 聚能.
    const orb = chargeOrbRef.current;
    if (orb) {
      const orbBase = chargeRadius * 0.5;                  // nominal source radius
      const sustainEndAge = growDur + holdDur;             // hold ends, retract begins
      const breathe = 0.82 + 0.18 * Math.sin(simClock.elapsedSec * 2.6 + breathePhase);
      if (phase.charging) {
        // Gather: the orb condenses from wide+faint to a tight bright ball.
        const p = phase.chargeT;            // 0 → 1 across the charge window
        const e = p * p;                    // accelerate the gather toward launch
        const fadeIn = Math.min(1, p / 0.12);
        orb.visible = true;
        orb.scale.setScalar(orbBase * (1.5 - 0.6 * e)); // 1.5× → 0.9×
        orbMaterial.uniforms.uOpacity.value = (0.2 + 0.8 * e) * fadeIn;
      } else if (age < 0) {
        // Future-dated firedAt still far off — nothing gathered yet.
        orb.visible = false;
        orbMaterial.uniforms.uOpacity.value = 0;
      } else if (age < IGNITE_S) {
        // Ignite: a brief bright bloom, then ease to the steady sustain level.
        const it = age / IGNITE_S;
        orb.visible = true;
        orb.scale.setScalar(orbBase * (0.9 + 0.3 * Math.sin(Math.PI * it)));
        orbMaterial.uniforms.uOpacity.value = 1.0 - (1.0 - SOURCE_SUSTAIN) * it;
      } else if (age < sustainEndAge) {
        // Sustain: a steady breathing root the column is continuously fed from.
        orb.visible = true;
        orb.scale.setScalar(orbBase * (0.95 + 0.05 * breathe));
        orbMaterial.uniforms.uOpacity.value = SOURCE_SUSTAIN * breathe;
      } else {
        // Spend: a final bright flare (energy expelled up into the beam) then
        // the orb collapses inward to nothing — a mirror of the gather's
        // condense-in, and quick (SPEND_S) so it doesn't linger disconnected as
        // the beam drains up off the node.
        const st = Math.min(1, (age - sustainEndAge) / SPEND_S);
        if (st >= 1) {
          orb.visible = false;
          orbMaterial.uniforms.uOpacity.value = 0;
        } else {
          orb.visible = true;
          const flare = Math.sin(Math.PI * st);          // 0 → 1 → 0
          orb.scale.setScalar(orbBase * (0.95 * (1 - st) + 0.6 * flare));
          orbMaterial.uniforms.uOpacity.value = SOURCE_SUSTAIN * (1 - st) + 0.7 * flare;
        }
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
      {/* Energy-source orb — a glowing sphere that gathers, ignites, then
          sustains as the rounded source the column erupts from. Seated at the
          node center (originWorld); its rounded form caps the beam foot. */}
      <mesh
        ref={chargeOrbRef}
        position={originWorld}
        geometry={SOURCE_ORB_GEOM}
        material={orbMaterial}
        frustumCulled={false}
        renderOrder={-1}
        visible={false}
      />
    </>
  );
}
