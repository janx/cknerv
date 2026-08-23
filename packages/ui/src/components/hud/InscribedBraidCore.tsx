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

interface OrbitSpec {
  phase: number;
  weave: number;
  amplitude: number;
  squash: number;
  rotation: THREE.Quaternion;
}

interface RailSpec {
  radius: number;
  squash: number;
  phase: number;
  rotation: THREE.Quaternion;
}

function orbitAngle(spec: OrbitSpec, t: number): number {
  return t + spec.phase * 0.12;
}

function orbitRadius(spec: OrbitSpec, t: number): number {
  return 0.465 + Math.sin(spec.weave * t + spec.phase) * spec.amplitude;
}

function orbitPoint(
  spec: OrbitSpec,
  t: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const angle = orbitAngle(spec, t);
  const weavePhase = spec.weave * t + spec.phase;
  const radius = orbitRadius(spec, t);
  target.set(
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * spec.squash,
    Math.cos(weavePhase) * spec.amplitude * 0.72
      + Math.sin(angle * 2 + spec.phase) * 0.022,
  );
  return target.applyQuaternion(spec.rotation);
}

function railPoint(
  rail: RailSpec,
  angle: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const ripple = 1 + Math.sin(angle * 5 + rail.phase) * 0.006;
  target.set(
    Math.cos(angle) * rail.radius * ripple,
    Math.sin(angle) * rail.radius * rail.squash * ripple,
    Math.sin(angle * 2 - rail.phase) * 0.012,
  );
  return target.applyQuaternion(rail.rotation);
}

function weaveFrequency(assetClass: number): number {
  const asset = Math.round(assetClass);
  if (asset === 1) return 3;
  if (asset === 2) return 5;
  if (asset === 3) return 2;
  if (asset === 4) return 4;
  if (asset === 5) return 6;
  if (asset === 6) return 7;
  if (asset === 7) return 1;
  return 3;
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

/**
 * A+C — contributor streams do not orbit around an unrelated inscription.
 * Their radial weave repeatedly crosses canonical rails; every crossing writes
 * a signature into that rail, so braid, script and agreement share one grammar.
 */
export default function InscribedBraidCore({
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
    const strandCount = 3 + Math.min(2, Math.round(visual.lockClass / 2));
    const railCount = 2 + (Math.round(visual.lockClass) % 2);
    const weave = weaveFrequency(visual.assetClass);
    const orbitSpecs: OrbitSpec[] = [];
    const railSpecs: RailSpec[] = [];
    const ribbonPositions: number[] = [];
    const ribbonColors: number[] = [];
    const orbitPositions: number[] = [];
    const orbitColors: number[] = [];
    const railPositions: number[] = [];
    const railColors: number[] = [];
    const glyphPositions: number[] = [];
    const glyphColors: number[] = [];
    const sealPositions: number[] = [];
    const sealColors: number[] = [];
    const knotPositions: number[] = [];
    const knotColors: number[] = [];
    const gold = new THREE.Color(0.96, 0.59, 0.18);
    const paleGold = new THREE.Color(1, 0.84, 0.5);
    const cyan = new THREE.Color(0.08, 0.78, 1);
    const violet = new THREE.Color(0.46, 0.23, 1);
    const pale = new THREE.Color(0.78, 0.96, 1);
    const accent = new THREE.Color(...visual.accent);
    const color = new THREE.Color();
    const point = new THREE.Vector3();
    const next = new THREE.Vector3();
    const previous = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const planeNormal = new THREE.Vector3();
    const radial = new THREE.Vector3();
    const left0 = new THREE.Vector3();
    const right0 = new THREE.Vector3();
    const left1 = new THREE.Vector3();
    const right1 = new THREE.Vector3();
    const mid0 = new THREE.Vector3();
    const mid1 = new THREE.Vector3();
    const sealA = new THREE.Vector3();
    const sealB = new THREE.Vector3();
    const reference = new THREE.Vector3(0, 0, 1);
    const fallback = new THREE.Vector3(0, 1, 0);
    const steps = 224;
    const ribbonWidth = 0.009 + visual.payload * 0.008;

    const frame = (
      spec: OrbitSpec,
      t: number,
      left: THREE.Vector3,
      right: THREE.Vector3,
    ) => {
      orbitPoint(spec, t, point);
      orbitPoint(spec, t - 0.002, previous);
      orbitPoint(spec, t + 0.002, next);
      tangent.subVectors(next, previous).normalize();
      normal.crossVectors(tangent, reference);
      if (normal.lengthSq() < 0.01) normal.crossVectors(tangent, fallback);
      normal.normalize().multiplyScalar(ribbonWidth);
      left.copy(point).add(normal);
      right.copy(point).sub(normal);
    };

    for (let strand = 0; strand < strandCount; strand += 1) {
      const phase = strand / strandCount * TAU
        + visual.seeds[strand % 4] * 0.48;
      const spec: OrbitSpec = {
        phase,
        weave,
        amplitude: 0.118 + visual.seeds[(strand + 2) % 4] * 0.018,
        squash: 0.88 + (visual.seeds[(strand + 1) % 4] - 0.5) * 0.06,
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (strand - (strandCount - 1) * 0.5) * 0.025,
          (visual.seeds[(strand + 3) % 4] - 0.5) * 0.12,
          0,
        )),
      };
      orbitSpecs.push(spec);
      for (let segment = 0; segment < steps; segment += 1) {
        const t0 = segment / steps * TAU;
        const t1 = (segment + 1) / steps * TAU;
        frame(spec, t0, left0, right0);
        frame(spec, t1, left1, right1);
        mid0.addVectors(left0, right0).multiplyScalar(0.5);
        mid1.addVectors(left1, right1).multiplyScalar(0.5);
        ribbonPositions.push(
          ...left0.toArray(), ...right0.toArray(), ...left1.toArray(),
          ...right0.toArray(), ...right1.toArray(), ...left1.toArray(),
        );
        for (let vertex = 0; vertex < 6; vertex += 1) {
          const spectral = 0.5 + 0.5 * Math.sin(t0 * weave + phase + vertex * 0.08);
          if (strand % 3 === 0) color.copy(gold).lerp(paleGold, spectral * 0.18);
          else if (strand % 3 === 1) color.copy(cyan).lerp(pale, spectral * 0.14);
          else color.copy(violet).lerp(cyan, 0.28 + spectral * 0.34);
          color.lerp(accent, 0.025);
          ribbonColors.push(color.r, color.g, color.b);
        }
        orbitPositions.push(...mid0.toArray(), ...mid1.toArray());
        if (strand % 3 === 0) color.copy(paleGold);
        else if (strand % 3 === 1) color.copy(pale);
        else color.copy(cyan).lerp(violet, 0.34);
        orbitColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
    }

    const railRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (visual.seeds[0] - 0.5) * 0.12,
      (visual.seeds[2] - 0.5) * 0.12,
      (visual.seeds[1] - 0.5) * 0.04,
    ));
    for (let railIndex = 0; railIndex < railCount; railIndex += 1) {
      const normalized = railCount <= 1 ? 0.5 : railIndex / (railCount - 1);
      const rail: RailSpec = {
        radius: 0.34 + normalized * 0.25,
        squash: 0.9 - railIndex * 0.012,
        phase: visual.seeds[(railIndex + 1) % 4] * TAU,
        rotation: railRotation,
      };
      railSpecs.push(rail);
      for (let segment = 0; segment < steps; segment += 1) {
        const hashWord = Math.floor(visual.seeds[(segment + railIndex) % 4] * 997);
        const keep = (Math.floor(segment / 4) + railIndex * 3 + hashWord) % 13 > 1;
        if (!keep) continue;
        const a = segment / steps * TAU;
        const b = (segment + 1) / steps * TAU;
        railPoint(rail, a, point);
        railPoint(rail, b, next);
        railPositions.push(...point.toArray(), ...next.toArray());
        const spectral = 0.5 + Math.cos(a + rail.phase) * 0.5;
        color.copy(railIndex === railCount - 1 ? gold : violet).lerp(cyan, spectral * 0.7);
        if (segment % 23 === 0) color.lerp(pale, 0.34);
        railColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }

      planeNormal.set(0, 0, 1).applyQuaternion(rail.rotation);
      const clusters = 2 + Math.round(visual.payload * 3);
      for (let cluster = 0; cluster < clusters; cluster += 1) {
        const clusterCentre = ((cluster + 0.32 + visual.seeds[(cluster + railIndex) % 4] * 0.28)
          / clusters) * TAU;
        const glyphCount = 3 + ((cluster + railIndex + Math.round(visual.lockClass)) % 3);
        for (let glyph = 0; glyph < glyphCount; glyph += 1) {
          const angle = clusterCentre + (glyph - (glyphCount - 1) * 0.5) * 0.045;
          railPoint(rail, angle, point);
          railPoint(rail, angle - 0.004, previous);
          railPoint(rail, angle + 0.004, next);
          tangent.subVectors(next, previous).normalize();
          radial.crossVectors(tangent, planeNormal).normalize();
          const length = 0.014
            + visual.seeds[(glyph + cluster + railIndex) % 4] * 0.022
            + (glyph === 0 ? 0.012 : 0);
          sealA.copy(point).addScaledVector(radial, -length * 0.12);
          sealB.copy(point).addScaledVector(radial, length);
          glyphPositions.push(...sealA.toArray(), ...sealB.toArray());
          color.copy(gold).lerp(cyan, normalized * 0.42);
          if (glyph === 0) color.lerp(pale, 0.4);
          glyphColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
          if ((glyph + cluster) % 3 === 0) {
            sealA.copy(sealB).addScaledVector(tangent, -length * 0.55);
            glyphPositions.push(...sealB.toArray(), ...sealA.toArray());
            glyphColors.push(color.r, color.g, color.b, pale.r, pale.g, pale.b);
          }
        }
      }
    }

    // Crossing detection is the fusion rule: a signature exists only when an
    // A-like woven stream actually passes through a C-like canonical rail.
    const crossingsPerPair = 1 + Math.round(visual.payload);
    for (let strand = 0; strand < orbitSpecs.length; strand += 1) {
      const orbit = orbitSpecs[strand];
      for (let railIndex = 0; railIndex < railSpecs.length; railIndex += 1) {
        const rail = railSpecs[railIndex];
        const crossings: number[] = [];
        let previousDelta = orbitRadius(orbit, 0) - rail.radius;
        for (let sample = 1; sample <= steps; sample += 1) {
          const t = sample / steps * TAU;
          const delta = orbitRadius(orbit, t) - rail.radius;
          if (delta === 0 || delta * previousDelta < 0) crossings.push(t);
          previousDelta = delta;
        }
        if (crossings.length === 0) continue;
        const offset = Math.floor(visual.seeds[(strand + railIndex) % 4] * crossings.length);
        for (let crossing = 0; crossing < crossingsPerPair; crossing += 1) {
          const crossingIndex = (offset
            + Math.floor(crossing * crossings.length / crossingsPerPair)) % crossings.length;
          const t = crossings[crossingIndex];
          const angle = orbitAngle(orbit, t);
          orbitPoint(orbit, t, point);
          railPoint(rail, angle, next);
          sealPositions.push(...point.toArray(), ...next.toArray());
          color.copy(pale).lerp(paleGold, (strand + railIndex + crossing) % 2 === 0 ? 0.42 : 0.12);
          sealColors.push(color.r, color.g, color.b, color.r, color.g, color.b);

          railPoint(rail, angle - 0.025, sealA);
          railPoint(rail, angle + 0.025, sealB);
          sealPositions.push(...sealA.toArray(), ...sealB.toArray());
          sealColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
          knotPositions.push(...next.toArray());
          knotColors.push(color.r, color.g, color.b);
        }
      }
    }

    const ribbonGeometry = new THREE.BufferGeometry();
    ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3));
    ribbonGeometry.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3));
    ribbonGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const ribbonMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });

    const orbitGeometry = new LineSegmentsGeometry();
    orbitGeometry.setPositions(orbitPositions);
    orbitGeometry.setColors(orbitColors);
    orbitGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const orbitGlowMaterial = makeLineMaterial(4.8, 0.055);
    const orbitCoreMaterial = makeLineMaterial(0.68, 0.76);
    const [orbitGlow, orbitCore] = makeLinePair(
      orbitGeometry,
      orbitGlowMaterial,
      orbitCoreMaterial,
      1,
    );

    const railGeometry = new LineSegmentsGeometry();
    railGeometry.setPositions(railPositions);
    railGeometry.setColors(railColors);
    railGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const railGlowMaterial = makeLineMaterial(5.8, 0.07);
    const railCoreMaterial = makeLineMaterial(0.78, 0.64);
    const [railGlow, railCore] = makeLinePair(
      railGeometry,
      railGlowMaterial,
      railCoreMaterial,
      3,
    );

    const glyphGeometry = new LineSegmentsGeometry();
    glyphGeometry.setPositions(glyphPositions);
    glyphGeometry.setColors(glyphColors);
    glyphGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const glyphGlowMaterial = makeLineMaterial(4.6, 0.08);
    const glyphCoreMaterial = makeLineMaterial(0.9, 0.78);
    const [glyphGlow, glyphCore] = makeLinePair(
      glyphGeometry,
      glyphGlowMaterial,
      glyphCoreMaterial,
      5,
    );

    const sealGeometry = new LineSegmentsGeometry();
    sealGeometry.setPositions(sealPositions);
    sealGeometry.setColors(sealColors);
    sealGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const sealGlowMaterial = makeLineMaterial(8.6, 0.13);
    const sealCoreMaterial = makeLineMaterial(1.35, 0.96);
    const [sealGlow, sealCore] = makeLinePair(
      sealGeometry,
      sealGlowMaterial,
      sealCoreMaterial,
      7,
    );

    const knotGeometry = new THREE.BufferGeometry();
    knotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(knotPositions, 3));
    knotGeometry.setAttribute('color', new THREE.Float32BufferAttribute(knotColors, 3));
    knotGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    const knotGlowMaterial = new THREE.PointsMaterial({
      size: 0.05,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const knotCoreMaterial = new THREE.PointsMaterial({
      size: 0.012,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const packetGeometry = new THREE.BoxGeometry(0.045, 0.009, 0.01);
    const packetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      orbitSpecs,
      ribbonGeometry,
      ribbonMaterial,
      orbitGeometry,
      orbitGlowMaterial,
      orbitCoreMaterial,
      orbitGlow,
      orbitCore,
      railGeometry,
      railGlowMaterial,
      railCoreMaterial,
      railGlow,
      railCore,
      glyphGeometry,
      glyphGlowMaterial,
      glyphCoreMaterial,
      glyphGlow,
      glyphCore,
      sealGeometry,
      sealGlowMaterial,
      sealCoreMaterial,
      sealGlow,
      sealCore,
      knotGeometry,
      knotGlowMaterial,
      knotCoreMaterial,
      packetGeometry,
      packetMaterial,
    };
  }, [visual]);

  const packetCount = visual.payload <= 0
    ? 0
    : Math.min(MAX_PACKETS, Math.max(1, Math.round(visual.payload * MAX_PACKETS)));
  const presence = 1.04 + (visual.mass - 0.84) * 0.32;

  useEffect(() => {
    const mesh = packetsRef.current;
    if (!mesh) return;
    const gold = new THREE.Color(1, 0.72, 0.28);
    const cyan = new THREE.Color(0.34, 0.92, 1);
    for (let index = 0; index < packetCount; index += 1) {
      mesh.setColorAt(index, index % 3 === 0 ? gold : cyan);
    }
    mesh.count = packetCount;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packetCount]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    for (const material of [
      built.orbitGlowMaterial,
      built.orbitCoreMaterial,
      built.railGlowMaterial,
      built.railCoreMaterial,
      built.glyphGlowMaterial,
      built.glyphCoreMaterial,
      built.sealGlowMaterial,
      built.sealCoreMaterial,
    ]) {
      material.resolution.set(state.size.width, state.size.height);
    }
    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[2] - 0.5) * 0.24
        + Math.sin(time * 0.085) * 0.18;
      rootRef.current.rotation.x = (visual.seeds[0] - 0.5) * 0.16
        + Math.sin(time * 0.065 + visual.seeds[3] * TAU) * 0.022;
      rootRef.current.rotation.z = Math.sin(time * 0.095 + visual.seeds[1] * TAU) * 0.022;
    }
    const mesh = packetsRef.current;
    if (!mesh || packetCount === 0) return;
    for (let index = 0; index < packetCount; index += 1) {
      const orbit = built.orbitSpecs[index % built.orbitSpecs.length];
      const t = (index / packetCount * TAU
        + time * (0.052 + visual.seeds[index % 4] * 0.028)) % TAU;
      orbitPoint(orbit, t, PACKET_POSITION);
      orbitPoint(orbit, t + 0.006, PACKET_NEXT);
      PACKET_TANGENT.subVectors(PACKET_NEXT, PACKET_POSITION).normalize();
      PACKET_QUATERNION.setFromUnitVectors(X_AXIS, PACKET_TANGENT);
      PACKET_SCALE.setScalar((index + Math.floor(time * 2)) % 5 === 0 ? 1.26 : 0.72);
      PACKET_MATRIX.compose(PACKET_POSITION, PACKET_QUATERNION, PACKET_SCALE);
      mesh.setMatrixAt(index, PACKET_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.ribbonGeometry.dispose();
    built.ribbonMaterial.dispose();
    built.orbitGeometry.dispose();
    built.orbitGlowMaterial.dispose();
    built.orbitCoreMaterial.dispose();
    built.railGeometry.dispose();
    built.railGlowMaterial.dispose();
    built.railCoreMaterial.dispose();
    built.glyphGeometry.dispose();
    built.glyphGlowMaterial.dispose();
    built.glyphCoreMaterial.dispose();
    built.sealGeometry.dispose();
    built.sealGlowMaterial.dispose();
    built.sealCoreMaterial.dispose();
    built.knotGeometry.dispose();
    built.knotGlowMaterial.dispose();
    built.knotCoreMaterial.dispose();
    built.packetGeometry.dispose();
    built.packetMaterial.dispose();
  }, [built]);

  return (
    <group ref={rootRef} scale={presence}>
      <mesh
        geometry={built.ribbonGeometry}
        material={built.ribbonMaterial}
        frustumCulled={false}
        renderOrder={0}
      />
      <primitive object={built.orbitGlow} />
      <primitive object={built.orbitCore} />
      <primitive object={built.railGlow} />
      <primitive object={built.railCore} />
      <primitive object={built.glyphGlow} />
      <primitive object={built.glyphCore} />
      <primitive object={built.sealGlow} />
      <primitive object={built.sealCore} />
      <points
        geometry={built.knotGeometry}
        material={built.knotGlowMaterial}
        frustumCulled={false}
        renderOrder={9}
      />
      <points
        geometry={built.knotGeometry}
        material={built.knotCoreMaterial}
        frustumCulled={false}
        renderOrder={10}
      />
      <instancedMesh
        ref={packetsRef}
        args={[built.packetGeometry, built.packetMaterial, MAX_PACKETS]}
        frustumCulled={false}
        renderOrder={11}
      />
    </group>
  );
}
