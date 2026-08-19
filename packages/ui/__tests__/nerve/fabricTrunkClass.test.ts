import { describe, expect, it } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { helixSeedF64 } from '../../src/helix';
import {
  buildNeighborGraph,
  type NeighborEdge,
  type NeighborGraphCell,
} from '../../src/geometry/neighborGraph';
import {
  buildPassiveNeighborGraph,
  NERVE_SCREEN_BUDGET,
} from '../../src/geometry/passiveNeighborGraph';
import {
  FABRIC_TRUNK_NO_ARBOR,
  FABRIC_TRUNK_PASS_MESH,
  FABRIC_TRUNK_PASS_TRUNK,
  FABRIC_TRUNK_SHARE,
  FABRIC_TRUNK_THRESHOLD_DISABLED,
  FABRIC_TRUNK_WIDTH_CEILING_PX,
  FABRIC_TRUNK_WIDTH_RATIO,
  fabricEdgeTrunkness,
  fabricTrunkLineWidth,
  fabricTrunkPassDraws,
  fabricTrunkTier,
} from '../../src/nerve/fabricTrunkClass';
import {
  enableFabricLifecycleMaterial,
  setFabricTrunkThreshold,
} from '../../src/nerve/fabricLifecycleShader';
import {
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_TRUNKNESS_OFFSET,
  makeFabricLifecycleArrays,
  writeFabricLifecycleSlot,
  type FabricLifecycleRecord,
} from '../../src/nerve/fabricLifecycleSlots';
import { FABRIC_SAMPLES_PER_EDGE } from '../../src/nerve/fabricCapacity';
import {
  enableLineInspectionTransitionMaterial,
  optimizeScreenSpaceCapsuleMaterial,
} from '../../src/geometry/screenSpaceCapsuleLine';
import { makeFabricTrunkPass, makeFatLineLayer } from '../../src/nerve/NeuralFabric';
import { cellDetailFabricWidthScale } from '../../src/derives/sceneView.derive';
import { neverRaycast } from '../../src/components/CellPopulationField';

/** Default width knobs (tweakSchema): the rungs the ladder is composed on. */
const FABRIC_WIDTH_PX = 2.5;
const ACTIVE_WIDTH_PX = 3.4;

function arborEdge(from: number, to: number, w: number): NeighborEdge {
  return { from, to, d: 1, w };
}

function crossLink(from: number, to: number): NeighborEdge {
  return { from, to, d: 1 };
}

describe('fabric trunk tier — selection', () => {
  it('is deterministic and independent of the order edges arrive in', () => {
    const edges = Array.from({ length: 400 }, (_, i) => (
      i % 5 === 0
        ? crossLink(i, i + 1)
        : arborEdge(i, i + 1, (i % 97 + 1) / 97)
    ));
    const forward = fabricTrunkTier(edges);
    const shuffled = [...edges].reverse();
    // A second, independent permutation — the tier is a function of the
    // multiset of weights, not of the builder's emission order.
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = (i * 7 + 13) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    expect(fabricTrunkTier([...edges].reverse())).toEqual(forward);
    expect(fabricTrunkTier(shuffled)).toEqual(forward);
    // And stable across repeated calls on the same input.
    expect(fabricTrunkTier(edges)).toEqual(forward);
  });

  it('promotes the requested share of the DRAWN selection on a clean spread', () => {
    // 1,000 distinct weights, no ties: the threshold can land exactly.
    const edges = Array.from(
      { length: 1_000 },
      (_, i) => arborEdge(i, i + 1, (i + 1) / 1_000),
    );
    const tier = fabricTrunkTier(edges);
    expect(tier.edges).toBe(125);
    expect(tier.share).toBeCloseTo(FABRIC_TRUNK_SHARE, 10);
    expect(tier.threshold).toBeCloseTo(0.876, 10);
    for (const edge of edges) {
      const promoted = fabricEdgeTrunkness(edge.w) >= tier.threshold;
      expect(promoted).toBe(edge.w! >= 0.876 - 1e-12);
    }
  });

  it('counts cross-links in the denominator but never promotes one', () => {
    // Half the drawn selection has no arbor at all — the classic mixed
    // passive selection (the real one is 5,907 arbor / 2,093 cross-links).
    const edges: NeighborEdge[] = [];
    for (let i = 0; i < 500; i += 1) edges.push(arborEdge(i, i + 1, (i + 1) / 500));
    for (let i = 0; i < 500; i += 1) edges.push(crossLink(10_000 + i, 10_001 + i));
    const tier = fabricTrunkTier(edges);
    // 12.5% of 1,000 drawn = 125 promoted, all of them from the 500 arbor.
    expect(tier.edges).toBe(125);
    expect(tier.share).toBeCloseTo(0.125, 10);
    expect(tier.threshold).toBeGreaterThan(0);
    for (const edge of edges) {
      if (edge.w !== undefined) continue;
      expect(fabricEdgeTrunkness(edge.w)).toBe(FABRIC_TRUNK_NO_ARBOR);
      expect(
        fabricTrunkPassDraws(
          fabricEdgeTrunkness(edge.w),
          tier.threshold,
          FABRIC_TRUNK_PASS_TRUNK,
        ),
      ).toBe(false);
    }
  });

  it('every derived threshold is strictly positive, so a zeroed lane is mesh', () => {
    for (const share of [0.05, 0.125, 0.5, 0.999, 1]) {
      const edges = Array.from(
        { length: 200 },
        (_, i) => arborEdge(i, i + 1, (i + 1) / 200),
      );
      const tier = fabricTrunkTier(edges, share);
      expect(tier.threshold).toBeGreaterThan(0);
      // A slot record that was never written holds 0 in every lane.
      expect(
        fabricTrunkPassDraws(0, tier.threshold, FABRIC_TRUNK_PASS_TRUNK),
      ).toBe(false);
    }
  });

  it('disables itself rather than guessing on an empty or arbor-less selection', () => {
    expect(fabricTrunkTier([])).toEqual({
      threshold: FABRIC_TRUNK_THRESHOLD_DISABLED, edges: 0, share: 0,
    });
    expect(fabricTrunkTier([crossLink(1, 2), crossLink(2, 3)])).toEqual({
      threshold: FABRIC_TRUNK_THRESHOLD_DISABLED, edges: 0, share: 0,
    });
    expect(fabricTrunkTier([arborEdge(1, 2, 0.9)], 0)).toEqual({
      threshold: FABRIC_TRUNK_THRESHOLD_DISABLED, edges: 0, share: 0,
    });
    // The disabled sentinel sits above every attainable weight.
    expect(FABRIC_TRUNK_THRESHOLD_DISABLED).toBeGreaterThan(1);
  });

  it('breaks a tied run toward the target instead of overshooting it', () => {
    // 100 edges: 30 tied at 0.5, the rest strictly below. A 12.5% target
    // (12.5 → 13) sits INSIDE the tie, which `>=` cannot split: promoting
    // the run gives 30, stopping above it gives 0. 30 is closer, so 30 wins.
    const edges: NeighborEdge[] = [];
    for (let i = 0; i < 30; i += 1) edges.push(arborEdge(i, i + 1, 0.5));
    for (let i = 0; i < 70; i += 1) edges.push(arborEdge(100 + i, 101 + i, 0.1));
    const tier = fabricTrunkTier(edges);
    expect(tier.edges).toBe(30);
    expect(tier.threshold).toBe(0.5);

    // With a distinct rung above the tie, the closer side is taken instead:
    // target 13, tie of 30 at 0.5 vs 10 at 0.9 → 10.
    const withRung: NeighborEdge[] = [];
    for (let i = 0; i < 10; i += 1) withRung.push(arborEdge(i, i + 1, 0.9));
    for (let i = 0; i < 30; i += 1) withRung.push(arborEdge(200 + i, 201 + i, 0.5));
    for (let i = 0; i < 60; i += 1) withRung.push(arborEdge(300 + i, 301 + i, 0.1));
    const rungTier = fabricTrunkTier(withRung);
    expect(rungTier.edges).toBe(10);
    expect(rungTier.threshold).toBe(0.9);
  });

  it('never packs a cell id: 2^52-range ids select exactly as small ones do', () => {
    // Cell ids span sequential-small AND 2^52 ckbadger composition ranges.
    // The tier reads `w` only, so the two must agree edge for edge.
    const base = 2 ** 52;
    const small = Array.from(
      { length: 300 },
      (_, i) => arborEdge(i, i + 1, ((i * 37) % 300 + 1) / 300),
    );
    const huge = small.map((edge) => arborEdge(
      base + edge.from,
      base + edge.to,
      edge.w!,
    ));
    // The 32-bit trap: these ids collide once truncated.
    expect((base + 1) | 0).toBe((base + 1 + 2 ** 32) | 0);
    const smallTier = fabricTrunkTier(small);
    const hugeTier = fabricTrunkTier(huge);
    expect(hugeTier).toEqual(smallTier);
    const promoted = (edges: NeighborEdge[], threshold: number) => edges
      .filter((e) => fabricEdgeTrunkness(e.w) >= threshold)
      .map((e) => e.w);
    expect(promoted(huge, hugeTier.threshold))
      .toEqual(promoted(small, smallTier.threshold));
    expect(hugeTier.edges).toBeGreaterThan(0);
  });
});

describe('fabric trunk tier — the AUTO composition profile', () => {
  it('records what the tier promotes on 12,000 Cells / 8,000 drawn edges', () => {
    const cells = new Map<number, NeighborGraphCell>();
    for (let id = 1; id <= 12_000; id += 1) {
      cells.set(id, { id, death_at_ms: null, pos_seed: helixSeedF64(id) });
    }
    const passive = buildPassiveNeighborGraph(buildNeighborGraph(cells));
    const drawn = passive.edges;
    const arbor = drawn.filter((edge) => edge.w !== undefined);
    expect(drawn).toHaveLength(NERVE_SCREEN_BUDGET);
    // The measured composition this phase is tuned against. If these move,
    // the tier's share has to be re-measured, not the assertion relaxed.
    expect(arbor).toHaveLength(5_907);

    const tier = fabricTrunkTier(drawn);
    expect(tier.edges).toBe(1_014);
    expect(tier.threshold).toBeCloseTo(0.16511, 5);
    expect(tier.share).toBeCloseTo(0.1268, 4);
    // Inside the 10–15% the design allows, and inside the ≤5K subset budget.
    expect(tier.share).toBeGreaterThanOrEqual(0.10);
    expect(tier.share).toBeLessThanOrEqual(0.15);
    expect(tier.edges * FABRIC_SAMPLES_PER_EDGE).toBeLessThanOrEqual(5_000);

    // Every promoted edge is a real forest edge carrying a subtree.
    for (const edge of drawn) {
      if (fabricEdgeTrunkness(edge.w) < tier.threshold) continue;
      expect(edge.w).toBeGreaterThan(0);
    }
  });
});

describe('fabric trunk tier — the light policy is a partition', () => {
  it('draws every edge in exactly one pass, so summed light is 1.0x', () => {
    const thresholds = [0.05, 0.16511, 0.5, 0.9, 1, FABRIC_TRUNK_THRESHOLD_DISABLED];
    const trunkness = [
      FABRIC_TRUNK_NO_ARBOR, 0, 1e-6, 0.05, 0.16511, 0.5, 0.9, 1,
    ];
    for (const threshold of thresholds) {
      for (const w of trunkness) {
        const mesh = fabricTrunkPassDraws(w, threshold, FABRIC_TRUNK_PASS_MESH);
        const wide = fabricTrunkPassDraws(w, threshold, FABRIC_TRUNK_PASS_TRUNK);
        // Exclusive OR: never both (which would roughly double the edge's
        // light under the near-additive screen accumulation) and never
        // neither (which would drop it out of the fabric entirely).
        expect(mesh).not.toBe(wide);
        const summed = (mesh ? 1 : 0) + (wide ? 1 : 0);
        expect(summed).toBe(1);
      }
    }
  });

  it('the promoted set is exactly what the mesh pass stops drawing', () => {
    const edges = Array.from(
      { length: 800 },
      (_, i) => (i % 4 === 0
        ? crossLink(i, i + 1)
        : arborEdge(i, i + 1, ((i * 13) % 601 + 1) / 601)),
    );
    const tier = fabricTrunkTier(edges);
    const wide = edges.filter((edge) => fabricTrunkPassDraws(
      fabricEdgeTrunkness(edge.w), tier.threshold, FABRIC_TRUNK_PASS_TRUNK,
    ));
    const mesh = edges.filter((edge) => fabricTrunkPassDraws(
      fabricEdgeTrunkness(edge.w), tier.threshold, FABRIC_TRUNK_PASS_MESH,
    ));
    expect(wide).toHaveLength(tier.edges);
    expect(wide.length + mesh.length).toBe(edges.length);
    expect(new Set([...wide, ...mesh]).size).toBe(edges.length);
  });

  it('the resting tier draws exactly the pre-tier picture', () => {
    for (const w of [FABRIC_TRUNK_NO_ARBOR, 0, 0.5, 1]) {
      expect(fabricTrunkPassDraws(
        w, FABRIC_TRUNK_THRESHOLD_DISABLED, FABRIC_TRUNK_PASS_MESH,
      )).toBe(true);
      expect(fabricTrunkPassDraws(
        w, FABRIC_TRUNK_THRESHOLD_DISABLED, FABRIC_TRUNK_PASS_TRUNK,
      )).toBe(false);
    }
  });
});

describe('fabric trunk tier — width ordering', () => {
  it('stays strictly under the pulse at every camera, worst case included', () => {
    const overview = cellDetailFabricWidthScale(0);
    const closest = cellDetailFabricWidthScale(1);
    expect(overview).toBe(1);
    expect(closest).toBeCloseTo(1.22, 10);

    // Overview: 2.5 × 1.28 = 3.2 px — the design's rung.
    expect(fabricTrunkLineWidth(FABRIC_WIDTH_PX, overview)).toBeCloseTo(3.2, 10);
    // Worst case, closest camera: the uncapped product would be
    // 2.5 × 1.28 × 1.22 = 3.904 px, which overtakes the 3.4 px pulse. The
    // ceiling holds it at 3.3.
    expect(FABRIC_WIDTH_PX * FABRIC_TRUNK_WIDTH_RATIO * closest)
      .toBeCloseTo(3.904, 10);
    const worst = fabricTrunkLineWidth(FABRIC_WIDTH_PX, closest);
    expect(worst).toBeCloseTo(FABRIC_TRUNK_WIDTH_CEILING_PX, 10);
    expect(worst).toBeLessThanOrEqual(3.3);
    expect(worst).toBeLessThan(ACTIVE_WIDTH_PX);

    // Monotone across the whole camera range, always above the mesh rung
    // (which takes the SAME focus factor) and always under the pulse.
    let previous = 0;
    for (let step = 0; step <= 40; step += 1) {
      const scale = cellDetailFabricWidthScale(step / 40);
      const mesh = FABRIC_WIDTH_PX * scale;
      const wide = fabricTrunkLineWidth(FABRIC_WIDTH_PX, scale);
      expect(wide).toBeGreaterThanOrEqual(mesh);
      expect(wide).toBeLessThanOrEqual(FABRIC_TRUNK_WIDTH_CEILING_PX);
      expect(wide).toBeLessThan(ACTIVE_WIDTH_PX);
      expect(wide).toBeGreaterThanOrEqual(previous);
      previous = wide;
    }
  });

  it('keeps the ladder monotone when the width knob is dragged off-scale', () => {
    // fabricWidth tops out at 8 px, where the whole ladder is off-scale and
    // only the ORDER still has to survive: the wide rung is never thinner
    // than the mesh rung it is drawn against.
    for (const width of [0.5, 1, 2.5, 3.3, 4, 8]) {
      for (const focus of [0, 0.5, 1]) {
        const scale = cellDetailFabricWidthScale(focus);
        expect(fabricTrunkLineWidth(width, scale))
          .toBeGreaterThanOrEqual(width * scale);
      }
    }
  });
});

describe('fabric trunk tier — lifecycle parity', () => {
  const record = (
    overrides: Partial<FabricLifecycleRecord> = {},
  ): FabricLifecycleRecord => ({
    fromX: 1, fromY: 2, fromZ: 3,
    ctrlX: 4, ctrlY: 5, ctrlZ: 6,
    toX: 7, toY: 8, toZ: 9,
    fromR: 0.1, fromG: 0.2, fromB: 0.3,
    toR: 0.4, toG: 0.5, toB: 0.6,
    bornAt: 10,
    dyingAt: null,
    deathKind: null,
    deadEnd: null,
    growDir: 1,
    brightnessMul: 0.8,
    trunkness: FABRIC_TRUNK_NO_ARBOR,
    ...overrides,
  });

  it('a promoted edge bakes the same lifecycle vec4s a mesh edge would', () => {
    // Promotion is one lane. Grow/decay/death, colour, span, aperture and the
    // inspection snapshots are the same records, which is why the wide pass
    // needs no bake of its own: it reads this one.
    const segments = FABRIC_SAMPLES_PER_EDGE;
    const mesh = makeFabricLifecycleArrays(segments);
    const wide = makeFabricLifecycleArrays(segments);
    writeFabricLifecycleSlot(mesh, 0, record({
      dyingAt: 42, deathKind: 'death', deadEnd: 'to', growDir: -1,
    }));
    writeFabricLifecycleSlot(wide, 0, record({
      dyingAt: 42, deathKind: 'death', deadEnd: 'to', growDir: -1,
      trunkness: 0.87,
    }));
    expect([...wide.color]).toEqual([...mesh.color]);
    expect([...wide.scalar]).toEqual([...mesh.scalar]);
    for (let index = 0; index < mesh.curve.length; index += 1) {
      const lane = index % FABRIC_LIFE_CURVE_STRIDE;
      if (lane === FABRIC_LIFE_TRUNKNESS_OFFSET) {
        expect(mesh.curve[index]).toBe(FABRIC_TRUNK_NO_ARBOR);
        expect(wide.curve[index]).toBeCloseTo(0.87, 6);
        continue;
      }
      expect(wide.curve[index]).toBe(mesh.curve[index]);
    }
  });

  it('writes the tier lane into every instance of the slot', () => {
    const arrays = makeFabricLifecycleArrays(FABRIC_SAMPLES_PER_EDGE * 2);
    writeFabricLifecycleSlot(
      arrays, FABRIC_SAMPLES_PER_EDGE, record({ trunkness: 0.5 }),
    );
    for (let segment = 0; segment < FABRIC_SAMPLES_PER_EDGE; segment += 1) {
      const instance = FABRIC_SAMPLES_PER_EDGE + segment;
      expect(
        arrays.curve[instance * FABRIC_LIFE_CURVE_STRIDE
          + FABRIC_LIFE_TRUNKNESS_OFFSET],
      ).toBe(0.5);
    }
  });
});

describe('fabric trunk tier — the two passes', () => {
  function makeFabricStackMaterial(pass?: number): LineMaterial {
    const material = new LineMaterial({
      vertexColors: true, linewidth: 2.5, transparent: true, worldUnits: false,
    });
    enableLineInspectionTransitionMaterial(material);
    optimizeScreenSpaceCapsuleMaterial(material);
    return enableFabricLifecycleMaterial(material, pass);
  }

  it('gates on the tier lane against the tier uniform, before any other work', () => {
    const vertex = makeFabricStackMaterial().vertexShader;
    expect(vertex).toContain('uniform float fabricTrunkThreshold;');
    expect(vertex).toContain('uniform float fabricTrunkPass;');
    expect(vertex).toContain(
      'float fabricEdgePass = ( fabricCurveTo.w >= fabricTrunkThreshold )',
    );
    expect(vertex).toContain('if ( fabricEdgePass != fabricTrunkPass ) {');
    // The gate must precede the lifecycle evaluation it exists to skip.
    const gate = vertex.indexOf('fabricEdgePass');
    const interval = vertex.indexOf('fabricLifecycleInterval( interval');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(interval);
  });

  it('the two materials differ only in pass and rest on the disabled tier', () => {
    const mesh = makeFabricStackMaterial();
    const wide = makeFabricStackMaterial(FABRIC_TRUNK_PASS_TRUNK);
    expect(mesh.uniforms.fabricTrunkPass.value).toBe(FABRIC_TRUNK_PASS_MESH);
    expect(wide.uniforms.fabricTrunkPass.value).toBe(FABRIC_TRUNK_PASS_TRUNK);
    expect(mesh.uniforms.fabricTrunkThreshold.value)
      .toBe(FABRIC_TRUNK_THRESHOLD_DISABLED);
    expect(wide.uniforms.fabricTrunkThreshold.value)
      .toBe(FABRIC_TRUNK_THRESHOLD_DISABLED);
    // Same program source: one shader, two scalars.
    expect(wide.vertexShader).toBe(mesh.vertexShader);
    expect(wide.fragmentShader).toBe(mesh.fragmentShader);
  });

  it('publishes one threshold, and refuses a non-finite one', () => {
    const material = makeFabricStackMaterial();
    setFabricTrunkThreshold(material, 0.16511);
    expect(material.uniforms.fabricTrunkThreshold.value).toBeCloseTo(0.16511, 6);
    setFabricTrunkThreshold(material, Number.NaN);
    expect(material.uniforms.fabricTrunkThreshold.value)
      .toBe(FABRIC_TRUNK_THRESHOLD_DISABLED);
  });

  it('the wide pass is one draw call over the mesh pass own buffers', () => {
    const fabric = makeFatLineLayer(32, 2.5, 'screen', true, true, true);
    const wide = makeFabricTrunkPass(fabric, 3.2);
    // No second allocation: same geometry object, therefore the same
    // interleaved buffers, the same instanceCount, and the same inspection
    // and recall-aperture lanes the mesh pass reads.
    expect(wide.mesh.geometry).toBe(fabric.geometry);
    expect(wide.material).not.toBe(fabric.material);
    expect(wide.material.linewidth).toBe(3.2);
    expect(wide.material.uniforms.fabricTrunkPass.value)
      .toBe(FABRIC_TRUNK_PASS_TRUNK);
    expect(fabric.material.uniforms.fabricTrunkPass.value)
      .toBe(FABRIC_TRUNK_PASS_MESH);
    expect(wide.material.uniforms.inspectionTransitionProgress).toBeDefined();
    // Render-only: it shares geometry, so a live raycast would report every
    // edge twice — including the ones this pass hides in the vertex stage.
    expect(wide.mesh.raycast).toBe(neverRaycast);
    expect(neverRaycast()).toBe(false);
  });

  it('refuses to ride a layer that has no lifecycle records to share', () => {
    const plain = makeFatLineLayer(32, 2.5, 'screen', true, true, false);
    expect(() => makeFabricTrunkPass(plain, 3.2)).toThrow(/lifecycle/);
  });
});
