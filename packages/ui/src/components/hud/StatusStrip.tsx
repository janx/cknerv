import { useState } from 'react';
import { useControls } from 'leva';
import type { AlertLevel } from '../../derives/alertLevel';
import type { StreamHealthSummary } from '../../derives/streamHealth.derive';
import { formatStreamAge } from '../../derives/streamHealth.derive';
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

// Build tag rendered as a hairline capsule right after the wordmark. `version`
// is opaque (built in ui-app); we split on the first `@` only for two-tone
// display — the leading segment reads bright, the `@…` tail dim — and fall back
// to a single bright run when there's no `@`. The whole capsule is a commit
// deep-link that warms to an orange glow on hover.
function BuildChip({ build }: { build: BuildInfo }) {
  const [hot, setHot] = useState(false);
  const at = build.version.indexOf('@');
  const head = at >= 0 ? build.version.slice(0, at) : build.version;
  const tail = at >= 0 ? build.version.slice(at) : '';
  return (
    <a
      href={build.href}
      target="_blank"
      rel="noreferrer"
      aria-label={build.version}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 8px', borderRadius: 999,
        border: `1px solid ${rgba(HUD_COLORS.orange, hot ? 0.55 : 0.22)}`,
        background: rgba(HUD_COLORS.orange, hot ? 0.1 : 0.045),
        boxShadow: hot ? `0 0 10px ${rgba(HUD_COLORS.orange, 0.35)}` : 'none',
        fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 0.5, lineHeight: 1,
        textDecoration: 'none', pointerEvents: 'auto',
        transition: 'border-color .18s, background .18s, box-shadow .18s',
      }}
    >
      <span style={{ color: hot ? HUD_COLORS.orange : HUD_COLORS.ink, textShadow: hot ? `0 0 6px ${rgba(HUD_COLORS.orange, 0.5)}` : 'none', transition: 'color .18s, text-shadow .18s' }}>{head}</span>
      {tail ? <span style={{ color: hot ? rgba(HUD_COLORS.orange, 0.6) : HUD_COLORS.dim, transition: 'color .18s' }}>{tail}</span> : null}
    </a>
  );
}

const STREAM_COLOR: Record<StreamHealthSummary['phase'], string> = {
  connecting: HUD_COLORS.cyanWire,
  live: HUD_COLORS.nominal,
  retrying: HUD_COLORS.warning,
  resyncing: HUD_COLORS.rebuild,
  stale: HUD_COLORS.danger,
};

const QUALITY_MODES = ['auto', 'high', 'med', 'low'] as const satisfies readonly QualityMode[];
const CELL_TRACK_TICKS = [0, 25, 50, 75, 100] as const;

function fmtCellCount(count: number): string {
  if (count < 1_000) return String(count);
  const compact = count / 1_000;
  return `${Number.isInteger(compact) ? compact : compact.toFixed(1)}K`;
}

function CellDisplayControl({
  availableCells,
  capacity = CELL_DISPLAY_MAX,
}: {
  availableCells?: number;
  capacity?: number;
}) {
  const quality = useQualityRuntime();
  const display = useCellDisplayRuntime();
  const serverCapacity = Number.isFinite(capacity)
    ? Math.max(0, Math.floor(capacity))
    : CELL_DISPLAY_MAX;
  const automaticCapacity = normalizeCellDisplayCapacity(serverCapacity);
  const limit = resolveCellDisplayLimit(
    display,
    quality.effective,
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        flexShrink: 0,
        height: 20,
        paddingLeft: 12,
        borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.1)}`,
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
          gap: 3,
          minWidth: 61,
          color: HUD_COLORS.cyanWire,
          fontSize: 9,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.55,
          whiteSpace: 'nowrap',
          textShadow: `0 0 6px ${rgba(HUD_COLORS.cyanWire, 0.34)}`,
        }}
      >
        <span>{fmtCellCount(visible)}</span>
        <span
          aria-hidden="true"
          style={{
            color: HUD_COLORS.dim,
            fontSize: 7,
            letterSpacing: 0.8,
            textShadow: 'none',
          }}
        >
          SHOWN
        </span>
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
          gap: 5,
          height: 18,
          padding: '0 2px',
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
          width: 76,
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
          gap: 3,
          minWidth: 54,
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
          CAP
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

function RenderQualityControl() {
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        flexShrink: 0,
        height: 20,
        paddingLeft: 12,
        borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.1)}`,
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
          padding: '0 1px',
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
                minWidth: mode === 'auto' ? 43 : 32,
                height: 18,
                padding: '0 5px 2px',
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
              {mode.toUpperCase()}{autoSuffix}
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
  stream,
  cellCount,
  cellCapacity,
}: {
  level: AlertLevel;
  uptimeMs: number;
  build?: BuildInfo;
  stream?: StreamHealthSummary | null;
  /** Records currently available to the visual layer, before its draw cap. */
  cellCount?: number;
  /** Resolved server projection cap used by AUTO and capacity disclosure. */
  cellCapacity?: number;
}) {
  const color = LEVEL_COLOR[level];
  const streamColor = stream && stream.phase !== 'live'
    ? STREAM_COLOR[stream.phase]
    : null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 30, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', borderBottom: '1px solid rgba(255,152,48,.18)', background: 'linear-gradient(180deg,rgba(255,152,48,.05),transparent)' }}>
      <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: 12, letterSpacing: 5, color: HUD_COLORS.orange, textShadow: '0 0 8px rgba(255,152,48,.5)' }}>CKNERV</span>
      {build ? <BuildChip build={build} /> : null}
      <span style={{ flex: 1 }} />
      <CellDisplayControl
        availableCells={cellCount}
        capacity={cellCapacity}
      />
      <RenderQualityControl />
      {stream && streamColor ? (
        <span
          data-stream-chip
          data-stream-phase={stream.phase}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 7px',
            border: `1px solid ${rgba(streamColor, 0.28)}`,
            fontFamily: HUD_FONTS.mono,
            fontSize: 9,
            letterSpacing: 1,
            color: streamColor,
          }}
        >
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: streamColor, boxShadow: `0 0 6px ${streamColor}` }} />
          DATA {stream.phase.toUpperCase()}
          <span style={{ color: HUD_COLORS.dim }}>{formatStreamAge(stream.lastMessageAgeMs)}</span>
        </span>
      ) : null}
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: HUD_FONTS.tech, fontWeight: 600, fontSize: 10, letterSpacing: 2, color }}>
        <span style={{ fontFamily: HUD_FONTS.cjk, color: HUD_COLORS.dim }}>状态</span>
        <span data-dot data-level={level} style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
        {level.toUpperCase()}
      </span>
      <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 10, color: HUD_COLORS.dim, letterSpacing: 1 }}>{fmtUptime(uptimeMs)}</span>
    </div>
  );
}
