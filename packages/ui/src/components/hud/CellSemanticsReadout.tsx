import type { CSSProperties } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticAttribute,
  SemanticContentDecode,
  SemanticFacet,
} from '@cknerv/types';
import {
  STORAGE_TIER_COLORS,
  formatSemanticAssetAmount,
  midTruncate,
} from './cellFormat';
import {
  OBJECT_SEGMENT_LABELS,
  decodeSegmentValue,
} from '../../derives/cellSemanticMorphology.derive';
import { HUD_COLORS, HUD_TYPE, rgba } from './hudTheme';

export { formatSemanticAssetAmount } from './cellFormat';

export type CellSemanticsPhase =
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'error';

// ——— Cluster evidence fragments ————————————————————————————————————————
// The CKBYTES ANALYSIS window organizes enrichment by SUBJECT: each scan fact
// is the headline of its cluster and these fragments are the evidence rows
// beneath it. The old source-organized readout assemblies (scanIntegrated /
// spatial / complete) died with the CELL IDENTITY window; what survives here
// is exactly what the clusters mount.

export function enrichmentSourceColor(
  status: EnrichmentSourceStatus['status'],
): string {
  switch (status) {
    case 'ready': return HUD_COLORS.nominal;
    case 'connecting':
    case 'syncing': return HUD_COLORS.cyanWire;
    case 'stale': return HUD_COLORS.caution;
    case 'incompatible':
    case 'error': return HUD_COLORS.danger;
    case 'disabled': return HUD_COLORS.dim;
  }
}

/** The scan-window phrasing for a phase without a record — the clusters
 *  degrade to bare fact buttons plus exactly this one honest line. */
export function enrichmentStatusMessage(
  phase: CellSemanticsPhase | undefined,
  message?: string | null,
): string | null {
  switch (phase) {
    case 'loading': return 'RESOLVING SELECTED CELL…';
    case 'waiting': return message ?? 'WAITING FOR VALIDATED CONTEXT';
    case 'unavailable': return message ?? 'NO VALIDATED RECORD FOR THIS CELL';
    case 'error': return message ?? 'CELL IDENTITY CONTEXT UNAVAILABLE';
    default: return null;
  }
}

/** One label→value evidence row (OWNER, AMOUNT, ASSET, PROOF, CREATED). */
export function EvidenceFact({
  label,
  value,
  displayValue,
  color,
  valueSize = HUD_TYPE.label,
  style,
}: {
  label: string;
  value: string;
  displayValue?: string;
  color?: string;
  valueSize?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      data-cell-context-fact={label.toLowerCase()}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0,1fr)',
        alignItems: 'baseline',
        gap: 6,
        minWidth: 0,
        ...style,
      }}
    >
      <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span title={value} style={{ minWidth: 0, color: color ?? HUD_COLORS.ink, fontSize: valueSize, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayValue ?? value}
      </span>
    </div>
  );
}

function facetTitle(facet: SemanticFacet): string {
  switch (facet.kind) {
    case 'dao': return 'DAO POSITION';
    case 'dep_group': return 'DEP GROUP';
    case 'code_cell': return 'CODE CELL';
    case 'collection': return 'COLLECTION';
    case 'composition': return 'COMPOSITION';
    default: return facet.namespace === 'cell_data'
      ? `DATA · ${facet.kind.replaceAll('_', ' ')}`
      : facet.kind.replaceAll('_', ' ');
  }
}

function facetAttributeLabel(key: string): string {
  return key.replace(/^member_/, 'member ').replaceAll('_', ' ').toUpperCase();
}

/** The record's leading facet — for a DAO cell this is the DAO position. */
export function primarySemanticFacet(
  record: CellSemanticRecord,
): SemanticFacet | null {
  const matchingType = record.cell_type
    ? record.facets.find((facet) => facet.kind === record.cell_type)
    : undefined;
  if (matchingType) return matchingType;
  const priority = ['dao', 'dep_group', 'code_cell'];
  for (const kind of priority) {
    const match = record.facets.find((facet) => facet.kind === kind);
    if (match) return match;
  }
  return record.facets[0] ?? null;
}

/** One-line facet summary (title · state · first attributes). */
export function FacetEvidenceRow({ facet, style }: {
  facet: SemanticFacet;
  style?: CSSProperties;
}) {
  const attributes = facet.attributes.slice(0, 2);
  return (
    <div
      data-cell-context-facet={`${facet.namespace}:${facet.kind}`}
      style={{ minWidth: 0, padding: '2px 6px 3px', borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.22)}`, ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: HUD_COLORS.cyanWire, fontSize: HUD_TYPE.micro, letterSpacing: 0.6, whiteSpace: 'nowrap' }}>
          {facetTitle(facet).toUpperCase()}
        </span>
        {facet.state ? (
          <span title={facet.state} style={{ color: HUD_COLORS.caution, fontSize: HUD_TYPE.micro, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · {facet.state.toUpperCase()}
          </span>
        ) : null}
      </div>
      {attributes.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7, marginTop: 1, minWidth: 0 }}>
          {attributes.map((attribute) => (
            <span key={attribute.key} title={`${facetAttributeLabel(attribute.key)} · ${attribute.value}${attribute.unit ? ` ${attribute.unit}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: HUD_TYPE.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro }}>{facetAttributeLabel(attribute.key)} </span>
              {attribute.value}{attribute.unit ? ` ${attribute.unit}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One facet attribute, read BY KEY. Facets grow: the DAO facet gained three
 *  timestamp keys AFTER the five it shipped with, so anything that reads an
 *  attribute by position is reading a different fact the day upstream appends
 *  one. */
export function semanticFacetAttribute(
  facet: SemanticFacet | null | undefined,
  key: string,
): SemanticAttribute | null {
  return facet?.attributes.find((attribute) => attribute.key === key) ?? null;
}

/** A facet attribute's value with its unit, or null when the key is absent. */
export function semanticFacetValue(
  facet: SemanticFacet | null | undefined,
  key: string,
): string | null {
  const attribute = semanticFacetAttribute(facet, key);
  if (!attribute) return null;
  return attribute.unit
    ? `${attribute.value} ${attribute.unit}`
    : attribute.value;
}

/** A facet attribute parsed as a finite number, or null. Attribute values are
 *  strings on the wire; a block height that fails to parse is unknown, never
 *  zero. */
export function semanticFacetNumber(
  facet: SemanticFacet | null | undefined,
  key: string,
): number | null {
  const attribute = semanticFacetAttribute(facet, key);
  if (!attribute) return null;
  const value = Number(attribute.value);
  return Number.isFinite(value) ? value : null;
}

// ——— Storage composition ————————————————————————————————————————————————
//
// Where a digital object's content physically lives is the durability axis of
// its value: fully on the chain, split across Bitcoin and CKB, leaning on a
// decentralized network somebody else keeps up, or depending on one operator's
// HTTPS server. That is a MEASUREMENT the index's decode worker makes, never a
// claim the Cell carries, so the vocabulary below is ckbadger's own and this
// file only translates it into HUD type — same five tiers, same five
// sentences, so an object explained on either surface is explained in the same
// words.
//
// `unknown` means NOT YET MEASURED. It is emphatically not "off-chain": an
// object the worker has not reached yet is unread, and printing that as a
// verdict about its storage would be inventing the one fact these rows exist
// to state.
//
// The COLOURS are `STORAGE_TIER_COLORS` and are argued where they live, beside
// the rest of the cell palette. What matters here is why this file no longer
// picks them one at a time: the five tiers are an ORDINAL, so they are one
// ramp chosen together, and choosing them one at a time is how four of them
// ended up on reserved layers — a health tone in the middle and `ember` at the
// bottom, which railed and washed an IPFS-hosted Spore's card in the treatment
// a degraded state gets everywhere else. A weaker promise is not a fault.

type CompositionTierReadout = {
  /** ckbadger's `formatCompositionTier` label, uppercased into HUD type. */
  label: string;
  color: string;
  /** ckbadger's tooltip sentence, verbatim. */
  description: string;
};

const COMPOSITION_TIERS: Readonly<Record<string, CompositionTierReadout>> = {
  pure_ckb: {
    label: 'PURE CKB',
    color: STORAGE_TIER_COLORS.pure_ckb,
    description: 'All content is stored directly on the CKB blockchain (on-chain data or ckbfs://). Fully verifiable and permanent.',
  },
  btc_ckb: {
    label: 'BTC+CKB',
    color: STORAGE_TIER_COLORS.btc_ckb,
    description: 'Content is stored across both CKB (on-chain data or ckbfs://) and Bitcoin (btcfs://). Fully verifiable and permanent.',
  },
  decentralized_mixture: {
    label: 'DECENTRALIZED MIXTURE',
    color: STORAGE_TIER_COLORS.decentralized_mixture,
    description: 'Some content references external decentralized storage (e.g. IPFS, Arweave). Data persists as long as the external network hosts it.',
  },
  centralized_mixture: {
    label: 'CENTRALIZED MIXTURE',
    color: STORAGE_TIER_COLORS.centralized_mixture,
    description: 'Some content depends on centralized servers (http/https). Data availability relies on the server operator.',
  },
  unknown: {
    label: 'UNKNOWN',
    color: STORAGE_TIER_COLORS.unknown,
    description: 'Composition could not be determined. The content storage method for objects in this cluster is unverified.',
  },
};

/** The table entry for a tier, and only for a tier this side actually knows.
 *  Own keys only: a wire string that happens to name something on
 *  `Object.prototype` would otherwise come back as a truthy object with no
 *  label, no colour and no sentence in it. */
function compositionTier(tier: string): CompositionTierReadout | null {
  return Object.hasOwn(COMPOSITION_TIERS, tier)
    ? COMPOSITION_TIERS[tier]
    : null;
}

/** The tier's name in HUD type. A spelling this side does not know is printed
 *  as upstream spelled it — the index owns this vocabulary, and a sixth tier
 *  arriving is a word we have not learned yet, never a decode failure. */
export function compositionTierLabel(tier: string): string {
  return compositionTier(tier)?.label
    ?? tier.replaceAll('_', ' ').toUpperCase();
}

/** The tier's colour. An unrecognized tier reads the `unknown` rung, because
 *  both say the same thing: nothing here has been established. A sixth tier
 *  arriving from upstream lands at the quiet end of the ramp rather than
 *  somewhere off it. */
export function compositionTierColor(tier: string): string {
  return compositionTier(tier)?.color ?? STORAGE_TIER_COLORS.unknown;
}

/** The sentence explaining what the tier means for the object's durability. An
 *  unrecognized tier falls back to the `unknown` sentence, mirroring the
 *  index's own default. */
export function compositionTierDescription(tier: string): string {
  return (compositionTier(tier) ?? COMPOSITION_TIERS.unknown).description;
}

/** One line naming WHAT an inventory Cell holds — `image/png · 6,878 B`, a
 *  cluster's name, a .bit account, an mNFT's token index. Only the kinds that
 *  actually carry an object answer; a DAO deposit or a plain transfer has no
 *  object and says nothing here rather than restating its decode. */
export function semanticObjectReadout(
  record: CellSemanticRecord | null | undefined,
): string | null {
  const decode = record?.content?.deterministic;
  if (!decode) return null;
  const kind = decode.kind.toLowerCase();
  const summary = decode.summary.trim() || null;
  const totalBytes = record?.content?.total_bytes;
  const bytes = typeof totalBytes === 'number' && totalBytes > 0
    ? `${totalBytes.toLocaleString('en-US')} B`
    : null;
  if (kind.includes('cluster')) {
    return decodeSegmentValue(decode, OBJECT_SEGMENT_LABELS.clusterName)
      ?? summary;
  }
  if (kind.startsWith('spore') || kind.includes('dob')) {
    const contentType = decodeSegmentValue(
      decode,
      OBJECT_SEGMENT_LABELS.contentType,
    );
    return [contentType, bytes].filter(Boolean).join(' · ') || summary;
  }
  if (kind.includes('dotbit') || kind.includes('bit_account')) {
    return decodeSegmentValue(decode, OBJECT_SEGMENT_LABELS.account) ?? summary;
  }
  if (kind.includes('nft')) {
    const token = decodeSegmentValue(decode, OBJECT_SEGMENT_LABELS.token);
    return token ? `#${token.replace(/^#/, '')}` : summary;
  }
  return null;
}

/** Decoded asset amount headline — `123.45 NTT` — or null when unknown. */
export function semanticAssetAmountReadout(
  record: CellSemanticRecord,
): string | null {
  if (record.asset?.amount == null) return null;
  return `${formatSemanticAssetAmount(
    record.asset.amount,
    record.asset.decimals,
  )}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`;
}

/** Asset identity line — `NTT · Nervos Test Token · xUDT` — or null. */
export function semanticAssetIdentityReadout(
  record: CellSemanticRecord,
): string | null {
  if (!record.asset) return null;
  return [record.asset.symbol, record.asset.name, record.asset.standard]
    .filter(Boolean)
    .join(' · ') || midTruncate(record.asset.type_script_hash, 10, 8);
}
