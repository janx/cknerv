// Pure helpers + imperative strip-chart draw for the Block Cadence ECG.
// The trace is a real strip chart: x = time, "now" at the right edge, scrolling
// left. Beats (PQRST) are drawn at real block-arrival timestamps; a stall shows
// as the growing flat stretch at the right, warmed by gap survival.
import { HUD_COLORS, rgba } from './hudTheme';

export const ECG_SPAN_BEATS = 8; // expected beats visible across the canvas width

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

export interface StripOpts {
  width: number;
  height: number;
  arrivals: number[];
  nowMs: number;
  targetMs: number;
  gapMs: number;
  color: string;
}

/** Render one frame of the strip chart into a 2D context. */
export function drawStripChart(ctx: CanvasRenderingContext2D, o: StripOpts): void {
  const { width: w, height: h, arrivals, nowMs, targetMs, gapMs, color } = o;
  const win = ECG_SPAN_BEATS * Math.max(1000, targetMs); // ms span across width
  const mid = h * 0.6, amp = h * 0.5;
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(HUD_COLORS.nominal, 0.06);
  for (let k = 0; k <= 8; k++) { const px = (w * k) / 8; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
  ctx.strokeStyle = rgba(HUD_COLORS.nominal, 0.1);
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  // target-cadence dashed ticks: expected next beats forward from the last arrival.
  // Guard targetMs<=0 (else the loop can't advance), and seed at the first on-screen
  // tick so a long stall doesn't iterate thousands of off-screen positions per frame.
  const last = arrivals.length ? arrivals[arrivals.length - 1] : nowMs;
  if (targetMs > 0) {
    const firstTickM = Math.max(1, Math.ceil((nowMs - win - last) / targetMs));
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = rgba(HUD_COLORS.nominal, 0.22);
    for (let t = last + firstTickM * targetMs; t <= nowMs + targetMs; t += targetMs) {
      const px = w * (1 - (nowMs - t) / win);
      if (px > 2 && px < w) { ctx.beginPath(); ctx.moveTo(px, 4); ctx.lineTo(px, h - 4); ctx.stroke(); }
    }
    ctx.setLineDash([]);
  }

  // trace (stroke line, condition color, phosphor glow).
  // Beats are drawn as fixed-PIXEL-width spikes. A time-domain PQRST is sub-pixel at
  // this window (a 0.6s beat is ~2.5px wide; its R/S swings sit ~0.16px apart), so a
  // per-column sampler aliases it into peak<->trough flicker as the trace scrolls.
  // Summing a resolvable spike profile in pixel space, centred on each arrival's x,
  // keeps a clean heartbeat that just translates smoothly.
  const xc: number[] = [];
  for (let i = arrivals.length - 1; i >= 0; i--) {
    const x = w * (1 - (nowMs - arrivals[i]) / win);
    if (x < -8) break; // arrivals ascend in time; once one is left of view the rest are too
    if (x <= w + 8) xc.push(x);
  }
  const gauss = (d: number, c: number, sg: number, h: number) => h * Math.exp(-((d - c) * (d - c)) / (2 * sg * sg));
  const spikePx = (d: number) => gauss(d, 0, 1.5, 1.0) + gauss(d, 3, 1.6, -0.2) + gauss(d, 8, 2.6, 0.18); // R, S, T
  const waveAtPx = (px: number) => {
    let s = 0;
    for (let i = 0; i < xc.length; i++) { const d = px - xc[i]; if (d > -6 && d < 16) s += spikePx(d); }
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

  // "now" edge
  ctx.fillStyle = rgba(HUD_COLORS.nominal, 0.85);
  ctx.fillRect(w - 1.5, 0, 1.5, h);
}
