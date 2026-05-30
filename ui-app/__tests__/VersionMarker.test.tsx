import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import VersionMarker, { CKNERV_REPOSITORY_URL } from '../src/VersionMarker';

afterEach(() => {
  cleanup();
  delete window.__CKNERV_RUNTIME_CONFIG__;
});

describe('VersionMarker', () => {
  it('renders the configured build version as a GitHub link', () => {
    window.__CKNERV_RUNTIME_CONFIG__ = {
      buildVersion: '0.1.0@abcdef123456',
    };

    render(<VersionMarker />);

    const link = screen.getByRole('link', { name: '0.1.0@abcdef123456' });
    expect(link.getAttribute('href')).toBe(CKNERV_REPOSITORY_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('renders dev fallback when runtime config is absent', () => {
    render(<VersionMarker />);

    expect(screen.getByRole('link', { name: 'dev' })).toBeTruthy();
  });
});
