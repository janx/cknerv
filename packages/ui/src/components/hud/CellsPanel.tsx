import { memo, type CSSProperties } from 'react';
import type { CellsStats } from '../../derives/cellsStats.derive';
import type { ChurnRates } from '../../derives/cellChurn';
import { CELL_PANEL_ACCENT, HUD_COLORS, HUD_FONTS, HUD_MOTION, HUD_TYPE, rgba } from './hudTheme';
import { DirectionMark, HudPanel, PanelHeader, StatRow } from './primitives';
import { POPULATION_SCOPE } from './cellPopulation.presentation';

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

/** The rail's measure, and the collapsed one.
 *
 * At 1,280 two full rails leave a 550 px hole for a stage that is the product,
 * and the HUD is 57 % of the page; at 1,440 they leave 710 for a card that is
 * 728. Collapsed, a mesh panel is its header, its hero and one row — the
 * reading you would keep if you could keep one — at a measure the three-word
 * rows still fit. `HudOverlay.RAILS_COLLAPSE_MAX_WIDTH_PX` owns the width at
 * which that happens; it is derived from this measure, so the two move
 * together. */
const PANEL_WIDTH_PX = 302;
const DENSE_PANEL_WIDTH_PX = 210;

function CellsPanel({ stats, churn, reducedMotion = false, dense = false, style }: {
  stats: CellsStats;
  churn: ChurnRates;
  reducedMotion?: boolean;
  /** The rail has collapsed: header, hero, one row. */
  dense?: boolean;
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
    <HudPanel style={{ width: dense ? DENSE_PANEL_WIDTH_PX : PANEL_WIDTH_PX, ...style }}>
      {/* PEER·02 is the peer plane and CELL·03 is this one; they are a pair,
          and a pair has to be two colours. The cyan that used to sit here was
          eight degrees off `peerWire`, so the two panels read as one — and it
          pointed at a cyan organism the stage does not have. The Cells out
          there are rose.

          The accent survives the codes being renamed off a shared `MESH·0x`
          family, and it is not made redundant by them: the tag says which
          plane you are reading, the colour says which mesh ON STAGE it is a
          reading of. Only these two panels spend one, because only these two
          have a body out there to be tied to.

          元胞汤 — a soup of cells, not a nerve. 神经元 named a neuron, which
          is the dendrite fabric BETWEEN the bodies and not the bodies this
          panel counts; the fabric has its own vocabulary in `nerve/`. Both of
          its unique glyphs left the hand-subset face with it (fonts/README.md). */}
      <PanelHeader en="CELL MESH" cjk="元胞汤" idx="CELL·03" accent={CELL_PANEL_ACCENT} />
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.tech, color: HUD_COLORS.dim, letterSpacing: 1.2, marginBottom: 2 }}>METABOLISM · PER BLOCK</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: dense ? 4 : 9 }}>
        {/* Tabular figures on every display-family number that ticks: Saira's
            proportional digits make a `1` narrower than a `0`, so a rate
            crossing +9.9 → +10.0 shunts the whole hero sideways and the panel
            twitches once a block. Mono is tabular by nature and needs none. */}
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.hero, fontVariantNumeric: 'tabular-nums', color: netColor, lineHeight: 1, textShadow: `0 0 12px ${netColor}66`, animation: reducedMotion ? undefined : `cknerv-hud-breathe ${HUD_MOTION.hold}ms ${HUD_MOTION.loopEase} infinite` }}>{fmtSigned(churn.netPerBlock)}</span>
        <span style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.label, color: HUD_COLORS.dim, marginBottom: 4 }}>NET/BLK</span>
      </div>
      {/* Born green, died ember — a metabolism, not a fault report. DIED wore
          `danger`, the same red the HUD raises for a reorg, so every ordinary
          block of spent outputs read as a small emergency. Cells being
          consumed is what a living chain looks like; the alarming number
          would be this row at zero. */}
      {dense ? null : (
        <>
          <FlowRow label="BORN" direction="up" color={HUD_COLORS.nominal} width={bornW} value={churn.bornPerBlock} />
          <div style={{ height: 5 }} />
          <FlowRow label="DIED" direction="down" color={HUD_COLORS.ember} width={spentW} value={churn.spentPerBlock} />
        </>
      )}
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
      {/* …and the row it sits in is `lifted`, which is the other half of the
          same argument: a numeral a rung above the row's own value tier has a
          taller ascent, and a row that does not grow with it hands the extra
          height to the numeral and takes it out of the gap below. This pair
          measured 11 px of baseline pitch against the panel's 17 (A-4). */}
      <div style={{ marginTop: dense ? 0 : 11 }}>
        <StatRow label={`${POPULATION_SCOPE.observed} LIVE`} lifted="emphasis"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 700, fontSize: HUD_TYPE.emphasis, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(stats.live)}</span></StatRow>
        {dense ? null : (
          <>
            <StatRow label="Total observed">{fmt(stats.born)}</StatRow>
            <StatRow label="Dead" valueColor={HUD_COLORS.ember}>{fmt(stats.dead)}</StatRow>
          </>
        )}
      </div>
    </HudPanel>
  );
}

// Memoized with the other rail panels — see `BlockchainReadout`. `churn` is
// one object per churn window (`useCellChurn`), so a chain batch that added
// no sample leaves every prop here where it was.
export default memo(CellsPanel);
