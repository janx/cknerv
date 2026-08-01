// Cross-language parity test for `helixSeed`. The fixture in
// `<repo-root>/tests/fixtures/helix_seed.json` is the single source of
// truth; the Rust parity test (`crates/cknerv-core/tests/helix_parity.rs`)
// must agree byte-for-byte on every entry. If this test drifts and the
// Rust one doesn't, the wallet preview will not match what the server
// commits — the `helix_seed` parity guarantee is broken.
//
// Fixture shape: `[x, y, z][]` — index = cell id, value = expected f32
// xyz already truncated when the fixture was generated. `Math.fround`
// on the TS output side is what reproduces the Rust `as f32` downcast.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { helixSeed, helixSeedF64 } from '../src/helix';

type Triple = [number, number, number];

describe('helixSeed (TS) — fixture parity', () => {
  it('matches the cross-language fixture byte-for-byte', () => {
    const path = resolve(
      __dirname,
      '..',
      '..',
      '..',
      'tests',
      'fixtures',
      'helix_seed.json',
    );
    const fixture: Triple[] = JSON.parse(readFileSync(path, 'utf8'));
    expect(fixture.length).toBe(1000);

    for (let id = 0; id < fixture.length; id += 1) {
      const [x, y, z] = helixSeed(id);
      const [ex, ey, ez] = fixture[id];
      // `Math.fround` ensures both sides are true f32 values; JS Numbers
      // are f64 by default and would silently mask f32-precision drift.
      if (x !== Math.fround(ex) || y !== Math.fround(ey) || z !== Math.fround(ez)) {
        throw new Error(
          `divergence at id=${id}: ts=[${x}, ${y}, ${z}] expected=[${ex}, ${ey}, ${ez}]`,
        );
      }
    }
  });

  it('forms asymmetric three-dimensional tissue rather than a thin radial lattice', () => {
    const points = Array.from({ length: 20_000 }, (_, id) => helixSeedF64(id));
    const means = [0, 1, 2].map((axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length,
    );
    const std = [0, 1, 2].map((axis) => Math.sqrt(
      points.reduce(
        (sum, point) => sum + (point[axis] - means[axis]) ** 2,
        0,
      ) / points.length,
    ));
    const planarStd = Math.sqrt(std[0] * std[2]);

    // The old σ=1.5 disc measured near 0.06 here. A folded field must keep
    // enough depth for parallax while remaining recognisably field-shaped.
    expect(std[1] / planarStd).toBeGreaterThan(0.16);
    expect(std[1] / planarStd).toBeLessThan(0.42);

    // A biological field needs coherent crowded regions and real cavities.
    // Uniform random scatter (or a smooth Gaussian ellipse) drives this
    // coarse-grid coefficient toward zero as N grows; multi-scale tissue must
    // preserve strong variance at the full 20K sample.
    const gridSize = 14;
    const bins = new Array<number>(gridSize * gridSize).fill(0);
    for (const [x, , z] of points) {
      const ix = Math.floor(((x + 60) / 120) * gridSize);
      const iz = Math.floor(((z + 54) / 108) * gridSize);
      if (ix < 0 || ix >= gridSize || iz < 0 || iz >= gridSize) continue;
      bins[iz * gridSize + ix] += 1;
    }
    const interior: number[] = [];
    for (let iz = 0; iz < gridSize; iz += 1) {
      for (let ix = 0; ix < gridSize; ix += 1) {
        const nx = ((ix + 0.5) / gridSize) * 2 - 1;
        const nz = ((iz + 0.5) / gridSize) * 2 - 1;
        if (nx * nx + nz * nz < 0.85) {
          interior.push(bins[iz * gridSize + ix]);
        }
      }
    }
    const binMean = interior.reduce((sum, count) => sum + count, 0)
      / interior.length;
    const binCv = Math.sqrt(
      interior.reduce(
        (sum, count) => sum + (count - binMean) ** 2,
        0,
      ) / interior.length,
    ) / binMean;
    expect(binCv).toBeGreaterThan(0.50);
    expect(interior.filter((count) => count < binMean * 0.2).length)
      .toBeGreaterThanOrEqual(8);
    expect(interior.filter((count) => count > binMean * 1.8).length)
      .toBeGreaterThanOrEqual(8);

    // Six equally populated arms create a large sixth angular harmonic. Keep
    // that signature low without demanding rotational symmetry from the lobes.
    const sixthHarmonic = Math.hypot(
      points.reduce(
        (sum, [x, , z]) => sum + Math.cos(6 * Math.atan2(z, x)),
        0,
      ) / points.length,
      points.reduce(
        (sum, [x, , z]) => sum + Math.sin(6 * Math.atan2(z, x)),
        0,
      ) / points.length,
    );
    expect(sixthHarmonic).toBeLessThan(0.10);
  });
});
