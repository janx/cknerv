import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
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
          onSegmentFocus={() => {}}
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

    // The walk really does advance, over the five stages this record brings —
    // VALUE, DECODE, the segment rows, one heuristic, one role — at
    // `floor(progress × 5 + 0.45)`.
    expect(frames.map((frame) => frame.count)).toEqual([0, 1, 2, 4, 5]);
    expect(frames[4].lit).toBeGreaterThan(frames[0].lit);
    // …and never once by laying anything out differently.
    for (const frame of frames) {
      expect(frame.displays).toEqual(frames[0].displays);
      expect(frame.displays).not.toContain('none');
    }
  });

  it('hands over the segment rows only once the decode is read', () => {
    const onSegmentFocus = vi.fn();
    const { container, rerender } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={0}
        onSegmentFocus={onSegmentFocus}
      />,
    );
    const row = (index: number) => container.querySelector(
      `[data-cell-content-segment="${index}"]`,
    ) as HTMLButtonElement;

    // Both segments are on screen from the first frame — the stepper that
    // showed one at a time is gone — and both are readable-but-inert until the
    // walk reaches the stage that names them.
    expect(container.textContent).toContain('OBJECT START');
    expect(container.textContent).toContain('DOCUMENT BODY');
    expect(row(0).disabled).toBe(true);
    expect(row(1).disabled).toBe(true);
    expect(row(1).style.pointerEvents).toBe('none');
    expect(row(1).style.opacity).toBe('0.4');
    fireEvent.click(row(1));
    expect(onSegmentFocus).not.toHaveBeenCalled();

    rerender(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
        onSegmentFocus={onSegmentFocus}
      />,
    );
    expect(row(1).disabled).toBe(false);
    expect(row(1).style.opacity).toBe('1');
    fireEvent.click(row(1));
    // The row does not select anything here — it POINTS, at bytes on another
    // surface — so what it hands over is the index and nothing else.
    expect(onSegmentFocus).toHaveBeenCalledWith(1);
  });

  it('presses the row the card says the reader is standing on', () => {
    const { container, rerender } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
        focusedSegment={1}
        onSegmentFocus={() => {}}
      />,
    );
    const row = (index: number) => container.querySelector(
      `[data-cell-content-segment="${index}"]`,
    ) as HTMLButtonElement;

    expect(row(0).getAttribute('aria-pressed')).toBe('false');
    expect(row(1).getAttribute('aria-pressed')).toBe('true');
    expect(row(1).getAttribute('data-cell-content-segment-range')).toBe('1:7');

    // A byte click down in the reader takes the focus away, and the row
    // unpresses — the window never remembered a press of its own.
    rerender(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
        focusedSegment={null}
        onSegmentFocus={() => {}}
      />,
    );
    expect(row(1).getAttribute('aria-pressed')).toBe('false');
  });

  it('prints no byte of the payload anywhere', () => {
    // The user's direction of 2026-09-05: 「cell detail 中原有的 cell data hex
    // reading 可以去掉，避免 UX 冗余」. CKBYTES under the CELL SCAN square draws
    // every byte with an offset and its ASCII; thirty-two of them drawn again
    // up here, with neither, were the redundancy.
    const { container } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
      />,
    );
    expect(container.querySelector('[data-cell-content-raw]')).toBeNull();
    expect(container.querySelector('[data-cell-content-bytes]')).toBeNull();
    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(0);
    expect(container.querySelector('[data-cell-content-ascii]')).toBeNull();
    expect(container.querySelector('[data-cell-content-read-all]')).toBeNull();
    expect(container.textContent).not.toContain('ASCII');
    expect(container.textContent).not.toContain('READ ALL');
    expect(container.textContent).not.toContain('OBSERVED');
    expect(container.textContent).not.toContain('INDEX ANALYSIS');
    // …and what a segment row says instead: where the bytes are, how many, and
    // what they decoded to.
    expect(container.querySelector('[data-cell-content-segment="1"]')?.textContent)
      .toBe('DOCUMENT BODY[1..7) · 6 B"a":1}');
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
    // VALUE / DECODE / seven segment rows / heuristic / role will need.
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

  it('renders nothing at all for a Cell nobody indexed', () => {
    // ⭐ NO INDEX, NO WINDOW (2026-09-05). This used to open a `DIRECT NODE ·
    // RAW` hex view — CKBYTES' own ancestor — for the ~98% of Cells no index
    // has answered for. The reader under the CELL SCAN square draws all of
    // those bytes now, with offsets and ASCII and the whole payload behind
    // them, so what was left up here was a heading over nothing.
    const { container } = render(
      <CellContentMemory dataHex="0xdeadbeefcafe1234567890" reveal={1} />,
    );
    expect(container.querySelector('[data-cell-content-memory]')).toBeNull();
    expect(container.textContent).toBe('');
    expect(container.textContent).not.toContain('DIRECT NODE');
  });
});

// ——— The rows, and where they send the reader ——————————————————————————————
//
// The window used to page: `‹ W 1/2 ›`, thirty-two bytes at a time, through the
// bytes the browser happened to be holding — then a fixed preview with a
// `READ ALL` door beside it. Both are gone. CKBYTES stands under the CELL SCAN
// square for every Cell that holds a byte, so there is nothing to open and
// nothing to preview; what this window has instead is the table of contents,
// one row per decoded segment, and a press moves the reader.

describe('CellContentMemory segment rows', () => {
  /** 64 bytes, so the second segment begins well past anything a preview
   *  would ever have shown — which is no longer a distinction the window
   *  makes, and that is what this fixture is here to pin. */
  const FAR_DATA_HEX = `0x7b2261223a317d${'00'.repeat(57)}`;

  function farRecord(): CellSemanticRecord {
    const base = record();
    return {
      ...base,
      content: {
        ...base.content!,
        data_hex: FAR_DATA_HEX,
        total_bytes: 64,
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
              start_byte: 40,
              end_byte: 64,
              label: 'extension_payload',
              value: '0x00…',
              meaning: 'xUDT extension data',
            },
          ],
        },
      },
    } as CellSemanticRecord;
  }

  it('lists every segment, however far into the payload it starts', () => {
    const onSegmentFocus = vi.fn();
    const { container } = render(
      <CellContentMemory
        dataHex={FAR_DATA_HEX}
        source={source}
        phase="ready"
        record={farRecord()}
        reveal={1}
        onSegmentFocus={onSegmentFocus}
      />,
    );

    const rows = container.querySelectorAll('[data-cell-content-segment]');
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('OBJECT START');
    expect(container.textContent).toContain('EXTENSION PAYLOAD');
    // A segment starting at byte 40 was once "outside the preview" and had to
    // be handed over with an apology. There is no preview and no apology: the
    // row states its range, and the reader below has all 64 bytes.
    expect(container.textContent).not.toContain('DECODE RANGE OUTSIDE THE PREVIEW');
    expect(rows[1].getAttribute('data-cell-content-segment-range')).toBe('40:64');

    fireEvent.click(rows[1]);
    expect(onSegmentFocus).toHaveBeenCalledWith(1);
  });

  it('lists the segments for a window nobody wired a reader to', () => {
    // The tuning lab and a bare-window test render this component with no
    // reader behind it. The rows are the READING and stay; only the press has
    // nowhere to go, and a press with nowhere to go is a no-op rather than a
    // throw.
    const { container } = render(
      <CellContentMemory
        dataHex={DATA_HEX}
        source={source}
        phase="ready"
        record={record()}
        reveal={1}
      />,
    );
    const row = container.querySelector(
      '[data-cell-content-segment="0"]',
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(() => fireEvent.click(row)).not.toThrow();
  });
});
