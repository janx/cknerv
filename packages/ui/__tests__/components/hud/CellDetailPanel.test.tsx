import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import type { ConsensusMemoryTraceReadout } from '../../../src/nerve/consensusMemoryTrace';
import type {
  CellIdentityBindingPhase,
  CellIdentityProofBinding,
} from '../../../src/derives/cellIdentityProof.derive';
import { PROBE_STEP_S } from '../../../src/components/hud/probeScan';

const { portraitRender } = vi.hoisted(() => ({ portraitRender: vi.fn() }));

vi.mock('../../../src/components/hud/CellNucleusPortrait', async () => {
  const { memo } = await import('react');
  return {
    default: memo(({ focusField, onIdentityProofRead }: {
      focusField?: string | null;
      onIdentityProofRead?: (kind: 'content') => void;
    }) => {
      portraitRender();
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

import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const base: Cell = {
  id: 4242, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'wallet', pos_seed: [0, 0, 0],
  out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 2 },
  capacity: 12300000000, data_hex: '0xdeadbeefcafe1234567890',
  content_hash: '0x' + '11'.repeat(32), lock_kind: 'omnilock', asset_kind: 'xudt',
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

describe('CellDetailPanel', () => {
  beforeEach(() => {
    portraitRender.mockClear();
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
  });

  it('renders separate readable satellites with the magnified Cell scan restored', () => {
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL');
    expect(t).not.toContain('共识细胞');   // Cell detail titles stay English-only
    expect(t).toContain('Omnilock');       // LOCK
    expect(t).toContain('xUDT');           // ASSET
    expect(t).toContain('123.00 CKB');     // CAPACITY
    expect(t).toContain('LIVE');           // STATE
    // born_at_ms 0 is the composition-backfill sentinel — the header falls
    // back to the birth block instead of an epoch-relative age.
    expect(t).toContain('SINCE #16,204,800');
    expect(t).toContain('#16,204,800');    // COMMIT / block anchor (grouped)
    expect(t).toContain('11 B');           // DATA — 22 hex chars = 11 bytes
    expect(t).not.toContain('ƒ');          // portrait frequencies stay visual-only
    expect(t).not.toContain('paths');      // portrait strands stay visual-only
    expect(t).not.toContain('knots');      // portrait joins stay visual-only
    expect(container.querySelector('[data-cell-detail-field="capacity"]')
      ?.textContent).toBe('CAPACITY123.00 CKB');
    expect(t).toContain('CONSENSUS MEMORY');
    expect(t).not.toContain('共识记忆');
    expect(t).not.toContain('CELL CONTENT');
    expect(t).not.toContain('细胞内容');
    expect(t).toContain('DIRECT NODE · RAW');
    expect(t).toContain('DEADBEEFCAFE1234567890');
    expect(t).not.toContain('WRITE OBSERVED');
    expect((container.firstElementChild as HTMLElement).style.animation)
      .toContain('cknerv-cell-consensus-enter');
    expect(container.querySelector('[data-cell-detail-scan-field="true"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-portrait-frame]')).not.toBeNull();
    expect((container.querySelector('[data-cell-portrait-frame]') as HTMLElement).style.gridArea)
      .toBe('portrait');
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns)
      .toBe('minmax(0, 1fr) 260px');
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
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(4);
    // The zoom magnifier is gone — sizes are authored on the HUD_TYPE scale.
    expect(container.querySelector('[data-cell-detail-readable-scale]')).toBeNull();
    expect(t).toContain('CELL SCAN');
    expect(t).toContain('CELL IDENTITY');
    expect(t).not.toContain('细胞身份');
    expect(t).not.toContain('SCAN LOCKED');
    expect(t).not.toContain('INDEX LAYER');
    expect(t).toContain('DRAG TO ORBIT');
    expect(t).toContain('A-LATTICE');
    expect(t).not.toContain('结构扫描');
    expect(t).not.toContain('流光标本扫描');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[data-cell-detail-module="anatomy"]')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-cell-detail-module="lineage"]')?.hasAttribute('hidden')).toBe(false);
    expect((container.querySelector('[data-consensus-memory]') as HTMLElement).dataset.consensusMemoryDensity).toBe('spatial');
    const memoryContent = container.querySelector(
      '[data-cell-content-memory-mode="direct"]',
    ) as HTMLElement;
    expect(memoryContent).not.toBeNull();
    expect(memoryContent.getAttribute('aria-label')).toBe('Consensus memory content');
    expect(memoryContent.style.borderLeft).toBe('');
    expect(memoryContent.style.background).toBe('');
    expect(container.querySelector('[data-consensus-memory-identity-grid]')).toBeNull();
    expect(container.querySelector('[data-cell-content-byte-origin="direct"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(11);
    expect((container.firstElementChild as HTMLElement).style.height).toBe('');
    expect((container.querySelector('[data-cell-detail-module="lineage"]') as HTMLElement)
      .style.height).toBe('');
    expect((container.querySelector('[data-cell-scan-shard="lineage"]') as HTMLElement).style.overflow)
      .toBe('visible');
    expect(container.querySelector('[data-cell-detail-module="lineage"]')
      ?.getAttribute('data-cell-detail-size')).toBe('content');
    const bottomWidgets = container.querySelector('[data-cell-detail-bottom-widgets="true"]') as HTMLElement;
    expect(bottomWidgets.style.gridArea).toBe('bottom');
    expect(bottomWidgets.style.paddingTop).toBe('');
  });

  it('turns base taxonomy into useful Cell facts without visual parameters', () => {
    const native = {
      ...base,
      asset_kind: 'native' as const,
      lock_kind: 'sighash' as const,
      data_hex: '0x',
    };
    const { container } = render(
      <CellDetailPanel cell={native} onClose={() => {}} />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('Native CKB');
    expect(text).toContain('Sighash');
    expect(text).toContain('Empty');
    // A validly-empty output collapses to one line instead of a negatives
    // stack (∅ box + byte count + decode fallbacks).
    expect(text).toContain('CONTENT · EMPTY');
    expect(text).not.toContain('NO OUTPUT DATA');
    expect(text).not.toContain('NO DETERMINISTIC DECODE');
    expect(container.querySelector('[data-cell-content-empty="true"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-content-bytes="true"]')).toBeNull();
    expect(text).not.toMatch(/ƒ\d|\d+ paths|\d+ knots|\d\.\d{2}×/);
  });

  it('keeps every retained direct byte inspectable through bounded windows', () => {
    const longData = Array.from(
      { length: 40 },
      (_, index) => index.toString(16).padStart(2, '0'),
    ).join('');
    const { container } = render(
      <CellDetailPanel
        cell={{ ...base, data_hex: `0x${longData}` }}
        onClose={() => {}}
      />,
    );

    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(28);
    expect(container.querySelector('[data-cell-content-byte="0"]')?.textContent)
      .toBe('00');
    expect(container.textContent).toContain('W 1/2');
    fireEvent.click(container.querySelector('[aria-label="next raw byte window"]')!);
    expect(container.querySelectorAll('[data-cell-content-byte]')).toHaveLength(12);
    expect(container.querySelector('[data-cell-content-byte="28"]')?.textContent)
      .toBe('1C');
    expect(container.textContent).toContain('W 2/2');
  });

  it('keeps scan and lineage in one direct reading field', () => {
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[data-cellular-scan-state]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-module="anatomy"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-module="lineage"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-detail-module="context"]')).toBeNull();
  });

  it('uses the bounded stacked constellation for a narrow enhanced placement', () => {
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
    const scanWindow = container.querySelector(
      '[data-cell-detail-module="anatomy"]',
    ) as HTMLElement;
    const memory = container.querySelector(
      '[data-cell-detail-module="lineage"]',
    ) as HTMLElement;

    expect(root.style.height).toBe('');
    expect(root.style.gridTemplateColumns).toBe('190px minmax(0, 1fr)');
    expect(scanWindow.style.gridArea).toBe('anatomy');
    expect(scanWindow.style.height).toBe('');
    expect(memory.style.top).toBe('');
    expect(memory.style.width).toBe('auto');
    expect(memory.style.height).toBe('');
    expect((container.querySelector('[data-cell-detail-bottom-widgets="true"]') as HTMLElement)
      .style.paddingTop).toBe('');
    expect(container.querySelector('[data-cell-semantics-placement="scan"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-cell-content-memory-mode="indexed"]'))
      .not.toBeNull();
    expect(container.textContent).toContain('INDEX ANALYSIS · RESOLVING');
    expect(container.textContent).toContain('RESOLVING INDEXED CONTENT ANALYSIS');
    expect(container.querySelector('[data-cell-detail-module="context"]'))
      .toBeNull();
    expect(container.querySelector('[data-cell-scan-drag-affordance]')
      ?.textContent).toBe('ORBIT ↔');
  });

  it('adds indexed semantics only when the optional source is present', () => {
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
              attributes: [
                { key: 'deposit_block', value: '16204800', unit: 'block' },
                { key: 'compensation', value: '1.25', unit: 'CKB' },
                { key: 'estimated_apc', value: '2.01%' },
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
                { key: 'fee_rate', value: '1250', unit: 'shannons/kB' },
                { key: 'size', value: '456', unit: 'bytes' },
                { key: 'confirmations', value: '24' },
                { key: 'inputs_capacity', value: '20000000000', unit: 'shannons' },
                { key: 'outputs_capacity', value: '19999999000', unit: 'shannons' },
                { key: 'inputs_common_knowledge', value: '122', unit: 'bytes' },
                { key: 'outputs_common_knowledge', value: '128', unit: 'bytes' },
              ],
            },
            {
              namespace: 'ckb',
              kind: 'transaction_lifecycle',
              state: 'committed',
              attributes: [
                { key: 'proposed_block', value: '16204798' },
                { key: 'committed_block', value: '16204800' },
                { key: 'commitment_distance', value: '2', unit: 'blocks' },
                { key: 'window_close', value: '2', unit: 'blocks' },
                { key: 'window_far', value: '10', unit: 'blocks' },
              ],
            },
          ],
          participants: [
            {
              address: 'ckt1aliceparticipant',
              capacity_delta: '4999999000',
              common_knowledge_delta: '6',
              facets: [],
            },
            {
              address: 'ckt1bobparticipant',
              capacity_delta: '-20000000000',
              facets: [],
            },
          ],
          fee: '1000',
          cycles: 12345,
        }}
      />,
    );

    const readout = container.querySelector('[data-cell-semantics-phase="ready"]');
    const scanWindow = container.querySelector('[data-cell-detail-module="anatomy"]');
    const memory = container.querySelector('[data-consensus-memory]') as HTMLElement;
    const contentMemory = container.querySelector('[data-cell-content-memory="true"]');
    expect(readout).not.toBeNull();
    expect(readout?.getAttribute('data-cell-semantics-density')).toBe('scan');
    expect(readout?.getAttribute('data-cell-semantics-policy')).toBe('essential');
    expect(readout?.getAttribute('data-cell-semantics-placement')).toBe('scan');
    expect(readout?.querySelector('[data-cell-context-presentation="scan"]')).not.toBeNull();
    expect(scanWindow?.contains(readout)).toBe(true);
    expect((readout?.querySelector('[data-cell-context-facts]') as HTMLElement).style.gridTemplateColumns).toContain('1.35fr');
    expect((readout?.querySelector('[data-cell-context-fact="owner"]') as HTMLElement).style.gridColumn).toBe('');
    expect(readout?.querySelector('[data-cell-context-header="true"]')).toBeNull();
    expect(readout?.querySelector('[data-cell-context-scripts="true"]')).not.toBeNull();
    expect((readout?.querySelector('[data-cell-context-scripts="true"]') as HTMLElement).style.gridTemplateColumns).toContain('repeat(2');
    expect(readout?.querySelector('[data-cell-context-script-evidence]')?.textContent)
      .toContain('CODE·TYPE');
    expect(readout?.querySelector('[data-transaction-semantics-summary]')).toBeNull();
    expect(readout?.querySelector('[data-transaction-participants]')).toBeNull();
    expect(container.querySelector('[data-cell-portrait-frame]')).not.toBeNull();
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns)
      .toBe('minmax(0, 1fr) 280px');
    expect(container.querySelectorAll('[data-cell-inspection-satellite]')).toHaveLength(4);
    expect(memory.dataset.consensusMemoryDensity).toBe('spatial');
    expect((container.firstElementChild as HTMLElement).style.height).toBe('');
    expect((container.querySelector('[data-cell-detail-module="lineage"]') as HTMLElement)
      .style.height).toBe('');
    expect(contentMemory?.getAttribute('data-cell-content-memory-mode')).toBe('indexed');
    expect(contentMemory?.getAttribute('data-cell-content-byte-origin')).toBe('indexed');
    expect(contentMemory?.getAttribute('data-cell-content-complete')).toBe('true');
    expect(contentMemory?.textContent).toContain('INDEX ANALYSIS · DETERMINISTIC');
    expect(contentMemory?.textContent).toContain('123.45 NTT');
    expect(contentMemory?.textContent).toContain('DECODE · JSON DOCUMENT');
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
    fireEvent.click(container.querySelector('[aria-label="next decoded segment"]')!);
    expect(contentMemory?.textContent).toContain('DOCUMENT BODY');
    expect(contentMemory?.textContent).toContain('[1..7)');
    fireEvent.click(container.querySelector('[aria-label="next decoded segment"]')!);
    expect(contentMemory?.textContent).toContain('EXTENSION PAYLOAD');
    expect(contentMemory?.textContent).toContain('[28..40)');
    expect(contentMemory?.textContent).toContain('W 2/2');
    expect(contentMemory?.querySelector('[data-cell-content-byte="28"]')?.textContent)
      .toBe('00');
    expect(container.querySelector('[data-cell-detail-module="context"]')).toBeNull();
    expect(container.querySelector('[data-cell-detail-module="anatomy"]')?.hasAttribute('hidden')).toBe(false);
    expect((scanWindow as HTMLElement).style.gridArea).toBe('anatomy');
    expect((scanWindow as HTMLElement).style.height).toBe('');
    expect(container.querySelector('[data-cell-detail-module="lineage"]')?.hasAttribute('hidden')).toBe(false);
    expect((container.querySelector('[data-cell-detail-module="lineage"]') as HTMLElement).style.width).toBe('auto');
    expect((container.firstElementChild as HTMLElement).style.background).toBe('');
    expect(readout?.textContent).not.toContain('INDEX LAYER');
    expect(readout?.textContent).not.toContain('CELL CONTEXT');
    expect(readout?.textContent).not.toContain('INDEXED');
    expect(readout?.textContent).not.toContain('IDX');
    expect(readout?.textContent).not.toContain('CKBADGER');
    expect(readout?.textContent).toContain('Default Lock');
    expect(readout?.textContent).toContain('ACTIVE');
    expect(readout?.textContent).toContain('0x1234');
    expect(readout?.textContent).toContain('Legacy DAO Script');
    expect(readout?.textContent).toContain('DEPRECATED');
    expect(readout?.textContent).toContain('0xabcd');
    expect(readout?.textContent).toContain('NTT · Nervos Test Token · xUDT');
    expect(readout?.textContent).toContain('123.45 NTT');
    expect(readout?.textContent).toContain('OCCUPIED133 B');
    expect(readout?.textContent).toContain('DAO POSITION');
    expect(readout?.textContent).toContain('DEPOSIT');
    expect(readout?.textContent).toContain('1.25 CKB');
    expect(readout?.textContent).not.toContain('DATA · JSON DOCUMENT');
    expect(readout?.textContent).not.toContain('DEP GROUP');
    expect(readout?.textContent).not.toContain('CODE CELL');
    expect(readout?.textContent).not.toContain('ORIGIN TRANSACTION');
    expect(container.textContent).toContain('SINCE #16,204,800');
    expect(Array.from(container.querySelectorAll('span')).filter(
      (span) => span.textContent === 'AGE',
    )).toHaveLength(0);
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
          facets: [],
        }}
        onClose={() => {}}
      />,
    );

    const facts = () => container.querySelector('[data-cell-context-facts]') as HTMLElement;
    const scripts = () => container.querySelector('[data-cell-context-scripts="true"]') as HTMLElement;
    // While the lattice is still scanning, the deeper enrichment stays dark.
    expect(facts().dataset.cellContextRevealStage).toBe('pending');
    expect(facts().style.opacity).toBe('0');
    expect(scripts().style.opacity).toBe('0');
    // One step after the sixth landmark: context facts light, scripts wait.
    performanceNow.mockReturnValue(PROBE_STEP_S * 6.6 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(facts().dataset.cellContextRevealStage).toBe('lit');
    expect(facts().style.opacity).toBe('1');
    expect(scripts().style.opacity).toBe('0');
    // Two steps after: the whole enrichment block is lit.
    performanceNow.mockReturnValue(PROBE_STEP_S * 7.7 * 1000);
    act(() => { vi.advanceTimersByTime(80); });
    expect(scripts().style.opacity).toBe('1');
    // Unrevealed identity values stay dark mid-scan on a fresh mount.
    performanceNow.mockReturnValue(0);
  });

  it('advances the scan beam without hiding any evidence module', () => {
    const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container } = render(
      <CellDetailPanel cell={base} onClose={() => {}} />,
    );

    expect(container.querySelector('[data-cellular-scan-progress]')
      ?.getAttribute('data-cellular-scan-progress')).toBe('0');
    const memory = container.querySelector('[data-consensus-memory]') as HTMLElement;
    const content = container.querySelector('[data-cell-content-memory]') as HTMLElement;
    expect(memory.dataset.consensusMemoryState).toBe('scanning');
    expect(memory.dataset.consensusMemoryProgress).toBe('0');
    expect(content.dataset.cellContentRevealCount).toBe('0');
    expect(content.style.display).toBe('none');
    performanceNow.mockReturnValue(PROBE_STEP_S * 2.5 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(container.textContent).toContain('CELL IDENTITY');
    expect(Number(container.querySelector('[data-cellular-scan-progress]')
      ?.getAttribute('data-cellular-scan-progress'))).toBeGreaterThan(0);
    expect(container.querySelector('[data-cell-detail-module="lineage"]')).not.toBeNull();
    expect(Number(content.dataset.cellContentRevealCount)).toBeGreaterThan(0);
    expect(Number(content.dataset.cellContentRevealCount)).toBeLessThan(
      Number(content.dataset.cellContentRevealTotal),
    );
    expect(content.style.display).toBe('block');
    expect((container.querySelector('[data-cell-content-reveal-item="bytes"]') as HTMLElement)
      .style.display).not.toBe('none');
    expect((container.querySelector('[data-cell-content-reveal-item="ascii"]') as HTMLElement)
      .style.display).toBe('none');

    performanceNow.mockReturnValue(PROBE_STEP_S * 6 * 1000);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(memory.dataset.consensusMemoryState).toBe('locked');
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
    expect((container.querySelector('[data-consensus-memory-reveal="causal"]') as HTMLElement)
      .style.display).toBe('block');
    performanceNow.mockRestore();
  });

  it('reduced motion freezes decoding while keeping all scan facts visible', () => {
    // stub matchMedia so useReducedMotion() reports reduced — deterministic path
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<CellDetailPanel cell={base} onClose={() => {}} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL IDENTITY');
    expect(t).toContain('LOCKED · A-LATTICE 6/6');
    expect(t).not.toContain('1111111111111111 · 1111111111');
    expect(t).toContain('Omnilock');                              // decoded rows still present
    expect(t).toContain('11 B');
    expect((container.firstElementChild as HTMLElement).style.animation).toBe('');
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

  it('keeps identity proof controls in Cell Scan instead of repeating them in memory', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const onInspectionFieldChange = vi.fn();
    const { container } = render(
      <CellDetailPanel
        cell={base}
        onInspectionFieldChange={onInspectionFieldChange}
        onClose={() => {}}
      />,
    );

    const memory = container.querySelector('[data-consensus-memory]')!;
    expect(memory.querySelector('[data-consensus-memory-identity-grid]')).toBeNull();
    expect(memory.querySelector('[data-memory-identity-proof]')).toBeNull();

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
    expect(container.querySelector('[data-cell-detail-module="context"]')).toBeNull();
    expect(container.querySelector('[data-memory-read-state="reading"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-memory-evidence]')).toHaveLength(2);
    expect(container.textContent).toContain('EVIDENCE → AGREEMENT');
    expect(container.textContent).toContain('1111111·1111');
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
    const bare = { ...base, lock_kind: undefined, asset_kind: undefined };
    const { container } = render(<CellDetailPanel cell={bare} onClose={() => {}} />);
    expect(container.querySelector('[data-cell-detail-field="asset"]')
      ?.textContent).toBe('ASSETUnknown');
    expect(container.querySelector('[data-cell-detail-field="lock"]')
      ?.textContent).toBe('LOCKUnknown');
  });

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CellDetailPanel cell={base} onClose={onClose} />);
    getByRole('button', { name: 'close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
