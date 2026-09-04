import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import LandingFlashLayer from '../../src/components/LandingFlashLayer';
import { createLandingFlashQueue } from '../../src/components/landingFlashQueue';
import {
  LANDING_FLASH_CAPACITY,
  LANDING_FLASH_SENTINEL,
  allocateLandingFlashSlot,
  createLandingFlashRing,
  landingFlashDrawCount,
  takeLandingFlashUpload,
  writeLandingFlash,
} from '../../src/components/landingFlashRing';
import {
  LANDING_FLASH_DURATION_S,
  LANDING_FLASH_SIZE_SCALE,
  makeLandingFlashMaterial,
} from '../../src/materials/landingFlashMaterial';
import { HYBRID_BASE_PX_PER_WU } from '../../src/materials/cellHybridMaterial';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';
import { deliverySchema } from '../../src/tweaks/tweakSchema';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import { emptyCellsCache } from '@cknerv/cache';

const source = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/${file}`),
  'utf8',
);

/** Every `.ts` / `.tsx` under `src`, as repo-relative paths. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) out.push(relative(process.cwd(), path));
    }
  };
  walk(resolve(process.cwd(), 'src'));
  return out.sort();
}

/** How many times `needle` occurs in each file that contains it at all. */
function census(needle: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles()) {
    const hits = readFileSync(resolve(process.cwd(), file), 'utf8').match(needle);
    if (hits && hits.length > 0) counts[file] = hits.length;
  }
  return counts;
}

describe('LandingFlashLayer', () => {
  it('mounts inside an r3f Canvas without throwing, on an empty queue', () => {
    const queueRef = { current: createLandingFlashQueue() };
    expect(() =>
      render(
        <CellGalaxyProvider value={emptyCellsCache()}>
          <Canvas>
            <LandingFlashLayer queueRef={queueRef} />
          </Canvas>
        </CellGalaxyProvider>,
      ),
    ).not.toThrow();
  });

  it('is the galaxy\'s: inside its rotating group, after the write flare, on the app\'s queue', () => {
    const galaxy = source('components/CellGalaxy.tsx');
    const groupOpen = galaxy.indexOf('<group ref={groupRef} position={[0, CELLS_Y, 0]}>');
    const flare = galaxy.indexOf('geometry={cellFlareGeometry}');
    const landing = galaxy.indexOf('<LandingFlashLayer queueRef={landingFlashRef} />');
    const groupClose = galaxy.indexOf('</group>', groupOpen);
    expect(groupOpen).toBeGreaterThan(-1);
    expect(flare).toBeGreaterThan(groupOpen);
    // Its own draw, after the body and the flare, still inside the group —
    // it resolves galaxy-local pos_seed exactly as the body does.
    expect(landing).toBeGreaterThan(flare);
    expect(landing).toBeLessThan(groupClose);
    expect(galaxy).toContain('landingFlashRef: { readonly current: LandingFlashQueue };');
    // The queue is a distinct channel from the write-seal map, at both ends.
    expect(source('components/NetworkColony.tsx'))
      .toContain('landingFlashRef: { readonly current: LandingFlashQueue };');
    expect(source('index.ts')).toContain('createLandingFlashQueue,');
  });

  it('draws on its own geometry, sized to its Cell on the flare\'s basis, and age-gated like the flare', () => {
    const material = makeLandingFlashMaterial();
    const vertex = material.vertexShader;
    expect(vertex).toContain('attribute float aLandingAt;');
    expect(vertex).toContain('attribute float aLandingSize;');
    expect(vertex).toContain('attribute vec4  aLandingColor;');
    // Nothing shared with the Cell body: none of its lanes are declared here,
    // so the body material's 13-slot budget is untouched.
    expect(vertex).not.toMatch(/aFlashAt|aRecordAt|aStageAt|\baSize\b|\baColor\b/);
    // The SAME px-per-world-unit basis as the body and the write flare (2.0),
    // imported rather than re-typed — a landing must register over its Cell.
    expect(vertex).toContain(
      `${HYBRID_BASE_PX_PER_WU.toFixed(1)} * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001))`,
    );
    expect(source('materials/landingFlashMaterial.ts'))
      .toContain("import { HYBRID_BASE_PX_PER_WU } from './cellHybridMaterial';");
    expect(source('materials/cellFlareMaterial.ts'))
      .toContain('const FLARE_BASE_PX_PER_WU = 2.0;');
    expect(HYBRID_BASE_PX_PER_WU).toBe(2.0);
    // Age gate → off-screen clip before projection: the flare's idiom verbatim.
    expect(vertex).toContain('if (age < 0.0 || age >= uDuration) {');
    expect(vertex).toContain('gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    expect(source('materials/cellFlareMaterial.ts'))
      .toContain('gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    // The flare's blend: additive, no depth write, no tone mapping.
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.toneMapped).toBe(false);
  });

  it('is plain: warm white into tissue rose, no rails, no loops, no knot', () => {
    const fragment = makeLandingFlashMaterial().fragmentShader;
    expect(fragment).toContain(`vec3(${CELL_GALAXY_PALETTE.tissueRose.join(', ')})`);
    expect(fragment).toContain('mix(vColor, rose, smoothstep(0.0, 1.0, vLife))');
    expect(source('components/LandingFlashLayer.tsx')).toContain('CELL_GALAXY_PALETTE.warmWhite');
    // The write seal's grammar is the write seal's.
    expect(fragment).not.toMatch(/rail|loop|knot|protocolWrite|uDischargeArms|atan\(/i);
    // Nor the carrier's hue: white is hers, gold is the block's.
    expect(source('components/LandingFlashLayer.tsx')).not.toMatch(/consensusBlockColor|CARRIER/);
  });

  it('seeds its uniforms from the one authority the knobs read', () => {
    const material = makeLandingFlashMaterial();
    expect(material.uniforms.uDuration.value).toBe(LANDING_FLASH_DURATION_S);
    expect(material.uniforms.uSizeScale.value).toBe(LANDING_FLASH_SIZE_SCALE);
    expect(deliverySchema.landingDur.value).toBe(LANDING_FLASH_DURATION_S);
    expect(deliverySchema.landingSize.value).toBe(LANDING_FLASH_SIZE_SCALE);
    expect(LANDING_FLASH_DURATION_S).toBe(0.45);
    expect(LANDING_FLASH_SIZE_SCALE).toBe(2.2);
    expect(LANDING_FLASH_CAPACITY).toBe(512);
  });

  it('runs on the sim clock, sizes by the Cell\'s own presentation, and costs nothing at rest', () => {
    const layer = source('components/LandingFlashLayer.tsx');
    expect(layer).toContain("from '../tweaks/useSimFrame'");
    expect(layer).toContain('const now = simClock.elapsedSec;');
    expect(layer).toContain('material.uniforms.uTime.value = now;');
    expect(layer).not.toMatch(/performance\.now|Date\.now|state\.clock/);
    // The very derivation the body writes into `aSize` — never a second one.
    expect(layer).toContain("import { cellPointSize } from '../derives/cellVisual.derive';");
    expect(layer).toContain('cellPointSize(cell),');
    expect(source('components/CellGalaxy.tsx')).toContain('size: cellPointSize(cell),');
    expect(source('components/CellGalaxy.tsx')).toContain('export { cellPointSize };');
    // A dead Cell takes no slot; a window already closed takes no slot.
    expect(layer).toContain('if (!cell || cell.death_at_ms !== null) continue;');
    expect(layer).toContain('if (at + dur <= now) continue;');
    // At rest the draw is not submitted at all, and no uniform is synced.
    expect(layer).toContain('points.visible = count > 0;');
    expect(layer).toContain('if (count === 0) return;');
    // Its GLSL lives in the material module (the budget test walks src for
    // attribute declarations and charges by file).
    expect(layer).not.toMatch(/attribute\s+\w+\s+\w+\s*;/);
  });
});

describe('the landing queue', () => {
  it('keeps push order, defaults to a full flash, and clears without reallocating', () => {
    const queue = createLandingFlashQueue();
    const ids = queue.ids;
    queue.push(7, 10.5, 0.4);
    queue.push(3, 9.0);
    expect([...queue.ids]).toEqual([7, 3]);
    expect([...queue.ats]).toEqual([10.5, 9.0]);
    expect([...queue.amps]).toEqual([0.4, 1]);
    queue.clear();
    expect(queue.ids.length).toBe(0);
    expect(queue.ats.length).toBe(0);
    expect(queue.amps.length).toBe(0);
    expect(queue.ids).toBe(ids);
  });
});

describe('the landing ring', () => {
  const dur = 0.45;
  const write = (
    ring: ReturnType<typeof createLandingFlashRing>,
    nowS: number,
    atS: number,
  ): number => writeLandingFlash(ring, nowS, dur, 0, 0, 0, atS, 1, 1, 1, 1, 1);

  it('starts empty: every slot at the sentinel, nothing to draw, nothing to upload', () => {
    const ring = createLandingFlashRing(8);
    expect([...ring.at]).toEqual(new Array(8).fill(LANDING_FLASH_SENTINEL));
    expect(landingFlashDrawCount(ring, 100, dur)).toBe(0);
    expect(takeLandingFlashUpload(ring)).toBeNull();
  });

  it('recycles by age: an ended slot first, else the oldest flash — never one still to come', () => {
    const ring = createLandingFlashRing(4);
    expect(write(ring, 10, 10.0)).toBe(0); // ends 10.45
    expect(write(ring, 10, 10.2)).toBe(1); // ends 10.65
    expect(write(ring, 10, 11.0)).toBe(2); // still to come
    expect(write(ring, 10, 10.1)).toBe(3); // ends 10.55
    expect(ring.high).toBe(4);
    // Everything alive at 10.3: the OLDEST goes (slot 0, onset 10.0), not
    // whatever the cursor happens to point at.
    expect(write(ring, 10.3, 10.3)).toBe(0);
    // At 10.6 the first ENDED slot past the cursor is 3 (ended 10.55); slot 1
    // is alive until 10.65 and slot 2 has not even begun.
    expect(write(ring, 10.6, 10.6)).toBe(3);
    // At 10.7 slot 1 has ended; the future flash in slot 2 is still passed over.
    expect(write(ring, 10.7, 10.7)).toBe(1);
    // All alive again: the oldest is slot 0 (onset 10.3) — slot 2's future
    // onset is never the one sacrificed.
    expect(write(ring, 10.7, 10.7)).toBe(0);
    expect(allocateLandingFlashSlot(ring, 10.7, dur)).not.toBe(2);
  });

  it('draws the high-water prefix while anything can be alive, and rewinds to nothing after', () => {
    const ring = createLandingFlashRing(8);
    expect(writeLandingFlash(ring, 5, dur, 1, 2, 3, 5.0, 0.9, 1, 0.93, 0.85, 0.7)).toBe(0);
    expect(writeLandingFlash(ring, 5, dur, 4, 5, 6, 5.9, 1.1, 1, 0.93, 0.85, 1)).toBe(1);
    expect([...ring.position.subarray(0, 6)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...ring.size.subarray(0, 2)].map((v) => Math.round(v * 100) / 100)).toEqual([0.9, 1.1]);
    [1, 0.93, 0.85, 0.7].forEach((expected, i) => {
      expect(ring.color[i]).toBeCloseTo(expected, 6);
    });
    expect(landingFlashDrawCount(ring, 5.0, dur)).toBe(2);
    // The first has ended and the second has not begun: the prefix holds.
    expect(landingFlashDrawCount(ring, 5.5, dur)).toBe(2);
    expect(landingFlashDrawCount(ring, 6.34, dur)).toBe(2);
    // Past 5.9 + 0.45: the newest has ended — rest, and rewind.
    expect(landingFlashDrawCount(ring, 6.36, dur)).toBe(0);
    expect(ring.high).toBe(0);
    expect(ring.cursor).toBe(0);
    // The next pulse fills from slot 0 again.
    expect(write(ring, 7, 7)).toBe(0);
    expect(landingFlashDrawCount(ring, 7, dur)).toBe(1);
  });

  it('journals the written slots as one upload range and forgets them once taken', () => {
    const ring = createLandingFlashRing(8);
    write(ring, 0, 0);
    write(ring, 0, 0);
    write(ring, 0, 0);
    expect(takeLandingFlashUpload(ring)).toEqual({ start: 0, count: 3 });
    expect(takeLandingFlashUpload(ring)).toBeNull();
    write(ring, 0, 0);
    expect(takeLandingFlashUpload(ring)).toEqual({ start: 3, count: 1 });
  });
});

describe('the seal is for writes', () => {
  it('cellFlashRef is written only by real writes: the galaxy\'s fresh-link and rewrite sites, and the nerve arrivals', () => {
    // ⭐ The whole point of the landing layer. `cellFlashRef` → `aFlashAt` →
    // the protocol write seal. After this, no landing — not the delivery
    // layer's, not a radial sweep in the galaxy — reaches it. The nerve
    // arrivals are packets landing on the Cells they write; those stay.
    expect(census(/cellFlashRef\.current\.set\(/g)).toEqual({
      'src/components/CellGalaxy.tsx': 2,
      'src/nerve/NeuralNetwork.tsx': 2,
    });
    const galaxy = source('components/CellGalaxy.tsx');
    // …and the galaxy's two are exactly the rewrite arrivals and the
    // fresh-link touched Cells.
    expect(galaxy).toContain('cellFlashRef.current.set(id, now);');
    expect(galaxy).toContain('cellFlashRef.current.set(cellId, flashAtS);');
    expect(galaxy.match(/markCellFlashDirty\(/g)).toHaveLength(2);
    // The delivery side never touches the seal's buffers at all.
    expect(source('components/BlockDeliveryLayer.tsx')).not.toMatch(/cellFlashRef|markCellFlashDirty|flashDirty/);
    expect(source('components/NetworkColony.tsx')).not.toMatch(/cellFlashRef|markCellFlashDirty|flashDirty/);
  });

  it('the local-ignition sweep is gone: no radius, no speed, no cap, no index in the galaxy', () => {
    const galaxy = source('components/CellGalaxy.tsx');
    expect(galaxy).not.toMatch(
      /LOCAL_IGNITION|MAX_LOCAL_IGNITIONS|cellIdsWithinRadiusFromIndex|sharedCellNearestIndex|strikeSceneS|withinRadius|rotYWorldToLocalXZ/,
    );
    // The hero delivery owns the hero landing now; 60 wu/s is not a speed
    // anything in the scene still moves at.
    expect(census(/LOCAL_IGNITION|MAX_LOCAL_IGNITIONS|igniteK|igniteMax|igniteRipple|nearestCellIdsFromIndex\(/g))
      .toEqual({
        // The exact-k query itself stays — its definition and its one caller,
        // the one-shot `nearestCellIds` wrapper — but nothing in the scene
        // calls either any more: a landing is a radius, not a k.
        'src/derives/peers.derive.ts': 2,
      });
  });
});
