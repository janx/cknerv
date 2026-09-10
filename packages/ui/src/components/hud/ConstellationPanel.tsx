import { type ReactNode, useLayoutEffect, useRef } from 'react';
import {
  invalidateConstellationFrame,
  type CellConstellationHandles,
} from './cellConstellationFrame';
import type { ConstellationSlot } from '../../derives/cellConstellation.derive';
import { CELL_CARD_ACCENT, HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { CloseButton, spatialPlate } from './primitives';

/** The class the injected sheet themes the one scrollbar this layout can grow.
 *
 *  A class rather than an inline style for the reason `CellDataReader`'s dump
 *  needs one: `scrollbar-width` has a `::-webkit-scrollbar` twin that no inline
 *  style can reach, and the HUD's rails already carry exactly these three rules
 *  (`.cknerv-mesh-rail`). What shipped instead, for as long as the dossier
 *  scrolled inside a docked card, was the browser's own light-grey bar with
 *  arrow buttons drawn down the middle of a black instrument. */
export const CONSTELLATION_SCROLLER_CLASS = 'cknerv-constellation-scroller';

/**
 * One instrument, positioned by the frame writer and sized by its own content.
 *
 * The host is what moves: `transform`, `width` and `height` are written into it
 * sixty times a second from outside React, so nothing in here may also author
 * them. What React owns is the plate — the frame, the head, the body — and the
 * one measurement the placement needs back, which is how tall the content came
 * out. That measurement is taken from the CONTENT and never from the host: the
 * host's height is the solver's answer, and observing the answer to compute the
 * question is how a layout oscillates.
 */
export default function ConstellationPanel({
  slot,
  handles,
  title,
  accent = CELL_CARD_ACCENT,
  status,
  onClose,
  closeTitle,
  attributes,
  bodyStyle,
  children,
}: {
  slot: ConstellationSlot;
  handles: CellConstellationHandles;
  title: string;
  accent?: string;
  /** What the head says about this instrument beside its name — the scan's own
   *  progress on the register, the COPY command on the reader. */
  status?: ReactNode;
  onClose: () => void;
  closeTitle: string;
  attributes?: Record<string, string | number | boolean | undefined>;
  bodyStyle?: React.CSSProperties;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    const handle = handles.panels[slot];
    if (!host || !content || !handle) return undefined;
    handle.host = host;
    handle.present = true;
    const measure = () => {
      const next = content.getBoundingClientRect().height;
      if (Math.abs(next - handle.height) < 0.5) return;
      handle.height = next;
      // A panel that changed height changes everyone's placement: the walk
      // seats each instrument against the ones already standing.
      invalidateConstellationFrame(handles);
    };
    measure();
    const detach = () => {
      handle.host = null;
      handle.present = false;
      handle.height = 0;
      invalidateConstellationFrame(handles);
    };
    if (typeof ResizeObserver === 'undefined') return detach;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [handles, slot]);

  return (
    <div
      ref={hostRef}
      data-cell-constellation-panel={slot}
      data-cell-inspection-satellite={slot}
      {...attributes}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pointerEvents: 'auto',
        userSelect: 'text',
        willChange: 'transform',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow per instrument, following its own silhouette.
        // The welded card cast one shadow around the whole constellation; three
        // objects that do not touch each need their own or they read as
        // cut-outs rather than as plates standing over a scene.
        filter: `drop-shadow(0 6px 14px ${rgba(HUD_COLORS.ground, 0.56)})`,
        ...spatialPlate(accent),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '7px 10px 6px 12px',
          borderBottom: `1px solid ${rgba(accent, 0.16)}`,
        }}
      >
        <span
          data-cell-panel-title={slot}
          style={{
            fontFamily: HUD_FONTS.display,
            fontWeight: 600,
            fontSize: HUD_TYPE.section,
            letterSpacing: 1.5,
            color: accent,
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {status}
        {/* Every instrument closes alone (the user's direction of 2026-09-10:
          * 「三个panel相互分开」). A reader who does not care about bytes closes
          * SCAN·02 and keeps the register — which is not a thing three tracks of
          * one grid can offer. The chip under the reticle closes all of them. */}
        <span style={{ marginLeft: 'auto', position: 'relative', width: 0, height: 0 }}>
          <CloseButton onClose={onClose} title={closeTitle} />
        </span>
      </div>
      {/* The scroller and the content are two elements on purpose: the host
        * carries the solver's height, the scroller carries the overflow, and the
        * content carries the measurement. Collapsing any two of them makes the
        * measurement a function of the answer it feeds. */}
      <div
        className={CONSTELLATION_SCROLLER_CLASS}
        data-cell-panel-scroller={slot}
        style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, ...bodyStyle }}
      >
        <div ref={contentRef} data-cell-panel-content={slot}>
          {children}
        </div>
      </div>
      {/* The cut, softened — and only where there IS one. A register the band
        * could not hold used to end through the middle of whatever row the
        * clip landed on (measured live: half a collection name), with nothing
        * saying the rest existed. */}
      <span
        aria-hidden="true"
        data-cell-panel-fade={slot}
        style={{
          position: 'absolute',
          left: 1,
          right: 1,
          bottom: 0,
          height: 16,
          pointerEvents: 'none',
          background: `linear-gradient(${rgba(HUD_COLORS.stageGround, 0)},${rgba(HUD_COLORS.stageGround, 0.97)})`,
        }}
      />
    </div>
  );
}
