import type { CSSProperties } from 'react';
import type { ChainEntry } from '@cknerv/types';
import { computeRollingStats } from '../CkbNetworkHud';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow } from './primitives';

const fmt = (n: number) => n.toLocaleString('en-US');
function fmtInterval(ms: number): string { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; }

export default function BlockchainReadout({ chain, style }: { chain: ChainEntry; style?: CSSProperties }) {
  const { tps, intervalAvgMs, intervalLastMs } = computeRollingStats(chain);
  const ep = chain.epoch;
  return (
    <HudPanel style={{ width: 218, ...style }}>
      <PanelHeader en="BLOCKCHAIN" cjk="主链" idx="SYS-01" />
      <StatRow label="Tip"><span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 13, color: '#fff' }}>#{fmt(chain.tip)}</span></StatRow>
      <StatRow label="Epoch">{ep.number}.{ep.index}/{ep.length}</StatRow>
      <StatRow label="Blocks">{fmt(chain.total_blocks)}</StatRow>
      <StatRow label="Txs">{fmt(chain.total_txs)}</StatRow>
      <StatRow label="Tps 60s">{tps.toFixed(2)}</StatRow>
      <StatRow label="Interval">{fmtInterval(intervalAvgMs)} · {intervalLastMs != null ? fmtInterval(intervalLastMs) : '—'}</StatRow>
      <StatRow label="Mempool">{chain.mempool.pending} · {chain.mempool.proposed}</StatRow>
      <StatRow label="Reorgs" valueColor={chain.reorgs > 0 ? HUD_COLORS.danger : undefined}>{chain.reorgs}</StatRow>
    </HudPanel>
  );
}
