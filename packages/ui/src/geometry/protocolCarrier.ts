import * as THREE from 'three';

/**
 * Three interrupted contributor loops sharing one centre. This is the compact
 * block carrier used between the network and Cell field: open, woven, and
 * deliberately unlike a cube, crystal logo, or architectural object.
 */
export function makeProtocolCarrierGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const rotations = [
    new THREE.Euler(0.16, 0.08, 0.28),
    new THREE.Euler(Math.PI * 0.52, 0.34, -0.18),
    new THREE.Euler(0.44, Math.PI * 0.48, 0.22),
  ];
  const segments = 32;
  const point = (strand: number, t: number): THREE.Vector3 => (
    new THREE.Vector3(
      Math.cos(t) * 0.82,
      Math.sin(t) * 0.52,
      Math.sin(t * 3 + strand * 1.7) * 0.10,
    ).applyEuler(rotations[strand])
  );
  for (let strand = 0; strand < rotations.length; strand += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      // Each contributor loop has offset protocol gaps; their crossings remain
      // visible but never collapse into a solid crystal or building silhouette.
      if ((segment + strand * 4) % 12 < 2) continue;
      const a = point(strand, segment / segments * Math.PI * 2);
      const b = point(strand, (segment + 1) / segments * Math.PI * 2);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.05);
  return geometry;
}
