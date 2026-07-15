import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../derives/cellVisual.derive';

const TAU = Math.PI * 2;
const MAX_LENSES = 5;
const MAX_PACKETS = 12;
const PACKET_MATRIX = new THREE.Matrix4();
const PACKET_POSITION = new THREE.Vector3();
const PACKET_TANGENT = new THREE.Vector3();
const PACKET_QUATERNION = new THREE.Quaternion();
const PACKET_SCALE = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

interface LensSpec {
  matrix: THREE.Matrix4;
  phase: number;
}

function makeLineMaterial(width: number, opacity: number): LineMaterial {
  const material = new LineMaterial({
    linewidth: width,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  material.vertexColors = true;
  material.worldUnits = false;
  return material;
}

function makeLensMaterial(seeds: readonly number[]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: new THREE.Vector4(...seeds) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = (instanceMatrix * vec4(p, 1.0)).xyz;
          n = normalize(mat3(instanceMatrix) * n);
        #endif
        vec4 world = modelMatrix * vec4(p, 1.0);
        vLocal = position;
        vNormal = normalize(mat3(modelMatrix) * n);
        vView = normalize(cameraPosition - world.xyz);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec4 uSeed;
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorld;
      void main() {
        float fresnel = pow(
          1.0 - abs(dot(normalize(vNormal), normalize(vView))),
          3.3
        );
        float waveA = 0.5 + 0.5 * sin(
          vLocal.x * (10.0 + uSeed.x * 4.0)
          + vLocal.y * 7.0
          - uTime * 0.62
        );
        float waveB = 0.5 + 0.5 * sin(
          dot(vWorld, vec3(10.0, 7.0, 13.0))
          + uTime * 0.38
          + uSeed.z * 6.2831
        );
        float interference = pow(waveA * waveB, 5.0);
        vec3 violet = vec3(0.23, 0.1, 0.72);
        vec3 cyan = vec3(0.08, 0.75, 1.0);
        vec3 pale = vec3(0.64, 0.94, 1.0);
        vec3 col = mix(violet, cyan, waveB);
        col = mix(col, pale, interference * 0.5);
        float alpha = fresnel * 0.07 + interference * 0.027;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function lensPoint(
  spec: LensSpec,
  angle: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target.set(Math.cos(angle), Math.sin(angle), 0).applyMatrix4(spec.matrix);
}

/** Shared information is the bright interference produced by overlapping fields. */
export default function EventHorizonCore({
  cell,
  reducedMotion,
}: {
  cell: Cell;
  reducedMotion: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const lensesRef = useRef<THREE.InstancedMesh>(null);
  const packetsRef = useRef<THREE.InstancedMesh>(null);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const count = 3 + Math.min(2, Math.round(visual.lockClass / 2));
    const lensGeometry = new THREE.SphereGeometry(1, 30, 16);
    const lensMaterial = makeLensMaterial(visual.seeds);
    const specs: LensSpec[] = [];
    const rimPositions: number[] = [];
    const rimColors: number[] = [];
    const statePositions: number[] = [];
    const stateColors: number[] = [];
    const gold = new THREE.Color(0.86, 0.61, 0.25);
    const paleGold = new THREE.Color(1, 0.84, 0.5);
    const cyan = new THREE.Color(0.1, 0.82, 1);
    const pale = new THREE.Color(0.72, 0.96, 1);
    const violet = new THREE.Color(0.4, 0.2, 1);
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const steps = 144;
    for (let lens = 0; lens < count; lens += 1) {
      const phase = (lens / count) * Math.PI
        + visual.seeds[(lens + 1) % 4] * 0.24;
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        0.16 + Math.sin(phase) * 0.16,
        phase,
        (visual.seeds[(lens + 2) % 4] - 0.5) * 0.22,
      ));
      const scale = new THREE.Vector3(
        0.43 + visual.seeds[lens % 4] * 0.035,
        0.22 + visual.payload * 0.03,
        0.052 + lens * 0.005,
      );
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(),
        quaternion,
        scale,
      );
      const spec = { matrix, phase };
      specs.push(spec);
      for (let segment = 0; segment < steps; segment += 1) {
        const t = segment / steps;
        const next = (segment + 1) / steps;
        if ((Math.floor(segment / 9) + lens) % 7 === 1) continue;
        lensPoint(spec, t * TAU, from);
        lensPoint(spec, next * TAU, to);
        rimPositions.push(...from.toArray(), ...to.toArray());
        const colorA = gold.clone().lerp(cyan, 0.18 + Math.sin(t * Math.PI) * 0.48);
        const colorB = gold.clone().lerp(cyan, 0.18 + Math.sin(next * Math.PI) * 0.48);
        rimColors.push(...colorA.toArray(), ...colorB.toArray());
      }
    }

    const stateCount = 3 + Math.round(visual.payload * 6);
    for (let layer = 0; layer < stateCount; layer += 1) {
      const centred = layer - (stateCount - 1) * 0.5;
      const y = centred * 0.031;
      const width = 0.07 + visual.seeds[layer % 4] * 0.055;
      const gap = (visual.seeds[(layer + 2) % 4] - 0.5) * width * 0.5;
      const a = new THREE.Vector3(-width, y, centred * 0.008);
      const b = new THREE.Vector3(gap - 0.01, y, centred * 0.008);
      const c = new THREE.Vector3(gap + 0.01, y, centred * 0.008);
      const d = new THREE.Vector3(width, y, centred * 0.008);
      const color = violet.clone().lerp(cyan, visual.seeds[layer % 4]).lerp(pale, 0.12);
      statePositions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray());
      stateColors.push(...color.toArray(), ...color.toArray(), ...color.toArray(), ...color.toArray());
      if (layer > 0) {
        const previous = new THREE.Vector3(0, (centred - 1) * 0.031, (centred - 1) * 0.008);
        const current = new THREE.Vector3(0, y, centred * 0.008);
        statePositions.push(...previous.toArray(), ...current.toArray());
        stateColors.push(...paleGold.toArray(), ...pale.toArray());
      }
    }

    const rimGeometry = new LineSegmentsGeometry();
    rimGeometry.setPositions(rimPositions);
    rimGeometry.setColors(rimColors);
    rimGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    const rimGlowMaterial = makeLineMaterial(3.6, 0.055);
    const rimCoreMaterial = makeLineMaterial(0.62, 0.68);
    const rimGlow = new LineSegments2(rimGeometry, rimGlowMaterial);
    const rimCore = new LineSegments2(rimGeometry, rimCoreMaterial);
    rimGlow.frustumCulled = false;
    rimCore.frustumCulled = false;
    const stateGeometry = new LineSegmentsGeometry();
    stateGeometry.setPositions(statePositions);
    stateGeometry.setColors(stateColors);
    stateGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.4);
    const stateGlowMaterial = makeLineMaterial(4.2, 0.12);
    const stateCoreMaterial = makeLineMaterial(0.8, 0.9);
    const stateGlow = new LineSegments2(stateGeometry, stateGlowMaterial);
    const stateCore = new LineSegments2(stateGeometry, stateCoreMaterial);
    stateGlow.frustumCulled = false;
    stateCore.frustumCulled = false;
    const packetGeometry = new THREE.BoxGeometry(0.03, 0.006, 0.012);
    const packetMaterial = new THREE.MeshBasicMaterial({
      color: pale,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return {
      lensGeometry,
      lensMaterial,
      specs,
      rimGeometry,
      rimGlowMaterial,
      rimCoreMaterial,
      rimGlow,
      rimCore,
      stateGeometry,
      stateGlowMaterial,
      stateCoreMaterial,
      stateGlow,
      stateCore,
      packetGeometry,
      packetMaterial,
    };
  }, [visual]);

  const packetCount = visual.payload <= 0
    ? 0
    : Math.min(MAX_PACKETS, Math.max(1, Math.round(visual.payload * MAX_PACKETS)));
  const presence = 1.22 + (visual.mass - 0.84) * 0.34;

  useEffect(() => {
    const mesh = lensesRef.current;
    if (!mesh) return;
    for (let i = 0; i < built.specs.length; i += 1) {
      mesh.setMatrixAt(i, built.specs[i].matrix);
    }
    mesh.count = built.specs.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [built.specs]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    built.lensMaterial.uniforms.uTime.value = time;
    for (const material of [
      built.rimGlowMaterial,
      built.rimCoreMaterial,
      built.stateGlowMaterial,
      built.stateCoreMaterial,
    ]) {
      material.resolution.set(state.size.width, state.size.height);
    }
    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[0] - 0.5) * 0.25
        + Math.sin(time * 0.1) * 0.09;
      rootRef.current.rotation.z = (visual.seeds[3] - 0.5) * 0.14;
    }
    const mesh = packetsRef.current;
    if (!mesh || packetCount === 0 || built.specs.length === 0) return;
    for (let i = 0; i < packetCount; i += 1) {
      const spec = built.specs[i % built.specs.length];
      const angle = (i / packetCount) * TAU + time * 0.075 + spec.phase;
      lensPoint(spec, angle, PACKET_POSITION);
      lensPoint(spec, angle + 0.003, PACKET_TANGENT)
        .sub(PACKET_POSITION)
        .normalize();
      PACKET_QUATERNION.setFromUnitVectors(X_AXIS, PACKET_TANGENT);
      PACKET_SCALE.setScalar((i + Math.floor(time * 2)) % 4 === 0 ? 1.2 : 0.7);
      PACKET_MATRIX.compose(PACKET_POSITION, PACKET_QUATERNION, PACKET_SCALE);
      mesh.setMatrixAt(i, PACKET_MATRIX);
    }
    mesh.count = packetCount;
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.lensGeometry.dispose();
    built.lensMaterial.dispose();
    built.rimGeometry.dispose();
    built.rimGlowMaterial.dispose();
    built.rimCoreMaterial.dispose();
    built.stateGeometry.dispose();
    built.stateGlowMaterial.dispose();
    built.stateCoreMaterial.dispose();
    built.packetGeometry.dispose();
    built.packetMaterial.dispose();
  }, [built]);

  return (
    <group ref={rootRef} scale={presence}>
      <instancedMesh
        ref={lensesRef}
        args={[built.lensGeometry, built.lensMaterial, MAX_LENSES]}
        frustumCulled={false}
      />
      <primitive object={built.rimGlow} />
      <primitive object={built.rimCore} />
      <primitive object={built.stateGlow} />
      <primitive object={built.stateCore} />
      <instancedMesh
        ref={packetsRef}
        args={[built.packetGeometry, built.packetMaterial, MAX_PACKETS]}
        frustumCulled={false}
        renderOrder={5}
      />
    </group>
  );
}
