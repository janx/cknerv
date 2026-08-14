import * as THREE from 'three';

/**
 * ONE geometric vocabulary for the whole block handoff.
 *
 * The glyph a worker lifts and the front it releases into the Cell field are
 * the same interrupted polygon at two scales: the glyph is the seed of the
 * wave. That is what makes the event read as compression and release rather
 * than as two unrelated shapes meeting at the membrane. Both the carrier
 * geometry below and `materials/contactWaveMaterial` read these two numbers,
 * so the rim and the front can never drift into different vocabularies.
 */
export const CONTACT_RING_SIDES = 12;
export const CONTACT_RING_GAPS = 3;
/** Sides per gap period; every `GAP_EVERY`-th side is left open. */
export const CONTACT_RING_GAP_EVERY = CONTACT_RING_SIDES / CONTACT_RING_GAPS;

export const CARRIER_RIM_RADIUS = 1.0;
/** Three short trailing spurs give the flat rim a readable travel axis without
 *  adding a second concentric ring. */
export const CARRIER_KEEL_COUNT = 3;
export const CARRIER_KEEL_DEPTH = 0.34;
export const CARRIER_KEEL_INSET = 0.86;

const TAU = Math.PI * 2;
const CARRIER_LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

/** Align the glyph's local forward axis with a normalized peer-to-galaxy path.
 * The caller owns `target` and `direction`, so the frame loop allocates nothing.
 * Local +Z tracks travel, which lays local XY flat in the Cell plane — the same
 * orientation the released front needs. */
export function setProtocolCarrierFacing(
  target: THREE.Quaternion,
  direction: THREE.Vector3,
): THREE.Quaternion {
  return target.setFromUnitVectors(CARRIER_LOCAL_FORWARD, direction);
}

/** True when side `side` of the rim is one of the open gaps. */
export function isContactRingGap(side: number): boolean {
  return side % CONTACT_RING_GAP_EVERY === CONTACT_RING_GAP_EVERY - 1;
}

function appendSegment(
  positions: number[],
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
): void {
  positions.push(fromX, fromY, fromZ, toX, toY, toZ);
}

function appendInterruptedRim(positions: number[]): void {
  for (let side = 0; side < CONTACT_RING_SIDES; side += 1) {
    if (isContactRingGap(side)) continue;
    const fromAngle = side / CONTACT_RING_SIDES * TAU;
    const toAngle = (side + 1) / CONTACT_RING_SIDES * TAU;
    appendSegment(
      positions,
      Math.cos(fromAngle) * CARRIER_RIM_RADIUS,
      Math.sin(fromAngle) * CARRIER_RIM_RADIUS,
      0,
      Math.cos(toAngle) * CARRIER_RIM_RADIUS,
      Math.sin(toAngle) * CARRIER_RIM_RADIUS,
      0,
    );
  }
}

/** Keels hang off kept corners (1, 5, 9), never off a gap, so the open sides
 *  stay open and the silhouette keeps its three-fold break. */
function appendKeels(positions: number[]): void {
  for (let keel = 0; keel < CARRIER_KEEL_COUNT; keel += 1) {
    const corner = 1 + keel * CONTACT_RING_GAP_EVERY;
    const angle = corner / CONTACT_RING_SIDES * TAU;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    appendSegment(
      positions,
      x * CARRIER_RIM_RADIUS,
      y * CARRIER_RIM_RADIUS,
      0,
      x * CARRIER_RIM_RADIUS * CARRIER_KEEL_INSET,
      y * CARRIER_RIM_RADIUS * CARRIER_KEEL_INSET,
      -CARRIER_KEEL_DEPTH,
    );
  }
}

/**
 * The carrier glyph: one interrupted dodecagonal rim lying flat across the
 * travel axis, plus three short trailing keels. No canopy, no nested rings, no
 * decorative ribs — it is deliberately the compact form of the front it becomes
 * on contact, so the two halves of the event share one silhouette.
 */
export function makeProtocolCarrierGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  appendInterruptedRim(positions);
  appendKeels(positions);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.05);
  return geometry;
}
