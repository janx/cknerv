import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CellConstellationLeaders } from '../../../src/components/hud/CellConstellationMarks';
import { createCellConstellationHandles } from '../../../src/components/hud/cellConstellationFrame';

afterEach(cleanup);

describe('CellConstellationLeaders', () => {
  it('covers the stage with a masked, non-interactive path layer', () => {
    const handles = createCellConstellationHandles();
    const { container } = render(
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen', 'reader']} />,
    );
    const svg = container.querySelector('svg[data-cell-constellation-leaders="true"]');
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('height')).toBe('100%');
    expect((svg as SVGElement).style.pointerEvents).toBe('none');
    expect(container.querySelector('[data-cell-constellation-mask-cuts="true"]')).not.toBeNull();
    expect(container.querySelectorAll('path')).toHaveLength(6);
    expect(container.querySelectorAll('[data-cell-leader-label]')).toHaveLength(3);
    for (const slot of ['analysis', 'specimen', 'reader']) {
      expect(container.querySelectorAll(`[data-cell-leader-label="${slot}"]`)).toHaveLength(1);
    }
  });

  it('removes the path and label when a module closes', () => {
    const handles = createCellConstellationHandles();
    const { container, rerender } = render(
      <CellConstellationLeaders handles={handles} slots={['analysis', 'specimen']} />,
    );
    rerender(<CellConstellationLeaders handles={handles} slots={['specimen']} />);
    expect(container.querySelector('[data-cell-leader="analysis"]')).toBeNull();
    expect(container.querySelector('[data-cell-leader-label="analysis"]')).toBeNull();
    expect(container.querySelectorAll('[data-cell-leader="specimen"]')).toHaveLength(1);
  });
});
