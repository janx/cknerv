import type {
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
} from '@cknerv/types';
import {
  deriveProtocolEraVisual,
  protocolEraVisualState,
} from '../../derives/protocolEra.derive';
import { HUD_COLORS } from './hudTheme';

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
        verticalAlign: 'bottom',
        color: stale ? HUD_COLORS.caution : HUD_COLORS.orange,
        fontSize: 9,
        letterSpacing: 0.35,
        opacity: stale ? 0.68 : 1,
      }}
    >
      <span aria-hidden="true" style={{ color: HUD_COLORS.dim }}>· </span>
      {visual.label}
    </span>
  );
}
