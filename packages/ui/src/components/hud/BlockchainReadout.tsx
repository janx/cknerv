import { memo, type CSSProperties } from 'react';
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

/** CKB·01's measure, and the one it takes once the rail has collapsed.
 *
 * `HudOverlay` sizes the panel's wrapper from these too — a panel and the
 * scroll pane around it disagreeing about how wide the panel is was how the
 * pane came to hide the panel's bottom bracket behind a 5 px bar — so they are
 * stated once, here, beside the sections that fold. A header and its count is
 * a shorter line than `LIVE CAPACITY 57.96 G·CKB`, which is what lets the
 * folded panel be narrower at all; and the rail's WIDTH is the whole point of
 * a collapse, because the stage the rail is stealing from is the product. */
export const CHAIN_PANEL_WIDTH_PX = 340;
export const CHAIN_PANEL_DENSE_WIDTH_PX = 268;

function BlockchainReadout({ chain, cellPopulation, enrichmentSource, assetEcosystem, protocolEra, activityFeed, transactionHorizon, compactActivity = false, folded = false, style }: {
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
  /** The rail has collapsed (`RAILS_COLLAPSE_MAX_WIDTH_PX`): the three
   *  sections under the chain rows
   *  fold to their headers and their counts, so the panel stops scrolling
   *  behind a 5 px bar and its bottom bracket stays on screen. The five chain
   *  rows above them do not fold — tip, epoch, mempool and reorgs are what
   *  CKB·01 IS. */
  folded?: boolean;
  style?: CSSProperties;
}) {
  const epoch = formatEpochReadout(chain.epoch);
  return (
    <HudPanel style={{ width: folded ? CHAIN_PANEL_DENSE_WIDTH_PX : CHAIN_PANEL_WIDTH_PX, ...style }}>
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
        folded={folded}
      />
      <TransactionHorizonReadout
        source={enrichmentSource}
        record={transactionHorizon}
        compact={compactActivity}
        folded={folded}
      />
      <ActivityFeedReadout
        source={enrichmentSource}
        record={activityFeed}
        compact={compactActivity}
        folded={folded}
      />
    </HudPanel>
  );
}

// Memoized with the other rail panels: the overlay re-renders for its own
// state (a panel toggle, the boot count-off, a rail overflow flip) and used to
// tick a clock at its root, and every one of those carried this panel with it.
// With its style hoisted to a constant, the shallow compare lets it render
// exactly when the chain or a record it prints changed.
export default memo(BlockchainReadout);
