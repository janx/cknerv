// The §15.2 rule: never submit a draw that produces nothing. r3f's
// projectObject drops an object whose `visible` is false before it reaches
// the renderer, so gating `visible` on a frame's instance/point count (or a
// trace pass's opacity) keeps an idle frame from paying the program bind and
// state set of an empty instanced / points / line draw. The spike pool is a
// plain class and gets a real behavioural test; the r3f layers are pinned by
// their source (the house pattern, as in LandingFlashLayer.test.tsx).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SpikePool } from '../../src/nerve/spikePool';

const source = (file: string): string =>
  readFileSync(resolve(process.cwd(), `src/${file}`), 'utf8');

/** Occurrences of an exact substring. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('zero-count / zero-output draw gates', () => {
  it('the spike pool hides itself on a frame that writes nothing', () => {
    const pool = new SpikePool(16);
    // Before the first commit it is already hidden — no zero-count draw even
    // if a render runs ahead of the first frame callback.
    expect(pool.mesh.visible).toBe(false);

    // A frame that writes no sprite: draw range 0, and NOT submitted.
    pool.beginFrame();
    pool.endFrame(1080, 1);
    expect(pool.mesh.visible).toBe(false);

    // A frame that writes one sprite shows the pool.
    pool.beginFrame();
    expect(pool.pushValues(0, 0, 0, [1, 1, 1], 1, 1, 0, 'packet')).toBe(true);
    pool.endFrame(1080, 1);
    expect(pool.mesh.visible).toBe(true);

    // An empty frame after it hides the pool again.
    pool.beginFrame();
    pool.endFrame(1080, 1);
    expect(pool.mesh.visible).toBe(false);
  });

  it('the courier plume and bloom hide whenever the batch is empty', () => {
    const layer = source('components/ColonyCourierLayer.tsx');
    // Per-frame commit: visible tracks the live-slot count.
    expect(layer).toContain('plumeBatch.visible = slot > 0;');
    expect(layer).toContain('bloomBatch.visible = slot > 0;');
    // The layout init and the two idle branches (`!pulse`, retired) hide both.
    expect(layer).toContain('plume.visible = false;');
    expect(layer).toContain('bloom.visible = false;');
    expect(count(layer, 'plumeBatch.visible = false;')).toBeGreaterThanOrEqual(2);
    expect(count(layer, 'bloomBatch.visible = false;')).toBeGreaterThanOrEqual(2);
  });

  it('the delivery plume, mote and wave hide on a delivery-less frame', () => {
    const layer = source('components/BlockDeliveryLayer.tsx');
    // The shared commit gates visible on count for all three batches.
    expect(layer).toContain('batch.visible = count > 0;');
    // Each of the three is hidden in the two idle branches (`!pulse`, retired).
    for (const name of ['moteBatch', 'plumeBatch', 'waveBatch']) {
      expect(count(layer, `${name}.visible = false;`)).toBeGreaterThanOrEqual(2);
    }
  });

  it('the write-seal pool hides while no seal is live', () => {
    const seal = source('nerve/DendriticBurst.tsx');
    expect(seal).toContain('mesh.visible = false;'); // no live seal this frame
    expect(seal).toContain('mesh.visible = written > 0;'); // all slots expired
    expect(seal).toContain('visible={false}'); // hidden before the first frame
  });

  it('the portrait trace passes hide while they render nothing', () => {
    const memory = source('components/hud/ConsensusMemory.tsx');
    expect(memory).toContain(
      'built.streamTraceGlow.visible = built.streamTraceGlowMaterial.opacity > 0.005;',
    );
    expect(memory).toContain(
      'built.streamTraceCore.visible = built.streamTraceCoreMaterial.opacity > 0.005;',
    );
  });
});
