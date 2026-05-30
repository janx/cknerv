export interface CknervRuntimeConfig {
  buildVersion?: string;
}

declare global {
  interface Window {
    __CKNERV_RUNTIME_CONFIG__?: CknervRuntimeConfig;
  }
}

export const DEFAULT_BUILD_VERSION = 'dev';

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
