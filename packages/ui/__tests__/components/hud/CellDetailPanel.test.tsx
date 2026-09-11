import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { clearCellDataMemo } from '@cknerv/cache';
import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type {
  Cell,
  CellLink,
  CellSemanticRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import type { ConsensusMemoryTraceReadout } from '../../../src/nerve/consensusMemoryTrace';
import type {
  CellIdentityBindingPhase,
  CellIdentityProofBinding,
} from '../../../src/derives/cellIdentityProof.derive';
import { PROBE_STEP_S } from '../../../src/components/hud/probeScan';
import {
  CELL_CONTENT_ANALYSIS_RESERVED_PX,
  READING_DECODE_LINE_PX,
  READING_SEGMENT_ROW_PX,
  READING_SLOT_CHROME_PX,
} from '../../../src/components/hud/CellContentMemory';

const { portraitRender, portraitSemanticRecord } = vi.hoisted(() => ({
  portraitRender: vi.fn(),
  portraitSemanticRecord: vi.fn(),
}));

vi.mock('../../../src/components/hud/CellNucleusPortrait', async () => {
  const { memo } = await import('react');
  return {
    default: memo(({ focusField, onIdentityProofRead, semanticRecord }: {
      focusField?: string | null;
      onIdentityProofRead?: (kind: 'content') => void;
      semanticRecord?: CellSemanticRecord | null;
    }) => {
      portraitRender();
      portraitSemanticRecord(semanticRecord ?? null);
      return (
        <div data-testid="cell-nucleus-portrait" data-focus-field={focusField ?? ''}>
          <button
            type="button"
            data-testid="portrait-content-proof"
            onClick={() => onIdentityProofRead?.('content')}
          />
        </div>
      );
    }),
  };
});

import CellDetailPanel, {
  cellScanFactAccent,
  type CellInspectionFacet,
} from '../../../src/components/hud/CellDetailPanel';
import {
  READER_CHROME_PX,
  READER_ROW_HEIGHT_PX,
} from '../../../src/components/hud/CellDataReader';
import { READER_VISIBLE_ROWS } from '../../../src/derives/cellDataReader.derive';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL_SOURCE = readFileSync(resolve(
  process.cwd(),
  'src/components/hud/CellDetailPanel.tsx',
), 'utf8');
import { measureHudOcclusionRectsForTest } from '../../../src/components/hudOcclusion';
import { PLATE_ROW_RAIL_ALPHA } from '../../../src/components/hud/primitives';
import {
  formatBlockRef,
  formatOutpoint,
  formatSemanticAssetAmount,
  formatTxHash,
  midTruncate,
} from '../../../src/components/hud/cellFormat';
import { INSPECTOR_EDGE_PX } from '../../../src/components/sceneInspection';
import {
  HUD_COLORS,
  HUD_MOTION,
  HUD_TYPE,
  viewportMinusSafeArea,
} from '../../../src/components/hud/hudTheme';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // jsdom's own window, restored: a test that resizes it to check the card's
  // clamp would otherwise hand the next one a viewport it never asked for.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  // …and its HUD with it: the card's measure is decided by the hole the rails
  // leave, so a rail left behind by one test is a stage the next never set.
  document.querySelectorAll('[data-hud-occlusion]').forEach((el) => el.remove());
});

/**
 * Put a HUD on the stage: two rails leaving `holeWidth` px of clear stage
 * between them, and a window for them to stand in.
 *
 * jsdom lays nothing out, so each rail is told what box it has. The card reads
 * the HOLE — `hudHoleFromRects`, the same reading the placement solver and the
 * camera compose into — and not `window.innerWidth`, so a test about the
 * card's measure installs a HUD rather than a window size.
 */
function stageWithHole(
  holeWidth: number,
  viewportWidth = 1920,
  viewportHeight = 1080,
): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewportHeight });
  document.querySelectorAll('[data-hud-occlusion]').forEach((el) => el.remove());
  const railWidth = (viewportWidth - holeWidth) / 2;
  const rail = (left: number, right: number) => {
    const box = { left, top: 48, right, bottom: viewportHeight * 0.6 };
    const element = document.createElement('div');
    element.setAttribute('data-hud-occlusion', 'true');
    element.getBoundingClientRect = () => ({
      ...box,
      width: box.right - box.left,
      height: box.bottom - box.top,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect;
    document.body.appendChild(element);
  };
  rail(0, railWidth);
  rail(viewportWidth - railWidth, viewportWidth);
}

const base: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0xdeadbeefcafe1234567890',
  data_bytes: 11,
  content_hash: '0x' + '11'.repeat(32), lock_kind: 'omnilock', asset_kind: 'xudt',
  lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
  // Canonical script identity: which script guards the Cell arrives from the
  // node itself, so the LOCK cluster has a real row with no index at all.
  lock_script: { code_hash: `0x${'7c'.repeat(32)}`, hash_type: 'type' },
};

/** A Cell that carries a type script — the ASSET cluster's canonical CODE
 *  row exists only for these; a plain transfer says so by having none. */
const typed: Cell = {
  ...base,
  type_shape_seed: [5, 6],
  type_script: { code_hash: `0x${'5d'.repeat(32)}`, hash_type: 'data1' },
};

function identityBinding(
  phase: CellIdentityBindingPhase = 'verified',
): CellIdentityProofBinding {
  return {
    cellId: base.id,
    resolvedKinds: ['address', 'content', 'anchor'],
    phase,
    revision: 3,
    changedAtMs: 100,
    lastResolvedKind: 'anchor',
    reducedMotion: true,
  };
}

function traceReadout(
  overrides: Partial<ConsensusMemoryTraceReadout> = {},
): ConsensusMemoryTraceReadout {
  const value = {
    key: `18:${base.id}:1`,
    targetCellId: base.id,
    sourceKind: 'input' as const,
    stage: 'reading' as const,
    sourceCount: 2,
    consumedInputs: [],
    arrivedSourceCount: 0,
    resolvedSourceCount: 0,
    ...overrides,
  };
  return {
    ...value,
    evidence: overrides.evidence ?? Array.from(
      { length: value.sourceCount },
      (_, index) => ({
        sourceId: index + 11,
        ordinal: index + 1,
        contentHash: `0x${String(index + 1).repeat(64)}`,
        state: index < value.resolvedSourceCount
          ? 'resolved' as const
          : index < value.arrivedSourceCount
            ? 'arrived' as const
            : 'routing' as const,
        sourceOutPoint: {
          tx_hash: `0x${String(index + 1).repeat(64)}`,
          index,
        },
        sourceBirthBlock: 100 + index,
        route: [index + 11, 99, base.id],
        hopCount: 2,
        routeDurationMs: 520 + index * 80,
      }),
    ),
  };
}

/** Walk the probe past its last landmark. Everything the reveal stages is
 *  mounted from the first frame and merely ghosted, so a stepper inside an
 *  unreached stage is deliberately inert — a test that wants to drive one has
 *  to let the scan finish first, exactly as a viewer does. */
function settleScan(performanceNow: { mockReturnValue: (value: number) => void }) {
  // One step past the deepest enrichment gate (order + 2), which classifies
  // the lattice and lights every staged row.
  performanceNow.mockReturnValue(PROBE_STEP_S * 9 * 1000);
  act(() => { vi.advanceTimersByTime(80); });
}

describe('CellDetailPanel', () => {
  beforeEach(() => {
    portraitRender.mockClear();
    portraitSemanticRecord.mockClear();
    // An outpoint's bytes never change, so the reader's session memo never
    // invalidates — which would let one test's fetched payload answer the
    // next test's reader synchronously, out of the phase it opened in.
    clearCellDataMemo();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(3 * 3600_000 + 12 * 60_000));
  });

  it('keeps the demand-rendered portrait stable while the DOM scan clock advances', () => {
    render(<CellDetailPanel cell={base} onClose={() => {}} />);

    const rendersAfterScanReset = portraitRender.mock.calls.length;
    expect(rendersAfterScanReset).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(portraitRender).toHaveBeenCalledTimes(rendersAfterScanReset);
  });

  it('shows a real elapsed AGE when the birth timestamp is known', () => {
    const { container } = render(
      <CellDetailPanel cell={{ ...base, born_at_ms: 12 * 60_000 }} onClose={() => {}} />,
    );
    // The AGE reading itself moved onto the chip under the reticle
    // (2026-09-10) — it names the specimen, not the register — and the
    // overlay's own suite mounts the layer that carries it. What stays here is
    // the register's own statement of WHEN.
    expect(container.textContent).not.toContain('SINCE #');
    // Age is the header's business; the register states the date itself, in
    // UTC, so two viewers in two time zones read the same instant. The block
    // is NOT repeated here — the COMMIT fact one row up already states it.
    const born = container.querySelector(
      '[data-cell-evidence-row="born"]',
    ) as HTMLElement;
    expect(born.textContent).toBe('BORN1970-01-01 00:12 UTC');
    expect(born.style.gridColumn).toBe('1 / -1');
  });


  it('re-homes the six facts as cluster leads in the register and bytes zones', () => {
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const register = container.querySelector('[data-cell-analysis-register="true"]') as HTMLElement;
    const bytesZone = container.querySelector('[data-cell-analysis-bytes="true"]') as HTMLElement;
    expect(register.contains(container.querySelector('[data-cell-detail-field="lock"]'))).toBe(true);
    expect(register.contains(container.querySelector('[data-cell-detail-field="asset"]'))).toBe(true);
    expect(register.contains(container.querySelector('[data-cell-detail-field="state"]'))).toBe(true);
    expect(register.contains(container.querySelector('[data-cell-detail-field="born"]'))).toBe(true);
    expect(bytesZone.contains(container.querySelector('[data-cell-detail-field="capacity"]'))).toBe(true);
    expect(bytesZone.contains(container.querySelector('[data-cell-detail-field="data"]'))).toBe(true);
    // LOCK and ASSET lead their clusters; STATE·COMMIT share a compact row.
    expect(container.querySelector('[data-cell-cluster="lock"] [data-cell-detail-field="lock"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-cluster="type"] [data-cell-detail-field="asset"]')).not.toBeNull();
    const consensusRow = container.querySelector('[data-cell-cluster="consensus"]') as HTMLElement;
    expect(consensusRow.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(consensusRow.querySelector('[data-cell-detail-field="state"]')).not.toBeNull();
    expect(consensusRow.querySelector('[data-cell-detail-field="born"]')).not.toBeNull();
  });

  it('lets every fact answer in the colour its tether takes', () => {
    // COMMIT was the one that did not. Its rail and its label fell through
    // `CellScanFact`'s own cyan default while the scene tether went chrome
    // orange for the same selection, so "the selected fact's colour wins"
    // pointed two ways for the one facet whose colour is a declared house
    // exception. One table answers both now, and this asks the rendered button
    // whether it is reading from it — a local default here is invisible from
    // the tether's side, which is how the split survived.
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const rgb = (hex: string): string => {
      const h = hex.replace('#', '');
      return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
    };
    const facets: readonly CellInspectionFacet[] = [
      'lock', 'asset', 'state', 'born', 'capacity', 'data',
    ];

    const painted = facets.map((field) => {
      const button = container.querySelector(
        `[data-cell-detail-field="${field}"]`,
      ) as HTMLElement;
      return `${field} ${button.style.color}`;
    });

    expect(painted).toEqual(facets.map(
      (field) => `${field} ${rgb(cellScanFactAccent(base, field))}`,
    ));
    // The exception, spelled out where a reader will meet it: an anchor is a
    // house fact, so COMMIT answers in the instrument's own orange.
    expect(cellScanFactAccent(base, 'born')).toBe(HUD_COLORS.orange);
  });

  it('lights the facts top-down through the merged layout, capacity no longer first', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );
    const factState = (field: string) => container.querySelector(
      `[data-cell-detail-field="${field}"]`,
    )?.getAttribute('data-cell-detail-field-state');

    // One landmark in: the LOCK lead lights first; CAPACITY (now deep in the
    // bytes zone) stays dark even though it heads CONSENSUS_BRAID_FIELDS.
    performanceNow.mockReturnValue(PROBE_STEP_S * 0.6 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(factState('lock')).toBe('resolved');
    expect(factState('asset')).toBe('scanning');
    expect(factState('capacity')).toBe('scanning');
    expect(container.querySelector<HTMLElement>('[data-cell-identity-scan-status="true"]')
      ?.dataset.cellScanLattice).toBe('1/6');
    // While the walk runs it says so, in instrument grey, not chain green.
    expect(container.textContent).toContain('SCANNING');

    // Five landmarks in: everything except the DATA fact at the bottom.
    performanceNow.mockReturnValue(PROBE_STEP_S * 4.6 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(factState('state')).toBe('resolved');
    expect(factState('born')).toBe('resolved');
    expect(factState('capacity')).toBe('resolved');
    expect(factState('data')).toBe('scanning');
    expect(container.querySelector<HTMLElement>('[data-cell-identity-scan-status="true"]')
      ?.dataset.cellScanLattice).toBe('5/6');
    performanceNow.mockRestore();
  });

  it('turns base taxonomy into useful Cell facts without visual parameters', () => {
    const native = {
      ...base,
      asset_kind: 'native' as const,
      lock_kind: 'sighash' as const,
      data_hex: '0x',
      data_bytes: 0,
    };
    const { container } = render(
      <CellDetailPanel cell={native} onClose={() => {}} />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('Native CKB');
    expect(text).toContain('Default Lock');
    expect(text).toContain('Empty');
    // A validly-empty output collapses to NOTHING: the DATA fact right above
    // the window already reads `Empty`, so the window's own one-liner was the
    // third statement of the same absence inside four lines.
    expect(text).not.toContain('CONTENT · EMPTY');
    expect(text).not.toContain('NO OUTPUT DATA');
    expect(text).not.toContain('NO DETERMINISTIC DECODE');
    expect(container.querySelector('[data-cell-content-memory]')).toBeNull();
    expect(container.querySelector('[data-cell-content-bytes="true"]')).toBeNull();
    expect(text).not.toMatch(/ƒ\d|\d+ paths|\d+ knots|\d\.\d{2}×/);
  });

  it('names a script the index knows and cknerv does not, instead of calling it custom', () => {
    // A JoyID cell: cknerv's own table cannot place either script, so on the
    // base path both rows would read UNLISTED. The index names both, and the
    // LOCK fact must agree with the index's own record rather than telling
    // the viewer two different things about one cell.
    const unplaceable = { ...base, lock_kind: 'other' as const, asset_kind: 'other' as const };
    const script = (name: string, codeHash: string) => ({
      script_hash: `0x${'cd'.repeat(32)}`,
      code_hash: codeHash,
      hash_type: 'type',
      args: '0x1234',
      name,
      family: 'lock',
      deprecated: false,
    });
    const { container, rerender } = render(
      <CellDetailPanel cell={unplaceable} onClose={() => {}} />,
    );
    expect(container.textContent).toContain('UNLISTED');
    expect(container.textContent).not.toContain('Custom lock');

    rerender(
      <CellDetailPanel
        cell={unplaceable}
        onClose={() => {}}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
          lag_blocks: 1,
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: unplaceable.out_point,
          source: 'ckbadger',
          as_of: { block: unplaceable.birth_block, hash: '0xanchor' },
          observed_at_block: unplaceable.birth_block,
          updated_at_ms: 1,
          lock_script: script('JoyID', `0x${'7f'.repeat(32)}`),
          type_script: script('.bit Income Cell', `0x${'3a'.repeat(32)}`),
          facets: [],
        }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('JoyID');
    expect(text).toContain('.bit Income Cell');
    expect(text).not.toContain('UNLISTED');
    // The evidence rows never repeat the fact button's headline name.
    expect(container.querySelector('[data-cell-cluster-evidence="lock"]')
      ?.textContent).not.toContain('JoyID');
  });

  it('threads only anchor- and seed-validated semantics into portrait geometry', () => {
    const anchor = { block: base.birth_block, hash: `0x${'ee'.repeat(32)}` };
    const source: EnrichmentSourceStatus = {
      source: 'ckbadger',
      status: 'ready',
      capabilities: ['cell_detail'],
      validated_anchor: anchor,
    };
    const record: CellSemanticRecord = {
      out_point: base.out_point,
      source: 'ckbadger',
      as_of: anchor,
      observed_at_block: base.birth_block,
      updated_at_ms: 1,
      lock_script: {
        script_hash: `0x0000000100000002${'00'.repeat(24)}`,
        code_hash: `0x${'77'.repeat(32)}`,
        hash_type: 'type',
        args: '0x',
        name: 'Verified lock',
      },
      facets: [],
    };
    const { container, rerender } = render(
      <CellDetailPanel
        cell={base}
        semanticSource={source}
        semanticPhase="ready"
        semanticRecord={record}
        onClose={() => {}}
      />,
    );
    expect(portraitSemanticRecord).toHaveBeenLastCalledWith(record);

    rerender(
      <CellDetailPanel
        cell={base}
        semanticSource={{ ...source, status: 'stale' }}
        semanticPhase="ready"
        semanticRecord={record}
        onClose={() => {}}
      />,
    );
    expect(portraitSemanticRecord).toHaveBeenLastCalledWith(null);

    const mismatched = {
      ...record,
      lock_script: {
        ...record.lock_script!,
        script_hash: `0xaaaaaaaa00000002${'00'.repeat(24)}`,
      },
    };
    rerender(
      <CellDetailPanel
        cell={base}
        semanticSource={source}
        semanticPhase="ready"
        semanticRecord={mismatched}
        onClose={() => {}}
      />,
    );
    expect(portraitSemanticRecord).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('[data-cell-semantics-phase="error"]')).not.toBeNull();
  });





  it('states the reader\'s room without a plate to borrow it from', () => {
    // The dump's room used to be the analysis plate's own remainder — the
    // height the register left over after the specimen square and the reading
    // — which was exactly the shared height the instruments came apart to be
    // rid of. It is the module's own documented default now, and it is
    // self-limiting on the shortest band this runs on: 24 rows is 324 px of
    // dump, and that plus this instrument's chrome is inside the 570 px an
    // 11" iPad in landscape Safari leaves.
    expect(READER_VISIBLE_ROWS * READER_ROW_HEIGHT_PX
      + READER_CHROME_PX + CELL_CONTENT_ANALYSIS_RESERVED_PX)
      .toBeLessThanOrEqual(570);
    expect(PANEL_SOURCE).toContain('const readerRows = READER_VISIBLE_ROWS;');
    expect(PANEL_SOURCE).not.toContain('readerRowsUnderScan(');
  });

  it('sends the reader to the segment a DATA row was pressed on, and back', () => {
    // The whole link between the two surfaces: the cluster lists the segments,
    // a press points the reader at one, and a byte click down there takes the
    // point away.
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    // A kilobyte, which is 64 rows against the 24 the unmeasured plate mounts:
    // enough that a segment deep in the payload is genuinely off screen and the
    // hand-off has to scroll to reach it.
    const data = `0x7b2261223a317d${'00'.repeat(1017)}`;
    const { container } = render(
      <CellDetailPanel
        cell={{ ...base, data_hex: data, data_bytes: 1024 }}
        onClose={() => {}}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
          lag_blocks: 0,
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
          updated_at_ms: 1,
          content: {
            data_hex: data,
            total_bytes: 1024,
            data_complete: true,
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
                  start_byte: 320,
                  end_byte: 336,
                  label: 'extension_payload',
                  value: '0x00…',
                  meaning: 'xUDT extension data',
                },
              ],
            },
            heuristics: [],
          },
          facets: [],
        } as unknown as CellSemanticRecord}
      />,
    );
    settleScan(performanceNow);

    const reader = () => container.querySelector(
      '[data-cell-data-reader]',
    ) as HTMLElement;
    const row = (index: number) => container.querySelector(
      `[data-cell-content-segment="${index}"]`,
    ) as HTMLButtonElement;
    expect(reader().dataset.cellDataReaderSelection).toBeUndefined();

    expect(reader().dataset.cellDataReaderFirstRow).toBe('0');
    fireEvent.click(row(1));
    // The reader takes the range and scrolls the segment's first row to the
    // top: byte 320 is row 20, and the virtualiser mounts from eight rows of
    // overscan above it.
    expect(reader().dataset.cellDataReaderSelection).toBe('320:336');
    expect(reader().dataset.cellDataReaderFirstRow).toBe('12');
    expect(row(1).getAttribute('aria-pressed')).toBe('true');

    // A byte click in the dump is the reader's own gesture and outranks the
    // row's: whatever was pressed up there is no longer what is pointed at.
    fireEvent.click(container.querySelector(
      '[data-cell-data-reader-byte="321"]',
    ) as HTMLElement);
    expect(row(1).getAttribute('aria-pressed')).toBe('false');
    expect(reader().dataset.cellDataReaderSelection).toBe('321:322');
    performanceNow.mockRestore();
  });

  it('keeps scan and memory in one merged analysis window', () => {
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[data-cellular-scan-state]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-module="ckbytes"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-module="anatomy"]')).toBeNull();
    expect(container.querySelector('[data-cell-detail-module="lineage"]')).toBeNull();
    expect(container.querySelector('[data-cell-detail-module="context"]')).toBeNull();
  });


  it('clusters indexed semantics by subject under their fact leads', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const indexedData = `0x7b2261223a317d${'00'.repeat(33)}`;
    const { container } = render(
      <CellDetailPanel
        cell={base}
        onClose={() => {}}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
          lag_blocks: 1,
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
          updated_at_ms: 1,
          address: 'ckt1qyqindexedaddress0000000000',
          cell_type: 'dao',
          lock_script: {
            script_hash: '0xlock',
            code_hash: '0xcode',
            hash_type: 'type',
            args: '0x1234',
            name: 'Default Lock',
            family: 'lock',
            deprecated: false,
          },
          type_script: {
            script_hash: '0xtype',
            code_hash: '0xdaocode',
            hash_type: 'data1',
            args: '0xabcd',
            name: 'Legacy DAO Script',
            family: 'dao',
            deprecated: true,
          },
          asset: {
            type_script_hash: `0x${'22'.repeat(32)}`,
            standard: 'xUDT',
            name: 'Nervos Test Token',
            symbol: 'NTT',
            amount: '12345000000',
            decimals: 8,
          },
          common_knowledge: {
            total_bytes: 133,
            capacity_field_bytes: 8,
            lock_script_bytes: 52,
            type_script_bytes: 33,
            data_bytes: 40,
          },
          content: {
            total_bytes: 40,
            data_hex: indexedData,
            data_complete: true,
            deterministic: {
              kind: 'json_document',
              summary: 'UTF-8 JSON object decoded from Cell data',
              segments: [
                {
                  label: 'object_start',
                  start_byte: 0,
                  end_byte: 1,
                  meaning: 'JSON object opening delimiter',
                  value: '{',
                },
                {
                  label: 'document_body',
                  start_byte: 1,
                  end_byte: 7,
                  meaning: 'UTF-8 JSON object body',
                  value: '"a":1}',
                },
                {
                  label: 'extension_payload',
                  start_byte: 28,
                  end_byte: 40,
                  meaning: 'Trailing protocol extension bytes',
                  value: '12 zero bytes',
                },
              ],
            },
            heuristics: [
              {
                kind: 'text_encoding',
                confidence: 'high',
                reason: 'Payload is valid printable UTF-8',
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
              // Wire order on purpose: the timestamps were APPENDED after the
              // keys this facet shipped with, so anything reading attributes
              // by position prints a millisecond count under COMPENSATION.
              attributes: [
                { key: 'deposit_block', value: '16204800', unit: 'block' },
                { key: 'compensation', value: '1.25', unit: 'CKB' },
                { key: 'estimated_apc', value: '2.01%' },
                { key: 'withdraw_request_block', value: '16210000', unit: 'block' },
                { key: 'deposit_at_ms', value: '1755238020000', unit: 'ms' },
                { key: 'withdraw_request_at_ms', value: '1755324420000', unit: 'ms' },
              ],
            },
            {
              namespace: 'ckb',
              kind: 'dep_group',
              attributes: [
                { key: 'members', value: '2' },
                { key: 'member_0', value: '0xdep0:0' },
                { key: 'member_1', value: '0xdep1:1' },
              ],
            },
            {
              namespace: 'ckb',
              kind: 'code_cell',
              state: 'Type ID',
              attributes: [
                { key: 'code_hash', value: '0xlinkedcode' },
                { key: 'hash_type', value: 'type' },
              ],
            },
          ],
        }}
        semanticTransactionPhase="ready"
        semanticTransactionRecord={{
          tx_hash: base.out_point.tx_hash,
          block: base.birth_block,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          updated_at_ms: 1,
          actions: [
            {
              namespace: 'ckb',
              kind: 'transaction_io',
              state: 'committed',
              attributes: [
                { key: 'inputs', value: '2' },
                { key: 'outputs', value: '3' },
              ],
            },
          ],
          participants: [],
          fee: '1000',
          cycles: 12345,
        }}
      />,
    );

    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(3);
    // Enrichment adds evidence, never geometry: the same three instruments the
    // eleven bytes already earned, each at its own measure, each a rectangle.
    expect(Array.from(
      container.querySelectorAll('[data-cell-constellation-panel]'),
      (host) => host.getAttribute('data-cell-constellation-panel'),
    )).toEqual(['analysis', 'specimen', 'reader']);
    expect(analysis.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    // The house's 12 px cut corner belongs to the INSTRUMENT around the
    // register now, which is the one plate every panel of this dialect wears.
    expect((analysis.closest('[data-cell-constellation-panel]') as HTMLElement)
      .style.clipPath)
      .toBe('polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)');

    // LOCK cluster: fact lead, then full-width rows in the house grammar —
    // the Cell's own CODE first, then what the index adds. The evidence never
    // repeats the fact button's headline name.
    const lockCluster = container.querySelector('[data-cell-cluster="lock"]') as HTMLElement;
    expect(lockCluster.querySelector('[data-cell-detail-field="lock"]')?.textContent)
      .toContain('Default Lock');
    const lockEvidence = lockCluster.querySelector('[data-cell-cluster-evidence="lock"]') as HTMLElement;
    expect(Array.from(lockEvidence.querySelectorAll('[data-cell-evidence-row]'))
      .map((row) => row.getAttribute('data-cell-evidence-row')))
      .toEqual(['lock-code', 'owner', 'lock-script', 'lock-args']);
    expect(lockEvidence.querySelector('[data-cell-evidence-row="lock-code"]')
      ?.textContent).toBe('CODE0x7c7c7c7c7c…c7c7c7c7c · TYPE');
    // ⭐ NO `ACTIVE` CHIP. A chip marks the exception; a chip on both CODE rows
    // of nearly every card marks nothing. The ordinary condition is stated by
    // not being stated — and when it IS the exception, the chip is ON the row
    // it qualifies and never a stamp floating at the far right of the plate.
    expect(lockEvidence.querySelector('[data-cell-script-state]')).toBeNull();
    const owner = lockEvidence.querySelector('[data-cell-evidence-row="owner"]') as HTMLElement;
    expect(owner.textContent).toContain('ckt1qyqindexe');
    // The provenance sentence is on the row, not printed under it (D-19): it
    // explains the row rather than reading anything off this Cell, and every
    // OWNER row on every card carried the same sixteen words.
    expect(owner.textContent).not.toContain('ADDRESS ENCODED FROM THE LOCK SCRIPT');
    expect(owner.querySelector('[data-cell-evidence-value="owner"]')
      ?.getAttribute('title'))
      .toBe('ckt1qyqindexedaddress0000000000\nADDRESS ENCODED FROM THE LOCK SCRIPT');
    expect(lockEvidence.querySelector('[data-cell-evidence-row="lock-script"]')
      ?.textContent).toBe('SCRIPT0xlock');
    expect(lockEvidence.querySelector('[data-cell-evidence-row="lock-args"]')
      ?.textContent).toBe('ARGS0x1234');
    expect(lockEvidence.textContent).not.toContain('Default Lock');
    // The old cramped script block is gone — one grammar, not two.
    expect(container.querySelector('[data-cell-context-script="lock"]')).toBeNull();

    // TYPE cluster: decoded amount, asset identity, the type script's own
    // rows and the DAO position spelled out one fact to a line.
    const typeCluster = container.querySelector('[data-cell-cluster="type"]') as HTMLElement;
    expect(typeCluster.querySelector('[data-cell-detail-field="asset"]')?.textContent)
      .toContain('Legacy DAO Script');
    const typeEvidence = typeCluster.querySelector('[data-cell-cluster-evidence="type"]') as HTMLElement;
    expect(typeEvidence.querySelector('[data-cell-evidence-row="amount"]')?.textContent)
      .toContain('123.45 NTT');
    // The register's one type size. AMOUNT used to be lifted to `value`
    // (11.5) while IDENTITY directly under it — the same asset, the same gold
    // — stayed at `label`, two rungs down and unargued. Emphasis is the ink
    // here; the size is what says which register a row is in.
    expect((typeEvidence.querySelector('[data-cell-evidence-value="amount"]') as HTMLElement)
      .style.fontSize).toBe(`${HUD_TYPE.label}px`);
    expect((typeEvidence.querySelector('[data-cell-evidence-value="identity"]') as HTMLElement)
      .style.fontSize)
      .toBe((typeEvidence.querySelector('[data-cell-evidence-value="amount"]') as HTMLElement).style.fontSize);
    expect(typeEvidence.querySelector('[data-cell-evidence-row="identity"]')?.textContent)
      .toContain('NTT · Nervos Test Token · xUDT');
    expect(typeEvidence.querySelector('[data-cell-evidence-row="type-script"]')
      ?.textContent).toBe('SCRIPT0xtype');
    expect(typeEvidence.querySelector('[data-cell-evidence-row="type-args"]')
      ?.textContent).toBe('ARGS0xabcd');
    expect(typeEvidence.querySelector('[data-cell-script-state="deprecated"]'))
      .toBeNull();   // no canonical type script on this Cell, so no CODE row
    expect(typeEvidence.querySelector('[data-cell-evidence-row="type-code"]')).toBeNull();

    // DAO rows read the facet BY KEY, including the timestamps appended after
    // the keys it shipped with.
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-position"]')
      ?.textContent).toBe('POSITIONDEPOSIT');
    // ⚠️ DEPOSITED states the CLOCK ALONE here, because this deposit's block
    // IS the Cell's birth block — a deposit creates the Cell it deposits into,
    // so COMMIT one rank up, ORIGIN TX and this row were three prints of one
    // number. The clock is the half COMMIT does not carry. WITHDRAW REQ is a
    // different block and keeps both.
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-deposited"]')
      ?.textContent).toBe('DEPOSITED2025-08-15 06:07 UTC');
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-withdraw-request"]')
      ?.textContent).toBe('WITHDRAW REQ#16,210,000 · 2025-08-16 06:07 UTC');
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-apc"]')
      ?.textContent).toBe('EST APC2.01%');
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-compensation"]')
      ?.textContent).toBe('COMPENSATION1.25 CKB');
    // Nothing withdrew, so no row claims it did.
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-withdrawn"]'))
      .toBeNull();
    // The generic one-line facet summary no longer speaks for the DAO.
    expect(container.querySelector('[data-cell-context-facet="ckb:dao"]')).toBeNull();
    // Only the primary facet joins the cluster.
    expect(analysis.textContent).not.toContain('DEP GROUP');
    expect(analysis.textContent).not.toContain('CODE CELL');

    // BYTES zone: capacity fact + byte budget fed by the record's knowledge.
    const budget = container.querySelector('[data-cell-byte-budget]') as HTMLElement;
    expect(budget).not.toBeNull();
    expect(budget.getAttribute('data-byte-budget-total-bytes')).toBe('133');
    expect(budget.textContent).toContain('133 B');
    expect(budget.textContent).toContain('OCCUPIED');
    // The budget no longer restates the capacity: `OF 123 CKB` sat three
    // lines under the CAPACITY fact printing the identical formatted figure.
    // It survives exactly where a restatement is free — the hover title.
    expect(budget.textContent).not.toContain('OF');
    expect(container.querySelector('[data-byte-budget-ratio]')?.getAttribute('title'))
      .toContain('123');
    expect(container.querySelector('[data-cell-cluster="capacity"]')
      ?.contains(budget)).toBe(true);
    // The old 3px KnowledgeBar is gone — never two byte bars.
    expect(analysis.textContent).not.toContain('KNOWLEDGE');
    expect(container.querySelectorAll('[data-byte-budget-composition="true"]')).toHaveLength(1);

    // The DATA cluster is a FACT and only a fact: the READING moved into
    // CKBYTES on 2026-09-08, and it is the whole of what that window is — no
    // status line, no byte grid, no ASCII, no door.
    const contentMemory = container.querySelector('[data-cell-content-memory="true"]');
    expect(container.querySelector('[data-cell-cluster="data"] [data-cell-content-memory]'))
      .toBeNull();
    // …standing in the reader's own band, between the CKBYTES header and the
    // wrapper that stages the dump. A table of contents belongs to the thing it
    // indexes, and the order is the order the card is read in: what these bytes
    // are, then the bytes.
    const readerRoot = container.querySelector(
      '[data-cell-data-reader="true"]',
    ) as HTMLElement;
    expect(readerRoot.contains(contentMemory as Node)).toBe(true);
    const band = Array.from(readerRoot.children) as HTMLElement[];
    expect(band).toHaveLength(3);
    // Not the reader's own title: the instrument around it carries that, and
    // the module number rides its leader. What stands above the reading is the
    // one command whose state lives inside the reader.
    expect(band[0].textContent).toBe('COPY');
    expect(band[1].getAttribute('data-cell-data-reader-reading')).toBe('true');
    expect(band[1].contains(contentMemory as Node)).toBe(true);
    expect(band[2].getAttribute('data-cell-data-reader-reveal-state')).not.toBeNull();
    expect(band[2].contains(contentMemory as Node)).toBe(false);
    expect(contentMemory?.getAttribute('data-cell-content-byte-origin')).toBe('indexed');
    expect(contentMemory?.getAttribute('data-cell-content-complete')).toBe('true');
    // …and the whole of it is the BYTES. What the Cell is worth, what its
    // role is, and the indexer's sentence about its own pipeline all belong to
    // rows one rank up that already print them (the round-3 declutter):
    expect(contentMemory?.textContent).not.toContain('123.45 NTT');
    expect(contentMemory?.textContent).not.toContain('VALUE');
    expect(contentMemory?.textContent).not.toContain('ROLE');
    expect(contentMemory?.textContent).not.toContain('DAO · DEPOSIT');
    expect(contentMemory?.textContent)
      .not.toContain('UTF-8 JSON object decoded from Cell data');
    expect(contentMemory?.querySelector('[data-cell-content-deterministic]')
      ?.getAttribute('title'))
      .toBe('UTF-8 JSON object decoded from Cell data');
    expect(contentMemory?.textContent).toContain('DECODE · JSON DOCUMENT');
    // …and a guess is what a card offers when it has nothing better: this Cell
    // has a deterministic decode, so no heuristic is staged beside it.
    expect(contentMemory?.querySelector('[data-cell-content-heuristic]')).toBeNull();
    expect(contentMemory?.textContent).not.toContain('application/json');
    expect(contentMemory?.textContent).not.toContain('INDEX ANALYSIS');
    expect(contentMemory?.querySelector('[data-cell-content-raw]')).toBeNull();
    expect(contentMemory?.querySelectorAll('[data-cell-content-byte]')).toHaveLength(0);
    expect(contentMemory?.querySelector('[data-cell-content-ascii]')).toBeNull();
    expect(contentMemory?.querySelector('[data-cell-content-read-all]')).toBeNull();

    // Every segment the decode found is a row, from the first frame, in record
    // order — no stepper, and nothing hidden behind one.
    const segmentRows = contentMemory?.querySelectorAll('[data-cell-content-segment]');
    expect(segmentRows).toHaveLength(3);
    expect(segmentRows?.[0].textContent).toBe('OBJECT START[0..1) · 1 B{');
    expect(segmentRows?.[1].textContent).toBe('DOCUMENT BODY[1..7) · 6 B"a":1}');
    expect(segmentRows?.[2].getAttribute('data-cell-content-segment-range'))
      .toBe('28:40');
    expect(segmentRows?.[2].textContent).toContain('EXTENSION PAYLOAD');

    // A row is a control, and controls belong to revealed rows. Pressing one
    // points CKBYTES at the segment; nothing on this window moves.
    settleScan(performanceNow);
    fireEvent.click(segmentRows![2]);
    expect(segmentRows?.[2].getAttribute('aria-pressed')).toBe('true');
    expect(segmentRows?.[0].getAttribute('aria-pressed')).toBe('false');
    // …clamped to the CHAIN's own count. The record says its content runs to
    // byte 40 and `Cell.data_bytes` says eleven, and the reader draws the
    // Cell — so the range it takes is the part of the segment that exists.
    expect(container.querySelector('[data-cell-data-reader]')
      ?.getAttribute('data-cell-data-reader-selection')).toBe('10:11');

    // Provenance footer: the enrichment PROOF anchor chip relocated here;
    // CREATED stays collapsed while it just restates COMMIT.
    const proofChip = container.querySelector('[data-cell-provenance-proof="true"]') as HTMLElement;
    expect(proofChip.textContent).toContain('PROOF');
    expect(proofChip.textContent).toContain('#16,204,800');
    expect(proofChip.querySelector('[data-cell-context-fact="created"]')).toBeNull();

    // Compact source strip survives without index-layer vocabulary.
    const sourceStrip = container.querySelector('[data-cell-semantics-phase="ready"]') as HTMLElement;
    expect(sourceStrip).not.toBeNull();
    expect(sourceStrip.getAttribute('data-cell-semantics-source')).toBe('ready');
    expect(sourceStrip.textContent).toContain('READY');
    expect(sourceStrip.textContent).toContain('1 BLOCK LAG');
    expect(analysis.textContent).not.toContain('INDEX LAYER');
    expect(analysis.textContent).not.toContain('CELL CONTEXT');
    expect(analysis.textContent).not.toContain('CKBADGER');
    // The transaction record gets no plate of its own — its two facts join
    // the provenance footer's ORIGIN TX row, where the reader is already
    // looking at the transaction that made this Cell.
    expect(analysis.textContent).not.toContain('ORIGIN TRANSACTION');
    expect(analysis.querySelector('[data-causal-origin-value="fee"]')?.textContent)
      .toBe('1,000 SHANNONS');
    expect(analysis.querySelector('[data-causal-origin-value="cycles"]')?.textContent)
      .toBe('12,345');
    // The enrichment anchor no longer expects the reader to know what an
    // anchor block is — and it no longer PRINTS the explanation either (the
    // user's D-19 ruling): the sentence is on the row, on hover, because it
    // names a convention rather than reading anything off this Cell.
    expect(proofChip.textContent)
      .not.toContain('ENRICHMENT ANCHOR · EVERY INDEXED FACT ABOVE IS AS OF THIS BLOCK');
    expect(proofChip.querySelector('[data-cell-context-fact="proof"]')
      ?.getAttribute('title'))
      .toBe('ENRICHMENT ANCHOR · EVERY INDEXED FACT ABOVE IS AS OF THIS BLOCK');

    expect(container.textContent).not.toContain('SINCE #');
    expect(Array.from(container.querySelectorAll('span')).filter(
      (span) => span.textContent === 'AGE',
    )).toHaveLength(0);
    performanceNow.mockRestore();
  });

  it('names what an inventory Cell holds, beside the script that governs it', () => {
    const { container } = render(
      <CellDetailPanel
        cell={typed}
        onClose={() => {}}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: typed.out_point,
          source: 'ckbadger',
          as_of: { block: typed.birth_block, hash: '0xanchor' },
          observed_at_block: typed.birth_block,
          updated_at_ms: 1,
          type_script: {
            script_hash: '0xspore',
            code_hash: typed.type_script!.code_hash,
            hash_type: 'data1',
            args: '0x',
            name: 'Spore',
            deprecated: true,
          },
          content: {
            total_bytes: 11,
            data_complete: true,
            deterministic: {
              kind: 'spore_cell',
              summary: 'Spore DOB content payload',
              segments: [
                {
                  label: 'content_type',
                  start_byte: 0,
                  end_byte: 9,
                  meaning: 'Declared MIME type',
                  value: 'image/png',
                },
                {
                  label: 'content',
                  start_byte: 9,
                  end_byte: 11,
                  meaning: 'Encoded payload',
                  value: '2 bytes',
                },
              ],
            },
            heuristics: [],
          },
          facets: [],
        }}
      />,
    );

    const typeEvidence = container.querySelector(
      '[data-cell-cluster-evidence="type"]',
    ) as HTMLElement;
    // The type script's code hash comes from the CELL, so this row would be
    // here for a bare Spore too; the index only adds the lifecycle chip.
    expect(typeEvidence.querySelector('[data-cell-evidence-row="type-code"]')
      ?.textContent).toBe('CODEDEPRECATED0x5d5d5d5d5d…d5d5d5d5d · DATA1');
    expect(typeEvidence.querySelector('[data-cell-script-state="deprecated"]'))
      .not.toBeNull();
    // One line saying WHAT is in the Cell, pulled from the decode's own
    // segments rather than restating its summary.
    expect(typeEvidence.querySelector('[data-cell-evidence-row="object"]')
      ?.textContent).toBe('OBJECTimage/png · 11 B');
    // Empty args say EMPTY: `0x` beside a label reads as a broken row.
    expect(typeEvidence.querySelector('[data-cell-evidence-row="type-args"]')
      ?.textContent).toBe('ARGSEMPTY');
  });

  it('reserves an expected record\'s rows, then settles exactly once', () => {
    const source: EnrichmentSourceStatus = {
      source: 'ckbadger',
      status: 'syncing',
      capabilities: ['cell_detail'],
    };
    const { container, rerender } = render(
      <CellDetailPanel
        cell={base}
        semanticSource={source}
        semanticPhase="loading"
        onClose={() => {}}
      />,
    );
    const slot = (name: string) => container.querySelector(
      `[data-cell-evidence-slot="${name}"]`,
    ) as HTMLElement;

    // A record is on its way: the rows it will fill already hold their height.
    // LOCK holds three bare rails like the rest — OWNER's caption line went to
    // the row's `title` (D-19), and the reservation went with it.
    expect(slot('lock').style.minHeight).toBe('66px');
    expect(slot('type').style.minHeight).toBe('66px');
    // The CKBYTE zone's reservation is EXACTLY the ghost stack that fills it;
    // a slot that reserves one number and renders another settles by the
    // difference the moment the record lands.
    expect(slot('capacity').style.minHeight).toBe('66px');
    const ghosts = container.querySelectorAll('[data-cell-evidence-ghost]');
    expect(ghosts).toHaveLength(3);
    expect((ghosts[0] as HTMLElement).style.opacity).toBe('0.18');
    expect(ghosts[0].getAttribute('aria-hidden')).toBe('true');

    // It arrives: real rows take the reserved height, ghosts leave.
    rerender(
      <CellDetailPanel
        cell={base}
        semanticSource={{ ...source, status: 'ready' }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
          updated_at_ms: 1,
          address: 'ckt1qyqarrived0000000000',
          lock_script: {
            script_hash: '0xlock',
            code_hash: '0xcode',
            hash_type: 'type',
            args: '0x1234',
          },
          facets: [],
        }}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('[data-cell-evidence-ghost]')).toBeNull();
    expect(slot('lock').style.minHeight).toBe('');
    expect(container.querySelectorAll('[data-cell-evidence-slot="lock"] [data-cell-evidence-row]'))
      .toHaveLength(3);
  });

  it('lights the reader\'s frame from the first frame and stages only its bytes', () => {
    // D-4. The section used to ghost as a whole, so for the first two thirds of
    // every walk the card drew a rose plate and a CKBYTES title at 0.18 — a
    // plate saying nothing about the Cell yet, waiting. A frame is not
    // evidence: it says WHOSE surface this is, and that is true from frame
    // zero. What is evidence is the BYTES, and they are the only thing in here
    // that waits.
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = render(
      <CellDetailPanel
        cell={{ ...base, data_hex: `0x7b2261223a317d${'00'.repeat(20)}` }}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
          updated_at_ms: 1,
          content: {
            data_hex: `0x7b2261223a317d${'00'.repeat(20)}`,
            total_bytes: 27,
            data_complete: true,
            deterministic: {
              kind: 'json_document',
              summary: 'UTF-8 JSON object decoded from Cell data',
              segments: [{
                start_byte: 0,
                end_byte: 7,
                label: 'document_body',
                value: '{"a":1}',
                meaning: 'JSON body',
              }],
            },
            heuristics: [],
          },
          facets: [],
        } as unknown as CellSemanticRecord}
        onClose={() => {}}
      />,
    );
    const section = container.querySelector(
      '[data-cell-inspection-satellite="reader"]',
    ) as HTMLElement;
    const slot = () => container.querySelector(
      '[data-cell-data-reader-reading]',
    ) as HTMLElement;
    const bytes = () => section.querySelector(
      '[data-cell-data-reader-reveal-state]',
    ) as HTMLElement;
    const copy = () => container.querySelector(
      '[data-cell-data-reader-copy]',
    ) as HTMLButtonElement;

    // Frame zero: the plate and its header are drawn, the reading is standing
    // in its slot on its own clock, and only the dump is dark.
    expect(section.style.opacity).toBe('');
    expect(section.dataset.cellDataReaderRevealState).toBeUndefined();
    expect(slot()).not.toBeNull();
    expect(slot().style.opacity).toBe('');
    expect(bytes().dataset.cellDataReaderRevealState).toBe('scanning');
    expect(bytes().style.opacity).toBe('0.18');
    // COPY is a control over ghosted content: it would put a payload on the
    // clipboard the card has not finished saying it holds.
    expect(copy().disabled).toBe(true);
    // The reading is one segment, so the band the dump was charged is the slot
    // chrome, the DECODE line and one row — and never the pending reservation.
    expect(section.dataset.cellDataReaderReadingPx)
      .toBe(`${READING_SLOT_CHROME_PX + READING_DECODE_LINE_PX + READING_SEGMENT_ROW_PX}`);

    settleScan(performanceNow);

    expect(bytes().dataset.cellDataReaderRevealState).toBe('resolved');
    expect(bytes().style.opacity).toBe('1');
    expect(copy().disabled).toBe(false);
    // …and the frame never moved through any of it.
    expect(section.style.opacity).toBe('');
    expect(slot().style.opacity).toBe('');
    performanceNow.mockRestore();
  });

  it('holds the reading\'s analysis rows in CKBYTES, so the dump never moves', () => {
    const source: EnrichmentSourceStatus = {
      source: 'ckbadger',
      status: 'syncing',
      capabilities: ['cell_detail'],
    };
    const { container, rerender } = render(
      <CellDetailPanel
        cell={{ ...base, data_hex: `0x7b2261223a317d${'00'.repeat(20)}` }}
        semanticSource={source}
        semanticPhase="loading"
        onClose={() => {}}
      />,
    );
    // The reading stands in CKBYTES now, so the reservation is held there —
    // the analysis plate has no window left to hold one for.
    const zone = () => container.querySelector(
      '[data-cell-inspection-satellite="reader"] [data-cell-content-analysis]',
    ) as HTMLElement;
    const readerSection = () => container.querySelector(
      '[data-cell-inspection-satellite="reader"]',
    ) as HTMLElement;

    // The reading's rows are the only rows in this zone whose COUNT waits on
    // the index, and the DUMP under them was divided from what they leave.
    // Held, they cannot push the dump's last rows and its foot line out of the
    // bottom of a zone that clips them.
    expect(zone().dataset.cellContentAnalysisReserved).toBe('true');
    expect(zone().style.minHeight)
      .toBe(`${CELL_CONTENT_ANALYSIS_RESERVED_PX}px`);
    // …and the number the card SPENT on the band is the same reservation plus
    // the slot's own chrome, stamped so the arithmetic is observable in a DOM
    // that lays nothing out.
    expect(readerSection().dataset.cellDataReaderReadingPx)
      .toBe(`${READING_SLOT_CHROME_PX + CELL_CONTENT_ANALYSIS_RESERVED_PX}`);

    rerender(
      <CellDetailPanel
        cell={{ ...base, data_hex: `0x7b2261223a317d${'00'.repeat(20)}` }}
        semanticSource={{ ...source, status: 'ready' }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
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
            data_hex: `0x7b2261223a317d${'00'.repeat(20)}`,
            total_bytes: 27,
            data_complete: true,
            deterministic: {
              kind: 'json_document',
              summary: 'UTF-8 JSON object decoded from Cell data',
              segments: [{
                start_byte: 0,
                end_byte: 7,
                label: 'document_body',
                value: '{"a":1}',
                meaning: 'JSON body',
              }],
            },
            heuristics: [{
              kind: 'text_encoding',
              confidence: 'high',
              reason: 'valid UTF-8',
              mime_type: 'application/json',
            }],
          },
          facets: [{
            namespace: 'ckb',
            kind: 'dao',
            state: 'deposit',
            attributes: [{ key: 'deposit_block', value: '16204800' }],
          }],
        }}
        onClose={() => {}}
      />,
    );

    // jsdom lays nothing out, so the pin is the SHAPE rather than the pixels:
    // this arrival is every analysis row the index can send at once — DECODE
    // and the segment rows, which is exactly the stack
    // CELL_CONTENT_ANALYSIS_RESERVED_PX is summed from. Nothing taller can
    // land, so the reservation settles down or not at all, never up. (The
    // record below carries a heuristic and a facet too, and neither reaches
    // this window any more: a guess is staged only where there is no decode,
    // and a role is the register's own row one rank up.)
    expect(zone().dataset.cellContentAnalysisReserved).toBeUndefined();
    expect(zone().style.minHeight).toBe('');
    expect(zone().querySelector('[data-cell-content-segment="0"]')).not.toBeNull();
    expect(zone().querySelector('[data-cell-content-heuristic="0"]')).toBeNull();
    expect(zone().querySelector('[data-cell-content-role="0"]')).toBeNull();
    expect(zone().querySelector('[data-cell-content-asset]')).toBeNull();
    // …and the band settles to the one row the record actually carries, which
    // is the D-7 bargain stated in numbers: the dump gets 120 px back.
    expect(readerSection().dataset.cellDataReaderReadingPx)
      .toBe(`${READING_SLOT_CHROME_PX + READING_DECODE_LINE_PX + READING_SEGMENT_ROW_PX}`);
  });

  it('collapses the reservation once when the record resolves absent', () => {
    const source: EnrichmentSourceStatus = {
      source: 'ckbadger',
      status: 'syncing',
      capabilities: ['cell_detail'],
    };
    const { container, rerender } = render(
      <CellDetailPanel
        cell={base}
        semanticSource={source}
        semanticPhase="waiting"
        onClose={() => {}}
      />,
    );
    expect((container.querySelector('[data-cell-evidence-slot="lock"]') as HTMLElement)
      .style.minHeight).toBe('66px');

    rerender(
      <CellDetailPanel
        cell={base}
        semanticSource={{ ...source, status: 'ready' }}
        semanticPhase="unavailable"
        onClose={() => {}}
      />,
    );
    // One settle, not a creep: nothing is expected any more, so nothing is
    // held — and the canonical CODE row never moved through any of it.
    expect((container.querySelector('[data-cell-evidence-slot="lock"]') as HTMLElement)
      .style.minHeight).toBe('');
    expect(container.querySelector('[data-cell-evidence-ghost]')).toBeNull();
    expect(container.querySelector('[data-cell-evidence-row="lock-code"]')).not.toBeNull();
    expect(container.textContent).toContain('NO VALIDATED RECORD FOR THIS CELL');
  });

  it('admits a truncated data window on the byte budget', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(
      <CellDetailPanel
        cell={{ ...base, data_hex: `0xdeadbeef${DATA_HEX_TRUNCATION_MARKER}` }}
        onClose={() => {}}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
          updated_at_ms: 1,
          common_knowledge: {
            total_bytes: 120,
            capacity_field_bytes: 8,
            lock_script_bytes: 52,
            type_script_bytes: 0,
            data_bytes: 60,
          },
          facets: [],
        }}
      />,
    );
    expect(container.querySelector('[data-byte-budget-segment="data"]')
      ?.getAttribute('data-byte-budget-segment-observed')).toBe('partial');
  });

  it('states the data size a clipped hex preview cannot count', () => {
    // The wire bounds `data_hex` at 1 KiB and marks the cut. Counting THAT
    // used to turn a 6,947-byte Cell into `1024 B+`; the exact size rides
    // beside the preview and is what the fact says. The preview's clipping is
    // a fact about our window, and the content memory is where it is admitted.
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(
      <CellDetailPanel
        cell={{
          ...base,
          data_hex: `0x${'ab'.repeat(1024)}${DATA_HEX_TRUNCATION_MARKER}`,
          data_bytes: 6947,
        }}
        onClose={() => {}}
      />,
    );
    // `◇` is the facet's unread identity-proof mark, between label and value.
    expect(container.querySelector('[data-cell-detail-field="data"]')?.textContent)
      .toBe('DATA◇6,947 B');
    const text = container.textContent ?? '';
    expect(text).not.toContain('1024 B+');
    expect(text).not.toContain(' observed');
    expect(text).not.toContain('OBSERVED');
    // What we could see, and that it is a window onto more: the honesty moved
    // to CKBYTES' foot line, which is the surface that actually holds the
    // prefix — and it states the CHAIN's count beside it rather than the
    // window's, because the reader is asking the node for the rest.
    expect(text).toContain('READING 6,947 B · 1,024 B HELD');
    expect(container.querySelector('[data-cell-data-reader-foot]')
      ?.getAttribute('data-cell-data-reader-foot-mode')).toBe('status');
  });

  it('fills the clipped Cell\'s ghost rows from the node, in place', async () => {
    // The 93 staged Cells the held prefix does not cover. The reader opens on
    // what the browser has, draws the rest as ghosts rather than as zeroes
    // nobody sent, and fills them WITHOUT the plate changing height: the row
    // count is `ceil(data_bytes / 16)` from the first frame, because it comes
    // from the chain's count and never from what arrived.
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const payload = new Uint8Array(6947);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = index % 251;
    }
    const fetched = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      // ⚠️ TS 5.9: `BodyInit`'s `BufferSource` wants `ArrayBufferView<ArrayBuffer>`,
      // and an un-annotated `Uint8Array` is `Uint8Array<ArrayBufferLike>` — so
      // the bytes are re-wrapped rather than the generic form written out.
      new Uint8Array(payload),
      {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'x-cell-data-bytes': String(payload.length),
          'x-cell-data-hash': `0x${'5c'.repeat(32)}`,
          'x-cell-status': 'live',
        },
      },
    ));
    vi.stubGlobal('fetch', fetched);

    const { container } = render(
      <CellDetailPanel
        cell={{
          ...base,
          data_hex: `0x${'ab'.repeat(1024)}${DATA_HEX_TRUNCATION_MARKER}`,
          data_bytes: 6947,
        }}
        onClose={() => {}}
      />,
    );
    settleScan(performanceNow);
    // No click anywhere: the reader is mounted with the card, and the request
    // goes out at mount because the held prefix is shorter than the Cell.
    const reader = container.querySelector(
      '[data-cell-data-reader]',
    ) as HTMLElement;
    expect(reader.dataset.cellDataReaderPhase).toBe('loading');
    expect(reader.dataset.cellDataReaderRows).toBe('435');

    // Past the 1,024 bytes we hold: ghosts, at the card's own ghost opacity,
    // and never a drawn zero.
    const dump = reader.querySelector(
      '[data-cell-data-reader-dump]',
    ) as HTMLElement;
    dump.scrollTop = 64 * 13.5;
    fireEvent.scroll(dump);
    const ghosts = reader.querySelectorAll('[data-cell-data-reader-ghost]');
    expect(ghosts.length).toBeGreaterThan(0);
    expect((ghosts[0] as HTMLElement).style.opacity).toBe('0.18');
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(String(fetched.mock.calls[0][0]))
      .toContain(`/api/cells/${base.out_point.tx_hash}/2/data`);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Filled in place: same plate, same row count, no ghosts left.
    expect(reader.dataset.cellDataReaderPhase).toBe('ready');
    expect(reader.dataset.cellDataReaderRows).toBe('435');
    expect(reader.querySelectorAll('[data-cell-data-reader-ghost]'))
      .toHaveLength(0);
    performanceNow.mockRestore();
  });

  it('keeps enrichment on the probe timeline instead of lighting it early', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = render(
      <CellDetailPanel
        cell={base}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
          lag_blocks: 0,
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: 19000001, hash: '0xanchor' },
          observed_at_block: 19000000,
          updated_at_ms: 1,
          address: 'ckt1qgatedaddress000000000000000',
          lock_script: {
            script_hash: '0xlock',
            code_hash: '0xcode',
            hash_type: 'type',
            args: '0x1234',
            name: 'Default Lock',
            family: 'lock',
            deprecated: false,
          },
          common_knowledge: {
            total_bytes: 60,
            capacity_field_bytes: 8,
            lock_script_bytes: 52,
            type_script_bytes: 0,
            data_bytes: 0,
          },
          facets: [],
        }}
        onClose={() => {}}
      />,
    );

    const owner = () => container.querySelector('[data-cell-evidence-row="owner"]') as HTMLElement;
    const scripts = () => container.querySelector('[data-cell-evidence-row="lock-args"]') as HTMLElement;
    const budget = () => container.querySelector('[data-cell-byte-budget]') as HTMLElement;
    // While the lattice is still scanning, the deeper enrichment stays dark.
    expect(owner().style.opacity).toBe('0');
    expect(scripts().style.opacity).toBe('0');
    expect(budget().getAttribute('data-byte-budget-reveal-state')).toBe('scanning');
    // One step after the sixth landmark: context rows and the byte layout
    // light (the budget bar is context, step 1); script evidence waits.
    performanceNow.mockReturnValue(PROBE_STEP_S * 6.6 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(owner().style.opacity).toBe('1');
    expect(scripts().style.opacity).toBe('0');
    expect(budget().getAttribute('data-byte-budget-reveal-state')).toBe('resolved');
    // Two steps after: the whole enrichment block is lit.
    performanceNow.mockReturnValue(PROBE_STEP_S * 7.7 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(scripts().style.opacity).toBe('1');
    // The CREATED chip genuinely disagrees with COMMIT here, so it prints.
    expect(container.querySelector('[data-cell-context-fact="created"]')
      ?.textContent).toContain('#19,000,000');
    performanceNow.mockRestore();
  });

  it('advances the scan beam without hiding any evidence module', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    expect(analysis.getAttribute('data-cellular-scan-progress')).toBe('0');
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('scanning');
    // CKBYTES is the zone this Cell stages, and it is a zone of the card: no
    // index answered for it, so the DATA cluster's window renders nothing, and
    // the bytes are read under the square.
    const reader = container.querySelector(
      '[data-cell-inspection-satellite="reader"]',
    ) as HTMLElement;
    // The BYTES are what stages, and the wrapper around the dump and the foot
    // line is what carries the state — the section itself is a frame and a
    // header, and a plate that draws itself is not evidence about the Cell.
    const bytes = () => reader.querySelector(
      '[data-cell-data-reader-reveal-state]',
    ) as HTMLElement;
    expect(container.querySelector('[data-cell-content-memory]')).toBeNull();
    // No index answered for this Cell, so there is no reading and no slot for
    // one — and the card handed the dump a band of nothing.
    expect(container.querySelector('[data-cell-data-reader-reading]')).toBeNull();
    expect(reader.dataset.cellDataReaderReadingPx).toBe('0');
    // The reader is there at final size from the first frame — the walk lights
    // it, it never mounts it. Nothing on the card can be pushed by a reveal.
    expect(bytes().dataset.cellDataReaderRevealState).toBe('scanning');
    // It used to read `stretch`: "as tall as the plate beside it", which is
    // the arithmetic that drew 249 px of bordered emptiness under a one-row
    // payload's foot line. An instrument standing apart is its own height.
    expect(reader.style.alignSelf).toBe('');
    const causal = () => container.querySelector(
      '[data-consensus-memory-reveal="causal"]',
    ) as HTMLElement;
    // The section is LIT from frame zero and only the bytes wait — the
    // instrument around it takes the pointer, and the section never a ghost's
    // `none`.
    expect(reader.style.opacity).toBe('');
    expect(reader.style.pointerEvents).toBe('');
    expect((reader.closest('[data-cell-constellation-panel]') as HTMLElement)
      .style.pointerEvents).toBe('auto');
    expect(reader.getAttribute('aria-hidden')).toBeNull();
    expect(bytes().style.opacity).toBe('0.18');
    expect(bytes().style.pointerEvents).toBe('none');
    expect(bytes().getAttribute('aria-hidden')).toBe('true');
    // …and its rows are already drawn behind the ghost: 11 bytes is one row,
    // counted from the chain's own `data_bytes`.
    expect(reader.querySelector('[data-cell-data-reader]')
      ?.getAttribute('data-cell-data-reader-rows')).toBe('1');
    performanceNow.mockReturnValue(PROBE_STEP_S * 2.5 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    // `CELL // #id` names the specimen from the chip under its reticle now.
    expect(container.textContent).not.toContain('CELL // #4242');
    expect(Number(analysis.getAttribute('data-cellular-scan-progress'))).toBeGreaterThan(0);
    // Still ghosted at 2.5 steps: the bytes light with the DATA step, which is
    // the last thing the memory walk does before the lattice locks — the
    // reading above them names these bytes, so they may not arrive after them.
    expect(bytes().dataset.cellDataReaderRevealState).toBe('scanning');
    expect(bytes().style.opacity).toBe('0.18');
    expect(bytes().style.pointerEvents).toBe('none');
    expect(reader.style.opacity).toBe('');
    // Mid-scan the causal lens is still resolving — and still laid out.
    expect(causal().style.display).toBe('block');
    expect(causal().style.opacity).toBe('0.18');
    expect(causal().style.pointerEvents).toBe('none');

    performanceNow.mockReturnValue(PROBE_STEP_S * 6 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('locked');
    expect(bytes().dataset.cellDataReaderRevealState).toBe('resolved');
    const settledSpecimenScan = container.querySelector(
      '[data-cell-specimen-scan-light]',
    ) as HTMLElement;
    // D-6: classification retires the ambient sweep — it stops looping,
    // releases will-change and fades out — so the card's `filter` surface stops
    // being damaged every frame. The element stays mounted (the reveal only
    // ever changes ink, never the card's node set); during the scan it still
    // animates — see the render test above.
    expect(settledSpecimenScan).not.toBeNull();
    expect(settledSpecimenScan.style.animation).toBe('');
    expect(settledSpecimenScan.style.willChange).toBe('');
    expect(settledSpecimenScan.style.opacity).toBe('0');
    expect(causal().style.display).toBe('block');
    expect(causal().style.opacity).toBe('1');
    expect(causal().style.pointerEvents).toBe('auto');
    expect(causal().getAttribute('aria-hidden')).toBeNull();
    // The bytes are lit and touchable; the frame around them never changed at
    // all, which is the point of taking the stage off the section.
    expect(bytes().style.opacity).toBe('1');
    expect(bytes().style.pointerEvents).toBe('auto');
    expect(bytes().getAttribute('aria-hidden')).toBeNull();
    expect(reader.style.opacity).toBe('');
    expect((reader.closest('[data-cell-constellation-panel]') as HTMLElement)
      .style.pointerEvents).toBe('auto');
    expect(reader.getAttribute('aria-hidden')).toBeNull();
    performanceNow.mockRestore();
  });

  // ——— The acceptance oracle ————————————————————————————————————————
  // The complaint this whole reveal rework answers: the window changed size
  // while it filled in. jsdom has no layout engine, so a height cannot be
  // measured here — what CAN be pinned is every mechanism that produces one.
  // If no element ever appears, disappears, or changes a geometry property
  // between two frames of the reveal clock, the card cannot have changed
  // height between them either.
  const GEOMETRY_PROPERTIES = [
    'display', 'position', 'width', 'height', 'minWidth', 'minHeight',
    'maxWidth', 'maxHeight', 'margin', 'marginTop', 'marginBottom',
    'padding', 'paddingTop', 'paddingBottom', 'gap', 'rowGap', 'columnGap',
    'gridTemplateAreas', 'gridTemplateColumns', 'gridTemplateRows',
    'gridArea', 'gridColumn', 'flexBasis', 'flexWrap', 'aspectRatio',
    'borderTopWidth', 'borderBottomWidth', 'fontSize', 'lineHeight',
    'whiteSpace',
  ] as const;

  /** One frame of the card's layout: every element, in document order, with
   *  every property that decides how much room it takes. Ink — opacity,
   *  colour, transform, shadow — is deliberately absent: that is the entire
   *  vocabulary the reveal is allowed to speak in. */
  function layoutFrame(root: HTMLElement): string {
    const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
    return (nodes as HTMLElement[])
      .map((node) => [
        node.tagName,
        ...GEOMETRY_PROPERTIES.map((property) => node.style[property]),
      ].join('|'))
      .join('\n');
  }

  /** Every element the reveal stages, ghosted or lit — CKBYTES included, which
   *  is a zone of the card now and stages like every other one. */
  function stagedRows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll(
      '[data-cell-content-reveal-item],[data-consensus-memory-reveal],[data-cell-detail-field],[data-cell-data-reader-reveal-state]',
    )) as HTMLElement[];
  }

  /** Drive the reveal clock frame by frame the way the panel's own interval
   *  does, and hand back the layout of every frame it passed through. */
  function sweepReveal(root: HTMLElement, performanceNow: {
    mockReturnValue: (value: number) => void;
  }): string[] {
    const frames = [layoutFrame(root)];
    // Past the last enrichment step (8 × 300ms) and the clock's own stop.
    for (let atMs = 80; atMs <= 2720; atMs += 80) {
      performanceNow.mockReturnValue(atMs);
      act(() => { vi.advanceTimersByTime(80); });
      frames.push(layoutFrame(root));
    }
    return frames;
  }

  it('never changes its layout while the reveal clock walks a bare Cell', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        onTraceWrite={() => {}}
        onClose={() => {}}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    // No index answered for this Cell, so there is no reading at all — its
    // bytes are drawn by CKBYTES under the square, and a heading over nothing
    // is not a window. What stages here is the reader's dump.
    expect(container.querySelector('[data-cell-content-memory]')).toBeNull();
    const reader = container.querySelector(
      '[data-cell-inspection-satellite="reader"]',
    ) as HTMLElement;
    const bytes = () => reader.querySelector(
      '[data-cell-data-reader-reveal-state]',
    ) as HTMLElement;
    // …so no slot mounts either, and the band the card charged the dump for is
    // nothing: no phantom six pixels between the header and the first row.
    expect(container.querySelector('[data-cell-data-reader-reading]')).toBeNull();
    expect(reader.dataset.cellDataReaderReadingPx).toBe('0');

    // Everything the walk will light is standing there, dark and untouchable,
    // before the walk starts.
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('scanning');
    expect(bytes().dataset.cellDataReaderRevealState).toBe('scanning');
    // The reader's FRAME is not one of them: it is drawn lit from frame zero,
    // like the analysis plate's masthead beside it.
    expect(reader.style.opacity).toBe('');
    const ghosted = stagedRows(container);
    expect(ghosted.length).toBeGreaterThan(5);
    for (const row of ghosted) {
      expect(row.style.display).not.toBe('none');
      expect(row.style.opacity).toBe('0.18');
      expect(row.style.pointerEvents).toBe('none');
    }
    // Three instruments from the first frame, each its own rectangle. The
    // grid — and with it the L the reader used to make with the square — is
    // gone; a fourth instrument appears beside these rather than reshaping
    // anything they stand in.
    expect(Array.from(
      container.querySelectorAll('[data-cell-constellation-panel]'),
      (host) => host.getAttribute('data-cell-constellation-panel'),
    )).toEqual(['analysis', 'specimen', 'reader']);

    const frames = sweepReveal(root, performanceNow);

    // The reveal genuinely happened…
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('locked');
    expect(bytes().dataset.cellDataReaderRevealState).toBe('resolved');
    expect(reader.style.opacity).toBe('');
    for (const row of stagedRows(container)) {
      expect(row.style.opacity).toBe('1');
      expect(row.style.pointerEvents).not.toBe('none');
    }
    // …and every frame of it laid out exactly like the frame before it.
    expect(frames.length).toBeGreaterThan(30);
    for (const frame of frames) expect(frame).toBe(frames[0]);
    expect(frames[0]).not.toContain('|none|');
    performanceNow.mockRestore();
  });

  it('never changes its layout while the reveal clock walks an enriched Cell', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const semanticRecord: CellSemanticRecord = {
      out_point: base.out_point,
      source: 'ckbadger',
      as_of: { block: 19000001, hash: '0xanchor' },
      observed_at_block: 19000000,
      updated_at_ms: 1,
      address: 'ckt1qgatedaddress000000000000000',
      lock_script: {
        script_hash: '0xlock',
        code_hash: '0xcode',
        hash_type: 'type',
        args: '0x1234',
        name: 'Default Lock',
        family: 'lock',
        deprecated: false,
      },
      common_knowledge: {
        total_bytes: 133,
        capacity_field_bytes: 8,
        lock_script_bytes: 53,
        type_script_bytes: 61,
        data_bytes: 11,
      },
      content: {
        data_hex: base.data_hex,
        total_bytes: 11,
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
          ],
        },
        heuristics: [
          {
            kind: 'text_encoding',
            confidence: 'high',
            reason: 'valid UTF-8',
            mime_type: 'application/json',
          },
        ],
      },
      facets: [
        {
          namespace: 'ckb',
          kind: 'dao',
          state: 'deposit',
          attributes: [
            { key: 'deposit_block', value: '16204800', unit: 'block' },
          ],
        },
      ],
    } as CellSemanticRecord;

    const { container } = render(
      <CellDetailPanel
        cell={typed}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
          lag_blocks: 0,
        }}
        semanticPhase="ready"
        semanticRecord={semanticRecord}
        onClose={() => {}}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const owner = container.querySelector(
      '[data-cell-evidence-row="owner"]',
    ) as HTMLElement;
    const budget = container.querySelector(
      '[data-cell-byte-budget]',
    ) as HTMLElement;

    // Enrichment is present from the first frame and still waits its turn —
    // in ink. A record that is already in hand never re-lays the card out.
    expect(owner.style.opacity).toBe('0');
    expect(budget.getAttribute('data-byte-budget-reveal-state')).toBe('scanning');
    // Nothing is reserved: the rows themselves are the reservation.
    expect(container.querySelector('[data-cell-evidence-ghost]')).toBeNull();
    expect((container.querySelector('[data-cell-evidence-slot="lock"]') as HTMLElement)
      .style.minHeight).toBe('');

    const frames = sweepReveal(root, performanceNow);

    expect(owner.style.opacity).toBe('1');
    expect(budget.getAttribute('data-byte-budget-reveal-state')).toBe('resolved');
    expect(container.querySelector('[data-cell-content-deterministic]')
      ?.getAttribute('style')).toContain('opacity: 1');
    for (const frame of frames) expect(frame).toBe(frames[0]);
    expect(frames[0]).not.toContain('|none|');
    performanceNow.mockRestore();
  });

  it('reduced motion freezes decoding while keeping all scan facts visible', () => {
    // stub matchMedia so useReducedMotion() reports reduced — deterministic path
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const t = container.textContent ?? '';
    expect(t).not.toContain('CELL // #4242');
    // Reduced motion hands over a card that has already locked, so the walk's
    // progress readout was never on screen at all.
    expect(t).not.toContain('SCANNING');
    expect(t).not.toContain('A-LATTICE');
    expect(container.querySelector<HTMLElement>('[data-cell-identity-scan-status="true"]')
      ?.dataset.cellScanClassified).toBe('true');
    expect(t).not.toContain('1111111111111111 · 1111111111');
    expect(t).toContain('OMNI Lock');                              // decoded rows still present
    expect(t).toContain('11 B');
    expect((container.firstElementChild as HTMLElement).style.animation).toBe('');
    // No walk, so no ghosts: reduced motion hands the whole card over at
    // once, lit and live, with nothing waiting its turn. Six facts, the causal
    // block and CKBYTES — the DATA cluster's window renders nothing for a Cell
    // no index answered for.
    const rows = stagedRows(container);
    expect(rows.length).toBeGreaterThan(6);
    for (const row of rows) {
      expect(row.style.display).not.toBe('none');
      expect(row.style.opacity).toBe('1');
      expect(row.style.pointerEvents).not.toBe('none');
      expect(row.getAttribute('aria-hidden')).toBeNull();
    }
  });

  it('lets decoded rows focus the real scene scan field', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const onInspectionFieldChange = vi.fn();
    const { container } = render(
      <CellDetailPanel
        cell={base}
        onInspectionFieldChange={onInspectionFieldChange}
        onClose={() => {}}
      />,
    );

    fireEvent.click(container.querySelector('[data-cell-detail-field="asset"]')!);
    expect(container.querySelector('[data-cell-detail-field="asset"]')
      ?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="cell-nucleus-portrait"]')
      ?.getAttribute('data-focus-field')).toBe('asset');
    expect(onInspectionFieldChange).toHaveBeenLastCalledWith('asset');
  });

  it('keeps identity-proof interaction active on the restored specimen scan', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const onIdentityProofRead = vi.fn();
    const { getByTestId } = render(
      <CellDetailPanel
        cell={base}
        onIdentityProofRead={onIdentityProofRead}
        onClose={() => {}}
      />,
    );

    fireEvent.click(getByTestId('portrait-content-proof'));
    expect(onIdentityProofRead).toHaveBeenCalledWith('content', base.id, true);
  });

  it('keeps identity proof controls on the facts instead of repeating them in memory rows', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const onInspectionFieldChange = vi.fn();
    const { container } = render(
      <CellDetailPanel
        cell={base}
        onInspectionFieldChange={onInspectionFieldChange}
        onClose={() => {}}
      />,
    );

    expect(container.querySelector('[data-consensus-memory-identity-grid]')).toBeNull();
    expect(container.querySelector('[data-memory-identity-proof]')).toBeNull();

    fireEvent.click(container.querySelector('[data-cell-detail-field="data"]')!);
    expect(onInspectionFieldChange).toHaveBeenLastCalledWith('data');
    fireEvent.click(container.querySelector('[data-cell-detail-field="born"]')!);
    expect(onInspectionFieldChange).toHaveBeenLastCalledWith('born');
    fireEvent.click(container.querySelector('[data-cell-detail-field="state"]')!);
    expect(onInspectionFieldChange).toHaveBeenLastCalledWith('state');
  });

  it('reports each exact Cell proof from the direct scan facet', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const onIdentityProofRead = vi.fn();
    const { container } = render(
      <CellDetailPanel
        cell={base}
        onIdentityProofRead={onIdentityProofRead}
        onClose={() => {}}
      />,
    );

    for (const field of ['state', 'data', 'born'] as const) {
      fireEvent.click(container.querySelector(
        `[data-cell-detail-field="${field}"]`,
      )!);
    }
    expect(onIdentityProofRead.mock.calls).toEqual([
      ['address', base.id, true],
      ['content', base.id, true],
      ['anchor', base.id, true],
    ]);
  });

  it('binds causal recall to all three resolved identity facets', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const onTraceWrite = vi.fn();
    const partial: CellIdentityProofBinding = {
      ...identityBinding(),
      resolvedKinds: ['address'],
      phase: 'collecting',
      revision: 1,
      lastResolvedKind: 'address',
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      traceSource: 'input' as const,
      onTraceWrite,
      onClose: () => {},
    };
    const { container, getByRole, rerender } = render(
      <CellDetailPanel {...props} identityProofBinding={partial} />,
    );

    const recall = getByRole('button', { name: 'recall causal path' });
    expect((recall as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-memory-identity-binding="true"]')
      ?.getAttribute('data-memory-identity-count')).toBe('1');
    expect(container.querySelector('[data-consensus-memory-identity-grid]')).toBeNull();
    expect(container.querySelector('[data-memory-identity-proof]')).toBeNull();
    // The unlock is legible now: read-marks in proof order plus a count.
    expect(container.textContent).toContain('VERIFY ◆◇◇ 1/3');
    expect(container.querySelector('[data-cell-detail-field="state"] [data-cell-detail-proof-mark="read"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-field="data"] [data-cell-detail-proof-mark="unread"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-field="capacity"] [data-cell-detail-proof-mark]')).toBeNull();

    rerender(
      <CellDetailPanel
        {...props}
        identityProofBinding={identityBinding()}
      />,
    );
    expect((
      getByRole('button', { name: 'recall causal path' }) as HTMLButtonElement
    ).disabled).toBe(false);
    expect(container.textContent).toContain('CAUSAL READY');
    fireEvent.click(getByRole('button', { name: 'recall causal path' }));
    expect(onTraceWrite).toHaveBeenCalledWith(origin.seq);

    rerender(
      <CellDetailPanel
        {...props}
        identityProofBinding={identityBinding('retained')}
      />,
    );
    expect(container.textContent).toContain('CAUSAL RETAINED');
  });

  it('shows SPENT for a consumed cell without biological death language', () => {
    const dead = { ...base, death_at_ms: 5000 };
    const { container } = render(<CellDetailPanel cell={dead} onClose={() => {}} />);
    expect(container.textContent ?? '').toContain('SPENT');
    expect(container.textContent ?? '').not.toContain('DYING');
  });

  it('names the origin transaction, what it cost, and who spent the Cell', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const dead = { ...base, death_at_ms: 5000 };
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={dead}
        recentLinks={[origin]}
        onClose={() => {}}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: dead.out_point,
          source: 'ckbadger',
          as_of: { block: dead.birth_block, hash: '0xanchor' },
          observed_at_block: dead.birth_block,
          updated_at_ms: 1,
          consumed: { tx_hash: `0x${'9e'.repeat(32)}`, block: 16204999 },
          facets: [],
        }}
        semanticTransactionPhase="ready"
        semanticTransactionRecord={{
          tx_hash: base.out_point.tx_hash,
          block: base.birth_block,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          updated_at_ms: 1,
          actions: [],
          participants: [],
          fee: '2680',
          cycles: 1_263_540,
        }}
      />,
    );
    const footer = container.querySelector(
      '[data-cell-provenance-footer]',
    ) as HTMLElement;

    // The row the user could not read is now the row it always was.
    expect(footer.textContent).toContain('ORIGIN TX');
    expect(footer.textContent).not.toContain('CAUSAL LENS');
    expect(footer.querySelector('[data-causal-origin-caption]')?.textContent)
      .toBe('THE TRANSACTION THAT CREATED THIS CELL · 2 IN → 1 OUT');
    // Fee and cycles were fetched and thrown away before this: the panel took
    // the transaction record as a prop and never destructured it.
    expect(footer.querySelector('[data-causal-origin-value="fee"]')?.textContent)
      .toBe('2,680 SHANNONS');
    expect(footer.querySelector('[data-causal-origin-value="cycles"]')?.textContent)
      .toBe('1,263,540');
    expect(footer.querySelector('[data-causal-origin-value="consumed"]')?.textContent)
      .toBe('0x9e9e…9e9e9e9e · #16,204,999');
    expect(footer.textContent)
      .toContain('THE CREATING WRITE THIS SESSION STILL HOLDS IN MEMORY');
    const causal = container.querySelector(
      '[data-consensus-memory-reveal="causal"]',
    ) as HTMLElement;
    expect(causal.getAttribute('data-cell-origin-tx-phase')).toBe('ready');
    expect(causal.getAttribute('data-cell-origin-tx-state')).toBe('resolved');
  });

  it('refuses origin-transaction evidence that names another transaction', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(
      <CellDetailPanel
        cell={base}
        onClose={() => {}}
        semanticTransactionPhase="ready"
        semanticTransactionMessage="transaction detail is still resolving"
        semanticTransactionRecord={{
          tx_hash: `0x${'cd'.repeat(32)}`,
          block: base.birth_block,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          updated_at_ms: 1,
          actions: [],
          participants: [],
          fee: '2680',
          cycles: 1_263_540,
        }}
      />,
    );
    const causal = container.querySelector(
      '[data-consensus-memory-reveal="causal"]',
    ) as HTMLElement;

    // A lookup still answering the PREVIOUS selection would print its fee
    // under this Cell — a false fact, not a slow one.
    expect(causal.getAttribute('data-cell-origin-tx-state')).toBe('mismatch');
    expect(causal.getAttribute('data-cell-origin-tx-note'))
      .toBe('transaction detail is still resolving');
    expect(container.querySelector('[data-causal-origin-facts]')).toBeNull();
    expect(container.textContent).not.toContain('2,680 SHANNONS');
  });

  it('shows retained write evidence only for the exact Cell origin', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel cell={base} recentLinks={[origin]} onClose={() => {}} />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('MEMORY TRACE');
    // The shape of the write, and not the block it landed in: that block is
    // the COMMIT fact in the register above.
    expect(t).toContain('2→1');
    expect(t).not.toContain('#16,204,800 · 2→1');
    expect(container.querySelector('[data-write-observed="true"]')).not.toBeNull();
  });

  it('requests a display-only causal recall and marks the selected trace', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const onTraceWrite = vi.fn();
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container, getByRole } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        tracedWriteSeq={origin.seq}
        traceSource="input"
        traceReadout={traceReadout()}
        identityProofBinding={identityBinding('recalling')}
        onTraceWrite={onTraceWrite}
        semanticSource={{
          source: 'ckbadger',
          status: 'ready',
          capabilities: ['cell_detail'],
          lag_blocks: 0,
        }}
        semanticPhase="ready"
        semanticRecord={{
          out_point: base.out_point,
          source: 'ckbadger',
          as_of: { block: base.birth_block, hash: '0xanchor' },
          observed_at_block: base.birth_block,
          updated_at_ms: 1,
          facets: [],
        }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'exit causal recall' }));
    expect(onTraceWrite).toHaveBeenCalledWith(origin.seq);
    expect(container.querySelector('[data-write-observed="true"]')?.textContent)
      .toContain('READING');
    expect(container.textContent).toContain('SCANNING RETAINED RECORD');
    expect(container.textContent).toContain('EVIDENCE 0/2');
    const trace = container.querySelector('[data-trace-selected="true"]');
    expect(trace).not.toBeNull();
    expect(trace?.getAttribute('data-trace-source')).toBe('input');
    expect(trace?.getAttribute('data-trace-state')).toBe('active');
    expect(trace?.getAttribute('data-trace-stage')).toBe('reading');
    expect(container.querySelector('[data-cell-detail-module="trace"]')).not.toBeNull();
    // The armed trace is the instrument that can be missing (C7). Its module
    // number rides its own leader now, so the panel is found by its head.
    expect(container.querySelector('[data-cell-constellation-panel="trace"]'))
      .not.toBeNull();
    // CKBYTES stands for every Cell that holds a byte — this one holds eleven,
    // so it is here whether or not a trace is armed. Its own instrument, not a
    // row of somebody else's.
    expect(container.querySelector('[data-cell-constellation-panel="reader"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-cell-detail-module="context"]')).toBeNull();
    expect(container.querySelector('[data-memory-read-state="reading"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-memory-evidence]')).toHaveLength(2);
    expect(container.textContent).toContain('EVIDENCE → AGREEMENT');
    expect(container.textContent).toContain('1111111·1111');
    // Nothing to disclose when the routed evidence already IS the inputs.
    expect(container.querySelector('[data-memory-consumed-inputs]')).toBeNull();
  });

  it('appends the armed memory trace below the analysis plate without reshuffling it', () => {
    // Query-aware on purpose: the blanket `matches: true` this file uses to
    // force reduced motion also answers the card's own width query, which
    // would put this test in the narrow composition it is not about. Reduced
    // motion yes, narrow viewport no — the wide, reader-beside card.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: !query.includes('max-width'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
      onClose: () => {},
    };
    const { container, rerender } = render(<CellDetailPanel {...props} />);
    const analysis = () => container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    const restingAnalysisStyle = analysis().style.cssText;
    expect(container.querySelector('[data-cell-detail-module="trace"]')).toBeNull();
    // Nothing on the card is numbered 03 while the trace is away, so the
    // count-off a reader sees runs 01, 02 with no hole in it.
    expect(container.querySelector('[data-cell-constellation-panel="trace"]'))
      .toBeNull();

    rerender(
      <CellDetailPanel
        {...props}
        tracedWriteSeq={origin.seq}
        traceReadout={traceReadout()}
      />,
    );

    const trace = container.querySelector(
      '[data-cell-detail-module="trace"]',
    ) as HTMLElement;
    expect(trace).not.toBeNull();
    // Arming adds an instrument; it does not reshape the ones already standing.
    // The trace used to append a full-width row UNDER the card and grow it
    // downward — now it takes a room of its own, which the walk holds for it.
    expect(container.querySelector('[data-cell-constellation-panel="trace"]'))
      .not.toBeNull();
    expect(Array.from(
      container.querySelectorAll('[data-cell-constellation-panel]'),
      (host) => host.getAttribute('data-cell-constellation-panel'),
    )).toEqual(['analysis', 'specimen', 'reader', 'trace']);
    expect(analysis().style.cssText).toBe(restingAnalysisStyle);
    expect(trace).toBe(trace.parentElement?.lastElementChild);
    // analysis / specimen / CKBYTES / trace — the reader has been there since
    // the card opened, so arming adds exactly one plate.
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(4);
  });

  it('names the CELL SCAN square as the card\'s one transparent window', () => {
    // The braid is painted in the SCENE, under the whole DOM HUD, so this
    // square is a hole and whatever the HUD has behind it prints on the
    // specimen. The overlay finds the box by this attribute; the transparency
    // is what makes finding it necessary.
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );
    const square = container.querySelector(
      '[data-cell-inspection-satellite="specimen"]',
    ) as HTMLElement;

    expect(square.dataset.cellScanWindow).toBe('true');
    expect(square.style.background).toBe('transparent');
    expect(square.style.boxSizing).toBe('border-box');
  });

  // The ladder the card's measure is picked from, in HOLE px — the clear stage
  // the HUD leaves, not the window's own width. 856 of card plus a 42px tether
  // needs 898; 728 plus the same tether needs 770, below which the card gives
  // the difference back to the stage and takes a compact measure — the
  // analysis column shrinking, the 280 square and the 8px seam standing — down
  // to a 640 floor its longest register row (336px) still fits in.
  const READER_UNDER = '"analysis scan" "reader reader"';
  const READER_BESIDE = '"analysis scan ." "analysis reader reader"';







  // The witness-carried case: the ledger lists the carriers, so the inputs the
  // transaction actually spent have to be named somewhere or they vanish.
  it('names the spent inputs no route departs from', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [901, 902],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: ['0xparent'],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        tracedWriteSeq={origin.seq}
        traceSource="witness"
        onTraceWrite={() => {}}
        onClose={() => {}}
        traceReadout={traceReadout({
          sourceKind: 'witness',
          consumedInputs: [
            {
              id: 901,
              contentHash: `0x${'a'.repeat(64)}`,
              posSeed: [1, 2, 3],
              retained: false,
            },
            {
              id: 902,
              contentHash: `0x${'b'.repeat(64)}`,
              posSeed: [4, 5, 6],
              retained: false,
            },
          ],
        })}
      />,
    );
    const disclosure = container.querySelector('[data-memory-consumed-inputs]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.getAttribute('data-memory-consumed-input-count')).toBe('2');
    expect(container.textContent).toContain('SPENT INPUTS');
    expect(container.textContent).toContain('AAAAAAA·AAAA');
    expect(container.textContent).toContain('BBBBBBB·BBBB');
    // The ledger header still describes what carried the route, unchanged.
    expect(container.textContent).toContain('LINEAGE WITNESSES');
  });

  it('advances the explanatory rail through the same convergence stages as the Cell', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
      traceResponseRef: { current: null },
      onTraceWrite: () => {},
      onClose: () => {},
    };
    const { container, rerender } = render(
      <CellDetailPanel {...props} traceReadout={traceReadout()} />,
    );

    rerender(<CellDetailPanel
      {...props}
      traceReadout={traceReadout({
        stage: 'converging',
        consumedInputs: [],
        arrivedSourceCount: 1,
      })}
    />);
    expect(container.textContent).toContain('RECONCILING EVIDENCE');
    expect(container.textContent).toContain('ARRIVED 1/2');
    expect(container.querySelector('[data-write-observed="true"]')?.textContent)
      .toContain('1/2 ARRIVED');
    expect(container.querySelector('[data-memory-stage="reading"]')
      ?.getAttribute('data-memory-stage-state')).toBe('past');
    expect(container.querySelector('[data-memory-stage="converging"]')
      ?.getAttribute('data-memory-stage-state')).toBe('active');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-state')).toBe('arrived');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-state')).toBe('routing');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-knot')).toMatch(/^\d+$/);

    rerender(<CellDetailPanel
      {...props}
      traceReadout={traceReadout({
        stage: 'locked',
        consumedInputs: [],
        arrivedSourceCount: 2,
        resolvedSourceCount: 2,
      })}
    />);
    expect(container.textContent).toContain('CONSENSUS RECORD RESOLVED');
    expect(container.textContent).toContain('VERIFIED 2/2');
    expect(container.querySelector('[data-write-observed="true"]')?.textContent)
      .toContain('2/2 VERIFIED');
    expect(container.querySelector('[data-memory-stage="locked"]')
      ?.getAttribute('data-memory-stage-state')).toBe('active');
    expect(container.querySelector('[data-memory-read-state="locked"]')
      ?.getAttribute('data-memory-resolved')).toBe('2');
    expect(Array.from(container.querySelectorAll('[data-memory-evidence]')).every(
      (node) => node.getAttribute('data-memory-evidence-state') === 'resolved',
    )).toBe(true);
  });

  it('focuses one real evidence source by pointer or keyboard in the spatial ledger', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const onTraceEvidenceFocusChange = vi.fn();
    const onTraceRouteHopFocusChange = vi.fn();
    const onTraceRouteHopLockChange = vi.fn();
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
      traceReadout: traceReadout(),
      onTraceWrite: () => {},
      onTraceEvidenceFocusChange,
      onTraceRouteHopFocusChange,
      onTraceRouteHopLockChange,
      onClose: () => {},
    };
    const { container, rerender } = render(
      <CellDetailPanel {...props} />,
    );
    const first = container.querySelector<HTMLElement>('[data-memory-evidence="1"]')!;
    const second = container.querySelector<HTMLElement>('[data-memory-evidence="2"]')!;

    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('data-memory-evidence-focus')).toBe('idle');
    fireEvent.pointerEnter(first);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);

    rerender(<CellDetailPanel {...props} traceEvidenceFocusSourceId={11} />);
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('passive');
    const proof = container.querySelector('[data-memory-evidence-route-proof="true"]');
    expect(proof?.textContent).toContain('CELL #11 → #4242');
    expect(proof?.textContent).toContain('02 HOPS · 520 MS');
    expect(proof?.textContent).toContain('SOURCE 0x1111…11111111#0 · BLOCK #100');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-route')).toBe('11>99>4242');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-source-outpoint'))
      .toBe(`0x${'1'.repeat(64)}#0`);
    const activeFirst = container.querySelector<HTMLElement>('[data-memory-evidence="1"]')!;
    expect(activeFirst.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(activeFirst);
    expect(activeFirst.getAttribute('aria-expanded')).toBe('true');
    const routeLedger = container.querySelector('[data-memory-evidence-route-ledger="true"]');
    expect(routeLedger?.textContent).toContain('03 CELLS · H02');
    const routeCells = routeLedger?.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(Array.from(routeCells ?? []).map((node) => (
      node.getAttribute('data-memory-evidence-route-cell')
    ))).toEqual(['11', '99', '4242']);
    expect(routeCells?.[0].getAttribute('data-memory-evidence-route-role')).toBe('source');
    expect(routeCells?.[1].getAttribute('data-memory-evidence-route-hop')).toBe('1');
    expect(routeCells?.[2].getAttribute('data-memory-evidence-route-role')).toBe('target');
    expect(routeCells?.[1].tagName).toBe('BUTTON');
    fireEvent.pointerEnter(routeCells![1]);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: 99,
      hopIndex: 1,
    });
    rerender(<CellDetailPanel
      {...props}
      traceEvidenceFocusSourceId={11}
      traceRouteHopFocus={{
        traceKey: `18:${base.id}:1`,
        sourceId: 11,
        targetCellId: base.id,
        cellId: 99,
        hopIndex: 1,
      }}
    />);
    const focusedTransit = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="99"]',
    )!;
    expect(focusedTransit.getAttribute('data-memory-evidence-route-focus')).toBe('preview');
    expect(focusedTransit.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')
      ?.textContent).toContain('H01 · CELL #99');
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.pointerLeave(focusedTransit, { relatedTarget: routeLedger });
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    focusedTransit.focus();
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: 99,
      hopIndex: 1,
    });
    activeFirst.focus();
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.click(routeLedger!);
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')).not.toBeNull();
    fireEvent.keyDown(activeFirst, { key: 'Escape' });
    expect(activeFirst.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')).toBeNull();
    fireEvent.click(activeFirst);
    expect(activeFirst.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(activeFirst);
    expect(activeFirst.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]')).toBeNull();

    fireEvent.pointerLeave(container.querySelector('[data-memory-evidence-wrapper="1"]')!);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.blur(activeFirst);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(null);
    second.focus();
    expect(document.activeElement).toBe(second);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(12);
    fireEvent.pointerEnter(container.querySelector('[data-memory-evidence="1"]')!);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(11);
    fireEvent.pointerLeave(container.querySelector('[data-memory-evidence="1"]')!);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(12);
    fireEvent.blur(second);
    expect(onTraceEvidenceFocusChange).toHaveBeenLastCalledWith(null);
  });

  it('previews a scene agreement in the ledger without replacing the locked evidence route', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1, 2],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const lockedHop = {
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: base.id,
      hopIndex: 2,
    };
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
      traceReadout: traceReadout(),
      traceEvidenceFocusSourceId: 11,
      traceRouteHopLock: lockedHop,
      onTraceEvidenceFocusChange: vi.fn(),
      onTraceRouteHopLockChange: vi.fn(),
      onTraceWrite: () => {},
      onClose: () => {},
    };
    const { container, rerender } = render(
      <CellDetailPanel {...props} traceEvidencePreviewSourceId={12} />,
    );
    const locked = container.querySelector<HTMLElement>(
      '[data-memory-evidence="1"]',
    )!;
    const preview = container.querySelector<HTMLElement>(
      '[data-memory-evidence="2"]',
    )!;

    expect(locked.getAttribute('data-memory-evidence-focus')).toBe('retained');
    expect(locked.getAttribute('aria-pressed')).toBe('true');
    expect(locked.getAttribute('aria-expanded')).toBe('true');
    expect(locked.closest('[data-memory-evidence-wrapper]')?.querySelector(
      '[data-memory-evidence-route-ledger="true"]',
    )).not.toBeNull();
    expect(preview.getAttribute('data-memory-evidence-focus')).toBe('preview');
    expect(preview.getAttribute('data-memory-evidence-scene-preview')).toBe('true');
    expect(preview.getAttribute('aria-pressed')).toBe('false');
    expect(preview.getAttribute('aria-expanded')).toBe('false');
    expect(preview.textContent).toContain('INSPECT');

    rerender(<CellDetailPanel {...props} traceEvidencePreviewSourceId={11} />);
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(container.querySelector('[data-memory-evidence-focus="retained"]'))
      .toBeNull();
    expect(container.querySelector(
      '[data-memory-evidence-scene-preview="true"]',
    )).toBeNull();

    rerender(<CellDetailPanel {...props} traceEvidencePreviewSourceId={null} />);
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('passive');
    expect(container.querySelector(
      '[data-memory-evidence-scene-preview="true"]',
    )).toBeNull();
    expect(container.querySelector('[data-memory-evidence-route-lock="locked"]')
      ?.getAttribute('data-memory-evidence-route-cell')).toBe(String(base.id));
  });

  it('separates route preview from lock and steps a locked inspector by keyboard', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const onTraceRouteHopFocusChange = vi.fn();
    const onTraceRouteHopLockChange = vi.fn();
    const props = {
      cell: base,
      recentLinks: [origin],
      tracedWriteSeq: origin.seq,
      traceSource: 'input' as const,
      identityProofBinding: identityBinding('recalling'),
      traceReadout: traceReadout(),
      traceEvidenceFocusSourceId: 11,
      onTraceEvidenceFocusChange: vi.fn(),
      onTraceRouteHopFocusChange,
      onTraceRouteHopLockChange,
      onTraceWrite: () => {},
      onClose: () => {},
    };
    const transitFocus = {
      traceKey: `18:${base.id}:1`,
      sourceId: 11,
      targetCellId: base.id,
      cellId: 99,
      hopIndex: 1,
    };
    const targetFocus = {
      ...transitFocus,
      cellId: base.id,
      hopIndex: 2,
    };
    const { container, rerender } = render(<CellDetailPanel {...props} />);
    fireEvent.click(container.querySelector('[data-memory-evidence="1"]')!);

    const transit = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="99"]',
    )!;
    fireEvent.pointerEnter(transit);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(transitFocus);
    expect(transit.getAttribute('data-memory-evidence-route-focus')).toBe('idle');
    fireEvent.click(transit);
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(transitFocus);

    rerender(
      <CellDetailPanel
        {...props}
        traceRouteHopFocus={transitFocus}
        traceRouteHopLock={transitFocus}
      />,
    );
    const lockedTransit = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="99"]',
    )!;
    expect(lockedTransit.getAttribute('data-memory-evidence-route-focus')).toBe('locked');
    expect(lockedTransit.getAttribute('aria-pressed')).toBe('true');
    const transitPulseKey = '18:4242:1:11:4242:1:99';
    const transitInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(lockedTransit.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(transitPulseKey);
    expect(transitInspector.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(transitPulseKey);
    expect(lockedTransit.style.animation)
      .toContain(`cknerv-route-hop-lock-pulse ${HUD_MOTION.enter}ms`);
    expect(transitInspector.querySelector<HTMLElement>(
      '[data-memory-evidence-route-pulse-surface="true"]',
    )?.style.animation)
      .toContain(`cknerv-route-hop-lock-pulse ${HUD_MOTION.enter}ms`);
    expect(container.querySelector<HTMLButtonElement>('[data-memory-evidence="2"]')
      ?.disabled).toBe(true);
    expect(container.textContent).toContain('LOCK H01 · CELL #99');
    expect(container.textContent).toContain('←/→ STEP · ESC RELEASE');

    fireEvent.keyDown(lockedTransit, { key: 'ArrowRight' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(targetFocus);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(targetFocus);
    expect(document.activeElement).toBe(container.querySelector(
      `[data-memory-evidence-route-cell="${base.id}"]`,
    ));

    rerender(
      <CellDetailPanel
        {...props}
        traceRouteHopFocus={targetFocus}
        traceRouteHopLock={targetFocus}
      />,
    );
    const lockedTarget = container.querySelector<HTMLElement>(
      `[data-memory-evidence-route-cell="${base.id}"]`,
    )!;
    const targetInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(lockedTarget.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe('18:4242:1:11:4242:2:4242');
    expect(targetInspector.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(lockedTarget.getAttribute('data-memory-evidence-route-pulse-key'));
    fireEvent.keyDown(lockedTarget, { key: 'Escape' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith(null);
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('[data-memory-evidence-route-ledger="true"]'))
      .not.toBeNull();

    const alternateTargetFocus = {
      ...targetFocus,
      sourceId: 12,
    };
    rerender(
      <CellDetailPanel
        {...props}
        traceEvidenceFocusSourceId={12}
        traceRouteHopFocus={alternateTargetFocus}
        traceRouteHopLock={alternateTargetFocus}
      />,
    );
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(container.querySelectorAll(
      '[data-memory-evidence-route-cell]',
    )).map((node) => node.getAttribute('data-memory-evidence-route-cell')))
      .toEqual(['12', '99', String(base.id)]);
  });

  it('keeps every retained hop inspectable inside a bounded route ledger', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 18,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const route = Array.from({ length: 41 }, (_, index) => (
      index === 0 ? 11 : index === 40 ? base.id : 1_000 + index
    ));
    const baseline = traceReadout({ sourceCount: 1 });
    const readout = traceReadout({
      sourceCount: 1,
      evidence: [{
        ...baseline.evidence[0],
        route,
        hopCount: 40,
        routeDurationMs: 10_000,
      }],
    });
    const transitRecord: Cell = {
      ...base,
      id: route[20],
      birth_block: 16_200_020,
      death_at_ms: 24_000,
      out_point: { tx_hash: `0x${'55'.repeat(32)}`, index: 1 },
      content_hash: `0x${'55'.repeat(32)}`,
    };
    const onTraceRouteHopFocusChange = vi.fn();
    const onTraceRouteHopLockChange = vi.fn();
    const routeCellById = new Map([[transitRecord.id, transitRecord]]);
    const panel = (lockedFocus: {
      traceKey: string;
      sourceId: number;
      targetCellId: number;
      cellId: number;
      hopIndex: number;
    } | null = null, records: ReadonlyMap<number, Cell> = routeCellById) => (
      <CellDetailPanel
        cell={base}
        routeCellById={records}
        recentLinks={[origin]}
        tracedWriteSeq={origin.seq}
        traceSource="input"
        identityProofBinding={identityBinding('recalling')}
        traceReadout={readout}
        traceEvidenceFocusSourceId={11}
        traceRouteHopFocus={lockedFocus}
        traceRouteHopLock={lockedFocus}
        onTraceEvidenceFocusChange={() => {}}
        onTraceRouteHopFocusChange={onTraceRouteHopFocusChange}
        onTraceRouteHopLockChange={onTraceRouteHopLockChange}
        onTraceWrite={() => {}}
        onClose={() => {}}
      />
    );
    const { container, rerender } = render(panel());

    fireEvent.click(container.querySelector('[data-memory-evidence="1"]')!);
    const ledger = container.querySelector('[data-memory-evidence-route-ledger="true"]');
    const ledgerViewport = ledger?.querySelector<HTMLElement>(
      '[data-memory-evidence-route-scroll-viewport="true"]',
    );
    const ledgerScroll = ledger?.querySelector<HTMLElement>(
      '[data-memory-evidence-route-scroll="true"]',
    );
    const cells = ledger?.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(ledger?.textContent).toContain('41 CELLS · H40');
    expect((ledger as HTMLElement).style.display).toBe('flex');
    expect(ledgerScroll?.classList.contains(
      'cknerv-memory-route-ledger-scroll',
    )).toBe(true);
    expect(ledgerViewport?.classList.contains(
      'cknerv-memory-route-ledger-viewport',
    )).toBe(true);
    expect(ledgerViewport?.querySelector(
      '[data-memory-evidence-route-scroll-position="true"]',
    )).not.toBeNull();
    expect(ledgerScroll?.contains(cells?.[0] ?? null)).toBe(true);
    expect(cells).toHaveLength(41);
    expect(cells?.[0].getAttribute('data-memory-evidence-route-cell')).toBe('11');
    expect(cells?.[40].getAttribute('data-memory-evidence-route-cell')).toBe(String(base.id));
    expect((ledger?.querySelector('[data-memory-evidence-route-cells="true"]') as HTMLElement)
      .style.maxHeight).toBe('48px');

    const lockedFocus = {
      traceKey: readout.key,
      sourceId: 11,
      targetCellId: base.id,
      cellId: route[20],
      hopIndex: 20,
    };
    rerender(panel(lockedFocus));
    const lens = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-mode="lens"]',
    )!;
    const lensCells = lens.querySelectorAll('[data-memory-evidence-route-cell]');
    expect(lens.getAttribute('data-memory-evidence-route-window-start')).toBe('18');
    expect(lens.getAttribute('data-memory-evidence-route-window-end')).toBe('22');
    expect(lens.getAttribute('data-memory-evidence-route-hidden-before')).toBe('18');
    expect(lens.getAttribute('data-memory-evidence-route-hidden-after')).toBe('18');
    expect(Array.from(lensCells).map((node) => (
      node.getAttribute('data-memory-evidence-route-hop')
    ))).toEqual(['18', '19', '20', '21', '22']);
    expect(lens.textContent).toContain('18 PRIOR');
    expect(lens.textContent).toContain('18 NEXT');
    const progress = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-progress="true"]',
    )!;
    expect(progress.getAttribute('aria-valuenow')).toBe('20');
    expect(progress.getAttribute('aria-valuemax')).toBe('40');
    expect(progress.getAttribute('data-memory-evidence-route-progress-value'))
      .toBe('0.5000');
    expect(progress.querySelector<HTMLElement>(
      '[data-memory-evidence-route-progress-marker="true"]',
    )?.style.left).toBe('50%');
    const inspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    const lockedLensCell = lens.querySelector<HTMLElement>(
      '[data-memory-evidence-route-lock="locked"]',
    )!;
    expect(ledgerScroll?.contains(inspector)).toBe(true);
    expect(lockedLensCell.getAttribute('data-memory-evidence-route-pulse-key'))
      .toBe(inspector.getAttribute('data-memory-evidence-route-pulse-key'));
    expect(lockedLensCell.style.animation).toBe('');
    expect(inspector.querySelector<HTMLElement>(
      '[data-memory-evidence-route-pulse-surface="true"]',
    )?.style.animation).toBe('');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-role'))
      .toBe('transit');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-semantic'))
      .toBe('display-carrier');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('available');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-content-hash'))
      .toBe(transitRecord.content_hash);
    expect(inspector.getAttribute('data-memory-evidence-route-hop-distance-source'))
      .toBe('20');
    expect(inspector.getAttribute('data-memory-evidence-route-hop-distance-target'))
      .toBe('20');
    expect(inspector.textContent).toContain('DISPLAY CARRIER');
    expect(inspector.textContent).toContain('VISUAL LANE · NO CAUSAL CLAIM');
    expect(inspector.textContent).toContain('5555555·5555');
    expect(inspector.textContent).toContain('BLOCK #16,200,020 · SPENT');

    Object.defineProperties(ledgerScroll!, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 147 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperties(inspector, {
      offsetTop: { configurable: true, value: 70 },
      offsetHeight: { configurable: true, value: 62 },
    });
    fireEvent.scroll(ledgerScroll!);
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scrollable',
    )).toBe('true');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-before',
    )).toBe('false');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-after',
    )).toBe('true');
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('0.00%');

    fireEvent.resize(window);
    expect(ledgerScroll?.scrollTop).toBe(65);
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('86.67%');

    ledgerScroll!.scrollTop = 37.5;
    fireEvent.scroll(ledgerScroll!);
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-before',
    )).toBe('true');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-after',
    )).toBe('true');
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('50.00%');

    ledgerScroll!.scrollTop = 75;
    fireEvent.scroll(ledgerScroll!);
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-before',
    )).toBe('true');
    expect(ledgerViewport?.getAttribute(
      'data-memory-evidence-route-scroll-after',
    )).toBe('false');
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('100.00%');

    fireEvent.keyDown(lens.querySelector(
      '[data-memory-evidence-route-hop="20"]',
    )!, { key: 'ArrowRight' });
    expect(onTraceRouteHopLockChange).toHaveBeenLastCalledWith({
      ...lockedFocus,
      cellId: route[21],
      hopIndex: 21,
    });
    expect(onTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      ...lockedFocus,
      cellId: route[21],
      hopIndex: 21,
    });

    ledgerScroll!.scrollTop = 0;
    const steppedFocus = {
      ...lockedFocus,
      cellId: route[21],
      hopIndex: 21,
    };
    rerender(panel(steppedFocus));
    expect(ledgerScroll?.scrollTop).toBe(65);
    expect(ledgerViewport?.style.getPropertyValue(
      '--route-ledger-scroll-progress',
    )).toBe('86.67%');

    const sourceFocus = {
      ...lockedFocus,
      cellId: route[0],
      hopIndex: 0,
    };
    rerender(panel(sourceFocus));
    const sourceInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(sourceInspector.getAttribute('data-memory-evidence-route-hop-role'))
      .toBe('source');
    expect(sourceInspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('evidence-only');
    expect(sourceInspector.textContent).toContain('EVIDENCE SOURCE');
    expect(sourceInspector.textContent).toContain('REAL RETAINED EVIDENCE');

    const targetFocus = {
      ...lockedFocus,
      cellId: route[40],
      hopIndex: 40,
    };
    rerender(panel(targetFocus));
    const targetInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(targetInspector.getAttribute('data-memory-evidence-route-hop-role'))
      .toBe('target');
    expect(targetInspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('available');
    expect(targetInspector.textContent).toContain('MAINTAINED RECORD');
    expect(targetInspector.textContent).toContain('REAL TARGET RECORD');
    expect(targetInspector.textContent).toContain('BLOCK #16,204,800 · LIVE');

    rerender(panel(lockedFocus, new Map()));
    const missingInspector = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )!;
    expect(missingInspector.getAttribute('data-memory-evidence-route-hop-record'))
      .toBe('unavailable');
    expect(missingInspector.textContent).toContain('UNAVAILABLE');
    expect(missingInspector.textContent).toContain('OUT OF VIEW');
  });

  it('labels surviving parent evidence as a lineage witness, not an input', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const origin: CellLink = {
      seq: 19,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [1],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: ['0xparent'],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        traceSource="witness"
        identityProofBinding={identityBinding()}
        onTraceWrite={() => {}}
        onClose={() => {}}
      />,
    );

    expect(container.textContent).toContain('WITNESS READY');
    expect(container.querySelector('[data-trace-source="witness"]')).not.toBeNull();
  });

  it('labels missing lock/asset taxonomy as unknown', () => {
    const bare = {
      ...base,
      lock_kind: undefined,
      asset_kind: undefined,
      lock_script: undefined,
    };
    const { container } = render(<CellDetailPanel cell={bare} onClose={() => {}} />);
    expect(container.querySelector('[data-cell-detail-field="asset"]')
      ?.textContent).toBe('ASSETUNKNOWN');
    expect(container.querySelector('[data-cell-detail-field="lock"]')
      ?.textContent).toBe('LOCKUNKNOWN');
    // A Cell restored from pre-identity state carries no script identity at
    // all — no CODE row invents one for it.
    expect(container.querySelector('[data-cell-evidence-row="lock-code"]')).toBeNull();
  });

  it('closes one instrument without dismissing the Cell', () => {
    const onClose = vi.fn();
    const { container, getAllByRole, rerender } = render(
      <CellDetailPanel cell={base} onClose={onClose} />,
    );
    // Every instrument carries its own ✕ (2026-09-10), so this surface no
    // longer has exactly one — the register's is the first, and the chip's,
    // which dismisses the whole constellation, lives out on the layer.
    fireEvent.click(getAllByRole('button', { name: 'close' })[0]);
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[data-cell-constellation-panel="analysis"]')).toBeNull();
    expect(container.querySelector('[data-cell-constellation-panel="specimen"]')).not.toBeNull();

    const other = { ...base, id: base.id + 1 };
    rerender(<CellDetailPanel cell={other} onClose={onClose} />);
    expect(container.querySelector('[data-cell-constellation-panel="analysis"]')).not.toBeNull();
    rerender(<CellDetailPanel cell={base} onClose={onClose} />);
    expect(container.querySelector('[data-cell-constellation-panel="analysis"]')).not.toBeNull();
  });
});

// ——— "Says it once" ————————————————————————————————————————————————————————
//
// The declutter rounds cleaned the REGISTER and the clusters under it grew the
// same facts back. Live, at `25c7d5a`, one xUDT card printed `1000 RGB++`
// twice, its identity line twice, the raw u128 three times, `16 B` four times
// and its birth block twice; a DAO deposit printed that block five times.
//
// So this is an oracle over the CARD'S OWN TEXT, driven by the record it is
// rendered from rather than by a regex over the rendering: take each fact the
// fixture states, ask how many times the card prints it, and hold every one at
// most once. A fact stated twice is not a style question a guard test could
// derive from a token — it is the same sentence in two places, and only the
// data behind the card knows which sentences those are.
//
// THE FOUR CLASSES are the ruling's own (D-6, D-19 and report B-5/B-6): an
// ASSET AMOUNT, a HASH, a BLOCK REFERENCE and the STATE WORD. Deliberately not
// a byte count: `16 B` on the DATA fact, the CKBYTE legend, a segment row and
// the reader's foot line are four MEASURES of four different subjects (the
// output data, the capacity it occupies, one field's width, the payload the
// reader holds), and collapsing them would be a rule that fires on four
// correct rows. That is an argued exclusion of a class, not a list of sites.
//
// ⚠️ THE OUTPOINT AND THE CREATING TRANSACTION are counted as TWO facts, and
// they are the same 32 bytes on every card by construction. The masthead
// states an ADDRESS — where this Cell lives, hash AND index — and ORIGIN TX
// states a TRANSACTION. Round 3 made them share one truncation grammar
// (`formatTxHash`) precisely so a reader can SEE that they agree; before it
// they were `0x2f4e…70391cb4` and `0x2f4e53fb…391cb4`, which reads as two
// hashes. Two spellings of one hash was the defect; one spelling of two facts
// is the fix.
describe('the cell card says each thing once', () => {
  /** Non-overlapping occurrences of `needle` in `haystack`. */
  function occurrences(haystack: string, needle: string): number {
    if (needle === '') return 0;
    let count = 0;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
      count += 1;
      at = haystack.indexOf(needle, at + needle.length);
    }
    return count;
  }

  /** …and the same, for a hash that must not be counted where an outpoint's
   *  `#index` follows it. */
  function bareOccurrences(haystack: string, needle: string): number {
    let count = 0;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
      if (haystack[at + needle.length] !== '#') count += 1;
      at = haystack.indexOf(needle, at + needle.length);
    }
    return count;
  }

  const XUDT_CELL: Cell = {
    ...base,
    id: 5988616705329919,
    birth_block: 12682018,
    data_hex: '0x00e87648170000000000000000000000',
    data_bytes: 16,
    lock_kind: 'other',
    asset_kind: 'xudt',
    capacity: 14400000000,
  };

  /** The live xUDT card of report B: RGB++ over JoyID, a 16-byte payload the
   *  index decodes as one u128 amount. */
  const XUDT_RECORD: CellSemanticRecord = {
    out_point: XUDT_CELL.out_point,
    source: 'ckbadger',
    as_of: { block: 20358682, hash: '0xanchor' },
    observed_at_block: XUDT_CELL.birth_block,
    updated_at_ms: 1,
    address: 'ckb1qrgqep8saj8agswr30pls73hra28ry8jlnlc3ejzh3dl2ju7xxpjxq',
    asset: {
      type_script_hash: `0x${'b5'.repeat(32)}`,
      symbol: 'RGB++',
      name: 'RGB++ Protocol',
      standard: 'xudt',
      amount: '100000000000',
      decimals: 8,
    },
    lock_script: {
      script_hash: `0x${'af'.repeat(32)}`,
      code_hash: `0x${'d0'.repeat(32)}`,
      hash_type: 'type',
      args: '0x00012b34a82d1817ae90ddbcd89e0bdb73d181fb9519',
      name: 'JoyID',
      family: 'lock',
      deprecated: false,
    },
    type_script: {
      script_hash: `0x${'b5'.repeat(32)}`,
      code_hash: `0x${'50'.repeat(32)}`,
      hash_type: 'data1',
      args: `0x${'08'.repeat(32)}`,
      name: 'xUDT',
      family: 'udt',
      deprecated: false,
    },
    common_knowledge: {
      total_bytes: 144,
      capacity_field_bytes: 8,
      lock_script_bytes: 55,
      type_script_bytes: 65,
      data_bytes: 16,
    },
    content: {
      total_bytes: 16,
      data_hex: XUDT_CELL.data_hex,
      data_complete: true,
      deterministic: {
        kind: 'udt_amount',
        summary: 'XUDT cell data starts with amount=100000000000 (u128 LE)',
        segments: [{
          label: 'amount',
          start_byte: 0,
          end_byte: 16,
          meaning: 'XUDT amount in little-endian u128',
          value: '100000000000',
        }],
      },
      heuristics: [{
        kind: 'numeric_pattern',
        confidence: 'medium',
        reason: 'Payload length is exactly 16 bytes (common u128 LE encoding)',
        value: '100000000000',
      }],
    },
    facets: [],
  };

  /** A DAO deposit: the case that printed its block five times. */
  const DAO_RECORD: CellSemanticRecord = {
    out_point: base.out_point,
    source: 'ckbadger',
    as_of: { block: 20358682, hash: '0xanchor' },
    observed_at_block: base.birth_block,
    updated_at_ms: 1,
    address: 'ckt1qyqdaodepositor00000000000000',
    cell_type: 'dao',
    lock_script: {
      script_hash: `0x${'11'.repeat(32)}`,
      code_hash: `0x${'22'.repeat(32)}`,
      hash_type: 'type',
      args: '0xdead',
      name: 'Secp256k1 Blake160',
      family: 'lock',
      deprecated: false,
    },
    type_script: {
      script_hash: `0x${'33'.repeat(32)}`,
      code_hash: `0x${'44'.repeat(32)}`,
      hash_type: 'type',
      args: '0x',
      name: 'Nervos DAO',
      family: 'dao',
      deprecated: false,
    },
    facets: [{
      namespace: 'ckb',
      kind: 'dao',
      state: 'deposit',
      attributes: [
        { key: 'deposit_block', value: String(base.birth_block), unit: 'block' },
        { key: 'deposit_at_ms', value: '1755238020000', unit: 'ms' },
        { key: 'estimated_apc', value: '2.01%' },
      ],
    }],
  };

  const SOURCE_READY: EnrichmentSourceStatus = {
    source: 'ckbadger',
    status: 'ready',
    capabilities: ['cell_detail'],
    lag_blocks: 0,
  };

  /** Every fact the card is about to be handed, and how it will be spelled. */
  function factsOf(cell: Cell, record: CellSemanticRecord) {
    const amount = record.asset
      ? `${formatSemanticAssetAmount(record.asset.amount ?? '0', record.asset.decimals)}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`
      : null;
    return [
      { what: 'the block the Cell was committed in', text: formatBlockRef(cell.birth_block), bare: false },
      { what: "the Cell's outpoint", text: formatOutpoint(cell.out_point.tx_hash, cell.out_point.index), bare: false },
      { what: 'the creating transaction', text: formatTxHash(cell.out_point.tx_hash), bare: true },
      { what: 'the state word', text: cell.death_at_ms === null ? 'LIVE' : 'SPENT', bare: false },
      ...(record.asset?.amount ? [{ what: 'the raw asset amount', text: record.asset.amount, bare: false }] : []),
      ...(amount ? [{ what: 'the decoded asset amount', text: amount, bare: false }] : []),
      ...(record.asset?.name ? [{ what: "the asset's name", text: record.asset.name, bare: false }] : []),
      ...(record.address ? [{ what: "the owner's address", text: midTruncate(record.address, 14, 12), bare: false }] : []),
    ];
  }

  function cardText(cell: Cell, record: CellSemanticRecord): string {
    const { container } = render(
      <CellDetailPanel
        cell={cell}
        recentLinks={[{
          seq: 7,
          tx_hash: cell.out_point.tx_hash,
          block: cell.birth_block,
          from_ids: [],
          to_ids: [cell.id],
          endpoint_anchors: [],
          parents: [],
          tag: cell.tag,
          at_ms: 12_000,
        }]}
        semanticSource={SOURCE_READY}
        semanticPhase="ready"
        semanticRecord={record}
        onClose={() => {}}
      />,
    );
    return container.textContent ?? '';
  }


  it('keeps the indexer\'s own sentences off the card', () => {
    // The three explainers the user's D-19 ruling moved to `title`. ORIGIN TX's
    // caption is the one that stays, because it names a relationship a reader
    // cannot deduce from the row; these three name conventions.
    const text = cardText(XUDT_CELL, XUDT_RECORD);

    expect(text).not.toContain('XUDT cell data starts with');
    expect(text).not.toContain('ADDRESS ENCODED FROM THE LOCK SCRIPT');
    expect(text).not.toContain('EVERY INDEXED FACT ABOVE IS AS OF THIS BLOCK');
    expect(text).toContain('THE TRANSACTION THAT CREATED THIS CELL');
    // …and the chip that said nothing on nearly every card.
    expect(text).not.toContain('ACTIVE');
    // …and the guess that sat beside a settled decode restating its number.
    expect(text).not.toContain('MEDIUM');
  });
});

// ——— The interactive layer is visible ————————————————————————————————————
//
// Six of these facts are the card's whole interaction surface: they tint the
// tether, re-weight the braid, open the knowledge ring and read the three
// identity proofs. They looked like readouts — a rail at .34, a dim label, a
// value, and `crosshair` as the only thing that answered a pointer at all
// (report E, E-12).
describe('the register says it is pressable', () => {
  it('wears the rail rule and one cursor', () => {
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const facts = Array.from(
      container.querySelectorAll('[data-cell-detail-field]'),
    ) as HTMLButtonElement[];

    expect(facts).toHaveLength(6);
    for (const fact of facts) {
      expect(fact.dataset.hudFactRail).toBe('true');
      // …and its rail is the shared rung, not a second 0.34 typed here.
      expect(fact.style.borderLeft)
        .toContain(String(PLATE_ROW_RAIL_ALPHA));
      expect(fact.querySelector('[data-hud-fact-label]')).not.toBeNull();
    }
    // Interactive only once the walk classifies; before that it is not a
    // control and says so.
    expect(facts[0].style.cursor).toBe('default');
    expect(facts[0].disabled).toBe(true);
  });

  it('lights the rail under a pointer and under a keyboard', () => {
    // The whole of E-12's complaint, in one assertion: before this, hovering a
    // fact changed exactly nothing on the screen.
    // Reduced motion hands the card over already classified, which is the
    // deterministic way to reach a fact that is a control.
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const lock = container
      .querySelector('[data-cell-detail-field="lock"]') as HTMLButtonElement;
    const label = lock.querySelector('[data-hud-fact-label]') as HTMLElement;
    expect(lock.disabled).toBe(false);

    // jsdom normalises a hex to `rgb(...)`, so the inks are compared through
    // the same normalisation rather than against the token's spelling.
    const asRendered = (hex: string): string => {
      const probe = document.createElement('span');
      probe.style.color = hex;
      return probe.style.color;
    };
    const rest = { rail: lock.style.borderLeft, wash: lock.style.background, ink: label.style.color };
    expect(rest.wash).toBe('transparent');
    expect(rest.ink).toBe(asRendered(HUD_COLORS.dim));

    fireEvent.pointerEnter(lock);
    expect(lock.dataset.hudFactRail).toBe('hot');
    expect(lock.style.borderLeft).not.toBe(rest.rail);
    expect(lock.style.background).not.toBe('transparent');
    expect(label.style.color).toBe(asRendered(HUD_COLORS.ink));

    fireEvent.pointerLeave(lock);
    expect(lock.style.borderLeft).toBe(rest.rail);
    expect(lock.style.background).toBe(rest.wash);
    expect(label.style.color).toBe(rest.ink);

    // …and a keyboard reaches the same state, because it is the same question.
    fireEvent.focus(lock);
    expect(lock.dataset.hudFactRail).toBe('hot');
    fireEvent.blur(lock);
    expect(lock.dataset.hudFactRail).toBe('true');
  });

  it('states the unmet condition on the disabled MEMORY TRACE', () => {
    // The arming ritual used to be explained by a `title` on a DISABLED
    // element — which most browsers will not show — while the caption under it
    // invited a click the control would refuse. A caption on a disabled
    // control has one job: name what is missing.
    const origin: CellLink = {
      seq: 21,
      tx_hash: base.out_point.tx_hash,
      block: base.birth_block,
      from_ids: [11],
      to_ids: [base.id],
      endpoint_anchors: [],
      parents: [],
      tag: base.tag,
      at_ms: 12_000,
    };
    const { container } = render(
      <CellDetailPanel
        cell={base}
        recentLinks={[origin]}
        onTraceWrite={() => {}}
        onClose={() => {}}
      />,
    );
    const trace = container.querySelector('[data-trace-available="true"]') as HTMLButtonElement;

    expect(trace.disabled).toBe(true);
    expect(trace.textContent).toContain('READ WHERE · WHAT · WHEN ABOVE TO ARM');
    expect(trace.textContent).not.toContain('SELECT TO REPLAY ITS INPUTS');
    // …and the instruction is no longer hidden in a tooltip nobody can reach.
    expect(trace.getAttribute('title')).toBe(origin.tx_hash);
  });
});
