import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { EnrichmentSourceStatus } from '@cknerv/types';
import { useControls } from 'leva';
import type { AlertLevel } from '../../derives/alertLevel';
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
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';

export type BuildInfo = { version: string; href: string };
export type HudPanelControl = {
  id: string;
  code: string;
  label: string;
  visible: boolean;
};

export const STATUS_STRIP_HEIGHTS = {
  wide: 36,
  compact: 64,
  mobile: 59,
  mobileContext: 88,
} as const;

const NAV_MODULE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  height: 24,
  boxSizing: 'border-box',
  borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.14)}`,
  background: `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.035)},transparent 78%)`,
};

const LEVEL_COLOR: Record<AlertLevel, string> = {
  nominal: HUD_COLORS.nominal, syncing: HUD_COLORS.cyanWire, caution: HUD_COLORS.caution,
  warning: HUD_COLORS.warning, danger: HUD_COLORS.danger, crit: HUD_COLORS.danger,
};

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `UP ${hh}:${mm}:${ss}`;
}

// Build identity sits on the same angular rail as the other HUD modules. The
// date suffix remains available in the tooltip; the commit-sized head is the
// useful, scannable identifier in the bar itself.
function BuildChip({ build, compact = false }: { build: BuildInfo; compact?: boolean }) {
  const [hot, setHot] = useState(false);
  const at = build.version.indexOf('@');
  const head = at >= 0 ? build.version.slice(0, at) : build.version;
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
        maxWidth: compact ? 86 : 112,
        overflow: 'hidden',
        height: 22,
        padding: compact ? '0 6px' : '0 8px',
        borderLeftColor: rgba(HUD_COLORS.orange, hot ? 0.56 : 0.24),
        borderBottom: `1px solid ${rgba(HUD_COLORS.orange, hot ? 0.34 : 0.1)}`,
        background: `linear-gradient(90deg,${rgba(HUD_COLORS.orange, hot ? 0.09 : 0.035)},transparent)`,
        boxShadow: hot ? `inset 0 -1px 8px ${rgba(HUD_COLORS.orange, 0.1)}` : 'none',
        fontFamily: HUD_FONTS.mono, fontSize: 9, letterSpacing: 0.55, lineHeight: 1,
        textDecoration: 'none', pointerEvents: 'auto',
        transition: 'border-color .18s, background .18s, box-shadow .18s',
      }}
    >
      <span className="cknerv-build-label" style={{ color: HUD_COLORS.dim, fontSize: 7, letterSpacing: 1 }}>BUILD</span>
      <span style={{ color: hot ? HUD_COLORS.orange : HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: hot ? `0 0 6px ${rgba(HUD_COLORS.orange, 0.5)}` : 'none', transition: 'color .18s, text-shadow .18s' }}>{head}</span>
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
  const color = visibleCount === panels.length
    ? HUD_COLORS.cyanWire
    : visibleCount === 0
      ? HUD_COLORS.orange
      : HUD_COLORS.caution;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
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
          borderLeft: `1px solid ${rgba(color, 0.3)}`,
          borderBottom: `1px solid ${rgba(color, 0.12)}`,
          background: `linear-gradient(90deg,${rgba(color, 0.055)},transparent)`,
          color,
          font: `400 ${compact ? 8 : 8.5}px/20px ${HUD_FONTS.mono}`,
          letterSpacing: compact ? 0.45 : 0.7,
          textShadow: `0 0 6px ${rgba(color, 0.38)}`,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{ fontSize: 9 }}>▦</span>
        <span className="cknerv-panel-toggle-label">PANELS</span>
        <span>{visibleCount}/{panels.length}</span>
        <span aria-hidden style={{ color: HUD_COLORS.dim, fontSize: 7 }}>{open ? '▲' : '▼'}</span>
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
            background: 'rgba(2,5,8,.96)',
            boxShadow: `0 8px 28px rgba(0,0,0,.72), 0 0 18px ${rgba(HUD_COLORS.orange, 0.08)}`,
            fontFamily: HUD_FONTS.mono,
          }}
        >
          <span aria-hidden style={{ position: 'absolute', left: -1, top: -1, width: 10, height: 10, borderLeft: `1px solid ${HUD_COLORS.orange}`, borderTop: `1px solid ${HUD_COLORS.orange}` }} />
          <span aria-hidden style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRight: `1px solid ${HUD_COLORS.orange}`, borderBottom: `1px solid ${HUD_COLORS.orange}` }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              margin: '0 3px 5px',
              color: HUD_COLORS.orange,
              fontSize: 8,
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
                  font: `400 8.5px/1 ${HUD_FONTS.mono}`,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: panel.visible ? panelColor : HUD_COLORS.dim, letterSpacing: 0.6 }}>
                  {panel.code}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: 0.8 }}>
                  {panel.label}
                </span>
                <span
                  style={{
                    color: panel.visible ? HUD_COLORS.nominal : HUD_COLORS.dim,
                    fontSize: 7.5,
                    letterSpacing: 0.7,
                  }}
                >
                  {panel.visible ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
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
  const lag = source.lag_blocks == null ? '' : ` ${source.lag_blocks}↓`;
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
        fontSize: 8.5,
        letterSpacing: 0.75,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
      <span style={{ color: HUD_COLORS.dim }}>{source.source.toUpperCase()}</span>
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
  const detail = display.mode === 'auto'
    ? `${visible.toLocaleString()} shown · ${available.toLocaleString()} available · adaptive ${quality.effective.toUpperCase()} cap ${limit.toLocaleString()} · server retains ${serverCapacity.toLocaleString()}`
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
          fontSize: 8.5,
          letterSpacing: 1.2,
          lineHeight: 1,
        }}
      >
        CELLS
      </span>
      <output
        data-cell-display-shown
        aria-label={`${visible.toLocaleString()} Cells shown`}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          minWidth: compact ? 27 : 34,
          color: HUD_COLORS.cyanWire,
          fontSize: 10,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.55,
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
          ? `Automatic cap active · ${quality.effective.toUpperCase()} = ${limit.toLocaleString()}`
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
          font: `400 8.5px/18px ${HUD_FONTS.mono}`,
          letterSpacing: 0.65,
          textShadow: `0 0 7px ${rgba(accent, 0.45)}`,
          cursor: 'pointer',
          transition: 'color .14s, text-shadow .14s',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 4,
            height: 4,
            border: `1px solid ${accent}`,
            background: rgba(accent, 0.2),
            boxShadow: `0 0 6px ${rgba(accent, 0.65)}`,
            transform: 'rotate(45deg)',
          }}
        />
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
        <span
          aria-hidden="true"
          data-cell-display-cap-marker
          style={{
            position: 'absolute',
            left: `${progress}%`,
            top: 6,
            width: 6,
            height: 6,
            border: `1px solid ${accent}`,
            background: HUD_COLORS.ground,
            boxShadow: `0 0 7px ${rgba(accent, 0.72)}`,
            transform: 'translateX(-50%) rotate(45deg)',
          }}
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
            fontSize: 7,
            letterSpacing: 0.8,
          }}
        >
          /
        </span>
        <span
          style={{
            color: accent,
            fontSize: 9,
            letterSpacing: 0.65,
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
          fontSize: 8.5,
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
          const autoSuffix = mode === 'auto' && active
            ? `·${quality.effective.slice(0, 1).toUpperCase()}`
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
                font: `400 8.5px/16px ${HUD_FONTS.mono}`,
                letterSpacing: 0.65,
                textAlign: 'center',
                textShadow: active
                  ? `0 0 7px ${rgba(accent, 0.5)}`
                  : 'none',
                cursor: 'pointer',
                transition: 'color .14s, text-shadow .14s',
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
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 0,
                    width: 4,
                    height: 4,
                    border: `1px solid ${accent}`,
                    background: HUD_COLORS.ground,
                    boxShadow: `0 0 6px ${rgba(accent, 0.7)}`,
                    transform: 'translateX(-50%) rotate(45deg)',
                  }}
                />
              ) : null}
            </button>
          );
        })}
      </span>
    </div>
  );
}

export default function StatusStrip({
  level,
  uptimeMs,
  build,
  cellCount,
  cellCapacity,
  enrichmentSource,
  actions,
  panelControls,
  onPanelVisibilityChange,
  compact = false,
  mobile = false,
}: {
  level: AlertLevel;
  uptimeMs: number;
  build?: BuildInfo;
  /** Records currently available to the visual layer, before its draw cap. */
  cellCount?: number;
  /** Resolved server projection cap used by AUTO and capacity disclosure. */
  cellCapacity?: number;
  /** Optional indexed-context health. Omitted when no source is configured. */
  enrichmentSource?: EnrichmentSourceStatus;
  /** Product-specific controls rendered without coupling the shared HUD to them. */
  actions?: ReactNode;
  /** Individually configurable dashboard panels; status/navigation stays visible. */
  panelControls?: readonly HudPanelControl[];
  onPanelVisibilityChange?: (id: string, visible: boolean) => void;
  /** Two-row navigation layout used when horizontal space is constrained. */
  compact?: boolean;
  /** Three-row priority layout that keeps primary controls visible on phones. */
  mobile?: boolean;
}) {
  const layout = mobile ? 'mobile' : compact ? 'compact' : 'wide';
  const dense = layout !== 'wide';
  const color = LEVEL_COLOR[level];
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
          fontSize: dense ? 10.5 : 12,
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
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        pointerEvents: 'auto',
      }}
    >
      {actions}
    </div>
  ) : null;
  const statusIndicator = (
    <span
      data-status-indicator
      style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: dense ? 5 : 7, fontFamily: HUD_FONTS.tech, fontWeight: 600, fontSize: dense ? 8.5 : 9.5, letterSpacing: dense ? 1 : 1.6, color }}
    >
      {!dense ? <span style={{ fontFamily: HUD_FONTS.cjk, color: HUD_COLORS.dim }}>状态</span> : null}
      <span data-dot data-level={level} style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
      {level.toUpperCase()}
    </span>
  );
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
          gridTemplateColumns: 'minmax(0,1fr) auto',
          gridTemplateRows: mobileHasContext ? '30px 29px 29px' : '30px 29px',
          columnGap: 6,
          padding: '0 8px',
          overflow: 'visible',
          background: 'linear-gradient(180deg,rgba(4,7,12,.985),rgba(0,3,8,.965))',
          boxShadow: '0 7px 22px rgba(0,0,0,.36)',
        }}
      >
        {primary}
        <div data-status-summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
          {statusIndicator}
        </div>
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
              borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.055)}`,
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
          gridTemplateColumns: 'minmax(0,1fr) auto',
          gridTemplateRows: '32px 32px',
          columnGap: 8,
          padding: '0 8px',
          overflow: 'visible',
          background: 'linear-gradient(180deg,rgba(4,7,12,.985),rgba(0,3,8,.96))',
          boxShadow: '0 7px 22px rgba(0,0,0,.32)',
        }}
      >
        {primary}
        <div data-status-summary style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
          {statusIndicator}
        </div>
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
            borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.06)}`,
          }}
        >
          {performanceControls}
          {contextControls}
        </div>
        {accentRail}
      </div>
    );
  }

  return (
    <div
      className="cknerv-status-strip"
      role="navigation"
      aria-label="Dashboard controls"
      data-status-layout="wide"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, height: barHeight, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', overflow: 'visible', background: 'linear-gradient(180deg,rgba(4,7,12,.985),rgba(0,3,8,.955))', boxShadow: '0 7px 22px rgba(0,0,0,.28)' }}
    >
      {primary}
      <span style={{ flex: 1 }} />
      {performanceControls}
      {contextControls}
      <span
        data-status-health
        style={{ ...NAV_MODULE_STYLE, gap: 9, padding: '0 1px 0 10px' }}
      >
        {statusIndicator}
        <span style={{ flexShrink: 0, fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: HUD_COLORS.dim, letterSpacing: 0.7 }}>{fmtUptime(uptimeMs)}</span>
      </span>
      {accentRail}
    </div>
  );
}
