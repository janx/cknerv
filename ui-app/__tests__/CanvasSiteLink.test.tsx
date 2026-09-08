import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CanvasSiteLink from '../src/CanvasSiteLink';

afterEach(cleanup);

describe('CanvasSiteLink', () => {
  it('opens the site in a new tab without triggering canvas interactions', () => {
    const onPointerDown = vi.fn();
    const onClick = vi.fn();
    render(
      <div onPointerDown={onPointerDown} onClick={onClick}>
        <CanvasSiteLink />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'WEB5.INFO' });
    expect(link.getAttribute('href')).toBe('https://web5.info/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.pointerDown(link);
    fireEvent.click(link);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can dock independently when the sound module is hidden', () => {
    render(<CanvasSiteLink floating />);
    const link = screen.getByRole('link', { name: 'WEB5.INFO' });
    expect(link.style.position).toBe('fixed');
    expect(link.style.right).toContain('safe-area-inset-right');
    expect(link.style.bottom).toContain('safe-area-inset-bottom');
    expect(link.getAttribute('href')).toBe('https://web5.info/');
  });
});
