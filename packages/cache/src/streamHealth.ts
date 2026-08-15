/** Transport lifecycle shared by the entity and projection WebSocket clients. */
export type StreamHealthPhase =
  | 'connecting'
  | 'live'
  | 'retrying'
  | 'resyncing'
  | 'stale';

export type StreamHealthReason =
  | 'initial'
  | 'closed'
  | 'lagged'
  | 'heartbeat_timeout'
  | null;

export interface StreamHealth {
  phase: StreamHealthPhase;
  /** Consecutive connection attempt inside the current outage. */
  attempt: number;
  /** Wall-clock receipt time of the last valid data or heartbeat frame. */
  lastMessageAtMs: number | null;
  reason: StreamHealthReason;
}

export interface StreamHealthOptions {
  /** Receives lifecycle changes without coupling transport state to a cache. */
  onHealth?: (health: StreamHealth) => void;
  /**
   * Maximum silence before an open or retrying stream becomes stale.
   * `0` disables the watchdog for consumers whose server has no heartbeat.
   */
  staleAfterMs?: number;
  /** Deterministic clock injection for tests. */
  now?: () => number;
}

export interface StreamHealthTracker {
  startAttempt: (resyncing?: boolean) => void;
  opened: (resyncing?: boolean) => void;
  message: (resyncing?: boolean) => void;
  resyncing: () => void;
  closed: (resyncing?: boolean) => void;
  stop: () => void;
}

/** Owns only lifecycle timing; the caller still owns the WebSocket itself. */
export function createStreamHealthTracker(
  opts: StreamHealthOptions,
  onStale: () => void,
): StreamHealthTracker {
  const now = opts.now ?? Date.now;
  const staleAfterMs = Math.max(0, opts.staleAfterMs ?? 0);
  let stopped = false;
  let everOpened = false;
  let freshnessBaseMs = now();
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let health: StreamHealth = {
    phase: 'connecting',
    attempt: 0,
    lastMessageAtMs: null,
    reason: 'initial',
  };

  const publish = (next: StreamHealth) => {
    health = next;
    opts.onHealth?.({ ...next });
  };

  /** Phase, attempt and reason are the whole rendered surface of a health
   *  object; `lastMessageAtMs` is deliberately excluded so a freshness-only
   *  frame is not a lifecycle event. */
  const lifecycleChanged = (next: StreamHealth) =>
    next.phase !== health.phase
    || next.attempt !== health.attempt
    || next.reason !== health.reason;

  const clearStaleTimer = () => {
    if (staleTimer === null) return;
    clearTimeout(staleTimer);
    staleTimer = null;
  };

  const armStaleTimer = () => {
    clearStaleTimer();
    if (stopped || staleAfterMs <= 0 || health.phase === 'stale') return;
    const basis = health.lastMessageAtMs ?? freshnessBaseMs;
    const delay = Math.max(0, staleAfterMs - (now() - basis));
    staleTimer = setTimeout(() => {
      staleTimer = null;
      if (stopped) return;
      publish({
        ...health,
        phase: 'stale',
        reason: 'heartbeat_timeout',
      });
      onStale();
    }, delay);
  };

  opts.onHealth?.({ ...health });

  return {
    startAttempt: (resyncing = false) => {
      if (stopped) return;
      const attempt = health.attempt + 1;
      const phase: StreamHealthPhase = resyncing
        ? 'resyncing'
        : health.phase === 'stale'
          ? 'stale'
          : !everOpened && attempt === 1
            ? 'connecting'
            : 'retrying';
      publish({
        ...health,
        phase,
        attempt,
        reason: resyncing ? 'lagged' : health.reason,
      });
      armStaleTimer();
    },
    opened: (resyncing = false) => {
      if (stopped) return;
      everOpened = true;
      const phase: StreamHealthPhase = resyncing
        ? 'resyncing'
        : health.phase === 'stale'
          ? 'stale'
          : health.lastMessageAtMs === null && health.attempt <= 1
            ? 'connecting'
            : 'retrying';
      // A socket usually opens into the phase `startAttempt` just announced
      // (ordinary connect, retry, reopen while stale). Republishing the same
      // triple would re-render every consumer for nothing.
      const next: StreamHealth = {
        ...health,
        phase,
        reason: resyncing ? 'lagged' : health.reason,
      };
      if (lifecycleChanged(next)) publish(next);
      armStaleTimer();
    },
    message: (resyncing = false) => {
      if (stopped) return;
      const receivedAtMs = now();
      everOpened = true;
      freshnessBaseMs = receivedAtMs;
      const next: StreamHealth = {
        phase: resyncing ? 'resyncing' : 'live',
        attempt: 0,
        lastMessageAtMs: receivedAtMs,
        reason: resyncing ? 'lagged' : null,
      };
      // A live stream receives many frames per second and every publish lands
      // in React state, re-rendering the whole consumer tree. While live the
      // freshness stamp has no rendered output at all, so it stays internal:
      // the stale watchdog reads `health` directly, and the next lifecycle
      // publish carries the stamp as it stood then — which is exactly the
      // "last frame" instant an age readout wants.
      if (lifecycleChanged(next)) publish(next);
      else health = next;
      armStaleTimer();
    },
    resyncing: () => {
      if (stopped) return;
      publish({
        ...health,
        phase: 'resyncing',
        reason: 'lagged',
      });
      armStaleTimer();
    },
    closed: (resyncing = false) => {
      if (stopped) return;
      if (health.phase !== 'stale') {
        publish({
          ...health,
          phase: resyncing ? 'resyncing' : 'retrying',
          reason: resyncing ? 'lagged' : 'closed',
        });
      }
      armStaleTimer();
    },
    stop: () => {
      stopped = true;
      clearStaleTimer();
    },
  };
}
