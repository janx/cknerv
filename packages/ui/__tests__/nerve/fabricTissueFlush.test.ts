import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  optimizeScreenSpaceCapsuleMaterial,
} from '../../src/geometry/screenSpaceCapsuleLine';
import {
  enableFabricLifecycleMaterial,
  syncFabricLifecycleUniforms,
  FLUSH_HALF_WIDTH,
  FLUSH_WAKE_AMP,
} from '../../src/nerve/fabricLifecycleShader';
import {
  makeFabricTrunkPass,
  makeFatLineLayer,
} from '../../src/nerve/NeuralFabric';
import {
  resetTissueFlush,
  stampTissueFlush,
  tissueFlush,
  TISSUE_FLUSH_SENTINEL,
  TISSUE_FLUSH_SLOTS,
} from '../../src/tweaks/tissueFlush';
import {
  CONTACT_FRONT_FALLOFF_REFERENCE,
  CONTACT_FRONT_ONSET,
  CONTACT_FRONT_REACH_KNEE,
  CONTACT_FRONT_START_RADIUS,
} from '../../src/derives/peers.derive';
import { WAVE_WAKE_LENGTH } from '../../src/materials/shockwaveMaterial';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';
import { LIVE } from '../../src/tweaks/liveTweaks';
import { deliverySchema } from '../../src/tweaks/tweakSchema';

/** The fabric layer's real material stack: capsule + lifecycle. */
function makeFabricStackMaterial(pass?: number): LineMaterial {
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: 2.5,
    transparent: true,
    worldUnits: false,
  });
  optimizeScreenSpaceCapsuleMaterial(material);
  return enableFabricLifecycleMaterial(material, pass);
}

/** The shader's own float spelling (fabricLifecycleShader `glf`): ints get a
 *  decimal point so they stay floats. */
const glf = (value: number): string => (
  /[.e]/i.test(String(value)) ? String(value) : `${value}.0`
);

beforeEach(() => resetTissueFlush());
afterEach(() => resetTissueFlush());

describe('the tissue flush ring (tweaks/tissueFlush)', () => {
  it('rests empty: every slot at the sentinel, flat lanes sized to the ring', () => {
    expect(TISSUE_FLUSH_SLOTS).toBe(16);
    expect(tissueFlush.at).toHaveLength(TISSUE_FLUSH_SLOTS);
    expect(tissueFlush.originXZ).toHaveLength(TISSUE_FLUSH_SLOTS * 2);
    expect(tissueFlush.color).toHaveLength(TISSUE_FLUSH_SLOTS * 3);
    expect(tissueFlush.reach).toHaveLength(TISSUE_FLUSH_SLOTS);
    expect(tissueFlush.amp).toHaveLength(TISSUE_FLUSH_SLOTS);
    for (const lane of [
      tissueFlush.at, tissueFlush.originXZ, tissueFlush.color,
      tissueFlush.reach, tissueFlush.amp,
    ]) expect(lane).toBeInstanceOf(Float32Array);
    expect([...tissueFlush.at].every((at) => at === TISSUE_FLUSH_SENTINEL)).toBe(true);
    expect(tissueFlush.cursor).toBe(0);
  });

  it('the sentinel sits so far in the past that any sim clock reads it as long expired', () => {
    // The shader skips a slot on `age >= window` alone — no flag lane — so
    // the sentinel must survive float32 and stay past every window at any
    // sim time a session can reach.
    expect(TISSUE_FLUSH_SENTINEL).toBeLessThanOrEqual(-1e8);
    expect(Math.fround(TISSUE_FLUSH_SENTINEL)).toBeLessThanOrEqual(-1e8);
    expect(0 - Math.fround(TISSUE_FLUSH_SENTINEL))
      .toBeGreaterThan(deliverySchema.ingestDur.max);
  });

  it('stamps all five lanes of one slot and walks the ring round-robin', () => {
    const slot = stampTissueFlush(120.25, [3.5, -4.25], [0.9, 0.6, 0.2], 6.5, 1);
    expect(slot).toBe(0);
    expect(tissueFlush.at[0]).toBeCloseTo(120.25, 5);
    expect(tissueFlush.originXZ[0]).toBeCloseTo(3.5, 6);
    expect(tissueFlush.originXZ[1]).toBeCloseTo(-4.25, 6);
    expect(tissueFlush.color[0]).toBeCloseTo(0.9, 6);
    expect(tissueFlush.color[1]).toBeCloseTo(0.6, 6);
    expect(tissueFlush.color[2]).toBeCloseTo(0.2, 6);
    expect(tissueFlush.reach[0]).toBeCloseTo(6.5, 6);
    expect(tissueFlush.amp[0]).toBe(1);
    expect(tissueFlush.cursor).toBe(1);
    // Every other slot is untouched.
    for (let i = 1; i < TISSUE_FLUSH_SLOTS; i += 1) {
      expect(tissueFlush.at[i]).toBe(TISSUE_FLUSH_SENTINEL);
    }
    // Fill the ring…
    for (let i = 1; i < TISSUE_FLUSH_SLOTS; i += 1) {
      expect(stampTissueFlush(200 + i, [i, -i], [0, 0, 1], 4.25, 0.7)).toBe(i);
    }
    expect(tissueFlush.cursor).toBe(0);
    // …and the seventeenth stamp overwrites the oldest slot, nothing else.
    expect(stampTissueFlush(300, [1, 2], [1, 1, 1], 1, 0.5)).toBe(0);
    expect(tissueFlush.at[0]).toBe(300);
    expect(tissueFlush.reach[0]).toBe(1);
    expect(tissueFlush.amp[0]).toBe(0.5);
    expect(tissueFlush.at[1]).toBe(201);
    expect(tissueFlush.at[TISSUE_FLUSH_SLOTS - 1]).toBe(200 + TISSUE_FLUSH_SLOTS - 1);
    expect(tissueFlush.cursor).toBe(1);
  });

  it('resets IN PLACE — the arrays the shader is bound to keep their identity', () => {
    const before = {
      at: tissueFlush.at,
      originXZ: tissueFlush.originXZ,
      color: tissueFlush.color,
      reach: tissueFlush.reach,
      amp: tissueFlush.amp,
    };
    for (let i = 0; i < 5; i += 1) stampTissueFlush(10 + i, [1, 1], [1, 0, 0], 3, 1);
    resetTissueFlush();
    expect(tissueFlush.at).toBe(before.at);
    expect(tissueFlush.originXZ).toBe(before.originXZ);
    expect(tissueFlush.color).toBe(before.color);
    expect(tissueFlush.reach).toBe(before.reach);
    expect(tissueFlush.amp).toBe(before.amp);
    expect([...tissueFlush.at].every((at) => at === TISSUE_FLUSH_SENTINEL)).toBe(true);
    expect([...tissueFlush.reach].every((r) => r === 0)).toBe(true);
    expect(tissueFlush.cursor).toBe(0);
  });
});

describe('the fibre flush — the fabric shader twin of the contact front', () => {
  it('declares the five slot lanes at the ring size and the five knob scalars', () => {
    const vertex = makeFabricStackMaterial().vertexShader;
    for (const declaration of [
      `uniform float fabricFlushAt[${TISSUE_FLUSH_SLOTS}];`,
      `uniform vec2 fabricFlushOrigin[${TISSUE_FLUSH_SLOTS}];`,
      `uniform vec3 fabricFlushColor[${TISSUE_FLUSH_SLOTS}];`,
      `uniform float fabricFlushReach[${TISSUE_FLUSH_SLOTS}];`,
      `uniform float fabricFlushPunch[${TISSUE_FLUSH_SLOTS}];`,
      'uniform float fabricFlushWindow;',
      'uniform float fabricFlushSpeed;',
      'uniform float fabricFlushFalloff;',
      'uniform float fabricFlushAmp;',
      'uniform float fabricFlushMix;',
    ]) expect(vertex).toContain(declaration);
    // Uniforms, never vertex inputs: the fabric stack sits on the location
    // cliff (vertexAttributeBudget.test.ts), and a flush lane per vertex
    // would also be the wrong shape — a front is per event, not per edge.
    expect(vertex).not.toMatch(/attribute\s+\w+\s+fabricFlush/);
  });

  it('binds the singleton lanes by REFERENCE on both passive passes — never a copy', () => {
    const fabric = makeFatLineLayer(32, 2.5, 'screen', true, true);
    const trunk = makeFabricTrunkPass(fabric, 4.4);
    for (const material of [fabric.material, trunk.material]) {
      expect(material.uniforms.fabricFlushAt.value).toBe(tissueFlush.at);
      expect(material.uniforms.fabricFlushOrigin.value).toBe(tissueFlush.originXZ);
      expect(material.uniforms.fabricFlushColor.value).toBe(tissueFlush.color);
      expect(material.uniforms.fabricFlushReach.value).toBe(tissueFlush.reach);
      expect(material.uniforms.fabricFlushPunch.value).toBe(tissueFlush.amp);
    }
    // A stamp is therefore visible to both passes with no sync at all.
    stampTissueFlush(77, [2, 3], [1, 0.5, 0.25], 4.25, 0.7);
    expect(fabric.material.uniforms.fabricFlushAt.value[0]).toBe(77);
    expect(trunk.material.uniforms.fabricFlushReach.value[0]).toBeCloseTo(4.25, 6);
    // And the sync does not re-point them.
    syncFabricLifecycleUniforms(fabric.material, 80);
    syncFabricLifecycleUniforms(trunk.material, 80);
    expect(fabric.material.uniforms.fabricFlushAt.value).toBe(tissueFlush.at);
    expect(trunk.material.uniforms.fabricFlushAt.value).toBe(tissueFlush.at);
  });

  it('runs the front\'s own radius function: contactFrontState\'s literals, the LIVE falloff power, the shared crest+wake profile', () => {
    const vertex = makeFabricStackMaterial().vertexShader;
    const start = glf(CONTACT_FRONT_START_RADIUS);
    const knee = glf(CONTACT_FRONT_REACH_KNEE);
    const reference = glf(CONTACT_FRONT_FALLOFF_REFERENCE);
    // crestRadius(age) = START + speed · age, from the sim clock and the slot.
    expect(vertex).toContain('float age = fabricSimTimeSec - fabricFlushAt[ i ];');
    expect(vertex).toContain(`float crestRadius = ${start} + fabricFlushSpeed * age;`);
    // Reach clamped to what the window can complete (contactFrontReachCeiling).
    expect(vertex).toContain(`${start} + fabricFlushSpeed * fabricFlushWindow`);
    // Knee extinction: 1 − smoothUnit((r − reach·KNEE) / (reach·(1 − KNEE))).
    expect(vertex).toContain(`( crestRadius - cappedReach * ${knee} )`);
    expect(vertex).toContain(`/ max( cappedReach * ( 1.0 - ${knee} ), 1e-4 )`);
    // 1/r from the falloff reference at the LIVE power — a uniform, not a
    // literal, because the annulus reads LIVE.delivery.waveFalloff per frame.
    expect(vertex).toMatch(
      new RegExp(`pow\\(\\s*${reference.replace('.', '\\.')} / \\( ${reference.replace('.', '\\.')} \\+ crestRadius \\),\\s*fabricFlushFalloff\\s*\\)`),
    );
    // The strength envelope (contactRelease): linear life over the window
    // with the same onset, and the same easeOutCubic colour arc toward the
    // tissue's own rose.
    expect(vertex).toContain(`float life = ( 1.0 - u ) * smoothstep( 0.0, 1.0, u / ${glf(CONTACT_FRONT_ONSET)} );`);
    expect(vertex).toContain('float colorT = 1.0 - ( 1.0 - u ) * ( 1.0 - u ) * ( 1.0 - u );');
    const [rr, rg, rb] = CELL_GALAXY_PALETTE.tissueRose;
    expect(vertex).toContain(`mix( fabricFlushColor[ i ], vec3( ${glf(rr)}, ${glf(rg)}, ${glf(rb)} ), colorT )`);
    // The ONE crest+wake waveform of a block event, at the flush's width.
    expect(vertex).toContain('float waveCrestWake(');
    expect(FLUSH_HALF_WIDTH).toBe(0.9);
    expect(FLUSH_WAKE_AMP).toBe(0.6);
    expect(vertex).toMatch(new RegExp(
      `waveCrestWake\\(\\s*\\( dist - crestRadius \\) / ${glf(FLUSH_HALF_WIDTH)},\\s*crestRadius - dist,\\s*${glf(FLUSH_HALF_WIDTH)},\\s*${glf(WAVE_WAKE_LENGTH)},\\s*${glf(FLUSH_WAKE_AMP)}\\s*\\)`,
    ));
    // Every slot lane is read; the punch scales the signal, not the reach.
    expect(vertex).toContain('* reachFade * falloff * life * fabricFlushPunch[ i ];');
    expect(vertex).toContain('float dist = length( xz - fabricFlushOrigin[ i ] );');
  });

  it('samples at each capsule ENDPOINT in the vertex stage — never per fragment', () => {
    const material = makeFabricStackMaterial();
    const vertex = material.vertexShader;
    expect(vertex).toContain('vec4 flushStart = fabricFlushGl( fabricLifeStart.xz );');
    expect(vertex).toContain('vec4 flushEnd = fabricFlushGl( fabricLifeEnd.xz );');
    // One definition, two call sites: the endpoints, nothing else.
    expect(vertex.match(/fabricFlushGl\(/g)).toHaveLength(3);
    // Sampled after the endpoints are resolved and before the colours are.
    const endpoints = vertex.indexOf('fabricLifeEnd = fabricBezierAt( tB );');
    const sample = vertex.indexOf('vec4 flushStart = fabricFlushGl(');
    const colours = vertex.indexOf('fabricLifeColorStart = fabricSampleColorGl(');
    expect(endpoints).toBeGreaterThan(-1);
    expect(sample).toBeGreaterThan(endpoints);
    expect(colours).toBeGreaterThan(sample);
    expect(material.fragmentShader).not.toContain('fabricFlush');
    expect(material.fragmentShader).not.toContain('waveCrestWake');
  });

  it('lifts through the reclaim like a death flash and tints by the mix — both the identity at 0 (zero-drift)', () => {
    const vertex = makeFabricStackMaterial().vertexShader;
    // Reclaim: the flush joins the death flash under ONE max — a flush at the
    // galaxy core lifts fibres OUT of the centerDim² floor exactly as a
    // retirement does; a flash and a flush take the larger, never the sum;
    // and max(x, clamp(0)) is x to the bit.
    expect(vertex).toContain('max( clamp( flash, 0.0, 1.0 ), clamp( flush, 0.0, 1.0 ) )');
    expect(vertex).toMatch(
      /float semanticReclaim = max\(\s*max\( clamp\( flash, 0\.0, 1\.0 \), clamp\( flush, 0\.0, 1\.0 \) \),/,
    );
    expect(vertex).toContain('flush.a * fabricFlushAmp');
    // Tint: the semantic colour leans toward the flush's own by
    // clamp(signal · mix); mix(x, y, 0) is x to the bit.
    expect(vertex).toMatch(
      /sem = mix\(\s*sem,\s*flush\.rgb \/ max\( flush\.a, 1e-5 \),\s*clamp\( flush\.a \* fabricFlushMix, 0\.0, 1\.0 \)\s*\);/,
    );
    // And an empty slot never reaches either fold: skipped on the first
    // compare, so with every slot at the sentinel the twin adds exactly 0.
    expect(vertex).toContain('if ( age < 0.0 || age >= fabricFlushWindow ) continue;');
    expect(vertex).toContain('return vec4( carrier, total );');
    expect(vertex).toContain('float total = 0.0;');
    expect(vertex).toContain('vec3 carrier = vec3( 0.0 );');
    // The death colour arc is untouched: retire still rides `flash` alone.
    expect(vertex).toContain('* ( 1.0 - flash ) + retire * flash;');
    expect(vertex).not.toMatch(/retire \* flush/);
  });

  it('per-frame sync copies exactly the five block-impact scalars from LIVE', () => {
    const material = makeFabricStackMaterial();
    const saved = { ...LIVE.delivery };
    try {
      LIVE.delivery.ingestDur = 0.85;
      LIVE.delivery.waveSpeed = 6.25;
      LIVE.delivery.waveFalloff = 1.75;
      LIVE.delivery.flushAmp = 2.5;
      LIVE.delivery.flushMix = 0.15;
      syncFabricLifecycleUniforms(material, 42);
      expect(material.uniforms.fabricFlushWindow.value).toBe(0.85);
      expect(material.uniforms.fabricFlushSpeed.value).toBe(6.25);
      expect(material.uniforms.fabricFlushFalloff.value).toBe(1.75);
      expect(material.uniforms.fabricFlushAmp.value).toBe(2.5);
      expect(material.uniforms.fabricFlushMix.value).toBe(0.15);
    } finally {
      Object.assign(LIVE.delivery, saved);
    }
    // Shipped defaults seed the material before the first frame.
    const fresh = makeFabricStackMaterial();
    expect(fresh.uniforms.fabricFlushWindow.value).toBe(deliverySchema.ingestDur.value);
    expect(fresh.uniforms.fabricFlushSpeed.value).toBe(deliverySchema.waveSpeed.value);
    expect(fresh.uniforms.fabricFlushFalloff.value).toBe(deliverySchema.waveFalloff.value);
    expect(fresh.uniforms.fabricFlushAmp.value).toBe(deliverySchema.flushAmp.value);
    expect(fresh.uniforms.fabricFlushMix.value).toBe(deliverySchema.flushMix.value);
    expect(deliverySchema.flushAmp.value).toBe(1.0);
    expect(deliverySchema.flushMix.value).toBe(0.6);
  });
});
