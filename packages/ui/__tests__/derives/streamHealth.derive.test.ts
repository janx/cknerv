import { describe, expect, it } from 'vitest';
import type { StreamHealth } from '@cknerv/cache';

import {
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
});

describe('stream health formatting', () => {
  it('formats channel attribution and bounded ages', () => {
    expect(formatStreamChannels(['chain', 'cells'])).toBe('CHAIN + CELLS');
    expect(formatStreamAge(67_800)).toBe('1m 7s');
  });
});
