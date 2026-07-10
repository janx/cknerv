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

/** RADIOLARIAN (native) — membraned cell body + curved 3D filopodia. */
export function genRadiolarian(seedHash: string, opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash));
  const n = 9 + Math.floor(r() * 7);                 // floor 9 filopodia
  const membraneR = 0.28 + r() * 0.06;
  const segments: number[] = []; const nodes: NucNode[] = [];
  let species: Vec3 = [0, 0, 0], outer: Vec3 = [0, 0, 0], maxr = 0;
  for (let i = 0; i < n; i++) {
    const dir = randDir(r), perp = randPerp(r, dir);
    const reach = (0.55 + r() * 0.34) * (0.72 + 0.28 * opts.maturity);
    const steps = 5; let prev: Vec3 = scale(dir, membraneR * 0.5);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const p = add(scale(dir, membraneR * 0.5 + reach * t), scale(perp, Math.sin(t * Math.PI) * reach * 0.2 * (0.7 + r() * 0.6)));
      segments.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]); prev = p;
    }
    nodes.push({ x: prev[0], y: prev[1], z: prev[2], s: 0.05, a: 1 });
    if (i === 0) species = prev;
    if (len(prev) > maxr) { maxr = len(prev); outer = prev; }
  }
  nodes.push({ x: 0, y: 0, z: 0, s: 0.13, a: 0.9 });  // central body
  const membrane: Vec3 = scale(randDir(r), membraneR);
  return { segments, nodes, membraneR, landmarks: { core: [0, 0, 0], species, membrane, outer } };
}
