import { type CSSProperties } from 'react';
import type { Cell } from '@cknerv/types';
import {
  formatOutpoint, formatCkb, formatAge, formatDataSize,
  formatLockKind, formatAssetKind, LOCK_COLORS, ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait from './CellNucleusPortrait';

const DECODE_KEYFRAMES = `@keyframes cknerv-decode{from{opacity:0;transform:translateX(4px)}to{opacity:1;transform:none}}`;

export default function CellDetailPanel({ cell, onClose, style }: {
  cell: Cell; onClose: () => void; style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const alive = cell.death_at_ms === null;
  const now = Date.now();

  // Rows decode top→bottom on open; re-keyed by cell.id so it replays on
  // selection change. Static (no animation) under reduced motion.
  const rows: Array<[string, string, string | undefined]> = [
    ['LOCK', formatLockKind(cell.lock_kind), cell.lock_kind ? LOCK_COLORS[cell.lock_kind] : HUD_COLORS.dim],
    ['ASSET', formatAssetKind(cell.asset_kind), cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.dim],
    ['CAPACITY', formatCkb(cell.capacity), undefined],
    ['STATE', alive ? '● ALIVE' : '✖ DYING', alive ? HUD_COLORS.nominal : HUD_COLORS.caution],
    ['AGE', formatAge(cell.born_at_ms, now), undefined],
    ['BORN', `#${cell.birth_block}`, undefined],
    ['SOURCE', formatOutpoint(cell.out_point.tx_hash, cell.out_point.index), undefined],
    ['DATA', formatDataSize(cell.data_hex), undefined],
  ];

  return (
    <HudPanel style={{ width: 270, pointerEvents: 'auto', ...style }}>
      {!reduced && <style>{DECODE_KEYFRAMES}</style>}
      <CloseButton onClose={onClose} />
      <PanelHeader en="CELL" cjk="细胞" idx={`0x${cell.content_hash.slice(2, 10)}`} accent={HUD_COLORS.orange} />
      {/* scanEpochMs placeholder — Task 2 supplies the shared cursor/decode epoch */}
      <CellNucleusPortrait contentHash={cell.content_hash} reducedMotion={reduced} scanEpochMs={0} />
      <div key={cell.id}>
        {rows.map(([label, value, color], i) => (
          <div
            key={label}
            style={reduced ? undefined : { animation: 'cknerv-decode 300ms ease both', animationDelay: `${i * 55}ms` }}
          >
            <StatRow label={label} valueColor={color}>{value}</StatRow>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}
