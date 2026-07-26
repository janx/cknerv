import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
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
const anchor = (record: Cell) => ({
  id: record.id,
  pos_seed: record.pos_seed,
  content_hash: record.content_hash,
});
const link: CellLink = {
  seq: 12,
  tx_hash: selected.out_point.tx_hash,
  block: selected.birth_block,
  from_ids: [1, 2],
  to_ids: [8, 9],
  endpoint_anchors: [
    anchor(cell(1)),
    anchor(cell(2)),
    anchor(cell(8)),
    anchor(selected),
  ],
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
    expect(root.getAttribute('data-causal-inputs-anchored')).toBe('2');
    expect(root.getAttribute('data-causal-outputs-anchored')).toBe('2');
    expect(root.getAttribute('data-causal-endpoints-archived')).toBe('0');
    expect(root.textContent).toContain('2/2 INPUTS');
    expect(root.textContent).toContain('2/2 OUTPUTS');
    expect(root.textContent).toContain('ALL ENDPOINT RECORDS LIVE');
  });

  it('reports complete archived anchors without calling them live records', () => {
    const records = new Map([[1, cell(1)], [9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.getAttribute('data-causal-status')).toBe('exact');
    expect(root.getAttribute('data-causal-inputs-anchored')).toBe('2');
    expect(root.getAttribute('data-causal-outputs-anchored')).toBe('2');
    expect(root.getAttribute('data-causal-endpoints-archived')).toBe('2');
    expect(root.textContent).toContain('2/2 INPUTS');
    expect(root.textContent).toContain('2/2 OUTPUTS');
    expect(root.textContent).toContain('2 ARCHIVED ANCHORS');
  });

  it('reports exactly how many observed endpoint anchors are missing', () => {
    const records = new Map([[1, cell(1)], [9, selected]]);
    const partialLink: CellLink = {
      ...link,
      endpoint_anchors: [anchor(cell(1)), anchor(selected)],
    };
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [partialLink], records)}
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.getAttribute('data-causal-status')).toBe('partial');
    expect(root.textContent).toContain('1/2 INPUTS');
    expect(root.textContent).toContain('1/2 OUTPUTS');
    expect(root.textContent).toContain('2 ENDPOINT ANCHORS MISSING');
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

  it('exposes browser-like back and forward controls for a causal path', () => {
    const records = new Map([
      [1, cell(1)],
      [2, cell(2)],
      [8, cell(8)],
      [9, selected],
    ]);
    const onBack = vi.fn();
    const onForward = vi.fn();
    const { container, getByRole } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        navigation={{
          position: 2,
          total: 3,
          backCellId: 1,
          forwardCellId: 8,
          onBack,
          onForward,
        }}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Back to Cell 1' }));
    fireEvent.click(getByRole('button', { name: 'Forward to Cell 8' }));

    const navigation = container.querySelector('[data-causal-navigation]')!;
    expect(navigation.getAttribute('data-causal-navigation-position')).toBe('2');
    expect(navigation.textContent).toContain('PATH 2/3');
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
  });

  it('disables an unavailable direction at a path boundary', () => {
    const { getByRole } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [], new Map([[9, selected]]))}
        navigation={{
          position: 1,
          total: 2,
          backCellId: null,
          forwardCellId: 8,
          onBack: vi.fn(),
          onForward: vi.fn(),
        }}
      />,
    );

    expect(getByRole('button', { name: 'No back causal Cell' })
      .hasAttribute('disabled')).toBe(true);
    expect(getByRole('button', { name: 'Forward to Cell 8' })
      .hasAttribute('disabled')).toBe(false);
  });
});
