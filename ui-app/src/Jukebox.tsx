import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

export const SPOTIFY_TRACK_URL =
  'https://open.spotify.com/track/0MUQtVlIkuMeDfZFm5xKRq';
export const SPOTIFY_EMBED_URL =
  'https://open.spotify.com/embed/track/0MUQtVlIkuMeDfZFm5xKRq?utm_source=oembed';

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
    'min(456px, calc(100vw - 28px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))',
  boxSizing: 'border-box',
  padding: 7,
  border: '1px solid rgba(32,240,255,.24)',
  background:
    'linear-gradient(180deg,rgba(3,10,18,.97),rgba(0,0,0,.94))',
  boxShadow:
    '0 16px 42px rgba(0,0,0,.64), inset 0 0 28px rgba(32,240,255,.035)',
  pointerEvents: 'auto',
};

function JukeboxGlyph({ active }: { active: boolean }) {
  const color = active ? CYAN : DIM;
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{ flex: '0 0 auto', filter: active ? 'drop-shadow(0 0 4px rgba(32,240,255,.55))' : undefined }}
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
  const [frameReady, setFrameReady] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setFrameReady(false);
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
          : 'Open Jukebox; loads Spotify content'}
        title={open
          ? 'Close Jukebox and stop playback'
          : 'Open Jukebox — loads Spotify only on request'}
        onClick={() => {
          if (open) {
            close();
          } else {
            setFrameReady(false);
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
          aria-label="Spotify Jukebox"
          data-jukebox-panel
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
            <span style={{ margin: '0 7px', color: 'rgba(124,135,148,.45)' }}>//</span>
            <span
              data-jukebox-load-state={frameReady ? 'ready' : 'connecting'}
              style={{ color: frameReady ? CYAN : DIM }}
            >
              SPOTIFY {frameReady ? 'READY' : 'CONNECTING'}
            </span>
            <span style={{ flex: 1 }} />
            <a
              href={SPOTIFY_TRACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in Spotify"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                color: INK,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              OPEN IN SPOTIFY ↗
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
          <iframe
            src={SPOTIFY_EMBED_URL}
            title="Spotify Embed: TSUBASA WO KUDASAI"
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            onLoad={() => setFrameReady(true)}
            style={{
              display: 'block',
              border: 0,
              borderRadius: 12,
              background: '#191414',
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
