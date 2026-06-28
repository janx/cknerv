import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import BlockCadenceEcg from '../../../src/components/hud/BlockCadenceEcg';

afterEach(cleanup);

const base = {
  intervalsMs: [8000, 8000, 8000],
  sizes: [400, 900, 1500],
  txCounts: [2, 8, 20],
  lastBlockTsMs: 1_000_000,
  targetMs: 8000,
  avgMs: 8000,
  gapMs: 1200,
  reducedMotion: true as const,
};

describe('BlockCadenceEcg', () => {
  it('renders the canvas, title, condition word and live readouts', () => {
    const { container } = render(<BlockCadenceEcg {...base} condition="FINE" />);
    expect(container.querySelector('canvas')).toBeTruthy();
    const t = container.textContent ?? '';
    expect(t).toContain('BLOCK CADENCE');
    expect(t).toContain('脉搏');
    expect(t).toContain('FINE');
    expect(t).toContain('SINCE LAST');
    expect(t).toContain('TGT');
    expect(t).toContain('AVG');
    expect(t).toContain('RATE');
  });
  it('reflects a flatline condition', () => {
    const { container } = render(<BlockCadenceEcg {...base} condition="FLATLINE" gapMs={80000} />);
    expect(container.textContent).toContain('FLATLINE');
  });
  it('renders with an empty interval buffer (no last block) without throwing', () => {
    const { container } = render(
      <BlockCadenceEcg intervalsMs={[]} sizes={[]} txCounts={[]} lastBlockTsMs={null} targetMs={8000} avgMs={null} gapMs={0} condition="FINE" reducedMotion />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
