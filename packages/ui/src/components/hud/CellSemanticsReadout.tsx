import type { CSSProperties } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticFacet,
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

function ValueRow({ label, value, color }: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 7, padding: '2px 0' }}>
      <span style={{ color: HUD_COLORS.dim, fontSize: 8, letterSpacing: 0.9 }}>{label}</span>
      <span
        title={value}
        style={{ color: color ?? HUD_COLORS.ink, fontSize: 8.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {value}
      </span>
    </div>
  );
}

function KnowledgeBar({ record }: { record: CellSemanticRecord }) {
  const knowledge = record.common_knowledge;
  if (!knowledge || knowledge.total_bytes <= 0) return null;
  const segments = [
    ['CAP', knowledge.capacity_field_bytes, HUD_COLORS.orange],
    ['LOCK', knowledge.lock_script_bytes, HUD_COLORS.cyanWire],
    ['TYPE', knowledge.type_script_bytes, HUD_COLORS.nominal],
    ['DATA', knowledge.data_bytes, HUD_COLORS.caution],
  ] as const;
  return (
    <div title={segments.map(([name, bytes]) => `${name} ${bytes}B`).join(' · ')}>
      <ValueRow label="KNOWLEDGE" value={`${knowledge.total_bytes} bytes occupied`} />
      <div style={{ display: 'flex', height: 3, gap: 1, margin: '2px 0 5px' }}>
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
        ? (message ?? 'NO INDEXED TRANSACTION CONTEXT')
        : phase === 'error'
          ? (message ?? 'TRANSACTION CONTEXT UNAVAILABLE')
          : null;
  return (
    <div
      data-transaction-semantics-phase={phase}
      style={{ marginTop: 7, paddingTop: 6, borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.14)}` }}
    >
      <div style={{ color: HUD_COLORS.orange, fontSize: 7.5, letterSpacing: 1.1, marginBottom: 3 }}>
        ORIGIN TRANSACTION
      </div>
      {status && !record ? (
        <div style={{ color: phase === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: 8 }}>
          {status}
        </div>
      ) : null}
      {record ? (
        <>
          <ValueRow label="TX" value={compact(record.tx_hash, 12, 9)} />
          <ValueRow
            label="FLOW"
            value={`${facetAttribute(io, 'inputs') ?? '?'} → ${facetAttribute(io, 'outputs') ?? '?'} CELLS`}
          />
          <ValueRow
            label="COMMIT"
            value={proposed && committed
              ? `#${proposed} → #${committed}${distance ? ` · ${distance} BLOCKS` : ''}`
              : `#${record.block}`}
            color={HUD_COLORS.nominal}
          />
          {record.fee ? <ValueRow label="FEE" value={formatShannons(record.fee)} /> : null}
          {record.cycles != null ? (
            <ValueRow label="CYCLES" value={record.cycles.toLocaleString()} />
          ) : null}
          {record.participants.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              {record.participants.slice(0, 4).map((participant) => (
                <div
                  key={participant.address}
                  title={participant.address}
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, padding: '1px 0', fontSize: 7.5 }}
                >
                  <span style={{ color: HUD_COLORS.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {compact(participant.address, 9, 6)}
                  </span>
                  <span style={{ color: participant.capacity_delta?.startsWith('-') ? HUD_COLORS.danger : HUD_COLORS.nominal }}>
                    {participant.capacity_delta == null
                      ? 'PARTIAL'
                      : formatShannons(participant.capacity_delta, true)}
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
  style,
}: {
  source: EnrichmentSourceStatus;
  phase: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  message?: string | null;
  transactionPhase?: CellSemanticsPhase;
  transactionRecord?: TransactionSemanticRecord | null;
  transactionMessage?: string | null;
  style?: CSSProperties;
}) {
  const color = sourceColor(source.status);
  const lag = source.lag_blocks == null ? '' : ` · ${source.lag_blocks} BLOCK LAG`;
  const statusMessage = phase === 'loading'
    ? 'RESOLVING SELECTED CELL…'
    : phase === 'waiting'
      ? (message ?? 'WAITING FOR A VALIDATED INDEX ANCHOR')
      : phase === 'unavailable'
        ? (message ?? 'NO INDEXED CONTEXT FOR THIS CELL')
        : phase === 'error'
          ? (message ?? 'INDEXED CONTEXT UNAVAILABLE')
          : null;

  return (
    <section
      aria-label="Indexed Cell context"
      data-cell-semantics-phase={phase}
      style={{
        margin: '8px 0 10px',
        padding: '7px 8px 6px',
        border: `1px solid ${rgba(color, 0.2)}`,
        background: `linear-gradient(90deg,${rgba(color, 0.055)},transparent)`,
        fontFamily: HUD_FONTS.mono,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: record ? 5 : 0 }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ color, fontSize: 8, letterSpacing: 1.15 }}>
          {source.source.toUpperCase()} · {source.status.toUpperCase()}{lag}
        </span>
      </div>
      {statusMessage ? (
        <div title={statusMessage} style={{ color: phase === 'error' ? HUD_COLORS.danger : HUD_COLORS.dim, fontSize: 8, lineHeight: 1.45 }}>
          {statusMessage}
        </div>
      ) : null}
      {record ? (
        <>
          {record.cell_type ? <ValueRow label="SEMANTIC" value={record.cell_type.toUpperCase()} color={HUD_COLORS.nominal} /> : null}
          {record.address ? <ValueRow label="ADDRESS" value={compact(record.address, 12, 9)} /> : null}
          {record.lock_script ? (
            <ValueRow
              label="LOCK"
              value={record.lock_script.name ?? record.lock_script.family ?? compact(record.lock_script.code_hash)}
            />
          ) : null}
          {record.type_script ? (
            <ValueRow
              label="TYPE"
              value={record.type_script.name ?? record.type_script.family ?? compact(record.type_script.code_hash)}
            />
          ) : null}
          {record.asset ? (
            <>
              <ValueRow
                label="ASSET"
                value={[
                  record.asset.symbol,
                  record.asset.name,
                  record.asset.standard,
                ].filter(Boolean).join(' · ') || compact(record.asset.type_script_hash)}
                color={HUD_COLORS.caution}
              />
              {record.asset.amount != null ? (
                <ValueRow
                  label="AMOUNT"
                  value={`${formatSemanticAssetAmount(
                    record.asset.amount,
                    record.asset.decimals,
                  )}${record.asset.symbol ? ` ${record.asset.symbol}` : ''}`}
                />
              ) : null}
            </>
          ) : null}
          <KnowledgeBar record={record} />
          {record.facets.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
              {record.facets.slice(0, 5).map((facet, index) => {
                const text = `${facet.kind}${facet.state ? ` · ${facet.state}` : ''}`;
                return (
                  <span
                    key={`${facet.namespace}:${facet.kind}:${index}`}
                    title={`${facet.namespace} · ${text}`}
                    style={{
                      maxWidth: '100%',
                      padding: '2px 4px',
                      border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.18)}`,
                      color: HUD_COLORS.cyanWire,
                      fontSize: 7.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {text.toUpperCase()}
                  </span>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
      {transactionPhase ? (
        <TransactionReadout
          phase={transactionPhase}
          record={transactionRecord}
          message={transactionMessage}
        />
      ) : null}
    </section>
  );
}
