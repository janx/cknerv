import * as THREE from 'three';

/**
 * Additive round-point material for courier wakes and launch/arrival flashes.
 * One factory, instantiated per use (small base size for the wake, larger for
 * flashes). Per-point alpha comes from the `aAlpha` attribute and a per-point size
 * multiplier from `aSize` (1 = base; the wake tapers it head→tail); the round
 * falloff is computed from `gl_PointCoord` so no sprite texture is needed. Mirrors
 * the house additive-points style (see cellFlareMaterial).
 *
 * `baseSize` is a world-unit basis; on-screen size is attenuated by depth using
 * the viewport height (kept in sync each frame from `state.size.height`).
 */
export function makeCourierWakeMaterial(
  color: THREE.Color,
  baseSize: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uBaseSize: { value: baseSize },
      uViewportHeight: { value: 800 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      uniform float uBaseSize;
      uniform float uViewportHeight;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 viewPos = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPos;
        gl_PointSize = aSize * uBaseSize * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        // Gaussian disc, re-based so it reaches 0 at the mask edge (no hard rim).
        float falloff = exp(-pow(d / 0.32, 2.0));
        falloff = max(0.0, falloff - 0.135) / 0.865;
        float a = vAlpha * falloff;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}
