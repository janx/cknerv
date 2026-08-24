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
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
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
      fontSize: HUD_TYPE.micro,
      letterSpacing: 1.2,
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
          fontSize: HUD_TYPE.value,
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
          fontSize: HUD_TYPE.micro,
          letterSpacing: 1.2,
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
                fontSize: HUD_TYPE.hero,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                // The HUD's only negative tracking, and a declared exception in
                // `hudTheme.ts`: a twelve-digit CKB figure has to stay inside
                // this column, and pulling the letters together is how a hero
                // earns the room without being demoted to a smaller rung.
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
                // Body ink, whichever way it went. This line used to ask
                // `deltaColor`, which painted any rise `nominal` and any fall
                // `danger` — the same red the HUD raises for a reorg — so a
                // quarter's worth of DAO deposits maturing out read as a
                // pathology of the chain. It is a market moving, and a market
                // moving in the direction nobody wanted is still not a fault.
                // The direction is on the number already: `formatCkb(_, true)`
                // signs it, and the em dash below says when there is nothing
                // to sign. `dim` survives for exactly that absence — a figure
                // the source has not published yet is a quieter thing than a
                // figure that is zero.
                color: visual.depositChange24hShannons === null
                  ? HUD_COLORS.dim
                  : HUD_COLORS.ink,
                fontFamily: HUD_FONTS.mono,
                fontSize: HUD_TYPE.tech,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: 0.35,
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
            {/* The panel's second hero, ranked under the first and reading in
              * the same grammar: white ink, then gold, both glowing in the
              * frame's orange. It used to be painted IN that orange — a
              * reading in the instrument's own frame colour, which the palette
              * forbids outright, and which borrowed a sentence the HUD already
              * says elsewhere: the top bar's controls use cyan/orange to mean
              * "sitting at the default" versus "you have diverged from it", so
              * a yield printed in chrome read as a config divergence.
              *
              * Gold rather than `ink`, and not by preference: at `heroSub`
              * beside a `heroInk` hero, `ink` measures 39.8 from it — inside
              * the separation floor, which is one colour wearing two names.
              * `goldInk` is the value family's own reading tier, which is what
              * an annualized yield is.
              *
              * And it no longer changes colour LAYER with freshness. The
              * expression here was `stale ? caution : orange`, so the number
              * left chrome for a severity tone when the record aged — a
              * reading saying two different kinds of thing out of one slot.
              * Freshness is carried on this panel already, twice: the
              * `· STALE` token in the heading and the whole content block
              * dropping to 0.72 opacity. */}
            <div style={{
              marginTop: 4,
              color: HUD_COLORS.goldInk,
              fontFamily: HUD_FONTS.display,
              fontSize: HUD_TYPE.heroSub,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              textShadow: `0 0 9px ${rgba(HUD_COLORS.orange, 0.36)}`,
              whiteSpace: 'nowrap',
            }}>
              {formatApc(record.estimated_apc_bps)}
            </div>
            <div style={{
              marginTop: 5,
              color: HUD_COLORS.dim,
              fontFamily: HUD_FONTS.tech,
              fontSize: HUD_TYPE.micro,
              letterSpacing: 0.9,
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
                fontSize: HUD_TYPE.panelTitle,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {record.total_depositors.toLocaleString('en-US')}
              </span>
              {record.depositors_change_24h !== undefined ? (
                <span
                  data-dao-depositor-change
                  style={{
                    // The same ruling as the deposit line above: depositors
                    // leaving is a directional fact about a market, not a
                    // fault report. `formatSignedInteger` carries the
                    // direction, and the count beside it outranks this by two
                    // rungs of the type scale, which is what makes it a delta
                    // rather than a second reading.
                    color: HUD_COLORS.ink,
                    fontFamily: HUD_FONTS.mono,
                    fontSize: HUD_TYPE.nav,
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
          fontSize: HUD_TYPE.micro,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.35,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        STAT #{record.statistics_block.toLocaleString('en-US')} · ANCHOR #{record.as_of.block.toLocaleString('en-US')}
      </div>
    </section>
  );
}
