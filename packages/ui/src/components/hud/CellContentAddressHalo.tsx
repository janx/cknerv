import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  cellContentAddressLaneEnergy,
  cellContentAddressReadFrame,
  deriveCellContentAddressSegments,
  type CellContentAddressEncoding,
} from '../../derives/cellContentAddress.derive';

const PORTRAIT_ADDRESS_SCALE = 0.92;

function makeAddressLineMaterial(
  width: number,
  opacity: number,
): LineMaterial {
  const material = new LineMaterial({
    linewidth: width,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.vertexColors = true;
  material.worldUnits = false;
  return material;
}

/**
 * A content-address horizon shared by every portrait direction. Its eight
 * checksum cuts perform one bounded read while consensus motion stays behind.
 */
export default function CellContentAddressHalo({
  encoding,
  contentFocused,
  reducedMotion,
  onReadResolved,
}: {
  encoding: CellContentAddressEncoding;
  contentFocused: boolean;
  reducedMotion: boolean;
  onReadResolved?: () => void;
}) {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);
  const focusStartedAtRef = useRef<number | null>(null);
  const resolvedNotifiedRef = useRef(false);
  const onReadResolvedRef = useRef(onReadResolved);
  onReadResolvedRef.current = onReadResolved;
  const lastVisualFrameRef = useRef<{
    state: string;
    activeLane: number | null;
    laneProgress: number;
  } | null>(null);
  const built = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const laneBySegment: number[] = [];
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
      laneBySegment.push(segment.laneIndex);
    }

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      PORTRAIT_ADDRESS_SCALE * 0.58,
    );
    const glowMaterial = makeAddressLineMaterial(3.2, 0.075);
    const coreMaterial = makeAddressLineMaterial(0.72, 0.46);
    const glow = new LineSegments2(geometry, glowMaterial);
    const core = new LineSegments2(geometry, coreMaterial);
    glow.frustumCulled = false;
    core.frustumCulled = false;
    glow.renderOrder = 10;
    core.renderOrder = 11;
    return {
      geometry,
      glowMaterial,
      coreMaterial,
      glow,
      core,
      baseColors: new Float32Array(colors),
      laneBySegment,
      segmentCount: positions.length / 6,
    };
  }, [encoding]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
    invalidate();
  }, [built, invalidate, size.height, size.width]);

  useEffect(() => {
    focusStartedAtRef.current = null;
    resolvedNotifiedRef.current = false;
    lastVisualFrameRef.current = null;
    invalidate();
  }, [contentFocused, encoding, invalidate, reducedMotion]);

  useFrame((state) => {
    if (contentFocused && focusStartedAtRef.current === null) {
      focusStartedAtRef.current = state.clock.elapsedTime;
    } else if (!contentFocused) {
      focusStartedAtRef.current = null;
    }
    const elapsedSeconds = focusStartedAtRef.current === null
      ? 0
      : state.clock.elapsedTime - focusStartedAtRef.current;
    const frame = cellContentAddressReadFrame(
      elapsedSeconds,
      contentFocused,
      reducedMotion,
    );
    const previousVisualFrame = lastVisualFrameRef.current;
    const visualChanged = previousVisualFrame === null
      || previousVisualFrame.state !== frame.state
      || previousVisualFrame.activeLane !== frame.activeLane
      || (
        frame.state === 'reading'
        && Math.abs(previousVisualFrame.laneProgress - frame.laneProgress)
          > 0.002
      );
    if (visualChanged) {
      const colorAttribute = built.geometry.getAttribute(
        'instanceColorStart',
      ) as THREE.InterleavedBufferAttribute | undefined;
      const colorArray = colorAttribute?.data.array as Float32Array | undefined;
      if (colorAttribute && colorArray) {
        for (let segment = 0; segment < built.segmentCount; segment += 1) {
          const energy = cellContentAddressLaneEnergy(
            frame,
            built.laneBySegment[segment],
          );
          const offset = segment * 6;
          for (let channel = 0; channel < 6; channel += 1) {
            colorArray[offset + channel] =
              built.baseColors[offset + channel] * energy;
          }
        }
        colorAttribute.data.needsUpdate = true;
      }
      built.glowMaterial.opacity = frame.state === 'reading'
        ? 0.13
        : frame.state === 'resolved' || frame.state === 'reduced'
          ? 0.09
          : 0.075;
      built.coreMaterial.opacity = frame.state === 'reading'
        ? 0.58
        : frame.state === 'resolved' || frame.state === 'reduced'
          ? 0.54
          : 0.46;
      lastVisualFrameRef.current = {
        state: frame.state,
        activeLane: frame.activeLane,
        laneProgress: frame.laneProgress,
      };
    }
    if (groupRef.current) {
      groupRef.current.userData.memoryPortraitAddressRead = frame.state;
      groupRef.current.userData.memoryPortraitAddressActiveLane =
        frame.activeLane ?? -1;
      groupRef.current.userData.memoryPortraitAddressReadCount =
        frame.readCount;
      groupRef.current.userData.memoryPortraitAddressReadProgress =
        frame.progress;
    }
    if (
      contentFocused
      && !resolvedNotifiedRef.current
      && (frame.state === 'resolved' || frame.state === 'reduced')
    ) {
      resolvedNotifiedRef.current = true;
      onReadResolvedRef.current?.();
    }
    // Demand-render only while this bounded proof is progressing. The old
    // portrait-wide frame driver kept the second WebGL renderer drawing.
    if (frame.state === 'reading') invalidate();
  });

  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={groupRef}
      scale={PORTRAIT_ADDRESS_SCALE}
      position={[0, 0, 0.32]}
      userData={{
        memoryPortraitContentAddress: encoding.fingerprint,
        memoryPortraitAddressSegments: built.segmentCount,
        memoryPortraitAddressRead: contentFocused
          ? reducedMotion ? 'reduced' : 'reading'
          : 'idle',
        memoryPortraitAddressActiveLane: -1,
        memoryPortraitAddressReadCount: contentFocused && reducedMotion ? 8 : 0,
        memoryPortraitAddressReadProgress:
          contentFocused && reducedMotion ? 1 : 0,
      }}
    >
      <primitive object={built.glow} />
      <primitive object={built.core} />
    </group>
  );
}
