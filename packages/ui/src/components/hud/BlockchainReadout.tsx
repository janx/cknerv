import type { CSSProperties } from 'react';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ChainEntry,
  DaoStateRecord,
  EnrichmentSourceStatus,
  ProtocolEraRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import type { CellsStats } from '../../derives/cellsStats.derive';
import { computeRollingStats } from '../CkbNetworkHud';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';
import ActivityFeedReadout from './ActivityFeedReadout';
import DaoStateReadout from './DaoStateReadout';
import ProtocolEraBadge from './ProtocolEraBadge';
import TransactionHorizonReadout from './TransactionHorizonReadout';
import ChainCapacityReadout from './ChainCapacityReadout';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BlockchainReadout({ chain, cellsStats, enrichmentSource, assetEcosystem, protocolEra, daoState, activityFeed, transactionHorizon, compactActivity = false, style }: {
  chain: ChainEntry;
  cellsStats: CellsStats;
  enrichmentSource?: EnrichmentSourceStatus;
  assetEcosystem?: AssetEcosystemRecord | null;
  protocolEra?: ProtocolEraRecord | null;
  daoState?: DaoStateRecord | null;
  activityFeed?: ActivityFeedRecord | null;
  transactionHorizon?: TransactionHorizonRecord | null;
  compactActivity?: boolean;
  style?: CSSProperties;
}) {
  const { tps } = computeRollingStats(chain);
  const ep = chain.epoch;
  return (
    <HudPanel style={{ width: 340, ...style }}>
      <PanelHeader en="COMMON KNOWLEDGE BASE" cjk="共识记忆" idx="CKB·01" />
      <StatRow label="Tip"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 13, color: '#fff' }}>#{fmt(chain.tip)}</span></StatRow>
      <StatRow label="Epoch">
        {ep.number}.{ep.index}/{ep.length}
        <ProtocolEraBadge chain={chain} source={enrichmentSource} record={protocolEra} />
      </StatRow>
      <StatRow label="Blocks">{fmt(chain.total_blocks)}</StatRow>
      <StatRow label="Txs">{fmt(chain.total_txs)}</StatRow>
      <StatRow label="Tps 60s">
        {tps.toFixed(2)}
      </StatRow>
      <StatRow label="Mempool">{chain.mempool.pending} · {chain.mempool.proposed}</StatRow>
      <StatRow label="Reorgs" valueColor={chain.reorgs > 0 ? HUD_COLORS.danger : undefined}>{chain.reorgs}</StatRow>
      <ChainCapacityReadout
        stats={cellsStats}
        source={enrichmentSource}
        record={assetEcosystem}
      />
      <DaoStateReadout source={enrichmentSource} record={daoState} />
      <TransactionHorizonReadout
        source={enrichmentSource}
        record={transactionHorizon}
        compact={compactActivity}
      />
      <ActivityFeedReadout source={enrichmentSource} record={activityFeed} compact={compactActivity} />
    </HudPanel>
  );
}
