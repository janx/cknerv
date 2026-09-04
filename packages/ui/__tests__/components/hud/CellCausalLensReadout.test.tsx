import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type {
  Cell,
  CellLink,
  TransactionSemanticRecord,
} from '@cknerv/types';
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
    data_bytes: 0,
    content_hash: hash('cd'),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

const selected = cell(9);
const anchor = (record: Cell) => ({
  id: record.id,
  pos_seed: record.pos_seed,
  content_hash: record.content_hash,
  resolved: true,
});
const originTransaction = (
  overrides: Partial<TransactionSemanticRecord> = {},
): TransactionSemanticRecord => ({
  tx_hash: selected.out_point.tx_hash,
  block: selected.birth_block,
  source: 'ckbadger',
  as_of: { block: selected.birth_block, hash: hash('ef') },
  updated_at_ms: 1,
  actions: [],
  participants: [],
  ...overrides,
});
const spender = {
  tx_hash: hash('9e'),
  block: 141,
};
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
    // The row says what it is and what it holds, in words nobody has to be
    // taught — "causal lens" was a term of art the reader never learned.
    expect(root.textContent).toContain('ORIGIN TX');
    expect(root.textContent).not.toContain('CAUSAL LENS');
    expect(root.querySelector('[data-causal-origin-caption]')?.textContent)
      .toBe('THE TRANSACTION THAT CREATED THIS CELL · 2 IN → 2 OUT');
    expect(root.textContent).toContain('LINK RETAINED · ALL ENDPOINTS PROVEN');
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
    // An archived endpoint proved its anchor and lost its record: the note
    // keeps that distinction instead of flattening it into "proven".
    expect(root.textContent)
      .toContain('LINK RETAINED · ALL ENDPOINTS PROVEN · 2 FROM ARCHIVE');
  });

  it('reduces the spatial lens to one no-scroll provenance summary', () => {
    const records = new Map([
      [1, cell(1)],
      [2, cell(2)],
      [8, cell(8)],
      [9, selected],
    ]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        summary
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.getAttribute('data-causal-density')).toBe('summary');
    expect(root.textContent).toContain('2/2 IN · 2/2 OUT');
    // Both densities now speak one vocabulary — the summary can no longer
    // describe the same evidence with a different sentence.
    expect(root.querySelector('[data-causal-summary-note="true"]')?.textContent)
      .toBe('LINK RETAINED · ALL ENDPOINTS PROVEN');
    expect(root.textContent).toContain('ORIGIN TX');
    expect(root.querySelector('[data-causal-origin-caption]')?.textContent)
      .toBe('THE TRANSACTION THAT CREATED THIS CELL · 2 IN → 2 OUT');
    expect(root.textContent).not.toContain('SIBLINGS');
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
    expect(root.textContent).toContain('LINK RETAINED · 2 ANCHORS MISSING');
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
    expect(root.textContent).toContain('ORIGIN LINK NO LONGER IN MEMORY');
    expect(root.querySelector('[data-causal-unavailable-summary="true"]'))
      .not.toBeNull();
    // Nothing to count outside the window: the caption states what the row is
    // and stops, instead of printing a shape it cannot prove.
    expect(root.querySelector('[data-causal-origin-caption]')?.textContent)
      .toBe('THE TRANSACTION THAT CREATED THIS CELL');
  });

  it('states what the origin transaction paid and burned, in honest units', () => {
    const records = new Map([[9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        transaction={originTransaction({ fee: '1000', cycles: 1234567 })}
        summary
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;
    const fee = root.querySelector('[data-causal-origin-value="fee"]')!;

    // A 1,000 shannon fee is 0.00001 CKB — the house CKB grammar would round
    // it to `0 CKB`, which is a different claim, so the shannon count itself
    // is the reading and the exact figure stays in the title.
    expect(fee.textContent).toBe('1,000 SHANNONS');
    expect(fee.getAttribute('title')).toBe('1000 shannons');
    expect(root.querySelector('[data-causal-origin-row="fee"]')?.textContent)
      .toBe('FEE1,000 SHANNONS');
    expect(root.querySelector('[data-causal-origin-value="cycles"]')?.textContent)
      .toBe('1,234,567');
  });

  it('reads a fee at or above one CKB in the house capacity grammar', () => {
    const records = new Map([[9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        transaction={originTransaction({ fee: '250000000' })}
        summary
      />,
    );

    expect(container.querySelector('[data-causal-origin-value="fee"]')?.textContent)
      .toBe('2.5 CKB');
  });

  it('reserves no origin rows for evidence the source never sent', () => {
    const records = new Map([[9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        summary
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;

    expect(root.querySelector('[data-causal-origin-facts]')).toBeNull();
    expect(root.textContent).not.toContain('FEE');
    expect(root.textContent).not.toContain('CYCLES');
  });

  it('prints no fee figure when the source states an unparsable one', () => {
    const records = new Map([[9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        transaction={originTransaction({ fee: '0x3e8', cycles: 0 })}
        summary
      />,
    );

    expect(container.querySelector('[data-causal-origin-row="fee"]')).toBeNull();
    expect(container.querySelector('[data-causal-origin-row="cycles"]')).toBeNull();
  });

  it('names the transaction that spent a dead cell', () => {
    const dead = { ...selected, death_at_ms: 5000 };
    const records = new Map([[9, dead]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(dead, [link], records)}
        consumed={spender}
        summary
      />,
    );
    const root = container.querySelector('[data-cell-causal-lens]')!;
    const consumed = root.querySelector('[data-causal-origin-row="consumed"]')!;
    const value = consumed.querySelector('[data-causal-origin-value="consumed"]')!;

    expect(value.textContent).toBe('0x9e9e…9e9e9e9e · #141');
    expect(value.getAttribute('title')).toBe(spender.tx_hash);
    expect(consumed.textContent).toContain('THE TRANSACTION THAT SPENT THIS CELL');
  });

  it('states a spender without a block when the source did not know one', () => {
    const dead = { ...selected, death_at_ms: 5000 };
    const records = new Map([[9, dead]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(dead, [link], records)}
        consumed={{ tx_hash: spender.tx_hash }}
        summary
      />,
    );

    expect(container.querySelector('[data-causal-origin-value="consumed"]')
      ?.textContent).toBe('0x9e9e…9e9e9e9e');
  });

  it('says nothing about a spender for a dead cell the source never named one for', () => {
    const dead = { ...selected, death_at_ms: 5000 };
    const records = new Map([[9, dead]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(dead, [link], records)}
        summary
      />,
    );

    expect(container.querySelector('[data-causal-origin-row="consumed"]')).toBeNull();
    expect(container.textContent).not.toContain('CONSUMED BY');
  });

  it('never announces a spender for a cell the projection still calls live', () => {
    const records = new Map([[9, selected]]);
    const { container } = render(
      <CellCausalLensReadout
        lens={deriveCellCausalLens(selected, [link], records)}
        consumed={spender}
        summary
      />,
    );

    expect(container.querySelector('[data-causal-origin-row="consumed"]')).toBeNull();
    expect(container.textContent).not.toContain('CONSUMED BY');
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
