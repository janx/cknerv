import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CloseButton } from '../../../src/components/hud/primitives';

afterEach(cleanup);

describe('CloseButton', () => {
  it('renders a × and calls onClose on click', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CloseButton onClose={onClose} />);
    const btn = getByRole('button', { name: 'close' });
    expect(btn.textContent).toBe('×');
    expect((btn as HTMLElement).style.pointerEvents).toBe('auto');
    btn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
