import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import type { EnrichmentSourceStatus } from '@cknerv/types';
import { useControls } from 'leva';
import {
  QUALITY_MODE_CONTROL,
  setQualityMode,
  useQualityRuntime,
  type QualityMode,
} from '../../tweaks/qualityPresets';
import {
  CELL_DISPLAY_MAX,
  cellDisplayLimitToSliderValue,
  cellDisplaySliderMaximum,
  cellDisplaySliderValueToLimit,
  normalizeCellDisplayCapacity,
  resolveCellDisplayLimit,
  setCellDisplayLimit,
  setCellDisplayMode,
  useCellDisplayRuntime,
} from '../../tweaks/cellDisplay';
import { HUD_COLORS, HUD_FONTS, HUD_MOTION, HUD_TYPE, rgba } from './hudTheme';
import { DiamondMark, DirectionMark, PanelGridMark, PLATE_CUT_CLIP } from './primitives';
import { POPULATION_SCOPE } from './cellPopulation.presentation';

export type BuildInfo = { version: string; href: string };
export type HudPanelControl = {
  id: string;
  code: string;
  label: string;
  visible: boolean;
  /** Where this panel sits out of the box. The control paints "you diverged"
   *  from the roster it is handed rather than from a count, so the HUD's own
   *  default table is the one authority on what the default IS. */
  defaultVisible: boolean;
};

/** What the strip is tall in each of its layouts, and the one table the boot
 *  band in `ui-app/index.html` restates so the band stands where the strip
 *  will (`boot-shell.test.ts` holds that pact).
 *
 *  Which layout the strip is IN is not decided here and is no longer decided
 *  by a screen size: the overlay measures the wide row against the room it has
 *  and folds to `compact` when one row would not fit
 *  (`useStatusStripFold.ts`). The phone's three-row layout stays a media
 *  query — a touch screen is a design, not a fit. */
export const STATUS_STRIP_HEIGHTS = {
  wide: 36,
  compact: 64,
  mobile: 59,
  mobileContext: 88,
} as const;

/** The strip's rail, and it has a rung of its own for exactly the reason its
 *  RULE does (`hudTheme.ts`, the alpha ladder): these hairlines are cyan on
 *  the instrument's own chrome, and a panel's are its accent. Measured against
 *  the near-black both are painted on, cyan at 0.14 lands where an accent
 *  lands at the overlay's 0.34 row rail — so snapping the strip to the panel
 *  rung would not tidy the strip, it would draw a cyan bar between every
 *  module. */
const STRIP_RAIL_ALPHA = 0.14;

const NAV_MODULE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  height: 24,
  boxSizing: 'border-box',
  borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, STRIP_RAIL_ALPHA)}`,
  background: `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.035)},transparent 78%)`,
};

// Build identity sits on the same angular rail as the other HUD modules and
// shows the full package version and commit hash.
function BuildChip({ build, compact = false }: { build: BuildInfo; compact?: boolean }) {
  const [hot, setHot] = useState(false);
  return (
    <a
      href={build.href}
      target="_blank"
      rel="noreferrer"
      aria-label={build.version}
      title={build.version}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      data-build-chip
      style={{
        ...NAV_MODULE_STYLE,
        gap: 5,
        height: 22,
        padding: compact ? '0 6px' : '0 8px',
        borderLeftColor: rgba(HUD_COLORS.orange, hot ? 0.56 : 0.24),
        borderBottom: `1px solid ${rgba(HUD_COLORS.orange, hot ? 0.34 : 0.1)}`,
        background: `linear-gradient(90deg,${rgba(HUD_COLORS.orange, hot ? 0.09 : 0.035)},transparent)`,
        boxShadow: hot ? `inset 0 -1px 8px ${rgba(HUD_COLORS.orange, 0.1)}` : 'none',
        fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, letterSpacing: 0.6, lineHeight: 1,
        textDecoration: 'none', pointerEvents: 'auto',
        transition: `border-color ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, background ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, box-shadow ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`,
      }}
    >
      <span className="cknerv-build-label" style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.9 }}>BUILD</span>
      <span style={{ color: hot ? HUD_COLORS.orange : HUD_COLORS.ink, whiteSpace: 'nowrap', textShadow: hot ? `0 0 6px ${rgba(HUD_COLORS.orange, 0.5)}` : 'none', transition: `color ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, text-shadow ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}` }}>{build.version}</span>
    </a>
  );
}

function PanelVisibilityControl({ panels, onChange, compact = false, menuOffset = 34 }: {
  panels: readonly HudPanelControl[];
  onChange: (id: string, visible: boolean) => void;
  compact?: boolean;
  menuOffset?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleCount = panels.filter((panel) => panel.visible).length;
  // A UI preference is not a health reading, so this control speaks the
  // active-config language AUTO/MAN already uses: cyan = sitting at the
  // default, orange = you have diverged from it. Caution yellow used to sit in
  // the middle and made a personal choice look like the chain was in trouble.
  //
  // ⚠️ AND "DEFAULT" IS NOT "ALL". The test used to be `visibleCount ===
  // panels.length`, which is a different sentence — and a false one, because
  // two of the seven modules are dev instruments that ship OFF. Out of the box
  // the HUD reads 5/7, so the first control after the wordmark said YOU
  // DIVERGED on every fresh load, in chrome orange, beside a BUILD chip whose
  // rail is also orange: the whole left cluster announced a change nobody had
  // made (report A, A-2). Divergence is now measured against where each panel
  // SITS by default, so hiding a panel that ships hidden is not a change and
  // showing one that ships shown is not either.
  const color = panels.some((panel) => panel.visible !== panel.defaultVisible)
    ? HUD_COLORS.orange
    : HUD_COLORS.cyanWire;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // ESCAPE CLOSES THE INNERMOST THING, and while this menu is open it IS the
    // innermost thing — a dropdown lives between two clicks and is the most
    // transient object in the HUD. So it claims the key in CAPTURE and marks
    // the event handled; the inspection card's dismissal listens in bubble and
    // stands down on `defaultPrevented` (`sceneInspection.tsx`). Both listen on
    // `document`, so phase is the only thing that can rank them — registration
    // order would rank them by which happened to open first.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-panel-visibility-control
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        className="cknerv-hud-control-button"
        aria-label={`Configure HUD panels, ${visibleCount} of ${panels.length} visible`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-panel-visibility-toggle
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        style={{
          appearance: 'none',
          ...NAV_MODULE_STYLE,
          display: 'inline-flex',
          alignItems: 'center',
          gap: compact ? 4 : 5,
          height: 22,
          padding: compact ? '0 5px' : '0 7px',
          borderTop: 0,
          borderRight: 0,
          borderLeft: `1px solid ${rgba(color, STRIP_RAIL_ALPHA)}`,
          borderBottom: `1px solid ${rgba(color, 0.12)}`,
          background: `linear-gradient(90deg,${rgba(color, 0.055)},transparent)`,
          color,
          // The `font:` shorthand is how the top bar's controls carry a line
          // height with their size; the px values inside it are on the same
          // scale as every `fontSize:` prop and `hudDiscipline.test.ts` parses
          // them the same way.
          font: `400 ${compact ? HUD_TYPE.nav : HUD_TYPE.tech}px/20px ${HUD_FONTS.mono}`,
          letterSpacing: compact ? 0.35 : 0.6,
          textShadow: `0 0 6px ${rgba(color, 0.38)}`,
          cursor: 'pointer',
        }}
      >
        {/* Both marks are drawn rather than typed, and both are decoration
            twice over: the button carries its own `aria-label` and an
            `aria-expanded`, so the icon and the caret say nothing the
            accessibility tree does not already have. They used to be `▦` and
            `▲`/`▼` — three characters no face in `src/fonts` carries, on the
            one control in the top bar that is pure chrome. */}
        <PanelGridMark size={HUD_TYPE.label} />
        <span className="cknerv-panel-toggle-label">PANELS</span>
        <span>{visibleCount}/{panels.length}</span>
        <DirectionMark direction={open ? 'up' : 'down'} color={HUD_COLORS.dim} size={4.5} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="HUD panels"
          data-panel-visibility-menu
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            zIndex: 60,
            top: menuOffset,
            left: 0,
            width: 244,
            maxWidth: 'calc(100vw - 16px)',
            boxSizing: 'border-box',
            padding: '7px 8px 8px',
            border: `1px solid ${rgba(HUD_COLORS.orange, 0.34)}`,
            background: rgba(HUD_COLORS.stageGround, 0.96),
            boxShadow: `0 8px 28px ${rgba(HUD_COLORS.ground, 0.72)}, 0 0 18px ${rgba(HUD_COLORS.orange, 0.08)}`,
            // THE FLOATING CUT, not two brackets. `primitives.tsx` states the
            // shape grammar in four forms and this menu was wearing the wrong
            // one: brackets say "bolted to the frame, present the whole
            // session", and a dropdown is the most transient object in the
            // HUD — it exists between two clicks. It was not even the docked
            // form as the house draws it (10 px at opacity 1 and offset −1
            // against `HudPanel`'s 11 at 0.8), which is what a hand-cut copy
            // of a shape always becomes (report A, A-11).
            clipPath: PLATE_CUT_CLIP,
            fontFamily: HUD_FONTS.mono,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              margin: '0 3px 5px',
              color: HUD_COLORS.orange,
              fontSize: HUD_TYPE.nav,
              letterSpacing: 1.4,
            }}
          >
            PANEL DISPLAY
            <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, letterSpacing: 0.6 }}>
              {visibleCount}/{panels.length} ACTIVE
            </span>
          </div>
          {panels.map((panel) => {
            const panelColor = panel.visible ? HUD_COLORS.cyanWire : HUD_COLORS.dim;
            return (
              <button
                key={panel.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={panel.visible}
                aria-label={`${panel.label} panel`}
                data-panel-control={panel.id}
                className="cknerv-hud-control-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(panel.id, !panel.visible);
                }}
                style={{
                  appearance: 'none',
                  display: 'grid',
                  gridTemplateColumns: '58px minmax(0,1fr) auto',
                  alignItems: 'center',
                  width: '100%',
                  height: 27,
                  padding: '0 5px',
                  border: 0,
                  borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.08)}`,
                  background: panel.visible ? rgba(HUD_COLORS.cyanWire, 0.035) : 'transparent',
                  color: panelColor,
                  font: `400 ${HUD_TYPE.tech}px/1 ${HUD_FONTS.mono}`,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: panel.visible ? panelColor : HUD_COLORS.dim, letterSpacing: 0.6 }}>
                  {panel.code}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: 0.9 }}>
                  {panel.label}
                </span>
                <span
                  style={{
                    // ON is a switch position, not a healthy chain — cyan, the
                    // house color for "this setting is active". OFF stays dim.
                    color: panel.visible ? HUD_COLORS.cyanWire : HUD_COLORS.dim,
                    fontSize: HUD_TYPE.micro,
                    letterSpacing: 0.6,
                  }}
                >
                  {panel.visible ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
          {/* THE KEYS, WHERE THE PANELS ARE.
              Three keys do something in this application and not one of them
              was named anywhere on screen (report E, E-14): Escape closes,
              a backtick opens the dev tweaks, and the arrows walk the memory
              route's hops. A discoverable shortcut is one you can find without
              being told, and this menu is where a reader already comes to ask
              what the instrument can do. Set in `dim` under a rule, because it
              is a legend rather than a control — nothing here is clickable. */}
          <div
            data-panel-menu-keys
            style={{
              display: 'flex',
              gap: 9,
              margin: '6px 3px 0',
              paddingTop: 5,
              borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.16)}`,
              color: HUD_COLORS.dim,
              fontSize: HUD_TYPE.micro,
              letterSpacing: 0.6,
            }}
          >
            <span>KEYS</span>
            <span style={{ marginLeft: 'auto' }}>ESC CLOSE · ` TWEAKS · ← → HOPS</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ENRICHMENT_COLOR: Record<EnrichmentSourceStatus['status'], string> = {
  disabled: HUD_COLORS.dim,
  connecting: HUD_COLORS.cyanWire,
  syncing: HUD_COLORS.cyanWire,
  ready: HUD_COLORS.nominal,
  stale: HUD_COLORS.caution,
  incompatible: HUD_COLORS.danger,
  error: HUD_COLORS.danger,
};

function EnrichmentChip({ source, compact = false }: {
  source: EnrichmentSourceStatus;
  compact?: boolean;
}) {
  const color = ENRICHMENT_COLOR[source.status];
  // ⚠️ `LAG n`, NOT `n↓`. `CKBADGER READY 0↓` reads as "zero, down" — an arrow
  // is a DIRECTION mark in this HUD (`DirectionMark`, the flow rows, the
  // deltas) and it was standing in for a noun (report A, A-13). The word costs
  // three characters and the tooltip stops being the only place the reading is
  // named. Zero is printed rather than hidden: a source at the tip saying so is
  // the reading, and a chip that only speaks when it is behind would make the
  // absence of a number the good news.
  const lag = source.lag_blocks == null ? '' : ` · LAG ${source.lag_blocks}`;
  return (
    <span
      data-enrichment-chip
      data-enrichment-status={source.status}
      aria-label={`${source.source} ${source.status}${lag}`}
      title={source.message ?? `Enhanced context from ${source.source}`}
      style={{
        ...NAV_MODULE_STYLE,
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 5,
        height: 24,
        padding: compact ? '0 7px' : '0 9px',
        borderLeftColor: rgba(color, 0.25),
        fontFamily: HUD_FONTS.mono,
        fontSize: HUD_TYPE.tech,
        letterSpacing: 0.6,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
      {source.source === 'ckbadger' ? (
        <a
          className="cknerv-hud-link"
          href="https://ckbadger.web5.info/"
          target="_blank"
          rel="noopener noreferrer"
          title="Open ckbadger.web5.info in a new tab"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', height: '100%', pointerEvents: 'auto' }}
        >
          CKBADGER
        </a>
      ) : (
        <span style={{ color: HUD_COLORS.dim }}>{source.source.toUpperCase()}</span>
      )}
      <span style={{ color, textShadow: `0 0 6px ${rgba(color, 0.34)}` }}>{source.status.toUpperCase()}{lag}</span>
    </span>
  );
}

const QUALITY_MODES = ['auto', 'high', 'med', 'low'] as const satisfies readonly QualityMode[];
const CELL_TRACK_TICKS = [0, 50, 100] as const;

function fmtCellCount(count: number): string {
  if (count < 1_000) return String(count);
  const compact = count / 1_000;
  return `${Number.isInteger(compact) ? compact : compact.toFixed(1)}K`;
}

function CellDisplayControl({
  availableCells,
  capacity = CELL_DISPLAY_MAX,
  compact = false,
}: {
  availableCells?: number;
  capacity?: number;
  compact?: boolean;
}) {
  const quality = useQualityRuntime();
  const display = useCellDisplayRuntime();
  const serverCapacity = Number.isFinite(capacity)
    ? Math.max(0, Math.floor(capacity))
    : CELL_DISPLAY_MAX;
  const automaticCapacity = normalizeCellDisplayCapacity(serverCapacity);
  const limit = resolveCellDisplayLimit(
    display,
    automaticCapacity,
  );
  const sliderMaximum = cellDisplaySliderMaximum();
  const sliderValue = cellDisplayLimitToSliderValue(limit);
  const available = Number.isFinite(availableCells)
    ? Math.max(0, Math.floor(availableCells ?? 0))
    : limit;
  const visible = Math.min(available, limit);
  const progress = sliderMaximum > 0
    ? (sliderValue / sliderMaximum) * 100
    : 100;
  const shownSliderValue = cellDisplayLimitToSliderValue(visible);
  const shownProgress = sliderMaximum > 0
    ? (shownSliderValue / sliderMaximum) * 100
    : 100;
  const headroomProgress = Math.max(0, progress - shownProgress);
  const accent = display.mode === 'auto'
    ? HUD_COLORS.cyanWire
    : HUD_COLORS.orange;
  const modeLabel = display.mode === 'auto' ? 'AUTO' : 'MAN';
  // The lock is the honest half of the reading: after calibration this tier
  // is not a current sample but the page's settled answer.
  const qualityLabel = `${quality.effective.toUpperCase()}${
    quality.locked ? ' (locked)' : ''
  }`;
  const detail = display.mode === 'auto'
    ? `${visible.toLocaleString()} shown · ${available.toLocaleString()} available · adaptive ${qualityLabel} cap ${limit.toLocaleString()} · server retains ${serverCapacity.toLocaleString()}`
    : `${visible.toLocaleString()} shown · ${available.toLocaleString()} available · manual cap ${limit.toLocaleString()}${
      serverCapacity < limit
        ? ` · server currently retains ${serverCapacity.toLocaleString()}`
        : ''
    }`;

  return (
    <div
      role="group"
      aria-label="Cell display count"
      data-cell-display-control
      data-cell-display-mode={display.mode}
      data-cell-display-limit={limit}
      data-cell-display-count={visible}
      data-cell-display-available={available}
      data-cell-display-capacity={CELL_DISPLAY_MAX}
      data-cell-display-source-capacity={serverCapacity}
      title={detail}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        ...NAV_MODULE_STYLE,
        gap: compact ? 5 : 7,
        height: 24,
        padding: compact ? '0 7px' : '0 10px',
        pointerEvents: 'auto',
        fontFamily: HUD_FONTS.mono,
      }}
    >
      <span
        className="cknerv-cell-display-label"
        style={{
          color: HUD_COLORS.dim,
          fontSize: HUD_TYPE.tech,
          letterSpacing: 1.2,
          lineHeight: 1,
        }}
      >
        {`${POPULATION_SCOPE.stage} CELLS`}
      </span>
      <output
        data-cell-display-shown
        aria-label={`${visible.toLocaleString()} Cells shown`}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          minWidth: compact ? 27 : 34,
          color: HUD_COLORS.cyanWire,
          fontSize: HUD_TYPE.section,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.6,
          whiteSpace: 'nowrap',
          textShadow: `0 0 6px ${rgba(HUD_COLORS.cyanWire, 0.34)}`,
        }}
      >
        <span>{fmtCellCount(visible)}</span>
      </output>
      <button
        type="button"
        className="cknerv-hud-control-button cknerv-cell-display-auto"
        aria-label="Automatic cell count"
        aria-pressed={display.mode === 'auto'}
        title={display.mode === 'auto'
          ? `Automatic cap active · ${qualityLabel} = ${limit.toLocaleString()}`
          : 'Manual cap active · click to return to AUTO'}
        onClick={(event) => {
          event.stopPropagation();
          setCellDisplayMode('auto');
        }}
        style={{
          appearance: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: 18,
          padding: '0 1px',
          border: 0,
          background: 'transparent',
          color: accent,
          font: `400 ${HUD_TYPE.tech}px/18px ${HUD_FONTS.mono}`,
          letterSpacing: 0.6,
          textShadow: `0 0 7px ${rgba(accent, 0.45)}`,
          cursor: 'pointer',
          transition: `color ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, text-shadow ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`,
        }}
      >
        <DiamondMark color={accent} size={4} fill="wash" />
        {modeLabel}
      </button>
      <span
        className="cknerv-cell-display-track"
        data-cell-display-track
        style={{
          position: 'relative',
          display: 'inline-block',
          width: compact ? 44 : 64,
          height: 18,
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 9,
            height: 1,
            background: rgba(HUD_COLORS.cyanWire, 0.16),
          }}
        />
        <span
          aria-hidden="true"
          data-cell-display-shown-fill
          style={{
            position: 'absolute',
            left: 0,
            top: 9,
            width: `${shownProgress}%`,
            height: 1,
            background: rgba(HUD_COLORS.cyanWire, 0.78),
            boxShadow: `0 0 5px ${rgba(HUD_COLORS.cyanWire, 0.32)}`,
          }}
        />
        {headroomProgress > 0 ? (
          <span
            aria-hidden="true"
            data-cell-display-headroom
            style={{
              position: 'absolute',
              left: `${shownProgress}%`,
              top: 9,
              width: `${headroomProgress}%`,
              height: 1,
              background: `repeating-linear-gradient(90deg,${rgba(accent, 0.42)} 0 2px,transparent 2px 4px)`,
            }}
          />
        ) : null}
        {CELL_TRACK_TICKS.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${tick}%`,
              top: 7,
              width: 1,
              height: 5,
              background: tick <= shownProgress
                ? rgba(HUD_COLORS.cyanWire, 0.58)
                : tick <= progress
                  ? rgba(accent, 0.34)
                  : rgba(HUD_COLORS.cyanWire, 0.14),
              transform: 'translateX(-0.5px)',
            }}
          />
        ))}
        {visible > 0 && headroomProgress > 0 ? (
          <span
            aria-hidden="true"
            data-cell-display-shown-marker
            style={{
              position: 'absolute',
              left: `${shownProgress}%`,
              top: 7,
              width: 4,
              height: 4,
              borderRadius: '50%',
              border: `1px solid ${HUD_COLORS.cyanWire}`,
              background: HUD_COLORS.ground,
              boxShadow: `0 0 6px ${rgba(HUD_COLORS.cyanWire, 0.68)}`,
              transform: 'translateX(-50%)',
            }}
          />
        ) : null}
        <DiamondMark
          color={accent}
          attrs={{ 'data-cell-display-cap-marker': 'true' }}
          size={6}
          fill="ground"
          centered="x"
          style={{ position: 'absolute', left: `${progress}%`, top: 6 }}
        />
        <input
          className="cknerv-cell-display-slider"
          type="range"
          aria-label="Displayed cell limit"
          aria-valuetext={`Display cap ${limit.toLocaleString()} Cells · ${visible.toLocaleString()} shown of ${available.toLocaleString()} available · ${display.mode}`}
          min={0}
          max={sliderMaximum}
          step={1}
          value={sliderValue}
          onChange={(event) => {
            setCellDisplayLimit(
              cellDisplaySliderValueToLimit(Number(event.currentTarget.value)),
            );
          }}
          style={{
            appearance: 'none',
            position: 'absolute',
            zIndex: 1,
            inset: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            opacity: 0,
            cursor: 'ew-resize',
          }}
        />
      </span>
      <output
        data-cell-display-cap
        aria-label={`Cell display cap: ${limit.toLocaleString()} Cells`}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 2,
          minWidth: compact ? 28 : 34,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: HUD_COLORS.dim,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 0.9,
          }}
        >
          /
        </span>
        <span
          style={{
            color: accent,
            fontSize: HUD_TYPE.label,
            letterSpacing: 0.6,
            textShadow: `0 0 6px ${rgba(accent, 0.38)}`,
          }}
        >
          {fmtCellCount(limit)}
        </span>
      </output>
    </div>
  );
}

function RenderQualityControl({ compact = false }: { compact?: boolean }) {
  const quality = useQualityRuntime();
  const [, setLevaQuality] = useControls('Time', () => QUALITY_MODE_CONTROL, []);
  const accent = quality.mode === 'auto' ? HUD_COLORS.cyanWire : HUD_COLORS.orange;

  const selectMode = (mode: QualityMode) => {
    // Keep the always-visible HUD control and the hidden developer panel on
    // one setting. The direct runtime write makes the response immediate;
    // the Leva write lets AdaptiveQualityController reset its sampling state
    // when ownership moves between automatic and manual modes.
    setLevaQuality({ quality: mode });
    setQualityMode(mode);
  };

  return (
    <div
      role="group"
      aria-label="Render quality"
      data-render-quality-control
      data-quality-mode={quality.mode}
      data-quality-effective={quality.effective}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        ...NAV_MODULE_STYLE,
        gap: compact ? 4 : 7,
        height: 24,
        padding: compact ? '0 6px' : '0 9px',
        pointerEvents: 'auto',
        fontFamily: HUD_FONTS.mono,
      }}
    >
      <span
        className="cknerv-quality-label"
        style={{
          color: HUD_COLORS.dim,
          fontSize: HUD_TYPE.tech,
          letterSpacing: 1.2,
          lineHeight: 1,
        }}
      >
        QUALITY
      </span>
      <span
        className="cknerv-quality-rail"
        data-quality-rail
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          height: 18,
          padding: '0 1px 1px',
          background: `linear-gradient(90deg,transparent,${rgba(HUD_COLORS.cyanWire, 0.08)},transparent) left bottom/100% 1px no-repeat`,
        }}
      >
        {QUALITY_MODES.map((mode, index) => {
          const active = quality.mode === mode;
          // ⚠️ PARENTHESES, NOT A MIDDOT. `AUTO·M` sat immediately left of the
          // three tier buttons — `H M L` — so the strip read `AUTO·M H M L`
          // and the suffix looked like the M button had escaped its rail
          // (report A, A-13). It is not a tier here, it is what AUTO CHOSE, so
          // it is written the way a chosen value is written; and `·` is the
          // HUD's own separator between two peers, which these are not.
          const autoSuffix = mode === 'auto' && active
            ? `(${quality.effective.slice(0, 1).toUpperCase()})`
            : '';
          return (
            <button
              key={mode}
              type="button"
              className="cknerv-hud-control-button cknerv-quality-option"
              aria-label={`${mode[0].toUpperCase()}${mode.slice(1)} render quality`}
              aria-pressed={active}
              data-quality-option={mode}
              title={mode === 'auto'
                ? `Adaptive render quality — currently ${quality.effective.toUpperCase()}`
                : `Use ${mode.toUpperCase()} render quality`}
              onClick={(event) => {
                event.stopPropagation();
                selectMode(mode);
              }}
              style={{
                appearance: 'none',
                position: 'relative',
                minWidth: mode === 'auto' ? 40 : 23,
                height: 18,
                padding: '0 3px 2px',
                border: 0,
                background: 'transparent',
                color: active ? accent : HUD_COLORS.dim,
                font: `400 ${HUD_TYPE.tech}px/16px ${HUD_FONTS.mono}`,
                letterSpacing: 0.6,
                textAlign: 'center',
                textShadow: active
                  ? `0 0 7px ${rgba(accent, 0.5)}`
                  : 'none',
                cursor: 'pointer',
                transition: `color ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}, text-shadow ${HUD_MOTION.flip}ms ${HUD_MOTION.fadeEase}`,
              }}
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 6,
                    width: 1,
                    height: 5,
                    background: rgba(HUD_COLORS.cyanWire, 0.12),
                  }}
                />
              ) : null}
              {mode === 'auto' ? 'AUTO' : mode[0].toUpperCase()}{autoSuffix}
              {active ? (
                <DiamondMark
                  color={accent}
                  size={4}
                  fill="ground"
                  centered="x"
                  style={{ position: 'absolute', left: '50%', bottom: 0 }}
                />
              ) : null}
            </button>
          );
        })}
      </span>
    </div>
  );
}

function StatusStrip({
  build,
  cellCount,
  cellCapacity,
  enrichmentSource,
  actions,
  panelControls,
  onPanelVisibilityChange,
  compact = false,
  mobile = false,
  probe = false,
  probeRef,
}: {
  build?: BuildInfo;
  /** Records currently available to the visual layer, before its draw cap. */
  cellCount?: number;
  /** Resolved server projection cap used by AUTO and capacity disclosure. */
  cellCapacity?: number;
  /** Optional indexed-context health. Omitted when no source is configured. */
  enrichmentSource?: EnrichmentSourceStatus;
  /** Product-specific controls rendered after the indexed-context status,
   *  with the strip's module styling and typography.
   *
   *  ⚠️ Whatever is put here is MOUNTED TWICE by a host that probes (the HUD
   *  overlay does): once in the strip a reader sees and once inside the hidden
   *  probe, whose width it is part of — that is the point, a chip in this slot
   *  is one of the things that can push the row past its room. It must be safe
   *  to mount twice: no singleton registration, no side effect on mount that
   *  assumes it is alone. */
  actions?: ReactNode;
  /** Individually configurable dashboard panels; status/navigation stays visible. */
  panelControls?: readonly HudPanelControl[];
  onPanelVisibilityChange?: (id: string, visible: boolean) => void;
  /** Two-row navigation layout: identity on the first row, the
   *  controls scrolling on the second.
   *
   *  The strip does not choose it and never asks how wide the screen is. The
   *  overlay decides, by MEASURING — it renders a second copy of this strip as
   *  a probe (below), reads how wide one row wants to be, and folds when that
   *  will not fit the room the page has (`useStatusStripFold.ts`, which owns
   *  the slack and the hysteresis). The strip stays what it was: told which
   *  layout to wear. */
  compact?: boolean;
  /** Three-row priority layout that keeps primary controls visible on phones. */
  mobile?: boolean;
  /** Render as the PROBE: the wide row, laid out at its natural width, hidden,
   *  and there for no reason but to be measured.
   *
   *  The only thing that knows how wide one row wants to be is the row —
   *  its width IS content (the ckbadger status word and its lag digits,
   *  `PANELS n/m`, whatever the host puts in
   *  `actions`), so any number typed for it is right for one content state and
   *  wrong the moment the content moves. A probe makes the fold a function of
   *  what is actually there, at every moment.
   *
   *  It therefore ignores `compact` and `mobile`: a probe measures the ONE ROW
   *  by definition, and a probe that folded with the strip could never tell the
   *  overlay it had room to unfold. `visibility: hidden` is what keeps it out
   *  of everything — not hit-tested, not focusable, not in the accessibility
   *  tree — and it is inherited, so the controls' own `pointerEvents: 'auto'`
   *  cannot reach back through it. It wears its own class, no `role` and no
   *  accent rail, so every selector that takes `.cknerv-status-strip` or
   *  `[role="navigation"]` still finds exactly the strip a reader can see. */
  probe?: boolean;
  /** The probe's root, so the overlay can measure it (`useStatusStripFold`).
   *  A plain prop rather than `forwardRef`: this component is `memo(fn)` and
   *  the real strip has no reason to hand a ref anywhere. */
  probeRef?: Ref<HTMLDivElement>;
}) {
  const layout = probe ? 'wide' : mobile ? 'mobile' : compact ? 'compact' : 'wide';
  const dense = layout !== 'wide';
  const mobileHasContext = layout === 'mobile'
    && Boolean(enrichmentSource || actions);
  const barHeight = mobileHasContext
    ? STATUS_STRIP_HEIGHTS.mobileContext
    : STATUS_STRIP_HEIGHTS[layout];
  const accentRail = (
    <span
      data-status-accent-rail
      aria-hidden="true"
      style={{
        position: 'absolute',
        zIndex: 1,
        left: 0,
        right: 0,
        bottom: 0,
        height: 1,
        background: `linear-gradient(90deg,${rgba(HUD_COLORS.orange, 0.42)} 0%,${rgba(HUD_COLORS.orange, 0.1)} 24%,${rgba(HUD_COLORS.cyanWire, 0.2)} 72%,${rgba(HUD_COLORS.cyanWire, 0.42)} 100%)`,
        boxShadow: `0 1px 7px ${rgba(HUD_COLORS.cyanWire, 0.08)}`,
        pointerEvents: 'none',
      }}
    />
  );
  const primary = (
    <div
      data-status-primary
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minWidth: 0,
        height: '100%',
        gap: dense ? 5 : 7,
        overflow: 'visible',
      }}
    >
      <span
        data-status-brand
        style={{
          flexShrink: 0,
          paddingRight: dense ? 3 : 7,
          fontFamily: HUD_FONTS.display,
          fontWeight: 700,
          fontSize: dense ? HUD_TYPE.section : HUD_TYPE.panelTitle,
          // Declared exception to the tracking table in `hudTheme.ts`: the
          // spacing here IS the wordmark. Snapping it to a rung would not make
          // the bar more coherent, it would make the logotype a label.
          letterSpacing: dense ? 2.6 : 4.2,
          color: HUD_COLORS.orange,
          textShadow: `0 0 9px ${rgba(HUD_COLORS.orange, 0.46)}`,
        }}
      >
        CKNERV
      </span>
      {build ? <BuildChip build={build} compact={dense} /> : null}
      {onPanelVisibilityChange && panelControls?.length ? (
        <PanelVisibilityControl
          panels={panelControls}
          onChange={onPanelVisibilityChange}
          compact={dense}
          menuOffset={barHeight - (layout === 'wide' ? 3 : 1)}
        />
      ) : null}
    </div>
  );
  const actionsSlot = actions ? (
    <div
      data-status-actions
      style={{
        ...NAV_MODULE_STYLE,
        padding: dense ? '0 7px' : '0 9px',
        fontFamily: HUD_FONTS.mono,
        fontSize: HUD_TYPE.tech,
        letterSpacing: 0.6,
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
    >
      {actions}
    </div>
  ) : null;
  const performanceControls = (
    <>
      <CellDisplayControl
        availableCells={cellCount}
        capacity={cellCapacity}
        compact={dense}
      />
      <RenderQualityControl compact={layout === 'mobile'} />
    </>
  );
  const contextControls = (
    <>
      {enrichmentSource ? <EnrichmentChip source={enrichmentSource} compact={dense} /> : null}
      {actionsSlot}
    </>
  );

  if (layout === 'mobile') {
    return (
      <div
        className="cknerv-status-strip"
        role="navigation"
        aria-label="Dashboard controls"
        data-status-layout="mobile"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: barHeight,
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr)',
          gridTemplateRows: mobileHasContext ? '30px 29px 29px' : '30px 29px',
          padding: '0 8px',
          overflow: 'visible',
          background: `linear-gradient(180deg,${rgba(HUD_COLORS.stageGround, 0.985)},${rgba(HUD_COLORS.stageGround, 0.965)})`,
          boxShadow: `0 7px 22px ${rgba(HUD_COLORS.ground, 0.36)}`,
        }}
      >
        {primary}
        <div
          className="cknerv-status-controls"
          data-status-controls
          data-status-performance
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            overflow: 'hidden',
            pointerEvents: 'auto',
            borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.07)}`,
          }}
        >
          {performanceControls}
        </div>
        {mobileHasContext ? (
          <div
            className="cknerv-status-context"
            data-status-context
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              overflowX: 'auto',
              overflowY: 'hidden',
              overscrollBehaviorX: 'contain',
              scrollbarWidth: 'none',
              pointerEvents: 'auto',
              borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.07)}`,
            }}
          >
            {contextControls}
          </div>
        ) : null}
        {accentRail}
      </div>
    );
  }

  if (layout === 'compact') {
    return (
      <div
        className="cknerv-status-strip"
        role="navigation"
        aria-label="Dashboard controls"
        data-status-layout="compact"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: barHeight,
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr)',
          gridTemplateRows: '32px 32px',
          padding: '0 8px',
          overflow: 'visible',
          background: `linear-gradient(180deg,${rgba(HUD_COLORS.stageGround, 0.985)},${rgba(HUD_COLORS.stageGround, 0.96)})`,
          boxShadow: `0 7px 22px ${rgba(HUD_COLORS.ground, 0.32)}`,
        }}
      >
        {primary}
        <div
          className="cknerv-status-controls"
          data-status-controls
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            overscrollBehaviorX: 'contain',
            scrollbarWidth: 'none',
            pointerEvents: 'auto',
            borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.07)}`,
          }}
        >
          {performanceControls}
          {contextControls}
        </div>
        {accentRail}
      </div>
    );
  }

  // The wide row, and — when `probe` is set — the hidden copy of it the
  // overlay measures. Same children, same paddings, same gaps: a measurement
  // of anything else would be a measurement of something the reader is not
  // looking at. What the probe drops is everything that would make it a
  // SECOND strip rather than a reading of the first: the class the selectors
  // take, the landmark role, the accent rail, and the `right: 0` that would
  // stretch it to the page instead of letting it stand at its natural width.
  return (
    <div
      ref={probeRef}
      className={probe ? 'cknerv-status-strip-probe' : 'cknerv-status-strip'}
      role={probe ? undefined : 'navigation'}
      aria-label={probe ? undefined : 'Dashboard controls'}
      aria-hidden={probe ? true : undefined}
      data-status-layout="wide"
      data-status-probe={probe ? 'true' : undefined}
      style={{ position: 'absolute', left: 0, right: probe ? 'auto' : 0, top: 0, width: probe ? 'max-content' : undefined, height: barHeight, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', overflow: 'visible', background: `linear-gradient(180deg,${rgba(HUD_COLORS.stageGround, 0.985)},${rgba(HUD_COLORS.stageGround, 0.955)})`, boxShadow: `0 7px 22px ${rgba(HUD_COLORS.ground, 0.28)}`, visibility: probe ? 'hidden' : undefined, pointerEvents: probe ? 'none' : undefined }}
    >
      {primary}
      <span style={{ flex: 1 }} />
      {performanceControls}
      {contextControls}
      {probe ? null : accentRail}
    </div>
  );
}

// The overlay holds props stable so the strip renders when its data or a
// control changes.
export default memo(StatusStrip);
