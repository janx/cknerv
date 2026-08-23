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
 * This module records STATES. Not durations — no clock is read here — and
 * not presentation: labels, colours and the compact layout belong beside
 * the banner, the way `replayPresentation` sits beside the replay HUDs.
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
  /** snapshot phase only: streamed byte progress. `totalBytes: null` means
   * the response carried no length — indeterminate, and a consumer must NOT
   * synthesize a percentage from it. */
  receivedBytes?: number;
  totalBytes?: number | null;
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
  snapshot = { active: !complete, complete, phases };
  for (const listener of listeners) listener();
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
 * Streamed snapshot bytes — the only continuous measure in the sequence, and
 * exact: the endpoint sends a real content-length and no content-encoding.
 * `totalBytes: null` keeps the phase indeterminate rather than inventing a
 * denominator. Reporting implies the phase is running.
 */
export function reportBootSnapshotProgress(
  receivedBytes: number,
  totalBytes: number | null,
): void {
  writePhase('snapshot', (phase) => {
    if (isTerminal(phase.state)) return phase;
    // A retry (stream error → JSON fallback) restarts the byte count; the
    // readout must not walk backwards, so the high-water mark stands.
    const received = Math.max(phase.receivedBytes ?? 0, count(receivedBytes));
    // An unusable length is indeterminate, not zero — a zero denominator is
    // exactly the synthesized percentage this readout refuses to show.
    const total = totalBytes !== null && Number.isFinite(totalBytes)
      ? count(totalBytes)
      : null;
    if (
      phase.state === 'active'
      && phase.receivedBytes === received
      && phase.totalBytes === total
    ) return phase;
    return { ...phase, state: 'active', receivedBytes: received, totalBytes: total };
  });
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
  publish(initialPhases());
}
