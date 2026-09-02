// The ambient half of the mist: the substance simply being there, under the
// whole colony, at a few percent of the mesh's brightness.
//
// ⭐⭐ WHAT THIS FILE PINS IS PLACEMENT AND RESTRAINT, not arithmetic — the
// program's own proofs (one fetch, no clock, the elliptical fade) live in
// `materials/colonyMist.test.ts`. The two things a component can get wrong
// here are WHERE the sheets lie and HOW MANY of them a tier draws, and both
// are decidable without a renderer: r3f commits no tree under jsdom, so the
// tiering is a pure function and everything else is a source pin.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import ColonyMist, {
  MIST_HAZE_HALF,
  mistHazeSheetsDrawn,
} from '../../src/components/ColonyMist';
import {
  MIST_FLOOR_DEPTH,
  MIST_HAZE_EDGE_IN,
  MIST_HAZE_EDGE_OUT,
  MIST_HAZE_ELLIPSE,
  MIST_HAZE_SHEETS,
} from '../../src/materials/colonyMist';
import { COLONY_Y } from '../../src/derives/networkTopology.derive';
import { QUALITY_PRESETS, type QualityPreset } from '../../src/tweaks/qualityPresets';
import { PERFORMANCE_PROBE_LABELS } from '../../src/tweaks/performanceProbeStore';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/${file}`), 'utf8');
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

describe('the mist under the colony plane', () => {
  it('mounts inside an r3f Canvas without throwing', () => {
    expect(() => render(<Canvas><ColonyMist /></Canvas>)).not.toThrow();
  });

  it('draws two sheets, one, or none — and drops the DEEPER one first', () => {
    // ⭐ A PREFIX AND NOT A SELECTION. Two sheets at two depths, seen through
    // each other at any angle but straight down, are what make the substance
    // read as deep rather than as a floor; when a tier can only afford one, the
    // one worth keeping is the one nearest the membrane.
    const tiers: QualityPreset[] = ['high', 'med', 'low'];
    expect(tiers.map((tier) => QUALITY_PRESETS[tier].mistHazeSheets))
      .toEqual([2, 1, 0]);
    for (const tier of tiers) {
      const drawn = mistHazeSheetsDrawn(QUALITY_PRESETS[tier].mistHazeSheets);
      expect(drawn).toHaveLength(QUALITY_PRESETS[tier].mistHazeSheets);
      expect(drawn.map((sheet) => sheet.depth))
        .toEqual(MIST_HAZE_SHEETS.slice(0, drawn.length).map((sheet) => sheet.depth));
    }
    expect(mistHazeSheetsDrawn(1)[0].depth).toBe(MIST_HAZE_SHEETS[0].depth);
    expect(mistHazeSheetsDrawn(0)).toEqual([]);
    // …and a count outside the range is clamped rather than trusted: the field
    // is a number on a preset, and a preset is edited by hand.
    expect(mistHazeSheetsDrawn(-3)).toEqual([]);
    expect(mistHazeSheetsDrawn(99)).toHaveLength(MIST_HAZE_SHEETS.length);
    // ⭐ NO DRAW rather than an empty one at `low`: a material that never enters
    // the scene graph is never compiled.
    expect(source('ColonyMist.tsx')).toContain('if (drawn.length === 0) return null;');
  });

  it('lies flat, below the patch’s own floor, on the colony’s plane', () => {
    // ⚠️ THE SHEETS SIT UNDER THE INTAKE, ALWAYS. The patch lies
    // `MIST_FLOOR_DEPTH` under the membrane and rises from there; if a sheet
    // were shallower it would draw in front of the one thing this whole layer
    // exists to make legible.
    const drawn = mistHazeSheetsDrawn(2);
    expect(drawn.map((sheet) => sheet.y))
      .toEqual([COLONY_Y - 7, COLONY_Y - 13.5]);
    for (const sheet of drawn) {
      expect(sheet.depth).toBeGreaterThan(MIST_FLOOR_DEPTH);
      expect(sheet.y).toBeLessThan(COLONY_Y - MIST_FLOOR_DEPTH);
    }
    expect(drawn[1].y).toBeLessThan(drawn[0].y);
    // Laid flat by the mesh, at the sheet's own world Y and nowhere else.
    const layer = source('ColonyMist.tsx');
    expect(layer).toContain('rotation={[-Math.PI / 2, 0, 0]}');
    expect(layer).toContain('position={[0, sheet.y, 0]}');
    expect(layer).toContain('y: COLONY_Y - sheet.depth');
  });

  it('is SQUARE, because it turns with the colony while its fade does not', () => {
    // ⚠️⚠️ THE ONE ARITHMETIC TRAP IN THIS COMPONENT. The haze fragment fades
    // the sheet out between `MIST_HAZE_EDGE_IN` and `MIST_HAZE_EDGE_OUT` of the
    // colony's OWN ellipse, measured on the WORLD point under each fragment —
    // so the fade is fixed in world space while the mesh, mounted inside the
    // counter-rotating group, is not. A rectangle cut to the fade's two
    // semi-axes (230 x 156.4 wu) is therefore only right at 0°: turn it 90° and
    // it stops at 156.4 wu along an axis where the fade is still at 99.9 % of
    // full — a hard straight edge across the substance, which is the "it became
    // a plate" failure this whole round is refusing.
    expect(MIST_HAZE_ELLIPSE[0]).toBeCloseTo(115, 6);
    expect(MIST_HAZE_ELLIPSE[1]).toBeCloseTo(78.2, 6);
    const short = MIST_HAZE_EDGE_OUT * MIST_HAZE_ELLIPSE[1];
    expect(short).toBeCloseTo(156.4, 6);
    const cutEdge = 1 - smoothstep(
      MIST_HAZE_EDGE_IN, MIST_HAZE_EDGE_OUT, short / MIST_HAZE_ELLIPSE[0],
    );
    expect(cutEdge).toBeGreaterThan(0.999);

    // ⭐ THE SQUARE'S INSCRIBED DISC IS WHAT THE ROTATION SEES, and it has to
    // contain every point the fade can reach — which is the ellipse's LONG
    // semi-axis at `MIST_HAZE_EDGE_OUT`, and nothing further.
    expect(MIST_HAZE_HALF).toBe(MIST_HAZE_EDGE_OUT * MIST_HAZE_ELLIPSE[0]);
    expect(MIST_HAZE_HALF).toBeCloseTo(230, 6);
    for (const angle of [0, 0.4, Math.PI / 4, 1.3, Math.PI / 2, 2.9]) {
      // The furthest point the fade still draws, at this bearing.
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      const reach = MIST_HAZE_EDGE_OUT / Math.hypot(
        x / MIST_HAZE_ELLIPSE[0], z / MIST_HAZE_ELLIPSE[1],
      );
      expect(reach).toBeLessThanOrEqual(MIST_HAZE_HALF + 1e-9);
    }
    // …and the mesh really is that square, on both sides.
    const layer = source('ColonyMist.tsx');
    expect(layer)
      .toContain('new THREE.PlaneGeometry(MIST_HAZE_HALF * 2, MIST_HAZE_HALF * 2)');
    // One plane for every sheet: they differ by a transform and two uniforms,
    // none of which is geometry.
    expect(layer.match(/new THREE\.PlaneGeometry\([^)]*\)/g)).toHaveLength(1);
  });

  it('is context and refuses to behave like anything else in the colony', () => {
    const layer = source('ColonyMist.tsx');
    // ⚠️ NEVER A PICK TARGET. A plane 460 wu across under the whole colony
    // would put a wall of invisible target behind every node in it.
    expect(layer.match(/raycast=\{\(\) => null\}/g)).toHaveLength(1);
    // ⚠️ AND NEVER IN FRONT OF ANYTHING: below every other draw in the colony.
    expect(layer).toContain('renderOrder={-1}');
    // ⭐ NO CLOCK. The preview's haze does not animate and must not: motion in
    // the far field is exactly what would pull focus from the mesh and the
    // galaxy, and this layer's whole claim is that it is SECONDARY. The one
    // frame callback exists to carry a live knob and reads no time at all.
    // ⚠️ COMMENTS STRIPPED: the header argues at length about the clock it
    // refuses and names it, and prose the compiler drops must not be able to
    // fail — or pass — an assertion about code.
    const code = layer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // ⚠️ Word boundaries: `gpuTimerQuery` contains `uTime` as a substring, and
    // an assertion that a program has no clock must not fail on an import's
    // spelling.
    expect(code).not.toMatch(/\buTime\b|\belapsedSec\b|useSimClock|performance\.now/);
    expect(layer).toContain('const amp = LIVE.peer.cohortHazeAmp;');
    // ⭐ AND IT TAKES NO DATA. No topology, no flood, no pulse, no producers:
    // the field is everywhere, so there is nothing per-cohort or per-block for
    // it to read. The intake — the one part of the mist that answers to a
    // cohort — is `ColonyCohorts`' third draw, beside the mark it feeds.
    expect(code).not.toMatch(/topology|blockPulseAtMs|entryId|cohortMarks|producers/);
    expect(code).toContain('export default function ColonyMist() {');
    expect(source('ColonyCohorts.tsx')).toContain('makeCohortIntakePatchMaterial');
    // Its own probe label, distinct from the patch's, so the ambience and the
    // intake are never one mean.
    expect(PERFORMANCE_PROBE_LABELS.colonyMistHaze).toBe('colony.mist.haze');
    expect(PERFORMANCE_PROBE_LABELS.colonyMistPatch).toBe('colony.mist.patch');
    expect(layer).toContain('PERFORMANCE_PROBE_LABELS.colonyMistHaze');
    expect(layer).not.toContain('colonyMistPatch');
    // ⚠️ ONE SPAN HOLDER PER SHEET. The two draws share a label — one program
    // over one fade, so a mean over them is still a draw mean — but a shared
    // callbacks object would let one sheet end the other's timer query.
    expect(layer).toContain('MIST_HAZE_SHEETS.map(');
  });
});
