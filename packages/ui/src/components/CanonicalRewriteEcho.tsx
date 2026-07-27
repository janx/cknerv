import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { INSTANCE_CAPACITY } from '../geometry/cellPositions';
import {
  CANONICAL_REWRITE_ECHO_DURATION_S,
  canonicalRewriteEchoSeed,
} from '../derives/canonicalRewrite.derive';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';

const VERTEX_SHADER = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uStartedAt;
uniform float uDuration;
uniform float uPixelRatio;
varying float vLife;
varying float vSeed;

void main() {
  float life = clamp((uTime - uStartedAt) / max(0.001, uDuration), 0.0, 1.0);
  float fracture = smoothstep(0.04, 0.82, life);
  vec3 p = position;

  float turn = (aSeed - 0.5) * 2.8 * fracture;
  float cs = cos(turn);
  float sn = sin(turn);
  p.xz = mat2(cs, -sn, sn, cs) * p.xz;
  p.xz *= mix(1.0, 0.58, fracture);

  vec2 radial = normalize(position.xz + vec2(0.001));
  float shard = sin(aSeed * 47.3 + 1.7);
  p.xz += radial * shard * 2.4 * sin(life * 3.14159265);
  p.y += (0.7 + aSeed * 2.0) * life * life;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float perspective = 52.0 / max(8.0, -mv.z);
  gl_PointSize = mix(22.0, 5.0, life) * uPixelRatio * perspective;
  gl_Position = projectionMatrix * mv;
  vLife = life;
  vSeed = aSeed;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
varying float vLife;
varying float vSeed;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  vec2 diamond = vec2(p.x + p.y, p.y - p.x);
  float d = max(abs(diamond.x), abs(diamond.y));
  float rim = smoothstep(0.47, 0.39, d) - smoothstep(0.34, 0.27, d);
  float inner = smoothstep(0.28, 0.06, d) * 0.18;

  float faultA = smoothstep(0.035, 0.0, abs(p.y - p.x * (0.25 + vSeed)));
  float faultB = smoothstep(0.028, 0.0, abs(p.x + p.y * (0.45 - vSeed)));
  float segment = floor((atan(p.y, p.x) + 3.14159265) * 3.1);
  float missing = step(
    0.72,
    fract(sin((segment + vSeed * 11.0) * 12.9898) * 43758.5453)
  );
  float structure = max(rim * (1.0 - missing * 0.72), inner);
  structure += max(faultA, faultB) * smoothstep(0.39, 0.08, d) * 0.55;

  float vanish = 1.0 - smoothstep(0.58, 1.0, vLife);
  float ignition = smoothstep(0.0, 0.08, vLife);
  vec3 hot = vec3(1.0, 0.25, 0.07);
  vec3 cold = vec3(0.38, 0.12, 0.78);
  vec3 color = mix(hot, cold, smoothstep(0.18, 0.9, vLife));
  float alpha = structure * vanish * ignition;
  if (alpha < 0.012) discard;
  gl_FragColor = vec4(color * (1.15 + structure), alpha);
}
`;

export function makeCanonicalRewriteEchoMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStartedAt: { value: -1e9 },
      uDuration: { value: CANONICAL_REWRITE_ECHO_DURATION_S },
      uPixelRatio: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/** One bounded GPU draw call for records invalidated by a canonical rewrite. */
export default function CanonicalRewriteEcho() {
  const cellsCache = useCellGalaxy();
  const simClock = useSimClock();
  const pointsRef = useRef<THREE.Points>(null);
  const handledRef = useRef(cellsCache.linkPrune);
  const marker = cellsCache.linkPrune;

  const material = useMemo(() => makeCanonicalRewriteEchoMaterial(), []);
  const geometry = useMemo(() => {
    const echoes = marker?.invalidatedCells.slice(0, INSTANCE_CAPACITY) ?? [];
    const positions = new Float32Array(echoes.length * 3);
    const seeds = new Float32Array(echoes.length);
    for (let i = 0; i < echoes.length; i += 1) {
      positions.set(echoes[i].posSeed, i * 3);
      seeds[i] = canonicalRewriteEchoSeed(echoes[i].contentHash);
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    next.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    next.setDrawRange(0, echoes.length);
    next.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return next;
  }, [marker]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useSimFrame((state) => {
    const points = pointsRef.current;
    if (!points) return;
    const now = simClock.elapsedSec;
    material.uniforms.uTime.value = now;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();

    if (marker !== handledRef.current) {
      handledRef.current = marker;
      material.uniforms.uStartedAt.value = now;
      points.visible = (marker?.invalidatedCells.length ?? 0) > 0;
    }

    if (
      points.visible
      && now - Number(material.uniforms.uStartedAt.value)
        >= CANONICAL_REWRITE_ECHO_DURATION_S
    ) {
      points.visible = false;
    }
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={3}
      visible={false}
    />
  );
}
