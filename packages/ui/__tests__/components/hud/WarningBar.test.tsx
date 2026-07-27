import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import WarningBar from '../../../src/components/hud/WarningBar';

afterEach(cleanup);

describe('WarningBar', () => {
  it('is hidden at nominal/caution', () => {
    const { container } = render(<WarningBar level="caution" trigger={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the 警告 banner + trigger at warning and above', () => {
    const { container } = render(<WarningBar level="danger" trigger="sync-stall" />);
    const t = container.textContent ?? '';
    expect(t).toContain('警告');
    expect(t).toContain('SYNC-STALL');
  });
  it('can stack below a transport-health banner', () => {
    const { container } = render(
      <WarningBar level="danger" trigger="sync-stall" top={60} />,
    );
    expect((container.firstElementChild as HTMLElement).style.top).toBe('60px');
  });
});
