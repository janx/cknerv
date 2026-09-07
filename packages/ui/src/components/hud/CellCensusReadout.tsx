import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
  ScriptFamilyCensusRecord,
} from '@cknerv/types';
import { assetEcosystemVisualState } from '../../derives/assetEcosystem.derive';
import {
  chainInventoryBuckets,
  scriptFamilyCensusVisualState,
} from '../../derives/scriptFamilies.derive';
import { formatCkb, formatExactCkb } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba, STALE_OPACITY } from './hudTheme';
import { ReadoutHeader, SCOPE_TAG, StatRow } from './primitives';
import TaxonomyBar from './TaxonomyBar';
import { chainLiveRow } from './cellPopulation.presentation';

function formatCkbAmount(shannons: string): string {
  try {
    return formatCkb(BigInt(shannons));
  } catch {
    return `${shannons} sh`;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return `${bytes} B`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * The census of the chain's Cells: how many are alive, what they are made
 * of, the capacity they stand in and the knowledge standing in it.
 * Everything true of the whole chain, and
 * nothing true of this dashboard's local slice — that slice is STAGE·07's
 * whole subject, and the two are a census and a sample of one population,
 * which is why the section is named for the census and the panel for the
 * sample.
 *
 * Four rulings shaped the bar. It was CHAIN CAPACITY, named for its first
 * row, with the index's capacity split drawn under the count — DAO 14%,
 * TOKENS 0.08%, OBJECTS 0.03%, OTHER 85%, true of the CKB and silent about
 * the Cells. Then, briefly, CHAIN STATE with the count split three ways,
 * DAO · TYPED · PLAIN, which is the partition and not the composition: a
 * third of the chain's Cells are typed, and "typed" says nothing about
 * which of thirty families they belong to. Then the stage's two
 * script-family taxonomies at chain scope, six families named and the rest
 * folded, with a LOCKS bar beside them. The user struck the lock bar and
 * asked for the index's own inventory instead: the ASSETS bar is now the
 * chain by ckbadger's menu — CKB, then TOKENS · OBJECTS · IDENTITIES as its
 * Inventory pages classify them, the DAO, and SCRIPTS for every other typed
 * Cell — read from the index's whole-chain family counts, each family
 * classified by the index's own token registry and its object and identity
 * standards, with nothing added to the index for it.
 *
 * Three independent measurements meet here: the indexed asset-ecosystem
 * record, the validated Cell census, and the index's family census. Each is
 * exact at its own anchor, and none of that reaches the panel: the header
 * carried `AS OF #n` for a day, the count and the bar carried `CHAIN · AS OF
 * #n`, and the user struck every one of them as noise — a block number
 * beside a reading is not a fact a reader acts on. What each still says is
 * STALE when its own record has gone stale, because that is the one thing a
 * reader must not miss. Any of the three can be missing; the section
 * renders when at least one exists, and renders nothing sooner than a number
 * it cannot prove.
 */
export default function CellCensusReadout({
  source,
  record,
  census = null,
  censusStale = false,
  scriptFamilyCensus = null,
  folded = false,
}: {
  source?: EnrichmentSourceStatus;
  record?: AssetEcosystemRecord | null;
  census?: ChainCensus | null;
  censusStale?: boolean;
  scriptFamilyCensus?: ScriptFamilyCensusRecord | null;
  /** The rail has collapsed (`RAILS_COLLAPSE_MAX_WIDTH_PX`): the section is
   *  its own header and the
   *  count in it, nothing more. Distinct from `compact`, which is the SHORT
   *  viewport's answer and keeps whatever the section can still afford —
   *  a narrow stage and a short one are two different shortages, and a panel
   *  that answered both with the same form would be guessing at one of them. */
  folded?: boolean;
}) {
  const visualState = source && record ? assetEcosystemVisualState(source, record) : null;
  const usableRecord = visualState ? record! : null;
  const familyState = source && scriptFamilyCensus
    ? scriptFamilyCensusVisualState(source, scriptFamilyCensus)
    : null;
  const families = familyState ? scriptFamilyCensus! : null;
  if (!usableRecord && !census && !families) return null;

  const stale = visualState === 'stale';
  // The same accent its two siblings wear, and for the same reason they wear
  // it: CELL CENSUS, TX HORIZON and ACTIVITY are three stacked sections of
  // one panel about the chain, and not one of them is reporting health. This
  // one opened in `nominal` — so of three identical headers, the top one had a
  // green lamp beside it and the two under it did not, which reads as a
  // verdict about the section rather than as the section's own colour.
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.cyanWire;
  const liveCells = chainLiveRow(census, censusStale);
  const familyStale = familyState === 'stale';

  if (folded) {
    // Header and the one count the section is read for. `LIVE n` rather than
    // the capacity/knowledge pair: a collapsed rail keeps the reading a reader
    // came to the panel for, and the census is the only figure here that is
    // not derivable from another section's.
    return (
      <section
        aria-label="Cell census"
        data-cell-census
        data-cell-census-folded="true"
        data-asset-ecosystem-state={visualState ?? undefined}
        style={{
          marginTop: 6,
          paddingTop: 5,
          borderTop: `1px solid ${rgba(accent, 0.16)}`,
        }}
      >
        <ReadoutHeader
          title="CELL CENSUS"
          meta={`${liveCells.value} LIVE`}
          accent={accent}
          stale={stale}
          compact
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Cell census"
      data-cell-census
      data-asset-ecosystem-state={visualState ?? undefined}
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: `1px solid ${rgba(accent, 0.16)}`,
      }}
    >
      <ReadoutHeader
        title="CELL CENSUS"
        accent={accent}
        stale={stale}
      />
      {usableRecord ? (
        <div data-indexed-context style={{ opacity: stale ? STALE_OPACITY : 1 }}>
          {/* Both rows count in CKBytes — capacity is the bytes the chain has
            * SOLD and knowledge the bytes standing in them — and both say so
            * on hover rather than in the row. The unit carried its Chinese
            * name here for a while and it is the dossier's `CKBYTE` zone that
            * keeps that job: a rail row is read for its NUMBER, and a word
            * between the label and the figure is one more thing to read past
            * on every glance. */}
          <StatRow label="Live capacity">
            <span title={`${formatExactCkb(usableRecord.total_live_capacity_shannons)} · 1 CKB = 1 CKByte of state`}>
              {formatCkbAmount(usableRecord.total_live_capacity_shannons)}
            </span>
          </StatRow>
          <StatRow label="Knowledge">
            <span title="Bytes standing in the capacity above · 1 CKB = 1 CKByte of state">
              {formatBytes(usableRecord.total_knowledge_bytes)}
            </span>
          </StatRow>
        </div>
      ) : null}
      <div
        data-population-row="Chain live"
        style={{ display: 'flex', alignItems: 'baseline', gap: 6, height: 17, whiteSpace: 'nowrap', opacity: liveCells.dim ? 0.6 : 1 }}
      >
        <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: HUD_TYPE.tech, letterSpacing: 1.6, color: HUD_COLORS.dim, textTransform: 'uppercase' }}>
          Live cells
        </span>
        {liveCells.tag ? (
          <span data-population-scope style={SCOPE_TAG}>
            {liveCells.tag}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.value, color: HUD_COLORS.ink }}>
          {liveCells.value}
        </span>
      </div>
      {families ? (
        // The chain by the index's own menu. Indexed context, like the
        // capacity rows: it dims on its own record's staleness, never on the
        // census row's, and it is absent — never a guess — until the index
        // has counted every family and said which inventory each one is.
        <div data-indexed-context data-chain-taxonomy style={{ opacity: familyStale ? STALE_OPACITY : 1 }}>
          <TaxonomyBar
            title="ASSETS"
            scope={familyStale ? 'STALE' : undefined}
            buckets={chainInventoryBuckets(families)}
          />
        </div>
      ) : null}
    </section>
  );
}
