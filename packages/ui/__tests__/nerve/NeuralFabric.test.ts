import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fabricEdgeKey, orderFabricStateKeys } from '../../src/nerve/fabricOrder';

const SRC = readFileSync(resolve(process.cwd(), 'src/nerve/NeuralFabric.tsx'), 'utf8');

describe('NeuralFabric edge ordering', () => {
  it('follows the latest graph priority even for already-seen edges', () => {
    const existingInsertionOrder = [
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
      fabricEdgeKey(3, 4),
      fabricEdgeKey(9, 10),
    ];

    const { order, liveKeys } = orderFabricStateKeys(
      [
        { from: 3, to: 4 },
        { from: 1, to: 2 },
        { from: 2, to: 3 },
      ],
      existingInsertionOrder,
    );

    expect(order).toEqual([
      fabricEdgeKey(3, 4),
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
      fabricEdgeKey(9, 10),
    ]);
    expect(liveKeys).toEqual(new Set([
      fabricEdgeKey(3, 4),
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
    ]));
  });
});

describe('NeuralFabric living-mesh handles', () => {
  it('exposes growEdges and killEdges and uses the pure render math', () => {
    expect(SRC).toContain('growEdges');
    expect(SRC).toContain('killEdges');
    expect(SRC).toContain('fabricEdgeRenderState');
  });

  it('reconciliation deaths via setFabric are tagged gc (quiet), not death', () => {
    // setFabric's pass-2 must set deathKind 'gc' so corrections fade, not retract+flash.
    expect(SRC).toMatch(/deathKind\s*=\s*['"]gc['"]/);
  });

  it('drops the local GROWTH_MS/DECAY_MS consts in favour of the pure module (single source of truth)', () => {
    // The lifecycle timings live in ./fabricEdgeRender now; NeuralFabric imports them.
    expect(SRC).not.toMatch(/const\s+GROWTH_MS\s*=/);
    expect(SRC).not.toMatch(/const\s+DECAY_MS\s*=/);
    expect(SRC).toMatch(/from\s+['"]\.\/fabricEdgeRender['"]/);
  });
});
