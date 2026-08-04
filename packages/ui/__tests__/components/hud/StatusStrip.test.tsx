import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setQualityMode,
} from '../../../src/tweaks/qualityPresets';
import {
  CELL_DISPLAY_MAX,
  getCellDisplayRuntimeSnapshot,
  setCellDisplayLimit,
  setCellDisplayMode,
} from '../../../src/tweaks/cellDisplay';

const levaMocks = vi.hoisted(() => ({
  setQuality: vi.fn(),
}));

vi.mock('leva', () => ({
  useControls: () => [{ quality: 'auto' }, levaMocks.setQuality],
}));

import StatusStrip from '../../../src/components/hud/StatusStrip';

beforeEach(() => {
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
  levaMocks.setQuality.mockClear();
});

afterEach(() => {
  cleanup();
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
});

describe('StatusStrip', () => {
  it('shows the wordmark and a nominal indicator', () => {
    const { container } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    expect(container.textContent).toContain('CKNERV');
    expect(container.textContent).toContain('NOMINAL');
    expect(container.textContent).toContain('状态');
  });
  it('tags the indicator dot with the alert level', () => {
    const { container } = render(<StatusStrip level="danger" uptimeMs={0} />);
    const dot = container.querySelector('[data-dot]') as HTMLElement;
    expect(dot.getAttribute('data-level')).toBe('danger');
    expect(container.textContent).toContain('DANGER');
  });
  it('renders the build version as a commit link before the status chip', () => {
    render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        build={{ version: '20260630@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
      />,
    );
    const link = screen.getByRole('link', { name: '20260630@61922ba' });
    expect(link.getAttribute('href')).toBe('https://github.com/janx/cknerv/commit/61922ba');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('omits the build link when no build prop is given', () => {
    const { queryByRole } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    expect(queryByRole('link')).toBeNull();
  });

  it('shows transport freshness independently from the chain alert level', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        stream={{
          phase: 'stale',
          affectedChannels: ['cells'],
          lastMessageAgeMs: 17_000,
          attempt: 2,
        }}
      />,
    );
    const chip = container.querySelector('[data-stream-chip]') as HTMLElement;
    expect(chip.dataset.streamPhase).toBe('stale');
    expect(chip.textContent).toContain('DATA STALE');
    expect(chip.textContent).toContain('17s');
    expect(container.textContent).toContain('NOMINAL');
  });

  it('removes the redundant DATA LIVE chip while keeping live transport implicit', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        stream={{
          phase: 'live',
          affectedChannels: [],
          lastMessageAgeMs: 2_000,
          attempt: 0,
        }}
      />,
    );

    expect(container.querySelector('[data-stream-chip]')).toBeNull();
    expect(container.textContent).not.toContain('DATA LIVE');
  });

  it('shows optional indexed-context freshness without changing chain status', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        enrichmentSource={{
          source: 'ckbadger',
          status: 'stale',
          capabilities: ['cell_detail'],
          lag_blocks: 18,
          message: 'index is behind',
        }}
      />,
    );

    const chip = container.querySelector('[data-enrichment-chip]') as HTMLElement;
    expect(chip.dataset.enrichmentStatus).toBe('stale');
    expect(chip.textContent).toContain('CKBADGER STALE 18↓');
    expect(container.textContent).toContain('NOMINAL');
  });

  it('renders product-owned actions without coupling them to status semantics', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        actions={<button type="button">JUKEBOX</button>}
      />,
    );

    const actions = container.querySelector('[data-status-actions]');
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).getByRole('button', {
      name: 'JUKEBOX',
    })).not.toBeNull();
    expect(container.textContent).toContain('NOMINAL');
  });

  it('offers a stable AUTO Cell cap with an immediate manual slider override', () => {
    const { container } = render(
      <StatusStrip level="nominal" uptimeMs={0} cellCount={5_000} />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const automatic = within(control).getByRole(
      'button',
      { name: 'Automatic cell count' },
    );
    const slider = within(control).getByRole(
      'slider',
      { name: 'Displayed cell limit' },
    ) as HTMLInputElement;

    expect(automatic.getAttribute('aria-pressed')).toBe('true');
    expect(slider.value).toBe('53');
    expect(slider.max).toBe('109');
    expect(slider.getAttribute('aria-valuetext')).toContain('6,000 Cells');
    expect(control.getAttribute('data-cell-display-capacity')).toBe('20000');
    expect(control.getAttribute('data-cell-display-count')).toBe('5000');
    expect(control.getAttribute('data-cell-display-available')).toBe('5000');
    expect(control.querySelector('[data-cell-display-track]')).not.toBeNull();
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('5K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('CAP6K');
    expect(automatic.textContent).toContain('AUTO');

    fireEvent.change(slider, { target: { value: '29' } });

    expect(getCellDisplayRuntimeSnapshot()).toEqual({
      mode: 'manual',
      manualLimit: 3_000,
    });
    expect(control.getAttribute('data-cell-display-mode')).toBe('manual');
    expect(control.getAttribute('data-cell-display-count')).toBe('3000');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('3K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('CAP3K');
    expect(automatic.textContent).toContain('MAN');

    fireEvent.click(automatic);
    expect(getCellDisplayRuntimeSnapshot().mode).toBe('auto');
    expect(automatic.getAttribute('aria-pressed')).toBe('true');
    expect(automatic.textContent).toContain('AUTO');
  });

  it('keeps a 20K manual range while AUTO respects a smaller server cap', () => {
    render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        cellCount={2_000}
        cellCapacity={2_000}
      />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const slider = within(control).getByRole(
      'slider',
      { name: 'Displayed cell limit' },
    ) as HTMLInputElement;

    expect(slider.max).toBe('109');
    expect(slider.value).toBe('19');
    expect(slider.getAttribute('aria-valuetext')).toContain('2,000 Cells');
    expect(control.getAttribute('data-cell-display-capacity')).toBe('20000');
    expect(control.getAttribute('data-cell-display-source-capacity')).toBe('2000');

    fireEvent.change(slider, { target: { value: '109' } });

    expect(getCellDisplayRuntimeSnapshot()).toEqual({
      mode: 'manual',
      manualLimit: 20_000,
    });
    expect(control.getAttribute('data-cell-display-limit')).toBe('20000');
    expect(control.getAttribute('data-cell-display-count')).toBe('2000');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('2K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('CAP20K');
    expect(control.getAttribute('title')).toContain(
      'server currently retains 2,000',
    );
  });

  it('separates the shown count from the cap while exposing unused headroom', () => {
    render(
      <StatusStrip level="nominal" uptimeMs={0} cellCount={2_700} />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const automatic = within(control).getByRole(
      'button',
      { name: 'Automatic cell count' },
    );
    const slider = within(control).getByRole(
      'slider',
      { name: 'Displayed cell limit' },
    ) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '59' } });

    expect(getCellDisplayRuntimeSnapshot()).toEqual({
      mode: 'manual',
      manualLimit: 7_500,
    });
    expect(control.getAttribute('data-cell-display-count')).toBe('2700');
    expect(control.getAttribute('data-cell-display-available')).toBe('2700');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('2.7K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('CAP7.5K');
    expect(control.querySelector('[data-cell-display-headroom]')).not.toBeNull();
    expect(control.querySelector('[data-cell-display-shown-marker]')).not.toBeNull();
    expect(control.querySelector('[data-cell-display-cap-marker]')).not.toBeNull();
    expect(automatic.textContent).toContain('MAN');
    expect(slider.getAttribute('aria-valuetext')).toContain(
      '2,700 shown of 2,700 available',
    );

    fireEvent.change(slider, { target: { value: '53' } });

    expect(control.getAttribute('data-cell-display-count')).toBe('2700');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('CAP6K');

    fireEvent.change(slider, { target: { value: '19' } });

    expect(control.getAttribute('data-cell-display-count')).toBe('2000');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('2K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('CAP2K');
    expect(control.querySelector('[data-cell-display-headroom]')).toBeNull();
    expect(control.querySelector('[data-cell-display-shown-marker]')).toBeNull();
  });

  it('offers an always-visible auto/high/med/low render-quality control', () => {
    render(<StatusStrip level="nominal" uptimeMs={0} />);
    const control = screen.getByRole('group', { name: 'Render quality' });
    const scoped = within(control);

    expect(control.querySelector('[data-quality-rail]')).not.toBeNull();
    expect(scoped.getAllByRole('button')).toHaveLength(4);
    expect(
      scoped.getByRole('button', { name: 'Auto render quality' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(scoped.getByRole('button', { name: 'High render quality' })).not.toBeNull();
    expect(scoped.getByRole('button', { name: 'Med render quality' })).not.toBeNull();
    expect(scoped.getByRole('button', { name: 'Low render quality' })).not.toBeNull();
    expect(control.getAttribute('data-quality-effective')).toBe('high');
  });

  it('applies a manual quality mode and synchronizes the developer control', () => {
    render(<StatusStrip level="nominal" uptimeMs={0} />);
    const low = screen.getByRole('button', { name: 'Low render quality' });

    fireEvent.click(low);

    expect(levaMocks.setQuality).toHaveBeenCalledWith({ quality: 'low' });
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'low',
      effective: 'low',
      source: 'manual',
    });
    expect(low.getAttribute('aria-pressed')).toBe('true');
  });
});
