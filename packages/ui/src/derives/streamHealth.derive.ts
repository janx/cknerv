import type {
  StreamHealth,
  StreamHealthPhase,
} from '@cknerv/cache';

export interface StreamHealthChannels {
  chain: StreamHealth;
  cells: StreamHealth;
  /** Present only when enrichment is enabled — the semantics stream is
   * optional by design, but once it exists its outages must surface here
   * like any other transport instead of freezing five panels silently. */
  semantics?: StreamHealth;
  /**
   * The hop the browser cannot see: cknerv → the CKB node.
   *
   * The three above are the browser's own sockets, and all three stay
   * perfectly live while the node behind the server is gone — the server
   * heartbeats a frozen tip at them. The outage therefore surfaced two and a
   * half minutes later as a chain STALL: the most likely real fault of a
   * local-first tool, reported as a different fault, late (report E, E-7).
   *
   * Absent when `/api/health` cannot be read at all, which is not this
   * channel's story to tell: a server that will not answer is exactly what
   * the sockets above are already saying, and a second banner for it would be
   * two voices on one emergency. Absent is the same word `semantics` uses for
   * "there is nothing here to report on".
   */
  node?: StreamHealth;
}

/** The fields of `/api/health` this channel reads. The endpoint reports a
 *  dozen more; naming only these three is the contract, and it is why nothing
 *  in `packages/types` had to grow a wire type for a body the page treats as a
 *  vital-signs probe rather than as data. */
export interface NodeHealthProbe {
  /** True when any watched task has died or any projection is quarantined —
   *  the server's own single field for "something is wrong with me". */
  degraded: boolean;
  /** One entry per registered adapter. THE adapter is the thing that talks to
   *  the CKB node, so this is the reading; `degraded` is the gate above it. */
  adapters: ReadonlyArray<{ name: string; alive: boolean }>;
  /** Age of the tip block by its OWN timestamp, `null` until one is seen. */
  tipAgeMs: number | null;
}

/**
 * The node's hop as a transport phase.
 *
 * It has two states and no dwell, because the supervisor it reads has none to
 * add: `spawn_supervisor` flips an adapter dead within 250 ms of the task
 * exiting and never flips it back — a dead task stays dead for the life of the
 * process — so a single reading is already a settled one. Debouncing it would
 * only delay a fault that is by then permanent.
 *
 * `stale` and not `retrying`: nothing is being retried by anyone the page can
 * see, and the register the reader needs is the frozen one. The banner's word
 * over that register is the node's own (`NODE UNREACHABLE`) — same colour,
 * same frame, different sentence, because a cause outranks its consequence.
 */
export function deriveNodeStreamHealth(
  probe: NodeHealthProbe,
  nowMs: number,
): StreamHealth {
  const reachable = !probe.degraded
    || probe.adapters.every((adapter) => adapter.alive);
  // The tip's own age, carried as the freshness stamp rather than as a second
  // alarm. A tip that stops advancing while every adapter lives is a CHAIN
  // fault, and the ECG already names it FLATLINE at its own threshold — two
  // surfaces alarming on one fact is the thing the severity rule forbids. Here
  // it is the number that fills `LAST FRAME`, which is the reading a frozen
  // band most wants beside it.
  const lastMessageAtMs = probe.tipAgeMs === null
    ? null
    : nowMs - Math.max(0, probe.tipAgeMs);
  return {
    phase: reachable ? 'live' : 'stale',
    attempt: 0,
    lastMessageAtMs,
    reason: reachable ? null : 'closed',
  };
}

export interface StreamHealthSummary {
  phase: StreamHealthPhase;
  affectedChannels: Array<keyof StreamHealthChannels>;
  lastMessageAgeMs: number | null;
  attempt: number;
}

const PHASE_PRIORITY: Record<StreamHealthPhase, number> = {
  live: 0,
  connecting: 1,
  retrying: 2,
  resyncing: 3,
  stale: 4,
};

type StreamHealthEntry = [keyof StreamHealthChannels, StreamHealth];

function presentChannels(channels: StreamHealthChannels): StreamHealthEntry[] {
  return (Object.entries(channels) as Array<
    [keyof StreamHealthChannels, StreamHealth | undefined]
  >).filter(
    (entry): entry is StreamHealthEntry => entry[1] !== undefined,
  );
}

function worstPhase(entries: readonly StreamHealthEntry[]): StreamHealthPhase {
  return entries.reduce<StreamHealthPhase>(
    (worst, [, health]) => (
      PHASE_PRIORITY[health.phase] > PHASE_PRIORITY[worst]
        ? health.phase
        : worst
    ),
    'live',
  );
}

/** The worst transport phase alone — the half of the summary that needs no
 * clock. The overlay lays its rails out under this word, so it must not be
 * paid for with a per-second render; the silence beside it is the banner's
 * own leaf (`deriveStreamHealthSummary`). */
export function deriveStreamHealthPhase(
  channels: StreamHealthChannels,
): StreamHealthPhase {
  return worstPhase(presentChannels(channels));
}

/** Collapse independent chain/cells transports without confusing their state
 * with CKB node sync. The worst transport phase wins; channel attribution
 * remains explicit so a healthy stream is never painted as failed. */
export function deriveStreamHealthSummary(
  channels: StreamHealthChannels,
  nowMs: number,
): StreamHealthSummary {
  const entries = presentChannels(channels);
  const phase = worstPhase(entries);
  const interrupted = entries.filter(([, health]) => health.phase !== 'live');
  const affectedChannels = interrupted.map(([name]) => name);
  // Only an interrupted channel's silence is measurable: a live tracker
  // publishes lifecycle changes only, so its stamp is frozen at the instant it
  // went live and would drag the aggregate arbitrarily far back. With every
  // channel live nothing renders the age, so the aggregate stands.
  const measurable = interrupted.length > 0 ? interrupted : entries;
  const measured = measurable
    .map(([, health]) => health.lastMessageAtMs)
    .filter((at): at is number => at !== null);
  const lastMessageAgeMs = measured.length === measurable.length
    ? Math.max(0, nowMs - Math.min(...measured))
    : null;
  return {
    phase,
    affectedChannels,
    lastMessageAgeMs,
    attempt: Math.max(...entries.map(([, health]) => health.attempt)),
  };
}

export function formatStreamAge(ageMs: number | null): string {
  if (ageMs === null) return 'AWAITING FRAME';
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  // Uppercase, with `formatAge` and `formatLinkUptime`: the HUD prints one
  // time unit in one case (report A, A-13).
  if (seconds < 60) return `${seconds}S`;
  return `${Math.floor(seconds / 60)}M ${seconds % 60}S`;
}

export function formatStreamChannels(
  channels: readonly (keyof StreamHealthChannels)[],
): string {
  return channels.length === 0
    ? 'CHAIN + CELLS'
    : channels.map((channel) => channel.toUpperCase()).join(' + ');
}
