// cellNucleusMaterial — restrained diamond decode marker for the silicon core.
// World-space sizing keeps ports a stable fraction of the Cell at any zoom;
// per-point aAlpha carries the LOD fade. The feather argument is retained for
// API compatibility, but now controls the small photonic bloom around a crisp
// crystal marker instead of drawing either biological blobs or literal UI pads.
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
      attribute float aResolve; // recalled agreement has been verified
      uniform float uViewportHeight; // drawing-buffer height (CSS height × DPR)
      uniform float uProjY;
      varying float vAlpha;
      varying float vResolve;
      void main(){
        vAlpha = aAlpha;
        vResolve = aResolve;
        vec4 viewPos = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPos;
        gl_PointSize = aSize * uProjY * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying float vAlpha;
      varying float vResolve;
      uniform float uWarmth;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float diamond = abs(uv.x) + abs(uv.y);
        if (diamond > 0.5) discard;
        float rim = smoothstep(0.29, 0.38, diamond) * (1.0 - smoothstep(0.44, 0.5, diamond));
        float filament = (1.0 - smoothstep(0.012, 0.038, abs(uv.y)))
          * (1.0 - smoothstep(0.06, 0.31, abs(uv.x)));
        float core = 1.0 - smoothstep(0.025, 0.085, diamond);
        float bloom = exp(-pow(length(uv) / ${feather.toFixed(3)}, 2.0)) * 0.055;
        float signal = max(max(rim, filament * 0.48), core * 0.7);
        float a = (signal * 0.72 + bloom) * vAlpha;
        vec3 silicon = vec3(0.28, 0.82, 1.0);
        vec3 violet = vec3(0.68, 0.56, 1.0);
        vec3 tint = mix(silicon, violet, clamp(uWarmth, 0.0, 1.0) * 0.22);
        vec3 resolvedGold = vec3(1.0, 0.78, 0.34);
        tint = mix(tint, resolvedGold, clamp(vResolve, 0.0, 1.0) * 0.86);
        vec3 col = tint * (signal * 0.9 + bloom) + vec3(0.72, 0.95, 1.0) * core * 0.28;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}
