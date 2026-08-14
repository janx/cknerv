import type { CSSProperties } from 'react';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ScriptRegistryRecord,
  ChainEntry,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import type { CellsStats } from '../../derives/cellsStats.derive';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';
import ActivityFeedReadout from './ActivityFeedReadout';
import ProtocolEraBadge from './ProtocolEraBadge';
import TransactionHorizonReadout from './TransactionHorizonReadout';
import ChainCapacityReadout from './ChainCapacityReadout';
import { formatEpochReadout } from './epochReadout';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BlockchainReadout({ chain, cellsStats, enrichmentSource, assetEcosystem, scriptRegistry, protocolEra, activityFeed, transactionHorizon, compactActivity = false, style }: {
  chain: ChainEntry;
  cellsStats: CellsStats;
  enrichmentSource?: EnrichmentSourceStatus;
  assetEcosystem?: AssetEcosystemRecord | null;
  scriptRegistry?: ScriptRegistryRecord | null;
  protocolEra?: ProtocolEraRecord | null;
  activityFeed?: ActivityFeedRecord | null;
  transactionHorizon?: TransactionHorizonRecord | null;
  compactActivity?: boolean;
  style?: CSSProperties;
}) {
  const epoch = formatEpochReadout(chain.epoch);
  return (
    <HudPanel style={{ width: 340, ...style }}>
      <PanelHeader en="COMMON KNOWLEDGE BASE" cjk="共识记忆" idx="CKB·01" />
      <StatRow label="Tip"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 13, color: '#fff' }}>#{fmt(chain.tip)}</span></StatRow>
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
      <ChainCapacityReadout
        stats={cellsStats}
        source={enrichmentSource}
        record={assetEcosystem}
        scriptRegistry={scriptRegistry}
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
