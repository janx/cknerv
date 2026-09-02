// Opt-in Canvas performance probe. The ordinary dashboard keeps this store
// disabled: writers return before allocating, reading the clock, or touching a
// typed array. RenderStatsSampler retains it only while GL·08 is mounted or a
// review URL explicitly enables `?render-stats=1`.

export const PERFORMANCE_PROBE_SCHEMA_VERSION = 2;
export const PERFORMANCE_PROBE_SAMPLE_CAPACITY = 512;
const PERFORMANCE_PROBE_LABEL_CAPACITY = 64;

/** Every Nth sampled frame is a BRACKET frame: the per-draw GPU scopes stand
 * down and one TIME_ELAPSED query wraps the whole scene pass instead (see
 * `gpuTimerQuery`). WebGL allows one query of that target at a time, so the
 * two can never share a frame; alternating them samples both streams from the
 * same steady state, and the difference between them is the GPU time no scope
 * accounts for. */
export const GPU_FRAME_BRACKET_PERIOD = 2;

/** Canonical names for the passes and CPU paths in the Canvas performance
 * contract. Registering a name does not manufacture a sample: an absent key in
 * a snapshot means the corresponding renderer has not installed a scope yet.
 *
 * GPU labels are one physical draw each — a mean is a draw mean, never a
 * mixture whose sample count is some multiple of frames — and every one of
 * them lives in the `gpu` domain. `frameGpu` is the exception: the whole
 * scene pass, sampled on bracket frames and filed in the `frame` domain, so
 * Σ over `gpu` is exactly the scoped total. */
export const PERFORMANCE_PROBE_LABELS = {
  frameInterval: 'frame.interval',
  frameGpu: 'frame.gpu',
  populationPoints: 'population.points',
  populationResidualFibres: 'population.residual-fibres',
  populationBackboneCapsules: 'population.backbone-capsules',
  cellBody: 'cell.body',
  cellFlare: 'cell.flare',
  cellNucleusGlow: 'cell.nucleus.glow',
  cellNucleusCore: 'cell.nucleus.core',
  cellNucleusNodes: 'cell.nucleus.nodes',
  // Passive fabric is two physical draws; keep them separate so a mean is a
  // draw mean, not an accidental mixture whose sample count is 2× frames.
  passiveFabricBase: 'nerve.passive-fabric.base',
  passiveFabricTrunk: 'nerve.passive-fabric.trunk',
  activeRoute: 'nerve.active-route',
  memoryRoute: 'nerve.memory-route',
  bridgeNerves: 'nerve.bridge',
  colonyHaze: 'colony.cloud.haze',
  colonyCloudAdvertised: 'colony.cloud.advertised',
  colonyCloudRemembered: 'colony.cloud.remembered',
  colonyCloudReached: 'colony.cloud.reached',
  colonyMeasuredHalos: 'colony.measured-halos',
  colonyEdges: 'colony.edges',
  colonyCohortFace: 'colony.cohort.face',
  colonyCohortAura: 'colony.cohort.aura',
  // The substance under the plane, priced apart from the mark in it: one
  // instanced draw per cohort whose cost is its two back-traces. ⚠️ There was a
  // `colony.mist.haze` beside it until 2026-09-02, for the ambient sheets under
  // the whole colony; this label is what measured them out — 0.90 ms of the
  // layer's 1.06 ms at the app camera for a draw whose own brightest pixel
  // anywhere reached 2/255 — and they were removed. Do not add it back without
  // a new reading that says a viewer can see a sheet.
  colonyMistPatch: 'colony.mist.patch',
  colonyCourierPlume: 'colony.courier.plume',
  colonyCourierBloom: 'colony.courier.bloom',
  deliveryBody: 'delivery.body',
  deliveryCore: 'delivery.core',
  deliveryTrail: 'delivery.trail',
  deliveryWave: 'delivery.wave',
  stars: 'stars',
  neuralFabricEmit: 'cpu.neural-fabric.emit',
  recallAperture: 'cpu.neural-fabric.recall-aperture',
  cellNucleusLod: 'cpu.cell-nucleus.lod',
  activePulseFrame: 'cpu.neural-network.active-pulse-frame',
  livePlanSlice: 'cpu.neural-network.live-plan-slice',
  syncDisplayFabric: 'cpu.neural-network.sync-display-fabric',
  fabricCommit: 'cpu.neural-network.fabric-commit',
  cellFieldIngest: 'cpu.cell-field.ingest',
  cellsCacheApply: 'cpu.cells-cache.apply-deltas',
  topologyCommit: 'cpu.topology.commit',
  bridgeHostsSync: 'cpu.bridge.sync-hosts',
  bridgeSelect: 'cpu.bridge.select',
  colonyTopology: 'cpu.colony.topology',
  colonyFlood: 'cpu.colony.flood',
} as const;

export type PerformanceProbeLabel = string;
export type PerformanceProbeDomain = 'frame' | 'cpu' | 'gpu';

export interface PerformanceProbeMetricSummary {
  /** Total valid observations since reset. */
  count: number;
  /** Samples retained for percentile calculation (last 512 at most). */
  retained: number;
  /** All-time arithmetic mean since reset. */
  meanMs: number;
  /** Percentiles over the bounded, most-recent sample window. */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** All-time maximum since reset. */
  maxMs: number;
  lastMs: number;
}

export type GpuProbeAvailability =
  | 'detached'
  | 'ready'
  | 'unsupported'
  | 'context-lost';

export type GpuProbeDropReason =
  | 'create-failed'
  | 'overlap'
  | 'capacity'
  | 'mismatched-end'
  | 'disjoint'
  | 'context-lost'
  | 'invalid-result'
  | 'read-failed';

export interface GpuProbeStateSnapshot {
  availability: GpuProbeAvailability;
  reason: string | null;
  pendingQueries: number;
  disjointEvents: number;
  droppedQueries: number;
  droppedByReason: Record<GpuProbeDropReason, number>;
}

/** Which of the two mutually exclusive query streams a sampled frame carries. */
export type GpuProbeFrameMode = 'scopes' | 'bracket';
/** What one TIME_ELAPSED query measured: a single draw or the scene pass. */
export type GpuProbeQueryKind = 'scope' | 'bracket';

/** Running totals behind the "unscoped remainder" reading. Both streams are
 * ms per frame OF THEIR OWN KIND: `bracketMs / bracketFrames` is the scene
 * pass, `scopedMs / scopeFrames` is Σ of the per-draw scopes over the frames
 * that carried them — divided by frames, not by samples, so a draw that is
 * only sometimes non-empty is weighed exactly as often as it drew. */
export interface GpuFrameLedgerSnapshot {
  /** Sampled frames so far, both kinds, and what the current one carries. */
  frames: number;
  mode: GpuProbeFrameMode;
  bracketPeriod: number;
  bracketMs: number;
  bracketFrames: number;
  scopedMs: number;
  /** Distinct scope frames that resolved at least one scope. */
  scopeFrames: number;
}

export interface PerformanceProbeSnapshot {
  schemaVersion: typeof PERFORMANCE_PROBE_SCHEMA_VERSION;
  enabled: boolean;
  startedAtMs: number | null;
  capturedAtMs: number;
  sampleCapacity: typeof PERFORMANCE_PROBE_SAMPLE_CAPACITY;
  invalidSamples: Record<PerformanceProbeDomain, number>;
  rejectedLabels: Record<PerformanceProbeDomain, number>;
  frame: Record<string, PerformanceProbeMetricSummary>;
  cpu: Record<string, PerformanceProbeMetricSummary>;
  gpu: {
    state: GpuProbeStateSnapshot;
    frameLedger: GpuFrameLedgerSnapshot;
    metrics: Record<string, PerformanceProbeMetricSummary>;
  };
}

class MetricWindow {
  private readonly recent = new Float64Array(PERFORMANCE_PROBE_SAMPLE_CAPACITY);

  private writeAt = 0;

  private retained = 0;

  private count = 0;

  private totalMs = 0;

  private maxMs = 0;

  private lastMs = 0;

  observe(elapsedMs: number): void {
    this.recent[this.writeAt] = elapsedMs;
    this.writeAt = (this.writeAt + 1) % PERFORMANCE_PROBE_SAMPLE_CAPACITY;
    this.retained = Math.min(
      PERFORMANCE_PROBE_SAMPLE_CAPACITY,
      this.retained + 1,
    );
    this.count += 1;
    this.totalMs += elapsedMs;
    this.maxMs = Math.max(this.maxMs, elapsedMs);
    this.lastMs = elapsedMs;
  }

  snapshot(): PerformanceProbeMetricSummary {
    const values = Array.from(this.recent.subarray(0, this.retained));
    values.sort((a, b) => a - b);
    return {
      count: this.count,
      retained: this.retained,
      meanMs: this.count > 0 ? this.totalMs / this.count : 0,
      p50Ms: quantile(values, 0.5),
      p95Ms: quantile(values, 0.95),
      p99Ms: quantile(values, 0.99),
      maxMs: this.maxMs,
      lastMs: this.lastMs,
    };
  }
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function zeroDropReasons(): Record<GpuProbeDropReason, number> {
  return {
    'create-failed': 0,
    overlap: 0,
    capacity: 0,
    'mismatched-end': 0,
    disjoint: 0,
    'context-lost': 0,
    'invalid-result': 0,
    'read-failed': 0,
  };
}

const metrics: Record<PerformanceProbeDomain, Map<string, MetricWindow>> = {
  frame: new Map(),
  cpu: new Map(),
  gpu: new Map(),
};
let demand = 0;
let startedAtMs: number | null = null;
let generation = 0;
const invalidSamples: Record<PerformanceProbeDomain, number> = {
  frame: 0,
  cpu: 0,
  gpu: 0,
};
const rejectedLabels: Record<PerformanceProbeDomain, number> = {
  frame: 0,
  cpu: 0,
  gpu: 0,
};
// Mutable fields, mutated in place: the GPU core reports a pending count on
// every end() and poll(), and spreading a fresh record for each of those was
// a per-draw allocation on the ON path. Snapshots copy on the way out.
const gpuState: GpuProbeStateSnapshot = {
  availability: 'detached',
  reason: null,
  pendingQueries: 0,
  disjointEvents: 0,
  droppedQueries: 0,
  droppedByReason: zeroDropReasons(),
};
const frameLedger: GpuFrameLedgerSnapshot = {
  frames: 0,
  mode: 'scopes',
  bracketPeriod: GPU_FRAME_BRACKET_PERIOD,
  bracketMs: 0,
  bracketFrames: 0,
  scopedMs: 0,
  scopeFrames: 0,
};
/** The last frame index a resolved scope was counted for, so a frame with
 * many scopes is one scope frame. */
let lastScopeFrame = -1;

function probeNowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function validLabel(label: string): boolean {
  return label.length > 0 && label.length <= 96;
}

function snapshotMetrics(
  source: ReadonlyMap<string, MetricWindow>,
): Record<string, PerformanceProbeMetricSummary> {
  const entries = [...source.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, metric]) => [label, metric.snapshot()] as const);
  return Object.fromEntries(entries);
}

/** Retain the expensive probe path. Ref-counting keeps StrictMode and multiple
 * mounted readers from disabling each other. The returned release is
 * idempotent. Samples remain available after release until explicitly reset. */
export function retainPerformanceProbe(): () => void {
  if (demand === 0 && startedAtMs === null) startedAtMs = probeNowMs();
  demand += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    demand = Math.max(0, demand - 1);
  };
}

export function isPerformanceProbeEnabled(): boolean {
  return demand > 0;
}

/** Session generation lets asynchronous GPU results and CPU spans that began
 * before a reset be discarded instead of contaminating the new baseline. */
export function getPerformanceProbeGeneration(): number {
  return generation;
}

/** Record one measured duration. This is the single hot-path gate: disabled
 * calls return before validating a label or allocating a MetricWindow. */
export function observePerformanceProbeSample(
  domain: PerformanceProbeDomain,
  label: PerformanceProbeLabel,
  elapsedMs: number,
  sampleGeneration = generation,
): boolean {
  if (demand === 0 || sampleGeneration !== generation) return false;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    invalidSamples[domain] += 1;
    return false;
  }
  const domainMetrics = metrics[domain];
  let metric = domainMetrics.get(label);
  if (!metric) {
    if (!validLabel(label) || domainMetrics.size >= PERFORMANCE_PROBE_LABEL_CAPACITY) {
      rejectedLabels[domain] += 1;
      return false;
    }
    metric = new MetricWindow();
    domainMetrics.set(label, metric);
  }
  metric.observe(elapsedMs);
  return true;
}

export interface CpuProbeSpan {
  readonly label: PerformanceProbeLabel;
  readonly startedAtMs: number;
  readonly generation: number;
  ended: boolean;
}

/** Begin/end is used instead of a callback wrapper on per-frame paths so the
 * caller need not allocate a closure. No span object or clock read occurs when
 * the probe is disabled. */
export function beginCpuProbe(
  label: PerformanceProbeLabel,
  nowMs?: number,
): CpuProbeSpan | null {
  if (demand === 0) return null;
  return {
    label,
    startedAtMs: nowMs ?? probeNowMs(),
    generation,
    ended: false,
  };
}

export function endCpuProbe(span: CpuProbeSpan | null, nowMs?: number): boolean {
  if (!span || span.ended) return false;
  span.ended = true;
  const endedAtMs = nowMs ?? probeNowMs();
  return observePerformanceProbeSample(
    'cpu',
    span.label,
    endedAtMs - span.startedAtMs,
    span.generation,
  );
}

/** Convenient for non-frame work. Exceptions propagate after the duration is
 * recorded, matching a `try/finally` at the call site. */
export function measureCpuProbe<T>(
  label: PerformanceProbeLabel,
  work: () => T,
): T {
  if (demand === 0) return work();
  const span = beginCpuProbe(label);
  try {
    return work();
  } finally {
    endCpuProbe(span);
  }
}

export function setGpuProbeAvailability(
  availability: GpuProbeAvailability,
  reason: string | null = null,
): void {
  gpuState.availability = availability;
  gpuState.reason = reason;
}

export function setGpuProbePendingQueries(pendingQueries: number): void {
  gpuState.pendingQueries = Math.max(0, Math.floor(pendingQueries));
}

export function observeGpuProbeDisjointEvent(): void {
  gpuState.disjointEvents += 1;
}

export function observeGpuProbeDrop(
  reason: GpuProbeDropReason,
  count = 1,
): void {
  if (count <= 0) return;
  gpuState.droppedQueries += count;
  gpuState.droppedByReason[reason] += count;
}

/** Called once per rendered frame by the sampler, BEFORE the frame's draws,
 * so every query begun in that frame knows which stream it belongs to. Inert
 * while disabled: the mode stays `scopes` and nothing counts. */
export function advanceGpuProbeFrame(): GpuProbeFrameMode {
  if (demand === 0) return frameLedger.mode;
  frameLedger.frames += 1;
  frameLedger.mode = frameLedger.frames % GPU_FRAME_BRACKET_PERIOD === 0
    ? 'bracket'
    : 'scopes';
  return frameLedger.mode;
}

export function gpuProbeFrameMode(): GpuProbeFrameMode {
  return frameLedger.mode;
}

/** Index of the frame currently being sampled; queries carry it so a resolved
 * scope can be attributed to the frame that drew it. */
export function gpuProbeFrameIndex(): number {
  return frameLedger.frames;
}

/** One resolved TIME_ELAPSED result, after the metric window accepted it. */
export function observeGpuFrameLedger(
  kind: GpuProbeQueryKind,
  frame: number,
  elapsedMs: number,
): void {
  if (kind === 'bracket') {
    frameLedger.bracketMs += elapsedMs;
    frameLedger.bracketFrames += 1;
    return;
  }
  frameLedger.scopedMs += elapsedMs;
  if (frame !== lastScopeFrame) {
    lastScopeFrame = frame;
    frameLedger.scopeFrames += 1;
  }
}

/** The live ledger, by reference: the sampler differences four numbers per
 * window and must not be handed a fresh object to do it. Read-only. */
export function readGpuFrameLedger(): Readonly<GpuFrameLedgerSnapshot> {
  return frameLedger;
}

export function snapshotPerformanceProbe(): PerformanceProbeSnapshot {
  return {
    schemaVersion: PERFORMANCE_PROBE_SCHEMA_VERSION,
    enabled: demand > 0,
    startedAtMs,
    capturedAtMs: probeNowMs(),
    sampleCapacity: PERFORMANCE_PROBE_SAMPLE_CAPACITY,
    invalidSamples: { ...invalidSamples },
    rejectedLabels: { ...rejectedLabels },
    frame: snapshotMetrics(metrics.frame),
    cpu: snapshotMetrics(metrics.cpu),
    gpu: {
      state: {
        ...gpuState,
        droppedByReason: { ...gpuState.droppedByReason },
      },
      frameLedger: { ...frameLedger },
      metrics: snapshotMetrics(metrics.gpu),
    },
  };
}

/** A directly downloadable/clipboard-safe representation for review scripts.
 * The schema version and bounded-window metadata travel with the samples. */
export function exportPerformanceProbeJson(space = 2): string {
  return JSON.stringify(snapshotPerformanceProbe(), null, space);
}

/** Start a clean measurement session without changing whether it is enabled. */
export function resetPerformanceProbe(nowMs = probeNowMs()): void {
  metrics.frame.clear();
  metrics.cpu.clear();
  metrics.gpu.clear();
  invalidSamples.frame = 0;
  invalidSamples.cpu = 0;
  invalidSamples.gpu = 0;
  rejectedLabels.frame = 0;
  rejectedLabels.cpu = 0;
  rejectedLabels.gpu = 0;
  gpuState.pendingQueries = 0;
  gpuState.disjointEvents = 0;
  gpuState.droppedQueries = 0;
  gpuState.droppedByReason = zeroDropReasons();
  frameLedger.frames = 0;
  frameLedger.mode = 'scopes';
  frameLedger.bracketMs = 0;
  frameLedger.bracketFrames = 0;
  frameLedger.scopedMs = 0;
  frameLedger.scopeFrames = 0;
  lastScopeFrame = -1;
  generation += 1;
  startedAtMs = nowMs;
}
