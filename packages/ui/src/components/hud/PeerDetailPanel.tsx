import type { CSSProperties } from 'react';
import type { ChainEntry, Peer } from '@cknerv/types';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function PeerDetailPanel({ peer, chain, onClose, style }: {
  peer: Peer; chain: ChainEntry; onClose: () => void; style?: CSSProperties;
}) {
  const sync =
    peer.best_known == null ? '—'
    : peer.best_known >= chain.tip ? 'AT TIP'
    : `${chain.tip - peer.best_known} BEHIND`;
  return (
    <HudPanel style={{ width: 250, pointerEvents: 'auto', ...style }}>
      <CloseButton onClose={onClose} />
      <PanelHeader en="PEER" cjk="对端" idx="" />
      <StatRow label="Addr">{peer.addr || '—'}</StatRow>
      <StatRow label="Dir">{peer.direction.toUpperCase()}</StatRow>
      <StatRow label="Ver">{peer.version || '—'}</StatRow>
      <StatRow label="Ping">{peer.latency_ms == null ? '—' : `${peer.latency_ms} ms`}</StatRow>
      <StatRow label="Sync">{sync}</StatRow>
      <StatRow label="Uptime">{fmtUptime(peer.connected_ms)}</StatRow>
    </HudPanel>
  );
}
