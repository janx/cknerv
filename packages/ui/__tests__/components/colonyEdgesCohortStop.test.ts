// A cohort's links end at the aperture's outer edge, and the mark stays its
// own.
//
// The pupil's darkness is a REFUSAL, not a shadow: every face of a cohort is
// additive and depth-read-only, so nothing rejects a link drawn across the
// disc — it is simply added to it. And under the aperture the link has a second
// way to spoil the mark that the marched throat never gave it: the face carries
// 88 radial striae whose one measured law is that radial structure at LOW COUNT
// reads as a star, and a colony link is radial structure at count four, drawn
// in the same plane. These pins hold the geometry that prevents both, the two
// degenerate cases the pull could break on, and the one attribute the trim must
// NOT disturb.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COHORT_AP_R,
  COHORT_AP_PUPIL_FRAC,
  COHORT_AP_RIM_FRAC,
  COHORT_HIT_RADIUS,
  COHORT_LINK_STOP_R,
} from '../../src/materials/colonyCohort';
import { COLONY_MIN_SPACING } from '../../src/derives/networkTopology.derive';
import { colonyEdgePositions } from '../../src/components/ColonyEdges';
import type { NetworkEdge, NetworkNode, NetworkTopology, Vec3 } from '../../src/types';

const LAYER = readFileSync(
  resolve(process.cwd(), 'src/components/ColonyEdges.tsx'),
  'utf8',
);

function node(id: string, kind: NetworkNode['kind'], pos: Vec3): NetworkNode {
  return { id, kind, pos };
}

function edge(a: string, b: string): NetworkEdge {
  return { a, b, kind: 'inferred', weight: 1 };
}

function topologyOf(nodes: NetworkNode[], edges: NetworkEdge[]): NetworkTopology {
  return {
    provenance: 'inferred',
    localId: nodes[0]?.id ?? 'ckb:local',
    nodes,
    edges,
    adjacency: new Map(),
  };
}

/** The drawn endpoints of edge `i`, read back out of the packed buffer. */
function drawn(pos: Float32Array, i: number): [Vec3, Vec3] {
  return [
    [pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]],
    [pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5]],
  ];
}

function sub(p: Vec3, q: Vec3): Vec3 {
  return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
}

function len3(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function dot3(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}

/** Float32 round-trip slack: the buffer is f32, the arithmetic here is f64. */
const F32_SLACK = 1e-4;

describe('COHORT_LINK_STOP_R', () => {
  it("is the mark's OUTER EDGE, derived and never picked", () => {
    // ⭐ It is `COHORT_AP_R` itself — the same number the face's fragment
    // discards on, so a link ending here ends exactly where the disc does and
    // adds light to no pixel of it. A literal would let the colony say
    // something different from what the shader draws.
    expect(COHORT_LINK_STOP_R).toBe(COHORT_AP_R);
    expect(COHORT_LINK_STOP_R).toBe(3);
  });

  it('stops outside the WHOLE disc, not merely outside the pupil', () => {
    // ⭐ The old throat only had to keep its unlit middle clear, so its stop
    // sat inside the mark and cleared the refusal by 1.67x. The aperture asks
    // for more: the disc's grain is radial, and a link crossing it lands in the
    // same plane as the striae and joins them as a spoke several times any
    // stria's width. So the stop is the outer edge and not a margin around the
    // hole — it clears the pupil by nearly 6x on the way past.
    const rim = COHORT_AP_R * COHORT_AP_RIM_FRAC;
    const pupil = rim * COHORT_AP_PUPIL_FRAC;
    expect(pupil).toBeCloseTo(0.5208, 5);
    expect(COHORT_LINK_STOP_R).toBeGreaterThan(pupil);
    expect(COHORT_LINK_STOP_R / pupil).toBeCloseTo(5.7604, 4);
    // …and past the rim, the brightest ring on the mark, too.
    expect(COHORT_LINK_STOP_R).toBeGreaterThan(rim);
  });

  it('is NOT the pick radius any more, and the split is why', () => {
    // ⚠️⚠️ ONE NUMBER SERVED BOTH UNTIL THE MARK STOPPED HAVING SLACK IN IT.
    // The centre this replaced was a bounding SQUARE around a profile that died
    // well inside it, so half of it happened to answer both questions at once.
    // The aperture's light really does reach `COHORT_AP_R` — so a line must
    // stop out there — while `COLONY_MIN_SPACING` really does forbid a target
    // that large, because a target reaching the midpoint to the nearest stop
    // the colony will place beside it starts taking that stop's clicks.
    //
    // ⭐ THE TWO CONSUMERS ASK DIFFERENT QUESTIONS. A line asks where the LIGHT
    // ends; a click asks how far a viewer may aim without taking a neighbour.
    // Additive light may overlap a neighbour freely; a hit sphere may not,
    // because a click has exactly one winner. Both still come off `COHORT_AP_R`
    // and neither is a free literal, so a retune of the mark moves both.
    expect(COHORT_LINK_STOP_R).not.toBe(COHORT_HIT_RADIUS);
    expect(COHORT_HIT_RADIUS).toBe(COHORT_AP_R * 0.5);
    expect(COHORT_LINK_STOP_R).toBe(COHORT_AP_R);
    // The link stop reaches the midpoint between two stops at the colony's
    // tightest spacing — which is exactly why the TARGET may not.
    expect(COHORT_LINK_STOP_R).toBe(COLONY_MIN_SPACING / 2);
    expect(COHORT_HIT_RADIUS).toBeLessThan(COLONY_MIN_SPACING / 2);
    expect(COHORT_HIT_RADIUS).toBe(COLONY_MIN_SPACING / 4);
  });
});

describe('colonyEdgePositions', () => {
  it('writes a link between two ordinary peers byte-identically to its nodes', () => {
    // A colony with no producers keeps precisely the geometry it always had.
    const a: Vec3 = [-14, 22, 3];
    const b: Vec3 = [11, 19, -8];
    const pos = colonyEdgePositions(topologyOf(
      [node('m:a', 'measured', a), node('inf:1', 'inferred', b)],
      [edge('m:a', 'inf:1')],
    ));
    expect(Array.from(pos)).toEqual([...a, ...b]);
  });

  it('pulls a cohort endpoint exactly one stop radius along its own edge', () => {
    const a: Vec3 = [0, 22, 0];
    const b: Vec3 = [15, 22, 0];
    const pos = colonyEdgePositions(topologyOf(
      [node('attested:k', 'attested', a), node('m:b', 'measured', b)],
      [edge('attested:k', 'm:b')],
    ));
    const [da, db] = drawn(pos, 0);
    // The cohort's end moved toward the other node by the stop radius…
    expect(len3(sub(da, a))).toBeCloseTo(COHORT_LINK_STOP_R, 4);
    expect(da[0]).toBeCloseTo(COHORT_LINK_STOP_R, 4);
    // …along the edge and nowhere else…
    expect(da[1]).toBeCloseTo(22, 6);
    expect(da[2]).toBeCloseTo(0, 6);
    // …and the ordinary peer's end did not move at all.
    expect(Array.from(db)).toEqual(b);
  });

  it('pulls BOTH ends when a link joins two cohorts', () => {
    const a: Vec3 = [0, 22, 0];
    const b: Vec3 = [0, 22, 20];
    const pos = colonyEdgePositions(topologyOf(
      [node('attested:x', 'attested', a), node('attested:y', 'attested', b)],
      [edge('attested:x', 'attested:y')],
    ));
    const [da, db] = drawn(pos, 0);
    expect(len3(sub(da, a))).toBeCloseTo(COHORT_LINK_STOP_R, 4);
    expect(len3(sub(db, b))).toBeCloseTo(COHORT_LINK_STOP_R, 4);
    // Both stops came out of one link: the drawn span is short by two of them.
    expect(len3(sub(db, da))).toBeCloseTo(20 - 2 * COHORT_LINK_STOP_R, 4);
    // Still pointing a→b, which is the direction `aEdgeParam` is written for.
    expect(dot3(sub(db, da), sub(b, a))).toBeGreaterThan(0);
  });

  it('CLAMPS a link shorter than its own stops instead of inverting it', () => {
    // ⚠️ Two stops on a link barely longer than one would CROSS, and a crossed
    // line is drawn backwards through both marks. The cap keeps at least half
    // of every link drawn, whatever its length and however many of its ends
    // are cohorts. ⭐ It is continuous, unlike a length threshold: a shrinking
    // link keeps a proportional gap instead of snapping back to a line laid
    // straight through the throat, which is the thing being prevented.
    const kinds = [
      ['attested', 'attested'],
      ['attested', 'measured'],
      ['measured', 'attested'],
    ] as const;
    for (const whole of [4, 2.3, 2, 1, 0.5, 0.01]) {
      for (const [ka, kb] of kinds) {
        const a: Vec3 = [0, 22, 0];
        const b: Vec3 = [whole, 22, 0];
        const pos = colonyEdgePositions(topologyOf(
          [node('n:a', ka, a), node('n:b', kb, b)],
          [edge('n:a', 'n:b')],
        ));
        const [da, db] = drawn(pos, 0);
        const span = sub(db, da);
        // Never inverted: the drawn segment still runs a→b…
        expect(dot3(span, sub(b, a))).toBeGreaterThan(0);
        // …never shorter than half the link it stands for…
        expect(len3(span)).toBeGreaterThanOrEqual(whole * 0.5 - F32_SLACK);
        // …and never longer than it either, so this is a clamp and not a
        // release: no pull is ever skipped just because the link is short.
        expect(len3(span)).toBeLessThanOrEqual(whole + F32_SLACK);
        // Neither end left the segment it was pulled along.
        for (const p of [da, db]) {
          expect(p[0]).toBeGreaterThanOrEqual(-F32_SLACK);
          expect(p[0]).toBeLessThanOrEqual(whole + F32_SLACK);
        }
      }
    }
  });

  it('leaves a ZERO-length cohort edge alone rather than writing NaN', () => {
    // `d / 0` is the other way this walk can poison a whole buffer: one NaN
    // vertex takes the entire draw with it, not just its own edge.
    const p: Vec3 = [7, 22, -4];
    const pos = colonyEdgePositions(topologyOf(
      [node('attested:x', 'attested', p), node('attested:y', 'attested', [...p] as Vec3)],
      [edge('attested:x', 'attested:y')],
    ));
    expect(Array.from(pos).every(Number.isFinite)).toBe(true);
    expect(Array.from(pos)).toEqual([...p, ...p]);
  });

  it('touches only the cohort-incident links in a mixed colony', () => {
    const nodes = [
      node('ckb:local', 'local', [0, 22, 0]),
      node('m:1', 'measured', [20, 22, 0]),
      node('inf:1', 'inferred', [0, 22, 20]),
      node('attested:k', 'attested', [-20, 22, 0]),
    ];
    const edges = [
      edge('ckb:local', 'm:1'),        // 0 — untouched
      edge('m:1', 'inf:1'),            // 1 — untouched
      edge('attested:k', 'ckb:local'), // 2 — one end pulled
    ];
    const pos = colonyEdgePositions(topologyOf(nodes, edges));
    // The same colony with its cohort demoted to an ordinary sighted stop.
    const plain = colonyEdgePositions(topologyOf(
      nodes.map((n) => (n.kind === 'attested' ? { ...n, kind: 'sighted' as const } : n)),
      edges,
    ));
    expect(Array.from(pos.slice(0, 12))).toEqual(Array.from(plain.slice(0, 12)));
    expect(Array.from(pos.slice(12, 18))).not.toEqual(Array.from(plain.slice(12, 18)));
    const [da, db] = drawn(pos, 2);
    expect(len3(sub(da, [-20, 22, 0]))).toBeCloseTo(COHORT_LINK_STOP_R, 4);
    expect(Array.from(db)).toEqual([0, 22, 0]);
  });
});

describe('the trim does not disturb the current running along a link', () => {
  it('keeps aEdgeParam at 0 and 1, so it still spans the DRAWN segment', () => {
    // ⚠️ THE OTHER WAY TO WRITE THIS CHANGE IS WRONG. Re-basing the parameter
    // on the UNTRIMMED endpoints — a cohort end at `stop / len` rather than 0 —
    // would hand every cohort-incident link a band that entered late and left
    // early, visibly off the cadence every other link in the mesh keeps. The
    // parameter is a coordinate on the line the GPU rasterises, and the trim
    // moves that line's ends, so 0 and 1 are still exactly right.
    // Every write to the lane, and there are exactly two of them: the constants
    // 0 and 1. Not a length, not a stop radius, not a ratio of either.
    expect(LAYER.match(/param\[[^\]]*\]\s*=\s*[^;]+;/g)).toEqual([
      'param[2 * i] = 0;',
      'param[2 * i + 1] = 1;',
    ]);
  });

  it('keeps the parameter out of the trim entirely, so the two cannot meet', () => {
    // Structural rather than remembered: the walk that knows about the stop
    // radius produces POSITIONS ONLY. Nothing in it can reach the parameter,
    // the phase or a surge stamp to scale one by a length.
    const start = LAYER.indexOf('export function colonyEdgePositions');
    const end = LAYER.indexOf('export function makeColonyEdgeMaterial');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const trim = LAYER.slice(start, end);
    expect(trim).toContain('COHORT_LINK_STOP_R');
    for (const attribute of ['aEdgeParam', 'param[', 'aPhase', 'aSurge', 'aBright']) {
      expect(trim).not.toContain(attribute);
    }
  });
});
