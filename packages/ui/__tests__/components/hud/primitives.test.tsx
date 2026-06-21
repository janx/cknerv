import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { HudPanel, PanelHeader, StatRow, Gauge } from '../../../src/components/hud/primitives';

afterEach(cleanup);

describe('hud primitives', () => {
  it('HudPanel renders children inside a positioned box', () => {
    const { container } = render(<HudPanel><span>x</span></HudPanel>);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.position).toBe('absolute');
    expect(box.textContent).toContain('x');
  });
  it('PanelHeader shows english + cjk + index', () => {
    const { container } = render(<PanelHeader en="Network" cjk="网络" idx="NET-02" />);
    expect(container.textContent).toContain('Network');
    expect(container.textContent).toContain('网络');
    expect(container.textContent).toContain('NET-02');
  });
  it('StatRow shows label + value', () => {
    const { container } = render(<StatRow label="Peers">47</StatRow>);
    expect(container.textContent).toContain('Peers');
    expect(container.textContent).toContain('47');
  });
  it('Gauge fills to the ratio percentage', () => {
    const { container } = render(<Gauge ratio={0.5} color="#27FF5A" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });
  it('Gauge clamps out-of-range ratios to 100%', () => {
    const { container } = render(<Gauge ratio={2} color="#27FF5A" />);
    expect((container.querySelector('[data-fill]') as HTMLElement).style.width).toBe('100%');
  });
});
