import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Jukebox, {
  DEFAULT_JUKEBOX_PLAYBACK_MODE,
  DEFAULT_JUKEBOX_TRACK_ID,
  JUKEBOX_CHIP_HEIGHT_PX,
  JUKEBOX_MODULE_CODE,
  JUKEBOX_PANEL_WIDTH_PX,
  JUKEBOX_PLAYER_HEIGHT_PX,
  JUKEBOX_PLAYBACK_MODES,
  JUKEBOX_TRACKS,
  KOMM_VOCAL_FADE_START_MS,
  KOMM_VOCAL_LOOP_AT_MS,
  SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX,
  SOUNDCLOUD_PLAYER_SCALE,
  SOUNDCLOUD_WIDGET_API_SRC,
} from '../src/Jukebox';

const OPEN_LABEL = 'Open Jukebox and play default SoundCloud track';
const MICHELLE_TRACK = JUKEBOX_TRACKS[0];
const ARIANNE_TRACK = JUKEBOX_TRACKS[1];
const JOSETO_ARC_PIANO_TRACK = JUKEBOX_TRACKS[2];
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
  vi.useRealTimers();
  vi.restoreAllMocks();
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
      'joseto-arc-piano',
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
    expect(JOSETO_ARC_PIANO_TRACK.trackUrl).toBe(
      'https://soundcloud.com/joseto-arc/evangelion-tsubasa-wo-kudasai?utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing',
    );
    expect(JOSETO_ARC_PIANO_TRACK.embedUrl).toContain(
      'tracks%2F499687749',
    );
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
    expect(opener.textContent).toContain('BGM');
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
    expect(DEFAULT_JUKEBOX_PLAYBACK_MODE).toBe('single');
    expect(panel.getAttribute('data-jukebox-playback-mode')).toBe('single');
    expect(JUKEBOX_PLAYBACK_MODES.map((mode) => mode.id)).toEqual([
      'single',
      'random',
    ]);
    expect(screen.getByRole('button', {
      name: 'Repeat selected track indefinitely',
    }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', {
      name: 'Play tracks randomly indefinitely',
    }).getAttribute('aria-pressed')).toBe('false');
    expect(frame.getAttribute('src')).toContain('visual=false');
    expect(frame.getAttribute('src')).toContain('show_comments=false');
    expect(frame.getAttribute('src')).not.toContain('youtube.com');
    expect(frame.hasAttribute('allowfullscreen')).toBe(false);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);

    expect(screen.getByRole('button', {
      name: MICHELLE_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', {
      name: JOSETO_ARC_PIANO_TRACK.selectorLabel,
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

  it('plays a different random track after every finish', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { Events, factory, listeners, widget } = installWidgetMock();
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Play tracks randomly indefinitely',
    }));

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    const michelleFrame = screen.getByTitle(MICHELLE_TRACK.frameTitle);
    fireEvent.load(michelleFrame);
    await waitFor(() => expect(factory).toHaveBeenCalledWith(michelleFrame));

    act(() => listeners.get(Events.FINISH)?.());

    expect(panel.getAttribute('data-jukebox-playback-mode')).toBe('random');
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      ARIANNE_TRACK.id,
    );
    expect(widget.pause).toHaveBeenCalledTimes(1);
    expect(widget.seekTo).not.toHaveBeenCalled();

    const arianneFrame = screen.getByTitle(ARIANNE_TRACK.frameTitle);
    fireEvent.load(arianneFrame);
    await waitFor(() => expect(factory).toHaveBeenCalledWith(arianneFrame));
    act(() => listeners.get(Events.FINISH)?.());

    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      MICHELLE_TRACK.id,
    );
    expect(widget.pause).toHaveBeenCalledTimes(2);
    expect(widget.seekTo).not.toHaveBeenCalled();
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

  it('uses the Arianne cutoff as the next-track point in random mode', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { Events, factory, listeners, widget } = installWidgetMock(80);
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: ARIANNE_TRACK.selectorLabel,
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Play tracks randomly indefinitely',
    }));

    const panel = screen.getByRole('dialog', { name: 'SoundCloud Jukebox' });
    const frame = screen.getByTitle(ARIANNE_TRACK.frameTitle);
    fireEvent.load(frame);
    await waitFor(() => expect(factory).toHaveBeenCalledWith(frame));

    act(() => listeners.get(Events.PLAY_PROGRESS)?.({
      currentPosition: KOMM_VOCAL_FADE_START_MS,
    }));
    act(() => listeners.get(Events.PLAY_PROGRESS)?.({
      currentPosition: KOMM_VOCAL_LOOP_AT_MS,
    }));

    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      MICHELLE_TRACK.id,
    );
    expect(widget.setVolume).toHaveBeenLastCalledWith(80);
    expect(widget.pause).toHaveBeenCalledTimes(1);
    expect(widget.seekTo).not.toHaveBeenCalled();
    expect(widget.play).not.toHaveBeenCalled();
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
      name: JOSETO_ARC_PIANO_TRACK.selectorLabel,
    }));

    const pianoFrame = screen.getByTitle(
      JOSETO_ARC_PIANO_TRACK.frameTitle,
    ) as HTMLIFrameElement;
    expect(michelleFrame.isConnected).toBe(false);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(pianoFrame.getAttribute('src')).toBe(
      JOSETO_ARC_PIANO_TRACK.embedUrl,
    );
    expect(panel.getAttribute('data-jukebox-selected-track')).toBe(
      JOSETO_ARC_PIANO_TRACK.id,
    );
    expect(panel.getAttribute('data-jukebox-frame-ready')).toBe('false');
    expect(panel.textContent).toContain('SOUNDCLOUD CONNECTING');

    expect(screen.getByRole('button', {
      name: MICHELLE_TRACK.selectorLabel,
    }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', {
      name: JOSETO_ARC_PIANO_TRACK.selectorLabel,
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
    expect(opener.style.height).toBe(`${JUKEBOX_CHIP_HEIGHT_PX}px`);

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
      name: JOSETO_ARC_PIANO_TRACK.selectorLabel,
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Jukebox and play default SoundCloud track',
    }));

    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      JOSETO_ARC_PIANO_TRACK.embedUrl,
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
      name: JOSETO_ARC_PIANO_TRACK.selectorLabel,
    }));
    expect(screen.getByRole('link', {
      name: 'Open piano version by JOSETO ARC on SoundCloud',
    }).getAttribute('href')).toBe(JOSETO_ARC_PIANO_TRACK.trackUrl);
  });

  it('names itself as a console module instead of hiding behind a glyph', () => {
    render(<Jukebox />);
    const opener = screen.getByRole('button', { name: OPEN_LABEL });

    expect(opener.textContent).toContain('BGM');
    expect(opener.textContent).toContain(JUKEBOX_MODULE_CODE);
    expect(opener.querySelectorAll('.cknerv-jukebox-bar')).toHaveLength(3);
    expect(document.getElementById('cknerv-jukebox-style')).not.toBeNull();
  });

  it('never names a track while the player is closed', () => {
    vi.useFakeTimers();
    const { container } = render(<Jukebox />);
    const opener = screen.getByRole('button', { name: OPEN_LABEL });

    // No timer, no hover and no reopen may put a title on the closed chip.
    act(() => vi.advanceTimersByTime(600_000));
    fireEvent.pointerEnter(opener);
    act(() => vi.advanceTimersByTime(600_000));

    const closedText = [
      container.querySelector('[data-jukebox]')?.textContent ?? '',
      opener.getAttribute('aria-label') ?? '',
      opener.getAttribute('title') ?? '',
    ].join(' ').toUpperCase();
    for (const track of JUKEBOX_TRACKS) {
      expect(closedText).not.toContain(track.artist.toUpperCase());
      expect(closedText).not.toContain(track.name.toUpperCase());
    }
    expect(closedText).not.toContain('TSUBASA');
    expect(closedText).not.toContain('KOMM');
  });

  it('stops attracting for good once the player has been opened', () => {
    vi.useFakeTimers();
    render(<Jukebox />);
    fireEvent.click(screen.getByRole('button', { name: OPEN_LABEL }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Close Jukebox player',
    }));

    const opener = screen.getByRole('button', { name: OPEN_LABEL });
    expect(opener.getAttribute('data-jukebox-attract')).toBe('settled');

    act(() => vi.advanceTimersByTime(600_000));
    expect(opener.getAttribute('data-jukebox-attract')).toBe('settled');
  });

  it('ticks the equalizer once per block arrival', () => {
    const { container, rerender } = render(<Jukebox blockPulseAtMs={1_000} />);
    const bars = container.querySelector('.cknerv-jukebox-bars');

    rerender(<Jukebox blockPulseAtMs={1_000} />);
    expect(container.querySelector('.cknerv-jukebox-bars')).toBe(bars);

    rerender(<Jukebox blockPulseAtMs={2_000} />);
    expect(container.querySelector('.cknerv-jukebox-bars')).not.toBe(bars);
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
      name: JOSETO_ARC_PIANO_TRACK.selectorLabel,
    }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
