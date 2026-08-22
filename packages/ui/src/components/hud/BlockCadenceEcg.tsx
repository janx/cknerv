import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { EcgCondition } from '../../derives/ecgCondition';
import { reconstructArrivals, drawStripChart } from './ecgTrace';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { HudPanel, PanelHeader } from './primitives';

const COND_COLOR: Record<EcgCondition, string> = {
  FINE: HUD_COLORS.nominal, CAUTION: HUD_COLORS.caution, DANGER: HUD_COLORS.danger,
  FLATLINE: HUD_COLORS.danger, SYNCING: HUD_COLORS.cyanWire,
};
const ECG_DRAW_FPS = 30;

function fmtS(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function BlockCadenceEcg({
  intervalsMs, sizes, txCounts, lastBlockTsMs, targetMs, avgMs, gapMs, condition, reducedMotion = false, style,
}: {
  intervalsMs: number[];
  sizes: number[];
  txCounts: number[];
  lastBlockTsMs: number | null | undefined;
  targetMs: number;
  avgMs: number | null;
  gapMs: number;
  condition: EcgCondition;
  reducedMotion?: boolean;
  style?: CSSProperties;
}) {
  const cvs = useRef<HTMLCanvasElement | null>(null);
  const color = COND_COLOR[condition];
  const rate = avgMs && avgMs > 0 ? Math.round(60000 / avgMs) : null;
  const heroRef = useRef<HTMLSpanElement | null>(null);
  const arrivals = useMemo(
    () => reconstructArrivals(intervalsMs, lastBlockTsMs),
    [intervalsMs, lastBlockTsMs],
  );

  // Latest draw inputs, read by one persistent animation loop. Arrival history
  // is reconstructed only when chain input changes; the 30 Hz scroll redraw no
  // longer allocates and filters a new history array on every frame.
  const live = useRef({ arrivals, sizes, txCounts, lastBlockTsMs, targetMs, gapMs, color });
  live.current = { arrivals, sizes, txCounts, lastBlockTsMs, targetMs, gapMs, color };

  useEffect(() => {
    const cv = cvs.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    // jsdom-safe: its 2D stub is non-null but lacks the path methods drawStripChart needs.
    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.clearRect !== 'function' || typeof ctx.setLineDash !== 'function') return;
    const W = cv.width, H = cv.height;
    const draw = (nowMs: number) => {
      const s = live.current;
      // clamp >=0: last_block_ts_ms (fresh receive time) can sit just ahead of a
      // throttled clock, which would otherwise paint a negative gap.
      const gap = Math.max(0, s.lastBlockTsMs != null ? nowMs - s.lastBlockTsMs : s.gapMs);
      drawStripChart(ctx, { width: W, height: H, arrivals: s.arrivals, nowMs, targetMs: s.targetMs, gapMs: gap, color: s.color, sizes: s.sizes, txCounts: s.txCounts });
    };
    draw(Date.now());
    if (reducedMotion || typeof requestAnimationFrame !== 'function') return; // static trace; test-safe
    const drawIntervalMs = 1000 / ECG_DRAW_FPS;
    let previousDrawAt = Number.NEGATIVE_INFINITY;
    let raf = requestAnimationFrame(function loop(frameAt) {
      if (frameAt - previousDrawAt >= drawIntervalMs - 0.5) {
        previousDrawAt = frameAt;
        draw(Date.now());
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  // "Since last" hero updates at 0.1s resolution: a small timer recomputes the
  // live gap and writes the span's textContent DIRECTLY (same cadence + values
  // as the former setState, without a 10 Hz React re-render of the panel).
  // Kept off the rAF loop so the tenths keep ticking between block deltas.
  useEffect(() => {
    let lastText: string | null = null;
    const tick = () => {
      const s = live.current;
      const gap = Math.max(0, s.lastBlockTsMs != null ? Date.now() - s.lastBlockTsMs : s.gapMs);
      const text = fmtS(gap);
      if (text === lastText) return;
      lastText = text;
      if (heroRef.current) heroRef.current.textContent = text;
    };
    tick();
    if (typeof setInterval !== 'function') return; // test-safe
    const id = setInterval(tick, reducedMotion ? 1000 : 100);
    return () => clearInterval(id);
  }, [reducedMotion]);

  // Compact by design: ECG·04 shares the left rail's fixed floor with
  // DAO·05, and every pixel it gives up is scroll-free room for CKB·01.
  return (
    <HudPanel style={{ width: 430, zIndex: 12, padding: '10px 15px 9px', ...style }}>
      <PanelHeader en="PULSE" cjk="脉搏" idx="ECG·04" compact />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: '0 0 86px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* hero ticks at 0.1s via the timer above (direct textContent writes);
              a data re-render repaints the same live value here. */}
          <span ref={heroRef} style={{ fontFamily: HUD_FONTS.mono, fontWeight: 700, fontSize: 22, lineHeight: 1, color, textShadow: `0 0 11px ${color}` }}>{fmtS(Math.max(0, lastBlockTsMs != null ? Date.now() - lastBlockTsMs : gapMs))}</span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 2, color: HUD_COLORS.dim, marginTop: 3 }}>SINCE LAST</span>
        </div>
        <canvas ref={cvs} width={300} height={46} style={{ display: 'block', flex: 1, minWidth: 0, width: '100%', height: 46, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.orange, 0.2)}` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6, fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: HUD_COLORS.dim, letterSpacing: 1 }}>
        <span style={{ color, letterSpacing: 2, textShadow: `0 0 7px ${color}` }}>● {condition}</span>
        <span>TGT {fmtS(targetMs)}</span><span>AVG {fmtS(avgMs)}</span><span>RATE {rate != null ? `${rate}/min` : '—'}</span>
      </div>
    </HudPanel>
  );
}
