import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import type { CellsStats } from '../../derives/cellsStats.derive';
import { ASSET_COLORS, LOCK_COLORS } from './cellFormat';
import AssetEcosystemReadout from './AssetEcosystemReadout';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { ScopeStage, StatRow } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');

function formatStateBytes(shannons: number): string {
  const bytes = shannons / 1e8; // 1 CKByte of capacity = 1 byte of on-chain state
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

type Bucket = { key: string; label: string; color: string; count: number };

function TaxonomyBar({ title, buckets }: { title: string; buckets: Bucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total <= 0) return null;
  const nonZero = buckets.filter((bucket) => bucket.count > 0);
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.5, color: '#6b7f8e', textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: 'flex', height: 6, border: '1px solid rgba(255,152,48,.2)', background: '#0a0a0a' }}>
        {buckets.map((bucket) => bucket.count > 0 ? (
          <span
            key={bucket.key}
            style={{ width: `${(bucket.count / total) * 100}%`, background: bucket.color }}
          />
        ) : null)}
      </div>
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#9fb0bd', marginTop: 3, lineHeight: 1.5 }}>
        {nonZero
          .map((bucket) => `${bucket.label} ${Math.round((bucket.count / total) * 100)}%`)
          .join(' · ')}
      </div>
    </div>
  );
}

function GalaxyWindow({ stats }: { stats: CellsStats }) {
  return (
    <ScopeStage
      id="galaxy-window"
      label="GALAXY WINDOW"
      meta={`${fmt(stats.inView)} RETAINED CELLS`}
      accent={HUD_COLORS.cyanWire}
      terminal
    >
      <div aria-label="Retained Cell capacity" data-retained-capacity-context>
        <StatRow label="Window capacity">{formatStateBytes(stats.capacityShannons)} state</StatRow>
        <TaxonomyBar title="WINDOW ASSETS" buckets={[
          { key: 'native', label: 'CKB', color: ASSET_COLORS.native, count: stats.byAsset.native },
          { key: 'sudt', label: 'sUDT', color: ASSET_COLORS.sudt, count: stats.byAsset.sudt },
          { key: 'xudt', label: 'xUDT', color: ASSET_COLORS.xudt, count: stats.byAsset.xudt },
          { key: 'dao', label: 'DAO', color: ASSET_COLORS.dao, count: stats.byAsset.dao },
          { key: 'spore', label: 'NFT', color: ASSET_COLORS.spore, count: stats.byAsset.spore },
          { key: 'other', label: '?', color: ASSET_COLORS.other, count: stats.byAsset.other },
        ]} />
        <TaxonomyBar title="WINDOW LOCKS" buckets={[
          { key: 'sighash', label: 'sighash', color: LOCK_COLORS.sighash, count: stats.byLock.sighash },
          { key: 'multisig', label: 'multisig', color: LOCK_COLORS.multisig, count: stats.byLock.multisig },
          { key: 'acp', label: 'ACP', color: LOCK_COLORS.acp, count: stats.byLock.acp },
          { key: 'omnilock', label: 'omni', color: LOCK_COLORS.omnilock, count: stats.byLock.omnilock },
          { key: 'other', label: '?', color: LOCK_COLORS.other, count: stats.byLock.other },
        ]} />
      </div>
    </ScopeStage>
  );
}

/** One chain-level capacity slot: direct-node Galaxy data in the base view,
 * upgraded to whole-chain → Galaxy scope when enrichment is usable. */
export default function ChainCapacityReadout({ stats, source, record }: {
  stats: CellsStats;
  source?: EnrichmentSourceStatus;
  record?: AssetEcosystemRecord | null;
}) {
  const galaxyWindow = <GalaxyWindow stats={stats} />;
  return (
    <AssetEcosystemReadout
      source={source}
      record={record}
      fallback={(
        <section
          aria-label="Galaxy capacity window"
          data-cell-capacity-mode="retained"
          style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,152,48,.12)' }}
        >
          {galaxyWindow}
        </section>
      )}
      retainedContext={galaxyWindow}
    />
  );
}
