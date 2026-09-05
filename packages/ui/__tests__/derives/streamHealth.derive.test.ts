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
      nodeFault: null,
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
    quarantinedProjections: [],
    ...over,
  }, 10_000);

  it('is live while the server is well, and stamps the tip it last saw', () => {
    expect(probe()).toEqual({
      phase: 'live',
      attempt: 0,
      lastMessageAtMs: 6_000,
      reason: null,
      fault: null,
    });
  });

  it('freezes the moment the adapter to the node is gone', () => {
    const health = probe({
      degraded: true,
      adapters: [{ name: 'cknerv-adapter-ckb', alive: false }],
    });
    expect(health.phase).toBe('stale');
    expect(health.reason).toBe('closed');
    expect(health.fault).toEqual({ kind: 'unreachable' });
    // No dwell and no attempt count: the supervisor it reads flips an adapter
    // dead once and never back, so one reading is already settled.
    expect(health.attempt).toBe(0);
  });

  it('does not blame the node for a fault that is not the node\'s', () => {
    // `degraded` is true for a quarantined projection too, and the adapter
    // list is what says whether the NODE is the reason. With nothing named in
    // the roster there is no reading here at all.
    expect(probe({ degraded: true }).phase).toBe('live');
    expect(probe({ degraded: true }).fault).toBeNull();
  });

  it('freezes with its own word when a view of the chain stopped being built', () => {
    const health = probe({ degraded: true, quarantinedProjections: ['cells'] });
    // Same register as the node's own outage — a panel is showing a number
    // that will not change again — and a different cause.
    expect(health.phase).toBe('stale');
    expect(health.fault).toEqual({ kind: 'quarantined', projections: ['cells'] });
    // `lagged`, not `closed`: nothing closed. A quarantined projection is a
    // view that stopped keeping up with the mutations behind it.
    expect(health.reason).toBe('lagged');
  });

  it('ranks a node that is gone above a view that stopped', () => {
    // Both true. The graver one is the one worth an errand, and the ranking is
    // the channel's rather than the banner's.
    expect(probe({
      degraded: true,
      adapters: [{ name: 'cknerv-adapter-ckb', alive: false }],
      quarantinedProjections: ['cells', 'semantics'],
    }).fault).toEqual({ kind: 'unreachable' });
  });

  it('reads the roster only through the gate the server states', () => {
    // A roster with nothing wrong beside it is not a quarantine: `degraded` is
    // the server's own answer to "is one of these worth reading", and a body
    // that contradicts itself is read the calm way.
    expect(probe({ quarantinedProjections: ['cells'] }).phase).toBe('live');
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
    // …and the CAUSE rides with it. Folding it into the phase would lose it,
    // and the banner is handed nothing but this summary.
    expect(summary.nodeFault).toEqual({ kind: 'unreachable' });
  });

  it('carries no cause at all when no node channel is subscribed', () => {
    const summary = deriveStreamHealthSummary({
      chain: health('stale', 5_000),
      cells: health('live', 9_400),
    }, 10_000);
    expect(summary.nodeFault).toBeNull();
  });
});
