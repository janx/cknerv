import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIELD_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/CellPopulationField.tsx'),
  'utf8',
);
const GALAXY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/CellGalaxy.tsx'),
  'utf8',
);

/** Prose is not code. These rules are about what the module DOES, and a
 *  comment naming the system it deliberately stays out of must not read as a
 *  violation of the rule it is explaining. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FIELD_CODE = withoutComments(FIELD_SOURCE);

describe('the medium is not an object', () => {
  it('answers no raycast', () => {
    // `ScreenSpaceHitIndex` plus `CellPicker` are the sole Cell hit surface. A
    // stray mesh with a real raycast would also regress the click-through
    // work the HUD gaps depend on.
    expect(FIELD_SOURCE).toContain('function neverRaycast(): void {}');
    expect(FIELD_SOURCE).toContain('raycast={neverRaycast}');
    expect(FIELD_SOURCE).toContain('mesh.raycast = neverRaycast');
  });

  it('registers no pointer handler of any kind', () => {
    expect(FIELD_CODE).not.toMatch(/onPointer[A-Z]/);
    expect(FIELD_CODE).not.toMatch(/onClick/);
    expect(FIELD_CODE).not.toMatch(/onDoubleClick/);
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
    ]) {
      expect(FIELD_CODE).not.toContain(forbidden);
    }
  });

  it('carries no enrichment source, only a derived number', () => {
    expect(FIELD_CODE).not.toContain('semantics');
    expect(FIELD_CODE).not.toContain('census');
    expect(FIELD_SOURCE).toContain('gain: number');
  });
});

describe('the medium responds to no chain event', () => {
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
      expect(FIELD_CODE).not.toContain(forbidden);
    }
  });
});

describe('the two passes', () => {
  it('renders density offscreen and restores the previous target', () => {
    expect(FIELD_SOURCE).toContain('gl.setRenderTarget(densityTarget)');
    // Leaving the renderer pointed at an offscreen target would take the
    // whole dashboard with it.
    expect(FIELD_SOURCE).toContain('gl.setRenderTarget(previousTarget)');
    expect(FIELD_SOURCE).toContain('gl.autoClear = previousAutoClear');
  });

  it('leaves gl.info alone', () => {
    // RenderStatsSampler owns that accounting; this pass accumulates into its
    // window like any other multi-pass frame.
    expect(FIELD_CODE).not.toContain('gl.info');
    expect(FIELD_CODE).not.toContain('autoReset');
  });

  it('tracks the camera rather than the simulated clock', () => {
    // The march must keep up with a camera that moves while time is paused,
    // so the pass is raw useFrame; only the grain phase reads sim time.
    expect(FIELD_SOURCE).toContain('useFrame((state)');
    expect(FIELD_CODE).not.toContain('useSimFrame');
    expect(FIELD_SOURCE).toContain('simClock.elapsedSec');
  });

  it('keeps the density pass under a quarter of native resolution', () => {
    const divisors = [...FIELD_SOURCE.matchAll(/densityDivisor: (\d+)/g)]
      .map((match) => Number(match[1]));

    expect(divisors.length).toBeGreaterThan(0);
    for (const divisor of divisors) expect(divisor).toBeGreaterThanOrEqual(4);
  });

  it('spends its march budget on the volume, not on the screen', () => {
    const steps = [...FIELD_SOURCE.matchAll(/steps: (\d+)/g)]
      .map((match) => Number(match[1]));

    expect(steps.length).toBe(3);
    for (const count of steps) expect(count).toBeLessThanOrEqual(8);
  });
});

describe('degradation', () => {
  it('renders nothing at all until the bake lands', () => {
    // Absence is a legal state; a half-baked field is not.
    // BOTH bakes, not just the law's: the fibre lands with it and the swarm
    // reads it every frame, so a field drawn before it arrived would be a
    // different layer for one frame — and a sampler bound to null is a black
    // texture, which would gate every speck off along a strand.
    expect(FIELD_SOURCE).toContain('textureRef.current !== null');
    expect(FIELD_SOURCE).toContain('&& fibreTextureRef.current !== null');
    expect(FIELD_SOURCE).toContain('&& gain > 0;');
    expect(FIELD_SOURCE).toContain('composite.visible = active');
  });

  it('spreads the bake against a per-frame budget', () => {
    expect(FIELD_SOURCE).toContain('BAKE_ROWS_PER_FRAME');
    expect(FIELD_SOURCE).toContain('advanceTissueFieldBake(bake, BAKE_ROWS_PER_FRAME)');
  });

  it('lets quality trim presentation without removing the field', () => {
    // High, med and low differ in bake resolution, march steps and pass
    // resolution — and in nothing else. None of them is absence.
    for (const preset of ['high:', 'med:', 'low:']) {
      expect(FIELD_SOURCE).toContain(preset);
    }
    expect(FIELD_CODE).not.toMatch(/quality === 'low'[^\n]*return null/);
  });

  it('freezes animation under reduced motion without moving an amount', () => {
    expect(FIELD_SOURCE).toContain('reducedMotion\n      ? 0');
    // ONE phase drives the whole bloom. Freezing the fade while the radius
    // kept growing produced more motion than the un-reduced path, not less.
    expect(FIELD_SOURCE).toContain('const phase = reducedMotion ? 0.5 : life;');
    expect(FIELD_SOURCE).toContain('0.55 + phase * 0.75');
    expect(FIELD_CODE).not.toContain('0.55 + life * 0.75');
  });

  it('re-bakes on a resolution change and on nothing else', () => {
    // med and low share a 256 bake. Re-baking for a march-step change would
    // spend a second of frame budget for a byte-identical texture, at exactly
    // the moment the adaptive controller downgraded because frames were slow.
    expect(FIELD_CODE)
      .toContain('if (bake && bake.resolution === preset.bake) return;');
    expect(FIELD_CODE).toContain('}, [preset.bake]);');
  });
});

describe('where CellGalaxy mounts it', () => {
  it('sits inside the rotating group, beneath the Cell bodies', () => {
    const group = GALAXY_SOURCE.indexOf('<group ref={groupRef}');
    const field = GALAXY_SOURCE.indexOf('<CellPopulationField', group);
    const bodies = GALAXY_SOURCE.indexOf('<points', group);

    expect(group).toBeGreaterThan(-1);
    expect(field).toBeGreaterThan(group);
    // Draw order is the layer contract: chain mesh, then the medium, then the
    // crisp records the medium gives context to.
    expect(field).toBeLessThan(bodies);
  });

  it('collects membership blooms before the render set forgets the exits', () => {
    const collect = GALAXY_SOURCE.indexOf('spawnMembershipBlooms(');
    const sync = GALAXY_SOURCE.indexOf('syncCellRenderSet(renderSet');

    // An exit's position is only knowable from the list it is about to leave.
    expect(collect).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(-1);
    expect(collect).toBeLessThan(sync);
  });

  it('never marks a death as a dissolve', () => {
    // Both resolvers refuse a record that is already dead: death owns its own
    // event, and playing both would double-count it to the eye.
    const resolvers = GALAXY_SOURCE.match(/cell\.death_at_ms === null \? cell\.pos_seed : null/g);
    expect(resolvers).toHaveLength(2);
  });

  it('suppresses blooms across a coalesced resettle', () => {
    expect(GALAXY_SOURCE)
      .toContain('displayChanges.reset || cellsCache.backfill !== null');
  });

  it('allocates its bloom ring once, outside the frame loop', () => {
    expect(GALAXY_SOURCE)
      .toContain('useRef(\n    createPopulationBloomPool(POPULATION_FIELD_MAX_BLOOMS),\n  )');
  });
});
