import {
  buildNeighborGraph,
  buildNeighborGraphSteps,
  type LivingNeighborGraph,
  type NeighborEdge,
  type NeighborGraphCell,
  type NeighborGraphCells,
  type NeighborGraphOptions,
  type PassiveSelection,
} from './neighborGraph';
import {
  buildPassiveNeighborGraph,
  buildPassiveNeighborGraphSteps,
} from './passiveNeighborGraph';
import {
  PACKED_TOPOLOGY_CELL_STRIDE,
  applyNeighborAdjacencyPatch,
  applyPassiveSelectionPatch,
  collectPassiveSelectionPatch,
  deserializeLivingNeighborGraphInto,
  deserializePassiveSelection,
  packPreferredEdges,
  packTopologyCells,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from './neighborGraphWorkerProtocol';
import { neighborGraphBuilderStats } from './neighborGraphBuilderStats';
import { blockFrameStats } from '../nerve/blockFrameStats';
import { onFrameBudgetOpened } from '../nerve/frameBudget';
import {
  PERFORMANCE_PROBE_LABELS,
  beginCpuProbe,
  endCpuProbe,
} from '../tweaks/performanceProbeStore';

/** Dev-observable counters for paths that used to fail silently. They live in
 * their own module so the fabric's window hook can carry them without pulling
 * in the worker factory; re-exported here under the name the builder's
 * readers and tests have always used. */
export { neighborGraphBuilderStats } from './neighborGraphBuilderStats';

export const DEFAULT_TOPOLOGY_WORKER_MIN_CELLS = 512;

/** Watchdog for the single in-flight request. A worker killed silently (the
 * browser reclaiming memory) answers nothing, and the coalesced-send gate
 * turns that one lost response into a frozen topology for the rest of the
 * session — every later build waits in the queued slot forever. Generous by
 * design: even a 50K full pack on a slow machine is seconds, never half a
 * minute, so this only ever fires on a worker that is gone. */
export const TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS = 30_000;

let workerFallbackWarned = false;

function noteWorkerFallback(reason: unknown): void {
  neighborGraphBuilderStats.workerFallbacks += 1;
  if (!workerFallbackWarned) {
    workerFallbackWarned = true;
    // The reason rides the warning so a profile can identify which worker
    // path entered the cooperative canonical recovery.
    console.warn(
      'neighborGraphBuilder: worker path failed; recovering topology in main-thread slices '
      + '(counted in neighborGraphBuilderStats.workerFallbacks).',
      reason,
    );
  }
}

export interface NeighborGraphBuildOptions {
  topology?: NeighborGraphOptions;
  includePassive?: boolean;
  /** Visual-only cap for the passive graph. The complete graph remains
   * untouched for routing. */
  passiveEdgeBudget?: number;
  /** Live-tunable passive selection shares (module-constant defaults). */
  passiveTuning?: {
    coverageShare: number;
    trunkShare: number;
    twigShare: number;
  };
  preferredEdges?: readonly NeighborEdge[];
  /** Immutable render-set publication for main-thread recovery. The worker
   * still packs `cells`; recovery can span tasks and must not iterate a stage
   * Map that a newer cache generation patches in place. */
  recoveryCells?: NeighborGraphCells;
  /** O(churn) topology journal since the previous APPLIED build. When valid
   * and a previous response chained, the builder sends this instead of a
   * full 50K pack; the worker patches its retained cell map. Any gap makes
   * the worker answer `stale` and the builder re-sends the full pack. */
  cellsJournal?: {
    valid: boolean;
    upserts: ReadonlyMap<
      number,
      { id: number; pos_seed: readonly [number, number, number] }
    >;
    removedIds: Iterable<number>;
  };
  /** Read at completion time. BOTH are PATCHED IN PLACE when the response
   * chains from the build they were applied from: the result's `graph` is
   * then this very object with the eager log consumed, and its
   * `passiveGraph` this very selection with the patch merged in. A whole
   * response deserializes the display graph against `graph` instead
   * (unchanged nodes keep their Set instances, the previous graph must be
   * discarded) and replaces the passive selection outright. A caller that
   * holds one must hand over both: a chained response carries a passive
   * patch whenever the session's previous build had a selection. Without
   * this option the builder asks the worker for whole forms only. */
  reuseFrom?: () => {
    graph: LivingNeighborGraph | null;
    passiveGraph: PassiveSelection | null;
  };
}

export interface NeighborGraphBuildResult {
  /** Adjacency only: the display graph carries no edge list. */
  graph: LivingNeighborGraph;
  /** Edge list only, canonical order: the passive graph carries no
   * adjacency (see `PassiveSelection`). */
  passiveGraph: PassiveSelection | null;
  /** Passive-selection delta vs the PREVIOUS applied build — exactly the
   * patch the selection above was merged from, in its own records (`removed`
   * are the instances the list dropped). Null means the selection arrived
   * whole and the consumer must treat it as a full replacement. */
  passiveDelta: {
    added: NeighborEdge[];
    removed: NeighborEdge[];
  } | null;
}

export interface NeighborGraphBuilder {
  /** Resolves `null` when a newer request supersedes this build. */
  build(
    cells: ReadonlyMap<number, NeighborGraphCell>,
    options?: NeighborGraphBuildOptions,
  ): Promise<NeighborGraphBuildResult | null>;
  cancel(): void;
  /** End the Worker and its retained session while the builder stays usable —
   * the next build lazily spawns a fresh one. Unmount uses this: `dispose` is
   * terminal, and React Strict Mode replays setup→cleanup→setup against the
   * same builder instance. */
  releaseWorker(): void;
  dispose(): void;
}

interface ActiveBuild {
  requestId: number;
  resolve: (result: NeighborGraphBuildResult | null) => void;
  reject: (reason: unknown) => void;
  fallback: () => Promise<NeighborGraphBuildResult | null>;
  /** Delta-or-full request, packed at SEND time — a build superseded while
   * still queued never pays for packing at all. */
  buildRequest: () => NeighborGraphWorkerRequest;
  /** Fresh full pack answering the worker's `stale` reply. */
  fullRequest: () => NeighborGraphWorkerRequest;
  reuseFrom: NeighborGraphBuildOptions['reuseFrom'];
}

export interface NeighborGraphBuilderOptions {
  minWorkerCells?: number;
  workerFactory?: () => Worker;
  /** Canvas owner hook: zero pauses recovery while hidden or while this
   * frame's shared heavy-work ledger has no room. Omitted in headless labs. */
  recoveryBudgetMs?: () => number;
  recoverySpendMs?: (elapsedMs: number) => void;
}

function buildSynchronously(
  cells: ReadonlyMap<number, NeighborGraphCell>,
  options: NeighborGraphBuildOptions,
): NeighborGraphBuildResult {
  const graph = buildNeighborGraph(cells, options.topology);
  return {
    // The dense edge list serves the passive selection below and nothing
    // else on this thread; the display graph drops it.
    graph: { adjacency: graph.adjacency, eagerBase: new Map() },
    passiveGraph: options.includePassive
      ? buildPassiveNeighborGraph(graph, {
        edgeBudget: options.passiveEdgeBudget,
        coverageShare: options.passiveTuning?.coverageShare,
        trunkShare: options.passiveTuning?.trunkShare,
        twigShare: options.passiveTuning?.twigShare,
        preferredEdges: options.preferredEdges,
      })
      : null,
    passiveDelta: null,
  };
}

const RECOVERY_SLICE_MS = 2;

/**
 * Wait for the next moment this recovery could have room, and run then.
 *
 * ⭐ NOT A TIMER. A recovery with no budget used to re-ask every 16 ms, which
 * is 60 wakeups a second while the frame ledger is full and — measured by
 * lane L2's probe — 22 of them through 400 ms of a hidden page, where there
 * are no frames, the budget hook answers zero by rule, and nothing can have
 * changed. Two signals can change the answer and they are the two subscribed
 * to here: a frame opening the ledger (`beginFrameBudget`) and the page
 * becoming visible again. A hidden page therefore costs nothing at all and
 * resumes on its own first frame.
 *
 * Returns the cancel. Both the wake and the cancel are one-shot, so a
 * recovery cancelled while it waited leaves no listener behind.
 */
function waitForRecoveryWindow(run: () => void): () => void {
  let closed = false;
  let stopFrame: (() => void) | null = null;
  let stopVisibility: (() => void) | null = null;
  const close = () => {
    if (closed) return false;
    closed = true;
    stopFrame?.();
    stopVisibility?.();
    stopFrame = null;
    stopVisibility = null;
    return true;
  };
  const wake = () => {
    if (close()) run();
  };
  stopFrame = onFrameBudgetOpened(wake);
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    // The frame signal covers a page whose loop is running; this one covers
    // the page that comes BACK, whose owner reports no budget while hidden
    // and whose first frame may be a moment away.
    const listener = () => {
      if (document.visibilityState !== 'hidden') wake();
    };
    document.addEventListener('visibilitychange', listener);
    stopVisibility = () => document.removeEventListener('visibilitychange', listener);
  }
  return () => { close(); };
}

/** A real task boundary: MessageChannel is unaffected by Promise microtask
 * draining and lets input/paint tasks run between recovery slices. */
function scheduleRecoveryTask(run: () => void, yieldToTimers = false): () => void {
  if (yieldToTimers || typeof MessageChannel === 'undefined') {
    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
    run();
  };
  channel.port2.postMessage(null);
  return () => {
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
  };
}

interface RecoveryRun {
  promise: Promise<NeighborGraphBuildResult | null>;
  cancel(): void;
}

/**
 * What a completed recovery hands back — chained onto the selection the
 * caller holds whenever it can be.
 *
 * A recovery used to return whole forms always, and a whole passive selection
 * costs the CONSUMER a full `setFabric` reconcile per generation (the fabric
 * queue takes a delta or it takes the whole list — `NeuralNetwork`'s
 * `delta: wasBootstrapped && epochClean ? delta : null`). While a worker
 * stays down that is one whole reconcile per topology generation, on the main
 * thread, for churn of forty edges. So the recovery does what the worker
 * session does: it diffs its own build against the list the caller is holding
 * and merges the patch into it in place, which makes the landing O(churn).
 *
 * ⚠️ The DISPLAY graph is still handed over whole, and deliberately. The
 * adjacency patch exists to cross a thread boundary — it packs nodes into
 * transferable typed arrays — and here both graphs are in one heap, so
 * packing 12,000 nodes to unpack them again would buy the consumer nothing:
 * it swaps one reference either way. The two halves are coupled on the WORKER
 * path because one generation decides for both; on this path the passive
 * delta's base is the caller's own list, which is exactly what the fabric
 * last drew.
 *
 * The patch is computed against `held.edges` rather than against a remembered
 * selection of our own, so it chains off a worker landing as happily as off
 * another recovery — the only condition is the one `reuseFrom` already
 * promises: that list is what the caller published last.
 */
function recoveredResult(
  adjacency: LivingNeighborGraph['adjacency'],
  passiveGraph: PassiveSelection | null,
  options: NeighborGraphBuildOptions,
): NeighborGraphBuildResult {
  const whole: NeighborGraphBuildResult = {
    graph: { adjacency, eagerBase: new Map() },
    passiveGraph,
    passiveDelta: null,
  };
  if (passiveGraph === null) return whole;
  const held = options.reuseFrom?.().passiveGraph ?? null;
  // An empty held selection is not a base: the fabric has drawn nothing, so
  // every edge would arrive as an addition and the consumer discards the
  // delta anyway (`wasBootstrapped`).
  if (held === null || held.edges.length === 0) {
    neighborGraphBuilderStats.recoveryFullApplies += 1;
    return whole;
  }
  try {
    const delta = applyPassiveSelectionPatch(
      held,
      collectPassiveSelectionPatch(held.edges, passiveGraph.edges),
    );
    neighborGraphBuilderStats.recoveryPatchedApplies += 1;
    return { graph: whole.graph, passiveGraph: held, passiveDelta: delta };
  } catch {
    // The merge validates before it mutates, so the held list is untouched
    // and the whole form — always correct — is what lands. Counted as a full
    // apply because that is what the consumer pays for.
    neighborGraphBuilderStats.recoveryFullApplies += 1;
    return whole;
  }
}

function buildRecoverably(
  cells: NeighborGraphCells,
  options: NeighborGraphBuildOptions,
  alive: () => boolean,
  budgetMs: () => number,
  spendMs: (elapsedMs: number) => void,
): RecoveryRun {
  const graphSteps = buildNeighborGraphSteps(cells, options.topology);
  let graph: ReturnType<typeof buildNeighborGraph> | null = null;
  let passiveSteps: ReturnType<typeof buildPassiveNeighborGraphSteps> | null = null;
  let cancelScheduled: (() => void) | null = null;
  let scheduledSlices = 0;
  let settled = false;
  let resolveRun!: (result: NeighborGraphBuildResult | null) => void;
  const promise = new Promise<NeighborGraphBuildResult | null>((resolve, reject) => {
    resolveRun = resolve;
    const finish = (result: NeighborGraphBuildResult | null) => {
      if (settled) return;
      settled = true;
      cancelScheduled?.();
      cancelScheduled = null;
      resolve(result);
    };
    const schedule = (run: () => void) => {
      neighborGraphBuilderStats.recoveryPendingTasks += 1;
      neighborGraphBuilderStats.recoveryMaxPendingTasks = Math.max(
        neighborGraphBuilderStats.recoveryMaxPendingTasks,
        neighborGraphBuilderStats.recoveryPendingTasks,
      );
      scheduledSlices += 1;
      const cancelTask = scheduleRecoveryTask(() => {
        neighborGraphBuilderStats.recoveryPendingTasks -= 1;
        cancelScheduled = null;
        run();
      }, (scheduledSlices & 7) === 0);
      cancelScheduled = () => {
        neighborGraphBuilderStats.recoveryPendingTasks -= 1;
        cancelTask();
      };
    };
    const advance = () => {
      if (!alive()) {
        neighborGraphBuilderStats.recoveryCancelled += 1;
        finish(null);
        return;
      }
      const allowedMs = Math.max(0, Math.min(RECOVERY_SLICE_MS, budgetMs()));
      if (allowedMs <= 0) {
        neighborGraphBuilderStats.recoveryPendingTasks += 1;
        neighborGraphBuilderStats.recoveryMaxPendingTasks = Math.max(
          neighborGraphBuilderStats.recoveryMaxPendingTasks,
          neighborGraphBuilderStats.recoveryPendingTasks,
        );
        const cancelWait = waitForRecoveryWindow(() => {
          neighborGraphBuilderStats.recoveryPendingTasks -= 1;
          cancelScheduled = null;
          advance();
        });
        cancelScheduled = () => {
          neighborGraphBuilderStats.recoveryPendingTasks -= 1;
          cancelWait();
        };
        return;
      }
      const started = performance.now();
      const recordSlice = () => {
        const elapsed = performance.now() - started;
        neighborGraphBuilderStats.recoverySlices += 1;
        neighborGraphBuilderStats.recoveryMaxSliceMs = Math.max(
          neighborGraphBuilderStats.recoveryMaxSliceMs, elapsed,
        );
        spendMs(elapsed);
      };
      try {
        while (performance.now() - started < allowedMs) {
          if (graph === null) {
            const stepStarted = performance.now();
            const step = graphSteps.next();
            neighborGraphBuilderStats.recoveryMaxStepMs = Math.max(
              neighborGraphBuilderStats.recoveryMaxStepMs,
              performance.now() - stepStarted,
            );
            if (!step.done) continue;
            graph = step.value;
            if (options.includePassive) {
              passiveSteps = buildPassiveNeighborGraphSteps(graph, {
                edgeBudget: options.passiveEdgeBudget,
                coverageShare: options.passiveTuning?.coverageShare,
                trunkShare: options.passiveTuning?.trunkShare,
                twigShare: options.passiveTuning?.twigShare,
                preferredEdges: options.preferredEdges,
              });
              continue;
            }
          }
          if (passiveSteps !== null) {
            const stepStarted = performance.now();
            const step = passiveSteps.next();
            neighborGraphBuilderStats.recoveryMaxStepMs = Math.max(
              neighborGraphBuilderStats.recoveryMaxStepMs,
              performance.now() - stepStarted,
            );
            if (!step.done) continue;
            neighborGraphBuilderStats.recoveryCompleted += 1;
            recordSlice();
            finish(recoveredResult(graph!.adjacency, step.value, options));
            return;
          }
          neighborGraphBuilderStats.recoveryCompleted += 1;
          recordSlice();
          finish(recoveredResult(graph!.adjacency, null, options));
          return;
        }
        recordSlice();
        schedule(advance);
      } catch (error) {
        recordSlice();
        reject(error);
      }
    };
    schedule(advance);
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cancelScheduled?.();
      cancelScheduled = null;
      graphSteps.return(undefined as never);
      passiveSteps?.return(undefined as never);
      neighborGraphBuilderStats.recoveryCancelled += 1;
      resolveRun(null);
    },
  };
}

function defaultWorkerFactory(): Worker {
  return new Worker(
    new URL('./neighborGraph.worker.ts', import.meta.url),
    { type: 'module', name: 'cknerv-neighbor-graph' },
  );
}

/** Latest-only topology builder over one long-lived Worker, with COALESCED
 * sends: at most one request is inside the worker at a time, and the newest
 * superseding build waits in a single queued slot until the in-flight
 * response frees the worker. Without that gate every superseded request
 * still executed a full k-NN build worker-side (only its RESULT was
 * abandoned), so backfill/reorg churn queued seconds of stale compute and
 * the latest graph landed late. */
export function createNeighborGraphBuilder(
  builderOptions: NeighborGraphBuilderOptions = {},
): NeighborGraphBuilder {
  const minWorkerCells = Math.max(
    0,
    Math.floor(
      builderOptions.minWorkerCells ?? DEFAULT_TOPOLOGY_WORKER_MIN_CELLS,
    ),
  );
  const workerFactory = builderOptions.workerFactory ?? defaultWorkerFactory;
  let worker: Worker | null = null;
  let active: ActiveBuild | null = null;
  /** Request currently being computed inside the worker (posted, response
   * not yet received). May belong to `active` or to a superseded build —
   * either way the worker is busy and new sends must wait in
   * `pendingSend`. */
  let inFlightRequestId: number | null = null;
  /** Send-closure for `active` while the worker is busy. Exactly one slot:
   * a newer build replaces it (the replaced build already resolved null),
   * so the worker only ever sees the request that was newest when it
   * became free. */
  let pendingSend: (() => void) | null = null;
  let nextRequestId = 1;
  let disposed = false;
  let recoverySerial = 0;
  let activeRecovery: RecoveryRun | null = null;
  let workerRetryAfterMs = 0;
  let workerRetryDelayMs = 1_000;
  /** Generation of the last worker response actually APPLIED on this side.
   * Incremental hints are trusted only when the next response chains from
   * it; a superseded/dropped response breaks the chain and downgrades one
   * build to the always-correct probing path. Zero means "no chain": the
   * next request is a full pack, which re-bases the session wholesale. */
  let lastAppliedGeneration = 0;
  /** Mirror of the session's own passive-selection memory (it keeps the
   * previous selection as the continuity preference). While it holds one,
   * `preferredEdges` is dead weight on the wire — the session never reads
   * the field. */
  let sessionHoldsPassiveEdges = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdog === null) return;
    clearTimeout(watchdog);
    watchdog = null;
  };

  const terminateWorker = () => {
    inFlightRequestId = null;
    clearWatchdog();
    // The generation chain and the continuity memory belong to the SESSION:
    // a fresh worker starts at generation 0 with no retained cells, so every
    // delta against the old baseline is meaningless (the session would
    // answer `stale` and cost a needless round trip).
    lastAppliedGeneration = 0;
    sessionHoldsPassiveEdges = false;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  const delayWorkerRetry = () => {
    workerRetryAfterMs = performance.now() + workerRetryDelayMs;
    workerRetryDelayMs = Math.min(30_000, workerRetryDelayMs * 2);
  };

  // The worker survives across builds (its session retains the previous
  // graph so responses carry incremental hints, and per-build spawn + JIT
  // re-warm disappear). Superseding an in-flight request only abandons the
  // RESULT: responses are keyed by requestId, and a stale response advances
  // nothing on this side. Termination is reserved for dispose and failures.
  const cancel = () => {
    recoverySerial += 1;
    activeRecovery?.cancel();
    activeRecovery = null;
    pendingSend = null;
    if (active) {
      active.resolve(null);
      active = null;
    }
  };

  const releaseWorker = () => {
    cancel();
    terminateWorker();
  };

  /** Worker-path failure: resolve the active build through the synchronous
   * fallback and drop the worker (its queue and session die with it). */
  const failWorker = (reason: unknown) => {
    noteWorkerFallback(reason);
    delayWorkerRetry();
    const current = active;
    active = null;
    pendingSend = null;
    terminateWorker();
    if (!current) return;
    try {
      current.fallback().then(current.resolve, current.reject);
    } catch (error) { current.reject(error); }
  };

  /** Post a request with the transfer list its own buffers imply. */
  const postToWorker = (outgoing: NeighborGraphWorkerRequest): void => {
    const transfer: Transferable[] = [];
    if (outgoing.cells) transfer.push(outgoing.cells.buffer);
    if (outgoing.cellsDelta) {
      transfer.push(
        outgoing.cellsDelta.upserts.buffer,
        outgoing.cellsDelta.removedIds.buffer,
      );
    }
    if (outgoing.preferredEdges) {
      transfer.push(outgoing.preferredEdges.buffer);
    }
    worker!.postMessage(outgoing, transfer);
    inFlightRequestId = outgoing.requestId;
    // Armed on every send (including the stale-resend, which re-enters the
    // worker under the same requestId) and cleared by the matching response
    // or by termination, so exactly one timer can be pending.
    clearWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      neighborGraphBuilderStats.workerTimeouts += 1;
      failWorker(new Error(
        `neighbor graph worker did not answer request ${outgoing.requestId} `
        + `within ${TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS}ms`,
      ));
    }, TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS);
  };

  const flushPendingSend = () => {
    if (inFlightRequestId !== null) return;
    const dispatch = pendingSend;
    pendingSend = null;
    dispatch?.();
  };

  const handleResponse = (
    event: MessageEvent<NeighborGraphWorkerResponse>,
  ) => {
    // The worker landing TASK opens here: everything below, plus the
    // microtask the resolved promise runs in the consumer, is one task on the
    // main thread, and its wall time is the block-frame gauge's headline. The
    // mark is cleared again on every path that applies nothing.
    blockFrameStats.markLandingStart();
    const response = event.data;
    if (response.requestId === inFlightRequestId) {
      inFlightRequestId = null;
      clearWatchdog();
    }
    if (response.kind === 'built') {
      // Mirrors the session's own `lastPassiveEdges` assignment, which
      // happens whether or not this build was superseded.
      sessionHoldsPassiveEdges = response.passiveGraph !== null;
    }
    const current = active;
    if (!current || response.requestId !== current.requestId) {
      // A superseded build's response: its only remaining job was to free
      // the worker for the newest waiting request. A failure among them
      // still breaks the chain — the session may have thrown halfway
      // through applying a delta, leaving a retained baseline no later
      // delta may be trusted against.
      if (response.kind === 'failed') lastAppliedGeneration = 0;
      blockFrameStats.discardLanding();
      flushPendingSend();
      return;
    }
    if (response.kind === 'failed') {
      blockFrameStats.discardLanding();
      failWorker(response.message);
      return;
    }
    if (response.kind === 'stale') {
      // Ordinary after a superseded/dropped build: re-send a freshly
      // packed full request under the same requestId (full requests
      // never go stale).
      neighborGraphBuilderStats.staleResends += 1;
      blockFrameStats.discardLanding();
      try {
        postToWorker(current.fullRequest());
      } catch (error) {
        failWorker(error);
      }
      return;
    }
    // The main-thread half of a topology build: patching (or, off a broken
    // chain, rebuilding) the display adjacency and the passive selection the
    // caller holds. The worker's own time is not in it. Disabled, the probe
    // returns before any clock read.
    const commitProbe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.topologyCommit);
    try {
      const reuse = current.reuseFrom?.() ?? null;
      const chained = response.generation === lastAppliedGeneration + 1;
      let graph: LivingNeighborGraph;
      if (response.graph.kind === 'patch') {
        // The session only patches against the generation the request
        // named, and the request named the one applied here — so a patch
        // chains by construction, and the graph it targets is the one
        // `reuseFrom` returns. Anything else is a protocol violation and
        // must not be applied to a base it was not computed against.
        if (!chained || reuse?.graph == null) {
          throw new Error('display graph patch without its base graph');
        }
        neighborGraphBuilderStats.patchedApplies += 1;
        graph = applyNeighborAdjacencyPatch(reuse.graph, response.graph.patch);
      } else {
        neighborGraphBuilderStats.fullApplies += 1;
        if (!chained && lastAppliedGeneration !== 0) {
          neighborGraphBuilderStats.unchainedApplies += 1;
        }
        graph = deserializeLivingNeighborGraphInto(
          reuse?.graph ?? null,
          response.graph.adjacency,
        );
      }
      let passiveGraph: PassiveSelection | null = null;
      let passiveDelta: NeighborGraphBuildResult['passiveDelta'] = null;
      if (response.passiveGraph !== null) {
        if (response.passiveGraph.kind === 'patch') {
          // Same argument as the display patch: it targets the selection
          // applied from the generation the request named, which is the one
          // `reuseFrom` returns. The merge validates before it mutates, so
          // a patch that does not fit the held list throws here, untouched,
          // into the counted fallback.
          if (!chained || reuse?.passiveGraph == null) {
            throw new Error('passive selection patch without its base selection');
          }
          neighborGraphBuilderStats.passivePatchedApplies += 1;
          passiveGraph = reuse.passiveGraph;
          passiveDelta = applyPassiveSelectionPatch(
            passiveGraph,
            response.passiveGraph.patch,
          );
        } else {
          neighborGraphBuilderStats.passiveFullApplies += 1;
          passiveGraph = deserializePassiveSelection(response.passiveGraph);
        }
      }
      const result: NeighborGraphBuildResult = { graph, passiveGraph, passiveDelta };
      lastAppliedGeneration = response.generation;
      workerRetryAfterMs = 0;
      workerRetryDelayMs = 1_000;
      active = null;
      current.resolve(result);
    } catch (error) {
      blockFrameStats.discardLanding();
      failWorker(error);
    } finally {
      endCpuProbe(commitProbe);
    }
  };

  return {
    build(cells, options = {}) {
      if (disposed) return Promise.resolve(null);
      cancel();
      // The retained map's size upper-bounds live cells closely enough for
      // the worker threshold; the full O(N) pack happens only when a full
      // request is actually needed.
      const canUseWorker = (
        cells.size >= minWorkerCells
        && performance.now() >= workerRetryAfterMs
        && (
          builderOptions.workerFactory !== undefined
          || typeof Worker !== 'undefined'
        )
      );
      const recovery = recoverySerial;
      const fallback = () => {
        activeRecovery?.cancel();
        const run = buildRecoverably(
          options.recoveryCells ?? cells,
          options, () => !disposed && recovery === recoverySerial,
          builderOptions.recoveryBudgetMs ?? (() => RECOVERY_SLICE_MS),
          builderOptions.recoverySpendMs ?? (() => {}),
        );
        activeRecovery = run;
        void run.promise.then(() => {
          if (activeRecovery === run) activeRecovery = null;
        }, () => {
          if (activeRecovery === run) activeRecovery = null;
        });
        return run.promise;
      };
      if (!canUseWorker) {
        if (cells.size < minWorkerCells) {
          neighborGraphBuilderStats.belowThresholdBuilds += 1;
        }
        // This build lands on the main thread, but the caller already
        // consumed its journal window for it — a window the surviving worker
        // session never sees. Keeping the chain would let the NEXT delta
        // patch a baseline that skipped it (cells removed here linger as
        // ghost nodes until the next unrelated chain break), so the chain
        // restarts with a full pack.
        lastAppliedGeneration = 0;
        return cells.size >= minWorkerCells
          ? fallback()
          : Promise.resolve().then(() => buildSynchronously(cells, options));
      }

      try {
        if (worker === null) {
          worker = workerFactory();
          // One persistent dispatcher: responses are routed by requestId,
          // so handlers survive across builds instead of being re-bound
          // (and nulled) per request.
          worker.onmessage = handleResponse;
          worker.onerror = (event) => failWorker(event);
          worker.onmessageerror = (event) => failWorker(event);
        }
      } catch (error) {
        noteWorkerFallback(error);
        delayWorkerRetry();
        terminateWorker();
        return fallback();
      }

      const requestId = nextRequestId;
      nextRequestId += 1;
      // Every packed buffer is TRANSFERRED, which detaches it here — so each
      // request packs its own. Sharing one pack across the delta request and
      // the stale-resend below would post a detached buffer, and the throw
      // lands in the silent fallback (a full synchronous rebuild).
      //
      // Continuity edges ride only when the session has none of its own: it
      // prefers its previous passive selection and ignores the field
      // otherwise, so packing 8K edges per build bought nothing. Evaluated at
      // SEND time, which is also when the mirrored flag is exact (the single
      // in-flight gate means no response can land between the two).
      const packEdges = () => (
        options.includePassive && !sessionHoldsPassiveEdges
          ? packPreferredEdges(options.preferredEdges ?? [])
          : null
      );
      const baseRequest = {
        kind: 'build' as const,
        requestId,
        options: options.topology ?? {},
        includePassive: options.includePassive ?? false,
        passiveEdgeBudget: options.passiveEdgeBudget ?? null,
        passiveTuning: options.passiveTuning ?? null,
      };
      // The display graph the caller holds is the one applied from
      // `lastAppliedGeneration`; naming it lets the session answer with a
      // patch against exactly that build. Evaluated at SEND time like the
      // continuity edges (the single in-flight gate means no apply can land
      // between packing and posting), and zero for a caller without
      // `reuseFrom` — it has no graph to patch, so it must be sent a whole one.
      const patchBase = () => (
        options.reuseFrom !== undefined ? lastAppliedGeneration : 0
      );
      const fullRequest = (): NeighborGraphWorkerRequest => ({
        ...baseRequest,
        patchBaseGeneration: patchBase(),
        preferredEdges: packEdges(),
        cells: packTopologyCells(cells),
        cellsDelta: null,
      });
      const journal = options.cellsJournal;
      const deltaRequest = (): NeighborGraphWorkerRequest | null => {
        if (!journal?.valid || lastAppliedGeneration === 0) return null;
        const upserts = new Float64Array(
          journal.upserts.size * PACKED_TOPOLOGY_CELL_STRIDE,
        );
        let offset = 0;
        for (const cell of journal.upserts.values()) {
          upserts[offset] = cell.id;
          upserts[offset + 1] = cell.pos_seed[0];
          upserts[offset + 2] = cell.pos_seed[1];
          upserts[offset + 3] = cell.pos_seed[2];
          offset += PACKED_TOPOLOGY_CELL_STRIDE;
        }
        return {
          ...baseRequest,
          patchBaseGeneration: patchBase(),
          preferredEdges: packEdges(),
          cells: null,
          cellsDelta: {
            baseGeneration: lastAppliedGeneration,
            upserts,
            removedIds: Float64Array.from(journal.removedIds),
          },
        };
      };
      return new Promise<NeighborGraphBuildResult | null>((resolve, reject) => {
        const build: ActiveBuild = {
          requestId,
          resolve,
          reject,
          fallback,
          buildRequest: () => deltaRequest() ?? fullRequest(),
          fullRequest,
          reuseFrom: options.reuseFrom,
        };
        active = build;
        const dispatch = () => {
          if (active !== build) return;
          try {
            postToWorker(build.buildRequest());
          } catch (error) {
            failWorker(error);
          }
        };
        if (inFlightRequestId === null) {
          dispatch();
        } else {
          // Worker busy: wait in the single queued slot. Whatever response
          // arrives next — including one for a superseded build — frees
          // the worker and flushes this send.
          pendingSend = dispatch;
        }
      });
    },
    cancel,
    releaseWorker,
    dispose() {
      disposed = true;
      releaseWorker();
    },
  };
}
