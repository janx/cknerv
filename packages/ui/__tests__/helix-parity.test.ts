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

import { helixSeed } from '../src/helix';

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
});
