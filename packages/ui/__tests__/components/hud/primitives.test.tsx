import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import {
  Gauge,
  HudPanel,
  PanelHeader,
  ReadoutHeader,
  ScopeStage,
  StatRow,
  STAT_ROW_HEIGHT_PX,
  STAT_ROW_LIFTED_HEIGHT_PX,
} from '../../../src/components/hud/primitives';

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
  it('StatRow stands at the rail rhythm, and taller by the rung it lifts', () => {
    // A plain row is the rhythm; a lifted one is the rhythm plus the ascent its
    // numeral adds, so the row underneath keeps its 17 px of baseline. Rendered
    // rather than read off the constant: what has to be true is that the prop
    // reaches the box.
    const plain = render(<StatRow label="Peers">47</StatRow>);
    expect((plain.container.firstElementChild as HTMLElement).style.height)
      .toBe(`${STAT_ROW_HEIGHT_PX}px`);
    cleanup();
    for (const [rung, height] of Object.entries(STAT_ROW_LIFTED_HEIGHT_PX)) {
      const { container } = render(
        <StatRow label="Tip" lifted={rung as keyof typeof STAT_ROW_LIFTED_HEIGHT_PX}>47</StatRow>,
      );
      const box = container.firstElementChild as HTMLElement;
      expect(box.style.height, rung).toBe(`${height}px`);
      expect(box.dataset.hudStatLift, rung).toBe(rung);
      cleanup();
    }
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
  it('ReadoutHeader presents domain and freshness without source provenance', () => {
    const { container } = render(
      <ReadoutHeader title="TX HORIZON" meta="AS OF #100" accent="#20F0FF" stale />,
    );
    expect(container.querySelector('[data-readout-title]')?.textContent).toBe('TX HORIZON');
    expect(container.querySelector('[data-readout-meta]')?.textContent).toBe('· AS OF #100');
    expect(container.querySelector('[data-readout-stale]')?.textContent).toBe('· STALE');
    expect(container.textContent).not.toContain('INDEXED');
  });
  it('ScopeStage connects progressive scopes but terminates the final stage', () => {
    const { container } = render(
      <>
        <ScopeStage id="local" label="Local" meta="Direct" accent="#69e7ff">base</ScopeStage>
        <ScopeStage id="global" label="Global" accent="#78f2b3" terminal>enhanced</ScopeStage>
      </>,
    );
    const local = container.querySelector('[data-scope-stage="local"]');
    const global = container.querySelector('[data-scope-stage="global"]');
    expect(local?.textContent).toContain('LocalDirectbase');
    expect(local?.querySelector('[data-scope-connector]')).not.toBeNull();
    expect(global?.textContent).toContain('Globalenhanced');
    expect(global?.querySelector('[data-scope-connector]')).toBeNull();
  });
});
