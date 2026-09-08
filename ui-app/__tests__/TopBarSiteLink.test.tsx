import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TopBarSiteLink from '../src/TopBarSiteLink';
import Jukebox from '../src/Jukebox';

afterEach(cleanup);

describe('TopBarSiteLink', () => {
  it('opens the site in a new tab without triggering canvas interactions', () => {
    const onPointerDown = vi.fn();
    const onClick = vi.fn();
    render(
      <div onPointerDown={onPointerDown} onClick={onClick}>
        <TopBarSiteLink />
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

  it.each(['close button', 'Escape'])(
    'stays visible while sound opens, closes via %s, and is disabled',
    (closeMethod) => {
      const { container, rerender } = render(<><TopBarSiteLink /><Jukebox /></>);
      const link = screen.getByRole('link', { name: 'WEB5.INFO' });
      expect(container.querySelector('[data-jukebox]')?.contains(link)).toBe(false);
      fireEvent.click(screen.getByRole('button', {
        name: 'Open Jukebox and play default SoundCloud track',
      }));
      expect(screen.getByRole('link', { name: 'WEB5.INFO' })).toBe(link);
      if (closeMethod === 'Escape') {
        fireEvent.keyDown(window, { key: 'Escape' });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Close Jukebox player' }));
      }
      expect(screen.getByRole('link', { name: 'WEB5.INFO' })).toBe(link);
      rerender(<><TopBarSiteLink /></>);
      expect(screen.getByRole('link', { name: 'WEB5.INFO' })).toBe(link);
      expect(container.querySelector('[data-jukebox]')).toBeNull();
    },
  );
});
