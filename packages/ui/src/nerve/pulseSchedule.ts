// Where a live packet's head is at time t. A metabolic pulse departs from the
// address of the cell that died, so its journey opens with a leading GHOST
// leg — `origin.pos → path[0]` — that no fabric edge backs. The ghost is part
// of the journey rather than an overlay: every real hop boundary after it
// shifts by its duration, and so does the terminal arrival the write seal is
// stamped from.
//
// The arithmetic lives here because the frame walk runs inside a Canvas jsdom
// never mounts, and an off-by-one in a shifted boundary is invisible in a
// screenshot.

import { MEDIAN_FABRIC_EDGE_LEN } from './pulseRunner';

/** Leg index of the ghost hop. Real hops keep their path indices, so every
 *  `path[leg]` / `path[leg + 1]` read in the walk holds unchanged and exactly
 *  one index is exempt from the graph rules. */
export const PULSE_LEG_GHOST = -1;

/** Ghost duration in hop-times. A leg shorter than the fabric's own stride
 *  still costs one full hop — nothing in the tissue reads faster than the
 *  fabric — and a cross-disc origin is capped so it launches rather than
 *  crawling: at 33 ms/hop the ceiling is ~132 ms for any distance. */
export const GHOST_HOP_SCALE_MIN = 1;
export const GHOST_HOP_SCALE_MAX = 4;

/** Head state for one frame. Reused in place: the walk touches every active
 *  pulse each frame, and a per-pulse object would allocate at frame rate. */
export interface PulseLegHead {
  /** `PULSE_LEG_GHOST` inside the ghost, else the real hop index. On arrival
   *  it is the terminal node's index, which is not a leg. */
  leg: number;
  /** Wavefront position in [0, 1) along that leg; 0 once arrived. */
  subT: number;
  /** The head has passed the terminal node. */
  arrived: boolean;
}

export function makePulseLegHead(): PulseLegHead {
  return { leg: 0, subT: 0, arrived: false };
}

/**
 * Duration (ms) of the ghost leg for a packet whose hops last `hopMs` and
 * whose origin sits `ghostLen` world units from its entry node. A
 * non-finite length falls to the floor rather than poisoning the schedule.
 */
export function ghostLegDurationMs(hopMs: number, ghostLen: number): number {
  const scale = Number.isFinite(ghostLen)
    ? Math.min(
      GHOST_HOP_SCALE_MAX,
      Math.max(GHOST_HOP_SCALE_MIN, ghostLen / MEDIAN_FABRIC_EDGE_LEN),
    )
    : GHOST_HOP_SCALE_MIN;
  return hopMs * scale;
}

/**
 * Resolve the head into `out` at `elapsedMs` since this pulse's own departure
 * (start jitter already subtracted). `ghostMs` is 0 for a pulse with no
 * origin, which reproduces the pre-ghost arithmetic exactly.
 *
 * A ghost-only packet (`totalHops === 0`, ghost present) arrives the instant
 * its ghost ends: the entry node IS the destination.
 */
export function pulseLegHeadInto(
  out: PulseLegHead,
  totalHops: number,
  hopMs: number,
  ghostMs: number,
  elapsedMs: number,
): PulseLegHead {
  if (ghostMs > 0 && elapsedMs < ghostMs) {
    out.leg = PULSE_LEG_GHOST;
    out.subT = elapsedMs / ghostMs;
    out.arrived = false;
    return out;
  }
  const hopFloat = (elapsedMs - ghostMs) / hopMs;
  const leg = Math.floor(hopFloat);
  if (leg >= totalHops) {
    out.leg = totalHops;
    out.subT = 0;
    out.arrived = true;
    return out;
  }
  out.leg = leg;
  out.subT = hopFloat - leg;
  out.arrived = false;
  return out;
}

/**
 * Offset (ms) from departure at which the head lands on `path[leg + 1]` —
 * `path[0]` for the ghost leg. Every boundary carries the ghost's shift.
 */
export function pulseLegArrivalMs(
  hopMs: number,
  ghostMs: number,
  leg: number,
): number {
  return leg < 0 ? ghostMs : ghostMs + (leg + 1) * hopMs;
}

/** Offset (ms) from departure at which the packet reaches `path[totalHops]`.
 *  Equals the ghost's end when the entry node is the destination. */
export function pulseTerminalArrivalMs(
  totalHops: number,
  hopMs: number,
  ghostMs: number,
): number {
  return ghostMs + totalHops * hopMs;
}

/** Whether a leg dies when the live graph drops it. Only real hops ride
 *  fibres; the ghost's two ends are values, so nothing in the stage can take
 *  it away — a packet stranded outside the fabric could never recover. */
export function pulseLegExtinguishes(leg: number): boolean {
  return leg >= 0;
}
