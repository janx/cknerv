import { describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import { deriveCellCausalLens } from '../../src/derives/cellCausalLens.derive';

const hash = (pair: string): string => `0x${pair.repeat(32)}`;

function cell(
  id: number,
  over: Partial<Cell> = {},
): Cell {
  return {
    id,
    born_at_ms: 1_000 + id,
    death_at_ms: null,
    birth_block: 808,
    tag: null,
    pos_seed: [id, 0, id * -0.5],
    out_point: { tx_hash: hash('ab'), index: id },
    capacity: 6_100_000_000,
    data_hex: '0x',
    content_hash: hash('cd'),
    ...over,
  };
}

const selected = cell(42, {
  out_point: { tx_hash: hash('ab'), index: 1 },
});

function link(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 7,
    tx_hash: selected.out_point.tx_hash,
    block: selected.birth_block,
    from_ids: [7, 8],
    to_ids: [41, selected.id, 43],
    parents: [hash('01'), hash('02')],
    tag: null,
    at_ms: 1_500,
    ...over,
  };
}

function records(...items: Cell[]): Map<number, Cell> {
  return new Map(items.map((item) => [item.id, item]));
}

describe('deriveCellCausalLens', () => {
  it('resolves an exact observed input → transaction → output neighbourhood', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link()],
      records(cell(7), cell(8), cell(41), selected, cell(43)),
    );

    expect(lens.status).toBe('exact');
    expect(lens.linkSeq).toBe(7);
    expect(lens.inputCount).toBe(2);
    expect(lens.outputCount).toBe(3);
    expect(lens.inputs.map(({ id, role }) => [id, role])).toEqual([
      [7, 'input'],
      [8, 'input'],
    ]);
    expect(lens.outputs.map(({ id, role }) => [id, role])).toEqual([
      [41, 'sibling'],
      [42, 'selected'],
      [43, 'sibling'],
    ]);
    expect(lens.missingInputIds).toEqual([]);
    expect(lens.missingOutputIds).toEqual([]);
  });

  it('keeps an observed link partial when endpoint records leave the cache', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link()],
      records(cell(7), selected, cell(43)),
    );

    expect(lens.status).toBe('partial');
    expect(lens.missingInputIds).toEqual([8]);
    expect(lens.missingOutputIds).toEqual([41]);
    expect(lens.inputs[1].record).toBeNull();
    expect(lens.outputs.find((item) => item.id === selected.id)?.record)
      .toBe(selected);
  });

  it('reports identity-only evidence when no exact origin link is retained', () => {
    const lens = deriveCellCausalLens(
      selected,
      [
        link({ to_ids: [99] }),
        link({ seq: 8, block: selected.birth_block + 1 }),
      ],
      records(selected),
    );

    expect(lens.status).toBe('unavailable');
    expect(lens.linkSeq).toBeNull();
    expect(lens.inputCount).toBeNull();
    expect(lens.outputCount).toBeNull();
    expect(lens.inputs).toEqual([]);
    expect(lens.outputs).toEqual([{
      id: selected.id,
      ordinal: selected.out_point.index,
      role: 'selected',
      record: selected,
    }]);
  });

  it('uses the newest case-insensitive exact origin observation', () => {
    const lens = deriveCellCausalLens(
      selected,
      [
        link(),
        link({
          seq: 11,
          tx_hash: selected.out_point.tx_hash.toUpperCase(),
          from_ids: [7],
          to_ids: [selected.id],
        }),
      ],
      records(cell(7), selected),
    );

    expect(lens.status).toBe('exact');
    expect(lens.linkSeq).toBe(11);
    expect(lens.txHash).toBe(selected.out_point.tx_hash.toUpperCase());
    expect(lens.inputCount).toBe(1);
    expect(lens.outputCount).toBe(1);
  });

  it('treats a retained cellbase-style write with no inputs as exact', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link({ from_ids: [], to_ids: [selected.id] })],
      records(selected),
    );

    expect(lens.status).toBe('exact');
    expect(lens.inputCount).toBe(0);
    expect(lens.outputCount).toBe(1);
  });

  it('deduplicates malformed repeated endpoint ids without changing order', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link({
        from_ids: [7, 7, 8],
        to_ids: [selected.id, 43, selected.id],
      })],
      records(cell(7), cell(8), selected, cell(43)),
    );

    expect(lens.inputs.map((item) => item.id)).toEqual([7, 8]);
    expect(lens.outputs.map((item) => item.id)).toEqual([42, 43]);
  });
});
