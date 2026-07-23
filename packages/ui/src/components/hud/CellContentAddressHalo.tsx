import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
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
 * A static inner horizon shared by every portrait direction. Consensus motion
 * stays behind it; these cuts only identify the Cell content being inspected.
 */
export default function CellContentAddressHalo({
  encoding,
}: {
  encoding: CellContentAddressEncoding;
}) {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const built = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const facets = deriveCellContentAddressFacets(encoding);
    const pushSegment = (
      from: readonly [number, number, number],
      to: readonly [number, number, number],
      color: readonly [number, number, number],
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
      segmentCount: positions.length / 6,
    };
  }, [encoding]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
    invalidate();
  }, [built, invalidate, size.height, size.width]);

  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);

  return (
    <group
      scale={PORTRAIT_ADDRESS_SCALE}
      position={[0, 0, 0.32]}
      userData={{
        memoryPortraitContentAddress: encoding.fingerprint,
        memoryPortraitAddressSegments: built.segmentCount,
      }}
    >
      <primitive object={built.glow} />
      <primitive object={built.core} />
    </group>
  );
}
