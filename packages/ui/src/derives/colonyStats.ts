// Dev instrumentation: how often the P2P colony REBUILDS. Pure module
// singleton — the `producerOriginStats` idiom next door: mutated directly by
// the derives and the layers, read by a snapshot, reset by a probe or a test,
// always on (one integer increment per rebuild, which is one increment per
// peer change, crawl round or block). The WINDOW hook that surfaces it lives
// in ui-app, so the library stays free of `window` coupling.
//
// ⭐ IT EXISTS BECAUSE THE REBUILD CASCADE HAD NO OBSERVABLE. `peersSig` gates
// the topology memo, the scaffold cache gates the O(V² log V) scatter behind
// it, and every layer below — the edge geometry, the courier schedule, the
// delivery plan — re-derives on the topology's identity. How often each of
// those actually fires on a live roster was a guess, and the review that
// asked (2026-08-28, F-P3 "colony rebuild cascade") could only write
// "frequency unmeasurable today". Reset, wait out a few polls and blocks, and
// read: `topologyBuilds` against `scaffoldMisses` says how much of the
// rebuilding is the cheap overlay and how much the expensive scatter, and the
// three layer counters say what each topology rebuild dragged with it.
//
// ⚠️ Under React StrictMode (development only) memo initialisers run twice
// per mount, so the layer counters read double there; production is exact.

export interface ColonyStatsSnapshot {
  /** `inferredTopology` runs: the App memo re-keyed (a peer content change,
   *  a crawl round, a producer key-set change, a local-node change). */
  topologyBuilds: number;
  /** …of which reused the cached ghost scaffold — the cheap overlay path. */
  scaffoldHits: number;
  /** …of which rebuilt it: the rejection-sampled scatter plus a kNN sort per
   *  node, 5–10 ms at the default population. */
  scaffoldMisses: number;
  /** `colonyFlood` runs: once per block pulse AND once per topology rebuild
   *  (the flood is keyed on both). */
  floods: number;
  /** `ColonyEdges` rebuilt its seven-attribute line geometry — a GPU buffer
   *  delete/alloc/upload — which it does on every topology identity. */
  edgeGeometryBuilds: number;
  /** `ColonyCourierLayer` re-planned the tree throws (flood or positions). */
  courierSchedules: number;
  /** `BlockDeliveryLayer` re-planned its carriers (positions or arrivals). */
  deliveryPlans: number;
}

interface ColonyStatsState extends ColonyStatsSnapshot {
  observeTopologyBuild(): void;
  observeScaffold(hit: boolean): void;
  observeFlood(): void;
  observeEdgeGeometryBuild(): void;
  observeCourierSchedule(): void;
  observeDeliveryPlan(): void;
  snapshot(): ColonyStatsSnapshot;
  reset(): void;
}

export const colonyStats: ColonyStatsState = {
  topologyBuilds: 0,
  scaffoldHits: 0,
  scaffoldMisses: 0,
  floods: 0,
  edgeGeometryBuilds: 0,
  courierSchedules: 0,
  deliveryPlans: 0,

  observeTopologyBuild() {
    this.topologyBuilds += 1;
  },
  observeScaffold(hit) {
    if (hit) this.scaffoldHits += 1;
    else this.scaffoldMisses += 1;
  },
  observeFlood() {
    this.floods += 1;
  },
  observeEdgeGeometryBuild() {
    this.edgeGeometryBuilds += 1;
  },
  observeCourierSchedule() {
    this.courierSchedules += 1;
  },
  observeDeliveryPlan() {
    this.deliveryPlans += 1;
  },

  snapshot() {
    return {
      topologyBuilds: this.topologyBuilds,
      scaffoldHits: this.scaffoldHits,
      scaffoldMisses: this.scaffoldMisses,
      floods: this.floods,
      edgeGeometryBuilds: this.edgeGeometryBuilds,
      courierSchedules: this.courierSchedules,
      deliveryPlans: this.deliveryPlans,
    };
  },

  reset() {
    this.topologyBuilds = 0;
    this.scaffoldHits = 0;
    this.scaffoldMisses = 0;
    this.floods = 0;
    this.edgeGeometryBuilds = 0;
    this.courierSchedules = 0;
    this.deliveryPlans = 0;
  },
};

export function snapshotColonyStats(): ColonyStatsSnapshot {
  return colonyStats.snapshot();
}
export function resetColonyStats(): void {
  colonyStats.reset();
}
