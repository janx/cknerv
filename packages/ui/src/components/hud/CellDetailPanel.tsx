import type { CSSProperties } from 'react';
import type { Cell } from '@cknerv/types';
import { formatCellKind, formatOutpoint, formatCkb, formatDataHex } from '../CellDetailHud';
import { HUD_COLORS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';

export default function CellDetailPanel({ cell, onClose, style }: {
  cell: Cell; onClose: () => void; style?: CSSProperties;
}) {
  const alive = cell.death_at_ms === null;
  return (
    <HudPanel style={{ width: 250, pointerEvents: 'auto', ...style }}>
      <CloseButton onClose={onClose} />
      <PanelHeader en="CELL" cjk="细胞" idx="" />
      <StatRow label="Kind">{formatCellKind(cell.tag)}</StatRow>
      <StatRow label="Block">#{cell.birth_block}</StatRow>
      <StatRow label="Outpoint">{formatOutpoint(cell.out_point.tx_hash, cell.out_point.index)}</StatRow>
      <StatRow label="State" valueColor={alive ? HUD_COLORS.nominal : HUD_COLORS.caution}>{alive ? 'ALIVE' : 'DYING'}</StatRow>
      <StatRow label="Capacity">{formatCkb(cell.capacity)}</StatRow>
      <StatRow label="Data">{formatDataHex(cell.data_hex, 14)}</StatRow>
    </HudPanel>
  );
}
