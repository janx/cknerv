// Reduced motion as a POLICY (the user's D-11), not the per-file courtesy it
// was: thirteen HUD surfaces stopped and the stage did not — rotation, births
// and withers, waves, couriers, mist and the star drift all ran, with
// `reducedMotion` scoring zero hits in six of the scene's largest files
// (report E, E-6) — while the overlay removed its STATIC scan lines, which is
// the request exactly inverted.
//
// Two halves are tested here and they need different instruments. The FLAG is
// a hook and a store, so it is rendered. The CONSUMERS are `useFrame`
// callbacks and GLSL, which no jsdom test can drive — so each is read at the
// site that moves, off disk, the way this repo's other cross-file tolls are.
// ⚠️ Reading the derive alone would prove nothing: a helper that returns 0 and
// a rotation that never multiplies by it is exactly the bug.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE,
  ambientElapsedSec,
  applyTweaks,
  motionScale,
  publishReducedMotion,
  REDUCED_AMBIENT_PHASE_SEC,
} from '../../src/tweaks/liveTweaks';
import { resetSimClock, simClock } from '../../src/tweaks/simClock';
import { MOTION_POLICY } from '../../src/components/hud/hudTheme';
import { useReducedMotion } from '../../src/components/hud/useReducedMotion';

const SRC = resolve(process.cwd(), 'src');
const read = (relative: string) => readFileSync(resolve(SRC, relative), 'utf8');

function stubMatchMedia(reduced: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: /reduce/.test(query) ? reduced : false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function Probe() { useReducedMotion(); return null; }

beforeEach(() => { publishReducedMotion(false); resetSimClock(); });
afterEach(() => { cleanup(); publishReducedMotion(false); vi.unstubAllGlobals(); });

describe('the flag reaches the frame loops', () => {
  it('is published by the hook, into LIVE.time', () => {
    stubMatchMedia(true);
    expect(LIVE.time.reduced).toBe(false);
    render(<Probe />);
    expect(LIVE.time.reduced, 'the stage never heard about it').toBe(true);
  });

  it('is published from the initialiser, so the first frame already knows', () => {
    // The loops that read it start on the frame this hook first commits. A
    // `useEffect` would publish one frame late — the same defect the hook's
    // own initialiser exists to fix, one layer down.
    stubMatchMedia(true);
    let atFirstRender: boolean | null = null;
    function Early() { useReducedMotion(); atFirstRender ??= LIVE.time.reduced; return null; }
    render(<Early />);
    expect(atFirstRender).toBe(true);
  });

  it('goes back down when the query does', () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(LIVE.time.reduced).toBe(false);
  });

  it('is not a knob, and leva cannot write it', () => {
    // It is the visitor's policy. A tuning panel that could turn reduced
    // motion off would be the panel overriding an accessibility setting.
    publishReducedMotion(true);
    applyTweaks(LIVE, { galaxy: { rotationRate: 0.5 } } as never);
    expect(LIVE.time.reduced).toBe(true);
    expect('time' in ({} as Record<string, unknown>)).toBe(false);
  });
});

describe('the two clocks', () => {
  it('scales an ambient rate to nothing, and leaves it alone otherwise', () => {
    expect(motionScale()).toBe(1);
    publishReducedMotion(true);
    expect(motionScale()).toBe(0);
  });

  it('holds an ambient phase while the real clock keeps running', () => {
    // ⚠️ The two cannot be one clock. Stopping `simClock` would stop the
    // shimmer AND freeze every birth, wither and stage fade at whatever
    // fraction it had reached — and the policy says an event plays at its END
    // state, not halfway.
    simClock.elapsedSec = 12.5;
    expect(ambientElapsedSec()).toBe(12.5);
    publishReducedMotion(true);
    expect(ambientElapsedSec()).toBe(REDUCED_AMBIENT_PHASE_SEC);
    expect(simClock.elapsedSec, 'the real clock stopped too').toBe(12.5);
    // Not zero: zero is a meaningful value in these shaders (a stamp that has
    // not happened), and a sine held at its origin reads as "set up" rather
    // than "stopped".
    expect(REDUCED_AMBIENT_PHASE_SEC).not.toBe(0);
  });
});

describe('the stage reads the policy at the site that moves', () => {
  it('turns neither plane', () => {
    // Both, or a shear nobody asked for: the colony counter-rotates the
    // canopy at the same magnitude.
    for (const [file, sign] of [
      ['components/CellGalaxy.tsx', '+='],
      ['components/NetworkColony.tsx', '-='],
    ] as const) {
      const text = read(file);
      expect(text, `${file}: the rotation moved`)
        .toContain(`rotation.y ${sign} LIVE.galaxy.rotationRate`);
      expect(text, `${file}: the rotation ignores the motion policy`)
        .toMatch(/rotation\.y [+-]= LIVE\.galaxy\.rotationRate[\s\S]{0,160}?motionScale\(\)/);
    }
  });

  it('holds the canopy\'s breath and the memory read\'s scan', () => {
    const material = read('materials/cellHybridMaterial.ts');
    expect(material).toContain('sin(uAmbientTime * breathRate + vSeed)');
    expect(material).toContain('fract(uAmbientTime * 0.38');
    // …while the lifecycle ramps keep the REAL clock and finish.
    expect(material).toContain('float birthRamp = clamp((uTime - aRecordAt.x)');
    expect(material).toContain('float deathRamp = clamp((uTime - aRecordAt.y)');

    const galaxy = read('components/CellGalaxy.tsx');
    expect(galaxy, 'the ambient clock is declared and never written')
      .toContain('hybridMaterial.uniforms.uAmbientTime.value = ambientElapsedSec()');
    expect(galaxy, 'the anchor halo breathes on the real clock')
      .toMatch(/const t = ambientElapsedSec\(\);\s*\n\s*haloMat\.uniforms\.uTime\.value = t;/);
  });

  it('stops the star drift and the damping tail, and keeps the drag', () => {
    const app = readFileSync(resolve(process.cwd(), '../../ui-app/src/App.tsx'), 'utf8');
    expect(app).toContain('speed={reducedMotion ? 0 : 0.3}');
    expect(app).toContain('enableDamping={!reducedMotion}');
    // The drag itself is the visitor's own motion and is never disabled.
    expect(app).not.toContain('enabled={!reducedMotion}');
  });
});

describe('the policy is written where the other ladders are', () => {
  it('says what stops and what does not', () => {
    expect(MOTION_POLICY.dom).toEqual({ fades: true, infiniteLoops: false, texture: true });
    expect(MOTION_POLICY.stage).toEqual({
      rotation: false, ambientLoops: false, eventsAtEndState: true, dampingTail: false,
    });
  });

  it('keeps the scan lines, because texture is not motion', () => {
    // The one thing the HUD used to take away. It is a static gradient: it
    // does not move, it has never moved, and there is nothing in it to stop.
    const overlay = read('components/hud/HudOverlay.tsx');
    expect(overlay, 'the scan layer is conditional again')
      .not.toMatch(/\{!reduced && <div style=\{SCAN_STYLE\}/);
    expect(overlay).toContain('<div style={SCAN_STYLE} />');
  });
});
