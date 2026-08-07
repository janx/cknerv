import * as THREE from 'three';

export const PROTOCOL_FIELD_SIDES = 8;
export const PROTOCOL_FIELD_RING_RADII = [0.96, 0.66, 0.24] as const;

const TAU = Math.PI * 2;
const FIELD_ROTATION = Math.PI / PROTOCOL_FIELD_SIDES;
const FIELD_LOCAL_NORMAL = new THREE.Vector3(0, 0, 1);

/** Align the membrane's local face with a normalized peer→galaxy direction.
 * The caller owns `target` and `direction`, so the frame loop allocates nothing. */
export function setProtocolFieldFacing(
  target: THREE.Quaternion,
  direction: THREE.Vector3,
): THREE.Quaternion {
  return target.setFromUnitVectors(FIELD_LOCAL_NORMAL, direction);
}

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
 * Compact octagonal energy membrane for the block handoff between the peer
 * network and Cell field. Three clean rings and eight spars retain the
 * A.T.-Field reading without the previous honeycomb/facet noise. Small depth
 * offsets keep the membrane dimensional when it is viewed obliquely.
 */
export function makeProtocolCarrierGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const ringDepths = [-0.035, 0, 0.035] as const;

  for (let ring = 0; ring < PROTOCOL_FIELD_RING_RADII.length; ring += 1) {
    appendPolygon(
      positions,
      PROTOCOL_FIELD_SIDES,
      PROTOCOL_FIELD_RING_RADII[ring],
      FIELD_ROTATION,
      ringDepths[ring],
    );
  }

  for (let sector = 0; sector < PROTOCOL_FIELD_SIDES; sector += 1) {
    const angle = FIELD_ROTATION + sector / PROTOCOL_FIELD_SIDES * TAU;

    // Eight depth-crossing spars are enough to read as a pressure membrane;
    // leaving the sectors open keeps the moving carrier light and simple.
    appendSegment(
      positions,
      fieldPoint(PROTOCOL_FIELD_RING_RADII[2], angle, ringDepths[2]),
      fieldPoint(PROTOCOL_FIELD_RING_RADII[0], angle, ringDepths[0]),
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.05);
  return geometry;
}
