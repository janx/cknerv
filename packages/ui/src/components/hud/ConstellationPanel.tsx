import { type ReactNode, useLayoutEffect, useRef } from 'react';
import {
  invalidateConstellationFrame,
  type CellConstellationHandles,
} from './cellConstellationFrame';
import type { ConstellationSlot } from '../../derives/cellConstellation.derive';
import { CELL_CARD_ACCENT, HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { CloseButton, spatialPlate, spatialPlateBackground } from './primitives';

/** The class the injected sheet themes the one scrollbar this layout can grow.
 *
 *  A class rather than an inline style for the reason `CellDataReader`'s dump
 *  needs one: `scrollbar-width` has a `::-webkit-scrollbar` twin that no inline
 *  style can reach, and the HUD's rails already carry exactly these three rules
 *  (`.cknerv-mesh-rail`). What shipped instead, for as long as the dossier
 *  scrolled inside a docked card, was the browser's own light-grey bar with
 *  arrow buttons drawn down the middle of a black instrument. */
export const CONSTELLATION_SCROLLER_CLASS = 'cknerv-constellation-scroller';
const PANEL_ROUTE_TAG: Record<ConstellationSlot, string> = {
  specimen: 'CELL SCAN', analysis: 'SCAN·01', reader: 'SCAN·02', trace: 'SCAN·03',
};

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
  windowed = false,
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
  /** ⚠️ THE BODY IS A HOLE, SO THE PLATE MAY NOT PAINT BEHIND IT.
   *
   *  The specimen's window is transparent because the braid is drawn on the
   *  MAIN canvas, beneath the whole DOM HUD (`CellPortraitInset`). While the
   *  square was a plate slot of the card there was nothing behind it; as an
   *  instrument it has a plate of its own, and that plate's near-opaque
   *  gradient went straight between the canvas and the window — measured live
   *  on an iPad, the braid came through as a grey ghost at a tenth of its ink.
   *  So the ground moves to the head and the body keeps its hole. */
  windowed?: boolean;
  attributes?: Record<string, string | number | boolean | undefined>;
  bodyStyle?: React.CSSProperties;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const head = headRef.current;
    const content = contentRef.current;
    const handle = handles.panels[slot];
    if (!host || !head || !content || !handle) return undefined;
    handle.host = host;
    // A fresh host has no screen-space seat. Keep it out of the first paint
    // until a canonical or geometry-validated presentation places this exact
    // DOM node; old handle geometry may belong to another selected Cell.
    if (handle.positionedHost !== host) host.style.visibility = 'hidden';
    handle.present = true;
    const measure = () => {
      // ⚠️ THE HEAD AND THE HAIRLINES COUNT, AND THEY WERE MISSED.
      //
      // The walk is handed a height and writes it straight onto the host, so
      // the number has to be what the whole instrument needs — not what its
      // body needs. Measured live at 1920: a 664.6 px register in a 664.6 px
      // host left its scroller 632, and the bottom 33 px of every instrument
      // was clipped, silently, because an uncapped panel does not scroll.
      const headHeight = head.getBoundingClientRect().height;
      const measured = headHeight + content.getBoundingClientRect().height + 2;
      // The specimen body is an aspect-ratio square. Once a previous frame
      // constrains the flex host, browsers may report the flexed content height
      // instead of the square's intrinsic requirement. Keep that transparent
      // scissor window at its full width so the portrait cannot spill through
      // the bottom of a shortened plate.
      const next = windowed ? Math.max(measured, handle.width + headHeight + 2) : measured;
      if (Math.abs(next - handle.height) < 0.5) return;
      handle.height = next;
      // A panel that changed height changes everyone's placement: the walk
      // seats each instrument against the ones already standing.
      invalidateConstellationFrame(handles);
    };
    measure();
    const detach = () => {
      if (handle.host === host) handle.host = null;
      if (handle.positionedHost === host) handle.positionedHost = null;
      handle.present = false;
      handle.height = 0;
      invalidateConstellationFrame(handles);
    };
    if (typeof ResizeObserver === 'undefined') return detach;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(head);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [handles, slot, windowed]);

  return (
    <div
      ref={hostRef}
      data-cell-constellation-panel={slot}
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
        visibility: 'hidden',
        zIndex: 3,
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow per instrument, following its own silhouette.
        // The welded card cast one shadow around the whole constellation; three
        // objects that do not touch each need their own or they read as
        // cut-outs rather than as plates standing over a scene.
        filter: `drop-shadow(0 6px 14px ${rgba(HUD_COLORS.ground, 0.56)})`,
        ...spatialPlate(accent),
        ...(windowed ? { background: 'transparent' } : null),
      }}
    >
      <div
        ref={headRef}
        data-cell-panel-head={slot}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '7px 10px 6px 12px',
          borderBottom: `1px solid ${rgba(accent, 0.16)}`,
          ...(windowed ? { background: spatialPlateBackground(accent) } : null),
        }}
      >
        <span
          data-cell-panel-title={slot}
          style={{
            fontFamily: HUD_FONTS.display,
            fontWeight: 600,
            fontSize: HUD_TYPE.section,
            letterSpacing: 1.6,
            color: accent,
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {slot !== 'specimen' ? <span
          ref={(node) => { handles.panels[slot].fallbackLabel = node; }}
          data-cell-panel-route-label={slot}
          aria-hidden="true"
          style={{
            position: 'absolute',
            visibility: 'hidden',
            maxWidth: 0,
            overflow: 'hidden',
            padding: 0,
            borderWidth: 0,
            borderStyle: 'solid',
            borderColor: rgba(accent, 0.4),
            color: accent,
            fontSize: HUD_TYPE.label,
            letterSpacing: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {PANEL_ROUTE_TAG[slot]}
        </span> : null}
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
