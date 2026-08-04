import type {
  EnrichmentSourceStatus,
  ForkWatchDeepFork,
  ForkWatchRecord,
  ForkWatchReorg,
} from '@cknerv/types';

export type ForkWatchVisualState = 'ready' | 'stale' | 'incompatible';
export type ForkWatchSignal = 'clear' | 'recent' | 'recent_deep' | 'deep';

export const FORK_WATCH_STALE_AFTER_MS = 45_000;
export const FORK_WATCH_MAX_WINDOW_SECONDS = 31 * 24 * 60 * 60;

export interface ForkWatchVisual {
  signal: ForkWatchSignal;
  recentReorg: ForkWatchReorg | null;
  deepFork: ForkWatchDeepFork | null;
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Suppress fork context whose optional source or canonical proof is unusable. */
export function forkWatchVisualState(
  source: EnrichmentSourceStatus,
  record: ForkWatchRecord,
  nowMs = Date.now(),
): ForkWatchVisualState | null {
  if (!source.capabilities.includes('fork_watch')) return null;
  if (source.source !== record.source) return null;
  if (!safeNonnegativeInteger(record.updated_at_ms)) return null;
  const ageMs = Math.max(0, nowMs - record.updated_at_ms);
  if (source.status === 'incompatible') {
    // An active deep fork necessarily makes the indexed database incompatible.
    // Its record is still safe to show because the adapter independently
    // proves the reported live-chain tip against cknerv's canonical evidence.
    return record.deep_fork && ageMs <= FORK_WATCH_STALE_AFTER_MS
      ? 'incompatible'
      : null;
  }
  if (source.status !== 'ready' && source.status !== 'stale') return null;
  const anchor = source.validated_anchor;
  if (!anchor
    || !safeNonnegativeInteger(anchor.block)
    || !safeNonnegativeInteger(record.as_of.block)
    || record.as_of.block > anchor.block) return null;
  if (record.as_of.block === anchor.block && record.as_of.hash !== anchor.hash) {
    return null;
  }
  return source.status === 'stale' || ageMs > FORK_WATCH_STALE_AFTER_MS
    ? 'stale'
    : 'ready';
}

function validReorg(record: ForkWatchRecord, reorg: ForkWatchReorg): boolean {
  const counts = [
    reorg.detected_at_ms,
    reorg.fork_point,
    reorg.old_tip,
    reorg.new_tip,
    reorg.depth,
    reorg.orphaned_blocks,
    reorg.orphaned_transactions,
  ];
  return counts.every(safeNonnegativeInteger)
    && reorg.detected_at_ms <= record.updated_at_ms
    && reorg.depth > 0
    && reorg.depth <= 0xffff_ffff
    && reorg.fork_point <= reorg.old_tip
    && reorg.fork_point <= reorg.new_tip
    && reorg.new_tip <= record.as_of.block
    && (reorg.kind === 'reorg' || reorg.kind === 'deep');
}

function validDeepFork(
  record: ForkWatchRecord,
  reorg: ForkWatchReorg,
  deep: ForkWatchDeepFork,
): boolean {
  const counts = [
    deep.detected_at_ms,
    deep.fork_point,
    deep.indexed_tip,
    deep.chain_tip,
    deep.depth,
  ];
  return counts.every(safeNonnegativeInteger)
    && deep.detected_at_ms <= record.updated_at_ms
    && deep.depth > 0
    && deep.depth <= 0xffff_ffff
    && deep.indexed_tip >= deep.fork_point
    && deep.chain_tip >= deep.fork_point
    && deep.chain_tip === record.as_of.block
    && reorg.kind === 'deep'
    && deep.detected_at_ms === reorg.detected_at_ms
    && deep.fork_point === reorg.fork_point
    && deep.depth === reorg.depth
    && deep.indexed_tip === reorg.old_tip
    && deep.chain_tip === reorg.new_tip;
}

/** Validate the fixed recent/deep-fork record without inferring chain truth. */
export function deriveForkWatchVisual(record: ForkWatchRecord): ForkWatchVisual | null {
  if (!safeNonnegativeInteger(record.as_of.block)
    || !safeNonnegativeInteger(record.recent_window_seconds)
    || record.recent_window_seconds === 0
    || record.recent_window_seconds > FORK_WATCH_MAX_WINDOW_SECONDS) return null;

  const recentReorg = record.recent_reorg ?? null;
  if (recentReorg && !validReorg(record, recentReorg)) return null;
  const deepFork = record.deep_fork ?? null;
  if (deepFork && (!recentReorg || !validDeepFork(record, recentReorg, deepFork))) {
    return null;
  }

  const signal: ForkWatchSignal = deepFork
    ? 'deep'
    : recentReorg?.kind === 'deep'
      ? 'recent_deep'
      : recentReorg
        ? 'recent'
        : 'clear';
  return { signal, recentReorg, deepFork };
}
