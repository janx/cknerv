import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import BlockCadenceEcg from '../../../src/components/hud/BlockCadenceEcg';

afterEach(cleanup);

describe('BlockCadenceEcg', () => {
  it('renders a canvas and the condition word', () => {
    const { container } = render(<BlockCadenceEcg tip={100} condition="FINE" reducedMotion />);
    expect(container.querySelector('canvas')).toBeTruthy();
    expect(container.textContent).toContain('FINE');
    expect(container.textContent).toContain('BLOCK CADENCE');
    expect(container.textContent).toContain('脉搏');
  });
  it('reflects a flatline condition', () => {
    const { container } = render(<BlockCadenceEcg tip={100} condition="FLATLINE" reducedMotion />);
    expect(container.textContent).toContain('FLATLINE');
  });
});
