import type {
  EnrichmentSourceStatus,
  ForkWatchRecord,
} from '@cknerv/types';
import {
  deriveForkWatchVisual,
  forkWatchVisualState,
  type ForkWatchSignal,
} from '../../derives/forkWatch.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { StatRow } from './primitives';

const fmt = (value: number) => value.toLocaleString('en-US');

function windowLabel(seconds: number): string {
  if (seconds === 86_400) return '24H';
  if (seconds % 86_400 === 0) return `${seconds / 86_400}D`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}H`;
  if (seconds % 60 === 0) return `${seconds / 60}M`;
  return `${seconds}S`;
}

function ageLabel(detectedAtMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor((nowMs - detectedAtMs) / 1_000));
  if (seconds < 60) return 'NOW';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function signalLabel(signal: ForkWatchSignal, window: string): string {
  switch (signal) {
    case 'deep': return 'DEEP FORK';
    case 'recent_deep': return 'RECENT DEEP FORK';
    case 'recent': return 'RECENT REORG';
    case 'clear': return `CLEAR ${window}`;
  }
}

function signalColor(signal: ForkWatchSignal, stale: boolean): string {
  if (signal === 'deep' || signal === 'recent_deep') return HUD_COLORS.danger;
  if (signal === 'recent') return HUD_COLORS.warning;
  return stale ? HUD_COLORS.caution : HUD_COLORS.nominal;
}

export default function ForkWatchReadout({ source, record }: {
  source?: EnrichmentSourceStatus;
  record?: ForkWatchRecord | null;
}) {
  if (!source || !record) return null;
  const visualState = forkWatchVisualState(source, record);
  const visual = deriveForkWatchVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const window = windowLabel(record.recent_window_seconds);
  const accent = signalColor(visual.signal, stale);

  return (
    <section
      aria-label="Indexed fork watch"
      data-fork-watch-state={visualState}
      data-fork-watch-signal={visual.signal}
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: `1px solid ${rgba(accent, 0.18)}`,
        opacity: stale ? 0.68 : 1,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: HUD_FONTS.tech,
        fontSize: 7.5,
        letterSpacing: 1.25,
        color: accent,
        textTransform: 'uppercase',
        marginBottom: visual.signal === 'clear' ? 0 : 5,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
        INDEXED FORK WATCH · {signalLabel(visual.signal, window)}
        {stale ? ' · STALE' : ''}
      </div>
      {visual.signal !== 'clear' ? (
        <>
          <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 7.5, color: HUD_COLORS.dim, letterSpacing: 0.35, marginBottom: 4 }}>
            CKBADGER · {window} WINDOW · ANCHOR #{fmt(record.as_of.block)}
          </div>
          {visual.deepFork ? (
            <>
              <StatRow label="Detected">{ageLabel(visual.deepFork.detected_at_ms)}</StatRow>
              <StatRow label="Fork point">#{fmt(visual.deepFork.fork_point)}</StatRow>
              <StatRow label="Index / chain">#{fmt(visual.deepFork.indexed_tip)} / #{fmt(visual.deepFork.chain_tip)}</StatRow>
              <StatRow label="Depth" valueColor={accent}>{fmt(visual.deepFork.depth)} blocks</StatRow>
            </>
          ) : visual.recentReorg ? (
            <>
              <StatRow label="Detected">{ageLabel(visual.recentReorg.detected_at_ms)}</StatRow>
              <StatRow label="Fork point">#{fmt(visual.recentReorg.fork_point)}</StatRow>
              <StatRow label="Tip rewrite">#{fmt(visual.recentReorg.old_tip)} → #{fmt(visual.recentReorg.new_tip)}</StatRow>
              <StatRow label="Depth" valueColor={accent}>{fmt(visual.recentReorg.depth)} blocks</StatRow>
              <StatRow label="Orphaned">{fmt(visual.recentReorg.orphaned_blocks)} blk · {fmt(visual.recentReorg.orphaned_transactions)} tx</StatRow>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
