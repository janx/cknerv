import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Canvas } from '@react-three/fiber';

import EventStreamHud, {
  type RenderedLine,
} from '../../src/components/EventStreamHud';
import { buildEventLines } from '../../src/derives/eventStreamLines';

describe('buildEventLines (generic EventStreamHud row-builder)', () => {
  it('formatRow returning null filters the entry from the rendered list', () => {
    const entries = [1, 2, 3, 4];
    const formatRow = (n: number): RenderedLine | null =>
      n % 2 === 0
        ? { seq: n, ts: 0, kind: 'EVEN', detail: String(n), color: '#fff' }
        : null;

    const lines = buildEventLines(entries, formatRow, 10);
    expect(lines).toHaveLength(2);
    // newest-first ordering: entries iterated from index high→low,
    // even entries are 4 and 2, so output order is [4, 2].
    expect(lines.map((l) => l.detail)).toEqual(['4', '2']);
  });

  it('limit caps the output at the most-recent N entries', () => {
    const entries = [1, 2, 3, 4, 5];
    const formatRow = (n: number): RenderedLine | null => ({
      seq: n,
      ts: 0,
      kind: 'NUM',
      detail: String(n),
      color: '#fff',
    });

    const lines = buildEventLines(entries, formatRow, 3);
    expect(lines).toHaveLength(3);
    // newest-first: takes entries 5, 4, 3 in that order.
    expect(lines.map((l) => l.detail)).toEqual(['5', '4', '3']);
  });
});

describe('EventStreamHud generic mount', () => {
  it('mounts inside an r3f Canvas with an arbitrary Entry type without throwing', () => {
    type Entry = { id: number; label: string };
    const entries: Entry[] = [
      { id: 1, label: 'alpha' },
      { id: 2, label: 'beta' },
    ];
    const formatRow = (e: Entry): RenderedLine | null => ({
      seq: e.id,
      ts: 0,
      kind: 'KIND',
      detail: e.label,
      color: '#abcdef',
    });

    expect(() =>
      render(
        <Canvas>
          <EventStreamHud<Entry>
            entries={entries}
            formatRow={formatRow}
            x={0}
            y={0}
            width={400}
            limit={10}
          />
        </Canvas>,
      ),
    ).not.toThrow();
  });
});
