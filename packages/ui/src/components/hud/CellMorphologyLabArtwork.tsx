import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CellMorphologyTopology } from '../../derives/cellMorphology.derive';

export type CellMorphologyLabCamera = 'front' | 'side' | 'three-quarter';
export type CellMorphologyLabMode = 'static' | 'normal' | 'resolved';

const CAMERA_ROTATION: Record<CellMorphologyLabCamera, [number, number, number]> = {
  front: [0, 0, 0],
  side: [0, Math.PI / 2, 0],
  'three-quarter': [-0.24, 0.66, 0.08],
};

const WARM_STRANDS = ['#fb7185', '#fbbf24', '#c084fc', '#fda4af', '#f59e0b'];

function pushSegment(
  positions: number[],
  colors: number[],
  from: readonly number[],
  to: readonly number[],
  color: THREE.Color,
): void {
  positions.push(from[0], from[1], from[2], to[0], to[1], to[2]);
  colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

function lineGeometry(
  topology: CellMorphologyTopology,
  greyscale: boolean,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const strand of topology.strands) {
    const color = new THREE.Color(
      greyscale ? '#d1d5db' : WARM_STRANDS[strand.index % WARM_STRANDS.length],
    );
    for (let index = 0; index < strand.points.length - 1; index += 1) {
      pushSegment(positions, colors, strand.points[index], strand.points[index + 1], color);
    }
  }
  const markColor = new THREE.Color(greyscale ? '#ffffff' : '#fde68a');
  for (const mark of topology.dataMarks) {
    pushSegment(positions, colors, mark.point, mark.midpoint, markColor);
    pushSegment(positions, colors, mark.midpoint, mark.peerPoint, markColor);
    if (mark.kind === 'double_knot') {
      pushSegment(positions, colors, mark.point, mark.peerPoint, markColor);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function nodeGeometry(topology: CellMorphologyTopology): THREE.BufferGeometry {
  const points = topology.agreements.flatMap((agreement) => agreement.midpoint);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Lab-only presentation of the same V2 topology consumed by production. */
export default function CellMorphologyLabArtwork({
  topology,
  camera,
  mode,
  greyscale,
  structureOnly,
}: {
  topology: CellMorphologyTopology;
  camera: CellMorphologyLabCamera;
  mode: CellMorphologyLabMode;
  greyscale: boolean;
  structureOnly: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(
    () => lineGeometry(topology, greyscale),
    [greyscale, topology],
  );
  const nodes = useMemo(() => nodeGeometry(topology), [topology]);
  useEffect(() => () => {
    geometry.dispose();
    nodes.dispose();
  }, [geometry, nodes]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const base = CAMERA_ROTATION[camera];
    if (mode === 'static') {
      group.rotation.set(base[0], base[1], base[2]);
      return;
    }
    const time = clock.getElapsedTime();
    const rate = mode === 'resolved' ? 0.075 : 0.16;
    group.rotation.set(
      base[0] + Math.sin(time * 0.31) * 0.035,
      base[1] + time * rate,
      base[2] + Math.cos(time * 0.23) * 0.025,
    );
  });

  const nodeColor = greyscale ? '#ffffff' : '#fef3c7';
  const scale = topology.presenceScale * 0.9;
  return (
    <group ref={groupRef} scale={scale} rotation={CAMERA_ROTATION[camera]}>
      {!structureOnly ? (
        <lineSegments geometry={geometry} renderOrder={0}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={0.16}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      ) : null}
      <lineSegments geometry={geometry} renderOrder={1}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={structureOnly ? 0.92 : 0.72}
          depthWrite={false}
        />
      </lineSegments>
      {topology.agreements.length > 0 ? (
        <points geometry={nodes} renderOrder={2}>
          <pointsMaterial
            color={nodeColor}
            size={mode === 'resolved' ? 0.052 : 0.038}
            sizeAttenuation
            transparent
            opacity={structureOnly ? 0.84 : 1}
            depthWrite={false}
          />
        </points>
      ) : null}
    </group>
  );
}
