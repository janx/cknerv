// The render-count half of the inspector's memo: a parent render that hands
// the overlay the same prop values must not reach the dossier, and one that
// changes the navigation readout must reach it exactly once.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { CellCausalNavigationReadout } from '../../src/components/hud/CellCausalLensReadout';

const { panelRenders } = vi.hoisted(() => ({ panelRenders: { count: 0 } }));

// The dossier is replaced by a counter; its named exports stay real because
// the overlay computes the connector accent through them while rendering.
vi.mock('../../src/components/hud/CellDetailPanel', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../src/components/hud/CellDetailPanel')
  >();
  const { memo } = await import('react');
  return {
    ...original,
    default: memo(function CellDetailPanel({ cell }: { cell: Cell }) {
      panelRenders.count += 1;
      return <div data-testid="dossier" data-cell-id={cell.id} />;
    }),
  };
});

import CellInspectionOverlay, {
  createCellInspectionHandles,
} from '../../src/components/CellInspectionOverlay';

afterEach(() => {
  cleanup();
  panelRenders.count = 0;
});

const cell: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0x', data_bytes: 0,
  content_hash: '0x' + '11'.repeat(32), lock_kind: 'omnilock', asset_kind: 'native',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
};
const recentLinks: readonly CellLink[] = [];
const onClose = () => {};
const navigation: CellCausalNavigationReadout = {
  position: 2,
  total: 3,
  backCellId: 7,
  forwardCellId: 9,
  onBack: () => {},
  onForward: () => {},
};

/** A parent whose own render is the event under test: `tick` is never read
 *  by the overlay, so a tick alone is an App render the card has no stake in. */
function Host({ navigation: readout }: {
  tick: number;
  navigation: CellCausalNavigationReadout | null;
}) {
  return (
    <CellInspectionOverlay
      handles={handles}
      cell={cell}
      recentLinks={recentLinks}
      causalNavigation={readout}
      onClose={onClose}
    />
  );
}
const handles = createCellInspectionHandles();

describe('CellInspectionOverlay memo', () => {
  it('lets a parent render with unchanged props pass over the dossier', () => {
    const { rerender } = render(<Host tick={0} navigation={null} />);
    expect(panelRenders.count).toBe(1);

    // Five App renders that carry nothing for the card: a mempool tick, a
    // peer poll, a hover, a chain batch, a stream-health flip.
    for (let tick = 1; tick <= 5; tick += 1) {
      act(() => { rerender(<Host tick={tick} navigation={null} />); });
    }
    expect(panelRenders.count).toBe(1);
  });

  it('still re-renders the dossier once for a navigation that moved', () => {
    const { rerender } = render(<Host tick={0} navigation={null} />);
    expect(panelRenders.count).toBe(1);

    act(() => { rerender(<Host tick={1} navigation={navigation} />); });
    expect(panelRenders.count).toBe(2);
    // …and holds again while that readout keeps its identity.
    act(() => { rerender(<Host tick={2} navigation={navigation} />); });
    expect(panelRenders.count).toBe(2);
  });
});
