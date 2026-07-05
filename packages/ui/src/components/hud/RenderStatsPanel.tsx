import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { useControls } from 'leva';
import { HudPanel, PanelHeader, StatRow } from './primitives';
import { HUD_COLORS } from './hudTheme';
import {
  RENDER_STATS_TOGGLE, subscribeStats, getStatsSnapshot, fpsColor, fmtCompact,
} from '../../tweaks/renderStatsStore';

// Bottom-right — the corner freed by the mesh-rail change; clear of leva
// (top-right). pointerEvents:none → display-only, never eats clicks.
const PANEL_STYLE: CSSProperties = {
  position: 'fixed', right: 14, bottom: 14, zIndex: 15,
  pointerEvents: 'none', minWidth: 116,
};

/** Live render-stats overlay. Hidden unless the ` panel's "render stats"
 *  toggle is on. Reads gl.info metrics from the store (written by
 *  RenderStatsSampler). Header is English-only (cjk="") — the HUD CJK face is
 *  a hand-subset woff2 and must not gain new glyphs. */
export default function RenderStatsPanel() {
  const { renderStats } = useControls(RENDER_STATS_TOGGLE);
  const stats = useSyncExternalStore(subscribeStats, getStatsSnapshot, getStatsSnapshot);
  if (!renderStats) return null;

  const fps = stats.fps;
  const fpsStr = fps > 0 ? fps.toFixed(1) : '—';
  const fpsCol = fps > 0 ? fpsColor(fps) : HUD_COLORS.dim;
  const msStr = stats.msPerFrame > 0 ? stats.msPerFrame.toFixed(1) : '—';

  return (
    <HudPanel style={PANEL_STYLE}>
      <PanelHeader en="RENDER" cjk="" idx="GL.INFO" />
      <StatRow label="FPS" valueColor={fpsCol}>{fpsStr}</StatRow>
      <StatRow label="MS">{msStr}</StatRow>
      <StatRow label="DRAW">{fmtCompact(stats.drawCalls)}</StatRow>
      <StatRow label="TRIS">{fmtCompact(stats.triangles)}</StatRow>
      <StatRow label="GEO">{fmtCompact(stats.geometries)}</StatRow>
      <StatRow label="TEX">{fmtCompact(stats.textures)}</StatRow>
      <StatRow label="PROG">{fmtCompact(stats.programs)}</StatRow>
    </HudPanel>
  );
}
