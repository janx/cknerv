import type { CSSProperties } from 'react';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import type { CellPopulationFieldModel } from '../../derives/cellPopulationField.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';
import ActivityFeedReadout from './ActivityFeedReadout';
import ProtocolEraBadge from './ProtocolEraBadge';
import TransactionHorizonReadout from './TransactionHorizonReadout';
import ChainCapacityReadout from './ChainCapacityReadout';
import { formatEpochReadout } from './epochReadout';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BlockchainReadout({ chain, cellPopulation, enrichmentSource, assetEcosystem, protocolEra, activityFeed, transactionHorizon, compactActivity = false, style }: {
  chain: ChainEntry;
  /** Population model, or null for a consumer that derives none. Absent means
   *  the panel is absent — it never guesses a scope. */
  cellPopulation?: CellPopulationFieldModel | null;
  enrichmentSource?: EnrichmentSourceStatus;
  assetEcosystem?: AssetEcosystemRecord | null;
  protocolEra?: ProtocolEraRecord | null;
  activityFeed?: ActivityFeedRecord | null;
  transactionHorizon?: TransactionHorizonRecord | null;
  compactActivity?: boolean;
  style?: CSSProperties;
}) {
  const epoch = formatEpochReadout(chain.epoch);
  return (
    <HudPanel style={{ width: 340, ...style }}>
      <PanelHeader en="COMMON KNOWLEDGE BASE" cjk="共识基" idx="CKB·01" />
      {/* The tip is a display-family number that changes every few seconds, so
          it asks for tabular figures — otherwise the `#` and everything after
          it shifts a pixel or two at each block and the panel's top line never
          quite settles. */}
      <StatRow label="Tip"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: HUD_TYPE.emphasis, fontVariantNumeric: 'tabular-nums', color: HUD_COLORS.heroInk }}>#{fmt(chain.tip)}</span></StatRow>
      <StatRow label="Epoch">
        <span data-epoch-number>{epoch.number}</span>
        <ProtocolEraBadge chain={chain} source={enrichmentSource} record={protocolEra} />
      </StatRow>
      <StatRow label="Epoch progress">
        <span data-epoch-progress title="current block index / epoch length">
          {epoch.progress}
        </span>
      </StatRow>
      <StatRow label="Mempool">{chain.mempool.pending} · {chain.mempool.proposed}</StatRow>
      <StatRow label="Reorgs" valueColor={chain.reorgs > 0 ? HUD_COLORS.danger : undefined}>{chain.reorgs}</StatRow>
      {/* Chain truth only. The dashboard's local slice is a different scope
          and lives on the mesh rail as the STAGE CAPACITY panel. */}
      <ChainCapacityReadout
        source={enrichmentSource}
        record={assetEcosystem}
        census={cellPopulation?.chainCensus ?? null}
        censusStale={cellPopulation?.censusStale ?? false}
      />
      <TransactionHorizonReadout
        source={enrichmentSource}
        record={transactionHorizon}
        compact={compactActivity}
      />
      <ActivityFeedReadout source={enrichmentSource} record={activityFeed} compact={compactActivity} />
    </HudPanel>
  );
}
