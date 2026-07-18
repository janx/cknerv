import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@cknerv/types';

vi.mock('../../../src/components/hud/ConsensusMemory', () => ({
  default: ({ focusField, traceReadout, traceResponseRef }: {
    focusField?: string | null;
    traceReadout?: { stage: string } | null;
    traceResponseRef?: { current: unknown };
  }) => (
    <div
      data-testid="relic"
      data-focus={focusField ?? ''}
      data-trace-stage={traceReadout?.stage ?? ''}
      data-response-ref={traceResponseRef ? 'true' : 'false'}
    />
  ),
}));
vi.mock('../../../src/components/hud/QuantumLoomCore', () => ({
  default: () => <div data-testid="loom" />,
}));
vi.mock('../../../src/components/hud/InscribedBraidCore', () => ({
  default: () => <div data-testid="synthesis" />,
}));

import CellCoreArtwork, {
  CELL_CORE_DIRECTIONS,
  type CellCoreDirection,
} from '../../../src/components/hud/CellCoreArtwork';

const CELL = {
  id: 1,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 1,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: 0 },
  capacity: 61e8,
  data_hex: '0x',
  content_hash: `0x${'22'.repeat(32)}`,
  lock_kind: 'sighash',
  asset_kind: 'native',
} satisfies Cell;

afterEach(cleanup);

describe('CellCoreArtwork', () => {
  it('exposes refined A, refined C, and their synthesis', () => {
    expect(CELL_CORE_DIRECTIONS.map((item) => item.id)).toEqual([
      'relic',
      'loom',
      'synthesis',
    ]);
    expect(new Set(CELL_CORE_DIRECTIONS.map((item) => item.name)).size).toBe(3);
    expect(CELL_CORE_DIRECTIONS[0]).toMatchObject({
      id: 'relic',
      name: 'PSIONIC BRAID',
      cjk: '灵能编织',
      character: 'woven / agreement knots',
    });
  });

  it.each(CELL_CORE_DIRECTIONS)('routes $id to its dedicated renderer', async ({ id }) => {
    const { findByTestId } = render(
      <CellCoreArtwork
        direction={id as CellCoreDirection}
        cell={CELL}
        reducedMotion
      />,
    );
    expect(await findByTestId(id)).toBeTruthy();
  });

  it('threads readable field focus into the production A renderer', () => {
    const responseRef = { current: null };
    const { getByTestId } = render(
      <CellCoreArtwork
        direction="relic"
        cell={CELL}
        reducedMotion
        focusField="data"
        traceReadout={{
          key: '7:1:1', targetCellId: 1, sourceKind: 'input', stage: 'locked',
          sourceCount: 2, arrivedSourceCount: 2, resolvedSourceCount: 2,
          evidence: [1, 2].map((ordinal) => ({
            sourceId: ordinal,
            ordinal,
            contentHash: `0x${String(ordinal).repeat(64)}`,
            state: 'resolved' as const,
          })),
        }}
        traceResponseRef={responseRef}
      />,
    );
    expect(getByTestId('relic').getAttribute('data-focus')).toBe('data');
    expect(getByTestId('relic').getAttribute('data-trace-stage')).toBe('locked');
    expect(getByTestId('relic').getAttribute('data-response-ref')).toBe('true');
  });
});
