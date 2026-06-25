import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import BackfillBar from '../../../src/components/hud/BackfillBar';

afterEach(cleanup);

describe('BackfillBar', () => {
  it('renders nothing when not seeding', () => {
    const { container } = render(<BackfillBar backfill={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders progress when seeding', () => {
    const { container } = render(<BackfillBar backfill={{ done: 7, total: 10 }} />);
    const t = container.textContent ?? '';
    expect(t).toContain('SEEDING LIVE CELLS');
    expect(t).toContain('播种');
    expect(t).toContain('7 / 10');
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('70%');
  });
});
