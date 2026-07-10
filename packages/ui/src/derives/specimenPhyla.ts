// packages/ui/src/derives/specimenPhyla.ts
import { dendriteNucleus } from './dendriteNucleus';
import {
  type PhylumGeometry, type PhylumOpts, type NucNode, type Vec3,
  TAU, add, scale, len, dist, mid, randDir, randPerp, cross, seededRng, hashToBytes,
} from './specimenKit';

/** ARBOR (spore) — reuse the existing hash-grown dendrite unchanged. */
export function genArbor(seedHash: string, _opts: PhylumOpts): PhylumGeometry {
  const n = dendriteNucleus(seedHash);
  const nodes: NucNode[] = [
    ...n.cores.map((c) => ({ x: c.x, y: c.y, z: c.z, s: c.s, a: 1 })),
    ...n.glows.map((g) => ({ x: g.x, y: g.y, z: g.z, s: g.s, a: g.a })),
  ];
  const tips = n.cores.slice(1); // skip [0] hot centre
  const byDist = [...tips].sort((p, q) => (q.x * q.x + q.y * q.y + q.z * q.z) - (p.x * p.x + p.y * p.y + p.z * p.z));
  const at = (i: number): Vec3 => { const c = byDist[i] ?? { x: 0, y: 0, z: 0 }; return [c.x, c.y, c.z]; };
  return {
    segments: n.segments.slice(),
    nodes,
    membraneR: null,
    landmarks: { core: [0, 0, 0], species: at(0), outer: at(1), membrane: at(Math.floor(byDist.length / 2)) },
  };
}
