import * as THREE from 'three';

export const PROTOCOL_FIELD_SIDES = 8;
export const PROTOCOL_FIELD_RING_RADII = [0.96, 0.78, 0.53, 0.25] as const;

const TAU = Math.PI * 2;
const FIELD_ROTATION = Math.PI / PROTOCOL_FIELD_SIDES;

function fieldPoint(
  radius: number,
  angle: number,
  z: number,
  centerX = 0,
  centerY = 0,
): THREE.Vector3 {
  return new THREE.Vector3(
    centerX + Math.cos(angle) * radius,
    centerY + Math.sin(angle) * radius,
    z,
  );
}

function appendSegment(
  positions: number[],
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
}

function appendPolygon(
  positions: number[],
  sides: number,
  radius: number,
  rotation: number,
  z: number,
  centerX = 0,
  centerY = 0,
): void {
  for (let side = 0; side < sides; side += 1) {
    const fromAngle = rotation + side / sides * TAU;
    const toAngle = rotation + (side + 1) / sides * TAU;
    appendSegment(
      positions,
      fieldPoint(radius, fromAngle, z, centerX, centerY),
      fieldPoint(radius, toAngle, z, centerX, centerY),
    );
  }
}

/**
 * Layered octagonal energy membrane for the block handoff between the peer
 * network and Cell field. Concentric plates, radial braces, and small hexagonal
 * facets create the unmistakable orange sci-fi barrier silhouette once the
 * runtime carrier colour and screen-space glow are applied. The slight depth
 * offsets keep it dimensional without allowing the plane to turn edge-on.
 */
export function makeProtocolCarrierGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const ringDepths = [-0.045, -0.01, 0.035, 0.08] as const;

  for (let ring = 0; ring < PROTOCOL_FIELD_RING_RADII.length; ring += 1) {
    appendPolygon(
      positions,
      PROTOCOL_FIELD_SIDES,
      PROTOCOL_FIELD_RING_RADII[ring],
      FIELD_ROTATION,
      ringDepths[ring],
    );
  }

  // An outer echo makes the shield read as a membrane rather than one wire
  // polygon, even when the billboard bloom is partially occluded by Cells.
  appendPolygon(
    positions,
    PROTOCOL_FIELD_SIDES,
    0.89,
    FIELD_ROTATION,
    -0.025,
  );

  for (let sector = 0; sector < PROTOCOL_FIELD_SIDES; sector += 1) {
    const angle = FIELD_ROTATION + sector / PROTOCOL_FIELD_SIDES * TAU;
    const nextAngle = FIELD_ROTATION + (sector + 1) / PROTOCOL_FIELD_SIDES * TAU;
    const midpointAngle = (angle + nextAngle) / 2;

    // Eight depth-crossing ribs hold the concentric plates together.
    appendSegment(
      positions,
      fieldPoint(PROTOCOL_FIELD_RING_RADII[3], angle, ringDepths[3]),
      fieldPoint(PROTOCOL_FIELD_RING_RADII[0], angle, ringDepths[0]),
    );

    // Alternating triangular braces break up the rings into energetic facets.
    appendSegment(
      positions,
      fieldPoint(PROTOCOL_FIELD_RING_RADII[2], angle, ringDepths[2]),
      fieldPoint(PROTOCOL_FIELD_RING_RADII[1], midpointAngle, ringDepths[1]),
    );
    appendSegment(
      positions,
      fieldPoint(PROTOCOL_FIELD_RING_RADII[1], midpointAngle, ringDepths[1]),
      fieldPoint(PROTOCOL_FIELD_RING_RADII[2], nextAngle, ringDepths[2]),
    );

    // Small honeycomb cells in the annulus make the field feel like a tiled
    // barrier instead of a targeting reticle.
    const facetRadius = 0.655;
    const facetCenter = fieldPoint(facetRadius, midpointAngle, 0.018);
    appendPolygon(
      positions,
      6,
      0.105,
      midpointAngle + Math.PI / 6,
      facetCenter.z + (sector % 2 === 0 ? 0.012 : -0.012),
      facetCenter.x,
      facetCenter.y,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.05);
  return geometry;
}
