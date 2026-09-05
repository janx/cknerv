import { describe, expect, it } from 'vitest';
import type { StreamHealth } from '@cknerv/cache';

import {
  deriveNodeStreamHealth,
  deriveStreamHealthSummary,
  formatStreamAge,
  formatStreamChannels,
} from '../../src/derives/streamHealth.derive';

function health(
  phase: StreamHealth['phase'],
  lastMessageAtMs: number | null,
  attempt = 0,
): StreamHealth {
  return { phase, lastMessageAtMs, attempt, reason: null };
}

describe('deriveStreamHealthSummary', () => {
  it('keeps both live streams nominal and reports the older heartbeat age', () => {
    const summary = deriveStreamHealthSummary({
      chain: health('live', 9_000),
      cells: health('live', 8_000),
    }, 10_000);

    expect(summary).toEqual({
      phase: 'live',
      affectedChannels: [],
      lastMessageAgeMs: 2_000,
      attempt: 0,
    });
  });

  it('lets stale win while attributing every non-live channel explicitly', () => {
    const summary = deriveStreamHealthSummary({
      chain: health('retrying', 7_000, 2),
      cells: health('stale', 6_000, 3),
    }, 10_000);

    expect(summary.phase).toBe('stale');
    expect(summary.affectedChannels).toEqual(['chain', 'cells']);
    expect(summary.attempt).toBe(3);
    expect(summary.lastMessageAgeMs).toBe(4_000);
  });

  it('does not invent freshness before both transports receive a frame', () => {
    const summary = deriveStreamHealthSummary({
      chain: health('connecting', null),
      cells: health('live', 9_000),
    }, 10_000);
    expect(summary.lastMessageAgeMs).toBeNull();
    expect(formatStreamAge(summary.lastMessageAgeMs)).toBe('AWAITING FRAME');
  });

  it('surfaces a dead semantics stream while the core streams stay live', () => {
    const summary = deriveStreamHealthSummary({
      chain: health('live', 9_000),
      cells: health('live', 9_500),
      semantics: health('stale', 2_000, 4),
    }, 10_000);

    expect(summary.phase).toBe('stale');
    expect(summary.affectedChannels).toEqual(['semantics']);
    expect(summary.attempt).toBe(4);
    expect(formatStreamChannels(summary.affectedChannels)).toBe('SEMANTICS');
  });

  it('times the frozen channel, not a live one whose stamp stopped advancing', () => {
    // A live tracker publishes lifecycle changes only, so `chain`/`cells` still
    // carry the stamp from the instant they went live — here, session start.
    // The banner must report how long SEMANTICS has been silent.
    const summary = deriveStreamHealthSummary({
      chain: health('live', 1_000),
      cells: health('live', 1_200),
      semantics: health('stale', 9_000, 2),
    }, 10_000);

    expect(summary.lastMessageAgeMs).toBe(1_000);
  });

  it('behaves identically with the optional channel absent or undefined', () => {
    const twoChannels = deriveStreamHealthSummary({
      chain: health('live', 9_000),
      cells: health('live', 8_000),
    }, 10_000);
    const explicitUndefined = deriveStreamHealthSummary({
      chain: health('live', 9_000),
      cells: health('live', 8_000),
      semantics: undefined,
    }, 10_000);
    expect(explicitUndefined).toEqual(twoChannels);
  });
});

describe('stream health formatting', () => {
  it('formats channel attribution and bounded ages', () => {
    expect(formatStreamChannels(['chain', 'cells'])).toBe('CHAIN + CELLS');
    expect(formatStreamAge(67_800)).toBe('1M 7S');
  });
});

describe('the node channel', () => {
  const probe = (
    over: Partial<Parameters<typeof deriveNodeStreamHealth>[0]> = {},
  ) => deriveNodeStreamHealth({
    degraded: false,
    adapters: [{ name: 'cknerv-adapter-ckb', alive: true }],
    tipAgeMs: 4_000,
    ...over,
  }, 10_000);

  it('is live while the server is well, and stamps the tip it last saw', () => {
    expect(probe()).toEqual({
      phase: 'live',
      attempt: 0,
      lastMessageAtMs: 6_000,
      reason: null,
    });
  });

  it('freezes the moment the adapter to the node is gone', () => {
    const health = probe({
      degraded: true,
      adapters: [{ name: 'cknerv-adapter-ckb', alive: false }],
    });
    expect(health.phase).toBe('stale');
    expect(health.reason).toBe('closed');
    // No dwell and no attempt count: the supervisor it reads flips an adapter
    // dead once and never back, so one reading is already settled.
    expect(health.attempt).toBe(0);
  });

  it('does not blame the node for a fault that is not the node\'s', () => {
    // `degraded` is true for a quarantined projection too, and a quarantined
    // projection is a SERVER fault. The adapter list is the reading.
    expect(probe({ degraded: true }).phase).toBe('live');
  });

  it('reports a tip it has never seen as no stamp rather than as age zero', () => {
    expect(probe({ tipAgeMs: null }).lastMessageAtMs).toBeNull();
  });

  it('lets the node channel carry the summary and name itself', () => {
    const summary = deriveStreamHealthSummary({
      chain: health('live', 9_500),
      cells: health('live', 9_400),
      node: probe({
        degraded: true,
        adapters: [{ name: 'cknerv-adapter-ckb', alive: false }],
      }),
    }, 10_000);
    expect(summary.phase).toBe('stale');
    expect(summary.affectedChannels).toEqual(['node']);
    expect(formatStreamChannels(summary.affectedChannels)).toBe('NODE');
    // The age the band prints is the tip's own, which is the whole point of
    // carrying `tip_age_ms` as the stamp.
    expect(summary.lastMessageAgeMs).toBe(4_000);
  });
});
