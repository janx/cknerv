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
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatStreamChannels(
  channels: readonly (keyof StreamHealthChannels)[],
): string {
  return channels.length === 0
    ? 'CHAIN + CELLS'
    : channels.map((channel) => channel.toUpperCase()).join(' + ');
}
