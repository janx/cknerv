import * as THREE from 'three';

export const JELLYFISH_BELL_SEGMENTS = 24;
export const JELLYFISH_BELL_RIBS = 7;
export const JELLYFISH_BELL_PROFILE = [
  { radius: 0.98, depth: -0.20, scallop: 0.055 },
  { radius: 0.78, depth: 0.01, scallop: 0.025 },
  { radius: 0.48, depth: 0.22, scallop: 0.010 },
  { radius: 0.16, depth: 0.36, scallop: 0.000 },
] as const;

const TAU = Math.PI * 2;
const BELL_RIB_ROTATION = Math.PI / JELLYFISH_BELL_RIBS;
const CARRIER_LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

/** Align the bell's local forward axis with a normalized peer-to-galaxy path.
 * The caller owns `target` and `direction`, so the frame loop allocates nothing. */
export function setProtocolCarrierFacing(
  target: THREE.Quaternion,
  direction: THREE.Vector3,
): THREE.Quaternion {
  return target.setFromUnitVectors(CARRIER_LOCAL_FORWARD, direction);
}

/** 0 to 1 umbrella opening used by the carrier's jellyfish swim cycle. */
export function protocolCarrierBellPulse(phase: number): number {
  return 0.5 + 0.5 * Math.sin(phase);
}

/** 0 to 1 age of the pressure ring shed at maximum bell contraction. */
export function protocolCarrierShockwaveProgress(phase: number): number {
  const cyclesSinceContraction = phase / TAU - 0.75;
  return cyclesSinceContraction - Math.floor(cyclesSinceContraction);
}

function bellPoint(
  radius: number,
  depth: number,
  scallop: number,
  angle: number,
): THREE.Vector3 {
  const fluidRadius = radius * (
    1 + scallop * Math.cos(angle * JELLYFISH_BELL_RIBS)
  );
  return new THREE.Vector3(
    Math.cos(angle) * fluidRadius,
    Math.sin(angle) * fluidRadius,
    depth,
  );
}

function appendSegment(
  positions: number[],
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
}

function appendBellRing(
  positions: number[],
  radius: number,
  depth: number,
  scallop: number,
): void {
  for (let segment = 0; segment < JELLYFISH_BELL_SEGMENTS; segment += 1) {
    const fromAngle = segment / JELLYFISH_BELL_SEGMENTS * TAU;
    const toAngle = (segment + 1) / JELLYFISH_BELL_SEGMENTS * TAU;
    appendSegment(
      positions,
      bellPoint(radius, depth, scallop, fromAngle),
      bellPoint(radius, depth, scallop, toAngle),
    );
  }
}

/**
 * Rounded, shallow umbrella for the block handoff between the peer network and
 * Cell galaxy. Four smooth latitude loops describe the dome; seven curved ribs
 * follow its profile into a subtly scalloped skirt. There is no flat barrier,
 * central aperture, or polygonal shield silhouette.
 */
export function makeProtocolCarrierGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const ring of JELLYFISH_BELL_PROFILE) {
    appendBellRing(
      positions,
      ring.radius,
      ring.depth,
      ring.scallop,
    );
  }

  for (let rib = 0; rib < JELLYFISH_BELL_RIBS; rib += 1) {
    const angle = BELL_RIB_ROTATION + rib / JELLYFISH_BELL_RIBS * TAU;
    for (let profile = 0; profile < JELLYFISH_BELL_PROFILE.length - 1; profile += 1) {
      const outer = JELLYFISH_BELL_PROFILE[profile];
      const inner = JELLYFISH_BELL_PROFILE[profile + 1];
      appendSegment(
        positions,
        bellPoint(outer.radius, outer.depth, outer.scallop, angle),
        bellPoint(inner.radius, inner.depth, inner.scallop, angle),
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.12);
  return geometry;
}
