import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../derives/cellVisual.derive';

const TAU = Math.PI * 2;
const MAX_PACKETS = 16;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const PACKET_POSITION = new THREE.Vector3();
const PACKET_NEXT = new THREE.Vector3();
const PACKET_TANGENT = new THREE.Vector3();
const PACKET_QUATERNION = new THREE.Quaternion();
const PACKET_SCALE = new THREE.Vector3();
const PACKET_MATRIX = new THREE.Matrix4();

interface MembraneSpec {
  width: number;
  height: number;
  phase: number;
  warp: number;
  offset: THREE.Vector3;
  rotation: THREE.Quaternion;
}

function membranePoint(
  membrane: MembraneSpec,
  u: number,
  v: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const taper = 0.78 + Math.sin(Math.PI * v) * 0.22;
  const x = (u - 0.5) * membrane.width * taper;
  const y = (v - 0.5) * membrane.height
    + Math.sin((u - 0.5) * Math.PI) * membrane.warp * 0.18;
  const envelope = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const z = envelope * membrane.warp
    * (Math.sin(u * Math.PI + membrane.phase)
      + Math.sin((u - v) * TAU - membrane.phase) * 0.24);
  target.set(x, y, z).applyQuaternion(membrane.rotation).add(membrane.offset);
  return target;
}

function membraneProfile(assetClass: number): readonly [number, number] {
  const asset = Math.round(assetClass);
  if (asset === 1) return [1.15, 0.72];
  if (asset === 2) return [1.08, 0.86];
  if (asset === 3) return [0.86, 1.08];
  if (asset === 4) return [1.18, 0.62];
  if (asset === 5) return [0.92, 0.94];
  return [1, 0.82];
}

function makeLineMaterial(linewidth: number, opacity: number): LineMaterial {
  const material = new LineMaterial({
    linewidth,
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

function makeLinePair(
  geometry: LineSegmentsGeometry,
  glowMaterial: LineMaterial,
  coreMaterial: LineMaterial,
  renderOrder: number,
): readonly [LineSegments2, LineSegments2] {
  const glow = new LineSegments2(geometry, glowMaterial);
  const core = new LineSegments2(geometry, coreMaterial);
  glow.frustumCulled = false;
  core.frustumCulled = false;
  glow.renderOrder = renderOrder;
  core.renderOrder = renderOrder + 1;
  return [glow, core];
}

function makeMembraneMaterial(
  accent: readonly [number, number, number],
  phase: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: phase },
      uAccent: { value: new THREE.Color(...accent) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aLayer;
      attribute float aPhase;
      varying vec2 vUv;
      varying float vLayer;
      varying float vPhase;
      void main() {
        vUv = uv;
        vLayer = aLayer;
        vPhase = aPhase;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uPhase;
      uniform vec3 uAccent;
      varying vec2 vUv;
      varying float vLayer;
      varying float vPhase;

      float lineMask(float value, float width) {
        return 1.0 - smoothstep(width, width * 2.4, abs(fract(value) - 0.5));
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float edgeDistance = min(1.0 - abs(p.x), 1.0 - abs(p.y));
        float border = 1.0 - smoothstep(0.0, 0.055, edgeDistance);
        float row = lineMask(vUv.y * (7.0 + mod(vLayer, 3.0)) + vPhase, 0.018);
        float column = lineMask(vUv.x * (4.0 + mod(vLayer, 2.0)) - vPhase, 0.012);
        float wave = sin(p.x * (3.4 + mod(vLayer, 2.0)) + vPhase * 6.28318) * 0.14;
        float revision = 1.0 - smoothstep(0.015, 0.05, abs(p.y - wave));
        float scanY = fract(vUv.y + uTime * 0.022 + vPhase + uPhase);
        float scan = 1.0 - smoothstep(0.0, 0.045, abs(scanY - 0.5));
        float centre = 1.0 - smoothstep(0.0, 1.25, length(p));
        float grain = 0.5 + 0.5 * sin((p.x - p.y) * 22.0 + vPhase * 19.0);

        vec3 cyan = vec3(0.12, 0.78, 1.0);
        vec3 violet = vec3(0.52, 0.25, 1.0);
        vec3 gold = vec3(1.0, 0.62, 0.2);
        vec3 energy = mix(violet, cyan, fract(vLayer * 0.29 + vUv.x * 0.38));
        energy = mix(energy, uAccent, 0.035);
        float goldWeight = revision * (0.48 + grain * 0.32);
        vec3 color = mix(energy, gold, goldWeight);
        color += vec3(0.72, 0.92, 1.0) * scan * centre * 0.28;

        float alpha = 0.014
          + border * 0.09
          + row * 0.025
          + column * row * 0.035
          + revision * 0.075
          + scan * centre * 0.052;
        alpha *= 0.78 + centre * 0.38;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

/**
 * Direction D — a Cell as a palimpsest of concurrently maintained versions.
 * The membranes remain individually legible, but only their overlap becomes
 * bright enough to read as the canonical shared record.
 */
export default function EclipseRelicCore({
  cell,
  reducedMotion,
}: {
  cell: Cell;
  reducedMotion: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const packetsRef = useRef<THREE.InstancedMesh>(null);
  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const built = useMemo(() => {
    const [profileWidth, profileHeight] = membraneProfile(visual.assetClass);
    const layerCount = 3 + (Math.round(visual.lockClass) % 4);
    const membranes: MembraneSpec[] = [];
    const positions: number[] = [];
    const uvs: number[] = [];
    const layers: number[] = [];
    const phases: number[] = [];
    const indices: number[] = [];
    const outlinePositions: number[] = [];
    const outlineColors: number[] = [];
    const scriptPositions: number[] = [];
    const scriptColors: number[] = [];
    const consensusPositions: number[] = [];
    const consensusColors: number[] = [];
    const cyan = new THREE.Color(0.12, 0.8, 1);
    const violet = new THREE.Color(0.58, 0.28, 1);
    const gold = new THREE.Color(1, 0.65, 0.22);
    const pale = new THREE.Color(0.82, 0.96, 1);
    const accent = new THREE.Color(...visual.accent);
    const color = new THREE.Color();
    const point = new THREE.Vector3();
    const next = new THREE.Vector3();
    const columns = 22;
    const rows = 12;

    for (let layer = 0; layer < layerCount; layer += 1) {
      const normalized = layerCount <= 1 ? 0.5 : layer / (layerCount - 1);
      const seed = visual.seeds[layer % 4];
      const membrane: MembraneSpec = {
        width: (0.94 + normalized * 0.08) * profileWidth,
        height: (0.72 + (1 - normalized) * 0.08) * profileHeight,
        phase: seed * TAU + layer * 0.53,
        warp: 0.04 + visual.seeds[(layer + 2) % 4] * 0.045,
        offset: new THREE.Vector3(
          (visual.seeds[(layer + 1) % 4] - 0.5) * 0.035,
          (seed - 0.5) * 0.055,
          (normalized - 0.5) * 0.045,
        ),
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (normalized - 0.5) * 0.62 + (seed - 0.5) * 0.18,
          (normalized - 0.5) * 1.06 + (visual.seeds[(layer + 3) % 4] - 0.5) * 0.16,
          (layer % 2 === 0 ? -1 : 1) * (0.09 + seed * 0.08),
        )),
      };
      membranes.push(membrane);

      const vertexStart = positions.length / 3;
      for (let row = 0; row <= rows; row += 1) {
        for (let column = 0; column <= columns; column += 1) {
          const u = column / columns;
          const v = row / rows;
          membranePoint(membrane, u, v, point);
          positions.push(point.x, point.y, point.z);
          uvs.push(u, v);
          layers.push(layer);
          phases.push(membrane.phase / TAU);
        }
      }
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const a = vertexStart + row * (columns + 1) + column;
          const b = a + 1;
          const c = a + columns + 1;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }

      const edgeSamples = 28;
      const edgePaths: ReadonlyArray<
        readonly [(t: number) => readonly [number, number], (t: number) => readonly [number, number]]
      > = [
        [(t) => [t, 0], (t) => [t + 1 / edgeSamples, 0]],
        [(t) => [t, 1], (t) => [t + 1 / edgeSamples, 1]],
        [(t) => [0, t], (t) => [0, t + 1 / edgeSamples]],
        [(t) => [1, t], (t) => [1, t + 1 / edgeSamples]],
      ];
      for (const [fromPoint, toPoint] of edgePaths) {
        for (let edge = 0; edge < edgeSamples; edge += 1) {
          if ((edge + layer * 3) % 11 < 2) continue;
          const t = edge / edgeSamples;
          const [u0, v0] = fromPoint(t);
          const [u1, v1] = toPoint(t);
          membranePoint(membrane, u0, v0, point);
          membranePoint(membrane, u1, v1, next);
          outlinePositions.push(point.x, point.y, point.z, next.x, next.y, next.z);
          color.copy(violet).lerp(cyan, normalized).lerp(accent, 0.035);
          outlineColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }

      const scriptRows = 4 + Math.round(visual.payload * 8);
      for (let row = 0; row < scriptRows; row += 1) {
        const v = 0.18 + ((row + 0.5) / scriptRows) * 0.64;
        const segmentCount = 3 + ((row + layer) % 4);
        for (let segment = 0; segment < segmentCount; segment += 1) {
          const hash = visual.seeds[(row + segment + layer) % 4];
          const slot = 0.72 / segmentCount;
          const u0 = 0.14 + segment * slot + hash * slot * 0.12;
          const u1 = Math.min(0.86, u0 + slot * (0.28 + hash * 0.38));
          membranePoint(membrane, u0, v, point);
          membranePoint(membrane, u1, v, next);
          scriptPositions.push(point.x, point.y, point.z, next.x, next.y, next.z);
          color.copy(gold).lerp(cyan, (row + layer) % 3 === 0 ? 0.4 : 0.12);
          if ((row + segment) % 7 === 0) color.lerp(pale, 0.38);
          scriptColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }

      const seamV = 0.5 + Math.sin(membrane.phase) * 0.025;
      for (let seam = 0; seam < 8; seam += 1) {
        const u0 = 0.34 + seam * 0.04;
        const u1 = u0 + 0.027;
        membranePoint(membrane, u0, seamV + Math.sin(u0 * TAU + membrane.phase) * 0.02, point);
        membranePoint(membrane, u1, seamV + Math.sin(u1 * TAU + membrane.phase) * 0.02, next);
        consensusPositions.push(point.x, point.y, point.z, next.x, next.y, next.z);
        color.copy(pale).lerp(gold, layer % 2 === 0 ? 0.32 : 0.12);
        consensusColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
    }

    const membraneGeometry = new THREE.BufferGeometry();
    membraneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    membraneGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    membraneGeometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
    membraneGeometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    membraneGeometry.setIndex(indices);
    membraneGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const membraneMaterial = makeMembraneMaterial(visual.accent, visual.seeds[3]);

    const outlineGeometry = new LineSegmentsGeometry();
    outlineGeometry.setPositions(outlinePositions);
    outlineGeometry.setColors(outlineColors);
    outlineGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const outlineGlowMaterial = makeLineMaterial(4.6, 0.06);
    const outlineCoreMaterial = makeLineMaterial(0.58, 0.5);
    const [outlineGlow, outlineCore] = makeLinePair(
      outlineGeometry,
      outlineGlowMaterial,
      outlineCoreMaterial,
      1,
    );

    const scriptGeometry = new LineSegmentsGeometry();
    scriptGeometry.setPositions(scriptPositions);
    scriptGeometry.setColors(scriptColors);
    scriptGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const scriptGlowMaterial = makeLineMaterial(4.2, 0.09);
    const scriptCoreMaterial = makeLineMaterial(0.82, 0.75);
    const [scriptGlow, scriptCore] = makeLinePair(
      scriptGeometry,
      scriptGlowMaterial,
      scriptCoreMaterial,
      3,
    );

    const consensusGeometry = new LineSegmentsGeometry();
    consensusGeometry.setPositions(consensusPositions);
    consensusGeometry.setColors(consensusColors);
    consensusGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const consensusGlowMaterial = makeLineMaterial(8.2, 0.14);
    const consensusCoreMaterial = makeLineMaterial(1.4, 0.96);
    const [consensusGlow, consensusCore] = makeLinePair(
      consensusGeometry,
      consensusGlowMaterial,
      consensusCoreMaterial,
      5,
    );

    const packetGeometry = new THREE.BoxGeometry(0.052, 0.012, 0.009);
    const packetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      membranes,
      membraneGeometry,
      membraneMaterial,
      outlineGeometry,
      outlineGlowMaterial,
      outlineCoreMaterial,
      outlineGlow,
      outlineCore,
      scriptGeometry,
      scriptGlowMaterial,
      scriptCoreMaterial,
      scriptGlow,
      scriptCore,
      consensusGeometry,
      consensusGlowMaterial,
      consensusCoreMaterial,
      consensusGlow,
      consensusCore,
      packetGeometry,
      packetMaterial,
    };
  }, [visual]);

  const packetCount = visual.payload <= 0
    ? 0
    : Math.min(MAX_PACKETS, Math.max(1, Math.round(visual.payload * MAX_PACKETS)));
  const presence = 1.12 + (visual.mass - 0.84) * 0.3;

  useEffect(() => {
    const mesh = packetsRef.current;
    if (!mesh) return;
    const gold = new THREE.Color(1, 0.7, 0.28);
    const cyan = new THREE.Color(0.34, 0.92, 1);
    for (let index = 0; index < packetCount; index += 1) {
      mesh.setColorAt(index, index % 4 === 0 ? gold : cyan);
    }
    mesh.count = packetCount;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packetCount]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    built.membraneMaterial.uniforms.uTime.value = time;
    for (const material of [
      built.outlineGlowMaterial,
      built.outlineCoreMaterial,
      built.scriptGlowMaterial,
      built.scriptCoreMaterial,
      built.consensusGlowMaterial,
      built.consensusCoreMaterial,
    ]) {
      material.resolution.set(state.size.width, state.size.height);
    }
    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[2] - 0.5) * 0.28 + time * 0.026;
      rootRef.current.rotation.x = (visual.seeds[0] - 0.5) * 0.16;
      rootRef.current.rotation.z = Math.sin(time * 0.09 + visual.seeds[1] * TAU) * 0.018;
    }
    const mesh = packetsRef.current;
    if (!mesh || packetCount === 0) return;
    for (let index = 0; index < packetCount; index += 1) {
      const membrane = built.membranes[index % built.membranes.length];
      const u = (visual.seeds[index % 4] + index / packetCount
        + time * (0.028 + visual.seeds[(index + 2) % 4] * 0.02)) % 1;
      const lane = 0.22 + ((index * 3 + Math.round(visual.lockClass)) % 7) / 10;
      membranePoint(membrane, u, lane, PACKET_POSITION);
      membranePoint(membrane, Math.min(1, u + 0.008), lane, PACKET_NEXT);
      PACKET_TANGENT.subVectors(PACKET_NEXT, PACKET_POSITION).normalize();
      PACKET_QUATERNION.setFromUnitVectors(X_AXIS, PACKET_TANGENT);
      PACKET_SCALE.setScalar((index + Math.floor(time * 2)) % 6 === 0 ? 1.3 : 0.74);
      PACKET_MATRIX.compose(PACKET_POSITION, PACKET_QUATERNION, PACKET_SCALE);
      mesh.setMatrixAt(index, PACKET_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.membraneGeometry.dispose();
    built.membraneMaterial.dispose();
    built.outlineGeometry.dispose();
    built.outlineGlowMaterial.dispose();
    built.outlineCoreMaterial.dispose();
    built.scriptGeometry.dispose();
    built.scriptGlowMaterial.dispose();
    built.scriptCoreMaterial.dispose();
    built.consensusGeometry.dispose();
    built.consensusGlowMaterial.dispose();
    built.consensusCoreMaterial.dispose();
    built.packetGeometry.dispose();
    built.packetMaterial.dispose();
  }, [built]);

  return (
    <group ref={rootRef} scale={presence}>
      <mesh
        geometry={built.membraneGeometry}
        material={built.membraneMaterial}
        frustumCulled={false}
        renderOrder={0}
      />
      <primitive object={built.outlineGlow} />
      <primitive object={built.outlineCore} />
      <primitive object={built.scriptGlow} />
      <primitive object={built.scriptCore} />
      <primitive object={built.consensusGlow} />
      <primitive object={built.consensusCore} />
      <instancedMesh
        ref={packetsRef}
        args={[built.packetGeometry, built.packetMaterial, MAX_PACKETS]}
        frustumCulled={false}
        renderOrder={7}
      />
    </group>
  );
}
