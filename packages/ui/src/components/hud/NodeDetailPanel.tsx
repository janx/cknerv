import type { CSSProperties } from 'react';
import type { ChainEntry, ChainNode } from '@cknerv/types';
import { midTruncate } from './cellFormat';
import { formatEpochReadout } from './epochReadout';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';

export default function NodeDetailPanel({ node, chain, onClose, style }: {
  node: ChainNode; chain: ChainEntry; onClose: () => void; style?: CSSProperties;
}) {
  const epoch = formatEpochReadout(chain.epoch);
  return (
    <HudPanel style={{ width: 250, pointerEvents: 'auto', ...style }}>
      <CloseButton onClose={onClose} />
      <PanelHeader en="NODE" cjk="节点" idx="" />
      <StatRow label="Label">{node.label}</StatRow>
      <StatRow label="ID">{midTruncate(node.id, 10, 8)}</StatRow>
      <StatRow label="Role">{node.is_miner ? 'MINER' : 'OBSERVER'}</StatRow>
      <StatRow label="Chain">{chain.chain_name}</StatRow>
      <StatRow label="Tip">#{chain.tip.toLocaleString('en-US')}</StatRow>
      <StatRow label="Epoch">{epoch.number}</StatRow>
      <StatRow label="Epoch progress">{epoch.progress}</StatRow>
    </HudPanel>
  );
}
