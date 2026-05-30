import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUILD_VERSION,
  resolveBuildVersion,
} from '../src/runtime-config';

describe('resolveBuildVersion', () => {
  it('returns a configured nonblank build version', () => {
    expect(resolveBuildVersion({ buildVersion: ' 0.1.0@abcdef123456 ' })).toBe(
      '0.1.0@abcdef123456',
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
