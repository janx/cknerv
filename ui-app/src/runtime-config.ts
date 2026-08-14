import {
  DEFAULT_LINK_RING_CAPACITY,
  DEFAULT_RECENT_LINKS_CAPACITY,
} from '@cknerv/cache';
import {
  DEFAULT_MAX_HOPS,
  MAX_ACTIVE_PULSES,
  MAX_PULSES_PER_LINK,
  MAX_SOURCES_PER_PARENT,
} from '@cknerv/ui';

export type GalaxyProfile = 'auto' | 'devnet' | 'testnet' | 'mainnet' | 'custom';

export interface GalaxyRuntimeConfig {
  profile: GalaxyProfile;
  cellCap: number;
  recentLinksCap: number;
  topology: {
    neighborK: number;
    maxEdgeLength: number;
    maxHops: number;
  };
  pulses: {
    linkRingCapacity: number;
    maxPulsesPerLink: number;
    maxSourcesPerParent: number;
    maxActivePulses: number;
  };
}

export interface EnrichmentRuntimeConfig {
  enabled: boolean;
  source?: string;
}

export interface CknervRuntimeConfig {
  buildVersion?: string;
  galaxy?: Partial<Omit<GalaxyRuntimeConfig, 'topology' | 'pulses'>> & {
    topology?: Partial<GalaxyRuntimeConfig['topology']>;
    pulses?: Partial<GalaxyRuntimeConfig['pulses']>;
  };
  enrichment?: Partial<EnrichmentRuntimeConfig>;
}

declare global {
  interface Window {
    __CKNERV_RUNTIME_CONFIG__?: CknervRuntimeConfig;
  }
}

export const DEFAULT_BUILD_VERSION = 'dev';
export const DEFAULT_ENRICHMENT_CONFIG: EnrichmentRuntimeConfig = {
  enabled: false,
};
export const DEFAULT_GALAXY_CONFIG: GalaxyRuntimeConfig = {
  profile: 'auto',
  // Mirrors the Rust reservoir bound (cells::CELL_CAP — "not a knob"); the
  // wire always shadows it, and the shared payload fixture pins the mirror.
  cellCap: 50_000,
  recentLinksCap: DEFAULT_RECENT_LINKS_CAPACITY,
  topology: {
    // Densified live to bridge the inter-arm gaps: sparse gap cells whose 4
    // nearest neighbours sat beyond the old 28u reach were dropped (no edge →
    // dark voids). maxEdgeLength 28 → 42 connects them; neighborK 4 → 5 adds
    // a little local density. The fabric GPU buffers absorb this because they
    // are sized from the fixed screen budget, not graph density — see
    // fabricCapacity.ts FABRIC_ALLOCATION_EDGE_CLASSES. These two numbers are
    // the app-level authority (deliberately denser than neighborGraph.ts's
    // module defaults); the server payload is pinned to them by the shared
    // runtime_config_galaxy.json fixture.
    neighborK: 5,
    maxEdgeLength: 42,
    maxHops: DEFAULT_MAX_HOPS,
  },
  pulses: {
    // The owning packages' defaults are the authority: the ring is sized for
    // the block guarantee (hold a whole busy block's links until the plan
    // effect consumes them), not just the GPU pulse pool. A runtime
    // override here that trails a package default re-opens the silent
    // whole-block-dark eviction the 512 sizing closed.
    linkRingCapacity: DEFAULT_LINK_RING_CAPACITY,
    maxPulsesPerLink: MAX_PULSES_PER_LINK,
    maxSourcesPerParent: MAX_SOURCES_PER_PARENT,
    maxActivePulses: MAX_ACTIVE_PULSES,
  },
};

function runtimeConfigFromWindow(): CknervRuntimeConfig | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.__CKNERV_RUNTIME_CONFIG__;
}

export function resolveBuildVersion(
  config: CknervRuntimeConfig = runtimeConfigFromWindow() ?? {},
): string {
  const configured = config.buildVersion?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_BUILD_VERSION;
}

export function resolveEnrichmentConfig(
  config: CknervRuntimeConfig = runtimeConfigFromWindow() ?? {},
): EnrichmentRuntimeConfig {
  if (config.enrichment?.enabled !== true) return DEFAULT_ENRICHMENT_CONFIG;
  const source = config.enrichment.source?.trim();
  return {
    enabled: true,
    ...(source ? { source } : {}),
  };
}

export const CKNERV_REPOSITORY_URL = 'https://github.com/janx/cknerv';

/**
 * Link target for a build version. When the string carries a commit hash
 * (`<hash>@<date>`), deep-link to that commit; otherwise (e.g. the `dev`
 * fallback) link to the repository root.
 */
export function buildCommitHref(version: string): string {
  const at = version.indexOf('@');
  return at >= 0
    ? `${CKNERV_REPOSITORY_URL}/commit/${version.slice(0, at)}`
    : CKNERV_REPOSITORY_URL;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

export function resolveGalaxyConfig(
  config: CknervRuntimeConfig = runtimeConfigFromWindow() ?? {},
): GalaxyRuntimeConfig {
  const galaxy = config.galaxy;
  if (!galaxy) return DEFAULT_GALAXY_CONFIG;

  return {
    profile: galaxy.profile ?? DEFAULT_GALAXY_CONFIG.profile,
    cellCap: numberOrDefault(galaxy.cellCap, DEFAULT_GALAXY_CONFIG.cellCap),
    recentLinksCap: numberOrDefault(
      galaxy.recentLinksCap,
      DEFAULT_GALAXY_CONFIG.recentLinksCap,
    ),
    topology: {
      neighborK: numberOrDefault(
        galaxy.topology?.neighborK,
        DEFAULT_GALAXY_CONFIG.topology.neighborK,
      ),
      maxEdgeLength: numberOrDefault(
        galaxy.topology?.maxEdgeLength,
        DEFAULT_GALAXY_CONFIG.topology.maxEdgeLength,
      ),
      maxHops: numberOrDefault(
        galaxy.topology?.maxHops,
        DEFAULT_GALAXY_CONFIG.topology.maxHops,
      ),
    },
    pulses: {
      linkRingCapacity: numberOrDefault(
        galaxy.pulses?.linkRingCapacity,
        DEFAULT_GALAXY_CONFIG.pulses.linkRingCapacity,
      ),
      maxPulsesPerLink: numberOrDefault(
        galaxy.pulses?.maxPulsesPerLink,
        DEFAULT_GALAXY_CONFIG.pulses.maxPulsesPerLink,
      ),
      maxSourcesPerParent: numberOrDefault(
        galaxy.pulses?.maxSourcesPerParent,
        DEFAULT_GALAXY_CONFIG.pulses.maxSourcesPerParent,
      ),
      maxActivePulses: numberOrDefault(
        galaxy.pulses?.maxActivePulses,
        DEFAULT_GALAXY_CONFIG.pulses.maxActivePulses,
      ),
    },
  };
}
