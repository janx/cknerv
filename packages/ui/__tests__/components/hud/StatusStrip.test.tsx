import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import StatusStrip from '../../../src/components/hud/StatusStrip';

afterEach(cleanup);

describe('StatusStrip', () => {
  it('shows the wordmark, op label and a nominal indicator', () => {
    const { container } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    expect(container.textContent).toContain('CKNERV');
    expect(container.textContent).toContain('OPERATION MONITOR');
    expect(container.textContent).toContain('NOMINAL');
    expect(container.textContent).toContain('状态');
  });
  it('tags the indicator dot with the alert level', () => {
    const { container } = render(<StatusStrip level="danger" uptimeMs={0} />);
    const dot = container.querySelector('[data-dot]') as HTMLElement;
    expect(dot.getAttribute('data-level')).toBe('danger');
    expect(container.textContent).toContain('DANGER');
  });
});
