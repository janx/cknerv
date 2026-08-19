import * as THREE from 'three';

import { HYBRID_BASE_PX_PER_WU } from './cellHybridMaterial';
import { CELL_GALAXY_PALETTE } from '../visualPalette';

/**
 * The unresolved population, drawn as points in the Cells' own world.
 *
 * This is deliberately the SAME material family as `cellHybridMaterial`, down
 * to the blend factors and the point-size law: a Gaussian sprite, bounded
 * screen accumulation, body hue, no tone mapping. There is no seam to blend
 * because there is no change of material, and that is the entire point of the
 * design — the previous construction was a procedural screen-space texture,
 * and however closely its value, grain and hue were matched, a hash-cell field
 * and a cloud of point sprites stay two materials with a visible boundary.
 *
 * The halo is separated from an addressable Cell by SIZE and BRIGHTNESS alone:
 *
 *   - clearly smaller — {@link POPULATION_FIELD_POINT_SIZE} sits below the
 *     smallest Cell sprite in the stage and at about a third of the mean;
 *   - no white-hot core — a Cell mixes toward `warmWhite` at its peak, and
 *     this does not, so the two never converge in hue at their centres;
 *   - no outer halo wash and no interaction ring;
 *   - a saturated patch of it can never reach a Cell core's brightness, and
 *     that ceiling is structural rather than tuned (see
 *     {@link POPULATION_FIELD_EMISSION}).
 *
 * And by nothing else. In particular it now RESOLVES on a fly-in, which is
 * what "unresolved" honestly means — more aperture resolves more. The whole
 * not-addressable burden therefore rests on affordance: no hover response, no
 * cursor change, no raycast, and the HUD legend.
 */

/**
 * Sprite size in world units, in the Cells' own scale.
 *
 * Cell sprites run 0.783 (a plain Cell at minimum morphology) to 3.58, with a
 * stage mean near 1.93. This sits below the whole range: no halo point is ever
 * as large as the smallest addressable Cell, and it is 0.37x the typical one.
 * Uniform, with no per-point jitter — the density law and the Gaussian overlap
 * already give the field its texture, and a jitter wide enough to see would
 * put the largest halo points back inside the Cell range.
 */
export const POPULATION_FIELD_POINT_SIZE = 0.72;

/**
 * Gaussian width as a fraction of the sprite, against a Cell's 0.10.
 *
 * WIDER relative to its own sprite, which is what removes the hard bright
 * centre: a Cell concentrates its light into a peak that reads as a core, and
 * this spends the same light over most of the footprint so it reads as a
 * speck. It also keeps the sprite from collapsing to a single lit fragment
 * when the camera pulls back.
 */
export const POPULATION_FIELD_SIGMA = 0.16;

/**
 * The layer's brightness ceiling, reached only at an amount curve of 1.
 *
 * The blend below is a bounded accumulation whose fixed point is the emitted
 * alpha itself, so this number IS the brightness a fully saturated patch of
 * halo converges to — a hard ceiling that no amount of overlap can pass.
 * Cell bodies emit up to ~1.18 and converge to white; the halo cannot, at any
 * density, on any profile. "Peak under a Cell core" is therefore a property of
 * the blend rather than a value someone dialled in.
 *
 * See {@link populationEmissionForGain} for what the measured profiles reach:
 * 0.39 at retained scope, 0.72 at mainnet chain scope, 0.90 at testnet. The
 * ceiling itself needs a ratio past 4,000 unresolved per resolved Cell, which
 * no profile we run comes near.
 *
 * This is the one level knob. If the layer needs to be brighter or dimmer
 * after a live look, it is the number to move.
 */
export const POPULATION_FIELD_EMISSION = 0.95;

/**
 * Smallest sprite the layer will draw, in CSS pixels before DPR.
 *
 * A point cannot render smaller than a fragment, so below this the footprint
 * is clamped and the light the clamp added is given back — energy conserved,
 * with the field dimming as it should instead of flickering as the sprite
 * crosses the pixel grid. Binds only when the camera pulls far back; at the
 * production camera the sprite is roughly four device pixels.
 */
export const POPULATION_FIELD_MIN_POINT_PX = 1.4;

/** Body hue, at full saturation, from the Cells' own palette. Identity hue —
 *  asset, lock, tag — is forbidden here: we know nothing about these Cells
 *  individually. Desaturating toward grey is what makes a layer read as fog
 *  and is equally forbidden. */
export const POPULATION_FIELD_COLOR = CELL_GALAXY_PALETTE.tissueRose;

/**
 * The emitted alpha for one amount-curve `gain`.
 *
 * The amount curve says `gain` scales how much of the swarm is LIT, and the
 * blend below squares the emitted alpha for an isolated point — a point
 * contributes `colour * a * a` and only a saturated patch converges to `a`
 * itself. Feeding `gain` straight into `a` therefore made rendered light go as
 * roughly the SQUARE of the amount, which collapses the low end: measured at
 * the production camera, retained scope (gain 0.17) lit 485 of the field's
 * 7,900 cells and landed at a mean luminance of 0.006 — indistinguishable
 * from absence, which the design names as its default failure.
 *
 * The square root undoes the blend's square, so light tracks the amount curve
 * instead of its square. The same measurement then gives 5,343 cells and
 * 0.017 for retained, 0.046 for mainnet chain scope, and 0.065 for testnet —
 * a visible field at every provable scope, with the profile difference the
 * curve exists to carry still intact.
 *
 * The ceiling is unmoved: `gain` is bounded by 1, so this is bounded by
 * {@link POPULATION_FIELD_EMISSION}.
 */
export function populationEmissionForGain(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  return Math.sqrt(Math.min(1, gain)) * POPULATION_FIELD_EMISSION;
}

/** Sprite footprint in drawing-buffer pixels, before the minimum is applied.
 *  The Cells' own law, on the Cells' own constant, so the halo and the bodies
 *  shrink with distance at exactly the same rate. */
export function populationPointFootprint(
  size: number,
  deviceViewportHeight: number,
  viewDistance: number,
): number {
  return size
    * HYBRID_BASE_PX_PER_WU
    * (deviceViewportHeight * 0.5 / Math.max(viewDistance, 0.001));
}

/** Energy correction for a sprite the minimum footprint had to widen.
 *  Area scales as the square, so the light does too. */
export function populationPointEnergy(
  wantedPx: number,
  drawnPx: number,
): number {
  const shrink = wantedPx / Math.max(drawnPx, 1e-6);
  return Math.min(1, shrink * shrink);
}

/**
 * The halo fibre's alpha, as a share of the point emission.
 *
 * The fibres are not extra light so much as REDISTRIBUTED light, and the
 * measurement that set this is the only one that matters: at the production
 * camera, adding them raises the halo's orientation coherence — the
 * structure-tensor measure that separates a drawn thread from isotropic noise
 * — from 0.183 to 0.333, against a Poisson floor of 0.184. The shipped
 * independent-point build sat AT that floor: its points, however carefully
 * weighted onto the fibre corridors, carried no more orientation than a random
 * spray, which is exactly the "reads as spray, not tissue" the layer failed on.
 * Placing the points on filaments and NOT drawing the fibres measures 0.196 —
 * still the floor. The strokes are the whole of the effect.
 *
 * The cost is +6.7% total light and no change in covered area (27.4% of the
 * frame against the previous build's 27.3%), because the point count came down
 * from 260,000 to 105,000 to pay for it.
 *
 * Under a Cell's core by construction, since it is a fraction of a point
 * emission that is itself bounded by {@link POPULATION_FIELD_EMISSION}. If the
 * live look wants more or less thread this is the knob: 0.60 gives coherence
 * 0.292 at −7% light, 0.80 gives 0.369 at +21%.
 *
 * It is deliberately NOT small relative to a point. "No endpoint emphasis of
 * any kind" is a requirement, and a faint connector between bright beads is
 * precisely a node with edges radiating from it. At this ratio the stroke is
 * the figure and the points are grain along it.
 */
export const POPULATION_FIBRE_ALPHA = 0.7;

/** The fibre's emitted alpha for one amount-curve `gain`. The same curve the
 *  points ride, so the two never drift apart as scope changes. */
export function populationFibreEmissionForGain(gain: number): number {
  return populationEmissionForGain(gain) * POPULATION_FIBRE_ALPHA;
}

export interface PopulationPointUniforms {
  /** Drawing-buffer height, not CSS height — WebGL point size is measured in
   *  drawing-buffer pixels. */
  uViewportHeight: { value: number };
  uPixelRatio: { value: number };
  uSize: { value: number };
  uMinPointPx: { value: number };
  /** {@link populationEmissionForGain} of the amount curve. Zero means the
   *  stage covers its scope and there is nothing unresolved to state. */
  uEmission: { value: number };
  uColor: { value: THREE.Color };
}

export function makePopulationPointMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uViewportHeight: { value: 800 },
      uPixelRatio: { value: 1 },
      uSize: { value: POPULATION_FIELD_POINT_SIZE },
      uMinPointPx: { value: POPULATION_FIELD_MIN_POINT_PX },
      uEmission: { value: 0 },
      uColor: { value: new THREE.Color(...POPULATION_FIELD_COLOR) },
    },
    transparent: true,
    depthWrite: false,
    // Byte-for-byte the Cell bodies' blend. Bounded screen accumulation: the
    // layer EMITS and never covers, so a pixel with no unresolved population
    // receives exactly zero and empty space stays true black. Alpha-over at
    // any tint or opacity lifts the black across the envelope, which is the
    // optical signature of atmosphere between the viewer and the subject —
    // that single choice is enough to destroy the scene, and it has been made
    // once already.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uViewportHeight;
      uniform float uPixelRatio;
      uniform float uSize;
      uniform float uMinPointPx;

      varying float vEnergy;

      void main() {
        vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPos;

        float wanted = uSize
          * ${HYBRID_BASE_PX_PER_WU.toFixed(1)}
          * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
        float minimum = uMinPointPx * max(uPixelRatio, 0.001);
        float drawn = max(wanted, minimum);
        // Conserve the light the clamp added, so pulling the camera back
        // dims the field instead of making it twinkle across the pixel grid.
        float shrink = wanted / drawn;
        vEnergy = min(1.0, shrink * shrink);
        gl_PointSize = drawn;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uEmission;

      varying float vEnergy;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float radiusSquared = dot(uv, uv);
        if (radiusSquared > 0.25) discard;

        // One Gaussian. No hot-white centre, no outer wash, no ring — the
        // three things that would make this read as a small Cell instead of
        // as one member of a population.
        float peak = exp(
          -radiusSquared
          / ${(POPULATION_FIELD_SIGMA * POPULATION_FIELD_SIGMA).toFixed(6)}
        );
        float a = peak * uEmission * vEnergy;
        // Premultiplied, matching the Cell bodies: the blend multiplies rgb
        // by src alpha again, which is what bounds the accumulation.
        // No colorspace conversion here for the same reason — the Cells write
        // raw and a converted twin would be a second material.
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  return material;
}

/**
 * The halo's fibres — the segments the placement walk emits between
 * consecutive points on one filament.
 *
 * Drawn in the Cells' fabric's language, one sample lower: the same bounded
 * screen accumulation, the same body hue, no tone mapping — but a plain
 * one-pixel GL line where the fabric draws a 2.5-pixel screen-space capsule,
 * and no endpoint treatment of any kind. The filament is the figure; its
 * vertices are not.
 *
 * Plain {@link THREE.LineSegments} rather than the fabric's `LineSegments2`,
 * and the reason is budget, not taste. A fat line is an instanced quad plus a
 * capsule SDF in the fragment shader — twelve triangles and a full shader per
 * segment — which at this layer's 124,000 segments would be 1.5M triangles a
 * frame against the fabric's 32,000 instances. A GL line is two vertices and a
 * one-pixel span: 0.51 of a 1080p screen in fill for the whole layer.
 *
 * ## What these are allowed to claim
 *
 * The Cells' own fabric is a k-NN proximity mesh over positions — a geometric
 * property of the embedding, not a claim that two Cells transacted — so edges
 * among placed halo points carry exactly the truth status the core's edges do.
 * What stays forbidden is an edge with ONE END on an addressable Cell, which
 * would assert a relationship between a named Cell and an anonymous one. Every
 * index in this geometry addresses a point the same pass placed, and no
 * segment bridges a point the complement rejected.
 */
export function makePopulationFibreMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uEmission: { value: 0 },
      uColor: { value: new THREE.Color(...POPULATION_FIELD_COLOR) },
    },
    transparent: true,
    depthWrite: false,
    // Byte-for-byte the Cell bodies' and the fabric's blend. The layer EMITS
    // and never covers, so a pixel with no unresolved population receives
    // exactly zero and empty space stays true black.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uEmission;

      void main() {
        // Flat along the whole segment: no taper, no endpoint falloff, no
        // brightening at a vertex. A halo point must never look like a node
        // with edges radiating from it.
        // Premultiplied, matching the Cell bodies, and written raw for the
        // same reason — a colorspace-converted twin would be a second
        // material, which is the seam this design exists to remove.
        gl_FragColor = vec4(uColor * uEmission, uEmission);
      }
    `,
  });
}
