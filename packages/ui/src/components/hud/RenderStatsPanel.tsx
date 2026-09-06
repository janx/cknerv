import { useEffect, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { HudPanel, PanelHeader, StatRow, STAT_ROW_HEIGHT_PX } from './primitives';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from './hudTheme';
import {
  retainStatsDemand, subscribeStats, getStatsSnapshot, fpsColor, fmtCompact,
} from '../../tweaks/renderStatsStore';
import { readGpuSampleCount } from '../../tweaks/performanceProbeStore';
import { useQualityRuntime } from '../../tweaks/qualityPresets';

// Default: fixed bottom-right, above the app's floating Jukebox chip — the
// shape review routes and labs want. The HUD docks it beside CKB·01 instead
// by passing its own flow style. pointerEvents:none → display-only.
const PANEL_STYLE: CSSProperties = {
  position: 'fixed', right: 14, bottom: 56, zIndex: 15,
  pointerEvents: 'none', minWidth: 116,
};

// The footnote under the two GPU figures, when the context they were taken on
// is multisampled. WebGL allows one TIME_ELAPSED query at a time and a query
// boundary ends the render pass, so on a multisampled buffer EVERY scoped draw
// pays an attachment resolve and reload it does not pay unprobed: on the 890M
// the ten cheapest programs read 0.80–0.87 ms per draw at 1920×960 @2× with
// MSAA against 0.05–0.07 ms for the same programs on a buffer without it, and
// the page ran 28.6 fps with the probe open against 58 without, at one clock
// (§19.5). So the row is a READING, not an alarm: nothing is broken, two
// figures on this panel are simply not the numbers they would be unprobed, and
// FPS is the one to trust. It states that in the panel's own voice at the
// rail's own rhythm — `caution` is the rung `fpsColor` already spends on
// "worth noticing", and a filled severity block would say something is wrong.
const MSAA_NOTICE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  height: STAT_ROW_HEIGHT_PX,
  whiteSpace: 'nowrap',
  fontFamily: HUD_FONTS.tech,
  fontWeight: 500,
  fontSize: HUD_TYPE.micro,
  letterSpacing: 0.9,
  color: HUD_COLORS.caution,
};

export interface RenderStatsPanelProps {
  /** Placement override; the fixed bottom-right default serves labs and
   *  review routes. */
  style?: CSSProperties;
}

/** Live render-stats readout. Visibility is the mounter's decision — the HUD
 *  panel menu, a lab, a review route — and sampling follows mounting: the
 *  panel retains a demand on the render-stats store for exactly its lifetime,
 *  so gl.info is only ever touched while someone is looking. Header is
 *  English-only (cjk="") — the HUD CJK face is a hand-subset woff2 and must
 *  not gain new glyphs. */
export default function RenderStatsPanel({ style }: RenderStatsPanelProps) {
  const stats = useSyncExternalStore(subscribeStats, getStatsSnapshot, getStatsSnapshot);
  const quality = useQualityRuntime();
  useEffect(() => retainStatsDemand(), []);

  // A context attribute settled at Canvas creation, so it cannot change under
  // a mounted panel and needs no subscription of its own: read on the render
  // the stats store already drives, once per sampling window.
  const samples = readGpuSampleCount();

  const fps = stats.fps;
  const fpsStr = fps > 0 ? fps.toFixed(1) : '—';
  const fpsCol = fps > 0 ? fpsColor(fps) : HUD_COLORS.dim;
  const msStr = stats.msPerFrame > 0 ? stats.msPerFrame.toFixed(1) : '—';
  const qualityOwner = quality.source === 'startup'
    ? 'FIX'
    : quality.mode === 'auto' ? 'AUTO' : 'MAN';

  return (
    <HudPanel style={style ?? PANEL_STYLE}>
      <PanelHeader en="RENDER STATS" cjk="" idx="GL·08" />
      <StatRow label="Q">
        {qualityOwner}·{quality.effective.toUpperCase()}
      </StatRow>
      <StatRow label="FPS" valueColor={fpsCol}>{fpsStr}</StatRow>
      <StatRow label="MS">{msStr}</StatRow>
      <StatRow label="DRAW">{fmtCompact(stats.drawCalls)}</StatRow>
      <StatRow label="TRIS">{fmtCompact(stats.triangles)}</StatRow>
      <StatRow label="GEO">{fmtCompact(stats.geometries)}</StatRow>
      <StatRow label="TEX">{fmtCompact(stats.textures)}</StatRow>
      <StatRow label="PROG">{fmtCompact(stats.programs)}</StatRow>
      <StatRow
        label="UPLD"
        title="bytes handed to gl.bufferSubData per frame (fabric, bridge, cell attributes)"
      >
        {fmtCompact(stats.uploadBytesPerFrame)}
      </StatRow>
      {/* The two GPU readings need the timer-query extension; without it, or
          before the first bracket frame resolves, they honestly read nothing
          rather than zero. */}
      <StatRow
        label="GPU"
        title="GPU ms per frame: one timer query around the whole scene pass, taken on alternate sampled frames (frame.gpu)"
      >
        {stats.gpuFrameMs === null ? '—' : stats.gpuFrameMs.toFixed(2)}
      </StatRow>
      <StatRow
        label="OTHER"
        title="GPU ms per frame no scoped draw accounts for: the scene bracket minus the sum of the per-draw scopes on the frames between"
      >
        {stats.gpuUnscopedMs === null ? '—' : stats.gpuUnscopedMs.toFixed(2)}
      </StatRow>
      {samples !== null && samples > 0 ? (
        <div
          data-render-stats-msaa
          title="On a multisampled context every per-draw timer query ends the render pass; GPU and OTHER overstate, FPS is the honest number."
          style={MSAA_NOTICE_STYLE}
        >
          MSAA ×{samples} · SCOPES SPLIT THE PASS · READ FPS
        </div>
      ) : null}
    </HudPanel>
  );
}
