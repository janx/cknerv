// Opt-in Canvas performance probe. The ordinary dashboard keeps this store
// disabled: writers return before allocating, reading the clock, or touching a
// typed array. RenderStatsSampler retains it only while GL·08 is mounted or a
// review URL explicitly enables `?render-stats=1`.

export const PERFORMANCE_PROBE_SCHEMA_VERSION = 1;
export const PERFORMANCE_PROBE_SAMPLE_CAPACITY = 512;
const PERFORMANCE_PROBE_LABEL_CAPACITY = 64;

/** Canonical names for the passes and CPU paths in the Canvas performance
 * contract. Registering a name does not manufacture a sample: an absent key in
 * a snapshot means the corresponding renderer has not installed a scope yet. */
export const PERFORMANCE_PROBE_LABELS = {
  frameInterval: 'frame.interval',
  populationPoints: 'population.points',
  populationResidualFibres: 'population.residual-fibres',
  populationBackboneCapsules: 'population.backbone-capsules',
  // Passive fabric is two physical draws; keep them separate so a mean is a
  // draw mean, not an accidental mixture whose sample count is 2× frames.
  passiveFabricBase: 'nerve.passive-fabric.base',
  passiveFabricTrunk: 'nerve.passive-fabric.trunk',
  activeRoute: 'nerve.active-route',
  memoryRoute: 'nerve.memory-route',
  neuralFabricEmit: 'cpu.neural-fabric.emit',
  recallAperture: 'cpu.neural-fabric.recall-aperture',
  cellNucleusLod: 'cpu.cell-nucleus.lod',
  activePulseFrame: 'cpu.neural-network.active-pulse-frame',
  cellFieldIngest: 'cpu.cell-field.ingest',
  topologyCommit: 'cpu.topology.commit',
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
let invalidSamples: Record<PerformanceProbeDomain, number> = {
  frame: 0,
  cpu: 0,
  gpu: 0,
};
let rejectedLabels: Record<PerformanceProbeDomain, number> = {
  frame: 0,
  cpu: 0,
  gpu: 0,
};
let gpuState: GpuProbeStateSnapshot = {
  availability: 'detached',
  reason: null,
  pendingQueries: 0,
  disjointEvents: 0,
  droppedQueries: 0,
  droppedByReason: zeroDropReasons(),
};

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
  gpuState = { ...gpuState, availability, reason };
}

export function setGpuProbePendingQueries(pendingQueries: number): void {
  gpuState = {
    ...gpuState,
    pendingQueries: Math.max(0, Math.floor(pendingQueries)),
  };
}

export function observeGpuProbeDisjointEvent(): void {
  gpuState = { ...gpuState, disjointEvents: gpuState.disjointEvents + 1 };
}

export function observeGpuProbeDrop(
  reason: GpuProbeDropReason,
  count = 1,
): void {
  if (count <= 0) return;
  gpuState = {
    ...gpuState,
    droppedQueries: gpuState.droppedQueries + count,
    droppedByReason: {
      ...gpuState.droppedByReason,
      [reason]: gpuState.droppedByReason[reason] + count,
    },
  };
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
  invalidSamples = { frame: 0, cpu: 0, gpu: 0 };
  rejectedLabels = { frame: 0, cpu: 0, gpu: 0 };
  gpuState = {
    ...gpuState,
    pendingQueries: 0,
    disjointEvents: 0,
    droppedQueries: 0,
    droppedByReason: zeroDropReasons(),
  };
  generation += 1;
  startedAtMs = nowMs;
}
