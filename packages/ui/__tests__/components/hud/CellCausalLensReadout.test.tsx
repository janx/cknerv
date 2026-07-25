import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import CellCausalLensReadout from '../../../src/components/hud/CellCausalLensReadout';
import { deriveCellCausalLens } from '../../../src/derives/cellCausalLens.derive';

afterEach(cleanup);

const hash = (pair: string): string => `0x${pair.repeat(32)}`;

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: id,
    death_at_ms: null,
    birth_block: 88,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: hash('ab'), index: id },
    capacity: 1,
    data_hex: '0x',
    content_hash: hash('cd'),
  };
}

const selected = cell(9);
const link: CellLink = {
  seq: 12,
  tx_hash: selected.out_point.tx_hash,
  block: selected.birth_block,
  from_ids: [1, 2],
  to_ids: [8, 9],
  parents: [],
  tag: null,
  at_ms: 100,
};

describe('CellCausalLensReadout', () => {
  it('labels a complete retained origin as exact observed evidence', () => {
    const records = new Map([
      [1, cell(1)],
      [2, cell(2)],
      [8, cell(8)],
      [9, selected],
    ]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.getAttribute('data-causal-status')).toBe('exact');
    expect(root.getAttribute('data-causal-provenance')).toBe('observed');
    expect(root.getAttribute('data-causal-inputs-retained')).toBe('2');
    expect(root.getAttribute('data-causal-outputs-retained')).toBe('2');
    expect(root.textContent).toContain('2/2 INPUTS');
    expect(root.textContent).toContain('2/2 OUTPUTS');
    expect(root.textContent).toContain('ALL ENDPOINT RECORDS RETAINED');
  });

  it('reports exactly how many observed endpoints are missing', () => {
    const records = new Map([[1, cell(1)], [9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.getAttribute('data-causal-status')).toBe('partial');
    expect(root.textContent).toContain('1/2 INPUTS');
    expect(root.textContent).toContain('1/2 OUTPUTS');
    expect(root.textContent).toContain('2 ENDPOINTS OUTSIDE LIVE CACHE');
  });

  it('does not invent endpoint totals outside the retained link window', () => {
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [], new Map([[9, selected]]))}
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.getAttribute('data-causal-status')).toBe('unavailable');
    expect(root.getAttribute('data-causal-provenance')).toBe('identity-only');
    expect(root.getAttribute('data-causal-inputs-total')).toBe('');
    expect(root.textContent).toContain('? INPUTS');
    expect(root.textContent).toContain('1+ OUTPUTS');
    expect(root.textContent).toContain('IDENTITY ONLY');
    expect(root.textContent).toContain('LINK OUTSIDE RETAINED WINDOW');
  });
});
