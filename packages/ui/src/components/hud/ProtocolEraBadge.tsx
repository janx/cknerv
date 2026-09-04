import type {
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
} from '@cknerv/types';
import {
  deriveProtocolEraVisual,
  protocolEraVisualState,
} from '../../derives/protocolEra.derive';
import { HUD_COLORS, HUD_TYPE, STALE_OPACITY } from './hudTheme';

export default function ProtocolEraBadge({ chain, source, record }: {
  chain: ChainEntry;
  source?: EnrichmentSourceStatus;
  record?: ProtocolEraRecord | null;
}) {
  if (!source || !record) return null;
  const state = protocolEraVisualState(source, record);
  const visual = deriveProtocolEraVisual(record, chain);
  if (!state || !visual) return null;
  const stale = state === 'stale';
  const title = stale ? `${visual.title} (stale)` : visual.title;

  return (
    <span
      aria-label={`Protocol era ${visual.label}${stale ? ', stale' : ''}`}
      data-protocol-era-state={state}
      data-protocol-era-label={visual.label}
      title={title}
      style={{
        display: 'inline-block',
        marginLeft: 4,
        maxWidth: 125,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        // `textOverflow` does nothing without this: a spaced label wraps
        // inside the inline-block instead of ellipsizing, and only a label
        // with no space in it — which every era name has so far been —
        // happened to look right (report F, F-17).
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
        // A fact about the chain — which consensus rules are in force —
        // printed beside the epoch number it qualifies nothing about, so it
        // reads in the same plain ink that number does. It used to be chrome
        // orange while fresh and caution yellow while stale: the instrument's
        // own frame colour on a reading, flipping to a severity tone for a
        // record that had merely aged. Staleness is already said three ways
        // here — the title, the aria-label and the opacity below.
        color: HUD_COLORS.ink,
        fontSize: HUD_TYPE.label,
        letterSpacing: 0.35,
        opacity: stale ? STALE_OPACITY : 1,
      }}
    >
      <span aria-hidden="true" style={{ color: HUD_COLORS.dim }}>· </span>
      {visual.label}
    </span>
  );
}
