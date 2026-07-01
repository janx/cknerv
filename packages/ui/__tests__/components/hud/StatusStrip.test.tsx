import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import StatusStrip from '../../../src/components/hud/StatusStrip';

afterEach(cleanup);

describe('StatusStrip', () => {
  it('shows the wordmark and a nominal indicator', () => {
    const { container } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    expect(container.textContent).toContain('CKNERV');
    expect(container.textContent).toContain('NOMINAL');
    expect(container.textContent).toContain('状态');
  });
  it('tags the indicator dot with the alert level', () => {
    const { container } = render(<StatusStrip level="danger" uptimeMs={0} />);
    const dot = container.querySelector('[data-dot]') as HTMLElement;
    expect(dot.getAttribute('data-level')).toBe('danger');
    expect(container.textContent).toContain('DANGER');
  });
  it('renders the build version as a commit link before the status chip', () => {
    render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        build={{ version: '20260630@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
      />,
    );
    const link = screen.getByRole('link', { name: '20260630@61922ba' });
    expect(link.getAttribute('href')).toBe('https://github.com/janx/cknerv/commit/61922ba');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('omits the build link when no build prop is given', () => {
    const { queryByRole } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    expect(queryByRole('link')).toBeNull();
  });
});
