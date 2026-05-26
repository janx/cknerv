import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';

import CellDetailHud from '../../src/components/CellDetailHud';
import type { Cell } from '@cknerv/types';

const baseCell: Cell = {
  id: 7,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 42,
  tag: 'dex',
  pos_seed: [0, 0, 0],
  out_point: {
    tx_hash:
      '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    index: 3,
  },
  capacity: 12_345_000_000,
  data_hex: '0xdeadbeef',
  content_hash: '0x' + '00'.repeat(32),
};

describe('CellDetailHud', () => {
  it('renders the single-column 6-field cell body without throwing', () => {
    expect(() =>
      render(
        <Canvas>
          <CellDetailHud
            cell={baseCell}
            onClose={() => {}}
            x={0}
            y={0}
            width={300}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });

  it('formats GENERIC kind for null tag', () => {
    const generic: Cell = { ...baseCell, tag: null };
    expect(() =>
      render(
        <Canvas>
          <CellDetailHud
            cell={generic}
            onClose={() => {}}
            x={0}
            y={0}
            width={300}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});
