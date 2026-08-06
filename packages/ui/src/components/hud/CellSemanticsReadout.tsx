import type { CSSProperties } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticFacet,
  SemanticScript,
  TransactionSemanticRecord,
} from '@cknerv/types';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';

export type CellSemanticsPhase =
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'error';

function compact(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function sourceColor(status: EnrichmentSourceStatus['status']): string {
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

function ContextFact({ label, value, displayValue, color, wide = false }: {
  label: string;
  value: string;
  displayValue?: string;
  color?: string;
  wide?: boolean;
}) {
  return (
    <div
      data-cell-context-fact={label.toLowerCase()}
      style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0, padding: '2px 0 3px' }}
    >
      <span style={{ display: 'block', color: HUD_COLORS.dim, fontSize: 6.6, letterSpacing: 0.9, lineHeight: 1.2 }}>
        {label}
      </span>
      <span
        title={value}
        style={{ display: 'block', color: color ?? HUD_COLORS.ink, fontSize: 8.2, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {displayValue ?? value}
      </span>
    </div>
  );
}

function KnowledgeBar({
  record,
  summary = false,
}: {
  record: CellSemanticRecord;
  summary?: boolean;
}) {
  const knowledge = record.common_knowledge;
  if (!knowledge || knowledge.total_bytes <= 0) return null;
  const segments = [
    ['CAP', knowledge.capacity_field_bytes, HUD_COLORS.orange],
    ['LOCK', knowledge.lock_script_bytes, HUD_COLORS.cyanWire],
    ['TYPE', knowledge.type_script_bytes, HUD_COLORS.nominal],
    ['DATA', knowledge.data_bytes, HUD_COLORS.caution],
  ] as const;
  return (
    <div
      data-cell-context-fact="knowledge"
      title={segments.map(([name, bytes]) => `${name} ${bytes}B`).join(' · ')}
      style={{ minWidth: 0, marginTop: summary ? 5 : 8, paddingTop: summary ? 4 : 7, borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.13)}` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ color: HUD_COLORS.dim, fontSize: summary ? 6.8 : 6.6, letterSpacing: 0.9 }}>KNOWLEDGE</span>
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.ink, fontSize: 8.2 }}>
          {knowledge.total_bytes} bytes occupied
        </span>
      </div>
      <div style={{ display: 'flex', height: summary ? 2 : 3, gap: 1, marginTop: 2 }}>
        {segments.map(([name, bytes, color]) => (
          <span
            key={name}
            style={{
              width: `${(bytes / knowledge.total_bytes) * 100}%`,
              minWidth: bytes > 0 ? 2 : 0,
              background: color,
              boxShadow: `0 0 5px ${rgba(color, 0.35)}`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ScriptFact({ role, script }: {
  role: 'LOCK' | 'TYPE';
  script: SemanticScript;
}) {
  const identity = script.name ?? script.family ?? compact(script.code_hash);
  const state = script.deprecated === true
    ? 'DEPRECATED'
    : script.deprecated === false
      ? 'ACTIVE'
      : null;
  const stateColor = script.deprecated ? HUD_COLORS.danger : HUD_COLORS.nominal;
  return (
    <div
      data-cell-context-script={role.toLowerCase()}
      style={{ minWidth: 0, padding: '6px 8px 7px', border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.16)}`, background: `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.045)},transparent)` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: HUD_COLORS.dim, fontSize: 6.6, letterSpacing: 0.9 }}>{role} SCRIPT</span>
        <span title={identity} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: 8.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{identity}</span>
        {state ? <span style={{ marginLeft: 'auto', color: stateColor, fontSize: 6.4, letterSpacing: 0.75 }}>{state}</span> : null}
      </div>
      <div data-cell-context-script-evidence style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 9px', marginTop: 5, paddingTop: 4, borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.08)}`, fontSize: 6.8, lineHeight: 1.4 }}>
        <span style={{ color: HUD_COLORS.dim }}>IDENTITY</span>
        <span title={script.script_hash} style={{ color: HUD_COLORS.cyanWire, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact(script.script_hash, 12, 9)}</span>
        <span style={{ color: HUD_COLORS.dim }}>CODE · {script.hash_type.toUpperCase()}</span>
        <span title={script.code_hash} style={{ color: HUD_COLORS.cyanWire, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact(script.code_hash, 12, 9)}</span>
        <span style={{ color: HUD_COLORS.dim }}>ARGS</span>
        <span title={script.args} style={{ color: HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact(script.args, 14, 10)}</span>
      </div>
    </div>
  );
}

function SpatialContextFact({
  label,
  value,
  displayValue,
  color,
  wide = false,
}: {
  label: string;
  value: string;
  displayValue?: string;
  color?: string;
  wide?: boolean;
}) {
  return (
    <div
      data-cell-context-fact={label.toLowerCase()}
      style={{
        gridColumn: wide ? '1 / -1' : undefined,
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0,1fr)',
        alignItems: 'baseline',
        gap: 6,
        minWidth: 0,
      }}
    >
      <span style={{ color: HUD_COLORS.dim, fontSize: 6.6, letterSpacing: 0.72, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span title={value} style={{ minWidth: 0, color: color ?? HUD_COLORS.ink, fontSize: 8.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayValue ?? value}
      </span>
    </div>
  );
}

function SpatialScriptFact({ role, script }: {
  role: 'LOCK' | 'TYPE';
  script: SemanticScript;
}) {
  const identity = script.name ?? script.family ?? compact(script.code_hash);
  const state = script.deprecated === true
    ? 'DEPRECATED'
    : script.deprecated === false
      ? 'ACTIVE'
      : null;
  const stateColor = script.deprecated ? HUD_COLORS.danger : HUD_COLORS.nominal;
  return (
    <div
      data-cell-context-script={role.toLowerCase()}
      style={{ minWidth: 0, padding: '4px 6px', borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.22)}`, background: `linear-gradient(90deg,${rgba(HUD_COLORS.cyanWire, 0.035)},transparent)` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: HUD_COLORS.dim, fontSize: 6.6, letterSpacing: 0.75, whiteSpace: 'nowrap' }}>{role}</span>
        <span title={script.script_hash} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: 8.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{identity}</span>
        {state ? <span style={{ marginLeft: 'auto', color: stateColor, fontSize: 6.2, letterSpacing: 0.62 }}>{state}</span> : null}
      </div>
      <div
        data-cell-context-script-evidence
        style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto minmax(0,.72fr)', gap: 5, marginTop: 2, minWidth: 0, fontSize: 6.5 }}
      >
        <span style={{ color: HUD_COLORS.dim }}>CODE·{script.hash_type.toUpperCase()}</span>
        <span title={script.code_hash} style={{ color: HUD_COLORS.cyanWire, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact(script.code_hash, 7, 5)}</span>
        <span style={{ color: HUD_COLORS.dim }}>ARGS</span>
        <span title={script.args} style={{ color: HUD_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact(script.args, 6, 4)}</span>
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

function FacetDetail({ facet, index }: {
  facet: SemanticFacet;
  index: number;
}) {
  const attributes = facet.attributes.slice(0, facet.kind === 'dep_group' ? 4 : 6);
  return (
    <div
      data-cell-context-facet={`${facet.namespace}:${facet.kind}`}
      style={{ minWidth: 0, padding: '4px 6px 5px', borderLeft: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.24)}`, background: index % 2 === 0 ? rgba(HUD_COLORS.cyanWire, 0.025) : 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: HUD_COLORS.cyanWire, fontSize: 7, letterSpacing: 0.85 }}>{facetTitle(facet).toUpperCase()}</span>
        {facet.state ? (
          <span title={facet.state} style={{ marginLeft: 'auto', maxWidth: '58%', color: HUD_COLORS.caution, fontSize: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {' · '}{facet.state.toUpperCase()}
          </span>
        ) : null}
      </div>
      {attributes.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) minmax(0, 1fr)', gap: '2px 7px', marginTop: 4 }}>
          {attributes.map((attribute) => (
            <div key={attribute.key} style={{ display: 'contents' }}>
              <span style={{ color: HUD_COLORS.dim, fontSize: 6.4, letterSpacing: 0.5 }}>{facetAttributeLabel(attribute.key)}</span>
              <span title={attribute.value} style={{ color: HUD_COLORS.ink, fontSize: 7.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {attribute.value}{attribute.unit ? ` ${attribute.unit}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {facet.attributes.length > attributes.length ? (
        <div style={{ marginTop: 3, color: HUD_COLORS.dim, fontSize: 6.3 }}>
          +{facet.attributes.length - attributes.length} MORE INDEXED FIELDS
        </div>
      ) : null}
    </div>
  );
}

function primaryFacet(record: CellSemanticRecord): SemanticFacet | null {
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

function SpatialFacetSummary({ facet }: { facet: SemanticFacet }) {
  const attributes = facet.attributes.slice(0, 2);
  return (
    <div
      data-cell-context-facets="essential"
      data-cell-context-facet={`${facet.namespace}:${facet.kind}`}
      style={{ marginTop: 5, padding: '4px 5px 0', borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.13)}`, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: HUD_COLORS.cyanWire, fontSize: 7, letterSpacing: 0.75, whiteSpace: 'nowrap' }}>
          {facetTitle(facet).toUpperCase()}
        </span>
        {facet.state ? (
          <span title={facet.state} style={{ color: HUD_COLORS.caution, fontSize: 6.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · {facet.state.toUpperCase()}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', color: HUD_COLORS.dim, fontSize: 6.1, whiteSpace: 'nowrap' }}>
          PRIMARY FACET
        </span>
      </div>
      {attributes.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7, marginTop: 2, minWidth: 0 }}>
          {attributes.map((attribute) => (
            <span key={attribute.key} title={`${facetAttributeLabel(attribute.key)} · ${attribute.value}${attribute.unit ? ` ${attribute.unit}` : ''}`} style={{ minWidth: 0, color: HUD_COLORS.ink, fontSize: 6.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: HUD_COLORS.dim }}>{facetAttributeLabel(attribute.key)} </span>
              {attribute.value}{attribute.unit ? ` ${attribute.unit}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SpatialContextSummary({ record }: { record: CellSemanticRecord }) {
  const facet = primaryFacet(record);
  const assetIdentity = record.asset
    ? [record.asset.symbol, record.asset.name, record.asset.standard]
      .filter(Boolean)
      .join(' · ') || compact(record.asset.type_script_hash)
    : null;
  const assetAmount = record.asset?.amount == null
    ? null
    : `${formatSemanticAssetAmount(
      record.asset.amount,
      record.asset.decimals,
    )}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`;
  return (
    <div data-cell-context-policy="essential">
      <div
        data-cell-context-facts
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', columnGap: 10, rowGap: 4 }}
      >
        {record.address ? (
          <SpatialContextFact
            label="OWNER"
            value={record.address}
            displayValue={compact(record.address, 15, 10)}
            wide
          />
        ) : null}
        <SpatialContextFact
          label="CREATED"
          value={`#${record.observed_at_block.toLocaleString()}`}
        />
        <SpatialContextFact
          label="PROOF"
          value={`#${record.as_of.block.toLocaleString()}`}
          color={HUD_COLORS.cyanWire}
        />
        {assetIdentity ? (
          <SpatialContextFact
            label="ASSET"
            value={`${assetIdentity}${assetAmount ? ` · ${assetAmount}` : ''}`}
            color={HUD_COLORS.caution}
            wide
          />
        ) : null}
      </div>
      {record.lock_script || record.type_script ? (
        <div
          data-cell-context-scripts="true"
          style={{ display: 'grid', gap: 3, marginTop: 6 }}
        >
          {record.lock_script ? <SpatialScriptFact role="LOCK" script={record.lock_script} /> : null}
          {record.type_script ? <SpatialScriptFact role="TYPE" script={record.type_script} /> : null}
        </div>
      ) : null}
      <KnowledgeBar record={record} summary />
      {facet ? <SpatialFacetSummary facet={facet} /> : null}
    </div>
  );
}

function facetAttribute(facet: SemanticFacet | undefined, key: string): string | undefined {
  return facet?.attributes.find((attribute) => attribute.key === key)?.value;
}

function formatShannons(value: string, signed = false): string {
  try {
    const amount = BigInt(value);
    const sign = amount < 0n ? '−' : signed && amount > 0n ? '+' : '';
    const absolute = amount < 0n ? -amount : amount;
    if (absolute < 1_000_000n) return `${sign}${absolute} sh`;
    const whole = absolute / 100_000_000n;
    const fraction = ((absolute % 100_000_000n) / 1_000n)
      .toString()
      .padStart(5, '0')
      .replace(/0+$/, '');
    return `${sign}${whole}${fraction ? `.${fraction}` : ''} CKB`;
  } catch {
    return `${value} sh`;
  }
}

function formatInteger(value: string): string {
  try {
    return BigInt(value).toLocaleString('en-US');
  } catch {
    return value;
  }
}

export function formatSemanticAssetAmount(
  value: string,
  decimals?: number,
): string {
  try {
    const amount = BigInt(value);
    if (decimals == null || decimals === 0) return amount.toString();
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
      return value;
    }
    const negative = amount < 0n;
    const digits = (negative ? -amount : amount)
      .toString()
      .padStart(decimals + 1, '0');
    const whole = digits.slice(0, -decimals);
    const fraction = digits.slice(-decimals).replace(/0+$/, '');
    return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
  } catch {
    return value;
  }
}

function TransactionReadout({
  phase,
  record,
  message,
}: {
  phase: CellSemanticsPhase;
  record?: TransactionSemanticRecord | null;
  message?: string | null;
}) {
  const io = record?.actions.find((facet) => facet.kind === 'transaction_io');
  const lifecycle = record?.actions.find(
    (facet) => facet.kind === 'transaction_lifecycle',
  );
  const proposed = facetAttribute(lifecycle, 'proposed_block');
  const committed = facetAttribute(lifecycle, 'committed_block');
  const distance = facetAttribute(lifecycle, 'commitment_distance');
  const status = phase === 'loading'
    ? 'RESOLVING ORIGIN TRANSACTION…'
    : phase === 'waiting'
      ? 'WAITING FOR TRANSACTION CAPABILITY'
      : phase === 'unavailable'
        ? (message ?? 'NO ORIGIN TRANSACTION CONTEXT')
        : phase === 'error'
          ? (message ?? 'TRANSACTION CONTEXT UNAVAILABLE')
          : null;
  const flow = record
    ? `${facetAttribute(io, 'inputs') ?? '?'} → ${facetAttribute(io, 'outputs') ?? '?'} CELLS`
    : null;
  const commit = record
    ? proposed && committed
      ? `#${proposed} → #${committed}${distance ? ` · ${distance} BLOCKS` : ''}`
      : null
    : null;
  const feeRate = facetAttribute(io, 'fee_rate');
  const size = facetAttribute(io, 'size');
  const confirmations = facetAttribute(io, 'confirmations')
    ?? facetAttribute(lifecycle, 'confirmations');
  const inputCapacity = facetAttribute(io, 'inputs_capacity');
  const outputCapacity = facetAttribute(io, 'outputs_capacity');
  const inputKnowledge = facetAttribute(io, 'inputs_common_knowledge');
  const outputKnowledge = facetAttribute(io, 'outputs_common_knowledge');
  const windowClose = facetAttribute(lifecycle, 'window_close');
  const windowFar = facetAttribute(lifecycle, 'window_far');
  const proposedUncle = facetAttribute(lifecycle, 'proposed_uncle_block');
  const metric = (label: string, value: string, color?: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0, whiteSpace: 'nowrap' }}>
      <span style={{ color: HUD_COLORS.dim, fontSize: 6.4, letterSpacing: 0.72 }}>{label}</span>
      <span style={{ color: color ?? HUD_COLORS.ink, fontSize: 7.8 }}>{value}</span>
    </span>
  );
  return (
    <div
      data-transaction-semantics-phase={phase}
      style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.14)}` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: HUD_COLORS.orange, fontSize: 7.2, letterSpacing: 1.05 }}>
          ORIGIN TRANSACTION
        </span>
        {record ? (
          <span title={record.tx_hash} style={{ marginLeft: 'auto', minWidth: 0, color: HUD_COLORS.dim, fontSize: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {compact(record.tx_hash, 10, 7)}
          </span>
        ) : null}
      </div>
      {status && !record ? (
        <div style={{ marginTop: 3, color: phase === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: 8 }}>
          {status}
        </div>
      ) : null}
      {record ? (
        <>
          <div
            data-transaction-semantics-summary
            style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 3 }}
          >
            {metric('FLOW', flow!)}
            {commit ? metric('COMMIT', commit, HUD_COLORS.nominal) : null}
            {proposedUncle ? metric('UNCLE PROPOSAL', `#${proposedUncle}`, HUD_COLORS.caution) : null}
            {record.fee ? metric('FEE', formatShannons(record.fee)) : null}
            {feeRate ? metric('FEE RATE', `${feeRate} sh/kB`) : null}
            {size ? metric('SIZE', `${formatInteger(size)} B`) : null}
            {record.cycles != null ? metric('CYCLES', record.cycles.toLocaleString()) : null}
            {confirmations ? metric('CONFIRMED', `${formatInteger(confirmations)}×`) : null}
            {windowClose && windowFar ? metric('WINDOW', `${windowClose}–${windowFar} BLOCKS`) : null}
          </div>
          {inputCapacity || outputCapacity || inputKnowledge || outputKnowledge ? (
            <div
              data-transaction-semantics-flow
              style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '2px 8px', marginTop: 5, padding: '4px 6px', border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.1)}`, fontSize: 7.1 }}
            >
              {inputCapacity || outputCapacity ? (
                <>
                  <span style={{ color: HUD_COLORS.dim, letterSpacing: 0.55 }}>CAPACITY</span>
                  <span style={{ color: HUD_COLORS.ink }}>{inputCapacity ? formatShannons(inputCapacity) : '?'} → {outputCapacity ? formatShannons(outputCapacity) : '?'}</span>
                </>
              ) : null}
              {inputKnowledge || outputKnowledge ? (
                <>
                  <span style={{ color: HUD_COLORS.dim, letterSpacing: 0.55 }}>OCCUPIED</span>
                  <span style={{ color: HUD_COLORS.ink }}>{inputKnowledge ?? '?'} B → {outputKnowledge ?? '?'} B</span>
                </>
              ) : null}
            </div>
          ) : null}
          {record.participants.length > 0 ? (
            <div
              data-transaction-participants
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 8px', marginTop: 4 }}
            >
              {record.participants.slice(0, 4).map((participant) => (
                <div
                  key={participant.address}
                  title={participant.address}
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 5, minWidth: 0, fontSize: 7.1 }}
                >
                  <span style={{ color: HUD_COLORS.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {compact(participant.address, 9, 6)}
                  </span>
                  <span style={{ color: participant.capacity_delta?.startsWith('-') ? HUD_COLORS.danger : HUD_COLORS.nominal }}>
                    {participant.capacity_delta == null
                      ? 'PARTIAL'
                      : formatShannons(participant.capacity_delta, true)}
                    {participant.common_knowledge_delta != null
                      ? ` · ${participant.common_knowledge_delta.startsWith('-') ? '' : '+'}${participant.common_knowledge_delta} B`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function CellSemanticsReadout({
  source,
  phase,
  record,
  message,
  transactionPhase,
  transactionRecord,
  transactionMessage,
  spatial = false,
  style,
}: {
  source: EnrichmentSourceStatus;
  phase: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  message?: string | null;
  transactionPhase?: CellSemanticsPhase;
  transactionRecord?: TransactionSemanticRecord | null;
  transactionMessage?: string | null;
  /** Removes the card-like shell when the readout is part of a scene scan. */
  spatial?: boolean;
  style?: CSSProperties;
}) {
  const color = sourceColor(source.status);
  const lag = source.lag_blocks == null ? '' : ` · ${source.lag_blocks} BLOCK LAG`;
  const statusMessage = phase === 'loading'
    ? 'RESOLVING SELECTED CELL…'
    : phase === 'waiting'
      ? (message ?? 'WAITING FOR VALIDATED CHAIN CONTEXT')
      : phase === 'unavailable'
        ? (message ?? 'NO CONTEXT FOR THIS CELL')
        : phase === 'error'
          ? (message ?? 'CELL CONTEXT UNAVAILABLE')
          : null;

  return (
    <section
      aria-label="Cell context"
      data-cell-semantics-phase={phase}
      data-cell-semantics-density={spatial ? 'spatial' : 'compact'}
      data-cell-semantics-policy={spatial ? 'essential' : 'complete'}
      style={{
        margin: spatial ? 0 : '7px 0 8px',
        padding: spatial ? '4px 4px 8px 0' : '6px 7px 5px',
        borderTop: spatial ? 0 : `1px solid ${rgba(color, 0.24)}`,
        borderBottom: spatial ? 0 : `1px solid ${rgba(color, 0.14)}`,
        background: spatial
          ? `linear-gradient(90deg,${rgba(color, 0.035)},transparent 82%)`
          : `linear-gradient(90deg,${rgba(color, 0.07)},rgba(1,4,12,.42) 52%,transparent)`,
        fontFamily: HUD_FONTS.mono,
        ...style,
      }}
    >
      <div
        data-cell-context-header="true"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 6px', marginBottom: record ? spatial ? 5 : 8 : 0 }}
      >
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ color, fontSize: 8, letterSpacing: 1.15, whiteSpace: 'nowrap' }}>
          CELL CONTEXT
        </span>
        <span style={{ color, fontSize: 7.2, letterSpacing: 0.85, whiteSpace: 'nowrap' }}>
          {' · '}{source.status.toUpperCase()}
        </span>
        {lag ? (
          <span style={{ color: HUD_COLORS.dim, fontSize: 6.8, letterSpacing: 0.7, whiteSpace: 'nowrap' }}>
            {lag}
          </span>
        ) : null}
        {record?.cell_type ? (
          <span
            data-cell-context-type={record.cell_type}
            style={{ marginLeft: 'auto', padding: '1px 4px', border: `1px solid ${rgba(HUD_COLORS.nominal, 0.22)}`, color: HUD_COLORS.nominal, fontSize: 6.6, letterSpacing: 0.75, whiteSpace: 'nowrap' }}
          >
            {record.cell_type.toUpperCase()}
          </span>
        ) : null}
      </div>
      {statusMessage ? (
        <div title={statusMessage} style={{ color: phase === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: 8, lineHeight: 1.45 }}>
          {statusMessage}
        </div>
      ) : null}
      {record ? (
        spatial ? <SpatialContextSummary record={record} /> : <>
          <div
            data-cell-context-facts
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 12, rowGap: 3 }}
          >
            {record.address ? <ContextFact label="OWNER" value={record.address} displayValue={compact(record.address, 14, 10)} wide /> : null}
            <ContextFact label="CREATED" value={`#${record.observed_at_block.toLocaleString()}`} />
            <ContextFact label="PROOF ANCHOR" value={`#${record.as_of.block.toLocaleString()}`} color={HUD_COLORS.cyanWire} />
            {record.asset ? (
              <ContextFact
                label="ASSET"
                value={[
                  record.asset.symbol,
                  record.asset.name,
                  record.asset.standard,
                ].filter(Boolean).join(' · ') || compact(record.asset.type_script_hash)}
                color={HUD_COLORS.caution}
                wide
              />
            ) : null}
            {record.asset?.amount != null ? (
              <ContextFact
                label="AMOUNT"
                value={`${formatSemanticAssetAmount(
                  record.asset.amount,
                  record.asset.decimals,
                )}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`}
                wide
              />
            ) : null}
          </div>
          {record.lock_script || record.type_script ? (
            <div
              data-cell-context-scripts="true"
              style={{ display: 'grid', gap: 6, marginTop: 8 }}
            >
              {record.lock_script ? <ScriptFact role="LOCK" script={record.lock_script} /> : null}
              {record.type_script ? <ScriptFact role="TYPE" script={record.type_script} /> : null}
            </div>
          ) : null}
          <KnowledgeBar record={record} />
          {record.facets.length > 0 ? (
            <div
              data-cell-context-facets
              style={{ display: 'grid', gap: 5, marginTop: 8, paddingTop: 7, borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.13)}` }}
            >
              {record.facets.slice(0, 6).map((facet, index) => (
                <FacetDetail
                  key={`${facet.namespace}:${facet.kind}:${index}`}
                  facet={facet}
                  index={index}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {!spatial && transactionPhase ? (
        <TransactionReadout
          phase={transactionPhase}
          record={transactionRecord}
          message={transactionMessage}
        />
      ) : null}
    </section>
  );
}
