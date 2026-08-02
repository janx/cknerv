import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Jukebox, {
  DEFAULT_JUKEBOX_TRACK_ID,
  JUKEBOX_BUTTON_SIZE_PX,
  JUKEBOX_PANEL_WIDTH_PX,
  JUKEBOX_PLAYER_HEIGHT_PX,
  JUKEBOX_TRACKS,
  KOMM_VOCAL_FADE_START_MS,
  KOMM_VOCAL_LOOP_AT_MS,
  SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX,
  SOUNDCLOUD_PLAYER_SCALE,
  SOUNDCLOUD_WIDGET_API_SRC,
} from '../src/Jukebox';

const MICHELLE_TRACK = JUKEBOX_TRACKS[0];
const ARIANNE_TRACK = JUKEBOX_TRACKS[1];
const ARIA_PIANO_TRACK = JUKEBOX_TRACKS[2];
const SHEET_MUSIC_BOSS_TRACK = JUKEBOX_TRACKS[3];

type WidgetEvent = { currentPosition?: number };
type WidgetListener = (event?: WidgetEvent) => void;

function installWidgetMock(volume = 80) {
  const listeners = new Map<string, WidgetListener>();
  const widget = {
    bind: vi.fn((eventName: string, listener: WidgetListener) => {
      listeners.set(eventName, listener);
    }),
    unbind: vi.fn((eventName: string) => listeners.delete(eventName)),
    getPosition: vi.fn((callback: (position: number) => void) => callback(0)),
    getVolume: vi.fn((callback: (value: number) => void) => callback(volume)),
    pause: vi.fn(),
    play: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
  };
  const Events = {
    FINISH: 'finish',
    PLAY: 'play',
    PLAY_PROGRESS: 'play-progress',
    SEEK: 'seek',
  };
  const factory = Object.assign(vi.fn(() => widget), { Events });
  Object.defineProperty(window, 'SC', {
    configurable: true,
    value: { Widget: factory },
  });
  return { Events, factory, listeners, widget };
}

afterEach(() => {
  cleanup();
  document
    .querySelector('script[data-cknerv-soundcloud-widget-api="true"]')
    ?.remove();
  delete window.SC;
});

describe('Jukebox', () => {
  it('defines the four named tracks and preserves their sources', () => {
    expect(JUKEBOX_TRACKS.map((track) => track.id)).toEqual([
      'michelle-vocal',
      'arianne-vocal',
      'aria-piano',
      'sheet-music-boss-piano',
    ]);
    expect(JUKEBOX_TRACKS.map((track) => track.name)).toEqual([
      'Vocal A',
      'Vocal B',
      'Piano A',
      'Piano B',
    ]);
    expect(ARIANNE_TRACK.trackUrl).toBe(
      'https://soundcloud.com/wisdomdawn/25-komm-susser-tod-come-sweet-death-arianne',
    );
    expect(ARIANNE_TRACK.embedUrl).toContain('tracks%2F9463141');
    expect(ARIANNE_TRACK.fadeStartMs).toBe(KOMM_VOCAL_FADE_START_MS);
    expect(ARIANNE_TRACK.loopAtMs).toBe(KOMM_VOCAL_LOOP_AT_MS);
    expect(SHEET_MUSIC_BOSS_TRACK.trackUrl).toBe(
      'https://soundcloud.com/makka-pakka-915586059/komm-suesser-tod-the-end-of',
    );
    expect(SHEET_MUSIC_BOSS_TRACK.embedUrl).toContain(
      'tracks%2F1921367153',
    );
  });

  it('loads no third-party content until clicked, then requests default autoplay', () => {
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    });

    expect(DEFAULT_JUKEBOX_TRACK_ID).toBe(MICHELLE_TRACK.id);
    expect(JUKEBOX_TRACKS).toHaveLength(4);
    expect(JUKEBOX_TRACKS.every((track) => (
      track.embedUrl.includes('auto_play=true')
    ))).toBe(true);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(opener.textContent).toBe('');
    expect(container.querySelector('.cknerv-top-bar-action-label')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();

    fireEvent.click(opener);

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    for (const track of JUKEBOX_TRACKS) {
      expect(screen.getByText(track.name)).toBeTruthy();
      expect(screen.getByRole('button', {
        name: `Select ${track.name}`,
      })).toBeTruthy();
    }
    const frame = screen.getByTitle(
      MICHELLE_TRACK.frameTitle,
    ) as HTMLIFrameElement;
    expect(opener.isConnected).toBe(false);
    expect(screen.queryByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
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
    expect(panel.getAttribute('data-jukebox-loop')).toBe('infinite');
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
    expect(screen.getByRole('button', {
      name: ARIANNE_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', {
      name: SHEET_MUSIC_BOSS_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
  });

  it('loads the widget controller lazily and loops a finished track', async () => {
    const { Events, factory, listeners, widget } = installWidgetMock();
    render(<Jukebox />);

    expect(document.querySelector(`script[src="${SOUNDCLOUD_WIDGET_API_SRC}"]`))
      .toBeNull();
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    const frame = screen.getByTitle(MICHELLE_TRACK.frameTitle);
    fireEvent.load(frame);

    await waitFor(() => expect(factory).toHaveBeenCalledWith(frame));
    listeners.get(Events.PLAY)?.();
    listeners.get(Events.FINISH)?.();

    expect(widget.pause).toHaveBeenCalledTimes(1);
    expect(widget.setVolume).toHaveBeenNthCalledWith(1, 0);
    expect(widget.seekTo).toHaveBeenCalledWith(0);
    expect(widget.setVolume).toHaveBeenNthCalledWith(2, 80);
    expect(widget.play).toHaveBeenCalledTimes(1);
  });

  it('fades the Arianne track from 5:55 and loops it at 6:00', async () => {
    const { Events, factory, listeners, widget } = installWidgetMock(80);
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: ARIANNE_TRACK.selectorLabel,
    }));

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    const frame = screen.getByTitle(ARIANNE_TRACK.frameTitle);
    expect(panel.getAttribute('data-jukebox-fade-start-ms')).toBe(
      String(KOMM_VOCAL_FADE_START_MS),
    );
    expect(panel.getAttribute('data-jukebox-loop-at-ms')).toBe(
      String(KOMM_VOCAL_LOOP_AT_MS),
    );
    fireEvent.load(frame);
    await waitFor(() => expect(factory).toHaveBeenCalledWith(frame));

    listeners.get(Events.PLAY_PROGRESS)?.({
      currentPosition: KOMM_VOCAL_FADE_START_MS,
    });
    listeners.get(Events.PLAY_PROGRESS)?.({ currentPosition: 357_500 });
    expect(widget.setVolume).toHaveBeenLastCalledWith(40);

    listeners.get(Events.PLAY_PROGRESS)?.({
      currentPosition: KOMM_VOCAL_LOOP_AT_MS,
    });
    expect(widget.pause).toHaveBeenCalledTimes(1);
    expect(widget.setVolume).toHaveBeenCalledWith(0);
    expect(widget.seekTo).toHaveBeenCalledWith(0);
    expect(widget.setVolume).toHaveBeenLastCalledWith(80);
    expect(widget.play).toHaveBeenCalledTimes(1);
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

  it('contains SoundCloud teardown errors while switching tracks', async () => {
    const { factory, widget } = installWidgetMock();
    const iframeConnectionStates: boolean[] = [];
    const { container } = render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

    const michelleFrame = screen.getByTitle(MICHELLE_TRACK.frameTitle);
    fireEvent.load(michelleFrame);
    await waitFor(() => expect(factory).toHaveBeenCalledWith(michelleFrame));
    widget.unbind.mockImplementation(() => {
      iframeConnectionStates.push(michelleFrame.isConnected);
      throw new TypeError(
        "Cannot read properties of null (reading 'postMessage')",
      );
    });

    fireEvent.click(screen.getByRole('button', {
      name: ARIANNE_TRACK.selectorLabel,
    }));

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    expect(iframeConnectionStates).toEqual([true, true, true, true]);
    expect(widget.unbind).toHaveBeenCalledTimes(4);
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      ARIANNE_TRACK.id,
    );
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(screen.getByTitle(ARIANNE_TRACK.frameTitle)).toBeTruthy();
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

  it('docks a compact trigger and player in the bottom-right corner', () => {
    const { container } = render(<Jukebox />);
    const floating = container.querySelector('[data-jukebox]') as HTMLElement;
    const opener = screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    });

    expect(floating.style.position).toBe('fixed');
    expect(floating.style.right).toContain('safe-area-inset-right');
    expect(floating.style.bottom).toContain('safe-area-inset-bottom');
    expect(opener.style.width).toBe(`${JUKEBOX_BUTTON_SIZE_PX}px`);
    expect(opener.style.height).toBe(`${JUKEBOX_BUTTON_SIZE_PX}px`);

    fireEvent.click(opener);

    const panel = screen.getByRole('dialog', {
      name: 'SoundCloud Jukebox',
    }) as HTMLElement;
    const player = panel.querySelector('[data-jukebox-player]') as HTMLElement;
    const frame = panel.querySelector('iframe') as HTMLIFrameElement;
    expect(floating.getAttribute('data-jukebox-open')).toBe('true');
    expect(panel.style.position).toBe('relative');
    expect(panel.style.right).toBe('');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.top).toBe('');
    expect(panel.style.left).toBe('');
    expect(panel.style.transform).toBe('');
    expect(JUKEBOX_PANEL_WIDTH_PX).toBe(332);
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
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
    expect(container.querySelector('iframe')).toBeNull();
    const restoredOpener = screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    });
    expect(document.activeElement).toBe(restoredOpener);

    fireEvent.click(restoredOpener);
    expect(container.querySelector('iframe')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
  });

  it('keeps a manual track choice for the current page session', () => {
    const { container } = render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: ARIA_PIANO_TRACK.selectorLabel,
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

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

  it('keeps Jukebox interactions inside the floating control', () => {
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
