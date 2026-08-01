import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Jukebox, {
  DEFAULT_JUKEBOX_TRACK_ID,
  JUKEBOX_PANEL_WIDTH_PX,
  JUKEBOX_PLAYER_HEIGHT_PX,
  JUKEBOX_TRACKS,
  SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX,
  SOUNDCLOUD_PLAYER_SCALE,
} from '../src/Jukebox';

const MICHELLE_TRACK = JUKEBOX_TRACKS[0];
const ARIA_PIANO_TRACK = JUKEBOX_TRACKS[1];

afterEach(() => cleanup());

describe('Jukebox', () => {
  it('loads no third-party content until clicked, then requests Michelle autoplay', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    });

    expect(DEFAULT_JUKEBOX_TRACK_ID).toBe(MICHELLE_TRACK.id);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('iframe')).toBeNull();

    fireEvent.click(opener);

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    const frame = screen.getByTitle(
      MICHELLE_TRACK.frameTitle,
    ) as HTMLIFrameElement;
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      MICHELLE_TRACK.id,
    );
    expect(frame.getAttribute('src')).toBe(MICHELLE_TRACK.embedUrl);
    expect(frame.getAttribute('loading')).toBe('eager');
    expect(frame.getAttribute('referrerpolicy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(frame.getAttribute('allow')).toContain('autoplay');
    expect(frame.hasAttribute('autoplay')).toBe(false);
    expect(frame.getAttribute('src')).toContain('auto_play=true');
    expect(frame.getAttribute('src')).toContain('show_artwork=false');
    expect(frame.getAttribute('src')).toContain('show_playcount=false');
    expect(frame.getAttribute('src')).toContain('sharing=false');
    expect(panel.getAttribute('data-jukebox-autoplay')).toBe('requested');
    expect(frame.getAttribute('src')).toContain('visual=false');
    expect(frame.getAttribute('src')).toContain('show_comments=false');
    expect(frame.getAttribute('src')).not.toContain('youtube.com');
    expect(frame.hasAttribute('allowfullscreen')).toBe(false);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);

    expect(screen.getByRole('button', {
      name: MICHELLE_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
  });

  it('switches to the piano version by replacing, not stacking, players', () => {
    const { container } = render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    const michelleFrame = screen.getByTitle(MICHELLE_TRACK.frameTitle);
    fireEvent.load(michelleFrame);
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');

    fireEvent.click(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }));

    const pianoFrame = screen.getByTitle(
      ARIA_PIANO_TRACK.frameTitle,
    ) as HTMLIFrameElement;
    expect(michelleFrame.isConnected).toBe(false);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(pianoFrame.getAttribute('src')).toBe(ARIA_PIANO_TRACK.embedUrl);
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      ARIA_PIANO_TRACK.id,
    );
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('false');
    expect(panel.textContent).toContain('SOUNDCLOUD CONNECTING');

    expect(screen.getByRole('button', {
      name: MICHELLE_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.load(pianoFrame);
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');
    expect(panel.textContent).toContain('SOUNDCLOUD READY');
  });

  it('reports readiness without claiming that playback started', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    const frame = screen.getByTitle(MICHELLE_TRACK.frameTitle);
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('false');
    expect(panel.textContent).toContain('SOUNDCLOUD CONNECTING');
    expect(panel.textContent).not.toContain('PLAYING');

    fireEvent.load(frame);

    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('true');
    expect(panel.textContent).toContain('SOUNDCLOUD READY');
    expect(panel.textContent).not.toContain('PLAYING');
  });

  it('docks a compact darkened player in the bottom-right safe area', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

    const panel = screen.getByRole('dialog', {
      name: 'SoundCloud Jukebox',
    }) as HTMLElement;
    const player = panel.querySelector('[data-jukebox-player]') as HTMLElement;
    const frame = panel.querySelector('iframe') as HTMLIFrameElement;
    expect(panel.style.right).toContain('safe-area-inset-right');
    expect(panel.style.bottom).toContain('safe-area-inset-bottom');
    expect(panel.style.top).toBe('');
    expect(panel.style.left).toBe('');
    expect(panel.style.transform).toBe('');
    expect(panel.style.width).toContain(`${JUKEBOX_PANEL_WIDTH_PX}px`);
    expect(player.style.height).toBe(`${JUKEBOX_PLAYER_HEIGHT_PX}px`);
    expect(frame.getAttribute('height')).toBe(
      String(SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX),
    );
    expect(frame.style.transform).toBe(`scale(${SOUNDCLOUD_PLAYER_SCALE})`);
    expect(frame.style.filter).toContain('invert(0.9)');
  });

  it('unmounts the player on close or Escape so audio cannot remain hidden', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
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
      name: 'Open Jukebox and play default SoundCloud track',
    });

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
    fireEvent.click(opener);

    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      ARIA_PIANO_TRACK.embedUrl,
    );
  });

  it('opens the currently selected version on SoundCloud', () => {
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

    const michelleLink = screen.getByRole('link', {
      name: 'Open vocal version by MICHELLE ♥ on SoundCloud',
    });
    expect(michelleLink.getAttribute('href')).toBe(MICHELLE_TRACK.trackUrl);
    expect(michelleLink.getAttribute('target')).toBe('_blank');
    expect(michelleLink.getAttribute('rel')).toBe('noopener noreferrer');

    fireEvent.click(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }));
    expect(screen.getByRole('link', {
      name: 'Open piano version by ARIALATE on SoundCloud',
    }).getAttribute('href')).toBe(ARIA_PIANO_TRACK.trackUrl);
  });

  it('keeps Jukebox interactions inside the HUD action', () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <Jukebox />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
