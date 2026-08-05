import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  daoStateVisualState,
  deriveDaoStateVisual,
} from '../../derives/daoState.derive';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { ReadoutHeader, StatRow } from './primitives';

const SHANNONS_PER_CKB = 100_000_000n;

function exactCkb(amount: bigint): string {
  const whole = amount / SHANNONS_PER_CKB;
  const fraction = (amount % SHANNONS_PER_CKB)
    .toString()
    .padStart(8, '0')
    .replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} CKB`;
}

function formatCkb(amount: bigint, signed = false): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const units = [
    { threshold: 1_000_000_000n * SHANNONS_PER_CKB, suffix: 'B CKB' },
    { threshold: 1_000_000n * SHANNONS_PER_CKB, suffix: 'M CKB' },
    { threshold: 1_000n * SHANNONS_PER_CKB, suffix: 'K CKB' },
  ];
  const unit = units.find((candidate) => absolute >= candidate.threshold);
  const body = unit
    ? (() => {
      const hundredths = (absolute * 100n + unit.threshold / 2n) / unit.threshold;
      const whole = hundredths / 100n;
      const fraction = (hundredths % 100n)
        .toString()
        .padStart(2, '0')
        .replace(/0+$/, '');
      return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${unit.suffix}`;
    })()
    : exactCkb(absolute);
  const sign = negative ? '−' : signed && amount > 0n ? '+' : '';
  return `${sign}${body}`;
}

function formatApc(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function deltaColor(value: bigint | number): string {
  if (value > 0) return HUD_COLORS.nominal;
  if (value < 0) return HUD_COLORS.danger;
  return HUD_COLORS.dim;
}

export function canRenderDaoStateReadout(
  source?: EnrichmentSourceStatus,
  record?: DaoStateRecord | null,
): boolean {
  return !!source
    && !!record
    && daoStateVisualState(source, record) !== null
    && deriveDaoStateVisual(record) !== null;
}

export default function DaoStateReadout({ source, record, variant = 'section' }: {
  source?: EnrichmentSourceStatus;
  record?: DaoStateRecord | null;
  variant?: 'section' | 'panel';
}) {
  if (!source || !record) return null;
  const visualState = daoStateVisualState(source, record);
  const visual = deriveDaoStateVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.orange;
  const panelVariant = variant === 'panel';

  return (
    <section
      aria-label="Nervos DAO state"
      data-dao-state={visualState}
      style={{
        marginTop: panelVariant ? 0 : 10,
        paddingTop: panelVariant ? 0 : 8,
        borderTop: panelVariant ? undefined : `1px solid ${rgba(accent, 0.16)}`,
        opacity: stale ? 0.68 : 1,
      }}
    >
      {panelVariant ? null : (
        <ReadoutHeader
          title="NERVOS DAO"
          meta={`SNAPSHOT #${record.statistics_block.toLocaleString('en-US')}`}
          accent={accent}
          stale={stale}
        />
      )}
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 7.5, color: HUD_COLORS.dim, letterSpacing: 0.35, marginBottom: 4 }}>
        {panelVariant
          ? `SNAPSHOT #${record.statistics_block.toLocaleString('en-US')} · VALIDATED AT #${record.as_of.block.toLocaleString('en-US')}`
          : `VALIDATED AT #${record.as_of.block.toLocaleString('en-US')}`}
      </div>
      <StatRow label="DAO locked">{formatCkb(visual.totalDepositedShannons)}</StatRow>
      <StatRow label="Active deposits">{record.active_deposits.toLocaleString('en-US')}</StatRow>
      <StatRow label="Depositors">{record.total_depositors.toLocaleString('en-US')}</StatRow>
      <StatRow label="Estimated APC">{formatApc(record.estimated_apc_bps)}</StatRow>
      <StatRow label="Pending withdrawal">{formatCkb(visual.pendingWithdrawalShannons)}</StatRow>
      <StatRow label="Unclaimed comp.">{formatCkb(visual.unclaimedCompensationShannons)}</StatRow>
      {visual.depositChange24hShannons !== null ? (
        <StatRow label="Locked 24h" valueColor={deltaColor(visual.depositChange24hShannons)}>
          {formatCkb(visual.depositChange24hShannons, true)}
        </StatRow>
      ) : null}
      {record.depositors_change_24h !== undefined ? (
        <StatRow label="Depositors 24h" valueColor={deltaColor(record.depositors_change_24h)}>
          {record.depositors_change_24h > 0 ? '+' : ''}
          {record.depositors_change_24h.toLocaleString('en-US')}
        </StatRow>
      ) : null}
    </section>
  );
}
