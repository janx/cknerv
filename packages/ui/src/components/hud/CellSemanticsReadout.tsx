import type { CSSProperties } from 'react';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
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

export default function CellSemanticsReadout({
  source,
  phase,
  record,
  message,
  style,
}: {
  source: EnrichmentSourceStatus;
  phase: CellSemanticsPhase;
  record?: CellSemanticRecord | null;
  message?: string | null;
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
    </section>
  );
}
