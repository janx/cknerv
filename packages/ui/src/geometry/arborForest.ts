// Grown-arbor VISUAL hierarchy for the cell fabric.
//
// Over the (unchanged) connected neighbour graph, grow a multi-seed spanning
// FOREST and weight each tree edge by its subtree size — a trunk that carries
// many descendants scores high, a terminal twig scores low. Feeding that into
// the fabric's existing per-edge `brightnessMul` turns the current *random*
// trunk/branch hierarchy into a REAL one, so the mesh reads as grown venation
// / dendrites rather than a uniform web.
//
// **Overlay only**: this derives weights, it does NOT touch graph adjacency,
// connectivity, or pulse routing. Multiple seeds (not one root) because the
// cell mesh as a whole is the "queen" — a distributed collective, not a
// hub-and-spoke around a single centre.
//
// Pure + deterministic: output is a function of the cell set + adjacency only.

export interface ArborCell {
  pos_seed: [number, number, number];
}

export interface ArborForestOptions {
  /** Number of forest roots (distributed hubs). */
  seedCount?: number;
}

/** Default distributed-hub count. */
export const DEFAULT_ARBOR_SEEDS = 14;

function dist2(a: ArborCell, b: ArborCell): number {
  const dx = a.pos_seed[0] - b.pos_seed[0];
  const dy = a.pos_seed[1] - b.pos_seed[1];
  const dz = a.pos_seed[2] - b.pos_seed[2];
  return dx * dx + dy * dy + dz * dz;
}

/** Farthest-point sampling for well-spread, deterministic seeds. First seed is
 *  the smallest id; each next is the cell farthest (max min-distance) from the
 *  chosen set, ties broken by smallest id. */
function farthestPointSeeds(
  ids: number[],
  cells: ReadonlyMap<number, ArborCell>,
  s: number,
): number[] {
  const sorted = [...ids].sort((a, b) => a - b);
  const seeds = [sorted[0]];
  if (s <= 1) return seeds;
  const chosen = new Set(seeds);
  const minD = new Map<number, number>();
  for (const id of sorted) minD.set(id, dist2(cells.get(id)!, cells.get(seeds[0])!));
  while (seeds.length < s) {
    let best = -1;
    let bestD = -Infinity;
    for (const id of sorted) {
      if (chosen.has(id)) continue;
      const d = minD.get(id)!;
      if (d > bestD) { bestD = d; best = id; } // strict > → smallest id wins ties
    }
    if (best < 0) break;
    seeds.push(best);
    chosen.add(best);
    const bc = cells.get(best)!;
    for (const id of sorted) {
      const d = dist2(cells.get(id)!, bc);
      if (d < minD.get(id)!) minD.set(id, d);
    }
  }
  return seeds;
}

/**
 * Per-edge trunkness in (0, 1], keyed canonically as `${lo}:${hi}` (matching
 * neighborGraph). Only forest (parent→child) edges appear; every other edge is
 * a twig for which the caller applies its own floor.
 */
export function buildArborForest(
  cells: ReadonlyMap<number, ArborCell>,
  adjacency: ReadonlyMap<number, ReadonlySet<number>>,
  opts?: ArborForestOptions,
): Map<string, number> {
  const ids: number[] = [];
  for (const id of adjacency.keys()) if (cells.has(id)) ids.push(id);
  if (ids.length === 0) return new Map();

  const s = Math.min(Math.max(1, opts?.seedCount ?? DEFAULT_ARBOR_SEEDS), ids.length);
  const seeds = farthestPointSeeds(ids, cells, s);

  // Multi-source BFS spanning forest. Neighbours visited in id order keeps the
  // parent assignment deterministic.
  const parent = new Map<number, number>();
  const visited = new Set<number>(seeds);
  const order: number[] = [...seeds];
  const queue: number[] = [...seeds];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const nbSet = adjacency.get(id);
    if (!nbSet) continue;
    const neighbours = [...nbSet].filter((n) => cells.has(n)).sort((a, b) => a - b);
    for (const nb of neighbours) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      parent.set(nb, id);
      order.push(nb);
      queue.push(nb);
    }
  }

  // Subtree sizes: children counted before parents by walking BFS order in
  // reverse (children always come after their parent in `order`).
  const size = new Map<number, number>();
  for (const id of order) size.set(id, 1);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const p = parent.get(id);
    if (p !== undefined) size.set(p, size.get(p)! + size.get(id)!);
  }

  let maxSize = 1;
  for (const child of parent.keys()) {
    const sz = size.get(child)!;
    if (sz > maxSize) maxSize = sz;
  }

  const weights = new Map<string, number>();
  for (const [child, p] of parent) {
    const lo = child < p ? child : p;
    const hi = child < p ? p : child;
    weights.set(`${lo}:${hi}`, Math.sqrt(size.get(child)! / maxSize));
  }
  return weights;
}
