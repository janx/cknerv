import { useEffect, useRef } from 'react';
import type { EcgCondition } from '../../derives/ecgCondition';
import { reconstructArrivals, drawStripChart } from './ecgTrace';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';

const COND_COLOR: Record<EcgCondition, string> = {
  FINE: HUD_COLORS.nominal, CAUTION: HUD_COLORS.caution, DANGER: HUD_COLORS.danger,
  FLATLINE: HUD_COLORS.danger, SYNCING: HUD_COLORS.cyanWire,
};

function fmtS(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function BlockCadenceEcg({
  intervalsMs, lastBlockTsMs, targetMs, avgMs, gapMs, condition, reducedMotion = false,
}: {
  intervalsMs: number[];
  lastBlockTsMs: number | null | undefined;
  targetMs: number;
  avgMs: number | null;
  gapMs: number;
  condition: EcgCondition;
  reducedMotion?: boolean;
}) {
  const cvs = useRef<HTMLCanvasElement | null>(null);
  const color = COND_COLOR[condition];
  const rate = avgMs && avgMs > 0 ? Math.round(60000 / avgMs) : null;

  useEffect(() => {
    const cv = cvs.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    // jsdom-safe: its 2D stub is non-null but lacks the path methods drawStripChart needs.
    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.clearRect !== 'function' || typeof ctx.setLineDash !== 'function') return;
    const arrivals = reconstructArrivals(intervalsMs, lastBlockTsMs);
    const W = cv.width, H = cv.height;
    const draw = (nowMs: number) => {
      // canvas uses a live per-frame gap (smooth 60fps warmth + now-cursor); the hero
      // text uses the ~1s gapMs prop. Fall back to the prop when there's no last block.
      const gap = lastBlockTsMs != null ? nowMs - lastBlockTsMs : gapMs;
      drawStripChart(ctx, { width: W, height: H, arrivals, nowMs, targetMs, gapMs: gap, color });
    };
    draw(Date.now());
    if (reducedMotion || typeof requestAnimationFrame !== 'function') return; // static trace; test-safe
    let raf = requestAnimationFrame(function loop() { draw(Date.now()); raf = requestAnimationFrame(loop); });
    return () => cancelAnimationFrame(raf);
  }, [intervalsMs, lastBlockTsMs, targetMs, gapMs, color, reducedMotion]);

  return (
    <div style={{ position: 'absolute', left: 14, bottom: 14, width: 430, zIndex: 12, border: `1px solid ${rgba(HUD_COLORS.nominal, 0.22)}`, background: 'rgba(0,12,4,.45)', padding: '10px 12px 9px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 10.5, letterSpacing: 2.5, color: HUD_COLORS.nominal, textTransform: 'uppercase' }}>BLOCK CADENCE</span>
        <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 10, color: '#2f7a44' }}>脉搏</span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.tech, fontWeight: 700, fontSize: 11, letterSpacing: 3, color, textShadow: `0 0 9px ${color}` }}>● {condition}</span>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: '0 0 96px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* hero reads the throttled gapMs prop (~1s); the canvas uses a live per-frame gap — divergence is intentional, keep this on the prop */}
          <span style={{ fontFamily: HUD_FONTS.mono, fontWeight: 700, fontSize: 26, lineHeight: 1, color, textShadow: `0 0 11px ${color}` }}>{fmtS(gapMs)}</span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 2, color: '#3a5a44', marginTop: 4 }}>SINCE LAST</span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#3a5a44', marginTop: 6 }}>avg {fmtS(avgMs)} · tgt {fmtS(targetMs)}</span>
        </div>
        <canvas ref={cvs} width={300} height={58} style={{ display: 'block', flex: 1, width: '100%', height: 58, background: '#000409', border: `1px solid ${rgba(HUD_COLORS.nominal, 0.1)}` }} />
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#3a5a44', letterSpacing: 1 }}>
        <span>TGT {fmtS(targetMs)}</span><span>AVG {fmtS(avgMs)}</span><span>RATE {rate != null ? `${rate}/min` : '—'}</span>
      </div>
    </div>
  );
}
