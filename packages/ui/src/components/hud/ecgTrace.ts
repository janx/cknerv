// Pure helpers + imperative strip-chart draw for the Block Cadence ECG.
// The trace is a real strip chart: x = time, "now" at the right edge, scrolling
// left. Beats (PQRST) are drawn at real block-arrival timestamps; a stall shows
// as the growing flat stretch at the right, warmed by gap survival.
import { HUD_COLORS, rgba } from './hudTheme';

export const ECG_SPAN_BEATS = 8; // expected beats visible across the canvas width

/** The paper's height in CSS pixels — one number, read by the element that
 *  reserves the room and by the bitmap that is sized to fill it. */
export const ECG_PAPER_HEIGHT_PX = 46;

/**
 * The bitmap this instrument needs to be drawn ONE PIXEL TO ONE PIXEL.
 *
 * ⚠️ It was not. The canvas declared `width={300} height={46}` and then
 * stretched to `width: 100%` of a box the rail leaves 242 px wide — a 0.807×
 * horizontal squash on every beat, every hairline and every dash (report A,
 * A-1). That is not a cosmetic loss: this file's whole drawing argument is
 * that a time-domain PQRST aliases at this window, so it sums FIXED-PIXEL
 * glyphs in pixel space instead of sampling per column, and the R spike's
 * sigma is floored at ~1 px to stay alias-safe. Squashed to 0.807 that floor
 * is 0.85 px and the argument is void; on a 2× display the same 300-wide
 * bitmap was a soft upscale instead.
 *
 * So the bitmap is measured from the element and multiplied by the device's
 * own ratio, and the drawing is done in CSS units through `ctx.scale(dpr)`.
 * Every number in this file is then a CSS pixel again, which is what its
 * comments have always claimed they were.
 */
export function ecgCanvasSize(
  clientWidthPx: number,
  devicePixelRatio: number,
  heightPx: number = ECG_PAPER_HEIGHT_PX,
): { cssWidth: number; cssHeight: number; bitmapWidth: number; bitmapHeight: number; scale: number } {
  // A width of zero is a canvas that has not been laid out yet (or is display:
  // none): draw at one pixel rather than at zero, which some engines treat as
  // an invalid bitmap.
  const cssWidth = Math.max(1, Math.round(clientWidthPx));
  const cssHeight = Math.max(1, Math.round(heightPx));
  const scale = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.min(4, devicePixelRatio)
    : 1;
  return {
    cssWidth,
    cssHeight,
    bitmapWidth: Math.round(cssWidth * scale),
    bitmapHeight: Math.round(cssHeight * scale),
    scale,
  };
}

/** The graticule — the tube's own ruling, and the reason it is a rung of its
 *  own rather than a number typed at each stroke.
 *
 *  ⚠️ IT WAS INVISIBLE. The vertical grid was `nominal` at 0.06 and measured
 *  ΔG < 1.5/255 against its neighbours at 2× — a ruling nobody could see, on
 *  an instrument whose x axis is TIME and which therefore says nothing about
 *  what a pixel is worth without it. The baseline at 0.10 hid under the flat
 *  trace drawn on top of it (report A, A-10).
 *
 *  And the loudest mark on the canvas was the paper's own right edge, at 0.85
 *  over 1.5 px, full height — the ruling out-shouting the signal. The edge is
 *  a CURSOR: it says where NOW is, and it is now the quietest of the three. */
export const ECG_GRID_ALPHA = 0.15;
export const ECG_BASELINE_ALPHA = 0.24;
export const ECG_TARGET_TICK_ALPHA = 0.22;
export const ECG_NOW_EDGE_ALPHA = 0.45;
export const ECG_NOW_EDGE_PX = 1;

/** Absolute block arrival timestamps (ms, wall-clock), ascending, reconstructed
 *  from the rolling interval buffer + the last arrival. */
export function reconstructArrivals(intervalsMs: number[], lastBlockTsMs: number | null | undefined): number[] {
  if (lastBlockTsMs == null) return [];
  const valid = intervalsMs.filter((x) => Number.isFinite(x) && x > 0);
  const arr = new Array<number>(valid.length + 1);
  arr[valid.length] = lastBlockTsMs;
  for (let i = valid.length - 1; i >= 0; i--) arr[i] = arr[i + 1] - valid[i];
  return arr;
}

/** PQRST deflection as a function of seconds since the beat onset (~0.6s wide). */
export function beatProfile(dtSec: number): number {
  if (dtSec < -0.02 || dtSec > 0.6) return 0;
  const g = (c: number, w: number, h: number) => h * Math.exp(-((dtSec - c) ** 2) / (2 * w * w));
  return (
    g(0.02, 0.025, 0.12) +  // P
    g(0.13, 0.012, -0.18) + // Q
    g(0.17, 0.013, 1.0) +   // R
    g(0.21, 0.013, -0.32) + // S
    g(0.34, 0.05, 0.24)     // T
  );
}

/** Max of finite, positive values with a floor of 1 (avoids /0; stable scale). */
export function windowMax(arr: number[]): number {
  let m = 1;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (Number.isFinite(v) && v > m) m = v; }
  return m;
}

/** Per-beat size/tx fractions, NEWEST-FIRST (result[0] = newest block), one entry
 *  per visible beat. sizes/txCounts are newest-LAST and may be longer/shorter than
 *  nBeats (intervals are pushed conditionally, so beats and metadata aren't strictly
 *  index-parallel) — align from the newest end; default 0.5 when data is missing. */
export function alignedFracs(sizes: number[], txCounts: number[], nBeats: number): { sizeFrac: number; txFrac: number }[] {
  const maxS = windowMax(sizes), maxT = windowMax(txCounts);
  const frac = (v: number | undefined, max: number) =>
    v != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v / max)) : 0.5;
  const out: { sizeFrac: number; txFrac: number }[] = [];
  for (let j = 0; j < nBeats; j++) {
    out.push({ sizeFrac: frac(sizes[sizes.length - 1 - j], maxS), txFrac: frac(txCounts[txCounts.length - 1 - j], maxT) });
  }
  return out;
}

export interface StripOpts {
  width: number;
  height: number;
  arrivals: number[];
  nowMs: number;
  targetMs: number;
  gapMs: number;
  /** The trace's ink — stroke and glow, and nothing else in here. The
   *  graticule (grid, baseline, target ticks, the "now" edge) is fixed green
   *  on purpose: it is the tube's own ruling, so it stays put while the signal
   *  drawn on it turns yellow, then red. Callers pass `COND_COLOR_TRACE`,
   *  which is the condition color everywhere except FINE — see the split in
   *  `BlockCadenceEcg`. */
  color: string;
  sizes?: number[];
  txCounts?: number[];
}

/** Render one frame of the strip chart into a 2D context. */
export function drawStripChart(ctx: CanvasRenderingContext2D, o: StripOpts): void {
  const { width: w, height: h, arrivals, nowMs, targetMs, gapMs, color, sizes = [], txCounts = [] } = o;
  const win = ECG_SPAN_BEATS * Math.max(1000, targetMs); // ms span across width
  const mid = h * 0.6, amp = h * 0.5;
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(HUD_COLORS.nominal, ECG_GRID_ALPHA);
  for (let k = 0; k <= 8; k++) { const px = (w * k) / 8; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
  ctx.strokeStyle = rgba(HUD_COLORS.nominal, ECG_BASELINE_ALPHA);
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  // Target-cadence ticks — where a beat WOULD fall if the chain kept its target
  // exactly, phase-locked to the last arrival, ACROSS THE WHOLE WINDOW.
  //
  // ⚠️ They used to be drawn only AHEAD of that arrival, which made them a
  // stall indicator rather than a scale: on a chain keeping time there was
  // nothing on the paper at all, and once one appeared it read as "something
  // at the right" rather than "this is what eight seconds looks like" (report
  // A, A-10). The reader's question is what a pixel of x is worth — a 3.7 s gap
  // and a 23 s gap look alike without it — and a ruling that answers it only
  // during a fault is not a ruling.
  //
  // Guard targetMs<=0 (else the loop can't advance), and seed at the first
  // on-screen tick so a long stall doesn't iterate thousands of off-screen
  // positions per frame — the seed may now be NEGATIVE, which is the ticks
  // walking back from the last beat into the history behind it.
  const last = arrivals.length ? arrivals[arrivals.length - 1] : nowMs;
  if (targetMs > 0) {
    const firstTickM = Math.ceil((nowMs - win - last) / targetMs);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = rgba(HUD_COLORS.nominal, ECG_TARGET_TICK_ALPHA);
    for (let t = last + firstTickM * targetMs; t <= nowMs + targetMs; t += targetMs) {
      const px = w * (1 - (nowMs - t) / win);
      if (px > 2 && px < w) { ctx.beginPath(); ctx.moveTo(px, 4); ctx.lineTo(px, h - 4); ctx.stroke(); }
    }
    ctx.setLineDash([]);
  }

  // trace — fixed-pixel spikes, each scaled: WIDTH by block size, HEIGHT by tx count.
  // (Hue stays the trace color; only the glyph's width/height vary, so it stays
  // alias-safe — no sub-pixel time-domain sampling.) Rationale: a time-domain PQRST is
  // sub-pixel at this window and aliases into peak<->trough flicker as the trace
  // scrolls, so we sum resolvable spike profiles in pixel space centred on each
  // arrival's x instead of per-column sampling.
  const xc: number[] = [];
  for (let i = arrivals.length - 1; i >= 0; i--) {
    const x = w * (1 - (nowMs - arrivals[i]) / win);
    if (x < -8) break; // arrivals ascend in time; once one is left of view the rest are too
    if (x <= w + 8) xc.push(x); // newest-first
  }
  // INVARIANT: fr[k] (k-th-newest metadata) aligns to xc[k]; this relies on xc[0] being
  // the newest arrival, which holds because block timestamps are <= nowMs, so the newest
  // arrival is never clipped off the right edge (the x <= w + 8 guard keeps it).
  const fr = alignedFracs(sizes, txCounts, xc.length);            // newest-first, aligned to xc
  const ws = fr.map((f) => 0.7 + f.sizeFrac * 1.1);               // width scale 0.7..1.8 (R sigma stays >=~1px)
  const hs = fr.map((f) => 0.35 + f.txFrac * 0.65);              // height scale 0.35..1.0
  const gauss = (d: number, c: number, sg: number, ht: number) => ht * Math.exp(-((d - c) * (d - c)) / (2 * sg * sg));
  const beat = (d: number, wsc: number, hsc: number) =>
    hsc * (gauss(d, 0, 1.5 * wsc, 1.0) + gauss(d, 3 * wsc, 1.6 * wsc, -0.2) + gauss(d, 8 * wsc, 2.6 * wsc, 0.18)); // R, S, T
  const waveAtPx = (px: number) => {
    let s = 0;
    for (let k = 0; k < xc.length; k++) { const d = px - xc[k]; if (d > -10 && d < 32) s += beat(d, ws[k], hs[k]); }
    return s;
  };
  ctx.beginPath();
  for (let px = 0; px <= w; px++) {
    const y = mid - waveAtPx(px) * amp;
    if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 7;
  ctx.shadowColor = color;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // right-edge overdue warmth — gap survival s = gap/target
  const s = targetMs > 0 ? gapMs / targetMs : 0;
  const wf = Math.max(0, Math.min(1, s / ECG_SPAN_BEATS));
  if (wf > 0.04) {
    const zw = Math.min(0.6, 0.12 + wf * 0.5) * w;
    const gr = ctx.createLinearGradient(w - zw, 0, w, 0);
    gr.addColorStop(0, rgba(HUD_COLORS.danger, 0));
    gr.addColorStop(1, rgba(HUD_COLORS.danger, 0.06 + wf * 0.34));
    ctx.fillStyle = gr;
    ctx.fillRect(w - zw, 0, zw, h);
  }

  // "now" edge — a cursor, not a mark. At 0.85 over 1.5 px it out-shone the R
  // peaks in area and was the loudest thing on the canvas; the paper's own edge
  // is not the reading (report A, A-10, and the 08-24 note that said the same).
  ctx.fillStyle = rgba(HUD_COLORS.nominal, ECG_NOW_EDGE_ALPHA);
  ctx.fillRect(w - ECG_NOW_EDGE_PX, 0, ECG_NOW_EDGE_PX, h);
}
