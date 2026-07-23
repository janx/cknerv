import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  cellContentAddressLaneEnergy,
  cellContentAddressReadFrame,
  deriveCellContentAddressFacets,
  type CellContentAddressEncoding,
} from '../../derives/cellContentAddress.derive';

const FACET_SEGMENTS = 5;
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
}: {
  encoding: CellContentAddressEncoding;
  contentFocused: boolean;
  reducedMotion: boolean;
}) {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);
  const focusStartedAtRef = useRef<number | null>(null);
  const lastVisualFrameRef = useRef<{
    state: string;
    activeLane: number | null;
    laneProgress: number;
  } | null>(null);
  const built = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const laneBySegment: number[] = [];
    const facets = deriveCellContentAddressFacets(encoding);
    const pushSegment = (
      from: readonly [number, number, number],
      to: readonly [number, number, number],
      color: readonly [number, number, number],
      laneIndex: number,
      energy = 1,
    ) => {
      positions.push(...from, ...to);
      colors.push(
        color[0] * energy,
        color[1] * energy,
        color[2] * energy,
        color[0] * energy,
        color[1] * energy,
        color[2] * energy,
      );
      laneBySegment.push(laneIndex);
    };

    for (const facet of facets) {
      for (let segment = 0; segment < FACET_SEGMENTS; segment += 1) {
        const fromUnit = segment / FACET_SEGMENTS;
        const toUnit = (segment + 1) / FACET_SEGMENTS;
        const fromAngle = facet.angle
          + THREE.MathUtils.lerp(-facet.halfSpan, facet.halfSpan, fromUnit);
        const toAngle = facet.angle
          + THREE.MathUtils.lerp(-facet.halfSpan, facet.halfSpan, toUnit);
        pushSegment(
          [
            Math.cos(fromAngle) * facet.radius,
            Math.sin(fromAngle) * facet.radius,
            0,
          ],
          [
            Math.cos(toAngle) * facet.radius,
            Math.sin(toAngle) * facet.radius,
            0,
          ],
          facet.color,
          facet.index,
        );
      }
      if (facet.hasSpine) {
        const innerRadius = 0.38;
        pushSegment(
          [
            Math.cos(facet.angle) * innerRadius,
            Math.sin(facet.angle) * innerRadius,
            0,
          ],
          [
            Math.cos(facet.angle) * (facet.radius + 0.025),
            Math.sin(facet.angle) * (facet.radius + 0.025),
            0,
          ],
          facet.color,
          facet.index,
          0.72,
        );
      }
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
