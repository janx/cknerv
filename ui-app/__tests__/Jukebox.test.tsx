import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Jukebox, {
  SPOTIFY_EMBED_URL,
  SPOTIFY_TRACK_URL,
} from '../src/Jukebox';

afterEach(() => cleanup());

describe('Jukebox', () => {
  it('does not contact Spotify until the user opens the player', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox; loads Spotify content',
    });

    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('iframe')).toBeNull();

    fireEvent.click(opener);

    const frame = screen.getByTitle(
      'Spotify Embed: TSUBASA WO KUDASAI',
    ) as HTMLIFrameElement;
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(frame.getAttribute('src')).toBe(SPOTIFY_EMBED_URL);
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('allow')).toContain('autoplay');
    expect(frame.hasAttribute('autoplay')).toBe(false);
    expect(frame.getAttribute('src')).not.toContain('autoplay');
  });

  it('reports readiness without claiming that playback started', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads Spotify content',
    }));

    const panel = screen.getByRole('dialog', { name: 'Spotify Jukebox' });
    const frame = screen.getByTitle('Spotify Embed: TSUBASA WO KUDASAI');
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('false');
    expect(panel.textContent).toContain('SPOTIFY CONNECTING');
    expect(panel.textContent).not.toContain('PLAYING');

    fireEvent.load(frame);

    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');
    expect(panel.textContent).toContain('SPOTIFY READY');
    expect(panel.textContent).not.toContain('PLAYING');
  });

  it('unmounts the player on close or Escape so audio cannot remain hidden', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox; loads Spotify content',
    });

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    expect(container.querySelector('iframe')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('offers the exact Spotify track as an external fallback', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads Spotify content',
    }));

    const link = screen.getByRole('link', { name: 'Open in Spotify' });
    expect(link.getAttribute('href')).toBe(SPOTIFY_TRACK_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps Jukebox interactions inside the HUD action', () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <Jukebox />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads Spotify content',
    }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
