import { useSyncExternalStore } from 'react';

/**
 * The page's own boot record: bundle arriving → galaxy standing up.
 *
 * Writers span the pre-React entry point, the snapshot fetch, the Canvas,
 * an in-Canvas frame sentinel and the nerve fabric, so the record lives in
 * the module rather than in the R3F tree — threading a reporting callback
 * down the scene graph to say "a GL context exists" would be pure noise.
 * Readers are the HUD banner (`useSyncExternalStore`) and the static shell
 * in `index.html`, which subscribes imperatively during the window where
 * React does not exist yet.
 *
 * This module records observed states and caller-supplied monotonic timestamps.
 * It does not choose labels, colours, waiting thresholds or layout; those
 * presentation rules live beside each consumer.
 */

export type BootPhaseId =
  | 'instrument'
  | 'snapshot'
  | 'decode'
  | 'gl'
  | 'first_light'
  | 'fabric'
  | 'data_plane'
  | 'seeding';

export type BootPhaseState = 'pending' | 'active' | 'done' | 'failed';

export interface BootPhaseSnapshot {
  id: BootPhaseId;
  state: BootPhaseState;
  /** seeding phase only: mirrored server replay progress. */
  seedingDone?: number;
  seedingTotal?: number;
  /** failed only: short reason for the banner. */
  detail?: string;
}

export interface BootSequenceSnapshot {
  /** True from module load until `complete`. A failure holds it true for the
   * session: a boot that reported a fault never "completes". */
  active: boolean;
  complete: boolean;
  /** Display order. `seeding` appears ONLY once it has been reported. */
  phases: readonly BootPhaseSnapshot[];
  /** Every required bootstrap request is observed per actual attempt. */
  requests?: readonly BootRequestSnapshot[];
  /** The module has taken ownership from index.html's pre-bundle timer. */
  moduleStartedAtMs?: number | null;
  /** The React tree has the snapshots and is waiting for its first real draw. */
  viewPreparingAtMs?: number | null;
  /** Independent of diagnostic phase completion and frame-rate quality. */
  viewPresented?: boolean;
  viewKind?: 'populated' | 'empty' | null;
}

export type BootRequestKind = 'chain' | 'cells';
export type BootRequestTransport = 'chain-json' | 'cells-binary' | 'cells-json';
export type BootRequestState = 'requesting' | 'reading' | 'done' | 'failed';

export interface BootRequestSnapshot {
  kind: BootRequestKind;
  transport: BootRequestTransport;
  attempt: number;
  state: BootRequestState;
  startedAtMs: number;
  lastActivityAtMs: number;
  receivedBytes: number;
  totalBytes: number | null;
  detail?: string;
}

/**
 * Display order, not a pipeline. The phases are independent state machines
 * observed by independent writers, and real boots overlap heavily
 * (fabric / data_plane / first_light race each other; seeding runs across
 * all of them). Nothing here implies that activating one phase finished the
 * one before it.
 */
const FIXED_PHASES: readonly Exclude<BootPhaseId, 'seeding'>[] = [
  'instrument',
  'snapshot',
  'decode',
  'gl',
  'first_light',
  'fabric',
  'data_plane',
];

function initialPhases(): BootPhaseSnapshot[] {
  // `instrument` starts active because evaluating this module IS the proof
  // that the bundle arrived and is running; main.tsx completes it first thing.
  return FIXED_PHASES.map((id) => ({
    id,
    state: id === 'instrument' ? 'active' : 'pending',
  }));
}

const listeners = new Set<() => void>();
let snapshot: BootSequenceSnapshot = {
  active: true,
  complete: false,
  phases: initialPhases(),
  requests: [],
  moduleStartedAtMs: null,
  viewPreparingAtMs: null,
  viewPresented: false,
  viewKind: null,
};

function isTerminal(state: BootPhaseState): boolean {
  return state === 'done' || state === 'failed';
}

/** Byte and block counts arrive from streams and from the wire; keep a bad
 * one out of the snapshot instead of letting NaN reach the banner. */
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** A boot is complete when every line it is showing is done. Since `seeding`
 * exists only once reported, this is exactly "all seven fixed phases done and
 * seeding absent or done" — and a `failed` line holds it false forever, which
 * is the point: the banner stays up carrying the fault. */
function publish(phases: readonly BootPhaseSnapshot[]): void {
  const complete = phases.every((phase) => phase.state === 'done');
  snapshot = { ...snapshot, active: !complete, complete, phases };
  for (const listener of listeners) listener();
}

function publishSnapshot(next: BootSequenceSnapshot): void {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function monotonicTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function markBootModuleStarted(atMs: number): void {
  if (typeof snapshot.moduleStartedAtMs === 'number') return;
  publishSnapshot({ ...snapshot, moduleStartedAtMs: monotonicTime(atMs) });
}

export function beginBootRequest(
  kind: BootRequestKind,
  transport: BootRequestTransport,
  atMs: number,
): number {
  if (snapshot.complete || snapshot.viewPresented) return 0;
  const requests = snapshot.requests ?? [];
  const attempt = requests.reduce(
    (highest, request) => request.kind === kind ? Math.max(highest, request.attempt) : highest,
    0,
  ) + 1;
  const now = monotonicTime(atMs);
  publishSnapshot({
    ...snapshot,
    requests: [...requests, {
      kind,
      transport,
      attempt,
      state: 'requesting',
      startedAtMs: now,
      lastActivityAtMs: now,
      receivedBytes: 0,
      totalBytes: null,
    }],
  });
  return attempt;
}

function updateBootRequest(
  kind: BootRequestKind,
  attempt: number,
  update: (request: BootRequestSnapshot) => BootRequestSnapshot,
): void {
  const currentRequests = snapshot.requests ?? [];
  const index = currentRequests.findIndex(
    (request) => request.kind === kind && request.attempt === attempt,
  );
  if (index < 0) return;
  const current = currentRequests[index];
  if (current.state === 'done' || current.state === 'failed') return;
  const next = update(current);
  if (next === current) return;
  const requests = currentRequests.slice();
  requests[index] = next;
  publishSnapshot({ ...snapshot, requests });
}

export function reportBootRequestResponse(
  kind: BootRequestKind,
  attempt: number,
  atMs: number,
  totalBytes: number | null,
): void {
  updateBootRequest(kind, attempt, (request) => ({
    ...request,
    state: 'reading',
    lastActivityAtMs: Math.max(request.lastActivityAtMs, monotonicTime(atMs)),
    totalBytes: totalBytes !== null && Number.isFinite(totalBytes) && totalBytes > 0
      ? count(totalBytes)
      : null,
  }));
}

export function reportBootRequestProgress(
  kind: BootRequestKind,
  attempt: number,
  atMs: number,
  receivedBytes: number,
): void {
  if (!Number.isFinite(receivedBytes) || receivedBytes < 0) return;
  updateBootRequest(kind, attempt, (request) => {
    const received = count(receivedBytes);
    const now = Math.max(request.lastActivityAtMs, monotonicTime(atMs));
    if (request.receivedBytes === received && request.lastActivityAtMs === now) return request;
    return { ...request, state: 'reading', receivedBytes: received, lastActivityAtMs: now };
  });
}

export function completeBootRequest(
  kind: BootRequestKind,
  attempt: number,
  atMs: number,
): void {
  updateBootRequest(kind, attempt, (request) => ({
    ...request,
    state: 'done',
    lastActivityAtMs: Math.max(request.lastActivityAtMs, monotonicTime(atMs)),
    // A mismatched declared length is not a trustworthy denominator.
    totalBytes: request.totalBytes === request.receivedBytes ? request.totalBytes : null,
  }));
}

export function failBootRequest(
  kind: BootRequestKind,
  attempt: number,
  atMs: number,
  detail: string,
): void {
  updateBootRequest(kind, attempt, (request) => ({
    ...request,
    state: 'failed',
    lastActivityAtMs: Math.max(request.lastActivityAtMs, monotonicTime(atMs)),
    detail,
  }));
}

export function markBootViewPreparing(atMs: number): void {
  if (typeof snapshot.viewPreparingAtMs === 'number' || snapshot.viewPresented) return;
  publishSnapshot({ ...snapshot, viewPreparingAtMs: monotonicTime(atMs) });
}

export function markBootViewPresented(kind: 'populated' | 'empty'): void {
  if (snapshot.viewPresented) return;
  publishSnapshot({ ...snapshot, viewPresented: true, viewKind: kind });
}

/**
 * Applies a transition to one line. `next` returns the phase it was handed to
 * decline the write — declining publishes nothing, so a repeated call (React
 * StrictMode invokes effects twice) cannot churn subscribers.
 */
function writePhase(
  id: BootPhaseId,
  next: (phase: BootPhaseSnapshot) => BootPhaseSnapshot,
): void {
  // Inert after completion: mid-session reconnects and replays stay the job
  // of the stream-health and backfill banners, unchanged.
  if (snapshot.complete) return;
  const index = snapshot.phases.findIndex((phase) => phase.id === id);
  if (index < 0) return;
  const current = snapshot.phases[index];
  const updated = next(current);
  if (updated === current) return;
  const phases = snapshot.phases.slice();
  phases[index] = updated;
  publish(phases);
}

/** Start a phase. Never a regression: a phase that already reached a terminal
 * state stays there. */
export function beginBootPhase(id: Exclude<BootPhaseId, 'seeding'>): void {
  writePhase(id, (phase) => (
    phase.state === 'pending' ? { ...phase, state: 'active' } : phase
  ));
}

/** Finish a phase. `pending → done` is legal and expected: `fabric` and
 * `data_plane` are single observed events with no natural start. */
export function completeBootPhase(id: Exclude<BootPhaseId, 'seeding'>): void {
  writePhase(id, (phase) => (
    isTerminal(phase.state) ? phase : { ...phase, state: 'done' }
  ));
}

/** Fault a phase. Terminal, so the first reason wins — a cascade of follow-up
 * failures cannot overwrite the root cause the banner is showing. */
export function failBootPhase(
  id: Exclude<BootPhaseId, 'seeding'>,
  detail: string,
): void {
  writePhase(id, (phase) => (
    isTerminal(phase.state) ? phase : { ...phase, state: 'failed', detail }
  ));
}

/**
 * Mirror the server's chain replay into the sequence as one line, instead of
 * a second banner overlapping this one. The line is inserted on first report,
 * which is why a boot with no replay never shows it.
 */
export function reportBootSeeding(done: number, total: number): void {
  if (snapshot.complete) return;
  const seedingDone = count(done);
  const seedingTotal = count(total);
  const index = snapshot.phases.findIndex((phase) => phase.id === 'seeding');
  if (index < 0) {
    publish([
      ...snapshot.phases,
      { id: 'seeding', state: 'active', seedingDone, seedingTotal },
    ]);
    return;
  }
  const current = snapshot.phases[index];
  if (isTerminal(current.state)) return;
  if (
    current.state === 'active'
    && current.seedingDone === seedingDone
    && current.seedingTotal === seedingTotal
  ) return;
  const phases = snapshot.phases.slice();
  phases[index] = { ...current, state: 'active', seedingDone, seedingTotal };
  publish(phases);
}

/** No-op when the replay never reported — there is no line to finish. */
export function completeBootSeeding(): void {
  writePhase('seeding', (phase) => (
    isTerminal(phase.state) ? phase : { ...phase, state: 'done' }
  ));
}

export function getBootSequence(): BootSequenceSnapshot {
  return snapshot;
}

export function subscribeBootSequence(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBootSequence(): BootSequenceSnapshot {
  return useSyncExternalStore(
    subscribeBootSequence,
    getBootSequence,
    getBootSequence,
  );
}

/** A page boots once, so nothing in the product rewinds this store; tests
 * that mount a booting tree twice need to. Subscribers are kept — a mounted
 * reader survives the rewind — and told. */
export function resetBootSequenceForTest(): void {
  snapshot = {
    active: true,
    complete: false,
    phases: initialPhases(),
    requests: [],
    moduleStartedAtMs: null,
    viewPreparingAtMs: null,
    viewPresented: false,
    viewKind: null,
  };
  for (const listener of listeners) listener();
}
