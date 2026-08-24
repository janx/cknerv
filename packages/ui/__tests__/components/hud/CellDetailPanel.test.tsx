import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
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
import { CELL_CONTENT_ANALYSIS_RESERVED_PX } from '../../../src/components/hud/CellContentMemory';

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
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
    expect(container.textContent).toContain('AGE 3h 0m');
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

  it('renders one CKBYTES ANALYSIS column beside the specimen square', () => {
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL');
    expect(t).not.toContain('共识细胞');   // Cell detail titles stay English-only
    // The header names the OUTPOINT — a viewer can look that up anywhere.
    // The old content-hash head beside an output index only looked like one.
    expect(t).toContain('0xabab…abababab#2');
    expect(t).not.toContain('11111111:2');
    expect(container.querySelector('[data-cell-detail-scan-field] span[title]')
      ?.getAttribute('title')).toBe(base.out_point.tx_hash);
    expect(t).toContain('OMNI Lock');       // LOCK
    expect(t).toContain('xUDT');           // ASSET
    expect(t).toContain('123 CKB');     // CAPACITY
    expect(t).toContain('LIVE');           // STATE
    // born_at_ms 0 is the composition-backfill sentinel — with no real birth
    // timestamp the masthead states the live flag and stops. The birth block
    // it used to fall back to is the COMMIT fact below, and one plate must
    // not print the same anchor twice.
    expect(t).not.toContain('SINCE #');
    // The masthead's liveness reading, which used to be asked as the string
    // `● LIVE`. The bullet was in no face `src/fonts` ships; it is a lit
    // `StatusLamp` now, and `LIVE` alone is not an oracle here — the STATE
    // register three rows down prints the same word. So the mark answers.
    expect(container.querySelector('[data-cell-scan-identity] [data-status-lamp]')
      ?.getAttribute('data-status-lamp')).toBe('lit');
    expect(t).toContain('#16,204,800');    // COMMIT / block anchor (grouped)
    expect(t).toContain('11 B');           // DATA — 22 hex chars = 11 bytes
    expect(t).not.toContain('ƒ');          // portrait frequencies stay visual-only
    expect(t).not.toContain('paths');      // portrait strands stay visual-only
    expect(t).not.toContain('knots');      // portrait joins stay visual-only
    expect(container.querySelector('[data-cell-detail-field="capacity"]')
      ?.textContent).toBe('CAPACITY123 CKB');
    // ONE window, and the Cell it is about is its masthead: the standalone
    // identity plate is gone and the plate's own name went with it, because a
    // dossier titled after its subject needs no second heading.
    expect(t).toContain('CELL // #4242');
    expect(t).toContain('细胞');
    expect(t).not.toContain('CKBYTES ANALYSIS');
    expect(t).not.toContain('CELL IDENTITY');
    expect(t).not.toContain('CONSENSUS MEMORY');
    // Plate count-off: the dossier is SCAN·01; SCAN·02 belongs to the MEMORY
    // TRACE window and only joins once a recall arms it.
    expect(t).toContain('SCAN·01');
    expect(t).not.toContain('SCAN·02');
    expect(t).not.toContain('SCAN·03');
    expect(t).not.toContain('CELL CONTENT');
    expect(t).toContain('DIRECT NODE · RAW');
    expect(t).toContain('DEADBEEFCAFE1234567890');
    expect(t).not.toContain('WRITE OBSERVED');
    expect(t).not.toContain('MEMORY TRACE');   // no observed origin write
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.animation).toContain('cknerv-cell-consensus-enter');
    expect(container.querySelector('[data-cell-detail-scan-field="true"]')).not.toBeNull();
    // The specimen square is an independent column on the anchor side, top
    // aligned — the scene shows through beneath it and nothing overlays it.
    const portrait = container.querySelector('[data-cell-portrait-frame]') as HTMLElement;
    expect(portrait).not.toBeNull();
    expect(portrait.style.gridArea).toBe('scan');
    expect(portrait.style.alignSelf).toBe('start');
    expect(portrait.style.width).toBe('280px');
    expect(portrait.style.justifySelf).toBe('');
    // 728 = 440 analysis column + 8 seam + 280 scan column — one geometry for
    // every fan side and for bare and enriched Cells alike. No header row:
    // the dossier plate carries the masthead itself.
    expect(root.style.width).toBe('728px');
    expect(root.style.gridTemplateColumns).toBe('minmax(0, 1fr) 280px');
    expect(root.style.gridTemplateAreas).toBe('"analysis scan"');
    expect(root.style.columnGap).toBe('8px');
    expect(root.style.rowGap).toBe('8px');
    expect(container.querySelector('[data-testid="cell-nucleus-portrait"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-specimen-scan-light]')).not.toBeNull();
    const specimenScan = container.querySelector(
      '[data-cell-specimen-scan-light]',
    ) as HTMLElement;
    expect(specimenScan.style.top).toBe('9%');
    expect(specimenScan.style.height).toBe('82%');
    expect(specimenScan.style.willChange).toContain('transform');
    // Ambient loop, not a one-shot tied to the probe walk.
    expect(specimenScan.style.animation).toContain(
      'cknerv-cell-specimen-sweep 2.8s linear infinite',
    );
    const cellularBeam = container.querySelector(
      '[data-cellular-scan-beam]',
    ) as HTMLElement;
    expect(cellularBeam.style.left).toBe('0px');
    expect(cellularBeam.style.transform).toContain('translate3d(');
    expect(cellularBeam.style.transition).toContain('transform 80ms linear');
    expect(cellularBeam.style.transition).not.toContain('left 80ms linear');
    expect(container.querySelector('[aria-label="Interactive Cell scan"]')).not.toBeNull();
    // analysis / specimen — the trace satellite appends later. The identity
    // satellite is gone: it lives inside the analysis plate now.
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(2);
    expect(container.querySelector('[data-cell-inspection-satellite="identity"]'))
      .toBeNull();
    // The masthead leads the card: title, then close, then the scan square.
    expect((container.firstElementChild as HTMLElement).firstElementChild
      ?.getAttribute('data-cell-inspection-satellite')).toBe('analysis');
    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    expect(analysis.getAttribute('data-cell-detail-module')).toBe('ckbytes');
    expect(analysis.contains(cellularBeam)).toBe(true);
    // No notch and no clip-path override: the plate is a plain rectangle
    // wearing spatialPlate()'s stock 12px cut corner. It cannot paint behind
    // the transparent specimen viewport (the braid lives there) because it is
    // the square's sibling column, not a plate wrapped around it.
    expect(analysis.style.clipPath).toBe('polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)');
    expect(analysis.contains(portrait)).toBe(false);
    expect(analysis.style.gridArea).toBe('analysis');
    // One vertical stack in house padding: plate header, register clusters,
    // bytes zone, provenance footer.
    expect(analysis.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(analysis.style.gridTemplateAreas).toBe('');
    expect(analysis.style.gridTemplateRows).toBe('');
    expect(analysis.style.padding).toBe('9px 12px 10px 14px');
    expect(analysis.style.rowGap).toBe('8px');
    // Identity-proof binding attributes live on the merged section now.
    expect(analysis.getAttribute('data-memory-identity-binding')).toBe('true');
    expect(analysis.getAttribute('data-memory-identity-phase')).toBe('collecting');
    expect(analysis.getAttribute('data-memory-identity-count')).toBe('0');
    expect(analysis.getAttribute('data-memory-identity-complete')).toBe('false');
    // Retired vocabulary is gone.
    expect(container.querySelector('[data-cell-detail-module="anatomy"]')).toBeNull();
    expect(container.querySelector('[data-cell-detail-module="lineage"]')).toBeNull();
    expect(container.querySelector('[data-cell-scan-shard]')).toBeNull();
    expect(container.querySelector('[data-consensus-memory]')).toBeNull();
    expect(container.querySelector('[data-consensus-memory-identity-grid]')).toBeNull();
    expect(container.querySelector('[data-cell-detail-readable-scale]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(t).toContain('CELL SCAN');
    expect(t).toContain('DRAG TO ORBIT');
    // The lattice count is tracked, never printed: a green `LOCKED · A-LATTICE
    // 6/6` under the live flag was UI telemetry in a chain fact's colour, and
    // permanent decoration once the walk it reported on had finished.
    expect(t).not.toContain('A-LATTICE');
    expect(container.querySelector<HTMLElement>('[data-cell-identity-scan-status="true"]')
      ?.dataset.cellScanLattice).toBe('0/6');
    // Bare mode — ~98% of clicks — still gets real evidence: the Cell's own
    // account of which script guards it, with no index in the picture.
    const lockCode = container.querySelector(
      '[data-cell-evidence-row="lock-code"]',
    ) as HTMLElement;
    expect(lockCode).not.toBeNull();
    expect(lockCode.textContent).toBe('CODE0x7c7c7c7c7c…c7c7c7c7c · TYPE');
    expect(container.querySelector('[data-cell-evidence-value="lock-code"]')
      ?.getAttribute('title')).toBe(base.lock_script?.code_hash);
    expect(lockCode.style.borderLeft).toContain('157, 123, 216, 0.34');
    // Nothing the index would have said, and no lifecycle chip to say it with.
    expect(container.querySelector('[data-cell-evidence-row="owner"]')).toBeNull();
    expect(container.querySelector('[data-cell-evidence-row="lock-script"]')).toBeNull();
    expect(container.querySelector('[data-cell-script-state]')).toBeNull();
    // A plain Cell carries no type script, so the ASSET cluster has no CODE.
    expect(container.querySelector('[data-cell-evidence-row="type-code"]')).toBeNull();
    // born_at_ms 0 is the backfill sentinel — no wall clock is honest here.
    expect(container.querySelector('[data-cell-evidence-row="born"]')).toBeNull();
    // No source configured: nothing is expected, so nothing is reserved.
    expect(container.querySelector('[data-cell-evidence-ghost]')).toBeNull();
    expect((container.querySelector('[data-cell-evidence-slot="lock"]') as HTMLElement)
      .style.minHeight).toBe('');
    // Bare mode: no byte budget without a validated knowledge breakdown.
    expect(container.querySelector('[data-cell-byte-budget]')).toBeNull();
    // The bytes zone still carries the direct content memory.
    const bytesZone = container.querySelector('[data-cell-analysis-bytes="true"]') as HTMLElement;
    expect(bytesZone).not.toBeNull();
    expect(analysis.contains(bytesZone)).toBe(true);
    const memoryContent = container.querySelector(
      '[data-cell-content-memory-mode="direct"]',
    ) as HTMLElement;
    expect(memoryContent).not.toBeNull();
    expect(bytesZone.contains(memoryContent)).toBe(true);
    expect(memoryContent.getAttribute('aria-label')).toBe('Consensus memory content');
    expect(memoryContent.style.borderLeft).toBe('');
    expect(memoryContent.style.background).toBe('');
    expect(container.querySelector('[data-cell-content-byte-origin="direct"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(11);
    expect(root.style.height).toBe('');
    expect(analysis.style.height).toBe('');
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

  it('keeps every retained direct byte inspectable through bounded windows', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const longData = Array.from(
      { length: 40 },
      (_, index) => index.toString(16).padStart(2, '0'),
    ).join('');
    const { container } = render(
      <CellDetailPanel
        cell={{ ...base, data_hex: `0x${longData}`, data_bytes: longData.length / 2 }}
        onClose={() => {}}
      />,
    );

    // Two 16-byte hex rows to a window, in the fixed-width data column.
    const byteGrid = container.querySelector(
      '[data-cell-content-bytes="true"]',
    ) as HTMLElement;
    expect(byteGrid.style.gridTemplateColumns).toBe('repeat(16, minmax(0, 1fr))');
    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(32);
    expect(container.querySelector('[data-cell-content-byte="0"]')?.textContent)
      .toBe('00');
    expect(container.textContent).toContain('W 1/2');
    // While the summary is still ghosted the window stepper is inert — the
    // reveal hands a control over only once it has been read.
    const nextWindow = () => container.querySelector(
      '[aria-label="next raw byte window"]',
    ) as HTMLButtonElement;
    expect(nextWindow().disabled).toBe(true);
    fireEvent.click(nextWindow());
    expect(container.textContent).toContain('W 1/2');

    settleScan(performanceNow);
    expect(nextWindow().disabled).toBe(false);
    fireEvent.click(nextWindow());
    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(8);
    expect(container.querySelector('[data-cell-content-byte="32"]')?.textContent)
      .toBe('20');
    expect(container.textContent).toContain('W 2/2');
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

  it('mirrors the two columns for a vertical fan, specimen column leading', () => {
    const { container } = render(
      <CellDetailPanel
        cell={base}
        layoutSide="below"
        semanticSource={{
          source: 'ckbadger',
          status: 'syncing',
          capabilities: ['cell_detail'],
          lag_blocks: 2,
        }}
        semanticPhase="loading"
        onClose={() => {}}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const analysis = container.querySelector(
      '[data-cell-inspection-satellite="analysis"]',
    ) as HTMLElement;
    const portrait = container.querySelector(
      '[data-cell-portrait-frame]',
    ) as HTMLElement;

    expect(root.style.height).toBe('');
    // An above/below fan mirrors the same two columns — the specimen square
    // leads, nearest the inspected Cell.
    expect(root.getAttribute('data-cell-detail-layout')).toBe('vertical');
    expect(root.style.width).toBe('728px');
    expect(root.style.gridTemplateColumns).toBe('280px minmax(0, 1fr)');
    expect(root.style.gridTemplateAreas).toBe('"scan analysis"');
    expect(portrait.style.gridArea).toBe('scan');
    expect(portrait.style.width).toBe('280px');
    expect(portrait.style.justifySelf).toBe('');
    // Mirrored or not, enriched or bare, the plate keeps one rectangle and
    // the stock cut corner — an arriving record never re-cuts the card.
    expect(analysis.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(analysis.style.clipPath).toBe('polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)');
    expect(analysis.style.padding).toBe('9px 12px 10px 14px');
    expect(analysis.style.height).toBe('');
    expect(container.querySelector('[data-cell-semantics-phase="loading"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-cell-content-memory-mode="indexed"]'))
      .not.toBeNull();
    expect(container.textContent).toContain('INDEX ANALYSIS · RESOLVING');
    expect(container.textContent).toContain('RESOLVING INDEXED CONTENT ANALYSIS');
    expect(container.textContent).toContain('RESOLVING SELECTED CELL…');
    expect(container.querySelector('[data-cell-detail-module="context"]'))
      .toBeNull();
    // `↔` is carried by no face this repo ships and none it could — the mark
    // is drawn now, so the words and the axis are two assertions.
    const affordance = container.querySelector('[data-cell-scan-drag-affordance]');
    expect(affordance?.textContent).toBe('ORBIT');
    expect(affordance?.querySelector('[data-drag-axis-mark]')).not.toBeNull();
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
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('728px');
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(2);
    // Enrichment adds evidence, never geometry: the same 728 card, the same
    // two columns, the same rectangular plate.
    expect(root.style.gridTemplateColumns).toBe('minmax(0, 1fr) 280px');
    expect(analysis.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(analysis.style.clipPath).toBe('polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)');

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
      ?.textContent).toBe('CODEACTIVE0x7c7c7c7c7c…c7c7c7c7c · TYPE');
    // The lifecycle state is a chip ON the row it qualifies, never a stamp
    // floating off at the far right of the plate.
    expect(lockEvidence.querySelector('[data-cell-script-state="active"]')).not.toBeNull();
    const owner = lockEvidence.querySelector('[data-cell-evidence-row="owner"]') as HTMLElement;
    expect(owner.textContent).toContain('ckt1qyqindexe');
    expect(owner.textContent).toContain('ADDRESS ENCODED FROM THE LOCK SCRIPT');
    expect(owner.querySelector('[data-cell-evidence-value="owner"]')
      ?.getAttribute('title')).toBe('ckt1qyqindexedaddress0000000000');
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
    expect((typeEvidence.querySelector('[data-cell-evidence-value="amount"]') as HTMLElement)
      .style.fontSize).toBe('11.5px');
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
    expect(typeEvidence.querySelector('[data-cell-evidence-row="dao-deposited"]')
      ?.textContent).toBe('DEPOSITED#16,204,800 · 2025-08-15 06:07 UTC');
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

    // Content memory unchanged inside the DATA cluster.
    const contentMemory = container.querySelector('[data-cell-content-memory="true"]');
    expect(contentMemory?.getAttribute('data-cell-content-memory-mode')).toBe('indexed');
    expect(contentMemory?.getAttribute('data-cell-content-byte-origin')).toBe('indexed');
    expect(contentMemory?.getAttribute('data-cell-content-complete')).toBe('true');
    expect(contentMemory?.textContent).toContain('INDEX ANALYSIS · DETERMINISTIC');
    expect(contentMemory?.textContent).toContain('123.45 NTT');
    expect(contentMemory?.textContent).toContain('DECODE · JSON DOCUMENT');
    // Raw bytes and decoded analysis stack; arriving analysis never splits
    // the content window into two columns.
    expect((contentMemory?.querySelector('[data-cell-content-raw="true"]')
      ?.parentElement as HTMLElement).style.gridTemplateColumns)
      .toBe('minmax(0,1fr)');
    expect(contentMemory?.textContent).toContain('UTF-8 JSON object decoded from Cell data');
    expect(contentMemory?.textContent).toContain('OBJECT START');
    expect(contentMemory?.textContent).toContain('[0..1)');
    expect(contentMemory?.textContent).toContain('JSON object opening delimiter');
    expect(contentMemory?.textContent).toContain('H1/1 · HIGH');
    expect(contentMemory?.textContent).toContain('application/json');
    expect(contentMemory?.textContent).toContain('ROLE 1/3');
    expect(contentMemory?.textContent).toContain('DAO · DEPOSIT');
    expect(contentMemory?.querySelector('[data-cell-content-byte="0"]')?.textContent)
      .toBe('7B');
    // Segment stepping is a control, and controls belong to revealed rows.
    settleScan(performanceNow);
    fireEvent.click(container.querySelector('[aria-label="next decoded segment"]')!);
    expect(contentMemory?.textContent).toContain('DOCUMENT BODY');
    expect(contentMemory?.textContent).toContain('[1..7)');
    fireEvent.click(container.querySelector('[aria-label="next decoded segment"]')!);
    expect(contentMemory?.textContent).toContain('EXTENSION PAYLOAD');
    expect(contentMemory?.textContent).toContain('[28..40)');
    // The 32-byte window (two 16-byte rows) already holds the segment start.
    expect(contentMemory?.textContent).toContain('W 1/2');
    expect(contentMemory?.querySelector('[data-cell-content-byte="28"]')?.textContent)
      .toBe('00');

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
    // anchor block is.
    expect(proofChip.textContent)
      .toContain('ENRICHMENT ANCHOR · EVERY INDEXED FACT ABOVE IS AS OF THIS BLOCK');

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
    // LOCK reserves an extra caption line — OWNER carries one, and a row with
    // a sentence under it is taller than the three bare rails beside it.
    expect(slot('lock').style.minHeight).toBe('78px');
    expect(slot('type').style.minHeight).toBe('66px');
    // The BYTE BUDGET's reservation is EXACTLY the ghost stack that fills it;
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

  it('holds the DATA cluster\'s analysis rows too, so the footer never moves', () => {
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
    const zone = () => container.querySelector(
      '[data-cell-cluster="data"] [data-cell-content-analysis]',
    ) as HTMLElement;

    // The DATA cluster is the last one before the provenance footer, and its
    // analysis rows are the only rows on the card whose COUNT waits on the
    // index. Held, they cannot shove the footer down mid-read.
    expect(zone().dataset.cellContentAnalysisReserved).toBe('true');
    expect(zone().style.minHeight)
      .toBe(`${CELL_CONTENT_ANALYSIS_RESERVED_PX}px`);

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
    // this arrival is every analysis row the index can send at once — VALUE,
    // DECODE, a segment, a heuristic and a role — which is exactly the stack
    // CELL_CONTENT_ANALYSIS_RESERVED_PX is summed from. Nothing taller can
    // land, so the reservation settles down or not at all, never up.
    expect(zone().dataset.cellContentAnalysisReserved).toBeUndefined();
    expect(zone().style.minHeight).toBe('');
    expect(zone().querySelector('[data-cell-content-asset]')).not.toBeNull();
    expect(zone().querySelector('[data-cell-content-segment="0"]')).not.toBeNull();
    expect(zone().querySelector('[data-cell-content-heuristic="0"]')).not.toBeNull();
    expect(zone().querySelector('[data-cell-content-role="0"]')).not.toBeNull();
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
      .style.minHeight).toBe('78px');

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
    // The window still says exactly what it could see, and that it is a
    // window: the honesty moved here, where the clipping actually happened.
    expect(text).toContain('1,024 B+ OBSERVED');
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
    const content = container.querySelector('[data-cell-content-memory]') as HTMLElement;
    expect(content.dataset.cellContentRevealCount).toBe('0');
    // The window is there at full size from the first frame — the walk lights
    // it, it never mounts it. Nothing below can be pushed down by a reveal.
    expect(content.style.display).toBe('block');
    const ascii = () => container.querySelector(
      '[data-cell-content-reveal-item="ascii"]',
    ) as HTMLElement;
    const causal = () => container.querySelector(
      '[data-consensus-memory-reveal="causal"]',
    ) as HTMLElement;
    expect(ascii().style.display).toBe('block');
    expect(ascii().style.opacity).toBe('0.18');
    expect(ascii().style.pointerEvents).toBe('none');
    performanceNow.mockReturnValue(PROBE_STEP_S * 2.5 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(container.textContent).toContain('CELL // #4242');
    expect(Number(analysis.getAttribute('data-cellular-scan-progress'))).toBeGreaterThan(0);
    expect(Number(content.dataset.cellContentRevealCount)).toBeGreaterThan(0);
    expect(Number(content.dataset.cellContentRevealCount)).toBeLessThan(
      Number(content.dataset.cellContentRevealTotal),
    );
    expect((container.querySelector('[data-cell-content-reveal-item="bytes"]') as HTMLElement)
      .style.opacity).toBe('1');
    // Still ghosted: dark, inert, and holding its place.
    expect(ascii().style.opacity).toBe('0.18');
    expect(ascii().style.pointerEvents).toBe('none');
    expect(ascii().getAttribute('aria-hidden')).toBe('true');
    // Mid-scan the causal lens is still resolving — and still laid out.
    expect(causal().style.display).toBe('block');
    expect(causal().style.opacity).toBe('0.18');
    expect(causal().style.pointerEvents).toBe('none');

    performanceNow.mockReturnValue(PROBE_STEP_S * 6 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('locked');
    expect(content.dataset.cellContentRevealState).toBe('resolved');
    const settledSpecimenScan = container.querySelector(
      '[data-cell-specimen-scan-light]',
    ) as HTMLElement;
    // Classification ends the probe walk; the ambient sweep keeps looping.
    expect(settledSpecimenScan.style.animation).toContain(
      'cknerv-cell-specimen-sweep 2.8s linear infinite',
    );
    expect(settledSpecimenScan.style.willChange).toContain('transform');
    expect(settledSpecimenScan.style.opacity).toBe('0.8');
    expect(causal().style.display).toBe('block');
    expect(causal().style.opacity).toBe('1');
    expect(causal().style.pointerEvents).toBe('auto');
    expect(causal().getAttribute('aria-hidden')).toBeNull();
    expect(ascii().style.opacity).toBe('1');
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

  /** Every element the reveal stages, ghosted or lit. */
  function stagedRows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll(
      '[data-cell-content-reveal-item],[data-consensus-memory-reveal],[data-cell-detail-field]',
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
    const content = container.querySelector(
      '[data-cell-content-memory]',
    ) as HTMLElement;

    // Everything the walk will light is standing there, dark and untouchable,
    // before the walk starts.
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('scanning');
    expect(content.dataset.cellContentRevealCount).toBe('0');
    const ghosted = stagedRows(container);
    expect(ghosted.length).toBeGreaterThan(8);
    for (const row of ghosted) {
      expect(row.style.display).not.toBe('none');
      expect(row.style.opacity).toBe('0.18');
      expect(row.style.pointerEvents).toBe('none');
    }
    // The trace row is a grid row of the card, and it exists from the start.
    expect(root.style.gridTemplateAreas)
      .toBe('"analysis scan"');

    const frames = sweepReveal(root, performanceNow);

    // The reveal genuinely happened…
    expect(analysis.getAttribute('data-cellular-scan-state')).toBe('locked');
    expect(content.dataset.cellContentRevealState).toBe('resolved');
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
    expect(t).toContain('CELL // #4242');
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
    // once, lit and live, with nothing waiting its turn.
    const rows = stagedRows(container);
    expect(rows.length).toBeGreaterThan(8);
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
      .toBe('0x9e9e9e9e9e…e9e9e9e9e · #16,204,999');
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
    expect(t).toContain('#16,204,800 · 2→1');
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
    expect(container.textContent).toContain('SCAN·02');
    expect(container.textContent).not.toContain('SCAN·03');
    expect(container.querySelector('[data-cell-detail-module="context"]')).toBeNull();
    expect(container.querySelector('[data-memory-read-state="reading"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-memory-evidence]')).toHaveLength(2);
    expect(container.textContent).toContain('EVIDENCE → AGREEMENT');
    expect(container.textContent).toContain('1111111·1111');
    // Nothing to disclose when the routed evidence already IS the inputs.
    expect(container.querySelector('[data-memory-consumed-inputs]')).toBeNull();
  });

  it('appends the armed memory trace below the analysis plate without reshuffling it', () => {
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
    expect(container.textContent).not.toContain('SCAN·02');

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
    expect(container.textContent).toContain('SCAN·02');
    // Arming appends a full-width row below the analysis plate — the column
    // never splits and the analysis plate's geometry does not move.
    expect((container.firstElementChild as HTMLElement).style.gridTemplateAreas)
      .toBe('"analysis scan" "trace trace"');
    expect(trace.style.gridArea).toBe('trace');
    expect(analysis().style.cssText).toBe(restingAnalysisStyle);
    expect(trace).toBe(trace.parentElement?.lastElementChild);
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(3);
  });

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
      .toContain('cknerv-route-hop-lock-pulse 480ms');
    expect(transitInspector.querySelector<HTMLElement>(
      '[data-memory-evidence-route-pulse-surface="true"]',
    )?.style.animation)
      .toContain('cknerv-route-hop-lock-pulse 480ms');
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

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CellDetailPanel cell={base} onClose={onClose} />);
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
