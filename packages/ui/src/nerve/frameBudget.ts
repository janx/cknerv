// ONE HEAVY BLOCK CONSUMER PER FRAME.
//
// A landed block is no longer one long task — the fabric half drains across
// frames (`fabricLandingQueue`), the bridge selects on a frame of its own
// (`bridgeSchedule`), and the live plan takes a bounded slice per frame
// (`livePulseQueue`). Each of those three is budgeted, and each budget is
// honest on its own. What none of them could see is EACH OTHER: the frame
// right after a landing is the frame all three want, and three budgets that
// are individually reasonable add up to a 50 ms frame (three vsyncs) with an
// 83 ms outlier — which is exactly what the phase-2 gate measured.
//
// So this module is the one thing above them: a per-frame ledger of what the
// heavy block work has already spent, and one rule for whether the next
// consumer may start.
//
// ## The rule
//
// `mayStartFrameWork(consumer, estimateMs)` answers yes when
//
//   1. nothing at or above this consumer's precedence has spent yet — a frame
//      cannot do better than one grain, and refusing the first piece of work
//      would only move it to a frame that is no emptier (the same reason
//      `drainFabricLandingQueue` checks its budget only once a step has been
//      issued and `stepLivePulseQueue` always takes at least one step); or
//   2. this consumer's own estimate still fits under
//      {@link FRAME_HEAVY_BUDGET_MS}; or
//   3. it has been held back {@link MAX_DEFER_FRAMES} frames in a row, in
//      which case it runs regardless. Nothing here may starve: every consumer
//      has a clock behind it — a departure deadline, a growth window, a
//      1.2 s stroke — and a deferral that can repeat forever is a dropped
//      packet or a fabric that never lands.
//
// ## Why precedence is a LADDER and not just an order of arrival
//
// The three consumers do not ask in the order they should be served. The
// fabric drain rides the raw priority −1 frame, so it asks FIRST; the bridge
// step rides a default-priority sim frame in a child component, so it asks
// before the owner's own default-priority callbacks; and the live-plan slice —
// the one consumer with a hard deadline, whose packets have a departure clock
// that no budget may move — asks LAST. An ordinary running total would let
// whatever asked first spend the deadline consumer out of its own frame.
//
// So a consumer is charged only against what consumers of its own precedence
// or HIGHER have spent this frame. The live plan is therefore never held by
// the drain or the bridge; the drain is held only by the plan; and the bridge
// step — 5–23 ms of selection, the largest single grain of the three — is the
// one that yields, which is the whole point of the exercise.
//
// Cost: three integer adds and a compare per consumer per frame, on a
// module-level object that is allocated once. Nothing here allocates.

/** Wall milliseconds of HEAVY BLOCK WORK one frame may take on.
 *
 *  16.7 ms of vsync, minus ~4 ms the frame owes its ordinary work anyway (the
 *  fabric and bridge walks over the strokes still moving, the pulse walk, the
 *  colony, the HUD's own commit), leaves ~12. A frame that spends exactly
 *  this still renders inside its vsync; a frame that spends it twice over is
 *  the 50 ms block frame this module exists to break up. */
export const FRAME_HEAVY_BUDGET_MS = 12;

/** Frames in a row a consumer may be held back before it runs regardless.
 *  Three frames is 50 ms at 60 Hz — inside the live plan's departure margin,
 *  inside a stroke's 1.2 s growth window, and inside the interval between two
 *  blocks by two orders of magnitude. */
export const MAX_DEFER_FRAMES = 3;

/** The live-plan slice. Highest precedence: its packets carry departure
 *  clocks that this module is not allowed to move. */
export const FRAME_BUDGET_PLAN_SLICE = 0;
/** The fabric landing drain. Its strokes have the whole growth window to
 *  enter, but a build that has not landed holds the bridge behind it. */
export const FRAME_BUDGET_FABRIC_DRAIN = 1;
/** One step of the bridge build. Lowest precedence, and the largest grain:
 *  the strokes it moves have a 1.2 s window and nothing waits on them. */
export const FRAME_BUDGET_BRIDGE_STEP = 2;

export type FrameBudgetConsumer =
  | typeof FRAME_BUDGET_PLAN_SLICE
  | typeof FRAME_BUDGET_FABRIC_DRAIN
  | typeof FRAME_BUDGET_BRIDGE_STEP;

/** How many there are — the ladder's height, not a magic number. */
export const FRAME_BUDGET_CONSUMER_COUNT = 3;

/** Wall milliseconds each consumer has spent in the CURRENT frame. */
const spentMs = [0, 0, 0];
/** Frames in a row each consumer has been refused since it last started. */
const deferredFrames = [0, 0, 0];
/** The frame serial each consumer last asked in, so a streak is frames IN A
 *  ROW and a consumer that stopped asking does not come back pre-armed. */
const lastAskSerial = [-1, -1, -1];
/** Bumped by the owner's raw priority −1 frame, beside T1's `markFrame()`. */
let frameSerial = 0;

/** What has been spent this frame by this consumer and everything above it. */
function spentAtOrAboveMs(consumer: FrameBudgetConsumer): number {
  let total = 0;
  for (let rank = 0; rank <= consumer; rank += 1) total += spentMs[rank];
  return total;
}

/**
 * A new frame: the ledger is empty again.
 *
 * Called once per rAF from the owner's raw priority −1 `useFrame`, which is
 * the first subscriber of every frame — so the drain in that same callback,
 * every default-priority consumer after it, and the bridge step in the child
 * layer all read one frame's ledger and never the previous frame's remains.
 * The deferral streaks deliberately survive: they are what stops a consumer
 * from being held forever, and a frame boundary is not a reason to forget one.
 */
export function beginFrameBudget(): void {
  frameSerial += 1;
  for (let rank = 0; rank < FRAME_BUDGET_CONSUMER_COUNT; rank += 1) {
    spentMs[rank] = 0;
  }
}

/**
 * May this consumer start its work on this frame?
 *
 * @param estimateMs what the work is expected to cost — a consumer's own last
 *   measured cost, which is the only honest predictor available (the first ask
 *   uses the class's initial estimate).
 */
export function mayStartFrameWork(
  consumer: FrameBudgetConsumer,
  estimateMs: number,
): boolean {
  const asked = lastAskSerial[consumer];
  // A gap in the asking breaks the streak: three deferrals a minute apart are
  // not a consumer being starved, they are three ordinary busy frames.
  if (asked !== frameSerial && asked !== frameSerial - 1) {
    deferredFrames[consumer] = 0;
  }
  lastAskSerial[consumer] = frameSerial;
  const spent = spentAtOrAboveMs(consumer);
  const estimate = Number.isFinite(estimateMs) && estimateMs > 0
    ? estimateMs
    : 0;
  if (
    spent === 0
    || spent + estimate <= FRAME_HEAVY_BUDGET_MS
    || deferredFrames[consumer] >= MAX_DEFER_FRAMES
  ) {
    deferredFrames[consumer] = 0;
    return true;
  }
  deferredFrames[consumer] += 1;
  return false;
}

/** Report what the work actually cost. Every consumer measures itself with
 *  one `performance.now()` pair it already had, and this is where the frame's
 *  ledger learns about it. */
export function spendFrameBudget(
  consumer: FrameBudgetConsumer,
  elapsedMs: number,
): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  spentMs[consumer] += elapsedMs;
}

/** What is left of the frame's heavy budget for this consumer — for a
 *  consumer that can size its own slice (the fabric drain caps its per-frame
 *  budget at this) rather than merely start or not start. */
export function frameBudgetRemainingMs(consumer: FrameBudgetConsumer): number {
  return Math.max(0, FRAME_HEAVY_BUDGET_MS - spentAtOrAboveMs(consumer));
}

export interface FrameBudgetSnapshot {
  serial: number;
  spentMs: number[];
  deferredFrames: number[];
}

/** Dev read. Allocates, so it is never called from a frame. */
export function snapshotFrameBudget(): FrameBudgetSnapshot {
  return {
    serial: frameSerial,
    spentMs: [...spentMs],
    deferredFrames: [...deferredFrames],
  };
}

/** Tests, and a scene teardown that must not leave a streak behind. */
export function resetFrameBudget(): void {
  frameSerial = 0;
  for (let rank = 0; rank < FRAME_BUDGET_CONSUMER_COUNT; rank += 1) {
    spentMs[rank] = 0;
    deferredFrames[rank] = 0;
    lastAskSerial[rank] = -1;
  }
}
