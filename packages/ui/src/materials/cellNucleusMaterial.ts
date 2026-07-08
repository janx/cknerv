// cellNucleusMaterial — warm additive round-point material for the nucleus, used
// for BOTH the tight bright cores (small feather) and the soft seed-core/inner-glow
// mass (wide feather). World-space sizing (aSize is a world diameter) so points
// stay a fixed fraction of the crystal at any zoom; per-point aAlpha carries the
// LOD fade. Warm; no birth/death (renders only for near, living cells).
import * as THREE from 'three';

/** @param feather Gaussian falloff radius in point-UV space (0.26 = tight core, ~0.46 = soft glow). */
export function makeNucleusPointMaterial(feather: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // uProjY = projectionMatrix[1][1] = 1/tan(fov/2). Including it makes aSize a
    // TRUE world diameter (matching meshes/sprites); without it points render
    // ~1/tan smaller (≈2.6× too small at fov 42) and vanish against the glow.
    uniforms: { uViewportHeight: { value: 800 }, uProjY: { value: 1.0 }, uWarmth: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      attribute float aSize;   // world-space point diameter
      attribute float aAlpha;  // LOD fade × base alpha
      uniform float uViewportHeight;
      uniform float uProjY;
      varying float vAlpha;
      void main(){
        vAlpha = aAlpha;
        vec4 viewPos = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPos;
        gl_PointSize = aSize * uProjY * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying float vAlpha;
      uniform float uWarmth;
      void main(){
        vec2 uv = gl_PointCoord - 0.5; float r = length(uv); if (r > 0.5) discard;
        float g = exp(-pow(r / ${feather.toFixed(3)}, 2.0));
        float a = g * vAlpha;
        vec3 tint = mix(vec3(0.82, 0.90, 1.0), vec3(1.0, 0.9, 0.66), uWarmth); // cool blue-white ↔ warm gold
        gl_FragColor = vec4(tint * a, a);
      }`,
  });
}
