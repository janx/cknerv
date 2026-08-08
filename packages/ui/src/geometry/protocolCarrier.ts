import * as THREE from 'three';

export const JELLYFISH_BELL_SIDES = 12;
export const JELLYFISH_BELL_ARCHES = 3;
export const JELLYFISH_BELL_ARCH_SEGMENTS = 6;
export const JELLYFISH_BELL_RIM_RADIUS = 0.98;
export const JELLYFISH_BELL_RIM_DEPTH = -0.20;
export const JELLYFISH_BELL_CROWN_DEPTH = 0.40;

const TAU = Math.PI * 2;
const BELL_RIM_ROTATION = Math.PI / JELLYFISH_BELL_SIDES;
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

function appendBrokenRim(positions: number[]): void {
  for (let side = 0; side < JELLYFISH_BELL_SIDES; side += 1) {
    // Three evenly spaced breathing gaps prevent the skirt from collapsing
    // back into a closed shield silhouette.
    if (side % 4 === 3) continue;
    const fromAngle = BELL_RIM_ROTATION + side / JELLYFISH_BELL_SIDES * TAU;
    const toAngle = BELL_RIM_ROTATION + (side + 1) / JELLYFISH_BELL_SIDES * TAU;
    appendSegment(
      positions,
      Math.cos(fromAngle) * JELLYFISH_BELL_RIM_RADIUS,
      Math.sin(fromAngle) * JELLYFISH_BELL_RIM_RADIUS,
      JELLYFISH_BELL_RIM_DEPTH,
      Math.cos(toAngle) * JELLYFISH_BELL_RIM_RADIUS,
      Math.sin(toAngle) * JELLYFISH_BELL_RIM_RADIUS,
      JELLYFISH_BELL_RIM_DEPTH,
    );
  }
}

function appendDomeArch(positions: number[], angle: number): void {
  const xAxis = Math.cos(angle);
  const yAxis = Math.sin(angle);
  for (let segment = 0; segment < JELLYFISH_BELL_ARCH_SEGMENTS; segment += 1) {
    const fromSpan = -1 + 2 * segment / JELLYFISH_BELL_ARCH_SEGMENTS;
    const toSpan = -1 + 2 * (segment + 1) / JELLYFISH_BELL_ARCH_SEGMENTS;
    const fromDepth = JELLYFISH_BELL_RIM_DEPTH
      + (JELLYFISH_BELL_CROWN_DEPTH - JELLYFISH_BELL_RIM_DEPTH)
      * (1 - fromSpan * fromSpan);
    const toDepth = JELLYFISH_BELL_RIM_DEPTH
      + (JELLYFISH_BELL_CROWN_DEPTH - JELLYFISH_BELL_RIM_DEPTH)
      * (1 - toSpan * toSpan);
    appendSegment(
      positions,
      xAxis * fromSpan * JELLYFISH_BELL_RIM_RADIUS,
      yAxis * fromSpan * JELLYFISH_BELL_RIM_RADIUS,
      fromDepth,
      xAxis * toSpan * JELLYFISH_BELL_RIM_RADIUS,
      yAxis * toSpan * JELLYFISH_BELL_RIM_RADIUS,
      toDepth,
    );
  }
}

/**
 * Minimal low-poly umbrella for the block handoff. One interrupted dodecagonal
 * skirt and three six-segment arches carry the whole silhouette: the arches
 * rise 0.6 world units out of the skirt plane, so the result remains a canopy
 * instead of a flat field glyph. There are no nested rings or decorative ribs.
 */
export function makeProtocolCarrierGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  appendBrokenRim(positions);
  for (let arch = 0; arch < JELLYFISH_BELL_ARCHES; arch += 1) {
    appendDomeArch(
      positions,
      BELL_RIM_ROTATION + arch / JELLYFISH_BELL_ARCHES * Math.PI,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.05);
  return geometry;
}
