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

export interface CknervRuntimeConfig {
  buildVersion?: string;
  galaxy?: Partial<Omit<GalaxyRuntimeConfig, 'topology' | 'pulses'>> & {
    topology?: Partial<GalaxyRuntimeConfig['topology']>;
    pulses?: Partial<GalaxyRuntimeConfig['pulses']>;
  };
}

declare global {
  interface Window {
    __CKNERV_RUNTIME_CONFIG__?: CknervRuntimeConfig;
  }
}

export const DEFAULT_BUILD_VERSION = 'dev';
export const DEFAULT_GALAXY_CONFIG: GalaxyRuntimeConfig = {
  profile: 'auto',
  cellCap: 5000,
  recentLinksCap: 2048,
  topology: {
    neighborK: 4,
    maxEdgeLength: 28,
    maxHops: 40,
  },
  pulses: {
    linkRingCapacity: 128,
    maxPulsesPerLink: 6,
    maxSourcesPerParent: 2,
    maxActivePulses: 256,
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

export const CKNERV_REPOSITORY_URL = 'https://github.com/janx/cknerv';

/**
 * Link target for a build version. When the string carries a commit hash
 * (`<date>@<hash>`), deep-link to that commit; otherwise (e.g. the `dev`
 * fallback) link to the repository root.
 */
export function buildCommitHref(version: string): string {
  const at = version.indexOf('@');
  return at >= 0
    ? `${CKNERV_REPOSITORY_URL}/commit/${version.slice(at + 1)}`
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
