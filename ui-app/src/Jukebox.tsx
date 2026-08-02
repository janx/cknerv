import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

export const SOUNDCLOUD_WIDGET_API_SRC =
  'https://w.soundcloud.com/player/api.js';
export const KOMM_VOCAL_FADE_START_MS = 355_000;
export const KOMM_VOCAL_LOOP_AT_MS = 360_000;

export const JUKEBOX_TRACKS = [
  {
    id: 'michelle-vocal',
    kind: 'VOCAL',
    artist: 'MICHELLE ♥',
    duration: '05:24',
    selectorLabel: 'Select vocal version uploaded by Michelle',
    frameTitle: 'SoundCloud player: 翼をください — Michelle vocal upload',
    trackUrl: 'https://soundcloud.com/nuraminmi/tsubasa-wo-kudasai',
    embedUrl:
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F54664795&color=%2320f0ff&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false',
  },
  {
    id: 'aria-piano',
    kind: 'PIANO',
    artist: 'ARIALATE',
    duration: '04:36',
    selectorLabel: 'Select piano version by AriaLate',
    frameTitle: 'SoundCloud player: 翼をください — AriaLate piano',
    trackUrl:
      'https://soundcloud.com/arialate/evangelion-tsubasa-wo-kudasai-only-piano',
    embedUrl:
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F560812260&color=%2320f0ff&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false',
  },
  {
    id: 'arianne-vocal',
    kind: 'VOCAL',
    artist: 'ARIANNE',
    duration: '06:00',
    selectorLabel:
      'Select Arianne vocal version, fading at 5:55 and looping at 6:00',
    frameTitle:
      'SoundCloud player: Komm, süsser Tod — Arianne vocal upload',
    trackUrl:
      'https://soundcloud.com/wisdomdawn/25-komm-susser-tod-come-sweet-death-arianne',
    embedUrl:
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F9463141&color=%2320f0ff&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false',
    fadeStartMs: KOMM_VOCAL_FADE_START_MS,
    loopAtMs: KOMM_VOCAL_LOOP_AT_MS,
  },
  {
    id: 'sheet-music-boss-piano',
    kind: 'PIANO',
    artist: 'SHEET MUSIC BOSS',
    duration: '06:39',
    selectorLabel:
      'Select Komm, süsser Tod piano version by Sheet Music Boss',
    frameTitle:
      'SoundCloud player: Komm, süsser Tod — Sheet Music Boss piano upload',
    trackUrl:
      'https://soundcloud.com/makka-pakka-915586059/komm-suesser-tod-the-end-of',
    embedUrl:
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F1921367153&color=%2320f0ff&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false',
  },
] as const;

export type JukeboxTrackId = (typeof JUKEBOX_TRACKS)[number]['id'];

export const DEFAULT_JUKEBOX_TRACK_ID: JukeboxTrackId = 'michelle-vocal';
// Match the CELL MESH panel's 302px content width plus 15px inline padding.
export const JUKEBOX_PANEL_WIDTH_PX = 332;
export const JUKEBOX_BUTTON_SIZE_PX = 32;
export const SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX = 166;
export const SOUNDCLOUD_PLAYER_SCALE = 0.72;
export const JUKEBOX_PLAYER_HEIGHT_PX = Math.ceil(
  SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX * SOUNDCLOUD_PLAYER_SCALE,
);

const PANEL_ID = 'cknerv-jukebox-player';
const CYAN = 'var(--hud-cyanWire, #20F0FF)';
const ORANGE = 'var(--hud-orange, #FF9830)';
const INK = 'var(--hud-ink, #E8E8E8)';
const DIM = 'var(--hud-dim, #7C8794)';
const MONO = "'Share Tech Mono', ui-monospace, monospace";

interface SoundCloudWidgetEvent {
  currentPosition?: number;
}

interface SoundCloudWidget {
  bind: (
    eventName: string,
    listener: (event?: SoundCloudWidgetEvent) => void,
  ) => void;
  unbind: (eventName: string) => void;
  getPosition: (callback: (position: number) => void) => void;
  getVolume: (callback: (volume: number) => void) => void;
  pause: () => void;
  play: () => void;
  seekTo: (milliseconds: number) => void;
  setVolume: (volume: number) => void;
}

interface SoundCloudWidgetFactory {
  (iframe: HTMLIFrameElement): SoundCloudWidget;
  Events: {
    FINISH: string;
    PLAY: string;
    PLAY_PROGRESS: string;
    SEEK: string;
  };
}

declare global {
  interface Window {
    SC?: {
      Widget: SoundCloudWidgetFactory;
    };
  }
}

let soundCloudWidgetApiPromise: Promise<SoundCloudWidgetFactory> | null = null;

function soundCloudWidgetFactory() {
  return window.SC?.Widget;
}

function loadSoundCloudWidgetApi(): Promise<SoundCloudWidgetFactory> {
  const loadedFactory = soundCloudWidgetFactory();
  if (loadedFactory) return Promise.resolve(loadedFactory);

  const selector = 'script[data-cknerv-soundcloud-widget-api="true"]';
  const existingScript = document.querySelector<HTMLScriptElement>(selector);
  if (soundCloudWidgetApiPromise && existingScript) {
    return soundCloudWidgetApiPromise;
  }

  const script = existingScript ?? document.createElement('script');
  const request = new Promise<SoundCloudWidgetFactory>((resolve, reject) => {
    const onLoad = () => {
      const factory = soundCloudWidgetFactory();
      if (factory) {
        resolve(factory);
      } else {
        reject(new Error('SoundCloud Widget API loaded without SC.Widget'));
      }
    };
    const onError = () => {
      script.remove();
      reject(new Error('Unable to load SoundCloud Widget API'));
    };

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existingScript) {
      script.async = true;
      script.src = SOUNDCLOUD_WIDGET_API_SRC;
      script.dataset.cknervSoundcloudWidgetApi = 'true';
      document.head.appendChild(script);
    }
  });

  soundCloudWidgetApiPromise = request;
  void request.catch(() => {
    if (soundCloudWidgetApiPromise === request) {
      soundCloudWidgetApiPromise = null;
    }
  });
  return request;
}

const floatingStyle: CSSProperties = {
  position: 'fixed',
  right: 'max(14px, env(safe-area-inset-right, 0px))',
  bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
  zIndex: 22,
  display: 'inline-flex',
  alignItems: 'flex-end',
  justifyContent: 'flex-end',
  pointerEvents: 'auto',
  fontFamily: MONO,
};

const panelStyle: CSSProperties = {
  position: 'relative',
  width:
    `min(${JUKEBOX_PANEL_WIDTH_PX}px, calc(100vw - 28px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))`,
  maxHeight:
    'calc(100vh - 28px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: 6,
  border: '1px solid rgba(32,240,255,.24)',
  background:
    'linear-gradient(180deg,rgba(3,10,18,.97),rgba(0,0,0,.94))',
  boxShadow:
    '0 14px 36px rgba(0,0,0,.68), inset 0 0 24px rgba(32,240,255,.04)',
  backdropFilter: 'blur(8px)',
  pointerEvents: 'auto',
};

function getTrack(trackId: JukeboxTrackId) {
  return JUKEBOX_TRACKS.find((track) => track.id === trackId)
    ?? JUKEBOX_TRACKS[0];
}

function JukeboxGlyph({ active }: { active: boolean }) {
  const color = active ? CYAN : DIM;
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        flex: '0 0 auto',
        filter: active
          ? 'drop-shadow(0 0 4px rgba(32,240,255,.55))'
          : undefined,
      }}
    >
      <path
        d="M4 13V7.2a4 4 0 0 1 8 0V13M4 9h8M6 13V9h4v4"
        stroke={color}
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.3 6.8c.55-.52 1.06-.76 1.52-.76.7 0 .98.64 1.48.64.27 0 .54-.12.81-.36"
        stroke={active ? ORANGE : color}
        strokeWidth=".9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Jukebox() {
  const [open, setOpen] = useState(false);
  const [selectedTrackId, setSelectedTrackId] =
    useState<JukeboxTrackId>(DEFAULT_JUKEBOX_TRACK_ID);
  const [readyTrackId, setReadyTrackId] = useState<JukeboxTrackId | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const restoreFocusRef = useRef(false);
  const selectedTrack = getTrack(selectedTrackId);
  const frameReady = readyTrackId === selectedTrackId;
  const fadeStartMs = 'fadeStartMs' in selectedTrack
    ? selectedTrack.fadeStartMs
    : null;
  const loopAtMs = 'loopAtMs' in selectedTrack
    ? selectedTrack.loopAtMs
    : null;

  const close = useCallback(() => {
    restoreFocusRef.current = true;
    setOpen(false);
    setReadyTrackId(null);
  }, []);

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
      return;
    }
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    toggleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (!open || !frameReady || !frameRef.current) return;

    const iframe = frameRef.current;
    let disposed = false;
    let widget: SoundCloudWidget | null = null;
    let boundEvents: string[] = [];

    void loadSoundCloudWidgetApi().then((factory) => {
      if (disposed) return;

      widget = factory(iframe);
      const events = factory.Events;
      let normalVolume = 100;
      let fadeBaseVolume: number | null = null;
      let resolvingFadeVolume = false;
      let restarting = false;
      let lastPosition = 0;

      const clampVolume = (volume: number) => (
        Number.isFinite(volume)
          ? Math.min(100, Math.max(0, volume))
          : 100
      );

      const restoreFadeVolume = () => {
        const restoreVolume = fadeBaseVolume ?? normalVolume;
        widget?.setVolume(restoreVolume);
        normalVolume = restoreVolume;
        fadeBaseVolume = null;
        resolvingFadeVolume = false;
      };

      const performRestart = (restoreVolume: number) => {
        if (!widget || disposed) return;
        widget.pause();
        widget.setVolume(0);
        widget.seekTo(0);
        widget.setVolume(restoreVolume);
        widget.play();
        normalVolume = restoreVolume;
        fadeBaseVolume = null;
        resolvingFadeVolume = false;
      };

      const restart = () => {
        if (!widget || restarting) return;
        restarting = true;
        if (fadeBaseVolume !== null) {
          performRestart(fadeBaseVolume);
          return;
        }
        widget.getVolume((volume) => {
          if (!disposed) performRestart(clampVolume(volume));
        });
      };

      const applyPosition = (position: number) => {
        if (!widget || disposed || !Number.isFinite(position)) return;
        lastPosition = position;

        if (restarting) {
          if (position <= 1_000) {
            restarting = false;
          } else {
            return;
          }
        }

        if (loopAtMs !== null && position >= loopAtMs) {
          restart();
          return;
        }

        if (fadeStartMs === null || loopAtMs === null) return;
        if (position < fadeStartMs) {
          if (fadeBaseVolume !== null) restoreFadeVolume();
          return;
        }

        if (fadeBaseVolume === null) {
          if (resolvingFadeVolume) return;
          resolvingFadeVolume = true;
          widget.getVolume((volume) => {
            if (disposed || !widget) return;
            resolvingFadeVolume = false;
            fadeBaseVolume = clampVolume(volume);
            normalVolume = fadeBaseVolume;
            applyPosition(lastPosition);
          });
          return;
        }

        const fadeProgress = (position - fadeStartMs)
          / (loopAtMs - fadeStartMs);
        widget.setVolume(Math.round(
          fadeBaseVolume * Math.max(0, 1 - fadeProgress),
        ));
      };

      const onProgress = (event?: SoundCloudWidgetEvent) => {
        if (typeof event?.currentPosition !== 'number') return;
        applyPosition(event.currentPosition);
      };
      const onPlay = () => {
        widget?.getPosition(applyPosition);
        if (fadeBaseVolume !== null) return;
        widget?.getVolume((volume) => {
          if (!disposed && fadeBaseVolume === null) {
            normalVolume = clampVolume(volume);
          }
        });
      };

      widget.bind(events.PLAY_PROGRESS, onProgress);
      widget.bind(events.SEEK, onProgress);
      widget.bind(events.PLAY, onPlay);
      widget.bind(events.FINISH, restart);
      boundEvents = [
        events.PLAY_PROGRESS,
        events.SEEK,
        events.PLAY,
        events.FINISH,
      ];
    }).catch(() => {
      // The native player remains usable if its optional controller is blocked.
    });

    return () => {
      disposed = true;
      if (!widget) return;
      boundEvents.forEach((eventName) => widget?.unbind(eventName));
    };
  }, [fadeStartMs, frameReady, loopAtMs, open, selectedTrackId]);

  return (
    <div
      data-jukebox
      data-jukebox-open={open ? 'true' : 'false'}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={floatingStyle}
    >
      {!open ? (
        <button
          ref={toggleRef}
          type="button"
          className="cknerv-hud-control-button"
          data-jukebox-trigger
          aria-controls={PANEL_ID}
          aria-expanded={false}
          aria-label="Open Jukebox and play default SoundCloud track"
          title="Open Jukebox — load SoundCloud and request playback"
          onClick={() => {
            setReadyTrackId(null);
            setOpen(true);
          }}
          style={{
            appearance: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: JUKEBOX_BUTTON_SIZE_PX,
            height: JUKEBOX_BUTTON_SIZE_PX,
            padding: 0,
            border: '1px solid rgba(32,240,255,.3)',
            background:
              'linear-gradient(180deg,rgba(3,10,18,.96),rgba(0,0,0,.94))',
            boxShadow:
              '0 8px 24px rgba(0,0,0,.6), inset 0 0 16px rgba(32,240,255,.045)',
            color: CYAN,
            cursor: 'pointer',
          }}
        >
          <JukeboxGlyph active />
        </button>
      ) : null}

      {open ? (
        <section
          id={PANEL_ID}
          role="dialog"
          aria-label="SoundCloud Jukebox"
          data-jukebox-panel
          data-jukebox-provider="soundcloud"
          data-jukebox-autoplay="requested"
          data-jukebox-loop="infinite"
          data-jukebox-selected-track={selectedTrackId}
          data-jukebox-frame-ready={frameReady ? 'true' : 'false'}
          data-jukebox-fade-start-ms={fadeStartMs ?? undefined}
          data-jukebox-loop-at-ms={loopAtMs ?? undefined}
          style={panelStyle}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              minHeight: 22,
              padding: '0 2px 5px',
              fontFamily: MONO,
              fontSize: 8.5,
              letterSpacing: 1.05,
              color: DIM,
            }}
          >
            <span style={{ color: ORANGE, letterSpacing: 1.4 }}>JUKEBOX</span>
            <span style={{ margin: '0 7px', color: 'rgba(124,135,148,.45)' }}>
              //
            </span>
            <span
              aria-live="polite"
              data-jukebox-load-state={frameReady ? 'ready' : 'connecting'}
              style={{ color: frameReady ? CYAN : DIM }}
            >
              SOUNDCLOUD {frameReady ? 'READY' : 'CONNECTING'}
            </span>
            <span style={{ flex: 1 }} />
            <a
              href={selectedTrack.trackUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${selectedTrack.kind.toLowerCase()} version by ${selectedTrack.artist} on SoundCloud`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                color: INK,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              SOUNDCLOUD ↗
            </a>
            <button
              ref={closeRef}
              type="button"
              className="cknerv-hud-control-button"
              aria-label="Close Jukebox player"
              title="Close and stop playback"
              onClick={close}
              style={{
                appearance: 'none',
                width: 20,
                height: 18,
                marginLeft: 7,
                padding: 0,
                border: '1px solid rgba(32,240,255,.16)',
                background: 'rgba(0,0,0,.3)',
                color: DIM,
                font: `400 14px/16px ${MONO}`,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          <div
            role="group"
            aria-label="Choose Jukebox track"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 5,
              marginBottom: 7,
            }}
          >
            {JUKEBOX_TRACKS.map((track) => {
              const selected = track.id === selectedTrackId;
              return (
                <button
                  key={track.id}
                  type="button"
                  className="cknerv-hud-control-button"
                  data-jukebox-track={track.id}
                  aria-label={track.selectorLabel}
                  aria-pressed={selected}
                  onClick={() => {
                    if (selected) return;
                    setReadyTrackId(null);
                    setSelectedTrackId(track.id);
                  }}
                  style={{
                    appearance: 'none',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    alignItems: 'center',
                    minWidth: 0,
                    minHeight: 29,
                    padding: '4px 7px',
                    border: selected
                      ? '1px solid rgba(32,240,255,.52)'
                      : '1px solid rgba(124,135,148,.2)',
                    background: selected
                      ? 'linear-gradient(90deg,rgba(32,240,255,.1),rgba(32,240,255,.025))'
                      : 'rgba(0,0,0,.28)',
                    boxShadow: selected
                      ? 'inset 0 0 15px rgba(32,240,255,.04)'
                      : 'none',
                    color: selected ? CYAN : DIM,
                    font: `400 8.5px/15px ${MONO}`,
                    letterSpacing: .9,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: selected ? ORANGE : DIM }}>
                    {track.kind}
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      marginLeft: 7,
                      overflow: 'hidden',
                      color: selected ? INK : DIM,
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {track.artist}
                  </span>
                  <span style={{ marginLeft: 7, opacity: .72 }}>
                    {track.duration}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            data-jukebox-player
            style={{
              position: 'relative',
              width: '100%',
              height: JUKEBOX_PLAYER_HEIGHT_PX,
              overflow: 'hidden',
              border: '1px solid rgba(32,240,255,.12)',
              boxSizing: 'border-box',
              background: '#03080d',
              boxShadow:
                'inset 0 0 20px rgba(32,240,255,.035), 0 0 0 1px rgba(0,0,0,.7)',
            }}
          >
            <iframe
              key={selectedTrack.id}
              ref={frameRef}
              src={selectedTrack.embedUrl}
              title={selectedTrack.frameTitle}
              width={`${100 / SOUNDCLOUD_PLAYER_SCALE}%`}
              height={SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX}
              frameBorder="0"
              allow="autoplay; encrypted-media"
              loading="eager"
              scrolling="no"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setReadyTrackId(selectedTrack.id)}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'block',
                width: `${100 / SOUNDCLOUD_PLAYER_SCALE}%`,
                height: SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX,
                border: 0,
                background: '#000',
                filter:
                  'invert(0.9) hue-rotate(180deg) saturate(0.85) brightness(0.82) contrast(1.08)',
                transform: `scale(${SOUNDCLOUD_PLAYER_SCALE})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
