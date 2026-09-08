import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { INSTANCE_CAPACITY } from '@cknerv/ui';

import {
  DEFAULT_BUILD_VERSION,
  DEFAULT_GALAXY_CONFIG,
  resolveGalaxyConfig,
  resolveEnrichmentConfig,
  DEFAULT_ENRICHMENT_CONFIG,
  resolveBuildVersion,
  buildCommitHref,
  CKNERV_REPOSITORY_URL,
  resolveHosted,
} from '../src/runtime-config';

describe('hosted runtime config', () => {
  it('defaults to local when an older or development runtime omits hosted', () => {
    expect(resolveHosted({})).toBeNull();
    expect(resolveHosted({ hosted: null })).toBeNull();
  });

  it('reads the Rust payload without changing the operator-provided name', () => {
    const cases = JSON.parse(readFileSync(resolve(
      __dirname, '..', '..', 'tests', 'fixtures', 'runtime_config_hosted.json',
    ), 'utf8'));
    for (const { runtime } of cases) {
      expect(resolveHosted(runtime)).toBe(runtime.hosted);
    }
  });
});

describe('constants pinned to a twin elsewhere', () => {
  it('the bundled reservoir default is exactly what the renderer can hold', () => {
    // `cellCap` is the fallback when the server ships no runtime config, and
    // the renderer allocates its instance buffers at `INSTANCE_CAPACITY`
    // (`packages/ui/src/geometry/cellPositions.ts`). A default above it would
    // hand the galaxy more cells than there are slots; below it would waste
    // allocated GPU memory nothing can ever fill.
    expect(DEFAULT_GALAXY_CONFIG.cellCap).toBe(INSTANCE_CAPACITY);
  });

  it('the stream watchdog outlives three server heartbeats', () => {
    // `HEARTBEAT_INTERVAL` is 5s (`crates/cknerv-server/src/ws.rs`, asserted
    // there by `heartbeat_leaves_the_client_watchdog_three_beats_of_slack`).
    // Read from the source rather than imported because App.tsx is the whole
    // scene graph; the literal is what ships either way.
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const declared = /const STREAM_STALE_AFTER_MS = ([\d_]+);/.exec(source)?.[1];
    expect(declared, 'STREAM_STALE_AFTER_MS moved out of App.tsx').toBeDefined();
    const staleAfterMs = Number((declared as string).replace(/_/g, ''));
    // One dropped heartbeat on a healthy link must not read as a dead stream.
    expect(staleAfterMs).toBeGreaterThanOrEqual(3 * 5_000);
  });
});

describe('resolveBuildVersion', () => {
  it('returns a configured nonblank build version', () => {
    expect(resolveBuildVersion({ buildVersion: ' 1.0.1@61922ba ' })).toBe(
      '1.0.1@61922ba',
    );
  });

  it('falls back to dev when buildVersion is missing', () => {
    expect(resolveBuildVersion({})).toBe(DEFAULT_BUILD_VERSION);
  });

  it('falls back to dev when buildVersion is blank', () => {
    expect(resolveBuildVersion({ buildVersion: '   ' })).toBe(
      DEFAULT_BUILD_VERSION,
    );
  });
});

describe('resolveEnrichmentConfig', () => {
  it('is disabled unless explicitly enabled by server runtime config', () => {
    expect(resolveEnrichmentConfig({})).toEqual(DEFAULT_ENRICHMENT_CONFIG);
    expect(resolveEnrichmentConfig({ enrichment: { source: 'ckbadger' } }))
      .toEqual(DEFAULT_ENRICHMENT_CONFIG);
  });

  it('exposes only the source identity, never its private API URL', () => {
    expect(resolveEnrichmentConfig({
      enrichment: { enabled: true, source: ' ckbadger ' },
    })).toEqual({ enabled: true, source: 'ckbadger' });
  });
});

describe('resolveGalaxyConfig', () => {
  it('returns configured galaxy topology and pulse values', () => {
    const resolved = resolveGalaxyConfig({
      galaxy: {
        profile: 'devnet',
        cellCap: 2000,
        recentLinksCap: 1024,
        topology: { neighborK: 5, maxEdgeLength: 36, maxHops: 50 },
        pulses: {
          linkRingCapacity: 64,
          maxPulsesPerLink: 4,
          maxOriginsPerLink: 2,
          maxActivePulses: 128,
        },
      },
    });

    expect(resolved.profile).toBe('devnet');
    expect(resolved.topology.neighborK).toBe(5);
    expect(resolved.topology.maxEdgeLength).toBe(36);
    expect(resolved.pulses.maxPulsesPerLink).toBe(4);
    expect(resolved.pulses.maxActivePulses).toBe(128);
  });

  it('falls back to bundled defaults when galaxy config is missing', () => {
    expect(resolveGalaxyConfig({})).toEqual(DEFAULT_GALAXY_CONFIG);
    expect(resolveGalaxyConfig({}).cellCap).toBe(50_000);
  });

  /** The very JSON the Rust encoder produced (regenerate with
   *  `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-cli`). The embedded
   *  server injects this struct over the bundled defaults in every
   *  production deployment, so the two must agree or dev and prod render
   *  different galaxies — a package-default retune that never touches
   *  `config.rs` fails right here instead of shipping silently defeated. */
  it('the server-injected payload resolves to the bundled defaults', () => {
    const path = resolve(
      __dirname, '..', '..', 'tests', 'fixtures', 'runtime_config_galaxy.json',
    );
    const galaxy = JSON.parse(readFileSync(path, 'utf8'));
    expect(resolveGalaxyConfig({ galaxy })).toEqual(DEFAULT_GALAXY_CONFIG);
  });
});

describe('buildCommitHref', () => {
  it('deep-links to the exact commit when the version carries a hash', () => {
    expect(buildCommitHref('1.0.1@61922ba')).toBe(
      `${CKNERV_REPOSITORY_URL}/commit/61922ba`,
    );
  });

  it('falls back to the repo root when the version has no hash', () => {
    expect(buildCommitHref('dev')).toBe(CKNERV_REPOSITORY_URL);
  });
});
