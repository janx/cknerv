import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import StreamHealthBanner, {
  streamHealthPresentation,
} from '../../../src/components/hud/StreamHealthBanner';
import type { StreamHealthSummary } from '../../../src/derives/streamHealth.derive';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

function summary(over: Partial<StreamHealthSummary> = {}): StreamHealthSummary {
  return {
    phase: 'retrying',
    affectedChannels: ['chain'],
    lastMessageAgeMs: 4_000,
    attempt: 0,
    nodeFault: null,
    ...over,
  };
}

describe('StreamHealthBanner', () => {
  it('says nothing at all while every channel is live', () => {
    const { container } = render(
      <StreamHealthBanner summary={summary({ phase: 'live', affectedChannels: [] })} />,
    );
    expect(container.querySelector('[data-stream-health-banner]')).toBeNull();
  });

  it('gives each phase its own word', () => {
    const words: Record<string, string> = {};
    for (const phase of ['connecting', 'retrying', 'resyncing', 'stale'] as const) {
      cleanup();
      const { container } = render(
        <StreamHealthBanner summary={summary({ phase })} reducedMotion />,
      );
      const band = container.querySelector('[data-stream-health-banner]');
      expect(band?.getAttribute('data-stream-phase')).toBe(phase);
      words[phase] = band?.textContent ?? '';
    }
    expect(words.connecting).toContain('CONNECTING DATA PLANE');
    expect(words.retrying).toContain('STREAM INTERRUPTED');
    expect(words.resyncing).toContain('RECONCILING SNAPSHOT');
    expect(words.stale).toContain('DATA FROZEN');
  });

  it('draws the frozen frame for the frozen state and for no other', () => {
    for (const phase of ['connecting', 'retrying', 'resyncing'] as const) {
      cleanup();
      const { container } = render(<StreamHealthBanner summary={summary({ phase })} />);
      expect(
        container.querySelector('[data-stream-stale-frame]'),
        `${phase} drew the frozen frame`,
      ).toBeNull();
    }
    cleanup();
    const { container } = render(
      <StreamHealthBanner summary={summary({ phase: 'stale' })} />,
    );
    expect(container.querySelector('[data-stream-stale-frame]')).not.toBeNull();
  });

  it('names the cause when the page knows it, in the same register', () => {
    // The node channel is the one channel the browser has no socket for, so
    // its outage is the one the page can name rather than merely observe.
    const { container } = render(
      <StreamHealthBanner
        summary={summary({
          phase: 'stale',
          affectedChannels: ['chain', 'node'],
          nodeFault: { kind: 'unreachable' },
        })}
        reducedMotion
      />,
    );
    const band = container.querySelector('[data-stream-health-banner]');
    expect(band?.textContent).toContain('NODE UNREACHABLE');
    expect(band?.textContent).not.toContain('DATA FROZEN');
    expect(band?.textContent).toContain('CHAIN + NODE');
    // Same colour, same band, same frame — only the sentence changed.
    expect(container.querySelector('[data-stream-stale-frame]')).not.toBeNull();
    expect(streamHealthPresentation(
      summary({ phase: 'stale', affectedChannels: ['node'], nodeFault: { kind: 'unreachable' } }),
    )?.color).toBe(HUD_COLORS.danger);
  });

  it('names the quarantined view, in the server\'s words and the HUD\'s case', () => {
    const { container } = render(
      <StreamHealthBanner
        summary={summary({
          phase: 'stale',
          affectedChannels: ['node'],
          nodeFault: { kind: 'quarantined', projections: ['cells'] },
        })}
        reducedMotion
      />,
    );
    const band = container.querySelector('[data-stream-health-banner]');
    expect(band?.textContent).toContain('PROJECTION QUARANTINED · CELLS');
    expect(band?.textContent).not.toContain('DATA FROZEN');
    expect(band?.textContent).not.toContain('NODE UNREACHABLE');
    // The frozen register, whole: same hue, same band, same frame.
    expect(streamHealthPresentation(summary({
      phase: 'stale',
      affectedChannels: ['node'],
      nodeFault: { kind: 'quarantined', projections: ['cells'] },
    }))?.color).toBe(HUD_COLORS.danger);
    expect(container.querySelector('[data-stream-stale-frame]')).not.toBeNull();
    // Two views quarantined at once is one sentence, joined the way the
    // channel line joins two channels.
    expect(streamHealthPresentation(summary({
      phase: 'stale',
      affectedChannels: ['node'],
      nodeFault: { kind: 'quarantined', projections: ['cells', 'semantics'] },
    }))?.title).toBe('PROJECTION QUARANTINED · CELLS + SEMANTICS');
  });

  it('keeps DATA FROZEN when the node is not the reason', () => {
    // A frozen socket with a healthy node is still the consequence, and the
    // consequence is all the page can honestly claim.
    expect(streamHealthPresentation(
      summary({ phase: 'stale', affectedChannels: ['chain', 'cells'] }),
    )?.title).toBe('DATA FROZEN');
    // …and a node channel that is merely one of several RETRYING channels does
    // not borrow the frozen word either: the override is the frozen register's.
    expect(streamHealthPresentation(
      summary({ phase: 'retrying', affectedChannels: ['node'], nodeFault: { kind: 'unreachable' } }),
    )?.title).toBe('STREAM INTERRUPTED');
    // A node channel present and WELL while another socket froze is DATA
    // FROZEN too: the cause the band names is a cause the channel handed over,
    // not the mere fact that a node channel is subscribed.
    expect(streamHealthPresentation(
      summary({ phase: 'stale', affectedChannels: ['chain', 'node'] }),
    )?.title).toBe('DATA FROZEN');
  });

  it('breathes only while frozen, and never against a reduced-motion visitor', () => {
    const animation = (phase: StreamHealthSummary['phase'], reduced: boolean) => {
      cleanup();
      const { container } = render(
        <StreamHealthBanner summary={summary({ phase })} reducedMotion={reduced} />,
      );
      return (container.querySelector('[data-stream-health-banner]') as HTMLElement)
        ?.style.animation ?? '';
    };
    expect(animation('stale', false)).toContain('cknerv-hud-breathe');
    expect(animation('stale', true)).toBe('');
    expect(animation('retrying', false)).toBe('');
  });
});
