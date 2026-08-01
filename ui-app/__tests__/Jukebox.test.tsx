import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Jukebox, {
  DEFAULT_JUKEBOX_TRACK_ID,
  JUKEBOX_TRACKS,
} from '../src/Jukebox';

const MYUK_TRACK = JUKEBOX_TRACKS[0];
const ISO_PIANO_TRACK = JUKEBOX_TRACKS[1];

afterEach(() => cleanup());

describe('Jukebox', () => {
  it('loads no third-party content until opened, then defaults to Myuk', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    });

    expect(DEFAULT_JUKEBOX_TRACK_ID).toBe(MYUK_TRACK.id);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('iframe')).toBeNull();

    fireEvent.click(opener);

    const panel = screen.getByRole('dialog', { name: 'YouTube Jukebox' });
    const frame = screen.getByTitle(MYUK_TRACK.frameTitle) as HTMLIFrameElement;
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      MYUK_TRACK.id,
    );
    expect(frame.getAttribute('src')).toBe(MYUK_TRACK.embedUrl);
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('referrerpolicy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(frame.getAttribute('allow')).toContain('autoplay');
    expect(frame.hasAttribute('autoplay')).toBe(false);
    expect(frame.getAttribute('src')).not.toContain('autoplay');
    expect(container.querySelectorAll('iframe')).toHaveLength(1);

    expect(screen.getByRole('button', {
      name: MYUK_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', {
      name: ISO_PIANO_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
  });

  it('switches to the piano version by replacing, not stacking, players', () => {
    const { container } = render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    }));

    const panel = screen.getByRole('dialog', { name: 'YouTube Jukebox' });
    const myukFrame = screen.getByTitle(MYUK_TRACK.frameTitle);
    fireEvent.load(myukFrame);
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');

    fireEvent.click(screen.getByRole('button', {
      name: ISO_PIANO_TRACK.selectorLabel,
    }));

    const pianoFrame = screen.getByTitle(
      ISO_PIANO_TRACK.frameTitle,
    ) as HTMLIFrameElement;
    expect(myukFrame.isConnected).toBe(false);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(pianoFrame.getAttribute('src')).toBe(ISO_PIANO_TRACK.embedUrl);
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      ISO_PIANO_TRACK.id,
    );
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('false');
    expect(panel.textContent).toContain('YOUTUBE CONNECTING');

    expect(screen.getByRole('button', {
      name: MYUK_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', {
      name: ISO_PIANO_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.load(pianoFrame);
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');
    expect(panel.textContent).toContain('YOUTUBE READY');
  });

  it('reports readiness without claiming that playback started', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    }));

    const panel = screen.getByRole('dialog', { name: 'YouTube Jukebox' });
    const frame = screen.getByTitle(MYUK_TRACK.frameTitle);
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('false');
    expect(panel.textContent).toContain('YOUTUBE CONNECTING');
    expect(panel.textContent).not.toContain('PLAYING');

    fireEvent.load(frame);

    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');
    expect(panel.textContent).toContain('YOUTUBE READY');
    expect(panel.textContent).not.toContain('PLAYING');
  });

  it('docks a visible player in the bottom-right safe area', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    }));

    const panel = screen.getByRole('dialog', {
      name: 'YouTube Jukebox',
    }) as HTMLElement;
    const player = panel.querySelector('[data-jukebox-player]') as HTMLElement;
    expect(panel.style.right).toContain('safe-area-inset-right');
    expect(panel.style.bottom).toContain('safe-area-inset-bottom');
    expect(panel.style.top).toBe('');
    expect(panel.style.left).toBe('');
    expect(panel.style.transform).toBe('');
    expect(player.style.height).toContain('200px');
    expect(player.style.height).toContain('279px');
  });

  it('unmounts the player on close or Escape so audio cannot remain hidden', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
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

  it('keeps a manual track choice for the current page session', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    });

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', {
      name: ISO_PIANO_TRACK.selectorLabel,
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
    fireEvent.click(opener);

    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      ISO_PIANO_TRACK.embedUrl,
    );
  });

  it('opens the currently selected version on YouTube', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    }));

    const myukLink = screen.getByRole('link', {
      name: 'Open vocal version by MYUK on YouTube',
    });
    expect(myukLink.getAttribute('href')).toBe(MYUK_TRACK.watchUrl);
    expect(myukLink.getAttribute('target')).toBe('_blank');
    expect(myukLink.getAttribute('rel')).toBe('noopener noreferrer');

    fireEvent.click(screen.getByRole('button', {
      name: ISO_PIANO_TRACK.selectorLabel,
    }));
    expect(screen.getByRole('link', {
      name: 'Open piano version by ISO PIANO on YouTube',
    }).getAttribute('href')).toBe(ISO_PIANO_TRACK.watchUrl);
  });

  it('keeps Jukebox interactions inside the HUD action', () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <Jukebox />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox; loads YouTube player',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: ISO_PIANO_TRACK.selectorLabel,
    }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
