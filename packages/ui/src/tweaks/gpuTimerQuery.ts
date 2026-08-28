// WebGL2 timer-query core for the opt-in Canvas performance probe. Query
// results are asynchronous: draw hooks only begin/end a TIME_ELAPSED query,
// while RenderStatsSampler polls old queries on later frames. CPU wall time is
// never reported as GPU time.
//
// Two streams share the one query target and never share a frame. On a SCOPE
// frame every probed draw begins and ends its own query; on a BRACKET frame
// (every `GPU_FRAME_BRACKET_PERIOD`th one) the draw scopes stand down and one
// query runs from the pass's first probed draw to the scene's after-render
// hook — the whole pass, without the render-list build ahead of it. The
// sampler flips the mode before the frame renders (`advanceGpuProbeFrame`), so
// a scope that would nest inside a bracket is refused at the mode gate, never
// at the overlap counter — `droppedByReason.overlap` stays a genuine fault.

import {
  PERFORMANCE_PROBE_LABELS,
  getPerformanceProbeGeneration,
  gpuProbeFrameIndex,
  gpuProbeFrameMode,
  isPerformanceProbeEnabled,
  observeGpuFrameLedger,
  observeGpuProbeDisjointEvent,
  observeGpuProbeDrop,
  observePerformanceProbeSample,
  setGpuProbeAvailability,
  setGpuProbePendingQueries,
  type GpuProbeQueryKind,
  type PerformanceProbeLabel,
} from './performanceProbeStore';

export const GPU_TIMER_PENDING_CAPACITY = 64;
const EXTENSION_NAME = 'EXT_disjoint_timer_query_webgl2';

interface TimerQueryExtensionLike {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Structural WebGL2 subset so the core is unit-testable without a browser
 * context. WebGL1's EXT_disjoint_timer_query API is deliberately not accepted:
 * its extension-owned query methods are a different contract. */
interface TimerQueryContextLike {
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly QUERY_RESULT: number;
  getExtension(name: string): unknown;
  createQuery(): object | null;
  deleteQuery(query: object): void;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, pname: number): unknown;
  getParameter(pname: number): unknown;
  isContextLost?(): boolean;
}

interface PendingQuery {
  readonly label: PerformanceProbeLabel;
  readonly query: object;
  readonly generation: number;
  readonly kind: GpuProbeQueryKind;
  /** The sampled frame the query was begun in. */
  readonly frame: number;
}

export interface GpuProbeSpan {
  readonly label: PerformanceProbeLabel;
  readonly generation: number;
  /** Opaque identity used to reject cross-context/mismatched ends. */
  readonly owner: symbol;
  readonly query: object;
  readonly kind: GpuProbeQueryKind;
  readonly frame: number;
  ended: boolean;
}

function isTimerQueryExtension(value: unknown): value is TimerQueryExtensionLike {
  if (!value || typeof value !== 'object') return false;
  const ext = value as Partial<TimerQueryExtensionLike>;
  return Number.isFinite(ext.TIME_ELAPSED_EXT)
    && Number.isFinite(ext.GPU_DISJOINT_EXT);
}

function asTimerQueryContext(value: unknown): TimerQueryContextLike | null {
  if (!value || typeof value !== 'object') return null;
  const gl = value as Partial<TimerQueryContextLike>;
  if (
    !Number.isFinite(gl.QUERY_RESULT_AVAILABLE)
    || !Number.isFinite(gl.QUERY_RESULT)
    || typeof gl.getExtension !== 'function'
    || typeof gl.createQuery !== 'function'
    || typeof gl.deleteQuery !== 'function'
    || typeof gl.beginQuery !== 'function'
    || typeof gl.endQuery !== 'function'
    || typeof gl.getQueryParameter !== 'function'
    || typeof gl.getParameter !== 'function'
  ) return null;
  return gl as TimerQueryContextLike;
}

/** One context's non-overlapping TIME_ELAPSED query stream. WebGL permits only
 * one query for this target at a time, so an overlap is rejected and counted
 * instead of ending somebody else's scope.
 *
 * Query objects are POOLED: a query whose result has been read goes back on a
 * free list and the next scope begins on it, so a steady-state frame creates
 * and deletes nothing (a begin/end pair used to be a createQuery/deleteQuery
 * pair per probed draw). Only queries whose result was never read — a
 * disjoint discard, a reset, a read failure — are retired rather than reused,
 * so a recycled object is always one the driver has finished with. */
export class GpuTimerQueryCore {
  private readonly owner = Symbol('cknerv-gpu-timer');

  private readonly pending: PendingQuery[] = [];

  private readonly free: object[] = [];

  private active: GpuProbeSpan | null = null;

  private generation = getPerformanceProbeGeneration();

  private disposed = false;

  constructor(
    private readonly gl: TimerQueryContextLike,
    private readonly extension: TimerQueryExtensionLike,
    private readonly pendingCapacity = GPU_TIMER_PENDING_CAPACITY,
  ) {}

  /** Recycled query objects waiting for their next scope. */
  get pooledQueryCount(): number {
    return this.free.length;
  }

  begin(
    label: PerformanceProbeLabel,
    kind: GpuProbeQueryKind = 'scope',
  ): GpuProbeSpan | null {
    if (this.disposed || !isPerformanceProbeEnabled()) return null;
    this.syncGeneration();
    if (this.contextLost()) {
      this.markContextLost();
      return null;
    }
    if (this.active) {
      observeGpuProbeDrop('overlap');
      return null;
    }
    if (this.pending.length >= this.pendingCapacity) {
      observeGpuProbeDrop('capacity');
      return null;
    }
    let query: object | null = this.free.pop() ?? null;
    try {
      if (query === null) query = this.gl.createQuery();
      if (query) this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    } catch {
      // createQuery may have succeeded before beginQuery rejected the scope
      // (driver error, transient context state). Retire that handle here —
      // pooled or fresh — it never reaches active/pending ownership, so no
      // later cleanup can see it.
      if (query) this.safeDelete(query);
      query = null;
    }
    if (!query) {
      observeGpuProbeDrop('create-failed');
      return null;
    }
    const span: GpuProbeSpan = {
      label,
      generation: this.generation,
      owner: this.owner,
      query,
      kind,
      frame: gpuProbeFrameIndex(),
      ended: false,
    };
    this.active = span;
    return span;
  }

  end(span: GpuProbeSpan | null): boolean {
    if (!span || span.ended || this.disposed) return false;
    if (span.owner !== this.owner || this.active !== span) {
      span.ended = true;
      observeGpuProbeDrop('mismatched-end');
      return false;
    }
    span.ended = true;
    try {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    } catch {
      this.safeDelete(span.query);
      this.active = null;
      observeGpuProbeDrop('read-failed');
      return false;
    }
    this.active = null;
    this.pending.push({
      label: span.label,
      query: span.query,
      generation: span.generation,
      kind: span.kind,
      frame: span.frame,
    });
    setGpuProbePendingQueries(this.pending.length);
    return true;
  }

  /** Resolve every ready query in FIFO order. One unavailable head stops the
   * walk: later draws cannot complete before an earlier draw on the same GL
   * command stream, and avoiding N availability reads matters on a profiler. */
  poll(): void {
    if (this.disposed || !isPerformanceProbeEnabled()) return;
    this.syncGeneration();
    if (this.contextLost()) {
      this.markContextLost();
      return;
    }
    let disjoint = false;
    try {
      disjoint = Boolean(this.gl.getParameter(this.extension.GPU_DISJOINT_EXT));
    } catch {
      this.discardPending('read-failed');
      return;
    }
    if (disjoint) {
      observeGpuProbeDisjointEvent();
      this.discardPending('disjoint');
      return;
    }

    while (this.pending.length > 0) {
      const head = this.pending[0];
      let available: boolean;
      try {
        available = Boolean(this.gl.getQueryParameter(
          head.query,
          this.gl.QUERY_RESULT_AVAILABLE,
        ));
      } catch {
        this.pending.shift();
        this.safeDelete(head.query);
        observeGpuProbeDrop('read-failed');
        continue;
      }
      if (!available) break;

      this.pending.shift();
      let elapsedNs: unknown;
      try {
        elapsedNs = this.gl.getQueryParameter(head.query, this.gl.QUERY_RESULT);
      } catch {
        this.safeDelete(head.query);
        observeGpuProbeDrop('read-failed');
        continue;
      }
      this.recycle(head.query);
      if (typeof elapsedNs !== 'number' || !Number.isFinite(elapsedNs) || elapsedNs < 0) {
        observeGpuProbeDrop('invalid-result');
        continue;
      }
      const elapsedMs = elapsedNs / 1_000_000;
      const observed = observePerformanceProbeSample(
        head.kind === 'bracket' ? 'frame' : 'gpu',
        head.label,
        elapsedMs,
        head.generation,
      );
      if (observed) observeGpuFrameLedger(head.kind, head.frame, elapsedMs);
    }
    setGpuProbePendingQueries(this.pending.length);
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.active) {
      try {
        this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      } catch {
        // Context teardown can make the matching end fail; deletion below is
        // still best-effort and the probe must never break app cleanup.
      }
      this.safeDelete(this.active.query);
      this.active.ended = true;
      this.active = null;
    }
    for (const pending of this.pending) this.safeDelete(pending.query);
    this.pending.length = 0;
    for (const query of this.free) this.safeDelete(query);
    this.free.length = 0;
    setGpuProbePendingQueries(0);
    this.disposed = true;
  }

  private recycle(query: object): void {
    // The pool never needs more than one frame's worth: at most
    // `pendingCapacity` results are ever outstanding.
    if (this.free.length < this.pendingCapacity) this.free.push(query);
    else this.safeDelete(query);
  }

  private syncGeneration(): void {
    const current = getPerformanceProbeGeneration();
    if (current === this.generation) return;
    // A reset promises a clean baseline. Retire queries from the old session
    // immediately rather than letting their delayed results cross the reset.
    if (this.active) {
      try {
        this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      } catch {
        // Best effort; see dispose().
      }
      this.safeDelete(this.active.query);
      this.active.ended = true;
      this.active = null;
    }
    for (const pending of this.pending) this.safeDelete(pending.query);
    this.pending.length = 0;
    setGpuProbePendingQueries(0);
    this.generation = current;
  }

  private contextLost(): boolean {
    try {
      return this.gl.isContextLost?.() ?? false;
    } catch {
      return true;
    }
  }

  private markContextLost(): void {
    const dropped = this.pending.length + (this.active ? 1 : 0);
    if (dropped > 0) observeGpuProbeDrop('context-lost', dropped);
    if (this.active) {
      this.active.ended = true;
      this.active = null;
    }
    this.pending.length = 0;
    // Every query object died with the context; there is nothing to delete
    // and nothing worth keeping.
    this.free.length = 0;
    setGpuProbePendingQueries(0);
    setGpuProbeAvailability('context-lost', 'webgl-context-lost');
  }

  private discardPending(reason: 'disjoint' | 'read-failed'): void {
    if (this.pending.length > 0) observeGpuProbeDrop(reason, this.pending.length);
    for (const pending of this.pending) this.safeDelete(pending.query);
    this.pending.length = 0;
    setGpuProbePendingQueries(0);
  }

  private safeDelete(query: object): void {
    try {
      this.gl.deleteQuery(query);
    } catch {
      // Query cleanup is diagnostic-only and must not disturb the renderer.
    }
  }
}

/** Create the WebGL2 core, or publish an honest unsupported state. Merely
 * lacking the extension produces no made-up wall-clock substitute. */
export function createGpuTimerQueryCore(
  context: unknown,
  pendingCapacity = GPU_TIMER_PENDING_CAPACITY,
): GpuTimerQueryCore | null {
  const gl = asTimerQueryContext(context);
  if (!gl) {
    setGpuProbeAvailability('unsupported', 'webgl2-timer-query-api-unavailable');
    return null;
  }
  let extension: unknown;
  try {
    extension = gl.getExtension(EXTENSION_NAME);
  } catch {
    extension = null;
  }
  if (!isTimerQueryExtension(extension)) {
    setGpuProbeAvailability('unsupported', `${EXTENSION_NAME}-unavailable`);
    return null;
  }
  setGpuProbeAvailability('ready');
  setGpuProbePendingQueries(0);
  return new GpuTimerQueryCore(gl, extension, Math.max(1, pendingCapacity));
}

interface CoreLease {
  readonly identity: symbol;
  readonly core: GpuTimerQueryCore | null;
}

let currentLease: CoreLease | null = null;

/** RenderStatsSampler owns the context lease. The extension is requested only
 * after the probe is enabled, so the default production path does not even
 * perform capability detection. */
export function attachGpuTimerQueryContext(context: unknown): () => void {
  currentLease?.core?.dispose();
  const lease: CoreLease = {
    identity: Symbol('cknerv-gpu-context'),
    core: createGpuTimerQueryCore(context),
  };
  currentLease = lease;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (currentLease?.identity !== lease.identity) return;
    lease.core?.dispose();
    currentLease = null;
    setGpuProbeAvailability('detached');
  };
}

export function pollGpuTimerQueries(): void {
  currentLease?.core?.poll();
}

/** The scene pass in progress, as the scene's render hooks report it: whether
 * one is open, whether its first probed draw has tried to open the bracket,
 * and the bracket it opened. */
let bracketWindowOpen = false;
let bracketAttempted = false;
let frameBracket: GpuProbeSpan | null = null;

/** A per-draw scope. Null — before any clock or GL call — when the probe is
 * off. On a bracket frame the draw scopes stand down, and the FIRST probed
 * draw of the pass opens the frame bracket instead: the query then starts at
 * the first draw command rather than at the render-list build ahead of it,
 * where an idle GPU would otherwise sit waiting inside the measurement and
 * read as draw cost nobody can attribute. */
export function beginGpuProbe(label: PerformanceProbeLabel): GpuProbeSpan | null {
  if (!isPerformanceProbeEnabled()) return null;
  if (gpuProbeFrameMode() === 'bracket') {
    if (bracketWindowOpen && !bracketAttempted) {
      bracketAttempted = true;
      frameBracket = beginGpuFrameBracket();
    }
    return null;
  }
  return currentLease?.core?.begin(label, 'scope') ?? null;
}

export function endGpuProbe(span: GpuProbeSpan | null): boolean {
  if (!span) return false;
  return currentLease?.core?.end(span) ?? false;
}

/** The whole-scene bracket's query. Null off, and on scope frames, where the
 * draws own the target. `beginGpuProbe` opens it from the pass's first probed
 * draw; a caller driving the core by hand may open it directly. */
export function beginGpuFrameBracket(): GpuProbeSpan | null {
  if (!isPerformanceProbeEnabled() || gpuProbeFrameMode() !== 'bracket') return null;
  return currentLease?.core?.begin(PERFORMANCE_PROBE_LABELS.frameGpu, 'bracket') ?? null;
}

export function endGpuFrameBracket(span: GpuProbeSpan | null): boolean {
  return endGpuProbe(span);
}

/** The scene's before-render hook: a pass has begun, its bracket unopened. */
export function openGpuFrameBracketWindow(): void {
  bracketWindowOpen = true;
  bracketAttempted = false;
}

/** The scene's after-render hook: the pass has ended after its last draw, so
 * the bracket its first probed draw opened ends here. A pass that drew
 * nothing probed opened none, and there is nothing to end. */
export function closeGpuFrameBracketWindow(): void {
  bracketWindowOpen = false;
  if (frameBracket === null) return;
  endGpuFrameBracket(frameBracket);
  frameBracket = null;
}

/** Stable object-render callbacks for a single draw. Three already invokes an
 * Object3D's before/after hooks around every draw; when the probe is disabled
 * these callbacks add only a boolean gate and create no token. */
export function createGpuProbeCallbacks(label: PerformanceProbeLabel): {
  onBeforeRender: () => void;
  onAfterRender: () => void;
} {
  let span: GpuProbeSpan | null = null;
  return {
    onBeforeRender: () => { span = beginGpuProbe(label); },
    onAfterRender: () => {
      endGpuProbe(span);
      span = null;
    },
  };
}

type RenderHookArgs = readonly unknown[];

/** The two hooks three calls around a whole `render(scene, camera)` pass —
 * `Scene.onBeforeRender` / `Scene.onAfterRender` — typed loosely so the
 * bracket neither imports three nor pins the hook signatures. */
export interface RenderHookOwner {
  onBeforeRender(...args: RenderHookArgs): void;
  onAfterRender(...args: RenderHookArgs): void;
}

/** Wrap a scene's render hooks around the frame bracket. Three fires them once
 * per `render()` call — before the render list is built and after the last
 * draw — so the window they open spans every draw of that pass and nothing
 * else; the bracket itself opens at the pass's first probed draw (see
 * `beginGpuProbe`). The hooks the owner already had keep running; the
 * returned detach restores them.
 *
 * Fixed parameters rather than a rest list: three hands the scene hooks four
 * and three arguments, a rest parameter would materialise an array on every
 * frame, and these hooks must cost nothing while the probe is off. */
export function attachGpuFrameBracket(owner: RenderHookOwner): () => void {
  const previousBefore = owner.onBeforeRender;
  const previousAfter = owner.onAfterRender;
  const bracketBefore = function bracketBefore(
    this: RenderHookOwner,
    renderer?: unknown,
    scene?: unknown,
    camera?: unknown,
    renderTarget?: unknown,
  ): void {
    previousBefore.call(this, renderer, scene, camera, renderTarget);
    openGpuFrameBracketWindow();
  };
  const bracketAfter = function bracketAfter(
    this: RenderHookOwner,
    renderer?: unknown,
    scene?: unknown,
    camera?: unknown,
  ): void {
    closeGpuFrameBracketWindow();
    previousAfter.call(this, renderer, scene, camera);
  };
  owner.onBeforeRender = bracketBefore;
  owner.onAfterRender = bracketAfter;
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    closeGpuFrameBracketWindow();
    // Restore only what is still ours: a hook somebody replaced meanwhile is
    // theirs to keep.
    if (owner.onBeforeRender === bracketBefore) owner.onBeforeRender = previousBefore;
    if (owner.onAfterRender === bracketAfter) owner.onAfterRender = previousAfter;
  };
}
