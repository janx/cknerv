// ONE SHARED HEAVY-WORK LEDGER PER FRAME.
//
// A landed block is no longer one long task — the fabric half drains across
// frames (`fabricLandingQueue`), the bridge selects on a frame of its own
// (`bridgeSchedule`), the inspection solver yields route work, and the live
// plan takes a bounded slice per frame (`livePulseQueue`). Each is budgeted,
// honest on its own. What none of them could see is EACH OTHER: the frame
// right after a landing is the frame all three want, and three budgets that
// are individually reasonable add up to a 50 ms frame (three vsyncs) with an
// which is exactly what the phase-2 gate measured.
//
// So this module is the one thing above them: a per-frame ledger of what the
// heavy block work has already spent, and one rule for whether the next
// consumer may start.
//
// ## The rule
//
// The consumers do not ask in the order they should be served. The
// fabric drain rides the raw priority −1 frame, so it asks FIRST; the bridge
// step rides a default-priority sim frame in a child component, so it asks
// before the owner's own default-priority callbacks; and the live-plan slice —
// the one consumer with a hard deadline, whose packets have a departure clock
// that no budget may move — asks LAST. An ordinary running total would let
// whatever asked first spend the deadline consumer out of its own frame.
//
// The owner reserves the measured live-plan slice before those callbacks run.
// Every admission then sees total actual spend plus other consumers' pending
// reservations. A reserved consumer remains admitted even when earlier work
// underestimated its cost, preserving its departure clock; the snapshot
// records that forced admission and the resulting actual overspend. A
// consumer held for three consecutive frames advances one already-bounded
// unit, so no growth or withdrawal can starve indefinitely.
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
/** A newly opened or invalidated inspection constellation. Its canonical
 * solver yields, but its first valid placement still has a UI deadline. */
export const FRAME_BUDGET_PANEL_SOLVE = 1;
/** The fabric landing drain. Its strokes have the whole growth window to
 *  enter, but a build that has not landed holds the bridge behind it. */
export const FRAME_BUDGET_FABRIC_DRAIN = 2;
/** One step of the bridge build. Lowest precedence, and the largest grain:
 *  the strokes it moves have a 1.2 s window and nothing waits on them. */
export const FRAME_BUDGET_BRIDGE_STEP = 3;

export type FrameBudgetConsumer =
  | typeof FRAME_BUDGET_PLAN_SLICE
  | typeof FRAME_BUDGET_PANEL_SOLVE
  | typeof FRAME_BUDGET_FABRIC_DRAIN
  | typeof FRAME_BUDGET_BRIDGE_STEP;

/** How many there are — the ladder's height, not a magic number. */
export const FRAME_BUDGET_CONSUMER_COUNT = 4;

/** Wall milliseconds each consumer has spent in the CURRENT frame. */
const spentMs = [0, 0, 0, 0];
/** Work promised to a consumer that asks later in callback order. */
const reservedMs = [0, 0, 0, 0];
/** Reservations announced by work that remains pending across frames. */
const pendingReservationMs = [0, 0, 0, 0];
/** Estimate accepted by the last admission, for actual-vs-estimated gauges. */
const admittedEstimateMs = [0, 0, 0, 0];
let forcedByReservation = 0;
let forcedByStarvation = 0;
let estimateOvershootMs = 0;
/** The same four, folded forward instead of cleared.
 *
 *  The per-frame counters above answer WHY THIS FRAME went over, and they are
 *  wiped by the next `beginFrameBudget` — so from outside the frame loop they
 *  can only be caught by stopping the world inside the frame that set them,
 *  which is exactly the frame a probe cannot predict. A running total over a
 *  window is what a live read needs: reset once, run the scenario, read once.
 *  Cost is four adds per frame on numbers this module already had. */
let windowFrames = 0;
let windowForcedByReservation = 0;
let windowForcedByStarvation = 0;
let windowEstimateOvershootMs = 0;
let windowOverspendMs = 0;
/** Frames in a row each consumer has been refused since it last started. */
const deferredFrames = [0, 0, 0, 0];
/** The frame serial each consumer last asked in, so a streak is frames IN A
 *  ROW and a consumer that stopped asking does not come back pre-armed. */
const lastAskSerial = [-1, -1, -1, -1];
/** Bumped by the owner's raw priority −1 frame, beside T1's `markFrame()`. */
let frameSerial = 0;
let frameToken: number | null = null;
/** Woken when a frame opens the ledger — see {@link onFrameBudgetOpened}. */
const frameOpenedListeners = new Set<() => void>();
/**
 * The listeners are walked out of THIS, not out of the Set.
 *
 * ⚠️⚠️ A Set's iterator visits entries added DURING the walk, and the one
 * listener this exists for re-subscribes the moment it is woken: a recovery
 * that finds the ledger still closed asks to be woken again. Iterating the
 * Set directly therefore woke it, saw its new registration, woke it again —
 * for ever, inside one `beginFrameBudget`. (Found the way it deserves to be:
 * a test process at 1 % CPU for nine minutes.) The array is kept across
 * frames so the copy allocates nothing.
 */
const frameOpenedScratch: Array<(() => void) | null> = [];

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
/**
 * Called when a new frame opens the ledger — the one moment a consumer that
 * was refused for having no room could have room again.
 *
 * It exists because the alternative is a POLL. Main-thread topology recovery
 * used to wait out a closed ledger on a 16 ms timer, which wakes 60 times a
 * second while the ledger is full and 25 times through 400 ms of a hidden tab
 * where there are no frames at all and nothing can have changed. A frame
 * boundary is the event, so the frame boundary is what carries it.
 *
 * Returns the unsubscribe. Listeners are called in registration order inside
 * `beginFrameBudget`, BEFORE any consumer of this frame has asked — so a
 * listener that starts work immediately is spending the frame it was woken
 * for. A listener must not throw; one that does would take the frame's ledger
 * reset with it.
 */
export function onFrameBudgetOpened(listener: () => void): () => void {
  frameOpenedListeners.add(listener);
  return () => {
    frameOpenedListeners.delete(listener);
  };
}

export function beginFrameBudget(token?: number): void {
  if (token !== undefined && token === frameToken) return;
  // The frame that just ended is only complete now, so this is where it joins
  // the window — including its overspend, which is a fact about the whole
  // frame and has no earlier moment to be read at.
  if (frameSerial > 0) {
    windowFrames += 1;
    windowForcedByReservation += forcedByReservation;
    windowForcedByStarvation += forcedByStarvation;
    windowEstimateOvershootMs += estimateOvershootMs;
    windowOverspendMs += Math.max(0, totalSpentMs() - FRAME_HEAVY_BUDGET_MS);
  }
  frameToken = token ?? null;
  frameSerial += 1;
  for (let rank = 0; rank < FRAME_BUDGET_CONSUMER_COUNT; rank += 1) {
    spentMs[rank] = 0;
    reservedMs[rank] = pendingReservationMs[rank];
    admittedEstimateMs[rank] = 0;
  }
  forcedByReservation = 0;
  forcedByStarvation = 0;
  estimateOvershootMs = 0;
  // After the reset, so a listener that asks for room this frame reads the
  // frame it was woken for and not the one that just ended.
  if (frameOpenedListeners.size > 0) {
    let count = 0;
    for (const listener of frameOpenedListeners) {
      frameOpenedScratch[count] = listener;
      count += 1;
    }
    for (let index = 0; index < count; index += 1) {
      const listener = frameOpenedScratch[index];
      frameOpenedScratch[index] = null;
      listener?.();
    }
  }
}

/** The most a promise about a LATER frame may take out of this one.
 *
 *  A cross-frame reservation is held on every frame until the work it describes
 *  finishes, and the panel solver's is its first-paint allowance — 8 of the 12
 *  — held for as long as a full solve is pending, which for four instruments
 *  is up to ~234 frames. At that size nothing of lower rank could ever satisfy
 *  `committed + estimate <= FRAME_HEAVY_BUDGET_MS`, so every one of them
 *  reached the frame it ran on through the three-frame starvation escape
 *  instead: measured on the ledger, a block landing's drain moved from frame 2
 *  to frame 12, its bridge from 6 to 21, and seven frames in two hundred went
 *  over budget by rule.
 *
 *  Half the budget is the line because it is the line that keeps the OTHER
 *  half spendable: a consumer whose own grain fits in 6 ms is admitted on the
 *  frame it asks, and the escape goes back to being insurance. It costs the
 *  announcing consumer nothing — `frameBudgetRemainingMs` never counted a
 *  consumer's own reservation against it, so a held panel solve still gets its
 *  8 ms on the frame it finally runs. */
export const MAX_PENDING_RESERVATION_MS = FRAME_HEAVY_BUDGET_MS / 2;

/** Keep room for a bounded cursor on following frames, before callbacks with
 * lower precedence can consume it.
 *
 * ⚠️ NOT `reserveFrameBudget`: that one is a promise about THIS frame, made by
 * the owner on behalf of a deadline consumer that has not asked yet, and it is
 * released the moment that consumer spends. This one outlives the frame, and
 * that is why it is capped. */
export function announceFrameBudgetWork(
  consumer: FrameBudgetConsumer,
  estimateMs: number,
): void {
  pendingReservationMs[consumer] = Number.isFinite(estimateMs) && estimateMs > 0
    ? Math.min(MAX_PENDING_RESERVATION_MS, estimateMs)
    : 0;
}

export function clearFrameBudgetWork(consumer: FrameBudgetConsumer): void {
  pendingReservationMs[consumer] = 0;
  reservedMs[consumer] = 0;
}

/** Reserve room for work that is known to be pending but executes later in
 * the frame callback order. Repeated calls replace the reservation. */
export function reserveFrameBudget(
  consumer: FrameBudgetConsumer,
  estimateMs: number,
): void {
  reservedMs[consumer] = Number.isFinite(estimateMs) && estimateMs > 0
    ? Math.min(FRAME_HEAVY_BUDGET_MS, estimateMs)
    : 0;
}

export function releaseFrameBudget(consumer: FrameBudgetConsumer): void {
  reservedMs[consumer] = 0;
}

function totalSpentMs(): number {
  let total = 0;
  for (let rank = 0; rank < FRAME_BUDGET_CONSUMER_COUNT; rank += 1) total += spentMs[rank];
  return total;
}

function reservationsExceptMs(consumer: FrameBudgetConsumer): number {
  let total = 0;
  for (let rank = 0; rank < FRAME_BUDGET_CONSUMER_COUNT; rank += 1) {
    if (rank !== consumer) total += reservedMs[rank];
  }
  return total;
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
  const committed = totalSpentMs() + reservationsExceptMs(consumer);
  const estimate = Number.isFinite(estimateMs) && estimateMs > 0
    ? estimateMs
    : 0;
  // A reservation is a promise to deadline work, not merely a hint to work
  // that happens earlier. If an earlier consumer underestimated or advanced
  // through starvation, the promised slice still runs and the actual ledger
  // exposes the resulting overrun instead of delaying the departure clock.
  if (reservedMs[consumer] > 0) {
    if (committed + estimate > FRAME_HEAVY_BUDGET_MS) forcedByReservation += 1;
    admittedEstimateMs[consumer] = estimate;
    deferredFrames[consumer] = 0;
    return true;
  }
  if (
    committed + estimate <= FRAME_HEAVY_BUDGET_MS
    || deferredFrames[consumer] >= MAX_DEFER_FRAMES
  ) {
    if (committed + estimate > FRAME_HEAVY_BUDGET_MS) forcedByStarvation += 1;
    admittedEstimateMs[consumer] = estimate;
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
  // A started consumer owns actual time now; keeping its estimate reserved
  // would count the same work twice for callbacks that follow it.
  reservedMs[consumer] = 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  estimateOvershootMs += Math.max(0, elapsedMs - admittedEstimateMs[consumer]);
  admittedEstimateMs[consumer] = 0;
  spentMs[consumer] += elapsedMs;
}

/** What is left of the frame's heavy budget for this consumer — for a
 *  consumer that can size its own slice (the fabric drain caps its per-frame
 *  budget at this) rather than merely start or not start. */
export function frameBudgetRemainingMs(consumer: FrameBudgetConsumer): number {
  return Math.max(
    0,
    FRAME_HEAVY_BUDGET_MS - totalSpentMs() - reservationsExceptMs(consumer),
  );
}

/** The forced admissions and the overspend of every frame since the window
 *  was last zeroed — the reading a probe takes, where the fields beside it in
 *  `FrameBudgetSnapshot` describe only the frame in progress. */
export interface FrameBudgetWindowSnapshot {
  /** Completed frames folded in. The denominator of every field below. */
  frames: number;
  forcedByReservation: number;
  forcedByStarvation: number;
  estimateOvershootMs: number;
  overspendMs: number;
}

export interface FrameBudgetSnapshot {
  serial: number;
  spentMs: number[];
  deferredFrames: number[];
  reservedMs: number[];
  totalSpentMs: number;
  overspendMs: number;
  forcedByReservation: number;
  forcedByStarvation: number;
  estimateOvershootMs: number;
  window: FrameBudgetWindowSnapshot;
}

/** Dev read. Allocates, so it is never called from a frame. */
export function snapshotFrameBudget(): FrameBudgetSnapshot {
  return {
    serial: frameSerial,
    spentMs: [...spentMs],
    deferredFrames: [...deferredFrames],
    reservedMs: [...reservedMs],
    totalSpentMs: totalSpentMs(),
    overspendMs: Math.max(0, totalSpentMs() - FRAME_HEAVY_BUDGET_MS),
    forcedByReservation,
    forcedByStarvation,
    estimateOvershootMs,
    window: {
      frames: windowFrames,
      forcedByReservation: windowForcedByReservation,
      forcedByStarvation: windowForcedByStarvation,
      estimateOvershootMs: windowEstimateOvershootMs,
      overspendMs: windowOverspendMs,
    },
  };
}

/** Open a fresh measurement window. Deliberately NOT `resetFrameBudget`: a
 *  probe that zeroes its counters must not also zero the deferral streaks and
 *  the spend of the frame it is running inside. */
export function resetFrameBudgetStats(): void {
  windowFrames = 0;
  windowForcedByReservation = 0;
  windowForcedByStarvation = 0;
  windowEstimateOvershootMs = 0;
  windowOverspendMs = 0;
}

/** Tests, and a scene teardown that must not leave a streak behind. */
export function resetFrameBudget(): void {
  frameSerial = 0;
  frameToken = null;
  for (let rank = 0; rank < FRAME_BUDGET_CONSUMER_COUNT; rank += 1) {
    spentMs[rank] = 0;
    reservedMs[rank] = 0;
    admittedEstimateMs[rank] = 0;
    pendingReservationMs[rank] = 0;
    deferredFrames[rank] = 0;
    lastAskSerial[rank] = -1;
  }
  forcedByReservation = 0;
  forcedByStarvation = 0;
  estimateOvershootMs = 0;
  resetFrameBudgetStats();
}
