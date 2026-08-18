import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const FIELD_SOURCE = read('src/components/CellPopulationField.tsx');
const GALAXY_SOURCE = read('src/components/CellGalaxy.tsx');
const PLACEMENT_SOURCE = read('src/geometry/populationFieldPlacement.ts');
const MATERIAL_SOURCE = read('src/materials/populationFieldMaterial.ts');
const WORKER_SOURCE = read('src/geometry/populationField.worker.ts');

/** Prose is not code. These rules are about what the module DOES, and a
 *  comment naming the system it deliberately stays out of must not read as a
 *  violation of the rule it is explaining. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FIELD_CODE = withoutComments(FIELD_SOURCE);
const PLACEMENT_CODE = withoutComments(PLACEMENT_SOURCE);
const MATERIAL_CODE = withoutComments(MATERIAL_SOURCE);
/** Every module the halo is made of. The geometry moved out of the component
 *  when the layer became points, so the rules below have to follow it. */
const LAYER_CODE = [FIELD_CODE, PLACEMENT_CODE, MATERIAL_CODE,
  withoutComments(WORKER_SOURCE)].join('\n');

describe('the halo is not an object', () => {
  it('answers no raycast', () => {
    // Structurally it is already unreachable — no pointer handler, so it never
    // joins the interaction list, and it is a sibling of the pick object
    // rather than a descendant. The override is the defensive layer, and a
    // point cloud earns it twice over: unlike a bare Object3D, points ship a
    // real default raycast against a one-unit sphere per vertex.
    expect(FIELD_SOURCE).toContain('function neverRaycast(): void {}');
    expect(FIELD_SOURCE).toContain('raycast={neverRaycast}');
  });

  it('registers no pointer handler of any kind', () => {
    expect(LAYER_CODE).not.toMatch(/onPointer[A-Z]/);
    expect(LAYER_CODE).not.toMatch(/onClick/);
    expect(LAYER_CODE).not.toMatch(/onDoubleClick/);
    // Affordance is now the WHOLE of the not-addressable message, since the
    // points do resolve on a fly-in. No cursor change either.
    expect(LAYER_CODE).not.toContain('cursor');
  });

  it('never reaches a Cell-identity system', () => {
    // No ids, no outpoints, no topology, no pulses, no recall, no selection.
    for (const forbidden of [
      'cellsListRef',
      'CellPicker',
      'ScreenSpaceHitIndex',
      'neighborGraph',
      'pos_seed',
      'out_point',
      'content_hash',
      'selectedCellId',
      'helixSeedF64',
    ]) {
      expect(LAYER_CODE).not.toContain(forbidden);
    }
  });

  it('carries no enrichment source, only a derived number', () => {
    expect(FIELD_CODE).not.toContain('semantics');
    expect(FIELD_CODE).not.toContain('census');
    expect(FIELD_SOURCE).toContain('gain: number');
  });
});

describe('the halo responds to no chain event', () => {
  it('has no block, birth, death or transaction channel', () => {
    // A block affects specific Cells. Brightening an aggregate would claim
    // that unknown Cells participated in it.
    for (const forbidden of [
      'lastPulseAtMs',
      'blockPulse',
      'pulseLinks',
      'recentLinks',
      'aFlashAt',
      'BIRTH_DURATION',
      'linkPrune',
    ]) {
      expect(LAYER_CODE).not.toContain(forbidden);
    }
  });
});

describe('one static buffer and one draw', () => {
  it('keeps the two-pass pipeline out of the tree', () => {
    // The density march, the suppression shader, the line-integral grain, the
    // speck mask, the baked field, the quarter-res target and the composite
    // are all gone. A screen-space construction was tried four times and
    // failed four times for the same two structural reasons; a fifth is not
    // an experiment, it is a repeat.
    for (const gone of [
      'setRenderTarget',
      'WebGLRenderTarget',
      'uSteps',
      'uDensity',
      'densityScene',
      'compositeMaterial',
      'tissueFieldBake',
      'uFibre',
      'uSwarmPhase',
      'uBlooms',
      'HalfFloatType',
    ]) {
      expect(LAYER_CODE).not.toContain(gone);
    }
  });

  it('leaves gl.info alone', () => {
    // RenderStatsSampler owns that accounting.
    expect(LAYER_CODE).not.toContain('gl.info');
    expect(LAYER_CODE).not.toContain('autoReset');
  });

  it('does no per-frame work proportional to anything', () => {
    // Three uniform writes. No loop of any kind inside the frame callback:
    // the geometry is static and the layer's only frame cost is its draw.
    const frame = FIELD_CODE.slice(
      FIELD_CODE.indexOf('useFrame((state)'),
      FIELD_CODE.indexOf('if (!geometry'),
    );
    expect(frame.length).toBeGreaterThan(0);
    expect(frame).not.toMatch(/\bfor\b|\bwhile\b|\.forEach\(|\.map\(/);
  });

  it('places off the main thread', () => {
    // A second of CPU is a long task, and it would arrive while the page is
    // still assembling itself. Spreading it across frames would trade that
    // for ten seconds of absence instead.
    expect(FIELD_SOURCE).toContain("new URL('../geometry/populationField.worker.ts'");
    expect(FIELD_CODE).toContain('worker.terminate()');
    // And the main-thread module never runs the pass itself: the placement
    // entry point is reached only from inside the worker.
    expect(FIELD_CODE).not.toContain('placePopulationField');
    expect(FIELD_CODE).not.toContain('advancePopulationPlacement');
  });
});

describe('degradation', () => {
  it('renders nothing at all until the buffer lands', () => {
    // Absence is a legal state for this layer, and it is the whole of the
    // "not ready" behaviour — there is no partial field to show.
    expect(FIELD_SOURCE).toContain('if (!geometry || !wanted) return null;');
  });

  it('places nothing when the stage covers its scope', () => {
    // Gain zero is the correct degenerate case, and it must not spend a
    // worker, a second of CPU, and three megabytes to state nothing.
    expect(FIELD_SOURCE).toContain('const wanted = gain > 0;');
    expect(FIELD_SOURCE).toContain('if (!wanted || startedRef.current) return undefined;');
  });

  it('survives an environment with no worker', () => {
    expect(FIELD_SOURCE).toContain("if (typeof Worker === 'undefined') return undefined;");
  });

  it('lets quality trim cost without changing what is stated', () => {
    // The count is a population statement, so it does not scale with a
    // preset. What already scales for free is the DPR cascade: the sprite is
    // sized in drawing-buffer pixels, so high/med/low pay 4x/2.25x/1x for the
    // same field at the same apparent brightness and the same point count.
    expect(FIELD_CODE).not.toMatch(/high:|med:|low:/);
    expect(FIELD_CODE).not.toContain('QUALITY_PRESETS');
    expect(FIELD_CODE).toContain('uPixelRatio');
  });
});

describe('the halo is smaller and dimmer than a Cell, and differs in nothing else', () => {
  /** Read a numeric constant out of a module rather than restating it, so
   *  this stays a guard on the RELATIONSHIP and not a second copy of the
   *  numbers it compares. */
  function constant(source: string, name: string): number {
    const match = source.match(
      new RegExp(`${name}\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?)`),
    );
    expect(match, `${name} not found`).not.toBeNull();
    return Number(match![1]);
  }

  it('is smaller than the smallest Cell sprite on the stage', () => {
    // Cell sprite = base * morphology, morphology = 0.58 + 0.72 * u^2 (+ a
    // rare plain-Cell bonus), so the floor is the generic base at u = 0.
    const generic = constant(GALAXY_SOURCE, 'GENERIC_CELL_POINT_SIZE');
    const morphologyFloor = 0.58;
    const smallestCell = generic * morphologyFloor;
    const halo = constant(MATERIAL_SOURCE, 'POPULATION_FIELD_POINT_SIZE');

    expect(halo).toBeLessThan(smallestCell);
    // And well under a typical one — a tagged Cell at mean morphology.
    const tagged = constant(GALAXY_SOURCE, 'TAGGED_CELL_POINT_SIZE');
    expect(halo).toBeLessThan(tagged * (0.58 + 0.72 / 3) * 0.5);
  });

  it("cannot reach a Cell core's brightness at any density", () => {
    // The blend is a bounded accumulation whose fixed point is the emitted
    // alpha, so the emission constant IS the ceiling a saturated patch
    // converges to. Cell bodies emit up to ~1.18 and converge to white.
    const emission = constant(MATERIAL_SOURCE, 'POPULATION_FIELD_EMISSION');
    expect(emission).toBeGreaterThan(0);
    expect(emission).toBeLessThan(1);
  });

  it('has no white-hot core, no wash, and no ring', () => {
    // The three things that would make a halo point read as a small Cell.
    expect(MATERIAL_CODE).not.toContain('warmWhite');
    expect(MATERIAL_CODE).not.toContain('wash');
    expect(MATERIAL_CODE).not.toContain('Ring');
    // One Gaussian, and only one.
    expect((MATERIAL_SOURCE.match(/exp\(/g) ?? [])).toHaveLength(1);
  });

  it('emits the body hue and no identity hue', () => {
    expect(MATERIAL_CODE).toContain('CELL_GALAXY_PALETTE.tissueRose');
    for (const forbidden of ['asset', 'lock', 'tag', 'memoryViolet']) {
      expect(MATERIAL_CODE).not.toContain(forbidden);
    }
  });
});

describe('where CellGalaxy mounts it', () => {
  it('sits inside the rotating group, beneath the Cell bodies', () => {
    const group = GALAXY_SOURCE.indexOf('<group ref={groupRef}');
    const field = GALAXY_SOURCE.indexOf('<CellPopulationField', group);
    const bodies = GALAXY_SOURCE.indexOf('<points', group);

    expect(group).toBeGreaterThan(-1);
    expect(field).toBeGreaterThan(group);
    // Inside the rotating group is the whole point: the halo turns with the
    // Cells, with the same parallax, as one body. The failure this design
    // fixes is a layer that shimmers in place while the galaxy turns, and it
    // is invisible in every still.
    expect(field).toBeLessThan(bodies);
  });

  it('hands it an amount and nothing else', () => {
    expect(GALAXY_SOURCE).toContain('<CellPopulationField gain={populationGain} />');
  });

  it('has no membership bloom left to feed', () => {
    // The blooms were drawn by the composite pass, and under this design a
    // field-local bloom lands exactly where the complement has removed every
    // point. It cannot be seen, so it is not decoration to leave behind.
    for (const gone of [
      'populationFieldBlooms',
      'spawnMembershipBlooms',
      'createPopulationBloomPool',
      'bloomedDisplayTokenRef',
    ]) {
      expect(GALAXY_SOURCE).not.toContain(gone);
    }
  });
});
