import { type CSSProperties, useLayoutEffect, useRef } from 'react';
import {
  CONSTELLATION_RETICLE_PX,
  type ConstellationSlot,
} from '../../derives/cellConstellation.derive';
import {
  CONSTELLATION_SLOTS,
  invalidateConstellationFrame,
  type CellConstellationHandles,
} from './cellConstellationFrame';
import {
  CELL_CARD_ACCENT,
  CJK_BASELINE_LIFT,
  COMPANION_OPACITY,
  HUD_COLORS,
  HUD_FONTS,
  HUD_TYPE,
  rgba,
} from './hudTheme';
import { CloseButton, StatusLamp } from './primitives';

/** What each leader says about itself. The module tag rides the LINE now and
 *  not the panel's head (the user's direction of 2026-09-10: 「有提示连接线连到
 *  三个panel」) — the tag names a relationship, and the line IS the
 *  relationship, so it is said once on the thing it is about. A reader who
 *  follows a line knows what is at the end of it before arriving. */
export const CONSTELLATION_TAG: { [slot: string]: string } = {
  specimen: 'CELL SCAN',
  analysis: 'SCAN·01',
  reader: 'SCAN·02',
  trace: 'SCAN·03',
};

const BRACKET_PX = 16;

function bracket(corner: 'tl' | 'tr' | 'bl' | 'br'): CSSProperties {
  const top = corner === 'tl' || corner === 'tr';
  const left = corner === 'tl' || corner === 'bl';
  return {
    position: 'absolute',
    width: BRACKET_PX,
    height: BRACKET_PX,
    [top ? 'top' : 'bottom']: 0,
    [left ? 'left' : 'right']: 0,
    [top ? 'borderTop' : 'borderBottom']: `2px solid ${CELL_CARD_ACCENT}`,
    [left ? 'borderLeft' : 'borderRight']: `2px solid ${CELL_CARD_ACCENT}`,
  };
}

/**
 * The mark on the cell itself.
 *
 * Until now the only thing saying THIS cell was selected was a tether running
 * off to a card that was routinely standing on the cell's own neighbourhood.
 * Four brackets is the viewfinder idiom the CELL SCAN square has always worn,
 * turned on the specimen instead of on the window that magnifies it, and the
 * shadow under it is what lets a 2 px mark read over the galaxy's brightest
 * nebula — the same reason a map label is set with a halo.
 */
export function CellReticle({ handles }: { handles: CellConstellationHandles }) {
  return (
    <div
      ref={(node) => {
        handles.reticle = node;
        invalidateConstellationFrame(handles);
      }}
      data-cell-selection-reticle="true"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: CONSTELLATION_RETICLE_PX,
        height: CONSTELLATION_RETICLE_PX,
        pointerEvents: 'none',
        willChange: 'transform',
        filter: `drop-shadow(0 0 3px ${rgba(HUD_COLORS.ground, 0.95)}) drop-shadow(0 0 7px ${rgba(CELL_CARD_ACCENT, 0.35)})`,
      }}
    >
      <span style={bracket('tl')} />
      <span style={bracket('tr')} />
      <span style={bracket('bl')} />
      <span style={bracket('br')} />
    </div>
  );
}

/**
 * The cell's own name, on the cell.
 *
 * LAW 4, and it is what makes three instruments read as three readings of one
 * thing rather than as three windows that happen to be open. The identity used
 * to title the register — one of the three — which was defensible while they
 * were one card and is not while they are not: a Cell's id is a fact about the
 * specimen, not about the dossier.
 */
export function CellNameChip({
  handles,
  id,
  outpoint,
  live,
  lifetime,
  onClose,
}: {
  handles: CellConstellationHandles;
  id: number | string;
  outpoint: string;
  live: boolean;
  lifetime: string;
  onClose: () => void;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  // The chip is an obstacle to the walk, so its measure has to reach the walk.
  // It is one line of text whose width is the Cell's own id and outpoint, which
  // is to say it changes per selection and never per frame.
  useLayoutEffect(() => {
    const chip = chipRef.current;
    handles.chip = chip;
    if (!chip) return undefined;
    const measure = () => {
      const box = chip.getBoundingClientRect();
      if (Math.abs(box.width - handles.chipWidth) < 0.5) return;
      handles.chipWidth = box.width;
      handles.chipHeight = box.height;
      invalidateConstellationFrame(handles);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(chip);
    return () => observer.disconnect();
  }, [handles, id, outpoint, lifetime]);
  return (
    <div
      ref={chipRef}
      data-cell-name-chip="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
        willChange: 'transform',
        background: rgba(HUD_COLORS.stageGround, 0.92),
        border: `1px solid ${rgba(CELL_CARD_ACCENT, 0.34)}`,
      }}
    >
      <span
        style={{
          fontFamily: HUD_FONTS.display,
          fontWeight: 600,
          fontSize: HUD_TYPE.section,
          letterSpacing: 1.6,
          color: CELL_CARD_ACCENT,
          textShadow: `0 0 9px ${rgba(CELL_CARD_ACCENT, 0.45)}`,
        }}
      >
        {`CELL // #${id}`}
      </span>
      <span
        style={{
          ...CJK_BASELINE_LIFT,
          fontFamily: HUD_FONTS.cjk,
          fontWeight: 400,
          fontSize: HUD_TYPE.label,
          color: CELL_CARD_ACCENT,
          opacity: COMPANION_OPACITY,
        }}
      >
        细胞
      </span>
      <span
        title={outpoint}
        style={{
          fontSize: HUD_TYPE.label,
          letterSpacing: 0.9,
          color: HUD_COLORS.dim,
        }}
      >
        {outpoint}
      </span>
      <span
        title={live ? 'LIVE' : 'SPENT'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          color: live ? HUD_COLORS.nominal : HUD_COLORS.ember, fontSize: HUD_TYPE.section,
          letterSpacing: 0.9,
        }}
      >
        <StatusLamp color={live ? HUD_COLORS.nominal : HUD_COLORS.ember} lit={live} size={5.5} />
        {lifetime}
      </span>
      {/* The chip's own close is the whole constellation's — the instruments
        * each carry theirs, and this one dismisses the selection they are all
        * readings of. */}
      <span style={{ position: 'relative', width: 14, height: 0 }}>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </span>
    </div>
  );
}

/**
 * The lines, and the tags that ride them.
 *
 * Two strokes per leader: a near-black one under a rose one. A single hairline
 * disappears over the nebula's bright patches, which is the same problem — and
 * the same answer — as a caption set over a photograph.
 *
 * The SVG has no `viewBox`: it is inset over the layer, so one user unit is one
 * CSS pixel and the frame writer can put the anchor's own screen coordinates
 * straight onto the lines with no transform in between.
 */
export function CellConstellationLeaders({
  handles,
  slots,
}: {
  handles: CellConstellationHandles;
  slots: readonly ConstellationSlot[];
}) {
  const present = CONSTELLATION_SLOTS.filter((slot) => slots.includes(slot));
  return (
    <>
      <svg
        data-cell-constellation-leaders="true"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}
      >
        {present.map((slot) => (
          <g key={slot} data-cell-leader={slot}>
            <line
              ref={(node) => { handles.leaders[slot].under = node; invalidateConstellationFrame(handles); }}
              stroke={rgba(HUD_COLORS.ground, 0.85)}
              strokeWidth={3.5}
            />
            <line
              ref={(node) => { handles.leaders[slot].over = node; invalidateConstellationFrame(handles); }}
              stroke={rgba(CELL_CARD_ACCENT, 0.72)}
              strokeWidth={1.2}
            />
            <circle
              ref={(node) => { handles.leaders[slot].dot = node; invalidateConstellationFrame(handles); }}
              r={3}
              fill={CELL_CARD_ACCENT}
              stroke={rgba(HUD_COLORS.ground, 0.85)}
              strokeWidth={1.5}
            />
          </g>
        ))}
      </svg>
      {present.map((slot) => (
        <span
          key={slot}
          ref={(node) => { handles.leaders[slot].label = node; invalidateConstellationFrame(handles); }}
          data-cell-leader-label={slot}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 2,
            padding: '1px 6px',
            pointerEvents: 'none',
            willChange: 'transform',
            whiteSpace: 'nowrap',
            background: rgba(HUD_COLORS.stageGround, 0.92),
            border: `1px solid ${rgba(CELL_CARD_ACCENT, 0.4)}`,
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.label,
            letterSpacing: 1.2,
            color: CELL_CARD_ACCENT,
          }}
        >
          {CONSTELLATION_TAG[slot]}
        </span>
      ))}
    </>
  );
}
