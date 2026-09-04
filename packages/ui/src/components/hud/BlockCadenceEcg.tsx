import { memo, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { EcgCondition } from '../../derives/ecgCondition';
import {
  ECG_PAPER_HEIGHT_PX,
  ECG_SPAN_BEATS,
  drawStripChart,
  ecgCanvasSize,
  reconstructArrivals,
} from './ecgTrace';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { HudPanel, PanelHeader, StatusLamp } from './primitives';

/** The status light: what the panel SAYS about the chain's cadence. Read by the
 *  lamp beside the condition word and the "since last" hero — both of them
 *  sentences, not signal. */
const COND_COLOR: Record<EcgCondition, string> = {
  FINE: HUD_COLORS.nominal, CAUTION: HUD_COLORS.caution, DANGER: HUD_COLORS.danger,
  FLATLINE: HUD_COLORS.danger, SYNCING: HUD_COLORS.cyanWire,
};

/** The instrument's ink: what the CANVAS is drawn in.
 *
 *  Two colors for one condition, and only in the healthy state. The condition
 *  lamp is a status light — the cadence is inside tolerance, so it wears the
 *  same `nominal` green every other healthy reading in the HUD wears. The
 *  canvas is not a reading, it is a tube: a cardiac monitor's trace glows in
 *  CRT phosphor, a harder and more saturated green than any status token,
 *  because it is not reporting a state — it is the light the signal is written
 *  in. Both sit on the panel at once, and seeing them as two different greens
 *  is the point.
 *
 *  Only FINE splits, and that asymmetry is the whole idea. Once the cadence
 *  degrades, the trace changing color IS the status — caution yellow, danger
 *  red, the flatline's red bar sliding across the window. That is the mechanic
 *  this panel exists for, so a degraded trace has no ink of its own to keep:
 *  the tube stops being an instrument and becomes the alarm. Everything the
 *  trace draws follows this record (the stroke and its glow — see
 *  `drawStripChart`); everything the panel says follows `COND_COLOR`.
 *
 *  If a person looking at the running panel decides the phosphor is a mistake,
 *  this record and `HUD_COLORS.termGreen` are deleted together — the token has
 *  exactly one reader and it is this line. */
const COND_COLOR_TRACE: Record<EcgCondition, string> = {
  ...COND_COLOR,
  FINE: HUD_COLORS.termGreen,
};
/** One window is `ECG_SPAN_BEATS` × target ≈ 64s across the ~242 CSS px the
 *  rail leaves this canvas, so the paper travels ~3.8px/s: at 10 Hz a redraw
 *  advances the trace by about a third of a pixel. The ceiling is set by that
 *  velocity and nothing else — every draw sums a gaussian beat profile per
 *  column and strokes the result with a glow, and paying for it faster than
 *  the paper moves buys no motion.
 *
 *  ⚠️ The width in that arithmetic used to be 300, which was the BITMAP's
 *  width and never the paper's: the canvas was declared 300 wide and stretched
 *  to fill 242, so the file's own numbers were off by the squash (report A,
 *  A-1). The bitmap is measured from the element now, so 242 is both. */
const ECG_DRAW_FPS = 10;

/** The scale, in words, because the paper cannot say it in ink. `x` is TIME
 *  and one window is eight target intervals — about a minute — so a reader
 *  with no marks at the ends has no way to tell a 3.7 s gap from a 23 s one
 *  (report A, A-10). Two micro labels under the paper, and the left one is
 *  computed from the same span the trace is drawn from rather than typed. */
function windowLabel(targetMs: number): string {
  const seconds = Math.round((ECG_SPAN_BEATS * Math.max(1000, targetMs)) / 1000);
  return `−${seconds}S`;
}

/** A span in seconds, in the rails' one voice for a time unit: the figure and
 *  an UPPERCASE unit, no space. The HUD shouts — every label, every legend,
 *  every condition word — and this panel was printing `8.0s`, `8/min` beside
 *  `24H`, `PEAK/H` and `TGT` (report A, A-13). A unit in a different case is a
 *  reader's eye stopping to work out whether it is a different unit. */
function fmtS(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)}S`;
}

function BlockCadenceEcg({
  intervalsMs, sizes, txCounts, lastBlockTsMs, targetMs, avgMs, gapMs = 0, condition, reducedMotion = false, style,
}: {
  intervalsMs: number[];
  sizes: number[];
  txCounts: number[];
  lastBlockTsMs: number | null | undefined;
  targetMs: number;
  avgMs: number | null;
  /** The gap to draw when there is no last block to measure one from. With a
   *  `lastBlockTsMs` the panel measures its own live gap on its own timers and
   *  never reads this, which is why the HUD stopped handing it a per-second
   *  value: it was a fresh prop every tick for a number nothing printed. */
  gapMs?: number;
  condition: EcgCondition;
  reducedMotion?: boolean;
  style?: CSSProperties;
}) {
  const cvs = useRef<HTMLCanvasElement | null>(null);
  const color = COND_COLOR[condition];
  const traceColor = COND_COLOR_TRACE[condition];
  const rate = avgMs && avgMs > 0 ? Math.round(60000 / avgMs) : null;
  const heroRef = useRef<HTMLSpanElement | null>(null);
  const arrivals = useMemo(
    () => reconstructArrivals(intervalsMs, lastBlockTsMs),
    [intervalsMs, lastBlockTsMs],
  );

  // Latest draw inputs, read by one persistent animation loop. Arrival history
  // is reconstructed only when chain input changes; the scroll redraw no
  // longer allocates and filters a new history array on every frame.
  const live = useRef({ arrivals, sizes, txCounts, lastBlockTsMs, targetMs, gapMs, traceColor });
  live.current = { arrivals, sizes, txCounts, lastBlockTsMs, targetMs, gapMs, traceColor };

  useEffect(() => {
    const cv = cvs.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    // jsdom-safe: its 2D stub is non-null but lacks the path methods drawStripChart needs.
    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.clearRect !== 'function' || typeof ctx.setLineDash !== 'function') return;
    // The paper is as wide as the box the rail leaves it, at the display's own
    // ratio — see `ecgCanvasSize`. Re-taken on every resize, because a rail
    // that collapses is a canvas that changed width without a remount.
    let paper = ecgCanvasSize(cv.clientWidth, window.devicePixelRatio ?? 1);
    const resize = () => {
      paper = ecgCanvasSize(cv.clientWidth, window.devicePixelRatio ?? 1);
      if (cv.width !== paper.bitmapWidth) cv.width = paper.bitmapWidth;
      if (cv.height !== paper.bitmapHeight) cv.height = paper.bitmapHeight;
      // Setting either dimension resets the context, so the transform is
      // re-applied here and nowhere else: from this point every coordinate
      // `drawStripChart` uses is a CSS pixel.
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(paper.scale, 0, 0, paper.scale, 0, 0);
      }
    };
    resize();
    const draw = (nowMs: number) => {
      const s = live.current;
      // clamp >=0: last_block_ts_ms (fresh receive time) can sit just ahead of a
      // throttled clock, which would otherwise paint a negative gap.
      const gap = Math.max(0, s.lastBlockTsMs != null ? nowMs - s.lastBlockTsMs : s.gapMs);
      drawStripChart(ctx, { width: paper.cssWidth, height: paper.cssHeight, arrivals: s.arrivals, nowMs, targetMs: s.targetMs, gapMs: gap, color: s.traceColor, sizes: s.sizes, txCounts: s.txCounts });
    };
    draw(Date.now());
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { resize(); draw(Date.now()); })
      : null;
    observer?.observe(cv);
    if (reducedMotion || typeof requestAnimationFrame !== 'function') {
      return () => observer?.disconnect(); // static trace; test-safe
    }
    const drawIntervalMs = 1000 / ECG_DRAW_FPS;
    let previousDrawAt = Number.NEGATIVE_INFINITY;
    let raf = requestAnimationFrame(function loop(frameAt) {
      if (frameAt - previousDrawAt >= drawIntervalMs - 0.5) {
        previousDrawAt = frameAt;
        draw(Date.now());
      }
      raf = requestAnimationFrame(loop);
    });
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
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
  //
  // ⚠️ NO MEASURE OF ITS OWN. This panel asked for 430 and the rail overrode it
  // to CKB·01's width on every render, so the only thing the number did was
  // make the canvas's own arithmetic wrong (report A, A-1). The rail states the
  // measure — ECG·04 is CKB·01's lower companion and their outer edges are
  // aligned — and a consumer that hands no style gets a panel as wide as its
  // content, which is what every other measureless panel does.
  return (
    <HudPanel style={{ zIndex: 12, padding: '10px 15px 9px', ...style }}>
      <PanelHeader en="PULSE" cjk="脉搏" idx="ECG·04" compact />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: '0 0 86px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* hero ticks at 0.1s via the timer above (direct textContent writes);
              a data re-render repaints the same live value here. */}
          <span ref={heroRef} style={{ fontFamily: HUD_FONTS.mono, fontWeight: 700, fontSize: HUD_TYPE.hero, lineHeight: 1, color, textShadow: `0 0 11px ${color}` }}>{fmtS(Math.max(0, lastBlockTsMs != null ? Date.now() - lastBlockTsMs : gapMs))}</span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 2, color: HUD_COLORS.dim, marginTop: 3 }}>SINCE LAST</span>
        </div>
        {/* No `width`/`height` attributes: the bitmap is measured off this
            element and re-taken on resize (`ecgCanvasSize`). A declared bitmap
            plus `width: 100%` is exactly how the paper came to be squashed. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <canvas
            ref={cvs}
            data-ecg-paper
            style={{ display: 'block', width: '100%', height: ECG_PAPER_HEIGHT_PX, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.orange, 0.2)}` }}
          />
          {/* What a pixel of x is worth, at the two ends it is worth it
              between. `NOW` is at the right because that is where the paper's
              edge is; the span on the left is read off the same window the
              trace is drawn from, so a chain with a different target says a
              different number without anybody editing this line. */}
          <div
            data-ecg-scale
            style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.micro, letterSpacing: 0.9, color: HUD_COLORS.dim }}
          >
            <span>{windowLabel(targetMs)}</span>
            <span>NOW</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6, fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.tech, color: HUD_COLORS.dim, letterSpacing: 0.9 }}>
        {/* The lamp is a lamp: `nominal` green for a cadence inside tolerance,
            the same disc the enrichment chips wear in the top bar. It used to
            be a `●`, which no face the HUD ships carries — so the one mark on
            this panel whose COLOUR is the reading was drawn by whatever the
            reader's machine had lying around, beside a canvas trace drawn in
            phosphor by us. The two greens are still two greens on purpose. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, letterSpacing: 2, textShadow: `0 0 7px ${color}` }}>
          <StatusLamp color={color} />
          {condition}
        </span>
        <span>TGT {fmtS(targetMs)}</span><span>AVG {fmtS(avgMs)}</span><span>RATE {rate != null ? `${rate}/MIN` : '—'}</span>
      </div>
    </HudPanel>
  );
}

// Memoized with the other rail panels — see `BlockchainReadout`. The three
// rings are aliased across every batch that is not a block, so the panel
// renders once a block and its two timers carry the seconds in between.
export default memo(BlockCadenceEcg);
