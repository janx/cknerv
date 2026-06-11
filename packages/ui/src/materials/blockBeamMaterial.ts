import * as THREE from 'three';
import { CELLS_Y, CHAIN_Y } from '../layout';
import {
  BEAM_GROW_DUR_S,
  BEAM_HOLD_DUR_S,
  BEAM_STRIKE_DUR_S,
} from '../ui/topologyConstants';

/** Default scrolling-flow speed for the core beam streaks (world units/sec). */
export const BEAM_FLOW_SPEED = 30;

/**
 * Cylinder ShaderMaterial for the new-block energy column. Renders a
 * cool-white core fading to cool-cyan at the silhouette via fresnel
 * (normal vs view dot). A naive object-space radial gradient does not
 * work here — every visible side-wall fragment of a cylinder has the
 * same object-space radial value, so the gradient would collapse to a
 * constant when viewed from the side (the dominant camera angle).
 *
 * The vertex shader remaps `position.y` (default range [-0.5, +0.5])
 * to `[0, uTotalHeight * growT]` so the cylinder grows from its base
 * (at the miner) upward over the grow window. The mesh's
 * `position.y` is set to `CHAIN_Y` and its `scale.y` stays at 1, so
 * all length logic is in this shader — no per-frame `matrixWorld`
 * recompute.
 *
 * `THREE.DoubleSide` + `AdditiveBlending` thicken the visible glow
 * through the tube's interior (the back wall additively contributes
 * to fragments behind the front wall). 24 triangles total; negligible
 * cost from rendering both sides.
 */
export function makeBlockBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      // -1 sentinel = idle (CPU writes a non-negative age when fireRef is set).
      uAge:         { value: -1 },
      uGrowDur:     { value: BEAM_GROW_DUR_S },
      uHoldDur:     { value: BEAM_HOLD_DUR_S },
      uStrikeDur:   { value: BEAM_STRIKE_DUR_S },
      uTotalHeight: { value: CELLS_Y - CHAIN_Y },
      // Speed at which the scrolling-flow brightness pattern travels up
      // the beam (world units per second). 30 wu/s gives one full
      // base→tip traversal in ~0.3 s, so 1–2 streaks visibly cross during
      // the grow window — reads as "energy is flowing through this
      // conduit" rather than "this is a static glowing tube".
      uFlowSpeed:   { value: BEAM_FLOW_SPEED },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uAge;
      uniform float uGrowDur;
      uniform float uHoldDur;
      uniform float uStrikeDur;
      uniform float uTotalHeight;

      varying vec3  vNormalWorld;
      varying vec3  vViewDir;
      varying float vAge;
      varying float vBeamY;
      varying float vH;

      void main() {
        // Burst phase: the tip bursts upward from the anchor to the
        // cell plane over the uGrowDur window (from age 0 — no charge
        // pre-roll) with a sharp ease-out so the launch reads as a
        // sudden release rather than gradual extension.
        float burstT      = clamp(uAge / max(uGrowDur, 0.0001), 0.0, 1.0);
        // Ease-out cubic: 1 - (1 - t)³ — fast initial velocity, decel
        // to a clean landing at the tip.
        float topT        = 1.0 - pow(1.0 - burstT, 3.0);

        // Retract phase: the beam holds at full extension for
        // uHoldDur, then the base retracts upward toward the
        // anchored tip over (uStrikeDur - uHoldDur). Ease-out so the
        // beam initially pulls back quickly and then gently dissolves
        // into the impact rather than ripping away linearly.
        float retractWindow = max(uStrikeDur - uHoldDur, 0.0001);
        float retractT      = clamp((uAge - uGrowDur - uHoldDur) / retractWindow, 0.0, 1.0);
        float bottomT       = 1.0 - pow(1.0 - retractT, 2.0);

        // CylinderGeometry default position.y ∈ [-0.5, +0.5]. Remap to
        // a fraction h ∈ [0, 1] along the beam (0 = base, 1 = tip).
        float h = position.y + 0.5;
        // The visible span of the beam is [bottomT, topT] of the full
        // height. Linearly interpolate within that span by h.
        //   Grow phase:   bottomT=0, topT∈[0,1] → beam extends from base
        //   Linger:       bottomT=0, topT=1     → full beam
        //   Strike phase: bottomT∈[0,1], topT=1 → base retracts toward tip
        float yLocal = mix(bottomT, topT, h);
        float y      = yLocal * uTotalHeight;
        // Shader-side tail taper: only the bottom ~22% of the beam
        // narrows toward the axis (smoothstep curve). Body and head
        // (h ≥ 0.22) keep the full cylinder radius — solid bright
        // column rather than a uniformly tapered cone, so the body
        // doesn't read as thin / washed-out.
        float radiusFactor = smoothstep(0.0, 0.22, h);
        vec3  p = vec3(position.x * radiusFactor, y, position.z * radiusFactor);

        vec4 worldPos = modelMatrix * vec4(p, 1.0);
        vNormalWorld  = normalize(mat3(modelMatrix) * normal);
        vViewDir      = normalize(cameraPosition - worldPos.xyz);
        vAge          = uAge;
        // Height above the miner in world units. The fragment shader
        // uses this as the spatial axis for the scrolling-flow pattern
        // so streaks have a consistent thickness regardless of beam
        // extent or retraction state.
        vBeamY        = y;
        // Local fraction along the beam (0 = tail at miner, 1 = head
        // at impact). Drives the comet-tail alpha falloff in the
        // fragment shader.
        vH            = h;

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uGrowDur;
      uniform float uStrikeDur;
      uniform float uFlowSpeed;

      varying vec3  vNormalWorld;
      varying vec3  vViewDir;
      varying float vAge;
      varying float vBeamY;
      varying float vH;

      void main() {
        if (vAge < 0.0) discard;

        vec3 coreColor = vec3(1.0, 1.0, 1.0);
        vec3 edgeColor = vec3(0.40, 0.78, 1.0);

        // facing = 1 at the visible band centre (normal toward camera),
        //          0 at the silhouette edge (normal perpendicular to view).
        // pow(facing, 1.4) compresses the white core into a narrower
        // central band so the cyan edge tint dominates more of the
        // visible cylinder wall — the beam reads as a cyan plasma
        // column with a hot white filament rather than a uniform
        // white tube.
        float facing = abs(dot(normalize(vNormalWorld), normalize(vViewDir)));
        facing = pow(facing, 1.4);

        vec3  col       = mix(edgeColor, coreColor, facing);
        float bodyAlpha = mix(0.20, 1.0, facing);

        // Scrolling-flow modulation — bright streaks travel up the beam
        // at uFlowSpeed wu/s, suggesting energy actively pouring from
        // miner to impact rather than a static lit tube. Three sines at
        // different frequencies layer a primary undulation, mid streaks,
        // and fine grain — the sum has wavelengths from ~0.7 to ~3 wu so
        // 1–4 bright bands are visible at any given moment.
        float flowPhase = vBeamY - vAge * uFlowSpeed;
        float flow = sin(flowPhase * 2.1) * 0.25
                   + sin(flowPhase * 4.8) * 0.15
                   + sin(flowPhase * 9.3) * 0.07;
        // Apply more flow at the silhouette (outer plasma) and less at
        // the core (stable bright channel) so the core reads steady
        // while the edges shimmer.
        float flowStrength = mix(1.0, 0.55, facing);
        float flowFactor   = 1.0 + flow * flowStrength;
        col *= flowFactor;

        // Tail-only length fade: alpha is 0 at the very tail tip
        // (vH = 0), ramps to full over the bottom ~22% via
        // smoothstep, then stays at 1 for the entire body and head.
        // Combined with the matching geometric taper this gives a
        // solid bright column above a dissolving comet tail rather
        // than a body that gradually thins out from end to end.
        float lengthAlpha = smoothstep(0.0, 0.22, vH);

        // No uniform-fade during strike: the vertex shader retracts
        // the base toward the anchored tip, so the beam visually
        // shrinks into the impact point rather than fading in place.
        float alpha = bodyAlpha * lengthAlpha;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `,
  });
}

/**
 * Outer-glow cylinder material — a wider, semi-transparent cyan halo
 * that wraps around the bright core cylinder produced by
 * `makeBlockBeamMaterial`. The two together read as a volumetric
 * energy column (hot white filament inside a softer cyan plasma
 * sheath) rather than a flat white strip.
 *
 * Same vertex shader as the core (so growth/retraction stay in
 * lockstep). Fragment shader is simpler: no scrolling flow, pure cyan
 * tint, alpha concentrated where the cylinder wall faces the camera
 * (facing²) so the silhouette fades smoothly to nothing instead of
 * cutting at a hard cylinder edge.
 */
export function makeBlockBeamHaloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAge:         { value: -1 },
      uGrowDur:     { value: BEAM_GROW_DUR_S },
      uHoldDur:     { value: BEAM_HOLD_DUR_S },
      uStrikeDur:   { value: BEAM_STRIKE_DUR_S },
      uTotalHeight: { value: CELLS_Y - CHAIN_Y },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uAge;
      uniform float uGrowDur;
      uniform float uHoldDur;
      uniform float uStrikeDur;
      uniform float uTotalHeight;

      varying vec3  vNormalWorld;
      varying vec3  vViewDir;
      varying float vAge;
      varying float vH;

      void main() {
        // Same burst / hold / retract phases as the core material so
        // the halo stays in lockstep through the whole animation.
        float burstT      = clamp(uAge / max(uGrowDur, 0.0001), 0.0, 1.0);
        float topT        = 1.0 - pow(1.0 - burstT, 3.0);

        float retractWindow = max(uStrikeDur - uHoldDur, 0.0001);
        float retractT      = clamp((uAge - uGrowDur - uHoldDur) / retractWindow, 0.0, 1.0);
        float bottomT       = 1.0 - pow(1.0 - retractT, 2.0);

        float h      = position.y + 0.5;
        float yLocal = mix(bottomT, topT, h);
        float y      = yLocal * uTotalHeight;
        // Shader-side tail taper: bottom ~22% narrows toward the axis;
        // body + head keep full radius. Matches the core's radius
        // profile so the layers stay co-axial as the tail dissolves.
        float radiusFactor = smoothstep(0.0, 0.22, h);
        vec3  p = vec3(position.x * radiusFactor, y, position.z * radiusFactor);

        vec4 worldPos = modelMatrix * vec4(p, 1.0);
        vNormalWorld  = normalize(mat3(modelMatrix) * normal);
        vViewDir      = normalize(cameraPosition - worldPos.xyz);
        vAge          = uAge;
        vH            = h;

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3  vNormalWorld;
      varying vec3  vViewDir;
      varying float vAge;
      varying float vH;

      void main() {
        if (vAge < 0.0) discard;

        vec3 haloColor = vec3(0.42, 0.78, 1.0);

        // Alpha peaks where the cylinder wall faces the camera (facing
        // = 1) and falls to zero at the silhouette (facing = 0), so the
        // halo's outer edge fades smoothly into the void rather than
        // cutting at a hard cylinder boundary. Use a gentler power
        // curve (facing^1.4) so the glow extends visibly out from the
        // wall's bright centre rather than collapsing to a thin
        // central band — gives the halo perceptible "thickness" on
        // screen.
        float facing = abs(dot(normalize(vNormalWorld), normalize(vViewDir)));
        float alpha  = pow(facing, 1.4) * 0.55;
        // Tail-only fade — body + head fully opaque.
        alpha *= smoothstep(0.0, 0.22, vH);

        if (alpha < 0.001) discard;
        gl_FragColor = vec4(haloColor * alpha, alpha);
      }
    `,
  });
}

/**
 * Outermost glow cylinder — wider still than the halo, very faint,
 * pure cyan, no fresnel sharpening. Adds the volumetric "atmospheric
 * bleed" that makes the beam feel like it's pushing light into the
 * surrounding space, not just illuminating itself. Same vertex
 * shader phase math as core + halo for lockstep growth / retract.
 */
export function makeBlockBeamOuterGlowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAge:         { value: -1 },
      uGrowDur:     { value: BEAM_GROW_DUR_S },
      uHoldDur:     { value: BEAM_HOLD_DUR_S },
      uStrikeDur:   { value: BEAM_STRIKE_DUR_S },
      uTotalHeight: { value: CELLS_Y - CHAIN_Y },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uAge;
      uniform float uGrowDur;
      uniform float uHoldDur;
      uniform float uStrikeDur;
      uniform float uTotalHeight;

      varying vec3  vNormalWorld;
      varying vec3  vViewDir;
      varying float vAge;
      varying float vH;

      void main() {
        // Identical phase math to core + halo so all three layers
        // grow / hold / retract in lockstep.
        float burstT      = clamp(uAge / max(uGrowDur, 0.0001), 0.0, 1.0);
        float topT        = 1.0 - pow(1.0 - burstT, 3.0);

        float retractWindow = max(uStrikeDur - uHoldDur, 0.0001);
        float retractT      = clamp((uAge - uGrowDur - uHoldDur) / retractWindow, 0.0, 1.0);
        float bottomT       = 1.0 - pow(1.0 - retractT, 2.0);

        float h      = position.y + 0.5;
        float yLocal = mix(bottomT, topT, h);
        float y      = yLocal * uTotalHeight;
        // Shader-side tail taper: bottom ~22% narrows toward the axis;
        // body + head keep full radius. Matches the core's radius
        // profile so the layers stay co-axial as the tail dissolves.
        float radiusFactor = smoothstep(0.0, 0.22, h);
        vec3  p = vec3(position.x * radiusFactor, y, position.z * radiusFactor);

        vec4 worldPos = modelMatrix * vec4(p, 1.0);
        vNormalWorld  = normalize(mat3(modelMatrix) * normal);
        vViewDir      = normalize(cameraPosition - worldPos.xyz);
        vAge          = uAge;
        vH            = h;

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3  vNormalWorld;
      varying vec3  vViewDir;
      varying float vAge;
      varying float vH;

      void main() {
        if (vAge < 0.0) discard;

        // Cooler, more saturated cyan than the inner halo so the
        // beam looks like it's pushing into surrounding atmosphere
        // rather than just being a brighter halo.
        vec3 glowColor = vec3(0.32, 0.62, 1.0);

        // Very soft alpha: linear with facing (no power curve) so the
        // glow has a broad smooth falloff from the visible centre to
        // the silhouette — no peak, just a wide gentle gradient. Low
        // overall peak (0.18) so the layer reads as ambient bleed,
        // not a second halo.
        float facing = abs(dot(normalize(vNormalWorld), normalize(vViewDir)));
        float alpha  = facing * 0.18;
        // Tail-only fade — body + head fully opaque.
        alpha *= smoothstep(0.0, 0.22, vH);

        if (alpha < 0.001) discard;
        gl_FragColor = vec4(glowColor * alpha, alpha);
      }
    `,
  });
}

/**
 * Procedural texture for the strike-splash sprite — a soft radial
 * gradient that bleeds from a white core through cyan to transparent.
 * Drawn once on mount and reused across all per-miner BlockBeams.
 *
 * Returned as a `THREE.CanvasTexture` so it plugs directly into
 * SpriteMaterial.map. The sprite's animated alpha and size are
 * controlled by mutating `material.opacity` and `sprite.scale`
 * per frame — no shader needed for the sprite layer.
 */
export function makeStrikeSplashSpriteTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  // Core: pure white, full alpha.
  grad.addColorStop(0.00, 'rgba(255, 255, 255, 1.00)');
  // Mid-out: cool cyan, half alpha.
  grad.addColorStop(0.35, 'rgba(180, 230, 255, 0.55)');
  // Edge: cool cyan, near transparent.
  grad.addColorStop(0.70, 'rgba(140, 217, 255, 0.10)');
  grad.addColorStop(1.00, 'rgba(140, 217, 255, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Target peak diameter of the strike-splash sprite, in world units.
 *  Roughly 1.2× a tagged-cell halo so the splash reads as a distinct event
 *  on top of the cell field. The BlockBeam component multiplies the
 *  normalized `spriteSize` returned by `computeBeamPhase` by this
 *  value when setting `sprite.scale`. */
export const STRIKE_SPRITE_PEAK_SIZE = 3.5;
