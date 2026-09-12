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
// a fabric one to three frames behind — and the former synchronous selection
// was 5–23 ms of work stacked on the React task the drain exists to unload. So the commit
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

/** A React effect may run after a newer worker microtask has already replaced
 * the shared immutable refs. Only arm when their atomic tag still matches the
 * rendered version whose fabric/departure timing this build carries. */
export function bridgeInputVersionMatches(
  renderedVersion: number,
  publishedInputVersion: number,
): boolean {
  return renderedVersion === publishedInputVersion;
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

// ── The build itself, as three resumable phases across frames ───────────────
//
// Moving the whole body out of the React commit (above) was only half of it.
// The body still ran in ONE frame — 19.7 ms at the median, 33.2 at the worst,
// measured on the frame right after a landing, which is also the frame the
// fabric drain and the live-plan slice want. So the body is now a sequence,
// one bounded slice per frame at most, each asking the budget before it starts:
//
//   A `sync`      — `syncBridgeHosts`: diff the persistent host registry
//                   against the staged Cells and the drawn fabric. A build
//                   that moved no host ends the sequence right here, which is
//                   the steady state of a composed stage.
//   B `select`    — the canonical selector cursor: coverage and plan work over
//                   the anchor index in wall-clock slices.
//   C `reconcile` — `reconcileBridgeStrokes` + the build's boot report: the
//                   selection becomes births, deaths and revivals, and the
//                   admission pass LATER IN THE SAME FRAME CALLBACK takes
//                   them, so a chosen stroke still reaches the GPU on the
//                   frame it was chosen.
//
// ⚠️ The arm owns immutable Cells/edges tagged with its display version. The
// registry persists, while selection and reconcile continue from that one
// arm. A newer arm restarts the sequence from step A.

/** Where a running bridge build stands. */
export type BridgeBuildStep = 'sync' | 'select' | 'reconcile';

/** What each resumable slice is expected to cost before it has ever run.
 * Seeding this with the retired whole-step costs would make the 15 ms selector
 * ineligible for a 12 ms frame and force every first build through starvation.
 * After a slice runs, its measured wall time becomes the next estimate. */
export const BRIDGE_STEP_ESTIMATE_MS: Readonly<Record<BridgeBuildStep, number>> = {
  sync: 2,
  select: 2,
  reconcile: 2,
};

/** The step after this one, or `null` when the sequence is finished. */
export function nextBridgeStep(step: BridgeBuildStep): BridgeBuildStep | null {
  if (step === 'sync') return 'select';
  if (step === 'select') return 'reconcile';
  return null;
}

/**
 * Where a newer arm's sequence goes on from, once its own sync has answered.
 *
 * A newer arm restarts at `sync` and always will: hosts of two builds may not
 * be mixed inside one selection, and only the sync knows whether they differ.
 * But when that sync reports that nothing the selection READS has moved, the
 * sequence this arm replaced was working towards the answer this one wants,
 * and re-selecting for it is re-deriving a result that is already part-built.
 * A backfill burst lands builds closer together than the pipeline (10–36
 * slices warm, 39 cold), so a restart at `select` each time is what keeps the
 * layer showing the hosts of a build several landings old until the burst
 * ends (lane L2-5).
 *
 * ⭐ Why `moved === false` is enough to inherit a part-run selection, even
 * though the registry it reads has been rewritten under it. The word is exact
 * about the SET of `(id, degree)` over living Cells with every degree past
 * the host ceiling collapsed onto one rung, so `false` means: every host the
 * selection can choose is still there, at the degree it was at. A record that
 * arrived, left, or changed degree without moving the word did so ABOVE the
 * ceiling, and the scan skips those whenever it reaches them. The anchor
 * index has to be the same object for the same reason the caller's own skip
 * requires it — the plans are built against it.
 */
export function bridgeStepAfterSync(
  hostsMoved: boolean,
  supersededStep: BridgeBuildStep | null,
  supersededAnchorHolds: boolean,
): BridgeBuildStep {
  if (hostsMoved) return 'select';
  // A sequence still in its own sync has nothing chosen to inherit.
  if (supersededStep === null || supersededStep === 'sync') return 'select';
  if (!supersededAnchorHolds) return 'select';
  return supersededStep;
}
