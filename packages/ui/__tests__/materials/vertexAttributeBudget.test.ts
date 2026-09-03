import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';
import { makeCellFlareMaterial } from '../../src/materials/cellFlareMaterial';
import { makeNucleusPointMaterial } from '../../src/materials/cellNucleusMaterial';
import { makeContactWaveMaterial } from '../../src/materials/contactWaveMaterial';
import {
  makeMeasuredPeerHalosMaterial,
  makePeerCloudMaterial,
  makePeerHaloMaterial,
} from '../../src/materials/peerNodeMaterial';
import {
  makePopulationBackboneMaterial,
  makePopulationFibreMaterial,
  makePopulationPointMaterial,
} from '../../src/materials/populationFieldMaterial';
import { makeHaloMaterial } from '../../src/components/GlowNode';
import { makeColonyEdgeMaterial } from '../../src/components/ColonyEdges';
import {
  makeCohortAuraMaterial,
  makeCohortFaceMaterial,
} from '../../src/materials/colonyCohort';
import {
  makeCohortIntakePatchMaterial,
} from '../../src/materials/colonyMist';
import { makeCohortLensMaterial } from '../../src/materials/colonyLens';
import {
  makeCanonicalRewriteEchoMaterial,
} from '../../src/components/CanonicalRewriteEcho';
import { makeDendriticBurstMaterial } from '../../src/nerve/DendriticBurst';
import { SpikePool } from '../../src/nerve/spikePool';
import { makeFabricTrunkPass, makeFatLineLayer } from '../../src/nerve/NeuralFabric';

/**
 * ONE budget for every vertex program this package compiles.
 *
 * WebGL guarantees 16 vertex attribute slots (`MAX_VERTEX_ATTRIBS`), and that
 * is what every GL backend on the reference machine reports. three r169
 * compiles these materials as ESSL 3.00, where a driver assigns a slot to
 * every DECLARED input — an unused `normal` is NOT optimised away the way it
 * is under ESSL 1.00. **Declaration is occupancy.**
 *
 * Overrunning the budget does not fail any build, typecheck or unit suite: the
 * program simply never links, the draw call is dropped with `useProgram:
 * program not valid`, and the layer silently disappears from a scene that
 * still looks plausible. That failure mode has already cost this project a P0.
 * That is what this file exists to catch.
 *
 * The charge for one material is:
 *
 *   its own declarations, after preprocessing, at the slot width of each type
 * + 3 for the position/normal/uv that three injects into every non-raw shader
 * + 4 when it draws on an InstancedMesh (`instanceMatrix` is a mat4)
 * + 1 when that mesh also carries `instanceColor`
 * + 1 when the material sets `vertexColors` (three injects `color`, whether or
 *     not the shader body reads it — the fat lines never do)
 *
 * Pack a pair into a vec2 before asking for more room. There is no more room.
 */
const MAX_VERTEX_ATTRIBUTES = 16;

/** How many attribute slots one GLSL vertex-input type occupies. */
const SLOTS_PER_TYPE: Readonly<Record<string, number>> = {
  bool: 1, int: 1, uint: 1, float: 1,
  bvec2: 1, bvec3: 1, bvec4: 1,
  ivec2: 1, ivec3: 1, ivec4: 1,
  uvec2: 1, uvec3: 1, uvec4: 1,
  vec2: 1, vec3: 1, vec4: 1,
  mat2: 2, mat3: 3, mat4: 4,
};

/** One `attribute <type> <name>;` declaration, in source order. */
const ATTRIBUTE_DECLARATION = /^[^\S\n]*attribute\s+(\w+)\s+(\w+)\s*;/gm;

type Defines = ReadonlySet<string>;

/**
 * Evaluate one preprocessor condition against `defines`. `undefined` means
 * "this test does not understand the expression" — the caller then keeps BOTH
 * branches, which over-charges the budget rather than under-charging it.
 */
function conditionHolds(
  keyword: string,
  expression: string,
  defines: Defines,
): boolean | undefined {
  if (keyword === 'ifdef') return defines.has(expression.trim());
  if (keyword === 'ifndef') return !defines.has(expression.trim());
  const defined = /^\s*defined\s*\(?\s*(\w+)\s*\)?\s*$/.exec(expression);
  if (defined !== null) return defines.has(defined[1]);
  return undefined;
}

/** The source a GLSL preprocessor would hand the compiler, given `defines`. */
function preprocess(source: string, defines: Defines): string {
  const stack: { on: boolean; taken: boolean }[] = [];
  const inside = (): boolean => stack.every((frame) => frame.on);
  const kept: string[] = [];
  for (const line of source.split('\n')) {
    const directive = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b(.*)$/
      .exec(line);
    if (directive === null) {
      if (inside()) kept.push(line);
      continue;
    }
    const [, keyword, expression] = directive;
    if (keyword === 'endif') {
      stack.pop();
      continue;
    }
    if (keyword === 'else' || keyword === 'elif') {
      const frame = stack[stack.length - 1];
      if (frame === undefined) continue;
      const holds = keyword === 'else'
        ? true
        : conditionHolds('if', expression, defines) ?? true;
      frame.on = !frame.taken && holds;
      frame.taken = frame.taken || frame.on;
      continue;
    }
    const holds = conditionHolds(keyword, expression, defines);
    stack.push({ on: holds ?? true, taken: holds === true });
  }
  return kept.join('\n');
}

/** Attribute declarations a driver would see, name → GLSL type. */
function declaredAttributes(
  vertexShader: string,
  defines: Defines = new Set(),
): Map<string, string> {
  const active = preprocess(vertexShader, defines);
  const declarations = [...active.matchAll(ATTRIBUTE_DECLARATION)]
    .map((match) => [match[2], match[1]] as const);
  const attributes = new Map(declarations);
  // A repeated name would collapse two entries into one and hide a slot.
  if (attributes.size !== declarations.length) {
    throw new Error(
      `duplicate attribute declaration: ${declarations.map(([n]) => n).join(', ')}`,
    );
  }
  return attributes;
}

/** How this material is actually drawn — what three adds to its prefix. */
interface Usage {
  /** Drawn by an InstancedMesh: `attribute mat4 instanceMatrix`. */
  readonly instanced?: boolean;
  /** That mesh also allocates `instanceColor`. */
  readonly instancedColor?: boolean;
}

interface BudgetRow {
  readonly name: string;
  /** src files whose GLSL ends up in this program. */
  readonly sources: readonly string[];
  readonly material: () => THREE.ShaderMaterial | LineMaterial;
  readonly usage?: Usage;
}

/** The preprocessor symbols three's prefix defines for this draw. */
function definesFor(
  material: THREE.ShaderMaterial | LineMaterial,
  usage: Usage,
): Set<string> {
  const defines = new Set<string>();
  if (material.vertexColors) defines.add('USE_COLOR');
  if (usage.instanced === true) defines.add('USE_INSTANCING');
  if (usage.instancedColor === true) defines.add('USE_INSTANCING_COLOR');
  const line = material as Partial<LineMaterial>;
  if (line.dashed === true) defines.add('USE_DASH');
  if (line.worldUnits === true) defines.add('WORLD_UNITS');
  return defines;
}

/** Slots three's own vertex prefix spends before the material says a word. */
function injectedSlots(defines: Defines): number {
  // position + normal + uv, unconditionally, on every non-raw ShaderMaterial.
  let slots = 3;
  if (defines.has('USE_INSTANCING')) slots += SLOTS_PER_TYPE.mat4;
  if (defines.has('USE_INSTANCING_COLOR')) slots += SLOTS_PER_TYPE.vec3;
  if (defines.has('USE_COLOR')) slots += SLOTS_PER_TYPE.vec3;
  return slots;
}

const FABRIC_SEGMENTS = 8;

/** The passive fabric layer, exactly as `NeuralFabric` builds it. */
function fabricLifecycleLayer(): ReturnType<typeof makeFatLineLayer> {
  return makeFatLineLayer(FABRIC_SEGMENTS, 2.5, 'screen', true, true);
}

/**
 * Every vertex program in the package that is not a stock three material,
 * in one table. A family added to `src` without a row here fails the
 * coverage test below, so this list cannot silently fall behind.
 */
const ROWS: readonly BudgetRow[] = [
  {
    name: 'cellHybridMaterial',
    sources: ['src/materials/cellHybridMaterial.ts'],
    material: makeCellHybridMaterial,
  },
  {
    name: 'cellFlareMaterial',
    sources: ['src/materials/cellFlareMaterial.ts'],
    material: makeCellFlareMaterial,
  },
  {
    name: 'cellNucleusPointMaterial',
    sources: ['src/materials/cellNucleusMaterial.ts'],
    material: () => makeNucleusPointMaterial(0.32),
  },
  {
    name: 'contactWaveMaterial',
    sources: ['src/materials/contactWaveMaterial.ts'],
    material: makeContactWaveMaterial,
    // BlockDeliveryLayer's wave batch: an InstancedMesh that allocates
    // instanceColor before the first render so the carrier hue rides along.
    usage: { instanced: true, instancedColor: true },
  },
  {
    name: 'measuredPeerHalosMaterial',
    sources: ['src/materials/peerNodeMaterial.ts'],
    material: () => makeMeasuredPeerHalosMaterial(),
    // ColonyNodes draws the whole measured belt as one InstancedMesh.
    usage: { instanced: true },
  },
  {
    name: 'peerCloudMaterial',
    sources: ['src/materials/peerNodeMaterial.ts'],
    material: () => makePeerCloudMaterial(),
  },
  {
    name: 'peerHaloMaterial',
    sources: ['src/materials/peerNodeMaterial.ts'],
    material: () => makePeerHaloMaterial('#ffffff'),
  },
  {
    name: 'populationPointMaterial',
    sources: ['src/materials/populationFieldMaterial.ts'],
    material: makePopulationPointMaterial,
  },
  {
    name: 'populationFibreMaterial',
    sources: ['src/materials/populationFieldMaterial.ts'],
    material: makePopulationFibreMaterial,
  },
  {
    name: 'populationBackboneMaterial',
    sources: [
      'src/materials/populationFieldMaterial.ts',
      'src/geometry/screenSpaceCapsuleLine.ts',
    ],
    material: makePopulationBackboneMaterial,
  },
  {
    name: 'fabric lifecycle (mesh pass)',
    sources: [
      'src/nerve/fabricLifecycleShader.ts',
      'src/geometry/screenSpaceCapsuleLine.ts',
    ],
    material: () => fabricLifecycleLayer().material,
  },
  {
    name: 'fabric lifecycle (trunk pass)',
    sources: ['src/nerve/fabricLifecycleShader.ts'],
    material: () => makeFabricTrunkPass(fabricLifecycleLayer(), 4).material,
  },
  {
    name: 'bridge tapered capsule',
    sources: ['src/geometry/screenSpaceCapsuleLine.ts'],
    // CellBridgeNerves: screen capsule, no GPU lifecycle, per-instance width.
    material: () =>
      makeFatLineLayer(FABRIC_SEGMENTS, 2.4, 'screen', true, false, true)
        .material,
  },
  {
    name: 'fat line (stock, non-dashed)',
    sources: [],
    // The baseline every unpatched LineMaterial in the HUD cores pays: four
    // stock endpoint attributes, plus three's prefix.
    material: () => makeFatLineLayer(FABRIC_SEGMENTS, 1, 'additive').material,
  },
  {
    name: 'spikePool',
    sources: ['src/nerve/spikePool.ts'],
    material: () => new SpikePool(1).material,
  },
  {
    name: 'dendriticBurstMaterial',
    sources: ['src/nerve/DendriticBurst.tsx'],
    material: makeDendriticBurstMaterial,
  },
  {
    name: 'colonyEdgeMaterial',
    sources: ['src/components/ColonyEdges.tsx'],
    material: makeColonyEdgeMaterial,
  },
  {
    name: 'cohortFaceMaterial',
    sources: ['src/materials/colonyCohort.ts'],
    material: makeCohortFaceMaterial,
    // The disc lying in the colony plane: the mat4, one seed lane and the
    // gulp lane the window's flare reads.
    usage: { instanced: true },
  },
  {
    name: 'cohortAuraMaterial',
    sources: ['src/materials/colonyCohort.ts'],
    material: makeCohortAuraMaterial,
    // The halo around it takes the SAME instance positions and the SAME seed
    // lane, consumed identically — they are two draws of one hole, not two
    // marks. It does NOT take the gulp: the skirt is the mark's support at a
    // low camera, and a support that flared on the win would be a second
    // opinion about an instant two other layers already state.
    usage: { instanced: true },
  },
  {
    name: 'cohortIntakePatchMaterial',
    sources: ['src/materials/colonyMist.ts'],
    material: makeCohortIntakePatchMaterial,
    // The mist under the mark: one instance per cohort, its sink at its own
    // origin. It takes the mat4, the SAME two lanes the face takes — the seed
    // and the gulp, because the mouth and the mist under it are one surface and
    // must swallow the same block — and a THIRD the face refuses: the share,
    // which is a rate this program has somewhere to spend.
    usage: { instanced: true },
  },
  {
    name: 'cohortLensMaterial',
    sources: ['src/materials/colonyLens.ts'],
    material: makeCohortLensMaterial,
    // The lensed mark: ONE camera-facing quad per cohort, and the whole image
    // computed inside it. It takes the mat4 and the layer's three lanes — the
    // same three the patch takes, off the same buffers, because it is the same
    // plan: the seed decorrelates the medium's two-phase clock, the gulp is the
    // block this cohort won, and the share is the SINK'S STRENGTH here exactly
    // as it is under the patch.
    usage: { instanced: true },
  },
  {
    name: 'canonicalRewriteEchoMaterial',
    sources: ['src/components/CanonicalRewriteEcho.tsx'],
    material: makeCanonicalRewriteEchoMaterial,
  },
  {
    name: 'glowNodeHaloMaterial',
    sources: [],
    material: () =>
      makeHaloMaterial({ edge: '#8ff', halo: '#8ff', fill: '#014' }),
  },
];

interface Measured {
  readonly name: string;
  readonly custom: number;
  readonly injected: number;
  readonly total: number;
  readonly names: readonly string[];
  readonly vertexShader: string;
  readonly defines: Defines;
}

function measure(row: BudgetRow): Measured {
  const material = row.material();
  const defines = definesFor(material, row.usage ?? {});
  const attributes = declaredAttributes(material.vertexShader, defines);
  let custom = 0;
  for (const [name, type] of attributes) {
    const slots = SLOTS_PER_TYPE[type];
    if (slots === undefined) {
      throw new Error(`${row.name}: unknown attribute type "${type} ${name}"`);
    }
    custom += slots;
  }
  const injected = injectedSlots(defines);
  return {
    name: row.name,
    custom,
    injected,
    total: custom + injected,
    names: [...attributes.keys()],
    vertexShader: material.vertexShader,
    defines,
  };
}

/** The budget landscape, so a failure shows what every neighbour costs. */
function renderTable(rows: readonly Measured[]): string {
  const width = Math.max(...rows.map(({ name }) => name.length));
  const header = `${'material'.padEnd(width)}  custom  injected  total/16  headroom`;
  const body = rows.map((row) => [
    row.name.padEnd(width),
    String(row.custom).padStart(6),
    String(row.injected).padStart(8),
    `${row.total}/16`.padStart(8),
    String(MAX_VERTEX_ATTRIBUTES - row.total).padStart(8),
  ].join('  '));
  return [header, '-'.repeat(header.length), ...body].join('\n');
}

describe('vertex attribute budget', () => {
  const measured = ROWS.map(measure);

  it('every vertex program fits the 16-slot budget', () => {
    const over = measured
      .filter((row) => row.total > MAX_VERTEX_ATTRIBUTES)
      .map((row) => row.name);
    expect(
      over.length === 0 ? '' : `over budget: ${over.join(', ')}\n\n${renderTable(measured)}`,
    ).toBe('');
  });

  it('never re-declares an attribute three already injects', () => {
    // Re-declaring one both double-books a slot and fails to compile.
    const injected = ['position', 'normal', 'uv', 'color', 'instanceMatrix', 'instanceColor'];
    for (const row of measured) {
      for (const name of injected) {
        expect(`${row.name}: ${row.names.includes(name)}`)
          .toBe(`${row.name}: false`);
      }
    }
  });

  it('charges every material that reaches for an instanced input', () => {
    // One-way: a shader that READS instanceMatrix/instanceColor must be on an
    // instanced row, so the mat4 and the vec3 are paid for. (The converse is
    // allowed: three injects them for any InstancedMesh, read or not.)
    for (const row of measured) {
      const source = preprocess(row.vertexShader, row.defines);
      if (/\binstanceMatrix\b/.test(source)) {
        expect(`${row.name}: ${row.defines.has('USE_INSTANCING')}`)
          .toBe(`${row.name}: true`);
      }
      if (/\binstanceColor\b/.test(source)) {
        expect(`${row.name}: ${row.defines.has('USE_INSTANCING_COLOR')}`)
          .toBe(`${row.name}: true`);
      }
    }
  });

  it('covers every file in src that declares an attribute', () => {
    const root = resolve(process.cwd(), 'src');
    const declaring: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        ATTRIBUTE_DECLARATION.lastIndex = 0;
        if (!ATTRIBUTE_DECLARATION.test(readFileSync(path, 'utf8'))) continue;
        declaring.push(relative(process.cwd(), path));
      }
    };
    walk(root);

    // Every GLSL `attribute` in the package answers to a row above. A new
    // shader family is ungated until it is listed, and this is the assertion
    // that says so — by name, so the next author knows what to add.
    const covered = new Set(ROWS.flatMap((row) => row.sources));
    expect(declaring.filter((path) => !covered.has(path))).toEqual([]);
    // …and a row may not name a file that stopped declaring anything, or the
    // coverage claim above quietly becomes vacuous.
    expect([...covered].filter((path) => !declaring.includes(path))).toEqual([]);
  });

  it('reads every shared buffer at the same width in both cell layers', () => {
    const hybridAttributes = declaredAttributes(
      makeCellHybridMaterial().vertexShader,
    );
    const flareAttributes = declaredAttributes(
      makeCellFlareMaterial().vertexShader,
    );

    // The body and its write flare draw off the SAME buffers — CellGalaxy
    // hands one BufferAttribute to both geometries — so a pair packed in one
    // material and left as scalars in the other would read garbage.
    for (const [name, type] of flareAttributes) {
      const hybridType = hybridAttributes.get(name);
      if (hybridType === undefined) continue;
      expect(`${name}: ${type}`).toBe(`${name}: ${hybridType}`);
    }
    expect(flareAttributes.get('aRecordAt')).toBe('vec2');
    expect(flareAttributes.get('aStageAt')).toBe('vec2');
    expect(hybridAttributes.get('aRecordAt')).toBe('vec2');
    expect(hybridAttributes.get('aStageAt')).toBe('vec2');
  });

  it('charges the mining channel its own row, and leaves the edge program alone', () => {
    // ⚠️ THE MINING CHANNEL IS ITS OWN PROGRAM. The row it replaced was a
    // `lineSegments` over the cohorts' own links at 5 custom + 3 injected = 8;
    // these two are InstancedMeshes, so each pays its lane plus the mat4 three
    // injects for instancing. Stated as exact numbers so a second lane is a
    // deliberate edit rather than a drift only the browser console would
    // report.
    const face = measured.find(({ name }) => name === 'cohortFaceMaterial');
    const aura = measured.find(({ name }) => name === 'cohortAuraMaterial');
    expect(face).toBeDefined();
    expect(aura).toBeDefined();
    expect([face?.custom, face?.injected, face?.total]).toEqual([2, 7, 9]);
    expect([aura?.custom, aura?.injected, aura?.total]).toEqual([1, 7, 8]);
    // ⚠️ THE TWO ROWS DIVERGED BY EXACTLY ONE FLOAT, AND THE ARGUMENT FOR IT IS
    // WHAT THIS COMMENT IS. They remain two draws of ONE hole and take the same
    // instance positions and the same seed lane. What the face has and the aura
    // has not is `aGulp` — the sim second of the block this cohort won, which
    // the WINDOW reads: the mouth brightens from the inside on the block it
    // swallowed. The skirt is the mark's support at a low camera and does not
    // take it, so this asymmetry is a consumer and not a habit. That is the
    // difference from the pair this replaced, which was asymmetric because the
    // marched intake declared `aShare` for a crest rate the centre did not
    // have; NEITHER aperture program declares the share — the mist's patch
    // does, and the row above charges it there, because the sink's k is the
    // only rate in the feature a share can drive. One float, on one draw, with
    // a reader — and 7 slots of the 16 still free on the busier of the two.
    expect(face?.names).toEqual(['aSeed', 'aGulp']);
    expect(aura?.names).toEqual(['aSeed']);
    for (const row of [face, aura]) {
      expect(row?.names).not.toContain('aShare');
      expect(row?.total).toBeLessThanOrEqual(9);
    }
  });

  it('charges the mist the mouth’s two lanes PLUS the share, and nothing else', () => {
    // ⭐⭐ THE PATCH AND THE FACE ARE ONE SURFACE SEEN TWO WAYS — through the
    // hole and from outside it — so they take the same first two lanes:
    // `aSeed` and `aGulp`, in that order, at the same widths, off the same
    // buffers. A patch that read the gulp at a different width would swallow on
    // a different block, and nothing but this row would say so.
    //
    // ⭐⭐⭐ AND EXACTLY ONE FLOAT SEPARATES THEM, WITH A CONSUMER BEHIND IT.
    // `aShare` is the cohort's fraction of its window, and the mist is the only
    // program in the feature with a RATE to spend it on: the sink's k is
    // wu²/s, so `mix(uShareFloor, 1, share / uShareMax)` scales a speed and the
    // pile that speed leaves at the lip. The aperture's only candidate rate is
    // the grain's drift, which prefilters to nothing past about 25 wu — so the
    // two faces refuse the lane, and this row is where the asymmetry is priced.
    // The layer's busiest program was 9 of 16 before it and is 10 now.
    const patch = measured.find(({ name }) => name === 'cohortIntakePatchMaterial');
    const face = measured.find(({ name }) => name === 'cohortFaceMaterial');
    expect(patch).toBeDefined();
    expect([patch?.custom, patch?.injected, patch?.total]).toEqual([3, 7, 10]);
    expect(patch?.names).toEqual(['aSeed', 'aGulp', 'aShare']);
    // The face's lanes are the patch's first two, in the same order.
    expect(patch?.names.slice(0, 2)).toEqual(face?.names);
    expect((patch?.custom ?? 0) - (face?.custom ?? 0)).toBe(1);
    // ⚠️ AND IT IS THE ONLY MIST ROW. A `mistHazeMaterial` stood beside it —
    // uninstanced, no lanes, 3 injected slots — for the ambient sheets under
    // the whole colony; they were removed on 2026-09-02 after a live leg
    // measured them at 2/255 at their brightest pixel anywhere on the canvas
    // while costing 0.90 ms of the layer's 1.06 ms at the app camera.
    expect(measured.some(({ name }) => name === 'mistHazeMaterial')).toBe(false);
    // Six slots still free on the busiest program in the layer.
    expect(MAX_VERTEX_ATTRIBUTES - (patch?.total ?? 0)).toBe(6);
  });

  it('charges the lensed cohort the same three lanes, and not one more', () => {
    // ⭐⭐⭐ THE WHOLE IMAGE IS COMPUTED IN THE FRAGMENT, so the vertex stage is
    // the cheapest in the feature: a quad, an origin, three floats. Everything
    // the picture needs — the mass, the disc, the fold, the trace — arrives as
    // uniforms, which is what makes a 64-cohort cap cost this layer nothing.
    //
    // ⚠️ AND THE LANES ARE THE PATCH'S, OBJECT FOR OBJECT. `ColonyCohorts` hands
    // ONE `InstancedBufferAttribute` per lane to every geometry in the layer; a
    // second wrapper over the same array is a second GL buffer and the first one
    // is orphaned. Equal names at equal widths in equal order is what this row
    // can check from here, and it is the half that catches a re-declaration.
    const lens = measured.find(({ name }) => name === 'cohortLensMaterial');
    const patch = measured.find(({ name }) => name === 'cohortIntakePatchMaterial');
    expect(lens).toBeDefined();
    expect([lens?.custom, lens?.injected, lens?.total]).toEqual([3, 7, 10]);
    expect(lens?.names).toEqual(['aSeed', 'aGulp', 'aShare']);
    expect(lens?.names).toEqual(patch?.names);
    // Six slots still free, on the busiest program the colony draws.
    expect(MAX_VERTEX_ATTRIBUTES - (lens?.total ?? 0)).toBe(6);
  });

  it('keeps the colony edge program exactly where it was', () => {
    // ⚠️ THE MINING CHANNEL IS ITS OWN PROGRAM, AND THE BUDGET IS HALF THE
    // REASON. The obvious shape was a mining term folded into
    // `colonyEdgeMaterial` — one draw instead of two — and it would have put
    // more lanes on the busiest vertex program in this scene AND made every
    // producer-set change rewrite a lane across every edge in the colony, most
    // of them zero. Stated as an exact number so a seventh lane here is a
    // deliberate edit rather than a drift the browser console alone would
    // report.
    const edges = measured.find(({ name }) => name === 'colonyEdgeMaterial');
    expect(edges).toBeDefined();
    expect([edges?.custom, edges?.injected, edges?.total]).toEqual([6, 3, 9]);
  });

  it('leaves the cell body one packing away from the ceiling', () => {
    // The tightest material in the scene, and the one that overran last time.
    // Stated as an exact number so growth here is a deliberate edit, not a
    // drift that only the browser console would report.
    const hybrid = measured.find(({ name }) => name === 'cellHybridMaterial');
    expect(hybrid).toBeDefined();
    expect([hybrid?.custom, hybrid?.injected, hybrid?.total]).toEqual([10, 3, 13]);
  });

  it('preprocesses the branches a driver would drop', () => {
    const source = [
      'attribute float always;',
      '#ifdef USE_DASH',
      'attribute float dashed;',
      '#else',
      'attribute float solid;',
      '#endif',
      '#if SOMETHING_ELSE',
      'attribute float unknownBranch;',
      '#endif',
    ].join('\n');
    expect([...declaredAttributes(source, new Set()).keys()])
      .toEqual(['always', 'solid', 'unknownBranch']);
    expect([...declaredAttributes(source, new Set(['USE_DASH'])).keys()])
      .toEqual(['always', 'dashed', 'unknownBranch']);
  });
});
