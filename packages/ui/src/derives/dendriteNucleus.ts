// dendriteNucleus — the per-cell identity NUCLEUS, grown from content_hash. The
// "fuller" look (curved branches + glowing seed-core mass + soft inner glow) with
// substance, PLUS strong per-cell MACRO variation so nuclei read as genuinely
// different: the hash drives arm count, branch depth/density, SYMMETRY (radial vs
// directional), reach, and curliness — not just fine jitter. Output is in LOCAL
// units where the crystal circumradius = 1; the renderer scales by the crystal
// radius so the nucleus sits inside the vessel.
//
// Pure + deterministic (no three.js) → unit-testable.

export interface NucCore { x: number; y: number; z: number; s: number }            // tight bright core (branch tip / hot centre)
export interface NucGlow { x: number; y: number; z: number; s: number; a: number } // soft glow sprite (seed-core mass / inner glow)
export interface DendriteNucleus {
  segments: number[];  // flat [ax,ay,az, bx,by,bz, ...] — tessellated curved branch segments
  cores: NucCore[];    // tight cores (CORE texture): [0] = hot centre, then branch tips
  glows: NucGlow[];    // soft mass (SOFT falloff): inner glow + layered seed-core
}

function hashToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(Math.floor(body.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
}
function seededRng(bytes: Uint8Array): () => number {
  let a = ((bytes[0] ?? 1) | ((bytes[1] ?? 2) << 8) | ((bytes[2] ?? 3) << 16) | ((bytes[3] ?? 4) << 24)) >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type V3 = [number, number, number];
const TAU = 6.28318530718;
const CURVE_SAMPLES = 5;   // tessellation of each curved branch
const SEG_BUDGET = 440;    // hard cap on branch segments (bounds density + buffer)

const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (v: V3): V3 => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Grow a fuller, hash-distinct dendrite nucleus. Local units, crystal radius = 1. */
export function dendriteNucleus(contentHash: string): DendriteNucleus {
  const r = seededRng(hashToBytes(contentHash));
  const randDir = (): V3 => { const th = r() * TAU; const z = r() * 2 - 1; const s = Math.sqrt(Math.max(0, 1 - z * z)); return [s * Math.cos(th), s * Math.sin(th), z]; };
  const randPerp = (dir: V3): V3 => { let v: V3; do { v = randDir(); } while (Math.abs(v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) > 0.9); return norm(cross(v, dir)); };
  const bez = (a: V3, c: V3, b: V3, t: number): V3 => { const u = 1 - t; const k0 = u * u, k1 = 2 * u * t, k2 = t * t; return [k0 * a[0] + k1 * c[0] + k2 * b[0], k0 * a[1] + k1 * c[1] + k2 * b[1], k0 * a[2] + k1 * c[2] + k2 * b[2]]; };
  // a direction within a cone of half-angle `half` around `axis` (narrow = directional, ~π = radial)
  const inCone = (axis: V3, half: number): V3 => {
    const cosA = Math.cos(half);
    const z = cosA + (1 - cosA) * r();
    const phi = r() * TAU;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const local: V3 = [s * Math.cos(phi), s * Math.sin(phi), z];
    const ref: V3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ref, axis));
    const v = cross(axis, u);
    return [u[0] * local[0] + v[0] * local[1] + axis[0] * local[2], u[1] * local[0] + v[1] * local[1] + axis[1] * local[2], u[2] * local[0] + v[2] * local[1] + axis[2] * local[2]];
  };

  // ---- MACRO parameters (drive the overall shape → nuclei look distinct) ----
  const arms = 4 + Math.floor(r() * 6);          // 4..9 primary arms
  const maxDepth = 1 + Math.floor(r() * 3);      // 1..3 branch tiers (sparse ↔ dense)
  const kidsLo = 1 + Math.floor(r() * 2);        // 1..2
  const kidsHi = kidsLo + Math.floor(r() * 3);   // kidsLo..kidsLo+2  (linear ↔ bushy)
  const reach = 0.26 + r() * 0.16;               // primary length (compact ↔ sprawling)
  const decay = 0.56 + r() * 0.16;               // per-tier shortening
  const curl = 0.05 + r() * 0.32;                // branch curvature (straight ↔ curly)
  const cone = 0.9 + r() * 2.2;                  // half-angle: directional tuft ↔ full radial
  const axis = randDir();                        // orientation of the arm spread

  const segments: number[] = [];
  const cores: NucCore[] = [];
  const seg = (a: V3, b: V3) => { segments.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
  let maxD = 0.001;

  const grow = (start: V3, dir: V3, length: number, depth: number) => {
    if (segments.length / 6 > SEG_BUDGET) return;
    const perp = randPerp(dir);
    const end = add(start, scale(dir, length));
    const ctrl = add(add(start, scale(dir, length * 0.5)), scale(perp, length * curl * (0.6 + r() * 0.8)));
    let prev = start;
    for (let i = 1; i <= CURVE_SAMPLES; i++) { const p = bez(start, ctrl, end, i / CURVE_SAMPLES); seg(prev, p); prev = p; }
    cores.push({ x: end[0], y: end[1], z: end[2], s: depth >= maxDepth ? 0.062 : 0.05 });
    maxD = Math.max(maxD, len(end));
    if (depth >= maxDepth) return;
    const kids = kidsLo + Math.floor(r() * (kidsHi - kidsLo + 1));
    for (let k = 0; k < kids; k++) {
      const nd = norm(add(dir, scale(randPerp(dir), Math.tan(0.35 + r() * 0.5))));
      grow(end, nd, length * decay, depth + 1);
    }
  };

  for (let i = 0; i < arms; i++) grow([0, 0, 0], inCone(axis, cone), reach + r() * 0.05, 0);

  // contain within the vessel (branch tips → 0.82 of the crystal radius)
  if (maxD > 0.82) {
    const k = 0.82 / maxD;
    for (let i = 0; i < segments.length; i++) segments[i] *= k;
    for (const c of cores) { c.x *= k; c.y *= k; c.z *= k; }
  }

  cores.unshift({ x: 0, y: 0, z: 0, s: 0.06 + r() * 0.03 }); // hot centre (slight size variation)
  const mass = 0.82 + r() * 0.42;                            // per-cell seed-core mass scale
  const glows: NucGlow[] = [
    { x: 0, y: 0, z: 0, s: 0.60 * mass, a: 0.14 },
    { x: 0, y: 0, z: 0, s: 0.34 * mass, a: 0.40 },
    { x: 0, y: 0, z: 0, s: 0.18 * mass, a: 0.62 },
  ];
  return { segments, cores, glows };
}
