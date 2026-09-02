// Dev instrumentation: counts WHERE each colony block wave started. Pure
// module singleton — same idiom as `pulseStats` next door: read and mutated
// directly, reset by a probe or a test, always on (one integer increment per
// block, which is one increment every few seconds). The WINDOW hook that
// surfaces it lives in ui-app, so the library stays free of `window` coupling.
//
// ⭐ IT EXISTS BECAUSE THE ORIGIN CHANGE HAD NO OBSERVABLE. The block wave now
// starts at the node that MADE the block rather than on the anonymous scatter,
// and the oracle for that is a distribution: over a few dozen live blocks, the
// fraction of waves erupting from the dominant producer's node should approach
// its share of the window. Nothing on the page could answer it — a wave is a
// stamp in a uniform and a couple of seconds of light — so the change was
// verifiable only by watching, which is not verification. This is the counter
// that closes it.
//
// ⚠️ AN INSTRUMENT, NOT A FEATURE. No HUD surface reads it, nothing crosses the
// wire for it, and the render path pays one increment on a block edge it was
// already handling.

import { ATTESTED_ID_PREFIX } from './networkTopology.derive';

/** Where one wave started.
 *
 *  `attested` = at the node the chain named on the block that fired the pulse.
 *  `anonymous` = the ghost pick — which is the honest answer to a block whose
 *  cellbase named nobody, to a producer that left the rolling window between
 *  the pulse and the render, and to a mid-session resync whose restored stamp
 *  carries no producer at all. `pickOrigin` argues all three. */
export type WaveOrigin = 'attested' | 'anonymous';

export interface ProducerOriginStatsSnapshot {
  /** Waves the colony actually stamped since the last reset.
   *
   *  ⚠️ WHAT FIRED, NEVER WHAT COMPLETED. A genuine producer key-set change —
   *  a tail producer entering the union of the 240-block window and the
   *  indexer's week, or leaving BOTH of them, since leaving one alone no longer
   *  moves the set — rebuilds the topology, and a rebuild landing mid-wave
   *  truncates the wave in flight.
   *  That is expected occasionally and it must not disturb this tally, so the
   *  count is taken at the instant the wave is armed and nothing ever looks
   *  back to see whether it finished crossing. */
  waves: number;
  /** …of which erupted from a node the chain attests. */
  attested: number;
  /** …of which fell back to the anonymous scatter. `attested + anonymous`
   *  is exactly `waves`: an origin is one or the other, and "anonymous" is
   *  everything that is not the chain's own name, including the degenerate
   *  scatter-less cases `pickOrigin` documents. */
  anonymous: number;
  /** Block pulses consumed WITHOUT a wave — a backfill catch-up, which is
   *  suppressed on purpose so a historical backlog cannot replay as one
   *  strobe. Counted separately so a probe can tell "nothing is arriving"
   *  from "everything is being replayed". */
  suppressed: number;
  /** producer key → waves that started at that producer's node. The oracle:
   *  divide by `waves` and compare against that producer's share of the
   *  window. Bounded by the distinct producers seen since the last reset, and
   *  the window turns over slowly. */
  byProducer: Record<string, number>;
  /** attested / waves, as a percentage. */
  attestedRatePct: number;
}

interface ProducerOriginStatsState {
  waves: number;
  attested: number;
  anonymous: number;
  suppressed: number;
  byProducer: Map<string, number>;
  /**
   * One armed wave, by the id the flood chose to enter through.
   *
   * The ENTRY ID and not the producer key the pulse carried, deliberately:
   * this measures where the scene actually started the wave, which is the only
   * thing a viewer can see and the only thing the oracle is about. The two
   * differ exactly when the chain named somebody the colony is standing no
   * node for, and that lands here as one more `anonymous` — which is what the
   * screen shows.
   */
  observeWave(entryId: string | null): void;
  /** One block pulse consumed with no wave behind it. */
  observeSuppressed(): void;
  snapshot(): ProducerOriginStatsSnapshot;
  reset(): void;
}

export const producerOriginStats: ProducerOriginStatsState = {
  waves: 0,
  attested: 0,
  anonymous: 0,
  suppressed: 0,
  byProducer: new Map<string, number>(),

  observeWave(entryId) {
    this.waves += 1;
    if (entryId === null || !entryId.startsWith(ATTESTED_ID_PREFIX)) {
      this.anonymous += 1;
      return;
    }
    this.attested += 1;
    const key = entryId.slice(ATTESTED_ID_PREFIX.length);
    this.byProducer.set(key, (this.byProducer.get(key) ?? 0) + 1);
  },

  observeSuppressed() {
    this.suppressed += 1;
  },

  snapshot() {
    return {
      waves: this.waves,
      attested: this.attested,
      anonymous: this.anonymous,
      suppressed: this.suppressed,
      byProducer: Object.fromEntries(this.byProducer),
      attestedRatePct: this.waves === 0 ? 0 : (this.attested / this.waves) * 100,
    };
  },

  reset() {
    this.waves = 0;
    this.attested = 0;
    this.anonymous = 0;
    this.suppressed = 0;
    this.byProducer = new Map<string, number>();
  },
};

export function snapshotProducerOriginStats(): ProducerOriginStatsSnapshot {
  return producerOriginStats.snapshot();
}
export function resetProducerOriginStats(): void {
  producerOriginStats.reset();
}
