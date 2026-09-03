// A cohort's links end short of its mass, and the image stays its own.
//
// A POW cohort's mark is light TRACED around a mass lying in this very plane:
// the shadow, the photon ring, the disc's inner edge at the ISCO and the far
// side of the disc folded over the top. A colony link is a straight bright
// segment in the same plane, so a link run to the node's centre draws a spoke
// of a wheel through the one region of the scene that is saying light does not
// go straight here — and the shadow cannot reject it, because the shadow
// occludes by DRAW ORDER and a link ending AT the cohort ends inside the image
// rather than behind it. These pins hold the geometry that prevents that, the
// two degenerate cases the pull could break on, and the one attribute the trim
// must NOT disturb.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COHORT_DISC_IN,
  COHORT_HIT_RADIUS,
  COHORT_HORIZON,
  COHORT_LINK_STOP_R,
} from '../../src/materials/colonyLens';
import {
  COHORT_KEEP_OUT_R,
  COLONY_MIN_SPACING,
} from '../../src/derives/networkTopology.derive';
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
  it('ends OUTSIDE the disc and INSIDE the keep-out, which is the whole of it', () => {
    // ⭐⭐ THE TWO INEQUALITIES ARE THE JUSTIFICATION AND THERE IS NO THIRD ONE.
    // Outside `COHORT_DISC_IN` — the innermost stable circular orbit, 3 horizons
    // — so no link ends on top of the bright ring the ISCO's edge makes; inside
    // `COHORT_KEEP_OUT_R`, so a peer displaced to the rim still has half a world
    // unit of its own link left to draw rather than one trimmed to a point.
    expect(COHORT_LINK_STOP_R).toBe(3);
    expect(COHORT_DISC_IN).toBeCloseTo(2.31, 12);
    expect(COHORT_LINK_STOP_R).toBeGreaterThan(COHORT_DISC_IN);
    expect(COHORT_LINK_STOP_R).toBeLessThan(COHORT_KEEP_OUT_R);
    expect(COHORT_KEEP_OUT_R - COHORT_LINK_STOP_R).toBeCloseTo(0.5, 12);
  });

  it('does NOT try to be where the light ends, because the light reaches 28 wu', () => {
    // ⚠️ THIS IS THE CLAIM THAT CHANGED WITH THE FORM. Under the composed
    // aperture the stop WAS the mark's outer edge — the same radius the face's
    // fragment discarded on — so a link ended exactly where the disc did. The
    // lensed disc reaches `COHORT_DISC_OUT`, 28 wu, and a stop out there would
    // trim every link in the colony to nothing (`COLONY_MIN_SPACING` is 6). So
    // the stop clears the COMPUTED part of the image — the shadow, the ring and
    // the inner disc — and the outer disc is a faint streak field the mesh is
    // MEANT to show through: a link crossing it is the vortex being seen
    // through, which is what an outer disc is for.
    expect(COHORT_LINK_STOP_R).toBeLessThan(COLONY_MIN_SPACING);
    expect(COHORT_LINK_STOP_R).toBe(COLONY_MIN_SPACING / 2);
  });

  it('is NOT the pick radius, and the split is why', () => {
    // ⭐ THE TWO CONSUMERS ASK DIFFERENT QUESTIONS. A line asks where the IMAGE
    // ends; a click asks what a viewer is unmistakably aiming at. The answer to
    // the second is the SHADOW — 2.6 horizons, the black disc in the middle —
    // and it is strictly inside the disc's inner edge, so the target is over
    // the one part of the mark that is a deliberate feature rather than a
    // texture.
    expect(COHORT_HIT_RADIUS).not.toBe(COHORT_LINK_STOP_R);
    expect(COHORT_HIT_RADIUS).toBeCloseTo(2.0005, 4);
    expect(COHORT_HIT_RADIUS).toBeLessThan(COHORT_DISC_IN);
    expect(COHORT_HIT_RADIUS).toBeLessThan(COHORT_LINK_STOP_R);
    // Both are multiples of the same mass or bounded by the same keep-out, so
    // neither is a free literal a retune could leave behind.
    expect(COHORT_HIT_RADIUS / COHORT_HORIZON).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12);
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
