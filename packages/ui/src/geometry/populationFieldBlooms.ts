// The membership boundary: where a Cell condenses out of the medium, and
// where it dissolves back into it.
//
// A Cell leaving the stage is ALIVE on chain. Today it leaves the frame the
// way a dead one does — `syncCellRenderSet` handles an exit as swap-from-tail
// plus `pop()`, and there is no exit fade anywhere in `CellGalaxy`. Entries
// pop in the same way. So the stage rotates, and the medium beside it never
// visibly gains or loses anything.
//
// A bloom at the transitioning Cell's own position turns the field's claim
// from asserted into observed: every rotation of the stage demonstrates that
// the medium is made of Cells. That is the whole reason this layer earns its
// budget.
//
// Two rules the pool enforces rather than documents:
//
//   - A dissolve must never read as a death. Death owns its colour and its
//     600 ms; a Cell that is dying and leaving the stage in the same instant
//     plays the death and nothing else.
//   - A cut is not churn. Backfill replay and a curated refresh transition
//     resettle the plane in one step, and blooming a thousand marks at once
//     would state a thousand transitions that no viewer could have followed.

/** Ring-allocated bloom pool. Every array is allocated once; spawning and
 *  reading both run without touching the heap. */
export interface PopulationBloomPool {
  capacity: number;
  /** Local-frame x, y, z per slot. */
  positions: Float32Array;
  /** Scene-seconds at spawn. Negative marks a never-used slot. */
  startedAt: Float32Array;
  /** +1 condense (entry), -1 dissolve (exit). */
  kind: Float32Array;
  /** Next slot the ring will claim. */
  cursor: number;
  /** Blooms accepted since creation. */
  spawned: number;
  /** Spawns that overwrote a still-live bloom because the ring wrapped.
   *  Surfaced on a dev counter; it never affects a reported count. */
  clamped: number;
  /** Transitions dropped because the batch was a cut rather than churn. */
  suppressed: number;
}

/** How many membership changes in one batch stop being churn and start being
 *  a cut. Backfill replay and a curated refresh move a large fraction of the
 *  stage at once; ordinary block churn moves a handful. Deciding on the
 *  OBSERVABLE rather than on which upstream event is suspected keeps the rule
 *  honest when a new coalescing path appears. */
export const COALESCED_MEMBERSHIP_CHANGE = 256;

export function createPopulationBloomPool(capacity: number): PopulationBloomPool {
  const size = Math.max(1, Math.floor(capacity));
  const startedAt = new Float32Array(size);
  startedAt.fill(-1);
  return {
    capacity: size,
    positions: new Float32Array(size * 3),
    startedAt,
    kind: new Float32Array(size),
    cursor: 0,
    spawned: 0,
    clamped: 0,
    suppressed: 0,
  };
}

/** Age of the bloom in slot `slot`, normalized to its duration. Values
 *  outside [0, 1] mean the slot is dead or was never used. */
export function populationBloomLife(
  pool: PopulationBloomPool,
  slot: number,
  nowSec: number,
  durationSec: number,
): number {
  const startedAt = pool.startedAt[slot];
  if (startedAt < 0) return -1;
  return (nowSec - startedAt) / Math.max(durationSec, 1e-3);
}

export function spawnPopulationBloom(
  pool: PopulationBloomPool,
  x: number,
  y: number,
  z: number,
  kind: 1 | -1,
  nowSec: number,
  durationSec: number,
): void {
  const slot = pool.cursor;
  const life = populationBloomLife(pool, slot, nowSec, durationSec);
  if (life >= 0 && life < 1) pool.clamped += 1;
  const base = slot * 3;
  pool.positions[base] = x;
  pool.positions[base + 1] = y;
  pool.positions[base + 2] = z;
  pool.startedAt[slot] = nowSec;
  pool.kind[slot] = kind;
  pool.cursor = (slot + 1) % pool.capacity;
  pool.spawned += 1;
}

/** Resolve one transitioning id to the position its bloom belongs at, or
 *  `null` to skip it. Returning null is how a caller declines a transition it
 *  cannot place — or one that already has an event of its own, like a death. */
export type BloomPositionResolver = (
  id: number,
) => readonly [number, number, number] | null;

export interface MembershipBloomBatch {
  entered: Iterable<number>;
  exited: Iterable<number>;
  /** Number of membership changes in this batch, used to tell churn from a
   *  cut. Supplied by the caller because the iterables may be sets it would
   *  otherwise have to walk twice. */
  changeCount: number;
  /** Caller-known coalescing: a backfill envelope is a cut whatever its
   *  size. */
  coalesced: boolean;
  resolveEntry: BloomPositionResolver;
  resolveExit: BloomPositionResolver;
  nowSec: number;
  durationSec: number;
}

/**
 * Spawn blooms for one batch of membership changes. Returns how many landed.
 *
 * The whole batch is dropped when it reads as a cut, not trimmed to a
 * survivable few: a partial mark of a wholesale resettle would claim that
 * exactly those Cells moved.
 */
export function spawnMembershipBlooms(
  pool: PopulationBloomPool,
  batch: MembershipBloomBatch,
): number {
  if (batch.coalesced || batch.changeCount > COALESCED_MEMBERSHIP_CHANGE) {
    if (batch.changeCount > 0) pool.suppressed += batch.changeCount;
    return 0;
  }
  let landed = 0;
  for (const id of batch.exited) {
    const at = batch.resolveExit(id);
    if (!at) continue;
    spawnPopulationBloom(
      pool, at[0], at[1], at[2], -1, batch.nowSec, batch.durationSec,
    );
    landed += 1;
  }
  for (const id of batch.entered) {
    const at = batch.resolveEntry(id);
    if (!at) continue;
    spawnPopulationBloom(
      pool, at[0], at[1], at[2], 1, batch.nowSec, batch.durationSec,
    );
    landed += 1;
  }
  return landed;
}

/** Snapshot of the pool for the dev counter. Allocates — call it from a
 *  console, never from a frame. */
export function populationBloomStats(pool: PopulationBloomPool, nowSec: number, durationSec: number) {
  let live = 0;
  for (let slot = 0; slot < pool.capacity; slot += 1) {
    const life = populationBloomLife(pool, slot, nowSec, durationSec);
    if (life >= 0 && life < 1) live += 1;
  }
  return {
    capacity: pool.capacity,
    live,
    spawned: pool.spawned,
    clamped: pool.clamped,
    suppressed: pool.suppressed,
  };
}
