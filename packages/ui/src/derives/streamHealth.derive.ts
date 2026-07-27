import type {
  StreamHealth,
  StreamHealthPhase,
} from '@cknerv/cache';

export interface StreamHealthChannels {
  chain: StreamHealth;
  cells: StreamHealth;
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

/** Collapse independent chain/cells transports without confusing their state
 * with CKB node sync. The worst transport phase wins; channel attribution
 * remains explicit so a healthy stream is never painted as failed. */
export function deriveStreamHealthSummary(
  channels: StreamHealthChannels,
  nowMs: number,
): StreamHealthSummary {
  const entries = Object.entries(channels) as Array<
    [keyof StreamHealthChannels, StreamHealth]
  >;
  const phase = entries.reduce<StreamHealthPhase>(
    (worst, [, health]) => (
      PHASE_PRIORITY[health.phase] > PHASE_PRIORITY[worst]
        ? health.phase
        : worst
    ),
    'live',
  );
  const affectedChannels = phase === 'live'
    ? []
    : entries
      .filter(([, health]) => health.phase !== 'live')
      .map(([name]) => name);
  const measured = entries
    .map(([, health]) => health.lastMessageAtMs)
    .filter((at): at is number => at !== null);
  const lastMessageAgeMs = measured.length === entries.length
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
