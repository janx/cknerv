import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import { deriveCellVisual } from '../../derives/cellVisual.derive';

const TAU = Math.PI * 2;
const MAX_PACKETS = 18;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const PACKET_POSITION = new THREE.Vector3();
const PACKET_NEXT = new THREE.Vector3();
const PACKET_TANGENT = new THREE.Vector3();
const PACKET_QUATERNION = new THREE.Quaternion();
const PACKET_SCALE = new THREE.Vector3();
const PACKET_MATRIX = new THREE.Matrix4();

interface ScriptBand {
  radiusX: number;
  radiusY: number;
  phase: number;
  modulation: number;
  rotation: THREE.Quaternion;
}

function bandPoint(
  band: ScriptBand,
  angle: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const t = angle + band.phase;
  const pulse = 1
    + Math.sin(t * 3 - band.phase * 2) * band.modulation
    + Math.sin(t * 7 + band.phase) * band.modulation * 0.28;
  target.set(
    Math.cos(t) * band.radiusX * pulse,
    Math.sin(t) * band.radiusY * pulse,
    Math.sin(t * 2 + band.phase) * band.modulation * 0.8,
  );
  return target.applyQuaternion(band.rotation);
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

function ellipseProfile(assetClass: number): readonly [number, number] {
  const asset = Math.round(assetClass);
  if (asset === 1) return [1.08, 0.91];
  if (asset === 2) return [1.14, 0.82];
  if (asset === 3) return [0.94, 1.07];
  if (asset === 4) return [1.02, 0.76];
  if (asset === 5) return [0.87, 1.1];
  return [1, 0.94];
}

/**
 * Direction C — the data is not enclosed by a body. Independent maintainers
 * inscribe partial records into a shared celestial grammar; pale bridges mark
 * the moments at which separate bands agree on the same state.
 */
export default function QuantumLoomCore({
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
    const [ellipseX, ellipseY] = ellipseProfile(visual.assetClass);
    const bandCount = 3 + (Math.round(visual.lockClass) % 3);
    const bands: ScriptBand[] = [];
    const bandPositions: number[] = [];
    const bandColors: number[] = [];
    const accentPositions: number[] = [];
    const accentColors: number[] = [];
    const anchorPositions: number[] = [];
    const anchorColors: number[] = [];
    const glyphPositions: number[] = [];
    const glyphColors: number[] = [];
    const bridgePositions: number[] = [];
    const bridgeColors: number[] = [];
    const cyan = new THREE.Color(0.16, 0.82, 1);
    const gold = new THREE.Color(1, 0.66, 0.24);
    const pale = new THREE.Color(0.82, 0.96, 1);
    const violet = new THREE.Color(0.55, 0.3, 1);
    const accent = new THREE.Color(...visual.accent);
    const color = new THREE.Color();
    const point = new THREE.Vector3();
    const next = new THREE.Vector3();
    const previous = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const radial = new THREE.Vector3();
    const planeNormal = new THREE.Vector3();
    const inner = new THREE.Vector3();
    const outer = new THREE.Vector3();
    const hook = new THREE.Vector3();
    const bandSteps = 224;
    const glyphClusterCount = 3 + Math.round(visual.payload * 3);

    for (let index = 0; index < bandCount; index += 1) {
      const normalized = bandCount <= 1 ? 0 : index / (bandCount - 1);
      const radius = 0.29 + normalized * 0.39;
      const seed = visual.seeds[index % 4];
      const band: ScriptBand = {
        radiusX: radius * ellipseX,
        radiusY: radius * ellipseY * (1 - index * 0.018),
        phase: seed * TAU + index * 0.17,
        modulation: 0.004 + visual.seeds[(index + 2) % 4] * 0.008,
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          (index - (bandCount - 1) * 0.5) * 0.12,
          (visual.seeds[(index + 1) % 4] - 0.5) * 0.36,
          (seed - 0.5) * 0.13,
        )),
      };
      bands.push(band);

      for (let step = 0; step < bandSteps; step += 1) {
        const signature = Math.floor(visual.seeds[(step + index) % 4] * 991);
        const gapPeriod = 15 - Math.min(4, Math.round(visual.lockClass));
        const inGap = (Math.floor(step / 3) + index * 5 + signature) % gapPeriod < 2;
        if (inGap) continue;
        const a = (step / bandSteps) * TAU;
        const b = ((step + 1) / bandSteps) * TAU;
        bandPoint(band, a, point);
        bandPoint(band, b, next);
        bandPositions.push(point.x, point.y, point.z, next.x, next.y, next.z);
        for (const angle of [a, b]) {
          const spectral = 0.5 + Math.cos(angle + index * 0.9) * 0.5;
          color.copy(index === bandCount - 1 ? gold : violet).lerp(cyan, spectral * 0.82);
          if ((step + index) % 17 === 0) color.lerp(pale, 0.42);
          color.lerp(accent, 0.035);
          bandColors.push(color.r, color.g, color.b);
        }
      }

      planeNormal.set(0, 0, 1).applyQuaternion(band.rotation);
      for (let cluster = 0; cluster < glyphClusterCount; cluster += 1) {
        const clusterSeed = visual.seeds[(cluster + index) % 4];
        const clusterCentre = ((cluster + 0.24 + clusterSeed * 0.34) / glyphClusterCount) * TAU;
        const glyphsInCluster = 3
          + ((cluster + index + Math.round(visual.lockClass)) % 4);
        const spacing = 0.032 + visual.seeds[(cluster + index + 2) % 4] * 0.018;
        for (let local = 0; local < glyphsInCluster; local += 1) {
          const glyph = cluster * 7 + local;
          const a = clusterCentre + (local - (glyphsInCluster - 1) * 0.5) * spacing;
          bandPoint(band, a, point);
          bandPoint(band, a - 0.004, previous);
          bandPoint(band, a + 0.004, next);
          tangent.subVectors(next, previous).normalize();
          radial.crossVectors(tangent, planeNormal).normalize();
          const direction = glyph % 2 === 0 ? 1 : -1;
          const length = 0.014
            + visual.seeds[(glyph + index * 2) % 4] * 0.026
            + (local === 0 ? 0.012 : 0);
          inner.copy(point).addScaledVector(radial, -length * 0.16 * direction);
          outer.copy(point).addScaledVector(radial, length * direction);
          glyphPositions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);
          color.copy(gold).lerp(cyan, index / Math.max(1, bandCount - 1) * 0.48);
          if (local === 0 || local === glyphsInCluster - 1) color.lerp(pale, 0.38);
          glyphColors.push(color.r, color.g, color.b, color.r, color.g, color.b);

          if ((glyph + index) % 3 === 0) {
            hook.copy(outer)
              .addScaledVector(tangent, (glyph % 2 === 0 ? -1 : 1) * length * 0.72)
              .addScaledVector(radial, -length * 0.28 * direction);
            glyphPositions.push(outer.x, outer.y, outer.z, hook.x, hook.y, hook.z);
            glyphColors.push(color.r, color.g, color.b, pale.r, pale.g, pale.b);
          }
        }
      }

      // A few authoritative strokes carry more visual weight than the base
      // band. They begin near inscription clusters and terminate in a node,
      // creating ceremonial punctuation without introducing solid plates.
      const accentArcCount = 1 + ((index + Math.round(visual.lockClass)) % 2);
      for (let arc = 0; arc < accentArcCount; arc += 1) {
        const arcSeed = visual.seeds[(index + arc + 1) % 4];
        const start = arcSeed * TAU + arc * 1.17 + index * 0.31;
        const span = 0.2 + visual.seeds[(index + arc + 3) % 4] * 0.2;
        const arcSteps = 14;
        for (let step = 0; step < arcSteps; step += 1) {
          const a = start + step / arcSteps * span;
          const b = start + (step + 1) / arcSteps * span;
          bandPoint(band, a, point);
          bandPoint(band, b, next);
          accentPositions.push(point.x, point.y, point.z, next.x, next.y, next.z);
          color.copy(index === bandCount - 1 ? gold : cyan).lerp(pale, step / arcSteps * 0.28);
          accentColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
        bandPoint(band, start + span, point);
        anchorPositions.push(point.x, point.y, point.z);
        color.copy(pale).lerp(gold, index === bandCount - 1 ? 0.42 : 0.1);
        anchorColors.push(color.r, color.g, color.b);
      }
    }

    const bridgeCount = 3 + Math.round(visual.payload * 2);
    for (let bridge = 0; bridge < bridgeCount; bridge += 1) {
      const fromBand = bridge % Math.max(1, bandCount - 1);
      const toBand = Math.min(bandCount - 1, fromBand + 1);
      const a = ((bridge + visual.seeds[bridge % 4]) / bridgeCount) * TAU;
      bandPoint(bands[fromBand], a, point);
      bandPoint(bands[toBand], a + 0.07, next);
      bridgePositions.push(point.x, point.y, point.z, next.x, next.y, next.z);
      color.copy(pale).lerp(gold, bridge % 3 === 0 ? 0.44 : 0.1);
      bridgeColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }

    const bandGeometry = new LineSegmentsGeometry();
    bandGeometry.setPositions(bandPositions);
    bandGeometry.setColors(bandColors);
    bandGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const bandGlowMaterial = makeLineMaterial(5.4, 0.07);
    const bandCoreMaterial = makeLineMaterial(0.72, 0.58);
    const [bandGlow, bandCore] = makeLinePair(
      bandGeometry,
      bandGlowMaterial,
      bandCoreMaterial,
      0,
    );

    const accentGeometry = new LineSegmentsGeometry();
    accentGeometry.setPositions(accentPositions);
    accentGeometry.setColors(accentColors);
    accentGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const accentGlowMaterial = makeLineMaterial(7.2, 0.11);
    const accentCoreMaterial = makeLineMaterial(1.55, 0.94);
    const [accentGlow, accentCore] = makeLinePair(
      accentGeometry,
      accentGlowMaterial,
      accentCoreMaterial,
      2,
    );

    const glyphGeometry = new LineSegmentsGeometry();
    glyphGeometry.setPositions(glyphPositions);
    glyphGeometry.setColors(glyphColors);
    glyphGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const glyphGlowMaterial = makeLineMaterial(4.2, 0.09);
    const glyphCoreMaterial = makeLineMaterial(0.94, 0.82);
    const [glyphGlow, glyphCore] = makeLinePair(
      glyphGeometry,
      glyphGlowMaterial,
      glyphCoreMaterial,
      4,
    );

    const bridgeGeometry = new LineSegmentsGeometry();
    bridgeGeometry.setPositions(bridgePositions);
    bridgeGeometry.setColors(bridgeColors);
    bridgeGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const bridgeGlowMaterial = makeLineMaterial(6.2, 0.08);
    const bridgeCoreMaterial = makeLineMaterial(0.92, 0.72);
    const [bridgeGlow, bridgeCore] = makeLinePair(
      bridgeGeometry,
      bridgeGlowMaterial,
      bridgeCoreMaterial,
      6,
    );

    const anchorGeometry = new THREE.BufferGeometry();
    anchorGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(anchorPositions, 3),
    );
    anchorGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(anchorColors, 3),
    );
    anchorGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.25);
    const anchorGlowMaterial = new THREE.PointsMaterial({
      size: 0.045,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const anchorCoreMaterial = new THREE.PointsMaterial({
      size: 0.011,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const packetGeometry = new THREE.BoxGeometry(0.065, 0.012, 0.012);
    const packetMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    return {
      bands,
      bandGeometry,
      bandGlowMaterial,
      bandCoreMaterial,
      bandGlow,
      bandCore,
      accentGeometry,
      accentGlowMaterial,
      accentCoreMaterial,
      accentGlow,
      accentCore,
      glyphGeometry,
      glyphGlowMaterial,
      glyphCoreMaterial,
      glyphGlow,
      glyphCore,
      bridgeGeometry,
      bridgeGlowMaterial,
      bridgeCoreMaterial,
      bridgeGlow,
      bridgeCore,
      anchorGeometry,
      anchorGlowMaterial,
      anchorCoreMaterial,
      packetGeometry,
      packetMaterial,
    };
  }, [visual]);

  const packetCount = visual.payload <= 0
    ? 0
    : Math.min(MAX_PACKETS, Math.max(1, Math.round(visual.payload * MAX_PACKETS)));
  const presence = 1.02 + (visual.mass - 0.84) * 0.32;

  useEffect(() => {
    const mesh = packetsRef.current;
    if (!mesh) return;
    const gold = new THREE.Color(1, 0.72, 0.3);
    const cyan = new THREE.Color(0.36, 0.92, 1);
    for (let index = 0; index < packetCount; index += 1) {
      mesh.setColorAt(index, index % 3 === 0 ? gold : cyan);
    }
    mesh.count = packetCount;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packetCount]);

  useFrame((state) => {
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    for (const material of [
      built.bandGlowMaterial,
      built.bandCoreMaterial,
      built.accentGlowMaterial,
      built.accentCoreMaterial,
      built.glyphGlowMaterial,
      built.glyphCoreMaterial,
      built.bridgeGlowMaterial,
      built.bridgeCoreMaterial,
    ]) {
      material.resolution.set(state.size.width, state.size.height);
    }
    if (rootRef.current) {
      rootRef.current.rotation.y = (visual.seeds[3] - 0.5) * 0.3
        + Math.sin(time * 0.09) * 0.18;
      rootRef.current.rotation.x = (visual.seeds[0] - 0.5) * 0.18
        + Math.sin(time * 0.07 + visual.seeds[1] * TAU) * 0.025;
      rootRef.current.rotation.z = Math.sin(time * 0.11) * 0.025;
    }
    const mesh = packetsRef.current;
    if (!mesh || packetCount === 0) return;
    for (let index = 0; index < packetCount; index += 1) {
      const band = built.bands[index % built.bands.length];
      const angle = (index / packetCount) * TAU
        + time * (0.065 + visual.seeds[index % 4] * 0.035);
      bandPoint(band, angle, PACKET_POSITION);
      bandPoint(band, angle + 0.008, PACKET_NEXT);
      PACKET_TANGENT.subVectors(PACKET_NEXT, PACKET_POSITION).normalize();
      PACKET_QUATERNION.setFromUnitVectors(X_AXIS, PACKET_TANGENT);
      PACKET_SCALE.setScalar((index + Math.floor(time * 2)) % 5 === 0 ? 1.28 : 0.72);
      PACKET_MATRIX.compose(PACKET_POSITION, PACKET_QUATERNION, PACKET_SCALE);
      mesh.setMatrixAt(index, PACKET_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => () => {
    built.bandGeometry.dispose();
    built.bandGlowMaterial.dispose();
    built.bandCoreMaterial.dispose();
    built.accentGeometry.dispose();
    built.accentGlowMaterial.dispose();
    built.accentCoreMaterial.dispose();
    built.glyphGeometry.dispose();
    built.glyphGlowMaterial.dispose();
    built.glyphCoreMaterial.dispose();
    built.bridgeGeometry.dispose();
    built.bridgeGlowMaterial.dispose();
    built.bridgeCoreMaterial.dispose();
    built.anchorGeometry.dispose();
    built.anchorGlowMaterial.dispose();
    built.anchorCoreMaterial.dispose();
    built.packetGeometry.dispose();
    built.packetMaterial.dispose();
  }, [built]);

  return (
    <group ref={rootRef} scale={presence}>
      <primitive object={built.bandGlow} />
      <primitive object={built.bandCore} />
      <primitive object={built.accentGlow} />
      <primitive object={built.accentCore} />
      <primitive object={built.glyphGlow} />
      <primitive object={built.glyphCore} />
      <primitive object={built.bridgeGlow} />
      <primitive object={built.bridgeCore} />
      <points
        geometry={built.anchorGeometry}
        material={built.anchorGlowMaterial}
        frustumCulled={false}
        renderOrder={8}
      />
      <points
        geometry={built.anchorGeometry}
        material={built.anchorCoreMaterial}
        frustumCulled={false}
        renderOrder={9}
      />
      <instancedMesh
        ref={packetsRef}
        args={[built.packetGeometry, built.packetMaterial, MAX_PACKETS]}
        frustumCulled={false}
        renderOrder={10}
      />
    </group>
  );
}
