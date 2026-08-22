// Cross-language contract test for the death rite.
//
// A corpse is not gone the moment the chain says it died: the SPA waits
// `BLOCK_HIGHLIGHT_DELAY_S` for the delivery choreography, then withers the
// body for `DEATH_DURATION_MS`. The server has to keep the record alive for
// at least that long — `CORPSE_HOLD_MS` in
// `crates/cknerv-core/src/projection/cells.rs` — because GC is also the
// moment the display plane drops the member, so an early reap makes the
// corpse vanish mid-wither.
//
// `<repo-root>/tests/fixtures/death_rite.json` is where the two sides shake
// hands. This test owns the client half: the rite computed from the REAL
// exported constants must equal `client_rite_ms`. The Rust half
// (`a_corpse_outlives_the_client_rite_before_it_is_reaped`) asserts
// `CORPSE_HOLD_MS == corpse_hold_ms` and that the hold dominates the rite.
// Move either constant and exactly one of the two tests fails, naming this
// fixture — which is the point.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEATH_DURATION_MS } from '../../src/geometry/cellPositions';
import { BLOCK_HIGHLIGHT_DELAY_S } from '../../src/ui/topologyConstants';

interface DeathRiteFixture {
  client_rite_ms: number;
  corpse_hold_ms: number;
}

function readDeathRiteFixture(): DeathRiteFixture {
  const path = resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'tests',
    'fixtures',
    'death_rite.json',
  );
  return JSON.parse(readFileSync(path, 'utf8')) as DeathRiteFixture;
}

describe('death rite — shared fixture parity', () => {
  it('the rite the client actually spends matches the pinned client_rite_ms', () => {
    const fixture = readDeathRiteFixture();
    const rite = BLOCK_HIGHLIGHT_DELAY_S * 1000 + DEATH_DURATION_MS;
    expect(rite).toBeCloseTo(fixture.client_rite_ms, 6);
  });

  it('the server hold outlasts the rite with margin left over', () => {
    const fixture = readDeathRiteFixture();
    // The Rust side pins `corpse_hold_ms` to `CORPSE_HOLD_MS`; restating the
    // inequality here means a fixture edited to "fix" a failing TS assertion
    // cannot quietly cross under the hold.
    expect(fixture.corpse_hold_ms).toBeGreaterThan(fixture.client_rite_ms);
  });
});
