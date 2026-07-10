import { type CSSProperties, useMemo } from 'react';
import type { Cell } from '@cknerv/types';
import {
  formatOutpoint, formatCkb, formatAge, formatDataSize,
  formatLockKind, formatAssetKind, LOCK_COLORS, ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait, { SCAN_PERIOD_S } from './CellNucleusPortrait';

const SCAN_KEYFRAMES = `@keyframes cknerv-decode{from{opacity:0;transform:translateX(4px)}to{opacity:1;transform:none}}@keyframes cknerv-scan-cursor{from{top:0%}to{top:100%}}`;
const BRACKET = 9; // corner bracket arm length (px)
const AMBER = HUD_COLORS.orange;

function cornerBracket(corner: 'tl' | 'tr' | 'bl' | 'br'): CSSProperties {
  const vy: CSSProperties = corner[0] === 't' ? { top: 0 } : { bottom: 0 };
  const hx: CSSProperties = corner[1] === 'l' ? { left: 0 } : { right: 0 };
  const bw =
    corner === 'tl' ? '1px 0 0 1px' : corner === 'tr' ? '1px 1px 0 0' :
    corner === 'bl' ? '0 0 1px 1px' : '0 1px 1px 0';
  return { position: 'absolute', width: BRACKET, height: BRACKET, borderColor: AMBER, borderStyle: 'solid', borderWidth: bw, opacity: 0.75, ...vy, ...hx };
}

export default function CellDetailPanel({ cell, onClose, style }: {
  cell: Cell; onClose: () => void; style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const alive = cell.death_at_ms === null;
  const now = Date.now();
  // One scan epoch per selected cell — shared with the portrait beam so it
  // restarts from the top on select and the cursor + decode ride its wake.
  const scanEpochMs = useMemo(() => (typeof performance !== 'undefined' ? performance.now() : 0), [cell.id]);

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
      {!reduced && <style>{SCAN_KEYFRAMES}</style>}
      <CloseButton onClose={onClose} />
      <PanelHeader en="CELL" cjk="共识细胞" idx={`0x${cell.content_hash.slice(2, 10)}`} accent={HUD_COLORS.orange} />
      {/* Portrait framed as a scan instrument: corner brackets + a cursor tick
          riding the right edge in sync with the beam (shared scanEpochMs). */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <CellNucleusPortrait contentHash={cell.content_hash} reducedMotion={reduced} scanEpochMs={scanEpochMs} />
        <span style={cornerBracket('tl')} /><span style={cornerBracket('tr')} />
        <span style={cornerBracket('bl')} /><span style={cornerBracket('br')} />
        {!reduced && (
          <span
            key={cell.id}
            style={{ position: 'absolute', right: -1, width: 5, height: 5, marginTop: -2, background: AMBER, boxShadow: `0 0 6px ${AMBER}`, animation: `cknerv-scan-cursor ${SCAN_PERIOD_S}s linear infinite` }}
          />
        )}
      </div>
      <div key={cell.id}>
        {rows.map(([label, value, color], i) => (
          <div
            key={label}
            style={reduced ? undefined : { animation: 'cknerv-decode 320ms ease both', animationDelay: `${(i / rows.length) * SCAN_PERIOD_S * 1000}ms` }}
          >
            <StatRow label={label} valueColor={color}>{value}</StatRow>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}
