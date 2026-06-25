import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { useCellChurn } from '../../../src/components/hud/useCellChurn';

function Probe({ tip, born, dead }: { tip: number; born: number; dead: number }) {
  const r = useCellChurn(tip, born, dead);
  return <span>{`${r.bornPerBlock}|${r.spentPerBlock}|${r.netPerBlock}`}</span>;
}
afterEach(cleanup);

describe('useCellChurn', () => {
  it('accumulates samples on tip increase and reports per-block rates', () => {
    const { container, rerender } = render(<Probe tip={100} born={10} dead={5} />);
    expect(container.textContent).toBe('0|0|0'); // only one sample so far
    rerender(<Probe tip={108} born={36} dead={21} />); // span 8: +26 born, +16 dead
    expect(container.textContent).toBe('3.25|2|1.25');
  });
  it('does not add a sample when tip is unchanged', () => {
    const { container, rerender } = render(<Probe tip={100} born={10} dead={5} />);
    rerender(<Probe tip={100} born={99} dead={99} />); // same tip → ignored
    expect(container.textContent).toBe('0|0|0');
  });
});
