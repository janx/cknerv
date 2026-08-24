// Render-stats core: the pure metric math + a tiny external store bridging the
// in-Canvas sampler (writes) to the DOM panel (reads via useSyncExternalStore).
// fmtCompact and the sampling math are migrated verbatim from the deleted stats
// HUD component; `fpsColor` was too, which is how it kept its own severity ramp
// for so long — see the argument on it below.
import { HUD_COLORS } from '../components/hud/hudTheme';

export interface RuntimeStats {
  fps: number;
  msPerFrame: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

/** The subset of THREE.WebGLInfo we read — structural so tests pass a plain
 *  object and we don't couple to three's exact type export. `gl.info` matches. */
export interface RenderInfoLike {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
  programs?: { length: number } | null;
}

export const ZERO_STATS: RuntimeStats = {
  fps: 0, msPerFrame: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0,
};

// Sampling demand: the GL·08 panel (and any lab that mounts it) retains a
// demand while mounted, and the sampler follows. Ref-counted so two mounted
// readers never release each other's demand. This replaced the leva
// "render stats" toggle when the panel joined the HUD's own panel menu.
let statsDemand = 0;
const demandListeners = new Set<() => void>();

/** Declare a mounted reader. Returns the matching release; idempotent. */
export function retainStatsDemand(): () => void {
  statsDemand += 1;
  demandListeners.forEach((listener) => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    statsDemand -= 1;
    demandListeners.forEach((listener) => listener());
  };
}

export function subscribeStatsDemand(listener: () => void): () => void {
  demandListeners.add(listener);
  return () => demandListeners.delete(listener);
}

export function getStatsDemand(): boolean {
  return statsDemand > 0;
}

/** Per-frame-average render metrics from a sampling window. render.calls /
 *  render.triangles accumulate across the frame's passes while autoReset is
 *  off, so divide by the frame count. memory/programs are instantaneous. */
export function computeRuntimeStats(frames: number, elapsedMs: number, info: RenderInfoLike): RuntimeStats {
  return {
    fps: elapsedMs > 0 ? (frames * 1000) / elapsedMs : 0,
    msPerFrame: frames > 0 ? elapsedMs / frames : 0,
    drawCalls: frames > 0 ? info.render.calls / frames : 0,
    triangles: frames > 0 ? info.render.triangles / frames : 0,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
  };
}

/** The FPS reading on the HUD's own severity ramp: fine at 55+, worth
 *  noticing from 30, a fault below it.
 *
 *  Three states against a five-rung ramp, so two rungs go unspent and which
 *  two is the decision. `crit` cannot be spelled here at all — it escalates in
 *  SHAPE rather than colour, and `hudDiscipline.test.ts` holds it to its one
 *  reader. `warning` is skipped because of what it is in practice: its only
 *  readers in the whole HUD are the warning bar, the stream banner and the
 *  status strip's severity map — the channel where the instrument INTERRUPTS
 *  you. GL·08 is a panel you have to summon from the menu, and a reading you
 *  went looking for does not get to borrow the colour of an interruption.
 *  `danger` is the rung the HUD already spends on one reading being bad — a
 *  lagging node, a frozen stream, a deprecated script — which is exactly what
 *  a renderer under 30fps is.
 *
 *  What it replaced: three Tailwind defaults (green-300, amber-400, red-400)
 *  carried in from the deleted stats overlay, forming a second severity ramp
 *  beside the declared one. The FPS figure is this panel's only coloured
 *  reading, so its "healthy" was visibly a different green from every other
 *  healthy reading on screen — and the bottom rung sat 23.0 from `cellRose`,
 *  inside the separation floor, so a dropped frame rate announced itself in
 *  very nearly the colour that means "this is a Cell" everywhere else. */
export function fpsColor(fps: number): string {
  if (fps >= 55) return HUD_COLORS.nominal;
  if (fps >= 30) return HUD_COLORS.caution;
  return HUD_COLORS.danger;
}

/** Integer count with an SI-ish suffix so TRIS (100k+) doesn't overflow the
 *  narrow value column. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}

// --- stats store: in-Canvas sampler writes, DOM panel reads ---
let snapshot: RuntimeStats = ZERO_STATS;
const listeners = new Set<() => void>();

/** Replace the snapshot (new ref) and notify subscribers. */
export function setStats(next: RuntimeStats): void {
  snapshot = next;
  for (const l of listeners) l();
}

/** Stable ref between setStats calls — safe for useSyncExternalStore. */
export function getStatsSnapshot(): RuntimeStats {
  return snapshot;
}

export function subscribeStats(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
