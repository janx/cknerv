import { describe, expect, it } from 'vitest';
import type { Cell, CellLink, CellLinkEndpointAnchor } from '@cknerv/types';
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
    data_bytes: 0,
    content_hash: hash('cd'),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
    ...over,
  };
}

const selected = cell(42, {
  out_point: { tx_hash: hash('ab'), index: 1 },
});

const anchor = (
  record: Cell,
  resolved = true,
): CellLinkEndpointAnchor => ({
  id: record.id,
  pos_seed: record.pos_seed,
  // The server's identity-only anchor derives the place from the outpoint and
  // knows no content, so its hash is empty.
  content_hash: resolved ? record.content_hash : '',
  resolved,
});

function link(over: Partial<CellLink> = {}): CellLink {
  return {
    seq: 7,
    tx_hash: selected.out_point.tx_hash,
    block: selected.birth_block,
    from_ids: [7, 8],
    to_ids: [41, selected.id, 43],
    endpoint_anchors: [
      anchor(cell(7)),
      anchor(cell(8)),
      anchor(cell(41)),
      anchor(selected),
      anchor(cell(43)),
    ],
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

  it('keeps exact evidence geometry after full records leave the live cache', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link()],
      records(cell(7), selected, cell(43)),
    );

    expect(lens.status).toBe('exact');
    expect(lens.missingInputIds).toEqual([]);
    expect(lens.missingOutputIds).toEqual([]);
    expect(lens.inputs[1].record).toBeNull();
    expect(lens.inputs[1].anchor).toEqual(anchor(cell(8)));
    expect(lens.outputs.find((item) => item.id === 41)?.anchor)
      .toEqual(anchor(cell(41)));
    expect(lens.outputs.find((item) => item.id === selected.id)?.record)
      .toBe(selected);
  });

  it('stays partial only when neither an anchor nor a full record exists', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link({ endpoint_anchors: [] })],
      records(cell(7), selected, cell(43)),
    );

    expect(lens.status).toBe('partial');
    expect(lens.missingInputIds).toEqual([8]);
    expect(lens.missingOutputIds).toEqual([41]);
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
      anchor: anchor(selected),
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

  it('publishes the retained origin record so callers need not rescan the ring', () => {
    const origin = link({ seq: 11 });
    const lens = deriveCellCausalLens(
      selected,
      [link({ to_ids: [99] }), origin],
      records(cell(7), cell(8), selected, cell(43)),
    );

    expect(lens.originLink).toBe(origin);
    expect(lens.linkSeq).toBe(origin.seq);
    expect(deriveCellCausalLens(selected, [], records(selected)).originLink)
      .toBeNull();
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

  it('reads the same neighbourhood when identity-only anchors ride the record', () => {
    const held = records(cell(41), selected, cell(43));
    const plain = deriveCellCausalLens(selected, [link()], held);
    // The derived twin of input 7 leads the array: a reader that took the
    // first anchor per id would hand back an empty content hash.
    const mixed = deriveCellCausalLens(
      selected,
      [link({
        endpoint_anchors: [
          anchor(cell(7), false),
          anchor(cell(7)),
          anchor(cell(8)),
          anchor(cell(9), false),
          anchor(cell(41)),
          anchor(selected),
          anchor(cell(43)),
        ],
      })],
      held,
    );

    expect({ ...mixed, originLink: null })
      .toEqual({ ...plain, originLink: null });
    expect(mixed.status).toBe('exact');
    expect(mixed.inputs.map((item) => item.anchor?.content_hash))
      .toEqual([cell(7).content_hash, cell(8).content_hash]);
  });

  // The exclusion is the reader's, not the writer's to grant: today no derived
  // id reaches `from_ids`, and the lens must not start trusting that.
  it('refuses an identity-only anchor even when the record lists it as an input', () => {
    const lens = deriveCellCausalLens(
      selected,
      [link({
        from_ids: [7, 9],
        endpoint_anchors: [
          anchor(cell(7)),
          anchor(cell(9), false),
          anchor(cell(41)),
          anchor(selected),
          anchor(cell(43)),
        ],
      })],
      records(cell(41), selected, cell(43)),
    );

    expect(lens.inputs.map((item) => item.id)).toEqual([7, 9]);
    expect(lens.inputs[0].anchor?.content_hash).toBe(cell(7).content_hash);
    expect(lens.inputs[1].anchor).toBeNull();
    expect(lens.missingInputIds).toEqual([9]);
    expect(lens.status).toBe('partial');
  });

  it('keeps anchors from records written before the resolved field existed', () => {
    const legacy = { ...anchor(cell(7)) } as Partial<CellLinkEndpointAnchor>;
    delete legacy.resolved;
    const lens = deriveCellCausalLens(
      selected,
      [link({
        from_ids: [7],
        endpoint_anchors: [
          legacy as CellLinkEndpointAnchor,
          anchor(cell(41)),
          anchor(selected),
          anchor(cell(43)),
        ],
      })],
      records(cell(41), selected, cell(43)),
    );

    expect(lens.missingInputIds).toEqual([]);
    expect(lens.inputs[0].anchor?.content_hash).toBe(cell(7).content_hash);
    expect(lens.status).toBe('exact');
  });
});
