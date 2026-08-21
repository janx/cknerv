import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommonKnowledgeBreakdown } from '@cknerv/types';
import CellByteBudget from '../../../src/components/hud/CellByteBudget';
import {
  formatUtilizationPercent,
} from '../../../src/derives/cellByteBudget.derive';

afterEach(cleanup);

const CKB = 100_000_000;

function knowledge(
  overrides: Partial<CommonKnowledgeBreakdown> = {},
): CommonKnowledgeBreakdown {
  return {
    total_bytes: 154,
    capacity_field_bytes: 8,
    lock_script_bytes: 65,
    type_script_bytes: 65,
    data_bytes: 16,
    ...overrides,
  };
}

function segment(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-byte-budget-segment="${key}"]`,
  );
}

describe('CellByteBudget', () => {
  it('sizes composition segments by share of occupied bytes, not capacity', () => {
    const { container } = render(
      <CellByteBudget capacityShannons={400 * CKB} knowledge={knowledge()} />,
    );
    expect(segment(container, 'cap')!.style.width).toBe(`${(8 / 154) * 100}%`);
    expect(segment(container, 'lock')!.style.width).toBe(`${(65 / 154) * 100}%`);
    expect(segment(container, 'type')!.style.width).toBe(`${(65 / 154) * 100}%`);
    expect(segment(container, 'data')!.style.width).toBe(`${(16 / 154) * 100}%`);
    expect(
      container.querySelector('[data-cell-byte-budget]')!
        .getAttribute('data-byte-budget-total-bytes'),
    ).toBe('154');
  });

  it('omits zero-byte components from both bar and legend', () => {
    const { container } = render(
      <CellByteBudget
        capacityShannons={100 * CKB}
        knowledge={knowledge({ total_bytes: 73, type_script_bytes: 0, data_bytes: 0 })}
      />,
    );
    expect(segment(container, 'cap')).not.toBeNull();
    expect(segment(container, 'lock')).not.toBeNull();
    expect(segment(container, 'type')).toBeNull();
    expect(segment(container, 'data')).toBeNull();
    expect(container.querySelector('[data-byte-budget-legend="type"]')).toBeNull();
    expect(container.querySelector('[data-byte-budget-legend="data"]')).toBeNull();
    expect(container.textContent).not.toContain('TYPE');
  });

  it('renders nothing without knowledge or with an empty breakdown', () => {
    const absent = render(
      <CellByteBudget capacityShannons={100 * CKB} knowledge={null} />,
    );
    expect(absent.container.firstChild).toBeNull();
    const empty = render(
      <CellByteBudget
        capacityShannons={100 * CKB}
        knowledge={knowledge({ total_bytes: 0 })}
      />,
    );
    expect(empty.container.firstChild).toBeNull();
  });

  it('labels totals through the existing formatters exactly', () => {
    const { container } = render(
      <CellByteBudget capacityShannons={400 * CKB} knowledge={knowledge()} />,
    );
    expect(
      container.querySelector('[data-byte-budget-occupied]')!.textContent,
    ).toBe('154 B');
    expect(
      container.querySelector('[data-byte-budget-capacity]')!.textContent,
    ).toBe('400 CKB');
    expect(container.textContent).toContain('OCCUPIED');
    expect(container.textContent).toContain('OF');
    expect(container.querySelectorAll('[data-byte-budget-legend]')).toHaveLength(4);
    const legend = container.querySelector<HTMLElement>(
      '[data-byte-budget-legend="lock"]',
    )!;
    expect(legend.textContent).toBe('LOCK65 B');
  });

  it('keeps a full composition bar but a hairline ratio strip for a huge cell', () => {
    const { container } = render(
      <CellByteBudget
        capacityShannons={1_000_000 * CKB}
        knowledge={knowledge({ total_bytes: 102, lock_script_bytes: 65, type_script_bytes: 13, data_bytes: 16 })}
      />,
    );
    expect(
      container.querySelector('[data-byte-budget-capacity]')!.textContent,
    ).toBe('1 M CKB');
    expect(
      container.querySelector('[data-byte-budget-percent]')!.textContent,
    ).toBe('<1%');
    const widths = Array.from(
      container.querySelectorAll<HTMLElement>('[data-byte-budget-segment]'),
      (span) => Number.parseFloat(span.style.width),
    );
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
    const fill = container.querySelector<HTMLElement>(
      '[data-byte-budget-ratio-fill]',
    )!;
    expect(fill.style.width).toBe(`${(102 / 1_000_000) * 100}%`);
    expect(fill.style.minWidth).toBe('1px');
  });

  it('reads 100% when occupied bytes exhaust the capacity budget', () => {
    const { container } = render(
      <CellByteBudget capacityShannons={154 * CKB} knowledge={knowledge()} />,
    );
    expect(
      container.querySelector('[data-byte-budget-percent]')!.textContent,
    ).toBe('100%');
    expect(
      container.querySelector<HTMLElement>('[data-byte-budget-ratio-fill]')!
        .style.width,
    ).toBe('100%');
  });

  it('accepts capacity as bigint, matching formatCkb', () => {
    const { container } = render(
      <CellByteBudget capacityShannons={40_000_000_000n} knowledge={knowledge()} />,
    );
    expect(
      container.querySelector('[data-byte-budget-capacity]')!.textContent,
    ).toBe('400 CKB');
  });

  it('marks the DATA segment observed-partial when the data hex is truncated', () => {
    const { container } = render(
      <CellByteBudget
        capacityShannons={400 * CKB}
        knowledge={knowledge()}
        dataTruncated
      />,
    );
    const data = segment(container, 'data')!;
    expect(data.getAttribute('data-byte-budget-segment-observed')).toBe('partial');
    expect(data.style.opacity).toBe('0.6');
    expect(
      container.querySelector('[data-byte-budget-legend-observed]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-byte-budget-legend="data"]')!.textContent,
    ).toContain('OBSERVED');
    // Only DATA wears the marking.
    expect(segment(container, 'lock')!.hasAttribute('data-byte-budget-segment-observed')).toBe(false);
  });

  it('leaves DATA unmarked when the hex is complete', () => {
    const { container } = render(
      <CellByteBudget capacityShannons={400 * CKB} knowledge={knowledge()} />,
    );
    expect(segment(container, 'data')!.hasAttribute('data-byte-budget-segment-observed')).toBe(false);
    expect(container.textContent).not.toContain('OBSERVED');
  });

  it('ghosts the whole readout until the semantics reveal reaches it', () => {
    const { container } = render(
      <CellByteBudget
        capacityShannons={400 * CKB}
        knowledge={knowledge()}
        reveal={0}
      />,
    );
    const root = container.querySelector<HTMLElement>('[data-cell-byte-budget]')!;
    expect(root.getAttribute('data-byte-budget-reveal-state')).toBe('scanning');
    expect(root.style.opacity).toBe('0.18');
    expect(root.style.transition).toContain('opacity 260ms ease');
    const revealed = render(
      <CellByteBudget capacityShannons={400 * CKB} knowledge={knowledge()} />,
    );
    const lit = revealed.container.querySelector<HTMLElement>(
      '[data-cell-byte-budget]',
    )!;
    expect(lit.getAttribute('data-byte-budget-reveal-state')).toBe('resolved');
    expect(lit.style.opacity).toBe('1');
  });
});

describe('formatUtilizationPercent', () => {
  it('says <1% for any real occupancy under one percent', () => {
    expect(formatUtilizationPercent(102 / 1_000_000)).toBe('<1%');
    expect(formatUtilizationPercent(0.0099)).toBe('<1%');
  });

  it('keeps zero an honest 0%', () => {
    expect(formatUtilizationPercent(0)).toBe('0%');
    expect(formatUtilizationPercent(-0.5)).toBe('0%');
  });

  it('shows at most one decimal above one percent', () => {
    expect(formatUtilizationPercent(0.26)).toBe('26%');
    expect(formatUtilizationPercent(0.2625)).toBe('26%');
    expect(formatUtilizationPercent(0.035)).toBe('3.5%');
    expect(formatUtilizationPercent(0.01)).toBe('1%');
  });

  it('caps at 100% even when fed an overshoot', () => {
    expect(formatUtilizationPercent(1)).toBe('100%');
    expect(formatUtilizationPercent(1.7)).toBe('100%');
  });
});
