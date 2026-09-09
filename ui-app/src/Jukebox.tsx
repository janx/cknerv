import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { HUD_COLORS, HUD_MOTION, rgba } from '@cknerv/ui';
import {
  createSoundCloudWidget,
  SOUNDCLOUD_EVENTS,
  type SoundCloudWidgetEvent,
} from './soundcloud-widget';

export const KOMM_VOCAL_FADE_START_MS = 355_000;
export const KOMM_VOCAL_LOOP_AT_MS = 360_000;

export const JUKEBOX_TRACKS = [
  {
    id: 'michelle-vocal',
    name: 'Vocal A',
    kind: 'VOCAL',
    artist: 'MICHELLE ♥',
    duration: '05:24',
    selectorLabel: 'Select Vocal A',
    frameTitle: 'SoundCloud player: 翼をください — Michelle vocal upload',
    trackUrl: 'https://soundcloud.com/nuraminmi/tsubasa-wo-kudasai',
    embedUrl:
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F54664795&color=%2320f0ff&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false',
  },
  {
    id: 'arianne-vocal',
    name: 'Vocal B',
    kind: 'VOCAL',
    artist: 'ARIANNE',
    duration: '06:00',
    selectorLabel: 'Select Vocal B',
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
    id: 'joseto-arc-piano',
    name: 'Piano A',
    kind: 'PIANO',
    artist: 'JOSETO ARC',
    duration: '04:09',
    selectorLabel: 'Select Piano A',
    frameTitle: 'SoundCloud player: 翼をください — Joseto Arc piano',
    trackUrl:
      'https://soundcloud.com/joseto-arc/evangelion-tsubasa-wo-kudasai?utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing',
    embedUrl:
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F499687749&color=%2320f0ff&auto_play=true&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false',
  },
  {
    id: 'sheet-music-boss-piano',
    name: 'Piano B',
    kind: 'PIANO',
    artist: 'SHEET MUSIC BOSS',
    duration: '06:39',
    selectorLabel: 'Select Piano B',
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
export const JUKEBOX_PLAYBACK_MODES = [
  {
    id: 'single',
    label: 'SINGLE ∞',
    selectorLabel: 'Repeat selected track indefinitely',
  },
  {
    id: 'random',
    label: 'RANDOM ∞',
    selectorLabel: 'Play tracks randomly indefinitely',
  },
] as const;

export type JukeboxPlaybackMode =
  (typeof JUKEBOX_PLAYBACK_MODES)[number]['id'];

export const DEFAULT_JUKEBOX_PLAYBACK_MODE: JukeboxPlaybackMode = 'single';
// Match the CELL MESH panel's 302px content width plus 15px inline padding.
export const JUKEBOX_PANEL_WIDTH_PX = 332;
export const JUKEBOX_CHIP_HEIGHT_PX = 28;
/** The console module code, in the CKB·01 / CELL·03 grammar of the HUD panels —
 *  it is what makes the closed Jukebox read as part of the instrument rather
 *  than as a stray widget dropped on the scene. */
export const JUKEBOX_MODULE_CODE = 'SND·06';
export const SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX = 166;
export const SOUNDCLOUD_PLAYER_SCALE = 0.72;
export const JUKEBOX_PLAYER_HEIGHT_PX = Math.ceil(
  SOUNDCLOUD_NATIVE_PLAYER_HEIGHT_PX * SOUNDCLOUD_PLAYER_SCALE,
);

const PANEL_ID = 'cknerv-jukebox-player';
// The four inks, as CSS custom properties with the PALETTE as the fallback
// rather than a hand-typed copy of it. The `var()` form is deliberate and
// stays: a page may re-tint the chip without this module knowing, which is
// what a custom property is for. What is gone is the second spelling of each
// hex — four literals that had to be kept in step with `hudTheme.ts` by
// somebody remembering to.
const CYAN = `var(--hud-cyanWire, ${HUD_COLORS.cyanWire})`;
const ORANGE = `var(--hud-orange, ${HUD_COLORS.orange})`;
const INK = `var(--hud-ink, ${HUD_COLORS.ink})`;
const DIM = `var(--hud-dim, ${HUD_COLORS.dim})`;
const MONO = "'Share Tech Mono', ui-monospace, monospace";

const JUKEBOX_STYLE_ID = 'cknerv-jukebox-style';

/** Feature-local CSS, injected once beside the shared HUD theme. The closed
 *  chip's whole attract behaviour lives here so that
 *  `prefers-reduced-motion` can retire every animation at the platform level
 *  instead of through a second React state machine — the invitation still
 *  appears and still says what it says, it simply stops moving. */
function injectJukeboxStyles(doc: Document = document): void {
  if (doc.getElementById(JUKEBOX_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = JUKEBOX_STYLE_ID;
  style.textContent = [
    '@keyframes cknerv-jukebox-eq-a{0%,100%{transform:scaleY(.42)}50%{transform:scaleY(1)}}',
    '@keyframes cknerv-jukebox-eq-b{0%,100%{transform:scaleY(1)}46%{transform:scaleY(.34)}}',
    '@keyframes cknerv-jukebox-eq-c{0%,100%{transform:scaleY(.6)}32%{transform:scaleY(.95)}}',
    '@keyframes cknerv-jukebox-tick{0%{transform:scaleY(1)}16%{transform:scaleY(1.55)}100%{transform:scaleY(1)}}',
    // The origins are set inline per element now (each bar's rect bottom
    // centre, the group's union bottom centre — see `JukeboxGlyph`); these
    // rules stay as the declared intent and the fallback for either.
    '.cknerv-jukebox-bar{transform-box:fill-box;transform-origin:bottom}',
    '.cknerv-jukebox-bars{transform-box:fill-box;transform-origin:bottom}',
    // Live only while the Jukebox has never been opened: a quiet corner that
    // moves is found by peripheral vision; a corner that keeps moving after
    // you have answered it is a nag.
    '[data-jukebox-attract="settled"] .cknerv-jukebox-glyph,'
      + '[data-jukebox-attract="settled"] .cknerv-jukebox-bar,'
      + '[data-jukebox-attract="settled"] .cknerv-jukebox-bars{animation:none}',
    // ⭐ THE BREATHE IS THE HUD'S, not a second one. This chip had a
    // `cknerv-jukebox-breathe` of its own — .72 → 1 over 3.4s against the
    // overlay's .82 → 1 over 3.2 — which is one idea drawn twice, at two
    // depths, four hundred milliseconds apart (report E, E-1). The HUD theme
    // registers the keyframe; SND·06 wears it like every other module.
    `.cknerv-jukebox-glyph{animation:cknerv-hud-breathe ${HUD_MOTION.hold}ms ${HUD_MOTION.loopEase} infinite}`,
    // A block landing kicks the meter: something ARRIVING, on the enter rung
    // and the one bezier.
    `.cknerv-jukebox-bars{animation:cknerv-jukebox-tick ${HUD_MOTION.enter}ms ${HUD_MOTION.enterEase} 1}`,
    // Three bars, ONE period, three shapes. They ran at 2.4 / 3.1 / 2.7s to
    // keep from moving as one bar — but what makes an EQ read as an EQ is the
    // bars disagreeing about WHERE they are, which is what the three keyframes
    // above already say (a peaks at 50%, b troughs at 46%, c peaks at 32%).
    // Three periods were buying with numbers what the shapes give for free.
    `.cknerv-jukebox-bar-a{animation:cknerv-jukebox-eq-a ${HUD_MOTION.hold}ms ${HUD_MOTION.loopEase} infinite}`,
    `.cknerv-jukebox-bar-b{animation:cknerv-jukebox-eq-b ${HUD_MOTION.hold}ms ${HUD_MOTION.loopEase} infinite}`,
    `.cknerv-jukebox-bar-c{animation:cknerv-jukebox-eq-c ${HUD_MOTION.hold}ms ${HUD_MOTION.loopEase} infinite}`,
    '@media (prefers-reduced-motion:reduce){'
      + '.cknerv-jukebox-glyph,.cknerv-jukebox-bar,.cknerv-jukebox-bars{animation:none}}',
    // Narrow viewports keep the mark and drop the words, matching the HUD's
    // existing label-shedding breakpoints.
    '@media (max-width:380px){.cknerv-jukebox-label,.cknerv-jukebox-code{display:none}}',
  ].join('\n');
  doc.head.appendChild(style);
}

// 14px, and it is the HUD's own rail inset (`RAIL_INSET_PX` in
// `HudOverlay.tsx`), not a margin of this module's own choosing.
//
// It was 18, argued as "an object hugging the very edge reads as trim; the
// margin is what lets a quiet corner present it as something placed there".
// That argument is right about a widget and wrong about a MODULE: SND·06
// wears a module code in the CKB·01 / CELL·03 grammar precisely so the closed
// chip reads as part of the instrument, and a module standing four pixels
// inside every other module's line reads as the one thing that is not bolted
// to the frame (report A, A-11).
//
// And the 14 is measured from the same edge the rails measure from, which is
// the SAFE-AREA edge and not the page's (`HudOverlay.tsx`, `ROOT_STYLE`). It
// used to read `max(14px, env(...))`, which agrees with the frame on every
// screen that covers nothing and parts from it on every screen that does: an
// iPad hands back a 25 px bottom inset, so the chip would stand at 25 while
// SND·06's neighbours in the right rail stand at inset + 14 = 39 — the module
// four pixels outside every other module's line, which is the arrangement the
// paragraph above was written to rule out. `calc()` keeps the one line.
const floatingStyle: CSSProperties = {
  position: 'fixed',
  right: 'calc(14px + env(safe-area-inset-right, 0px))',
  bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
  zIndex: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 12,
  pointerEvents: 'auto',
  fontFamily: MONO,
};

const panelStyle: CSSProperties = {
  position: 'relative',
  width:
    `min(${JUKEBOX_PANEL_WIDTH_PX}px, calc(100vw - 36px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))`,
  maxHeight:
    'calc(100vh - 36px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: 6,
  border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.24)}`,
  background:
    `linear-gradient(180deg,${rgba(HUD_COLORS.stageGround, 0.97)},${rgba(HUD_COLORS.ground, 0.94)})`,
  boxShadow:
    `0 14px 36px ${rgba(HUD_COLORS.ground, 0.68)}, inset 0 0 24px ${rgba(HUD_COLORS.cyanWire, 0.04)}`,
  backdropFilter: 'blur(8px)',
  pointerEvents: 'auto',
};

function getTrack(trackId: JukeboxTrackId) {
  return JUKEBOX_TRACKS.find((track) => track.id === trackId)
    ?? JUKEBOX_TRACKS[0];
}

export function getRandomJukeboxTrackId(
  currentTrackId: JukeboxTrackId,
  random = Math.random,
): JukeboxTrackId {
  const candidates = JUKEBOX_TRACKS.filter(
    (track) => track.id !== currentTrackId,
  );
  if (candidates.length === 0) return currentTrackId;

  const sample = random();
  const index = Number.isFinite(sample)
    ? Math.min(
      candidates.length - 1,
      Math.max(0, Math.floor(sample * candidates.length)),
    )
    : 0;
  return candidates[index].id;
}

/** The glyph's box, in CSS px — the old single SVG's viewport, which is also
 *  what the wrapper clips to and what the glow is cast from. */
const GLYPH_W = 23;
const GLYPH_H = 14;

/** The three equalizer bars, in TENTHS of a CSS px of the glyph's own
 *  coordinates — exactly the rects the single SVG drew (12.2 × 7.3, 2.4 wide,
 *  5.1 tall, …), kept as integers so every offset derived below prints as
 *  the clean decimal it is rather than a float sum's rounding. Every bar
 *  stands on one baseline (`y + height` is 124 for all three), which is what
 *  lets the group tick scale about one line. */
const EQ_BARS = [
  { id: 'a', x10: 122, y10: 73, h10: 51 },
  { id: 'b', x10: 156, y10: 33, h10: 91 },
  { id: 'c', x10: 190, y10: 58, h10: 66 },
] as const;
const EQ_BAR_W10 = 24;
const EQ_BASELINE10 = 124;
/** The bars' union box (12..22 × 3..13): where the group span stands, and
 *  whose bottom centre is the scale origin the old `<g>` had under
 *  `transform-box: fill-box`. */
const EQ_GROUP_LEFT = 12;
const EQ_GROUP_TOP = 3;
const EQ_GROUP_W = 10;
const EQ_GROUP_H = 10;
/** Each bar's own SVG root sits at an integer offset so its rect keeps the
 *  fractional, anti-aliased edges the old rect had; this is the box's width. */
const EQ_BAR_BOX_W = 3;
const px10 = (tenths: number): number => tenths / 10;

/** The mark is the affordance: a drawn eighth note — the mono face carries no
 *  ♪ glyph — beside a three-bar equalizer, the same bar-meter vocabulary the
 *  HUD already uses for BORN/DIED and SYNC RATIO. The retired jukebox-cabinet
 *  silhouette was unreadable at 14px and said nothing about sound. `pulseKey`
 *  remounts the bars so each new block ticks them once.
 *
 *  ⚠️ THE BARS ARE NOT RECTS INSIDE THE NOTE'S SVG ANY MORE. A CSS transform
 *  animating an inner SVG element runs on the main thread — style, paint and
 *  commit every frame, for as long as the chip attracts, which is the whole
 *  session for a visitor who never opens it. Each bar is its own outermost
 *  `<svg>`: an HTML-layout box whose transform the compositor animates alone,
 *  drawing the same rect at the same fractional coordinates inside it, so the
 *  bar's anti-aliased edges are the ones it always had. The wrapper carries
 *  what the single SVG carried — the breathe class, the glow filter (cast
 *  from the union of note and bars, as before) and the viewport clip the
 *  group tick used to hit at the top edge. Each root's scale origin is pinned
 *  to its rect's bottom centre, the origin `transform-box: fill-box` gave the
 *  rect; the group's is the union's, as the `<g>` had. */
function JukeboxGlyph({ pulseKey }: { pulseKey: number }) {
  return (
    <span
      aria-hidden="true"
      className="cknerv-jukebox-glyph"
      style={{
        position: 'relative',
        display: 'inline-block',
        flex: '0 0 auto',
        width: GLYPH_W,
        height: GLYPH_H,
        overflow: 'hidden',
        filter: `drop-shadow(0 0 4px ${rgba(HUD_COLORS.cyanWire, 0.55)})`,
      }}
    >
      <svg
        width={GLYPH_W}
        height={GLYPH_H}
        viewBox={`0 0 ${GLYPH_W} ${GLYPH_H}`}
        fill="none"
        style={{ display: 'block' }}
      >
        <ellipse
          cx="4.1"
          cy="10.7"
          rx="2.5"
          ry="1.9"
          transform="rotate(-20 4.1 10.7)"
          fill={CYAN}
        />
        <path
          d="M6.5 10.6V2.3"
          stroke={CYAN}
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <path
          d="M6.5 2.4c2.2.7 3.3 1.6 3 3.4"
          stroke={CYAN}
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
      <span
        key={pulseKey}
        className="cknerv-jukebox-bars"
        style={{
          position: 'absolute',
          left: EQ_GROUP_LEFT,
          top: EQ_GROUP_TOP,
          width: EQ_GROUP_W,
          height: EQ_GROUP_H,
          transformOrigin: `${px10((EQ_BARS[0].x10 + EQ_BARS[2].x10 + EQ_BAR_W10) / 2 - EQ_GROUP_LEFT * 10)}px ${px10(EQ_BASELINE10 - EQ_GROUP_TOP * 10)}px`,
        }}
      >
        {EQ_BARS.map((bar) => {
          const left = Math.floor(bar.x10 / 10);
          const rectX10 = bar.x10 - left * 10;
          const rectY10 = bar.y10 - EQ_GROUP_TOP * 10;
          return (
            <svg
              key={bar.id}
              className={`cknerv-jukebox-bar cknerv-jukebox-bar-${bar.id}`}
              width={EQ_BAR_BOX_W}
              height={EQ_GROUP_H}
              viewBox={`0 0 ${EQ_BAR_BOX_W} ${EQ_GROUP_H}`}
              fill="none"
              style={{
                position: 'absolute',
                left: left - EQ_GROUP_LEFT,
                top: 0,
                overflow: 'visible',
                transformOrigin: `${px10(rectX10 + EQ_BAR_W10 / 2)}px ${px10(rectY10 + bar.h10)}px`,
              }}
            >
              <rect
                x={px10(rectX10)}
                y={px10(rectY10)}
                width={px10(EQ_BAR_W10)}
                height={px10(bar.h10)}
                fill={CYAN}
              />
            </svg>
          );
        })}
      </span>
    </span>
  );
}

/** The panels' own corner grammar: top-left and bottom-right ticks in orange.
 *  Wearing it is what promotes the chip from "stray control" to "module". */
function chipBracket(corner: 'tl' | 'br'): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    width: 8,
    height: 8,
    borderColor: ORANGE,
    borderStyle: 'solid',
    opacity: .8,
    pointerEvents: 'none',
  };
  return corner === 'tl'
    ? { ...base, top: -1, left: -1, borderWidth: '1px 0 0 1px' }
    : { ...base, bottom: -1, right: -1, borderWidth: '0 1px 1px 0' };
}

export interface JukeboxProps {
  /** Arrival time of the newest block. Ticks the closed chip's equalizer so it
   *  breathes with the chain rather than on a decorative clock of its own.
   *  Optional — the Jukebox is complete without it. */
  blockPulseAtMs?: number;
}

export default function Jukebox({ blockPulseAtMs }: JukeboxProps) {
  const [open, setOpen] = useState(false);
  const [selectedTrackId, setSelectedTrackId] =
    useState<JukeboxTrackId>(DEFAULT_JUKEBOX_TRACK_ID);
  const [playbackMode, setPlaybackMode] = useState<JukeboxPlaybackMode>(
    DEFAULT_JUKEBOX_PLAYBACK_MODE,
  );
  const [readyTrackId, setReadyTrackId] = useState<JukeboxTrackId | null>(null);
  const [openedOnce, setOpenedOnce] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const widgetTeardownRef = useRef<(() => void) | null>(null);
  const playbackModeRef = useRef<JukeboxPlaybackMode>(
    DEFAULT_JUKEBOX_PLAYBACK_MODE,
  );
  const restoreFocusRef = useRef(false);
  const selectedTrack = getTrack(selectedTrackId);
  const frameReady = readyTrackId === selectedTrackId;
  const attract = openedOnce ? 'settled' : 'attract';
  const fadeStartMs = 'fadeStartMs' in selectedTrack
    ? selectedTrack.fadeStartMs
    : null;
  const loopAtMs = 'loopAtMs' in selectedTrack
    ? selectedTrack.loopAtMs
    : null;

  const teardownWidget = useCallback(() => {
    const teardown = widgetTeardownRef.current;
    widgetTeardownRef.current = null;
    teardown?.();
  }, []);

  const selectTrack = useCallback((trackId: JukeboxTrackId) => {
    teardownWidget();
    setReadyTrackId(null);
    setSelectedTrackId(trackId);
  }, [teardownWidget]);

  const close = useCallback(() => {
    teardownWidget();
    restoreFocusRef.current = true;
    setOpen(false);
    setReadyTrackId(null);
  }, [teardownWidget]);

  const openPlayer = useCallback(() => {
    setReadyTrackId(null);
    setOpenedOnce(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    injectJukeboxStyles();
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
    // CAPTURE, because this window is modal while it is open: it takes focus,
    // traps it, and restores it on close. Escape belongs to whatever is
    // innermost, and nothing is further in than a modal — the inspection card's
    // own dismissal listens in bubble and stands down on `defaultPrevented`.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, open]);

  useEffect(() => {
    if (!open || !frameReady || !frameRef.current) return;

    const iframe = frameRef.current;
    let disposed = false;
    // The four events bound below, in the order they are asked for, which is
    // the list teardown has to undo.
    const boundEvents = [
      SOUNDCLOUD_EVENTS.PLAY_PROGRESS,
      SOUNDCLOUD_EVENTS.SEEK,
      SOUNDCLOUD_EVENTS.PLAY,
      SOUNDCLOUD_EVENTS.FINISH,
    ];
    // The controller is this module's own `postMessage` client, not a vendor
    // script fetched into the page origin — see `soundcloud-widget.ts`. There
    // is nothing to wait for: it exists the moment the frame does, and holds
    // what it is told to say until the player announces itself.
    const widget = createSoundCloudWidget(iframe);

    const teardown = () => {
      if (disposed) return;
      disposed = true;

      // The unbind messages are worth sending only while there is still a
      // frame to hear them; the window listener comes off either way, which
      // is what keeps a track switch a handover rather than a pile-up.
      if (iframe.isConnected && iframe.contentWindow !== null) {
        boundEvents.forEach((eventName) => {
          try {
            widget.unbind(eventName);
          } catch {
            // SoundCloud may detach its iframe window during teardown. Its
            // controller must never be allowed to unmount the React app.
          }
        });
      }
      widget.dispose();
    };

    widgetTeardownRef.current = teardown;

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
      widget.setVolume(restoreVolume);
      normalVolume = restoreVolume;
      fadeBaseVolume = null;
      resolvingFadeVolume = false;
    };

    const performRestart = (restoreVolume: number) => {
      if (disposed) return;
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
      if (restarting) return;
      restarting = true;
      if (fadeBaseVolume !== null) {
        performRestart(fadeBaseVolume);
        return;
      }
      widget.getVolume((volume) => {
        if (!disposed) performRestart(clampVolume(volume));
      });
    };

    const finishTrack = () => {
      if (disposed) return;
      if (playbackModeRef.current === 'single') {
        restart();
        return;
      }

      if (fadeBaseVolume !== null) {
        widget.setVolume(fadeBaseVolume);
      }
      widget.pause();
      selectTrack(getRandomJukeboxTrackId(selectedTrackId));
    };

    const applyPosition = (position: number) => {
      if (disposed || !Number.isFinite(position)) return;
      lastPosition = position;

      if (restarting) {
        if (position <= 1_000) {
          restarting = false;
        } else {
          return;
        }
      }

      if (loopAtMs !== null && position >= loopAtMs) {
        finishTrack();
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
          if (disposed) return;
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
      widget.getPosition(applyPosition);
      if (fadeBaseVolume !== null) return;
      widget.getVolume((volume) => {
        if (!disposed && fadeBaseVolume === null) {
          normalVolume = clampVolume(volume);
        }
      });
    };

    widget.bind(SOUNDCLOUD_EVENTS.PLAY_PROGRESS, onProgress);
    widget.bind(SOUNDCLOUD_EVENTS.SEEK, onProgress);
    widget.bind(SOUNDCLOUD_EVENTS.PLAY, onPlay);
    widget.bind(SOUNDCLOUD_EVENTS.FINISH, finishTrack);

    return () => {
      teardown();
      if (widgetTeardownRef.current === teardown) {
        widgetTeardownRef.current = null;
      }
    };
  }, [
    fadeStartMs,
    frameReady,
    loopAtMs,
    open,
    selectTrack,
    selectedTrackId,
  ]);

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
          className="cknerv-hud-control-button cknerv-jukebox-chip"
          data-jukebox-trigger
          data-jukebox-attract={attract}
          aria-controls={PANEL_ID}
          aria-expanded={false}
          aria-label="Open Jukebox and play default SoundCloud track"
          title="Open Jukebox — load SoundCloud and request playback"
          onClick={openPlayer}
          style={{
            position: 'relative',
            appearance: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            height: JUKEBOX_CHIP_HEIGHT_PX,
            padding: '0 9px',
            // NO BOX. The chip drew a full 1px cyan border AND the two orange
            // brackets below — a box-plus-brackets form no panel in the HUD
            // wears, and the shape grammar has no fifth form to put it in
            // (report A, A-11). The brackets are the docked panel's tell and
            // they say it alone, the way `HudPanel` does; the dark moat in the
            // shadow below is what separates the chip from the scene.
            background:
              `linear-gradient(180deg,${rgba(HUD_COLORS.stageGround, 0.96)},${rgba(HUD_COLORS.ground, 0.94)})`,
            // The third shadow is a dark moat: it fades the cyan mesh wires
            // immediately around the chip, which is the only way a cyan-on-black
            // control separates from a cyan-on-black scene.
            boxShadow: `0 10px 30px ${rgba(HUD_COLORS.ground, 0.7)}, `
              + `inset 0 0 16px ${rgba(HUD_COLORS.cyanWire, 0.05)}, `
              + `0 0 20px 9px ${rgba(HUD_COLORS.stageGround, 0.6)}`,
            color: CYAN,
            font: `400 8.5px/1 ${MONO}`,
            letterSpacing: 1.05,
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true" style={chipBracket('tl')} />
          <span aria-hidden="true" style={chipBracket('br')} />
          <span
            className="cknerv-jukebox-code"
            style={{
              position: 'absolute',
              top: -4,
              left: 11,
              padding: '0 4px',
              background: HUD_COLORS.stageGround,
              color: DIM,
              // The HUD's 7.5px legibility floor; below it the code is mush.
              fontSize: 7.5,
              letterSpacing: 1,
            }}
          >
            {JUKEBOX_MODULE_CODE}
          </span>
          <JukeboxGlyph pulseKey={blockPulseAtMs ?? 0} />
          <span
            className="cknerv-jukebox-label"
            style={{ marginLeft: 7, color: ORANGE }}
          >
            BGM
          </span>
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
          data-jukebox-playback-mode={playbackMode}
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
            <span style={{ margin: '0 7px', color: rgba(HUD_COLORS.dim, 0.45) }}>
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
                border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.16)}`,
                background: rgba(HUD_COLORS.ground, 0.3),
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
            aria-label="Choose Jukebox playback mode"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 5,
              marginBottom: 5,
            }}
          >
            {JUKEBOX_PLAYBACK_MODES.map((mode) => {
              const selected = mode.id === playbackMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  className="cknerv-hud-control-button"
                  data-jukebox-mode={mode.id}
                  aria-label={mode.selectorLabel}
                  aria-pressed={selected}
                  onClick={() => {
                    playbackModeRef.current = mode.id;
                    setPlaybackMode(mode.id);
                  }}
                  style={{
                    appearance: 'none',
                    minHeight: 23,
                    padding: '3px 7px',
                    border: selected
                      ? `1px solid ${rgba(HUD_COLORS.orange, 0.5)}`
                      : `1px solid ${rgba(HUD_COLORS.dim, 0.2)}`,
                    background: selected
                      ? `linear-gradient(90deg,${rgba(HUD_COLORS.orange, 0.1)},${rgba(HUD_COLORS.orange, 0.025)})`
                      : rgba(HUD_COLORS.ground, 0.28),
                    boxShadow: selected
                      ? `inset 0 0 15px ${rgba(HUD_COLORS.orange, 0.04)}`
                      : 'none',
                    color: selected ? ORANGE : DIM,
                    font: `400 8.5px/15px ${MONO}`,
                    letterSpacing: 1,
                    cursor: 'pointer',
                  }}
                >
                  {mode.label}
                </button>
              );
            })}
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
                    selectTrack(track.id);
                  }}
                  style={{
                    appearance: 'none',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center',
                    minWidth: 0,
                    minHeight: 29,
                    padding: '4px 7px',
                    border: selected
                      ? `1px solid ${rgba(HUD_COLORS.cyanWire, 0.52)}`
                      : `1px solid ${rgba(HUD_COLORS.dim, 0.2)}`,
                    background: selected
                      ? `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.1)},${rgba(HUD_COLORS.cyanWire, 0.025)})`
                      : rgba(HUD_COLORS.ground, 0.28),
                    boxShadow: selected
                      ? `inset 0 0 15px ${rgba(HUD_COLORS.cyanWire, 0.04)}`
                      : 'none',
                    color: selected ? CYAN : DIM,
                    font: `400 8.5px/15px ${MONO}`,
                    letterSpacing: .9,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      color: selected ? ORANGE : DIM,
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {track.name}
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
              border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.12)}`,
              boxSizing: 'border-box',
              background: HUD_COLORS.stageGround,
              boxShadow:
                `inset 0 0 20px ${rgba(HUD_COLORS.cyanWire, 0.035)}, 0 0 0 1px ${rgba(HUD_COLORS.ground, 0.7)}`,
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
                background: HUD_COLORS.ground,
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
