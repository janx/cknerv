import type { CSSProperties } from 'react';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { ChurnRates } from '../../derives/cellChurn';
import { CELL_PANEL_ACCENT, HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { DirectionMark, HudPanel, PanelHeader, StatRow } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtSigned = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

function FlowRow({ label, direction, color, width, value }: { label: string; direction: 'up' | 'down'; color: string; width: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 16 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: HUD_TYPE.nav, letterSpacing: 0.9, width: 54, color }}>
        <DirectionMark direction={direction} color={color} size={4.5} />
        {label}
      </span>
      <span style={{ flex: 1, height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.orange, 0.12)}`, position: 'relative' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width, background: color, boxShadow: `0 0 7px ${color}66` }} />
      </span>
      <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, width: 30, textAlign: 'right', color }}>{value.toFixed(1)}</span>
    </div>
  );
}

export default function CellsPanel({ stats, churn, reducedMotion = false, style }: {
  stats: CellsStats;
  churn: ChurnRates;
  reducedMotion?: boolean;
  style?: CSSProperties;
}) {
  const maxRate = Math.max(churn.bornPerBlock, churn.spentPerBlock, 0.001);
  const bornW = `${Math.min(100, (churn.bornPerBlock / maxRate) * 100)}%`;
  const spentW = `${Math.min(100, (churn.spentPerBlock / maxRate) * 100)}%`;
  // One axis, one code. The hero and the two rows 20px under it are the same
  // reading at two resolutions — net IS born minus died — and they used to
  // speak two colour languages about it: cyan/yellow up here, green/red down
  // there. Growth is `nominal` and decline is `ember`, the exact pair the flow
  // rows wear; the hero only says which side won this block.
  const netColor = churn.netPerBlock >= 0 ? HUD_COLORS.nominal : HUD_COLORS.ember;
  return (
    <HudPanel watermark="神经元" style={{ width: 302, ...style }}>
      {/* MESH·02 is the peer plane and MESH·03 is this one; they are a pair,
          and a pair has to be two colours. The cyan that used to sit here was
          eight degrees off `peerWire`, so the two panels read as one — and it
          pointed at a cyan organism the stage does not have. The Cells out
          there are rose. */}
      <PanelHeader en="CELL MESH" cjk="神经元" idx="MESH·03" accent={CELL_PANEL_ACCENT} />
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.tech, color: HUD_COLORS.dim, letterSpacing: 1.2, marginBottom: 2 }}>METABOLISM · per block</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 9 }}>
        {/* Tabular figures on every display-family number that ticks: Saira's
            proportional digits make a `1` narrower than a `0`, so a rate
            crossing +9.9 → +10.0 shunts the whole hero sideways and the panel
            twitches once a block. Mono is tabular by nature and needs none. */}
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.hero, fontVariantNumeric: 'tabular-nums', color: netColor, lineHeight: 1, textShadow: `0 0 12px ${netColor}66`, animation: reducedMotion ? undefined : 'cknerv-hud-breathe 3.2s ease-in-out infinite' }}>{fmtSigned(churn.netPerBlock)}</span>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, color: HUD_COLORS.dim, marginBottom: 4 }}>net /blk</span>
      </div>
      {/* Born green, died ember — a metabolism, not a fault report. DIED wore
          `danger`, the same red the HUD raises for a reorg, so every ordinary
          block of spent outputs read as a small emergency. Cells being
          consumed is what a living chain looks like; the alarming number
          would be this row at zero. */}
      <FlowRow label="BORN" direction="up" color={HUD_COLORS.nominal} width={bornW} value={churn.bornPerBlock} />
      <div style={{ height: 5 }} />
      <FlowRow label="DIED" direction="down" color={HUD_COLORS.ember} width={spentW} value={churn.spentPerBlock} />
      {/* `stats.live` is births minus deaths in the BACKEND'S OBSERVATION
          WINDOW — never a live-chain total. That was merely imprecise while
          nothing else on screen implied a chain-wide number; with a medium
          standing for millions of unresolved Cells beside it, an unqualified
          "Live cells" becomes actively contradictory. The whole-chain count
          lives in CELL POPULATION, under its own validated anchor. */}
      {/* Lifted in SIZE and not in ink, which is the one rank this panel had
          pointing two ways. `HUD_TYPE.emphasis` is documented as "a value
          lifted out of a stat row without leaving the row" and that is exactly
          what this is; `heroInk` is documented as "the ONE hero numeral a
          panel exists to show", and it was worn down here, three readings
          under a 22px numeral that breathes and glows. CELL MESH exists to
          show METABOLISM — its own subhead says so — so the ink tier and the
          size tier were naming two different numbers.
          The panel keeps no white at all now, which is the same arrangement
          PULSE has: a hero at the `hero` rung, coloured by what it is saying,
          and no second claim on the tier above `ink`. `heroInk` is worn where
          it is worn alone — CKB·01's tip, DAO·05's deposit total. */}
      <div style={{ marginTop: 11 }}>
        <StatRow label="Observed live"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.emphasis, fontVariantNumeric: 'tabular-nums' }}>{fmt(stats.live)}</span></StatRow>
        <StatRow label="Total observed">{fmt(stats.born)}</StatRow>
        <StatRow label="Dead" valueColor={HUD_COLORS.ember}>{fmt(stats.dead)}</StatRow>
      </div>
    </HudPanel>
  );
}
