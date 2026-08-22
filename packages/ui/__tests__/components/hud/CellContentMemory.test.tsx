import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { CellSemanticRecord, EnrichmentSourceStatus } from '@cknerv/types';
import CellContentMemory, {
  CELL_CONTENT_ANALYSIS_RESERVED_PX,
} from '../../../src/components/hud/CellContentMemory';

afterEach(() => { cleanup(); });

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['cell_detail'],
  lag_blocks: 0,
};

const DATA_HEX = `0x7b2261223a317d${'00'.repeat(33)}`;

function record(): CellSemanticRecord {
  return {
    out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 2 },
    source: 'ckbadger',
    as_of: { block: 16204800, hash: '0xanchor' },
    observed_at_block: 16204800,
    updated_at_ms: 1,
    asset: {
      type_script_hash: '0xtype',
      symbol: 'NTT',
      name: 'Nervos Test Token',
      standard: 'xUDT',
      amount: '12345',
      decimals: 2,
    },
    content: {
      data_hex: DATA_HEX,
      total_bytes: 40,
      deterministic: {
        kind: 'json_document',
        summary: 'UTF-8 JSON object decoded from Cell data',
        segments: [
          {
            start_byte: 0,
            end_byte: 1,
            label: 'object_start',
            value: '{',
            meaning: 'JSON object opening delimiter',
          },
          {
            start_byte: 1,
            end_byte: 7,
            label: 'document_body',
            value: '"a":1}',
            meaning: 'JSON body',
          },
        ],
      },
      heuristics: [
        {
          kind: 'text_encoding',
          confidence: 'high',
          reason: 'valid UTF-8',
          mime_type: 'application/json',
          value: '{"a":1}',
        },
      ],
    },
    facets: [
      {
        namespace: 'ckb',
        kind: 'dao',
        state: 'deposit',
        attributes: [{ key: 'deposit_block', value: '16204800', unit: 'block' }],
      },
    ],
  } as CellSemanticRecord;
}

/** Every stage row the window stages, in the order it stages them. */
function stageRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-cell-content-reveal-item]'),
  ) as HTMLElement[];
}

function displays(container: HTMLElement): string[] {
  return (Array.from(container.querySelectorAll('*')) as HTMLElement[])
    .map((node) => node.style.display);
}

describe('CellContentMemory reveal staging', () => {
  it('lays every stage out from the first frame and stages only the ink', () => {
    const { container, rerender } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={0}
      />,
    );

    const section = container.querySelector(
      '[data-cell-content-memory]',
    ) as HTMLElement;
    // Nothing is read yet — and everything is already standing where it will
    // stand when it is. A row that mounts late is a row that pushed the rest
    // of the card down while somebody was reading it.
    expect(section.dataset.cellContentRevealCount).toBe('0');
    expect(section.style.display).toBe('block');
    const dark = stageRows(container);
    expect(dark.length).toBeGreaterThan(4);
    for (const row of dark) {
      expect(row.style.display).not.toBe('none');
      expect(row.style.opacity).toBe('0.18');
      expect(row.style.pointerEvents).toBe('none');
      expect(row.getAttribute('aria-hidden')).toBe('true');
    }
    const geometryWhileDark = displays(container);

    rerender(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
      />,
    );
    expect(section.dataset.cellContentRevealState).toBe('resolved');
    for (const row of stageRows(container)) {
      expect(row.style.opacity).toBe('1');
      expect(row.style.pointerEvents).toBe('auto');
      expect(row.getAttribute('aria-hidden')).toBeNull();
    }
    // Same elements, same display values: the reveal changed ink only.
    expect(displays(container)).toEqual(geometryWhileDark);
  });

  it('walks the stages one at a time without moving the ones behind it', () => {
    const frames = [0, 0.25, 0.5, 0.75, 1].map((reveal) => {
      cleanup();
      const { container } = render(
        <CellContentMemory
          dataHex={DATA_HEX}
          source={source}
          phase="ready"
          record={record()}
          reveal={reveal}
        />,
      );
      const section = container.querySelector(
        '[data-cell-content-memory]',
      ) as HTMLElement;
      return {
        count: Number(section.dataset.cellContentRevealCount),
        displays: displays(container),
        lit: stageRows(container)
          .filter((row) => row.style.opacity === '1').length,
      };
    });

    // The walk really does advance…
    expect(frames.map((frame) => frame.count)).toEqual([0, 2, 3, 5, 7]);
    expect(frames[4].lit).toBeGreaterThan(frames[0].lit);
    // …and never once by laying anything out differently.
    for (const frame of frames) {
      expect(frame.displays).toEqual(frames[0].displays);
      expect(frame.displays).not.toContain('none');
    }
  });

  it('hands over the segment stepper only once the decode is read', () => {
    const { container, rerender } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={0}
      />,
    );
    const next = () => container.querySelector(
      '[aria-label="next decoded segment"]',
    ) as HTMLButtonElement;

    expect(next().disabled).toBe(true);
    fireEvent.click(next());
    expect(container.textContent).toContain('OBJECT START');
    expect(container.textContent).not.toContain('DOCUMENT BODY');

    rerender(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
      />,
    );
    expect(next().disabled).toBe(false);
    fireEvent.click(next());
    expect(container.textContent).toContain('DOCUMENT BODY');
  });

  // An empty output renders NOTHING here. The window's job is to say what the
  // bytes are; with no bytes, the DATA fact above it in the dossier already
  // reads `Empty`, and a `CONTENT · EMPTY  0 B` line under it was the same
  // absence stated a second and third time. Nothing to reveal means nothing
  // to restack either, at either end of the walk.
  it('renders no window at all for a validly empty output', () => {
    const { container, rerender } = render(
      <CellContentMemory dataHex="0x" reveal={0} />,
    );
    expect(container.querySelector('[data-cell-content-memory]')).toBeNull();
    expect(container.textContent).toBe('');

    rerender(<CellContentMemory dataHex="0x" reveal={1} />);
    expect(container.querySelector('[data-cell-content-memory]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('holds the analysis rows\' height while the record is still on its way', () => {
    const { container, rerender } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={{ ...source, status: 'syncing' }}
        phase="loading"
        pending
        reveal={1}
      />,
    );
    const zone = () => container.querySelector(
      '[data-cell-content-analysis]',
    ) as HTMLElement;

    // Pending, the zone shows one status line and holds the rest of the room
    // VALUE / DECODE / segment / heuristic / role will need.
    expect(zone().dataset.cellContentAnalysisReserved).toBe('true');
    expect(zone().style.minHeight)
      .toBe(`${CELL_CONTENT_ANALYSIS_RESERVED_PX}px`);
    expect(container.textContent)
      .toContain('RESOLVING INDEXED CONTENT ANALYSIS');

    // It lands: the rows take the room that was held for them, and the
    // reservation drops ONCE rather than stacking under them.
    rerender(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
      />,
    );
    expect(zone().dataset.cellContentAnalysisReserved).toBeUndefined();
    expect(zone().style.minHeight).toBe('');
    expect(container.querySelector('[data-cell-content-asset]')).not.toBeNull();
    expect(container.querySelector('[data-cell-content-segment="0"]'))
      .not.toBeNull();
  });

  it('reserves nothing once the answer is in, however it came out', () => {
    // Resolved absent is an answer: nothing more is expected, so nothing is
    // held. Same for a record that arrived — pending is the parent's verdict,
    // and a record beside it means the verdict is stale.
    const { container, rerender } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="unavailable"
        pending={false}
        reveal={1}
      />,
    );
    const zone = () => container.querySelector(
      '[data-cell-content-analysis]',
    ) as HTMLElement;
    expect(zone().style.minHeight).toBe('');

    rerender(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        pending
        reveal={1}
      />,
    );
    expect(zone().style.minHeight).toBe('');
  });

  it('shows a bare direct-node window whole the moment the reveal completes', () => {
    const { container } = render(
      <CellContentMemory dataHex="0xdeadbeefcafe1234567890" reveal={1} />,
    );
    for (const row of stageRows(container)) {
      expect(row.style.opacity).toBe('1');
    }
    expect(container.textContent).toContain('DIRECT NODE · RAW');
    // No index, no analysis block at all — absence is structural, not staged.
    expect(container.querySelector('[data-cell-content-analysis]')).toBeNull();
  });
});
