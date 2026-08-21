import type { CSSProperties } from 'react';
import type { ScriptRegistryRecord } from '@cknerv/types';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { CellPopulationFieldModel } from '../../derives/cellPopulationField.derive';
import {
  assetFamilyBuckets,
  hasScriptCensus,
  lockFamilyBuckets,
  type ScriptFamilyBucket,
} from '../../derives/scriptFamilies.derive';
import { ASSET_COLORS, CLASS_MIX_COLORS, LOCK_COLORS, formatCkb } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';
import {
  formatPopulationCount,
  populationCompositionMixes,
  populationMediumRows,
  populationRows,
  type CompositionMix,
} from './cellPopulation.presentation';

/** Mainnet is 99% one lock family, so every other family rounds to zero and a
 *  bar naming 120 real cells would read "JoyID 0%" — present in the legend and
 *  claiming to be absent. A bucket that exists says so. */
function share(count: number, total: number): string {
  const pct = (count / total) * 100;
  return pct < 0.5 ? '<1%' : `${Math.round(pct)}%`;
}

/** Scope qualifiers sit right after their labels, never in a third column:
 *  a trailing column of tags gives every value its own right edge, and the
 *  panel stops reading as one table. */
const SCOPE_TAG: CSSProperties = {
  fontFamily: HUD_FONTS.tech,
  fontSize: 7,
  letterSpacing: 1.1,
  color: HUD_COLORS.dim,
  textTransform: 'uppercase',
  opacity: 0.8,
};

const SUBHEAD: CSSProperties = {
  fontFamily: HUD_FONTS.tech,
  fontSize: 7.5,
  letterSpacing: 1.5,
  color: '#6b7f8e',
  textTransform: 'uppercase',
  marginBottom: 4,
};

/** One bar over the retained set's families, legend naming only what a
 *  reader can see. Mainnet's retained window is 99% one family, so a legend
 *  listing every sub-percent name is a list of things the bar does not show;
 *  they collapse into one honest tail count, with the full breakdown on
 *  the bar's tooltip. */
function TaxonomyBar({ title, buckets }: { title: string; buckets: ScriptFamilyBucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total <= 0) return null;
  const nonZero = buckets.filter((bucket) => bucket.count > 0);
  let named = nonZero.filter((bucket) => (bucket.count / total) * 100 >= 0.5);
  if (named.length === 0) {
    named = [[...nonZero].sort((a, b) => b.count - a.count)[0]];
  }
  const tail = nonZero.filter((bucket) => !named.includes(bucket));
  const tailFamilies = tail.reduce((sum, bucket) => sum + bucket.families, 0);
  const full = nonZero
    .map((bucket) => `${bucket.label} ${share(bucket.count, total)}`)
    .join(' · ');
  return (
    <div style={{ marginTop: 7 }} title={full}>
      <div style={SUBHEAD}>{title}</div>
      <div style={{ display: 'flex', height: 6, border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.14)}`, background: '#0a0a0a' }}>
        {nonZero.map((bucket) => (
          <span
            key={bucket.key}
            style={{ width: `${(bucket.count / total) * 100}%`, background: bucket.color }}
          />
        ))}
      </div>
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#9fb0bd', marginTop: 3, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {named.map((bucket) => `${bucket.label} ${share(bucket.count, total)}`).join(' · ')}
        {tailFamilies > 0 ? (
          <span style={{ color: HUD_COLORS.dim }}>{` · +${tailFamilies} <1%`}</span>
        ) : null}
      </div>
    </div>
  );
}

/** One funnel step: a scoped count over a depth bar. The bars share one
 *  scale, so the top-down narrowing from observed window to addressable
 *  bodies is read from the staircase, not computed from the digits. */
function FunnelRow({ label, value, scope, widthPct, alpha }: {
  label: string;
  value: string;
  scope: string;
  widthPct: number;
  alpha: number;
}) {
  return (
    <div data-population-row={label}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, height: 15, whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8.5, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
          {label}
        </span>
        <span data-population-scope style={SCOPE_TAG}>{scope}</span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 11, color: HUD_COLORS.ink }}>
          {value}
        </span>
      </div>
      <div style={{ position: 'relative', height: 3, background: rgba(HUD_COLORS.cyanWire, 0.07), margin: '1px 0 4px' }}>
        <span
          data-funnel-fill={label}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${widthPct}%`,
            background: HUD_COLORS.cyanWire,
            opacity: alpha,
          }}
        />
      </div>
    </div>
  );
}

/** One composition row: the class shares as text, then the same shares as a
 *  tri-segment bar with the measurement's own tag beside it. Bar hues repeat
 *  the chain capacity bar's category hues — DAO, token-like, bare CKB — so
 *  the two capacity surfaces read as one color system. A segment holding
 *  real Cells keeps a visible sliver even when its share rounds below a
 *  pixel. */
function MixBar({ mix }: { mix: CompositionMix }) {
  const total = mix.counts.dao + mix.counts.typed + mix.counts.plain;
  const segments = [
    { key: 'dao', label: 'DAO', count: mix.counts.dao, text: mix.dao, color: CLASS_MIX_COLORS.dao },
    { key: 'typed', label: 'TYPED', count: mix.counts.typed, text: mix.typed, color: CLASS_MIX_COLORS.typed },
    { key: 'plain', label: 'PLAIN', count: mix.counts.plain, text: mix.plain, color: CLASS_MIX_COLORS.plain },
  ];
  return (
    <div data-population-mix={mix.label} style={{ opacity: mix.dim ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, height: 14, whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8, letterSpacing: 1.4, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
          {mix.label}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 8.5 }}>
          {segments.map((segment, index) => (
            <span key={segment.key}>
              {index > 0 ? <span style={{ color: HUD_COLORS.dim }}>{' · '}</span> : null}
              <span style={{ color: segment.color }}>{`${segment.label} ${segment.text}`}</span>
            </span>
          ))}
        </span>
      </div>
      {/* The tag slot is fixed-width so the two bars share both edges —
          comparing the mixes IS this block's job, and bars of different
          lengths would turn a proportion contrast into a length artifact. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '1px 0 5px' }}>
        <div style={{ flex: 1, display: 'flex', height: 4, background: '#0a0a0a', border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.1)}` }}>
          {segments.map((segment) => segment.count > 0 ? (
            <span
              key={segment.key}
              data-mix-segment={segment.key}
              style={{
                width: `${total > 0 ? (segment.count / total) * 100 : 0}%`,
                minWidth: 1,
                background: segment.color,
              }}
            />
          ) : null)}
        </div>
        <span style={{ ...SCOPE_TAG, flex: '0 0 84px', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mix.scope}</span>
      </div>
    </div>
  );
}

/**
 * The dashboard's own aperture: everything true of the local slice on stage,
 * as its own instrument beside CELL MESH — never a nested child of the chain
 * panel, whose numbers are a different scope.
 *
 * The Galaxy renders as a whole organism, so a viewer reasonably reads it as
 * CKB's Cell set. This panel is where that reading is corrected: the funnel
 * shows how the local windows narrow down to the addressable bodies, every
 * count carries the scope it is true in, the mix rows disclose the stage's
 * curation beside the chain's real composition, and the medium legend
 * explains the swarm before anyone tries to click it.
 */
export default function StageCapacityPanel({ stats, scriptRegistry, model, style }: {
  stats: CellsStats;
  scriptRegistry?: ScriptRegistryRecord | null;
  /** Population model, or null for a consumer that derives none. The funnel,
   *  mixes, and medium legend then stay absent — the panel never guesses a
   *  scope. */
  model?: CellPopulationFieldModel | null;
  style?: CSSProperties;
}) {
  // The backend counts the retained set by script identity; those bars are
  // the real distribution. The four-family bars below them are what cknerv
  // can classify on its own, and they are the fallback for a backend that
  // has not counted yet — never a second opinion shown alongside.
  const census = hasScriptCensus(stats.scripts) ? stats.scripts : null;
  const rows = model ? populationRows(model) : [];
  const funnelMax = Math.max(...rows.map((row) => row.count), 1);
  const mixes = model ? populationCompositionMixes(model) : [];

  return (
    <HudPanel style={{ width: 302, ...style }}>
      <PanelHeader en="STAGE SAMPLE" cjk="样本" idx="STAGE·07" accent={HUD_COLORS.cyanWire} />
      <div
        aria-label="Stage capacity"
        data-stage-capacity
        data-population-scope-claim={model ? model.scope : undefined}
      >
        <StatRow label="Capacity">
          <span title="Sum of capacity over retained live Cells · 1 CKB = 1 CKByte of state">
            {formatCkb(stats.capacityShannons)}
          </span>
        </StatRow>

        <div style={{ marginTop: 4 }}>
          {rows.length > 0 ? rows.map((row, index) => (
            <FunnelRow
              key={row.label}
              label={row.label}
              value={row.value}
              scope={row.scope}
              widthPct={(row.count / funnelMax) * 100}
              // Brightness fades as the scope widens: the addressable set is
              // the bright end of the same medium the legend describes.
              alpha={rows.length === 1 ? 0.9 : 0.9 - 0.62 * (index / (rows.length - 1))}
            />
          )) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, height: 15, whiteSpace: 'nowrap' }}>
              <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8.5, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
                Retained
              </span>
              <span data-population-scope style={SCOPE_TAG}>LOCAL WINDOW</span>
              <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: 11, color: HUD_COLORS.ink }}>
                {formatPopulationCount(stats.inView)}
              </span>
            </div>
          )}
        </div>

        {mixes.length > 0 ? (
          <div style={{ marginTop: 5 }}>
            {mixes.map((mix) => <MixBar key={mix.label} mix={mix} />)}
          </div>
        ) : null}

        <TaxonomyBar title="ASSETS" buckets={census
          ? assetFamilyBuckets(census, scriptRegistry)
          : [
            { key: 'native', label: 'CKB', color: ASSET_COLORS.native, count: stats.byAsset.native, named: true, families: 1 },
            { key: 'sudt', label: 'sUDT', color: ASSET_COLORS.sudt, count: stats.byAsset.sudt, named: true, families: 1 },
            { key: 'xudt', label: 'xUDT', color: ASSET_COLORS.xudt, count: stats.byAsset.xudt, named: true, families: 1 },
            { key: 'dao', label: 'DAO', color: ASSET_COLORS.dao, count: stats.byAsset.dao, named: true, families: 1 },
            { key: 'spore', label: 'NFT', color: ASSET_COLORS.spore, count: stats.byAsset.spore, named: true, families: 1 },
            { key: 'other', label: '?', color: ASSET_COLORS.other, count: stats.byAsset.other, named: false, families: 1 },
          ]} />
        <TaxonomyBar title="LOCKS" buckets={census
          ? lockFamilyBuckets(census, scriptRegistry)
          : [
            { key: 'sighash', label: 'default', color: LOCK_COLORS.sighash, count: stats.byLock.sighash, named: true, families: 1 },
            { key: 'multisig', label: 'multisig', color: LOCK_COLORS.multisig, count: stats.byLock.multisig, named: true, families: 1 },
            { key: 'acp', label: 'ACP', color: LOCK_COLORS.acp, count: stats.byLock.acp, named: true, families: 1 },
            { key: 'omnilock', label: 'omni', color: LOCK_COLORS.omnilock, count: stats.byLock.omnilock, named: true, families: 1 },
            { key: 'other', label: '?', color: LOCK_COLORS.other, count: stats.byLock.other, named: false, families: 1 },
          ]} />

        {model ? (
          <div
            data-population-medium
            style={{ marginTop: 7, fontFamily: HUD_FONTS.mono, fontSize: 8, lineHeight: 1.6, color: HUD_COLORS.dim }}
          >
            {populationMediumRows(model).map((entry) => (
              <div key={entry.term} style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontFamily: HUD_FONTS.tech, fontSize: 7.5, letterSpacing: 1.2, textTransform: 'uppercase', minWidth: 84 }}>
                  {entry.term}
                </span>
                <span>{entry.meaning}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </HudPanel>
  );
}
