import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

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
] as const;

export type JukeboxTrackId = (typeof JUKEBOX_TRACKS)[number]['id'];

export const DEFAULT_JUKEBOX_TRACK_ID: JukeboxTrackId = 'michelle-vocal';
export const JUKEBOX_PANEL_WIDTH_PX = 390;
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

const panelStyle: CSSProperties = {
  position: 'fixed',
  right: 'max(14px, env(safe-area-inset-right, 0px))',
  bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
  zIndex: 20,
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
  const selectedTrack = getTrack(selectedTrackId);
  const frameReady = readyTrackId === selectedTrackId;

  const close = useCallback(() => {
    setOpen(false);
    setReadyTrackId(null);
    toggleRef.current?.focus();
  }, []);

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

  return (
    <div
      data-jukebox
      data-jukebox-open={open ? 'true' : 'false'}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        paddingLeft: 12,
        borderLeft: '1px solid rgba(32,240,255,.1)',
        pointerEvents: 'auto',
        fontFamily: MONO,
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="cknerv-hud-control-button"
        aria-controls={PANEL_ID}
        aria-expanded={open}
        aria-label={open
          ? 'Close Jukebox and stop playback'
          : 'Open Jukebox and play default SoundCloud track'}
        title={open
          ? 'Close Jukebox and stop playback'
          : 'Open Jukebox — load SoundCloud and request playback'}
        onClick={() => {
          if (open) {
            close();
          } else {
            setReadyTrackId(null);
            setOpen(true);
          }
        }}
        style={{
          appearance: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 20,
          padding: '0 6px',
          border: 0,
          background: 'transparent',
          color: open ? CYAN : DIM,
          font: `400 8.5px/18px ${MONO}`,
          letterSpacing: 1.05,
          textShadow: open ? '0 0 7px rgba(32,240,255,.48)' : 'none',
          cursor: 'pointer',
          transition: 'color .14s, text-shadow .14s',
        }}
      >
        <JukeboxGlyph active={open} />
        <span className="cknerv-top-bar-action-label">JUKEBOX</span>
        <span
          aria-hidden="true"
          style={{
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: open ? CYAN : 'rgba(124,135,148,.46)',
            boxShadow: open ? '0 0 6px rgba(32,240,255,.75)' : 'none',
          }}
        />
      </button>

      {open ? (
        <section
          id={PANEL_ID}
          role="dialog"
          aria-label="SoundCloud Jukebox"
          data-jukebox-panel
          data-jukebox-provider="soundcloud"
          data-jukebox-autoplay="requested"
          data-jukebox-selected-track={selectedTrackId}
          data-jukebox-frame-ready={frameReady ? 'true' : 'false'}
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
