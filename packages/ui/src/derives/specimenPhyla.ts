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

/** COLONY (sudt/xudt) — cluster of near-identical vesicle-cells + membrane necks. */
export function genColony(seedHash: string, opts: PhylumOpts): PhylumGeometry {
  const r = seededRng(hashToBytes(seedHash));
  const m = 7 + Math.floor(r() * 6);
  const ves: { p: Vec3; s: number }[] = [{ p: [0, 0, 0], s: 0.18 + r() * 0.05 }];
  for (let i = 1; i < m; i++) ves.push({ p: scale(randDir(r), 0.2 + r() * 0.5), s: 0.12 + r() * 0.07 });
  const segments: number[] = []; const nodes: NucNode[] = [];
  let neckMid: Vec3 = [0, 0, 0];
  for (let i = 1; i < ves.length; i++) {
    let bj = 0, bd = 1e9;
    for (let j = 0; j < i; j++) { const d = dist(ves[i].p, ves[j].p); if (d < bd) { bd = d; bj = j; } }
    segments.push(...ves[i].p, ...ves[bj].p);
    if (i === 1) neckMid = mid(ves[i].p, ves[bj].p);
  }
  let outer: Vec3 = ves[0].p, maxr = 0;
  for (const v of ves) { nodes.push({ x: v.p[0], y: v.p[1], z: v.p[2], s: v.s, a: 0.9 }); if (len(v.p) > maxr) { maxr = len(v.p); outer = v.p; } }
  return { segments, nodes, membraneR: 0.34, landmarks: { core: [0, 0, 0], species: outer, membrane: neckMid, outer } };
}
