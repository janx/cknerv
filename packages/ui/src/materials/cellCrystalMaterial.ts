// cellCrystalMaterial — the warm faceted CRYSTAL container that replaces the
// cyan truncated-octahedron wireframe cage. One InstancedMesh renders BOTH the
// translucent warm faces AND the bright warm facet EDGES (via barycentric
// coords), so each cell reads as a real vessel (edges + faces) holding its
// warm glow — not an edge-only cage, not a too-transparent membrane.
//
// Per-cell: instance matrix (world position + size), a slow in-shader rotation
// (aRotPhase, gentle — NOT the old mechanical spin), birth/death envelope.
import * as THREE from 'three';
import { BIRTH_DEATH_GLSL } from './cellEnvelope.glsl';

export function makeCellCrystalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uBirthDurS: { value: 0.5 }, uDeathDurS: { value: 0.6 },
      uRotRate: { value: 0.06 },   // gentle organic turn (glints on facets), not mechanical
      uWarmth: { value: 1 },       // 0 cool blue-white → 1 warm gold (default set live to blue-white)
    },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide, toneMapped: false,
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aBornAt; attribute float aDeathAt; attribute float aRotPhase; attribute vec3 aBary;
      uniform float uTime, uBirthDurS, uDeathDurS, uRotRate;
      varying vec3 vN; varying vec3 vView; varying vec3 vColor; varying float vLife; varying vec3 vBary;
      ${BIRTH_DEATH_GLSL}
      void main(){
        float birth = clamp((uTime-aBornAt)/uBirthDurS, 0.0, 1.0);
        float death = clamp((uTime-aDeathAt)/uDeathDurS, 0.0, 1.0);
        float scale = birthEase(birth)*(1.0-deathEase(death));
        vColor = aColor; vLife = scale; vBary = aBary;
        // gentle per-cell Y rotation, then the instance matrix (world pos + size)
        float ang = uTime*uRotRate + aRotPhase; float c = cos(ang), s = sin(ang);
        vec3 p = vec3(c*position.x + s*position.z, position.y, -s*position.x + c*position.z) * scale;
        vec3 nr = vec3(c*normal.x + s*normal.z, normal.y, -s*normal.x + c*normal.z);
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * nr);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN; varying vec3 vView; varying vec3 vColor; varying float vLife; varying vec3 vBary;
      uniform float uWarmth;
      void main(){
        if (vLife <= 0.001) discard;
        vec3 N = normalize(vN); vec3 V = normalize(vView);
        float diff = max(dot(N, normalize(vec3(0.4,0.72,0.55))), 0.0);   // lit facet → dark facet = 立体感
        float fres = pow(1.0 - max(dot(N,V),0.0), 2.4);                  // glassy sheen
        // translucent warm FACE
        // star warmth: blue-white crystal (0) ↔ warm gold (1, = original)
        vec3 face = mix(vec3(0.80, 0.90, 1.05), vColor, uWarmth);
        vec3 col = face*(0.26 + 0.5*diff) + mix(vec3(0.85,0.92,1.0), vec3(1.0,0.9,0.7), uWarmth)*fres*0.4;
        // bright facet EDGE from barycentric distance (the "边")
        float eMin = min(min(vBary.x, vBary.y), vBary.z);
        float edge = 1.0 - smoothstep(0.0, 0.04, eMin);
        col += mix(vec3(0.72,0.85,1.0), vec3(1.0,0.72,0.4), uWarmth) * edge * 0.6;
        float a = (0.22 + fres*0.28 + edge*0.5) * vLife;                 // faces (substance) + defined edges
        gl_FragColor = vec4(col, a);
      }`,
  });
}
