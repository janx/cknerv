import type { CSSProperties } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticFacet,
  SemanticScript,
} from '@cknerv/types';
import { formatSemanticAssetAmount } from './cellFormat';
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

export function compactMiddle(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

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

/** Script evidence WITHOUT the display-name headline — in the cluster IA the
 *  interactive fact button above already says the name, so the evidence only
 *  carries what the button cannot: hashes, args and the lifecycle chip. */
export function ScriptEvidence({ role, script, style }: {
  role: 'LOCK' | 'TYPE';
  script: SemanticScript;
  style?: CSSProperties;
}) {
  const state = script.deprecated === true
    ? 'DEPRECATED'
    : script.deprecated === false
      ? 'ACTIVE'
      : null;
  const stateColor = script.deprecated ? HUD_COLORS.danger : HUD_COLORS.nominal;
  return (
    <div
      data-cell-context-script={role.toLowerCase()}
      style={{
        minWidth: 0,
        padding: '3px 6px 4px',
        borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.22)}`,
        background: `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.035)},transparent)`,
        ...style,
      }}
    >
      <div
        data-cell-context-script-evidence
        style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: '2px 7px', minWidth: 0, fontSize: HUD_TYPE.micro, lineHeight: 1.4 }}
      >
        <span style={{ color: HUD_COLORS.dim }}>IDENTITY</span>
        <span title={script.script_hash} style={{ color: HUD_COLORS.cyanWire, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compactMiddle(script.script_hash, 12, 9)}</span>
        {state ? (
          <span style={{ color: stateColor, letterSpacing: 0.62, textAlign: 'right' }}>{state}</span>
        ) : <span />}
        <span style={{ color: HUD_COLORS.dim }}>CODE·{script.hash_type.toUpperCase()}</span>
        <span title={script.code_hash} style={{ gridColumn: '2 / -1', color: HUD_COLORS.cyanWire, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compactMiddle(script.code_hash, 12, 9)}</span>
        <span style={{ color: HUD_COLORS.dim }}>ARGS</span>
        <span title={script.args} style={{ gridColumn: '2 / -1', color: HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compactMiddle(script.args, 14, 10)}</span>
      </div>
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
            <span key={attribute.key} title={`${facetAttributeLabel(attribute.key)} · ${attribute.value}${attribute.unit ? ` ${attribute.unit}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: HUD_TYPE.micro, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: HUD_COLORS.dim }}>{facetAttributeLabel(attribute.key)} </span>
              {attribute.value}{attribute.unit ? ` ${attribute.unit}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
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
    .join(' · ') || compactMiddle(record.asset.type_script_hash);
}
