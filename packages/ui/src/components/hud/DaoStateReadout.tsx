import type { ReactNode } from 'react';
import type {
  DaoStateRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  daoStateVisualState,
  deriveDaoStateVisual,
} from '../../derives/daoState.derive';
import { formatAge, formatCkb } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, rgba } from './hudTheme';
import { ReadoutHeader } from './primitives';

const SHANNONS_PER_CKB = 100_000_000n;

function exactCkb(amount: bigint): string {
  const whole = amount / SHANNONS_PER_CKB;
  const fraction = (amount % SHANNONS_PER_CKB)
    .toString()
    .padStart(8, '0')
    .replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} CKB`;
}


function formatApc(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function deltaColor(value: bigint | number): string {
  if (value > 0) return HUD_COLORS.nominal;
  if (value < 0) return HUD_COLORS.danger;
  return HUD_COLORS.dim;
}

function formatSignedInteger(value: number): string {
  if (value > 0) return `+${value.toLocaleString('en-US')}`;
  if (value < 0) return `−${Math.abs(value).toLocaleString('en-US')}`;
  return '0';
}

function formatChangePercent(current: bigint, change: bigint): string | null {
  const previous = current - change;
  if (previous <= 0n) return null;

  const absolute = change < 0n ? -change : change;
  // Thousandths of one percent, rounded without converting exact integers to
  // floating point. For example, 17 becomes 0.017%.
  const milliPercent = (absolute * 100_000n + previous / 2n) / previous;
  const sign = change > 0n ? '+' : change < 0n ? '−' : '';
  if (milliPercent === 0n) {
    return change === 0n ? '0%' : `${sign}<0.001%`;
  }
  const whole = milliPercent / 1_000n;
  const fraction = (milliPercent % 1_000n)
    .toString()
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}%`;
}

function MetricLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontFamily: HUD_FONTS.tech,
      fontWeight: 500,
      fontSize: 7.5,
      letterSpacing: 1.25,
      color: HUD_COLORS.dim,
      lineHeight: 1.25,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  );
}

function CompactMetric({ label, children, title }: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <MetricLabel>{label}</MetricLabel>
      <div
        title={title}
        style={{
          marginTop: 3,
          overflow: 'hidden',
          color: HUD_COLORS.ink,
          fontFamily: HUD_FONTS.mono,
          fontSize: 11.5,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.15,
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function canRenderDaoStateReadout(
  source?: EnrichmentSourceStatus,
  record?: DaoStateRecord | null,
  nowMs = Date.now(),
): boolean {
  return !!source
    && !!record
    && daoStateVisualState(source, record, nowMs) !== null
    && deriveDaoStateVisual(record) !== null;
}

export default function DaoStateReadout({ source, record, variant = 'section', nowMs = Date.now() }: {
  source?: EnrichmentSourceStatus;
  record?: DaoStateRecord | null;
  variant?: 'section' | 'panel';
  /** Shared HUD clock for deterministic freshness text and stale state. */
  nowMs?: number;
}) {
  if (!source || !record) return null;
  const visualState = daoStateVisualState(source, record, nowMs);
  const visual = deriveDaoStateVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const accent = stale ? HUD_COLORS.caution : HUD_COLORS.orange;
  const panelVariant = variant === 'panel';
  const updatedAge = formatAge(record.updated_at_ms, nowMs);
  const depositChangePercent = visual.depositChange24hShannons === null
    ? null
    : formatChangePercent(
      visual.totalDepositedShannons,
      visual.depositChange24hShannons,
    );
  // These labels follow ckbadger's lifecycle semantics: total deposited and
  // active depositors exclude phase-one withdrawals, while active_deposits is
  // the count of still-live status-0 plus status-1 DAO Cells.

  return (
    <section
      aria-label="Nervos DAO state"
      data-dao-state={visualState}
      style={{
        marginTop: panelVariant ? 0 : 10,
        paddingTop: panelVariant ? 0 : 8,
        borderTop: panelVariant ? undefined : `1px solid ${rgba(accent, 0.16)}`,
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
      <div
        data-dao-freshness={visualState}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 9,
          color: stale ? HUD_COLORS.caution : HUD_COLORS.nominal,
          fontFamily: HUD_FONTS.tech,
          fontSize: 7.5,
          letterSpacing: 1.1,
          lineHeight: 1,
          textTransform: 'uppercase',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 5,
            height: 5,
            flex: '0 0 auto',
            borderRadius: '50%',
            background: stale ? HUD_COLORS.caution : HUD_COLORS.nominal,
            boxShadow: `0 0 6px ${stale ? HUD_COLORS.caution : HUD_COLORS.nominal}`,
          }}
        />
        <span>{stale ? 'STALE' : 'LIVE'} · UPDATED {updatedAge} AGO</span>
      </div>

      <div data-dao-content style={{ opacity: stale ? 0.72 : 1 }}>
        <div
          data-dao-hero
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.65fr) minmax(76px,.72fr)',
            gap: 11,
            alignItems: 'stretch',
            marginBottom: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <MetricLabel>Total deposited</MetricLabel>
            <div
              title={exactCkb(visual.totalDepositedShannons)}
              style={{
                marginTop: 2,
                overflow: 'hidden',
                color: HUD_COLORS.heroInk,
                fontFamily: HUD_FONTS.display,
                fontSize: 21,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: -0.25,
                lineHeight: 1.1,
                textOverflow: 'ellipsis',
                textShadow: `0 0 11px ${rgba(HUD_COLORS.orange, 0.32)}`,
                whiteSpace: 'nowrap',
              }}
            >
              {formatCkb(visual.totalDepositedShannons)}
            </div>
            <div
              data-dao-deposit-change
              style={{
                minHeight: 12,
                marginTop: 3,
                color: visual.depositChange24hShannons === null
                  ? HUD_COLORS.dim
                  : deltaColor(visual.depositChange24hShannons),
                fontFamily: HUD_FONTS.mono,
                fontSize: 8.5,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: 0.25,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {visual.depositChange24hShannons === null
                ? '24H CHANGE · —'
                : (
                  <>
                    {formatCkb(visual.depositChange24hShannons, true)}
                    {depositChangePercent ? ` · ${depositChangePercent}` : ''}
                    {' / 24H'}
                  </>
                )}
            </div>
          </div>

          <div style={{
            minWidth: 0,
            paddingLeft: 10,
            borderLeft: `1px solid ${rgba(accent, 0.18)}`,
          }}>
            <MetricLabel>Est. APC</MetricLabel>
            <div style={{
              marginTop: 4,
              color: accent,
              fontFamily: HUD_FONTS.display,
              fontSize: 19,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              textShadow: `0 0 9px ${rgba(accent, 0.36)}`,
              whiteSpace: 'nowrap',
            }}>
              {formatApc(record.estimated_apc_bps)}
            </div>
            <div style={{
              marginTop: 5,
              color: HUD_COLORS.dim,
              fontFamily: HUD_FONTS.tech,
              fontSize: 6.8,
              letterSpacing: 0.85,
              textTransform: 'uppercase',
            }}>
              annualized
            </div>
          </div>
        </div>

        <div
          data-dao-capacity-metrics
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
            gap: 12,
            padding: '8px 0',
            borderTop: `1px solid ${rgba(accent, 0.14)}`,
            borderBottom: `1px solid ${rgba(accent, 0.14)}`,
          }}
        >
          <CompactMetric
            label="Withdrawing"
            title={exactCkb(visual.pendingWithdrawalShannons)}
          >
            {formatCkb(visual.pendingWithdrawalShannons)}
          </CompactMetric>
          <CompactMetric
            label="Unclaimed comp."
            title={exactCkb(visual.unclaimedCompensationShannons)}
          >
            {formatCkb(visual.unclaimedCompensationShannons)}
          </CompactMetric>
        </div>

        <div
          data-dao-participation
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
            gap: 12,
            paddingTop: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <MetricLabel>Active depositors</MetricLabel>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 5,
              marginTop: 3,
              whiteSpace: 'nowrap',
            }}>
              <span style={{
                color: HUD_COLORS.ink,
                fontFamily: HUD_FONTS.mono,
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {record.total_depositors.toLocaleString('en-US')}
              </span>
              {record.depositors_change_24h !== undefined ? (
                <span
                  data-dao-depositor-change
                  style={{
                    color: deltaColor(record.depositors_change_24h),
                    fontFamily: HUD_FONTS.mono,
                    fontSize: 8,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatSignedInteger(record.depositors_change_24h)} / 24H
                </span>
              ) : null}
            </div>
          </div>
          <CompactMetric label="Live DAO cells">
            {record.active_deposits.toLocaleString('en-US')}
          </CompactMetric>
        </div>
      </div>

      <div
        data-dao-proof
        title={`Statistics block ${record.statistics_block.toLocaleString('en-US')}; validated compatibility anchor ${record.as_of.block.toLocaleString('en-US')}`}
        style={{
          marginTop: 9,
          color: stale ? HUD_COLORS.caution : HUD_COLORS.dim,
          fontFamily: HUD_FONTS.mono,
          fontSize: 7.5,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.4,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        STAT #{record.statistics_block.toLocaleString('en-US')} · ANCHOR #{record.as_of.block.toLocaleString('en-US')}
      </div>
    </section>
  );
}
