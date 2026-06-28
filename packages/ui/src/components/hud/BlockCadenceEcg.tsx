import { useEffect, useRef, useState } from 'react';
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
  intervalsMs, sizes, txCounts, lastBlockTsMs, targetMs, avgMs, gapMs, condition, reducedMotion = false,
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
}) {
  const cvs = useRef<HTMLCanvasElement | null>(null);
  const color = COND_COLOR[condition];
  const rate = avgMs && avgMs > 0 ? Math.round(60000 / avgMs) : null;
  const [heroMs, setHeroMs] = useState<number>(gapMs);

  // Latest draw inputs, read by the animation loop each frame. Writing a ref on
  // every render is cheap and — crucially — does NOT re-create the rAF loop. The
  // chain entity is re-cloned upstream on every tx/mempool/sync delta (dozens per
  // second), so a dep-driven effect would tear the loop down that often and the
  // trace would stutter on the delta cadence instead of animating at 60fps. One
  // persistent loop reads `live.current` instead.
  const live = useRef({ intervalsMs, sizes, txCounts, lastBlockTsMs, targetMs, gapMs, color });
  live.current = { intervalsMs, sizes, txCounts, lastBlockTsMs, targetMs, gapMs, color };

  useEffect(() => {
    const cv = cvs.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    // jsdom-safe: its 2D stub is non-null but lacks the path methods drawStripChart needs.
    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.clearRect !== 'function' || typeof ctx.setLineDash !== 'function') return;
    const W = cv.width, H = cv.height;
    const draw = (nowMs: number) => {
      const s = live.current;
      const arrivals = reconstructArrivals(s.intervalsMs, s.lastBlockTsMs);
      // clamp >=0: last_block_ts_ms (fresh receive time) can sit just ahead of a
      // throttled clock, which would otherwise paint a negative gap.
      const gap = Math.max(0, s.lastBlockTsMs != null ? nowMs - s.lastBlockTsMs : s.gapMs);
      drawStripChart(ctx, { width: W, height: H, arrivals, nowMs, targetMs: s.targetMs, gapMs: gap, color: s.color, sizes: s.sizes, txCounts: s.txCounts });
    };
    draw(Date.now());
    if (reducedMotion || typeof requestAnimationFrame !== 'function') return; // static trace; test-safe
    let raf = requestAnimationFrame(function loop() { draw(Date.now()); raf = requestAnimationFrame(loop); });
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  // "Since last" hero updates at 0.1s resolution: a small timer recomputes the live
  // gap from current time (reduced motion → ~1s). Kept off the rAF loop so the
  // tenths keep ticking between block deltas.
  useEffect(() => {
    const tick = () => {
      const s = live.current;
      setHeroMs(Math.max(0, s.lastBlockTsMs != null ? Date.now() - s.lastBlockTsMs : s.gapMs));
    };
    tick();
    if (typeof setInterval !== 'function') return; // test-safe
    const id = setInterval(tick, reducedMotion ? 1000 : 100);
    return () => clearInterval(id);
  }, [reducedMotion]);

  return (
    <div style={{ position: 'absolute', left: 14, bottom: 14, width: 430, zIndex: 12, border: `1px solid ${rgba(HUD_COLORS.nominal, 0.22)}`, background: 'rgba(0,12,4,.45)', padding: '10px 12px 9px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 10.5, letterSpacing: 2.5, color: HUD_COLORS.nominal, textTransform: 'uppercase' }}>BLOCK CADENCE</span>
        <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 10, color: '#2f7a44' }}>脉搏</span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.tech, fontWeight: 700, fontSize: 11, letterSpacing: 3, color, textShadow: `0 0 9px ${color}` }}>● {condition}</span>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: '0 0 96px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* hero ticks at 0.1s via the heroMs timer; avg/tgt live only in the vitals row below */}
          <span style={{ fontFamily: HUD_FONTS.mono, fontWeight: 700, fontSize: 26, lineHeight: 1, color, textShadow: `0 0 11px ${color}` }}>{fmtS(heroMs)}</span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8, letterSpacing: 2, color: '#3a5a44', marginTop: 4 }}>SINCE LAST</span>
        </div>
        <canvas ref={cvs} width={300} height={58} style={{ display: 'block', flex: 1, width: '100%', height: 58, background: '#000409', border: `1px solid ${rgba(HUD_COLORS.nominal, 0.1)}` }} />
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#3a5a44', letterSpacing: 1 }}>
        <span>TGT {fmtS(targetMs)}</span><span>AVG {fmtS(avgMs)}</span><span>RATE {rate != null ? `${rate}/min` : '—'}</span>
      </div>
    </div>
  );
}
