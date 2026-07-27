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
    const { container } = render(
      <BackfillBar backfill={{ done: 7, total: 10, phase: 'boot' }} />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('SEEDING CONSENSUS CELLS');
    expect(t).toContain('播种');
    expect(t).toContain('7 / 10');
    expect(container.querySelector('[data-replay-phase="boot"]')).not.toBeNull();
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('70%');
  });

  it.each([
    ['catchup', 'RESTORING CHAIN CONTINUITY', 'CHAIN SYNC'],
    ['reorg', 'RECONCILING CANON', 'CANON REPAIR'],
    ['rebuild', 'REBUILDING CONSENSUS MEMORY', 'STATE RESET'],
  ] as const)('renders the %s replay language', (phase, title, subtitle) => {
    const { container } = render(
      <BackfillBar backfill={{ done: 2, total: 4, phase }} />,
    );
    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain(subtitle);
    expect(container.querySelector(`[data-replay-phase="${phase}"]`)).not.toBeNull();
  });

  it('keeps a regressed-tip reorg visible while its suffix is unavailable', () => {
    const { container } = render(
      <BackfillBar backfill={{ done: 0, total: 0, phase: 'reorg' }} />,
    );
    expect(container.textContent).toContain('WAITING FOR CANONICAL SUFFIX');
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });
});
