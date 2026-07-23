import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import {
  CELL_CONTENT_ADDRESS_RADIUS_MAX,
  CELL_CONTENT_ADDRESS_SPINE_OVERSHOOT,
  cellContentAddressEchoFrame,
  deriveCellContentAddressEncoding,
  deriveCellContentAddressSegments,
} from '../derives/cellContentAddress.derive';

const ADDRESS_GEOMETRY_RADIUS = CELL_CONTENT_ADDRESS_RADIUS_MAX
  + CELL_CONTENT_ADDRESS_SPINE_OVERSHOOT;

export interface CellContentAddressEchoEvent {
  cellId: number;
  sequence: number;
  emittedAtMs: number;
  reducedMotion: boolean;
}

function makeEchoLineMaterial(
  linewidth: number,
  opacity: number,
  blending: THREE.Blending,
): LineMaterial {
  const material = new LineMaterial({
    linewidth,
    opacity,
    transparent: true,
    blending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.vertexColors = true;
  material.worldUnits = false;
  return material;
}

/**
 * One exact full-hash signature at the selected Cell's real scene position.
 * It appears only after the portrait has read all eight address lanes.
 */
export default function CellContentAddressEchoMarker({
  cell,
  event,
}: {
  cell: Cell;
  event: CellContentAddressEchoEvent;
}) {
  const size = useThree((state) => state.size);
  const groupRef = useRef<THREE.Group>(null);
  const settledSequenceRef = useRef<number | null>(null);
  const encoding = useMemo(
    () => deriveCellContentAddressEncoding(cell.content_hash),
    [cell.content_hash],
  );
  const built = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const segment of deriveCellContentAddressSegments(encoding)) {
      positions.push(...segment.from, ...segment.to);
      colors.push(
        segment.color[0] * segment.energy,
        segment.color[1] * segment.energy,
        segment.color[2] * segment.energy,
        segment.color[0] * segment.energy,
        segment.color[1] * segment.energy,
        segment.color[2] * segment.energy,
      );
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      ADDRESS_GEOMETRY_RADIUS,
    );
    const glowMaterial = makeEchoLineMaterial(
      3.6,
      0,
      THREE.AdditiveBlending,
    );
    const coreMaterial = makeEchoLineMaterial(
      0.78,
      0,
      THREE.NormalBlending,
    );
    const horizonGeometry = new THREE.PlaneGeometry(1.36, 1.36);
    const horizonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
      },
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix
            * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float radius = length(vUv - 0.5);
          float inner = smoothstep(0.22, 0.29, radius);
          float outer = 1.0 - smoothstep(0.43, 0.5, radius);
          float horizon = inner * outer;
          if (horizon <= 0.001) discard;
          gl_FragColor = vec4(0.002, 0.008, 0.022, horizon * uOpacity);
        }
      `,
    });
    const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
    const glow = new LineSegments2(geometry, glowMaterial);
    const core = new LineSegments2(geometry, coreMaterial);
    horizon.frustumCulled = false;
    glow.frustumCulled = false;
    core.frustumCulled = false;
    horizon.renderOrder = 15;
    glow.renderOrder = 16;
    core.renderOrder = 17;
    return {
      geometry,
      glowMaterial,
      coreMaterial,
      horizonGeometry,
      horizonMaterial,
      horizon,
      glow,
      core,
      segmentCount: positions.length / 6,
    };
  }, [encoding]);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const auditData = useMemo(() => ({
    memoryContentAddressEcho: 'idle',
    memoryContentAddressEchoCell: cell.id,
    memoryContentAddressEchoSequence: event.sequence,
    memoryContentAddressEchoFingerprint: encoding.fingerprint,
    memoryContentAddressEchoLanes: encoding.lanes
      .map((lane) => lane.toFixed(3))
      .join(','),
    memoryContentAddressEchoPhase: encoding.phase.toFixed(3),
    memoryContentAddressEchoSegments: built.segmentCount,
    memoryContentAddressEchoProgress: 0,
    memoryContentAddressEchoStrength: 0,
    memoryContentAddressEchoRadiusPx: 0,
  }), [
    built.segmentCount,
    cell.id,
    encoding.fingerprint,
    encoding.lanes,
    encoding.phase,
    event.sequence,
  ]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
  }, [built, size.height, size.width]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group || settledSequenceRef.current === event.sequence) return;
    const frame = cellContentAddressEchoFrame(
      (performance.now() - event.emittedAtMs) / 1000,
      event.reducedMotion,
    );
    group.userData.memoryContentAddressEcho = frame.state;
    group.userData.memoryContentAddressEchoProgress = frame.progress;
    group.userData.memoryContentAddressEchoStrength = frame.strength;
    group.userData.memoryContentAddressEchoRadiusPx = frame.radiusPx;
    const active = (frame.state === 'confirming' || frame.state === 'reduced')
      && frame.strength > 0.001;
    group.visible = active;
    if (!active) {
      if (frame.state === 'settled') {
        settledSequenceRef.current = event.sequence;
      }
      return;
    }

    const parent = group.parent;
    parent?.updateWorldMatrix(true, false);
    state.camera.updateWorldMatrix(true, false);
    group.getWorldPosition(worldPosition);
    state.camera.getWorldPosition(cameraPosition);
    state.camera.getWorldQuaternion(cameraQuaternion);
    if (parent) {
      parent.getWorldQuaternion(parentQuaternion);
      parent.getWorldScale(parentScale);
    } else {
      parentQuaternion.identity();
      parentScale.set(1, 1, 1);
    }
    group.quaternion
      .copy(parentQuaternion)
      .invert()
      .multiply(cameraQuaternion);
    const distance = Math.max(0.001, worldPosition.distanceTo(cameraPosition));
    const worldPerCssPixel = 2 * distance / (
      Math.max(1, state.size.height)
      * Math.max(0.001, state.camera.projectionMatrix.elements[5])
    );
    const inheritedScale = Math.max(
      0.001,
      (Math.abs(parentScale.x) + Math.abs(parentScale.y)
        + Math.abs(parentScale.z)) / 3,
    );
    const localScale = frame.radiusPx * worldPerCssPixel
      / (ADDRESS_GEOMETRY_RADIUS * inheritedScale);
    group.scale.setScalar(localScale);
    built.glowMaterial.opacity = frame.strength * 0.13;
    built.coreMaterial.opacity = frame.strength * 0.82;
    built.horizonMaterial.uniforms.uOpacity.value = frame.strength * 0.48;
  });

  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
    built.horizonGeometry.dispose();
    built.horizonMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={groupRef}
      position={cell.pos_seed}
      visible={false}
      userData={auditData}
    >
      <primitive object={built.horizon} />
      <primitive object={built.glow} />
      <primitive object={built.core} />
    </group>
  );
}
