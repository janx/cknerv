// The consensus identity is a scan of the retained link ring for this Cell's
// creating write. The review read it as re-derived "per delta"; it is keyed on
// the ring's identity, and the reducer copies the ring only when a link batch
// writes it — a pulse, a birth, a death or a tag leaves the ring's identity
// alone, and so leaves this memo alone. These pins hold that: one derive per
// distinct ring, none for a batch that did not touch it.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';

const { deriveCalls } = vi.hoisted(() => ({ deriveCalls: { count: 0 } }));

vi.mock('../../../src/derives/cellConsensusIdentity.derive', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/derives/cellConsensusIdentity.derive')
  >();
  return {
    ...original,
    deriveCellConsensusIdentity: (
      ...args: Parameters<typeof original.deriveCellConsensusIdentity>
    ) => {
      deriveCalls.count += 1;
      return original.deriveCellConsensusIdentity(...args);
    },
  };
});

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: () => <div data-testid="portrait" />,
  SCAN_PERIOD_S: 4.2,
}));

import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';

afterEach(() => {
  cleanup();
  deriveCalls.count = 0;
});

const cell: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0x', data_bytes: 0,
  content_hash: '0x' + '11'.repeat(32), lock_kind: 'omnilock', asset_kind: 'native',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
};
const origin: CellLink = {
  seq: 7,
  tx_hash: cell.out_point.tx_hash,
  block: cell.birth_block,
  from_ids: [1],
  to_ids: [cell.id],
  endpoint_anchors: [],
  parents: [],
  tag: null,
  at_ms: 1_000,
};
const onClose = () => {};

function Host({ links, cells }: {
  links: readonly CellLink[];
  cells: ReadonlyMap<number, Cell>;
}) {
  return (
    <CellDetailPanel
      cell={cell}
      recentLinks={links}
      routeCellById={cells}
      onClose={onClose}
    />
  );
}

describe('CellDetailPanel consensus identity memo', () => {
  it('re-derives once per distinct link ring, and never for a batch that left it alone', () => {
    const links: CellLink[] = [origin];
    const cells = new Map<number, Cell>([[cell.id, cell]]);
    const { container, rerender } = render(<Host links={links} cells={cells} />);
    expect(deriveCalls.count).toBe(1);
    // The scan found the creating write: the trace affordance stands.
    expect(container.querySelector('[data-write-observed]')).not.toBeNull();

    // A pulse-only delta: the reducer copies neither the ring nor the map,
    // so the panel is handed the same identities and renders nothing.
    rerender(<Host links={links} cells={cells} />);
    expect(deriveCalls.count).toBe(1);

    // A cells batch that patched another record: the map is fresh, the ring
    // is not, and the identity is a fact about the ring.
    rerender(<Host links={links} cells={new Map(cells)} />);
    expect(deriveCalls.count).toBe(1);

    // A links batch: the ring is fresh, and it may hold a newer write for
    // this Cell or have evicted the one found — so the scan runs, once.
    rerender(<Host links={[...links]} cells={cells} />);
    expect(deriveCalls.count).toBe(2);
  });
});
