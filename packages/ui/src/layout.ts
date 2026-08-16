import type { Vec3 } from './types';

// Layer stack runs chain → cells (top): the cells galaxy is the canopy of
// the scene and the chain mesh stays visible underneath it.
export const CHAIN_Y = 22;
/** Cell-tissue anchor plane immediately *above* the chain layer. Its points
 *  fold on y around this origin; the chain mesh remains visibly underneath. */
export const CELLS_Y = CHAIN_Y + 16;

/** Inner / outer radius bounds of the chain-node scatter (BEFORE
 *  the elliptical stretch is applied). The chain network is
 *  rendered larger than the ckbloom ring — that mesh sits at
 *  radius `12 + 4 * ckbloomCount` ≈ 28 for the mesh profile — and
 *  stays inside the irregular Cell-tissue footprint above. The min is
 *  tuned so the squashed-z effective radius (× CHAIN_ELLIPSE_Z)
 *  still clears the ckbloom mesh ring. */
const CHAIN_SCATTER_MIN_RADIUS = 34;
const CHAIN_SCATTER_MAX_RADIUS = 56;
/** Keep the chain network beneath the broad Cell-tissue footprint. */
const CHAIN_ELLIPSE_X = 1.25;
const CHAIN_ELLIPSE_Z = 0.85;

/** Small deterministic PRNG keyed by integer (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Fallback universe seed used before the backend's
 *  `ProfileSnapshot.universe_seed` arrives over the WS profile load,
 *  and in unit tests where there is no profile. Real universes come
 *  from the backend (persisted to `<workdir>/universe-seed`, KEEP=1
 *  reuses the prior seed). */
export const UNIVERSE_SEED_FALLBACK = 0xc0ffee;

/** Local-frame offset (relative to the chain anchor) of icosahedron
 *  `idx` inside a mesh of `count` chain nodes. For N=1 we keep a single
 *  node at the anchor origin. For N>1 each node lands at a deterministic
 *  scatter sample inside the
 *  [CHAIN_SCATTER_MIN_RADIUS, CHAIN_SCATTER_MAX_RADIUS] annulus, with
 *  area-uniform radial distribution and a golden-angle base azimuth
 *  jittered per-idx — yielding an irregular network that feels
 *  larger and looser than the ckbloom ring without ever clumping. */
function chainNodeLocalOffset(idx: number, count: number, seed: number): Vec3 {
  if (count <= 1) return [0, 0, 0];
  // Two independent seeds per idx so the radial and angular jitter
  // streams don't lock-step. Both fold in the universe seed so each
  // simulated universe gets its own layout, while every consumer
  // within a single universe sees identical positions.
  const rRand = mulberry32((idx * 0x9e3779b1 + count) ^ seed);
  const aRand = mulberry32(
    (idx * 0x85ebca77 + count * 13) ^ Math.imul(seed, 0xc2b2ae35),
  );
  // Area-uniform radius: r = sqrt(u) * (max - min) + min — biases
  // outward so the perimeter doesn't feel sparse.
  const u = rRand();
  const r =
    CHAIN_SCATTER_MIN_RADIUS +
    Math.sqrt(u) * (CHAIN_SCATTER_MAX_RADIUS - CHAIN_SCATTER_MIN_RADIUS);
  // Golden-angle base + uniform jitter spreads neighbours apart so
  // icosahedra don't cluster despite the random radii.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const angle = idx * GOLDEN + (aRand() - 0.5) * 0.9;
  // Vertical wobble in the chain plane to give the network mesh some
  // depth — a third of the radial scale, signed by the radial seed.
  const yWobble = (rRand() - 0.5) * 6;
  // The broad ellipse remains inside the organic tissue's outer lobes.
  const x = Math.cos(angle) * r * CHAIN_ELLIPSE_X;
  const z = Math.sin(angle) * r * CHAIN_ELLIPSE_Z;
  return [x, yWobble, z];
}

/** World-space position of chain node `idx` in a mesh of `count` nodes
 *  for a given universe seed. The chain anchor sits at (0, CHAIN_Y, 0);
 *  N=1 pins the icosahedron at the anchor; N>1 scatters across a wide
 *  annulus inside the cells-galaxy footprint (see `chainNodeLocalOffset`).
 *  Pass the same seed to every consumer so they agree on positions. */
export function chainNodeWorldPosition(
  idx: number,
  count: number,
  seed: number = UNIVERSE_SEED_FALLBACK,
): Vec3 {
  const [x, y, z] = chainNodeLocalOffset(idx, count, seed);
  return [x, CHAIN_Y + y, z];
}
