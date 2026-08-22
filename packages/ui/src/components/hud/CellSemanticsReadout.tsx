import type { CSSProperties } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticAttribute,
  SemanticContentDecode,
  SemanticFacet,
} from '@cknerv/types';
import { formatSemanticAssetAmount, midTruncate } from './cellFormat';
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
      <span style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.72, whiteSpace: 'nowrap' }}>
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
        <span style={{ color: HUD_COLORS.cyanWire, fontSize: HUD_TYPE.micro, letterSpacing: 0.75, whiteSpace: 'nowrap' }}>
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

/** Segment labels an inventory decode may spell its payload with. ckbadger
 *  owns the vocabulary, so each fact lists the spellings we know and any
 *  decode that uses none of them falls back to its own summary rather than
 *  letting us invent a reading. */
const OBJECT_SEGMENT_LABELS = {
  contentType: ['content_type', 'contenttype', 'content-type', 'mime_type', 'mime'],
  clusterName: ['cluster_name', 'name', 'cluster'],
  account: ['account', 'account_name', 'domain', 'name'],
  token: ['token_index', 'token_id', 'index', 'token'],
} as const;

function decodeSegmentValue(
  decode: SemanticContentDecode,
  labels: readonly string[],
): string | null {
  for (const label of labels) {
    const segment = decode.segments.find((candidate) => (
      candidate.label.toLowerCase().replaceAll('-', '_') === label
        .replaceAll('-', '_')
    ));
    const value = segment?.value.trim();
    if (value) return value;
  }
  return null;
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
