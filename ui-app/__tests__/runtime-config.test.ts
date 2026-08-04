import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUILD_VERSION,
  DEFAULT_GALAXY_CONFIG,
  resolveGalaxyConfig,
  resolveEnrichmentConfig,
  DEFAULT_ENRICHMENT_CONFIG,
  resolveBuildVersion,
  buildCommitHref,
  CKNERV_REPOSITORY_URL,
} from '../src/runtime-config';

describe('resolveBuildVersion', () => {
  it('returns a configured nonblank build version', () => {
    expect(resolveBuildVersion({ buildVersion: ' 61922ba@20260630 ' })).toBe(
      '61922ba@20260630',
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
          maxSourcesPerParent: 2,
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
    expect(resolveGalaxyConfig({}).cellCap).toBe(20_000);
  });
});

describe('buildCommitHref', () => {
  it('deep-links to the exact commit when the version carries a hash', () => {
    expect(buildCommitHref('61922ba@20260630')).toBe(
      `${CKNERV_REPOSITORY_URL}/commit/61922ba`,
    );
  });

  it('falls back to the repo root when the version has no hash', () => {
    expect(buildCommitHref('dev')).toBe(CKNERV_REPOSITORY_URL);
  });
});
