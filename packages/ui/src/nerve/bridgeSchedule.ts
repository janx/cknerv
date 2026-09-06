// WHICH FRAME the bridge's host sync and selection are allowed to run on.
//
// A bridge picks its hosts by DRAWN fabric degree — a Cell whose neighbours
// exist but were never selected is exactly as bare as one with none — so the
// selection has to read the fabric of the build it is selecting for. It used
// to, without anyone having to arrange it: the owner applied a build's grow
// and kill inside the worker landing task, and React ran the bridge effect in
// the commit straight after, over a fabric that was already whole.
//
// That is no longer true, and it is not a regression but the point. The fabric
// half of a landing now drains across the frames AFTER the build publishes its
// version (`fabricLandingQueue`), so the commit that publishes `version` sees
// a fabric one to three frames behind — and the selection is 5–23 ms of work
// stacked on the very React task the drain exists to unload. So the commit
// only ARMS a slot, and this module is the whole of the rule that fires it.
//
// The rule, in the order it is asked:
//   1. Nothing armed is nothing to run. The idle frame's entire cost.
//   2. An arm runs ONCE. The owner clears the slot as it fires, and this is
//      the second lock on that door: a slot re-read after its own run is not
//      a second build.
//   3. Not before the fabric of that build has landed — `landedVersion >=
//      version`, so a fabric that has already run PAST the pending version
//      satisfies it too. That matters: a build superseded before its fabric
//      landed never selects at all (the newer arm replaced it), and the next
//      landed version is a fabric that is ahead of the pending one, not
//      behind it, which is the only thing the rule is protecting.
//   4. The pre-build mount pass is not held back by the owner's sentinel.
//
// ⭐ Why an ARM SERIAL and not the version. Two arms can carry the same
// version: the halo placement publishes once, part-way through boot, and the
// anchor index it builds re-anchors the selection without a topology build
// behind it. Keyed on the version, that second arm would look like a build
// that had already selected and would be dropped — and the selection would
// hold last-placement anchors until the next block. Keyed on the arm, "once
// per build" and "once per re-anchor" are the same sentence.

/** One armed bridge build: the version whose fabric it must read, and which
 *  arming of the slot it is. The owner's record carries the anchor index too;
 *  this module never looks at it. */
export interface PendingBridgeBuild {
  /** The display graph version the arming commit published. */
  readonly version: number;
  /** Monotonic, incremented by the owner on every arm. Two arms are never
   *  equal even when their versions are. */
  readonly arm: number;
}

/** The version the owner publishes before any build has landed: an empty
 *  graph, an empty staged Cell map, and no fabric at all. Its selection reads
 *  nothing and its only effect is to prime the anchor the next build compares
 *  against, so there is nothing for it to wait for — and the owner's "nothing
 *  has landed yet" sentinel is `-1`, one BELOW it, which a plain `>=` would
 *  read as a fabric that is behind. */
export const BRIDGE_PRE_BUILD_VERSION = 0;

/**
 * Should the bridge frame run the armed build?
 *
 * @param pending      the armed build, or `null` when the slot is empty.
 * @param landedVersion the display graph version whose fabric grow/kill has
 *   fully landed — `fabricLandedVersionRef`, or `+Infinity` for a scene that
 *   publishes no such ref and therefore has no fabric running behind it.
 * @param lastRanArm   the arm serial the last run consumed; `0` before any.
 */
export function bridgeRunDecision(
  pending: PendingBridgeBuild | null,
  landedVersion: number,
  lastRanArm: number,
): boolean {
  if (pending === null) return false;
  if (pending.arm <= lastRanArm) return false;
  if (pending.version <= BRIDGE_PRE_BUILD_VERSION) return true;
  return landedVersion >= pending.version;
}
