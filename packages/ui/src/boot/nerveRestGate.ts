import { beginBootPhase, completeBootPhase } from './bootSequence';

/**
 * When is the nerve system actually ON SCREEN?
 *
 * The boot record's `fabric` line used to close the moment NeuralNetwork
 * applied the first display-graph build — which is when the fabric STARTS
 * growing, not when the viewer stops watching nerves assemble. Three real
 * render events follow that commit, none instantaneous: the admitted edges
 * grow on the GPU for GROWTH_MS; the unresolved-population halo is placed by
 * a worker whose walk is machine- and cache-dependent; and the bridge tier —
 * the literal outer nerves — cannot even select until that placement
 * publishes, then grows GROWTH_MS itself. The visible result was a readout
 * that said done and left while the periphery was still sprouting.
 *
 * This gate holds the line open until the tiers are at rest. It is a set of
 * monotonic latches written by the subsystems that own each fact, plus one
 * per-frame `tick` from a sentinel on the SAME sim clock the growth is drawn
 * against — so a paused clock freezes the gate exactly as it freezes the
 * animation it is waiting for.
 *
 * REQUIREMENTS ARE CREATED BY EVIDENCE. A tier that never announces itself is
 * never waited for, which is what keeps every absence honest instead of a
 * wedge: a stage with nothing unresolved reports no placement and the gate
 * skips the halo and the bridges; a placement that lands empty waives the
 * bridge wait; a field too small to wire completes on the graph landing, as
 * the line always did. And every `expected` has a guaranteed `ready`: the
 * placement session falls back to the main thread on every worker failure
 * path, and a cancelled session's effect re-runs and re-places.
 *
 * BOUNDED BY THE BOOT COHORT. Only the FIRST population pass reports a growth
 * deadline and only the FIRST post-build bridge selection reports one — the
 * refill churn that keeps admitting edges for minutes on a cold server is the
 * organism living, not the page booting, and must not stretch the readout
 * (that is the stage-convergence problem, deliberately out of scope here).
 * After completion the gate is inert for the session, like the record it
 * feeds.
 */
interface NerveRestGate {
  /** The first display-graph build landed (`fabric` goes active here). */
  graphApplied: boolean;
  /** Sim-second deadline for the boot cohort's fabric growth, or null when
   *  no cohort was admitted (nothing grew, nothing to wait for). */
  growUntilSec: number | null;
  /** A halo placement is coming — latched only on paths that guarantee a
   *  publish, so `expected` without `ready` is a state, never a wedge. */
  populationExpected: boolean;
  /** Placed point count, null until the placement publishes. Zero waives the
   *  bridge wait: no anchors means no bridge is ever selected. */
  populationReadyCount: number | null;
  /** Sim-second deadline for the boot cohort of bridge strokes, or null
   *  until the first selection against a real build reports one. */
  bridgeGrowUntilSec: number | null;
  done: boolean;
}

function initialGate(): NerveRestGate {
  return {
    graphApplied: false,
    growUntilSec: null,
    populationExpected: false,
    populationReadyCount: null,
    bridgeGrowUntilSec: null,
    done: false,
  };
}

let gate: NerveRestGate = initialGate();

/** First display-graph build applied (NeuralNetwork). Opens the `fabric`
 *  line; the gate closes it. First apply wins; later builds cost a boolean. */
export function reportBootGraphApplied(): void {
  if (gate.done || gate.graphApplied) return;
  gate.graphApplied = true;
  beginBootPhase('fabric');
}

/** The boot cohort of fabric edges was admitted; it is fully grown at
 *  `untilSec` (sim seconds). Max-latched: a remount that re-admits the boot
 *  population during boot re-grows it, and the readout follows the pixels. */
export function reportBootNerveGrowth(untilSec: number): void {
  if (gate.done || !Number.isFinite(untilSec)) return;
  gate.growUntilSec = gate.growUntilSec === null
    ? untilSec
    : Math.max(gate.growUntilSec, untilSec);
}

/** A halo placement will publish. Latched by `CellPopulationField` only on
 *  the paths whose delivery is guaranteed (adopt-published, or a session
 *  with the main-thread fallback). */
export function reportBootPopulationExpected(): void {
  if (gate.done) return;
  gate.populationExpected = true;
}

/** The placement published with `count` placed points. First publish is THE
 *  placement — the pass is pure in (count, seed) — so the first report wins. */
export function reportBootPopulationReady(count: number): void {
  if (gate.done || gate.populationReadyCount !== null) return;
  gate.populationReadyCount = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0;
}

/** The first bridge selection against a real topology build ran; its strokes
 *  are fully grown at `untilSec` (sim seconds — equal to now when it selected
 *  nothing). First report wins: later selections are refill churn. */
export function reportBootBridgeSelected(untilSec: number): void {
  if (gate.done || gate.bridgeGrowUntilSec !== null) return;
  if (!Number.isFinite(untilSec)) return;
  gate.bridgeGrowUntilSec = untilSec;
}

/** Sentinel early-out: true once the `fabric` line has closed. */
export function bootNerveRestDone(): boolean {
  return gate.done;
}

/**
 * One frame of the gate, on the sim clock. Completes the `fabric` line when
 * every requirement the evidence created is satisfied. Deadline comparisons
 * are written `!(now >= until)` so a NaN clock holds the gate rather than
 * releasing it.
 */
export function tickBootNerveRest(nowSec: number): void {
  if (gate.done) return;
  if (!gate.graphApplied) return;
  if (gate.growUntilSec !== null && !(nowSec >= gate.growUntilSec)) return;
  if (gate.populationExpected && gate.populationReadyCount === null) return;
  if (gate.populationReadyCount !== null && gate.populationReadyCount > 0) {
    const until = gate.bridgeGrowUntilSec;
    if (until === null || !(nowSec >= until)) return;
  }
  gate.done = true;
  completeBootPhase('fabric');
}

/** A page boots once; only tests rewind. Pair with the boot record's own
 *  reset — the gate completes a phase there. */
export function resetNerveRestGateForTest(): void {
  gate = initialGate();
}
