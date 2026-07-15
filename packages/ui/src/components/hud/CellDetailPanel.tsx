import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { Cell } from '@cknerv/types';
import {
  formatOutpoint, formatCkb, formatAge, formatDataSize,
  formatLockKind, formatAssetKind, LOCK_COLORS, ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait from './CellNucleusPortrait';
import { PROBE_STEP_S, probeScan } from './probeScan';
import { deriveCellVisual } from '../../derives/cellVisual.derive';
import {
  CONSENSUS_BRAID_FIELDS,
  consensusBraidAgreementTarget,
  consensusBraidFrequencies,
  consensusBraidStrandCount,
  type ConsensusBraidField,
} from '../../derives/consensusBraid.derive';

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

// Consensus field → decoded readout. These six rows are the readable grammar of
// A, not an anatomical classification layered over the Cell.
type RowDecode = { label: string; value: string; color?: string };
type Field = ConsensusBraidField;

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export default function CellDetailPanel({ cell, onClose, style }: {
  cell: Cell; onClose: () => void; style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const alive = cell.death_at_ms === null;
  const now = Date.now();
  // One scan epoch per selected Cell. A short-lived 12.5 fps ticker advances
  // only the six-field decoding pass; it stops permanently after classification.
  const scanEpochMs = useMemo(() => nowPerf(), [cell.id]);
  const [scanNowMs, setScanNowMs] = useState(() => nowPerf());

  const visual = useMemo(() => deriveCellVisual(cell), [cell]);
  const order = CONSENSUS_BRAID_FIELDS;
  const frequencies = consensusBraidFrequencies(visual.assetClass);
  const strandCount = consensusBraidStrandCount(visual.lockClass);
  const agreementTarget = consensusBraidAgreementTarget(visual);

  // After decoding, a row directly focuses its corresponding A layer.
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  useEffect(() => setSelectedField(null), [cell.id]);
  useEffect(() => {
    if (reduced) return;
    const update = () => setScanNowMs(nowPerf());
    update();
    const interval = window.setInterval(update, 80);
    const stop = window.setTimeout(() => {
      window.clearInterval(interval);
      update();
    }, order.length * PROBE_STEP_S * 1000 + 80);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [cell.id, reduced, order.length]);
  const selectField = (f: Field) => setSelectedField((cur) => (cur === f ? null : f));

  const DECODE: Record<Field, RowDecode> = {
    capacity: {
      label: 'CAPACITY',
      value: `${formatCkb(cell.capacity)} · ${visual.mass.toFixed(2)}×`,
    },
    asset: {
      label: 'ASSET',
      value: `${formatAssetKind(cell.asset_kind)} · ƒ${frequencies.join(':')}`,
      color: cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.dim,
    },
    lock: {
      label: 'LOCK',
      value: `${formatLockKind(cell.lock_kind)} · ${strandCount} paths`,
      color: cell.lock_kind ? LOCK_COLORS[cell.lock_kind] : HUD_COLORS.dim,
    },
    data: {
      label: 'DATA',
      value: `${formatDataSize(cell.data_hex)} · ${agreementTarget} knots`,
      color: HUD_COLORS.nominal,
    },
    state: {
      label: 'STATE',
      value: alive ? '● ALIVE' : '✖ DYING',
      color: alive ? HUD_COLORS.nominal : HUD_COLORS.caution,
    },
    born: { label: 'BORN', value: `#${cell.birth_block}` },
  };

  // Scan state for THIS render. During decoding it walks the six visible A
  // layers; after classification, clicking a row becomes the focus source.
  const p = probeScan(scanEpochMs, reduced ? 0 : scanNowMs, order.length, reduced);
  const microcode = cell.content_hash.replace(/^0x/, '').toUpperCase();
  const microcodeShown = microcode.slice(0, Math.floor((p.classified ? 1 : p.pct / 100) * microcode.length));
  const statusText = p.classified
    ? '✓ CONSENSUS MAPPED'
    : p.status === 'unidentified'
      ? 'UNMAPPED RECORD'
      : `DECODING ${p.pct}%`;
  const statusColor = p.classified ? HUD_COLORS.nominal : HUD_COLORS.cyanWire;
  const interactive = p.classified;
  const focusField = interactive
    ? selectedField
    : order[Math.min(p.activeIndex, order.length - 1)] ?? null;

  // All eight readout rows remain mounted and opacity-gated. The six encoded
  // rows resolve in the same order that the portrait emphasizes their layers;
  // AGE + SOURCE are context and always shown.
  const rows: Array<RowDecode & { on: boolean; field?: Field }> = [
    ...order.map((field, index) => ({
      ...DECODE[field],
      on: index < p.reveal,
      field,
    })),
    { label: 'AGE', value: formatAge(cell.born_at_ms, now), on: true },
    { label: 'SOURCE', value: formatOutpoint(cell.out_point.tx_hash, cell.out_point.index), on: true },
  ];

  return (
    <HudPanel style={{
      width: 270,
      pointerEvents: 'auto',
      transformOrigin: 'right top',
      animation: reduced
        ? undefined
        : 'cknerv-cell-consensus-enter 280ms cubic-bezier(.2,.82,.2,1) both',
      ...style,
    }}>
      <CloseButton onClose={onClose} />
      <PanelHeader en="CELL" cjk="共识细胞" idx={`0x${cell.content_hash.slice(2, 10)}`} accent={HUD_COLORS.orange} />
      {/* The scan now acts on A itself: each phase emphasizes one encoded layer. */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <CellNucleusPortrait
          cell={cell}
          reducedMotion={reduced}
          scanEpochMs={scanEpochMs}
          focusField={focusField}
        />
        <span style={cornerBracket('tl')} /><span style={cornerBracket('tr')} />
        <span style={cornerBracket('bl')} /><span style={cornerBracket('br')} />
      </div>
      <div key={cell.id}>
        {rows.map((row) => {
          const clickable = interactive && !!row.field;
          const sel = !!row.field && row.field === selectedField;
          return (
            <div
              key={row.label}
              onClick={clickable ? () => selectField(row.field!) : undefined}
              style={{
                opacity: reduced || row.on ? 1 : 0.16,
                transition: reduced ? undefined : 'opacity 320ms ease',
                cursor: clickable ? 'pointer' : undefined,
                background: sel ? `${HUD_COLORS.cyanWire}1f` : undefined,
                boxShadow: sel ? `inset 2px 0 0 ${HUD_COLORS.cyanWire}` : undefined,
              }}
            >
              <StatRow label={row.label} valueColor={row.color}>{row.value}</StatRow>
            </div>
          );
        })}
      </div>
      {/* Live consensus verdict + streaming content-hash microcode. */}
      <div key={`assay-${cell.id}`} style={{ marginTop: 9, borderTop: `1px solid ${AMBER}22`, paddingTop: 7 }}>
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 0.5, color: statusColor, textShadow: `0 0 6px ${statusColor}66`, transition: reduced ? undefined : 'color 320ms ease' }}>
          {statusText}
        </div>
        <div style={{ marginTop: 6, lineHeight: 1.5 }}>
          <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8, letterSpacing: 1.4, color: HUD_COLORS.dim }}>MICROCODE ▸ </span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: HUD_COLORS.cyanWire, wordBreak: 'break-all', textShadow: `0 0 5px ${HUD_COLORS.cyanWire}55` }}>{microcodeShown}</span>
        </div>
      </div>
    </HudPanel>
  );
}
