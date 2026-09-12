import { beforeAll, describe, expect, it } from 'vitest';

import {
  BRIDGE_ANCHOR_PREFIX,
  BRIDGE_ANCHOR_REACH,
  BRIDGE_ANCHOR_SEPARATION,
  BRIDGE_BUDGET,
  BRIDGE_DUST_COMPONENT,
  BRIDGE_MAX_HOST_DEGREE,
  bridgeKey,
  bridgesForDegree,
  buildBridgeAnchorIndex,
  createBridgeSelectionJob,
  createBridgeHostRegistry,
  createBridgeHostSyncJob,
  planHostBridges,
  runBridgeSelectionJobSlice,
  stepBridgeHostSyncJob,
  selectBridgeEdges,
  stepBridgeSelectionJob,
  syncBridgeHosts,
  type BridgeAnchorIndex,
  type BridgeHostCell,
  type BridgeHostPlan,
  type BridgeHostSourceCell,
} from '../../src/geometry/bridgeEdges';
import {
  placePopulationField,
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
  populationSegmentsForPointPrefix,
} from '../../src/geometry/populationFieldPlacement';
import { helixSeedF64 } from '../../src/helix';

/** The REAL placement, at the seed the app ships. Built once — it is a 170 ms
 *  pass — and every assertion below that says "measured" was measured on it. */
let index: BridgeAnchorIndex;
let placedCount = 0;
let placedSegments = 0;

/** A staged field with the same positional law the app uses. Degrees are
 *  supplied by the caller so a test can pin the host ladder directly. */
function stagedCells(
  count: number,
  degreeOf: (id: number) => number = () => 0,
  firstId = 1,
): BridgeHostCell[] {
  const cells: BridgeHostCell[] = [];
  for (let n = 0; n < count; n += 1) {
    const id = firstId + n;
    const [x, y, z] = helixSeedF64(id);
    cells.push({ id, x, y, z, degree: degreeOf(id) });
  }
  return cells;
}

/** One staged Cell the real placement actually hosts — degree 0, in the mixed
 *  band, with halo in reach. Found rather than assumed, because the coverage
 *  gate is a property of the tissue and not of an id. */
function hostedCell(): BridgeHostCell {
  const cells = stagedCells(3000);
  const selection = selectBridgeEdges(cells, index);
  const wanted = selection.bridges.find((bridge) => selection.bridges
    .filter((other) => other.cellId === bridge.cellId).length > 1)!;
  return cells.find((cell) => cell.id === wanted.cellId)!;
}

beforeAll(() => {
  const placed = placePopulationField(
    POPULATION_FIELD_POINTS,
    POPULATION_FIELD_SEED,
  );
  placedCount = placed.count;
  placedSegments = placed.segmentCount;
  index = buildBridgeAnchorIndex({
    positions: placed.positions,
    weights: placed.weights,
    segments: placed.segments,
    count: placed.count,
    segmentCount: placed.segmentCount,
  });
});

describe('bridge anchor index', () => {
  it('bounds the anchor prefix at the lowest preset share of the placement', () => {
    expect(index.limit).toBe(Math.floor(placedCount * BRIDGE_ANCHOR_PREFIX));
    expect(index.prefixSegments).toBe(populationSegmentsForPointPrefix(
      index.field.segments,
      placedSegments,
      index.limit,
    ));
  });

  it('carries the whole field in that prefix, at every radius', () => {
    // The claim the prefix rule rests on: the walk seeds by rejection
    // sampling against the density law rather than sweeping, so early indices
    // are scattered everywhere and an anchor exists wherever the halo does.
    // Measured over eight radial bands of the real placement, the prefix's
    // share of the points in each band is 0.238-0.271 against a nominal 0.25.
    //
    // ⚠️ The POPULATION FILTER is scale-relative, and it used to be a flat 100
    // points. That let the outermost band — 245 of 105,000 placed points,
    // 0.23% of the layer, out past the 99th-percentile radius the containment
    // test calls the halo's edge — into a 0.2–0.3 interval its own binomial
    // spread is ±2.7 wide. It sat at 0.2247 before the halo's length and fork
    // ramps, one standard deviation from failing on nothing but the draw, and
    // the ramps pushed it to 0.143: fork-born points are ALWAYS later in the
    // buffer than their parents, so raising the fork rate in thin ground moves
    // that tail's points later by construction. The effect is real and it is
    // recorded here rather than absorbed — what is not defensible is gating on
    // a statistic whose noise is as wide as the gate. At 2% of the layer the
    // spread is ±0.008 and the interval means something. Bridges cannot reach
    // there in any case: every host is a staged Cell inside the resolved rim
    // and BRIDGE_ANCHOR_REACH is a few world units.
    const bands = 8;
    const full = new Array<number>(bands).fill(0);
    const prefix = new Array<number>(bands).fill(0);
    for (let i = 0; i < placedCount; i += 1) {
      const x = index.field.positions[i * 3];
      const z = index.field.positions[i * 3 + 2];
      const radial = Math.hypot(x / 60, z / 54);
      const band = Math.min(bands - 1, Math.floor((radial / 1.8) * bands));
      full[band] += 1;
      if (i < index.limit) prefix[band] += 1;
    }
    let asserted = 0;
    for (let band = 0; band < bands; band += 1) {
      if (full[band] < placedCount * 0.02) continue;
      asserted += 1;
      const share = prefix[band] / full[band];
      expect(share).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.3);
    }
    // Six of the eight bands clear 2%, and between them they hold 98% of the
    // placed points — so the filter is a tail cut and not an escape hatch.
    expect(asserted).toBeGreaterThanOrEqual(6);
  });

  it('sizes components over the prefix only, so the number survives every preset', () => {
    // Every point reachable from a point by prefix segments must report the
    // same size, and that size must be at least the number of points on the
    // walk of that component.
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      if (seen.has(seed)) continue;
      const stack = [seed];
      const members = new Set<number>();
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (members.has(node)) continue;
        members.add(node);
        const start = index.incidentStart[node];
        const end = index.incidentStart[node + 1];
        for (let slot = start; slot < end; slot += 1) {
          const segment = index.incidentSegments[slot];
          const a = index.field.segments[segment * 2];
          const b = index.field.segments[segment * 2 + 1];
          stack.push(a === node ? b : a);
        }
      }
      for (const member of members) {
        seen.add(member);
        expect(index.componentSize[member]).toBe(members.size);
      }
    }
  });
});

describe('bridge selection', () => {
  it('resumes at operation boundaries and publishes only the complete canonical result', () => {
    const cells = stagedCells(3000, (id) => id % 4, 2 ** 52);
    const expected = selectBridgeEdges(cells, index, { budget: 180 });
    const job = createBridgeSelectionJob([...cells].reverse(), index, { budget: 180 });
    let slices = 0;
    while (job.phase !== 'done') {
      const progress = stepBridgeSelectionJob(job, 17);
      expect(progress.operations).toBeLessThanOrEqual(17);
      if (!progress.done) expect(job.result).toBeNull();
      slices += 1;
    }
    expect(slices).toBeGreaterThan(10);
    expect(job.result).toEqual(expected);
  });

  it('checks an injected wall clock between selector quanta', () => {
    const job = createBridgeSelectionJob(stagedCells(3000), index, { budget: 180 });
    let tick = 0;
    const first = runBridgeSelectionJobSlice(job, 2, () => {
      tick += 0.25;
      return tick;
    });
    expect(first.done).toBe(false);
    expect(first.elapsedMs).toBeGreaterThanOrEqual(2);
    expect(first.operations).toBeGreaterThan(0);
    expect(job.result).toBeNull();
  });

  it('never anchors past the lowest preset draw range', () => {
    const selection = selectBridgeEdges(stagedCells(4000), index);
    expect(selection.bridges.length).toBeGreaterThan(0);
    const hardLimit = Math.floor(placedCount * BRIDGE_ANCHOR_PREFIX);
    for (const bridge of selection.bridges) {
      expect(bridge.anchorIndex).toBeLessThan(hardLimit);
      if (bridge.anchorSegment < 0) continue;
      // The landing rides a SEGMENT, so its far endpoint has to be inside the
      // prefix too or the fibre it lands on is itself trimmed away.
      const a = index.field.segments[bridge.anchorSegment * 2];
      const b = index.field.segments[bridge.anchorSegment * 2 + 1];
      expect(Math.max(a, b)).toBeLessThan(hardLimit);
      expect(bridge.anchorSegment).toBeLessThan(index.prefixSegments);
    }
  });

  it('keeps every stroke inside the local hand-off reach', () => {
    const selection = selectBridgeEdges(stagedCells(4000), index);
    for (const bridge of selection.bridges) {
      const anchorDistance = Math.hypot(
        index.field.positions[bridge.anchorIndex * 3] - bridge.fromX,
        index.field.positions[bridge.anchorIndex * 3 + 2] - bridge.fromZ,
      );
      expect(anchorDistance).toBeLessThanOrEqual(BRIDGE_ANCHOR_REACH + 1e-6);
    }
  });

  it('gives the same answer whatever order the Cells arrive in', () => {
    const cells = stagedCells(3000, (id) => id % 4);
    const forward = selectBridgeEdges(cells, index);
    const reversed = selectBridgeEdges([...cells].reverse(), index);
    // A Map is the production carrier, and its iteration order is insertion
    // order — so a different staging sequence is a different iteration order.
    const shuffled = new Map<number, BridgeHostCell>();
    for (let step = 0; step < cells.length; step += 1) {
      shuffled.set(
        cells[(step * 977) % cells.length].id,
        cells[(step * 977) % cells.length],
      );
    }
    const viaMap = selectBridgeEdges(shuffled.values(), index);

    expect(reversed.bridges).toEqual(forward.bridges);
    expect(viaMap.bridges).toEqual(forward.bridges);
  });

  it('honours the per-host ladder and the global budget', () => {
    const cells = stagedCells(6000, (id) => id % 5);
    const selection = selectBridgeEdges(cells, index);
    expect(selection.bridges.length).toBeLessThanOrEqual(BRIDGE_BUDGET);

    const perHost = new Map<number, number>();
    const degreeOf = new Map(cells.map((cell) => [cell.id, cell.degree]));
    for (const bridge of selection.bridges) {
      perHost.set(bridge.cellId, (perHost.get(bridge.cellId) ?? 0) + 1);
    }
    for (const [id, drawn] of perHost) {
      const degree = degreeOf.get(id)!;
      expect(degree).toBeLessThanOrEqual(BRIDGE_MAX_HOST_DEGREE);
      expect(drawn).toBeGreaterThanOrEqual(1);
      expect(drawn).toBeLessThanOrEqual(bridgesForDegree(degree));
      expect(drawn).toBeLessThanOrEqual(3);
    }
  });

  it('spends the budget on breadth before any host gets a second stroke', () => {
    const cells = stagedCells(6000);
    const selection = selectBridgeEdges(cells, index, { budget: 90 });
    const perHost = new Map<number, number>();
    for (const bridge of selection.bridges) {
      perHost.set(bridge.cellId, (perHost.get(bridge.cellId) ?? 0) + 1);
    }
    // 90 bridges at breadth 0.6 = 54 hosts, then 36 top-ups.
    expect(perHost.size).toBe(54);
    expect(selection.bridges.length).toBe(90);
  });

  it('separates one host own anchors so no landing gathers its strokes', () => {
    const selection = selectBridgeEdges(stagedCells(4000), index);
    const byHost = new Map<number, { x: number; z: number }[]>();
    for (const bridge of selection.bridges) {
      const list = byHost.get(bridge.cellId) ?? [];
      list.push({ x: bridge.toX, z: bridge.toZ });
      byHost.set(bridge.cellId, list);
    }
    for (const landings of byHost.values()) {
      for (let a = 0; a < landings.length; a += 1) {
        for (let b = a + 1; b < landings.length; b += 1) {
          expect(Math.hypot(
            landings[a].x - landings[b].x,
            landings[a].z - landings[b].z,
          )).toBeGreaterThanOrEqual(BRIDGE_ANCHOR_SEPARATION - 1e-6);
        }
      }
    }
  });

  it('prefers long filaments over dust, measurably', () => {
    const selection = selectBridgeEdges(stagedCells(4000), index);
    const chosenDust = selection.bridges
      .filter((bridge) => bridge.componentSize < BRIDGE_DUST_COMPONENT)
      .length / selection.bridges.length;

    let prefixDust = 0;
    for (let i = 0; i < index.limit; i += 1) {
      if (index.componentSize[i] < BRIDGE_DUST_COMPONENT) prefixDust += 1;
    }
    const baselineDust = prefixDust / index.limit;

    // Measured on the real placement: 8.7% of chosen anchors sit on dust
    // against a 19.4% prefix baseline. The margin is what the tier ranking
    // buys; the absolute is bounded by BRIDGE_ANCHOR_POOL_MIN, which trades
    // some of it away to stop strokes converging.
    //
    // Both numbers moved with the halo's tissue-keyed length and fork ramps,
    // and only one of them moved for a reason: the prefix baseline is flat
    // (19.3% -> 19.4%, the placement's own dust share is unchanged) while the
    // chosen share improved 10.6% -> 8.7%, because the ramps break the outer
    // bands' long components into more, smaller ones and the ranking therefore
    // finds a non-dust anchor near more hosts. The ratio goes 1.83x -> 2.23x.
    //
    // ⚠️⚠️ The halo's anastomosis joins then moved the BASELINE, and the
    // margin here is measured against it — so a change that makes the layer
    // better makes this assertion harder. Joins merge prefix components, so
    // the prefix's own dust share fell 19.5% -> 16.0% while the chosen share
    // sat at 12.1%, and the ratio fell 2.10x -> 1.33x with nothing about the
    // ranking having got worse.
    //
    // ⚠️ It is worse than that: this instrument is NOISY across placement
    // seeds, and the shipped seed happened to be its best draw. Measured over
    // five seeds on this test's own recipe, chosen dust runs 0.083 / 0.138 /
    // 0.139 / 0.143 / 0.131 without joins (ratios 2.36 / 1.44 / 1.38 / 1.38 /
    // 1.51) and 0.132 / 0.105 / 0.121 / 0.104 / 0.093 with them (1.22 / 1.66 /
    // 1.23 / 1.64 / 1.74). The joins IMPROVE the chosen share on average —
    // 0.127 -> 0.111 — and improve the baseline more, which is the whole of
    // why the ratio fell. So the ratio bound is set at the worst of those ten
    // draws with a little room, and an ABSOLUTE bound is added beside it,
    // because that is the one a better layer cannot make harder to pass.
    expect(baselineDust).toBeGreaterThan(0.15);
    expect(chosenDust).toBeLessThan(baselineDust * 0.85);
    expect(chosenDust).toBeLessThan(0.15);
  });

  it('lands on a fibre rather than on a placed vertex', () => {
    const selection = selectBridgeEdges(stagedCells(4000), index);
    const onFibre = selection.bridges
      .filter((bridge) => bridge.anchorSegment >= 0).length;
    expect(onFibre / selection.bridges.length).toBeGreaterThan(0.95);
    for (const bridge of selection.bridges) {
      if (bridge.anchorSegment < 0) continue;
      const ax = index.field.positions[bridge.anchorIndex * 3];
      const az = index.field.positions[bridge.anchorIndex * 3 + 2];
      // Off the vertex that selected it, by construction — the landing
      // parameter starts at BRIDGE_LANDING_MIN.
      expect(Math.hypot(bridge.toX - ax, bridge.toZ - az)).toBeGreaterThan(0);
    }
  });

  it('carries a 2^52-range composition id through unchanged', () => {
    // ⚠️ Cell ids span the sequential-small range AND the 2^52 range galaxy
    // composition mints. A 32-bit pack anywhere in the selection would alias
    // these two ids into one host — same identity, same hash, same anchors.
    // Both are placed at the SAME position so nothing but the id can differ.
    const seat = hostedCell();
    const big = Number.MAX_SAFE_INTEGER - 3;
    const alias = big >>> 0;
    const cells: BridgeHostCell[] = [
      { ...seat, id: big },
      { ...seat, id: alias },
    ];
    const selection = selectBridgeEdges(cells, index);
    const byId = new Map<number, number[]>();
    for (const bridge of selection.bridges) {
      byId.set(bridge.cellId, [
        ...(byId.get(bridge.cellId) ?? []),
        bridge.anchorIndex,
      ]);
    }
    expect(byId.get(big)?.length).toBeGreaterThan(0);
    expect(byId.get(alias)?.length).toBeGreaterThan(0);
    expect(byId.get(big)).not.toEqual(byId.get(alias));
    expect(bridgeKey(big, 7)).toBe(`${big}#7`);
    expect(bridgeKey(big, 7)).not.toBe(bridgeKey(alias, 7));
  });

  it('drops only the removed host and leaves the survivors byte-identical', () => {
    const cells = stagedCells(3000);
    const before = selectBridgeEdges(cells, index);
    const victim = before.bridges[17].cellId;
    const after = selectBridgeEdges(
      cells.filter((cell) => cell.id !== victim),
      index,
    );

    expect(after.bridges.some((bridge) => bridge.cellId === victim)).toBe(false);
    const survivors = new Map(
      after.bridges.map((bridge) => [bridgeKey(bridge.cellId, bridge.anchorIndex), bridge]),
    );
    let compared = 0;
    for (const bridge of before.bridges) {
      if (bridge.cellId === victim) continue;
      const survivor = survivors.get(bridgeKey(bridge.cellId, bridge.anchorIndex));
      if (survivor === undefined) continue; // pushed past the budget cut line
      expect(survivor).toEqual(bridge);
      compared += 1;
    }
    // The removal frees exactly its own strokes, so essentially the whole set
    // is re-verified rather than a handful of it.
    expect(compared).toBeGreaterThan(before.bridges.length - 10);
  });

  it('plans a host identically however many of its strokes the budget draws', () => {
    // The invariant the two-pass budget rests on: the k-th bridge of a host
    // is a pure function of (cell, halo, k), so a smaller budget draws a
    // PREFIX of the same plan and never re-targets a stroke already drawn.
    const cell = hostedCell();
    const plan = planHostBridges(cell, index);
    expect(plan.length).toBeGreaterThan(1);
    const wide = selectBridgeEdges([cell], index);
    const narrow = selectBridgeEdges([cell], index, { budget: 1 });
    expect(wide.bridges).toEqual(plan);
    expect(narrow.bridges).toEqual(plan.slice(0, 1));
  });

  it('excludes Cells the drawn fabric already reaches', () => {
    const cells = stagedCells(3000, (id) => (id % 2 === 0 ? 0 : 9));
    const selection = selectBridgeEdges(cells, index);
    expect(selection.bridges.length).toBeGreaterThan(0);
    for (const bridge of selection.bridges) {
      expect(bridge.cellId % 2).toBe(0);
    }
  });

  it('reuses a cached plan only while the host degree is unchanged', () => {
    const cells = stagedCells(400, () => 0);
    const cache = new Map();
    const cold = selectBridgeEdges(cells, index, { planCache: cache });
    const warm = selectBridgeEdges(cells, index, { planCache: cache });
    expect(warm.bridges).toEqual(cold.bridges);

    const promoted = cells.map((cell) => ({ ...cell, degree: 1 }));
    const revised = selectBridgeEdges(promoted, index, { planCache: cache });
    const uncached = selectBridgeEdges(promoted, index);
    expect(revised.bridges).toEqual(uncached.bridges);
    // Degree 1 wants two strokes, degree 0 wants three, so a stale cache
    // would show up as the old count.
    expect(revised.bridges.length).not.toBe(cold.bridges.length);
  });

  it('places nothing when the halo has not landed', () => {
    const empty = buildBridgeAnchorIndex({
      positions: new Float32Array(0),
      weights: new Float32Array(0),
      segments: new Uint32Array(0),
      count: 0,
      segmentCount: 0,
    });
    const selection = selectBridgeEdges(stagedCells(50), empty);
    expect(selection.bridges).toEqual([]);
    expect(selection.hosts).toBe(0);
  });

  it('keeps a cached plan across a hit instead of re-recording it', () => {
    const cells = stagedCells(400);
    const cache = new Map<number, BridgeHostPlan>();
    selectBridgeEdges(cells, index, { planCache: cache });
    const recorded = new Map(cache);
    expect(recorded.size).toBeGreaterThan(0);
    selectBridgeEdges(cells, index, { planCache: cache });
    // A hit used to re-set the same entry — one allocation per planned host
    // per build for nothing. Identity proves it no longer does.
    for (const [id, entry] of cache) expect(entry).toBe(recorded.get(id));
  });
});

describe('resumable bridge host sync', () => {
  it('keeps the published registry unchanged until a complete generation lands', () => {
    const registry = createBridgeHostRegistry();
    const initial = stagedCells(20);
    const initialMap = new Map(initial.map((cell) => [cell.id, {
      id: cell.id, death_at_ms: null, pos_seed: [cell.x, cell.y, cell.z] as const,
    }]));
    syncBridgeHosts(registry, initialMap, []);
    const published = registry.hosts;
    const nextMap = new Map(initialMap);
    nextMap.delete(1);
    const id = 2 ** 52;
    const [x, y, z] = helixSeedF64(id);
    nextMap.set(id, { id, death_at_ms: null, pos_seed: [x, y, z] as const });
    const job = createBridgeHostSyncJob(registry, nextMap, []);
    expect(stepBridgeHostSyncJob(job, 5).done).toBe(false);
    // ⚠️ The registry is one Map for the life of the layer now — the records
    // persist, which is the whole of what the cursor costs nothing for. What
    // "unchanged" means is therefore what a READER sees: the departure has
    // not been applied, and no host answers at a degree this build counted.
    expect(registry.hosts).toBe(published);
    expect(registry.hosts.has(1)).toBe(true);
    expect(registry.hosts.get(1)!.degree).toBe(0);
    // A superseding cursor can discard this partial job without rollback.
    const replacement = createBridgeHostSyncJob(registry, nextMap, []);
    while (!stepBridgeHostSyncJob(replacement, 7).done) {}
    expect(registry.hosts.has(1)).toBe(false);
    expect(registry.hosts.has(id)).toBe(true);
    expect(registry.hosts.get(id)!.degree).toBe(0);
  });

  it('reads one immutable stage publication across all sync slices', () => {
    const registry = createBridgeHostRegistry();
    const staged = new Map<number, BridgeHostSourceCell>([
      [1, { id: 1, death_at_ms: null, pos_seed: [1, 2, 3] }],
      [2, { id: 2, death_at_ms: null, pos_seed: [4, 5, 6] }],
    ]);
    const published = [...staged.values()];
    const job = createBridgeHostSyncJob(registry, published, []);
    expect(stepBridgeHostSyncJob(job, 1).done).toBe(false);

    // A newer cache generation patches its stage map while this older graph
    // is still landing. The job owns the prior immutable render-set array.
    staged.delete(2);
    staged.set(3, { id: 3, death_at_ms: null, pos_seed: [7, 8, 9] });
    while (!stepBridgeHostSyncJob(job, 1).done) {}

    expect([...registry.hosts.keys()]).toEqual([1, 2]);
  });
});

describe('bridge host registry', () => {
  /** A staged map plus the drawn edges that give each Cell its degree: a
   *  Cell of degree d is wired to d partner ids that are not on the stage,
   *  so the partners' own degrees reach nothing. */
  function stage(cells: readonly BridgeHostCell[]): {
    map: Map<number, BridgeHostSourceCell>;
    edges: { from: number; to: number }[];
  } {
    const map = new Map<number, BridgeHostSourceCell>();
    const edges: { from: number; to: number }[] = [];
    for (const c of cells) {
      map.set(c.id, { id: c.id, death_at_ms: null, pos_seed: [c.x, c.y, c.z] });
      for (let k = 0; k < c.degree; k += 1) edges.push({ from: c.id, to: 1e9 + k });
    }
    return { map, edges };
  }

  function source(cell: BridgeHostCell): BridgeHostSourceCell {
    return { id: cell.id, death_at_ms: null, pos_seed: [cell.x, cell.y, cell.z] };
  }

  it('reports movement only for what the selection reads', () => {
    const cells = stagedCells(400, (id) => id % 5);
    const registry = createBridgeHostRegistry();
    const { map, edges } = stage(cells);
    // The first build is all arrivals.
    expect(syncBridgeHosts(registry, map, edges)).toBe(true);
    expect(registry.hosts.size).toBe(400);
    // The same stage against the same fabric is the steady state.
    expect(syncBridgeHosts(registry, map, edges)).toBe(false);

    // A degree that moves INSIDE the excluded range is not movement: a Cell
    // at 3 and one at 4 are the same non-candidate. The record still carries
    // the exact degree — it is the rung that is judged.
    const excluded = cells.find((c) => c.degree === 3)!;
    const within = [...edges, { from: excluded.id, to: 1e9 + 50 }];
    expect(syncBridgeHosts(registry, map, within)).toBe(false);
    expect(registry.hosts.get(excluded.id)!.degree).toBe(4);
    // Crossing the ceiling is, in both directions.
    const rim = cells.find((c) => c.degree === BRIDGE_MAX_HOST_DEGREE)!;
    const crossed = [...within, { from: rim.id, to: 1e9 + 60 }];
    expect(syncBridgeHosts(registry, map, crossed)).toBe(true);
    expect(syncBridgeHosts(registry, map, within)).toBe(true);
    // So is a move between candidate rungs — the sort key and the ladder.
    const bare = cells.find((c) => c.degree === 0)!;
    const promoted = [...within, { from: bare.id, to: 1e9 + 70 }];
    expect(syncBridgeHosts(registry, map, promoted)).toBe(true);
    expect(syncBridgeHosts(registry, map, within)).toBe(true);

    // An arrival at an excluded degree changes nothing the selection sees;
    // the same Cell dropping to a candidate degree does.
    const newcomer: BridgeHostCell = { id: 777_777, ...seat(777_777), degree: 3 };
    const arrivals = new Map(map);
    arrivals.set(newcomer.id, source(newcomer));
    const wired = [...within, ...stage([newcomer]).edges];
    expect(syncBridgeHosts(registry, arrivals, wired)).toBe(false);
    expect(registry.hosts.has(newcomer.id)).toBe(true);
    expect(syncBridgeHosts(registry, arrivals, within)).toBe(true);

    // A departure — off the map, or dead on it — is movement exactly when
    // the Cell was a candidate, judged at the degree the last build saw.
    const gone = new Map(arrivals);
    gone.delete(newcomer.id);
    expect(syncBridgeHosts(registry, gone, within)).toBe(true);
    expect(registry.hosts.has(newcomer.id)).toBe(false);
    const dying = new Map(gone);
    dying.set(bare.id, { ...gone.get(bare.id)!, death_at_ms: 5 });
    expect(syncBridgeHosts(registry, dying, within)).toBe(true);
    expect(registry.hosts.has(bare.id)).toBe(false);
    const four = cells.find((c) => c.degree === 4)!;
    const fewer = new Map(dying);
    fewer.delete(four.id);
    expect(syncBridgeHosts(registry, fewer, within)).toBe(false);
    expect(registry.hosts.has(four.id)).toBe(false);

    // ⚠️ A departure and an arrival in the same build leave the map the same
    // size; the registry still sees both.
    const swapped = new Map(fewer);
    const leaver = cells.find((c) => c.degree === 1)!;
    swapped.delete(leaver.id);
    const replacement: BridgeHostCell = { id: 888_888, ...seat(888_888), degree: 0 };
    swapped.set(replacement.id, source(replacement));
    expect(syncBridgeHosts(registry, swapped, within)).toBe(true);
    expect(registry.hosts.has(leaver.id)).toBe(false);
    expect(registry.hosts.has(replacement.id)).toBe(true);
    // The registry is the LIVING stage: the dead-but-uncollected Cell above
    // is still on the map and has no record.
    expect(registry.hosts.size).toBe(
      [...swapped.values()].filter((c) => c.death_at_ms == null).length,
    );
  });

  it('feeds the selection the same answer a fresh host list gives, across churn', () => {
    const cells = stagedCells(3000, (id) => id % 4);
    const registry = createBridgeHostRegistry();
    const planCache = new Map<number, BridgeHostPlan>();
    const coverageCache = new Map<number, number>();
    const { map, edges } = stage(cells);
    expect(syncBridgeHosts(registry, map, edges)).toBe(true);
    const first = selectBridgeEdges(registry.hosts.values(), index, { planCache, coverageCache });
    expect(first.bridges).toEqual(selectBridgeEdges(cells, index).bridges);
    expect(first.bridges.length).toBeGreaterThan(0);

    // One selected host leaves, one bare Cell arrives, one selected host
    // gains a drawn fibre: the shape of a membership block.
    const victim = first.bridges[5].cellId;
    const promotedId = first.bridges.find(
      (bridge) => bridge.cellId !== victim
        && cells.find((c) => c.id === bridge.cellId)!.degree === 0,
    )!.cellId;
    const next: BridgeHostCell[] = cells
      .filter((c) => c.id !== victim)
      .map((c) => (c.id === promotedId ? { ...c, degree: 1 } : c));
    next.push({ id: 4_000_001, ...seat(4_000_001), degree: 0 });
    const churned = stage(next);
    expect(syncBridgeHosts(registry, churned.map, churned.edges)).toBe(true);
    const revised = selectBridgeEdges(registry.hosts.values(), index, { planCache, coverageCache });
    expect(revised.bridges).toEqual(selectBridgeEdges(next, index).bridges);
    expect(revised.bridges).not.toEqual(first.bridges);
    // And the block after that, with nothing moved, is not a selection at all
    // — the caller's skip — which the registry says in one word.
    expect(syncBridgeHosts(registry, churned.map, churned.edges)).toBe(false);
  });
});

function seat(id: number): { x: number; y: number; z: number } {
  const [x, y, z] = helixSeedF64(id);
  return { x, y, z };
}
