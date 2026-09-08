import type { ReactNode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CkbNodeAnchor } from '../../src/components/CellGalaxy';

// Render the anchor's real label and event handlers; only the WebGL host is
// replaced. This checks that renaming the DOM word never changes a pick id.
vi.mock('@react-three/fiber', async (original) => {
  const canvas = document.createElement('canvas');
  const state = { gl: { domElement: canvas } };
  return {
    ...await original<typeof import('@react-three/fiber')>(),
    useThree: (select: (value: typeof state) => unknown) => select(state),
    useFrame: () => {},
  };
});
vi.mock('@react-three/drei', async (original) => ({
  ...await original<typeof import('@react-three/drei')>(),
  Html: ({ children }: { children: ReactNode }) => <>{children}</>,
  Billboard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

describe('hosted chain anchor', () => {
  it('preserves the exact name as text while placement and selection keep the node id', () => {
    const select = vi.fn();
    const props = { id: 'ckb:local', position: [1, 2, 3] as [number, number, number], selected: false, onSelect: select };
    const { container, rerender } = render(<CkbNodeAnchor {...props} />);
    const anchor = container.querySelector('group');
    const readLabel = () => container.querySelector<HTMLElement>('[data-ckb-node-label="ckb:local"]')!;
    expect(readLabel().textContent).toBe('LOCAL');

    for (const label of ['Little Otter', '小水獭 "Node" <img src=x> '.repeat(20)]) {
      rerender(<CkbNodeAnchor {...props} label={label} />);
      expect(readLabel().textContent).toBe(label);
      expect(readLabel().title).toBe(label);
      expect(readLabel().style.textTransform).toBe('none');
      expect(readLabel().style.textOverflow).toBe('ellipsis');
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('group')).toBe(anchor);
      expect(anchor?.getAttribute('position')).toBe('1,2,3');
      const hitTarget = Array.from(container.querySelectorAll('mesh')).at(-1)!;
      fireEvent.click(hitTarget);
      expect(select).toHaveBeenLastCalledWith('ckb:local');
    }
    rerender(<CkbNodeAnchor {...props} />);
    expect(readLabel().textContent).toBe('LOCAL');
    expect(readLabel().style.textTransform).toBe('uppercase');
  });
});
