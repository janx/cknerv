import { type CSSProperties, useMemo, useRef, useState } from 'react';
import type { Cell } from '@cknerv/types';
import {
  formatOutpoint, formatCkb, formatAge, formatDataSize,
  formatLockKind, formatAssetKind, LOCK_COLORS, ASSET_COLORS,
} from './cellFormat';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { HudPanel, PanelHeader, StatRow, CloseButton } from './primitives';
import { useReducedMotion } from './useReducedMotion';
import CellNucleusPortrait, { type ProbeScreen } from './CellNucleusPortrait';
import SpecimenProbe from './SpecimenProbe';
import { probeScan } from './probeScan';
import { specimenMorphology, LANDMARK_FIELDS } from '../../derives/specimenMorphology';
import { hashToAcgt } from '../../derives/specimenKit';

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

// landmark field → decoded readout (label, value, color). The six landmark-coupled
// fields, keyed by the anatomical field the marker probe walks; the probe reveals
// each row as its landmark is scanned (see below).
type RowDecode = { label: string; value: string; color?: string };
type Field = (typeof LANDMARK_FIELDS)[number];

const nowPerf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export default function CellDetailPanel({ cell, onClose, style }: {
  cell: Cell; onClose: () => void; style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const alive = cell.death_at_ms === null;
  const now = Date.now();
  // One scan epoch per selected cell — shared with the portrait so the probe
  // restarts from the top on select and the readout rides the SAME cycle as the
  // in-Canvas reticle (performance.now()-based, like the portrait's probeScan).
  const scanEpochMs = useMemo(() => nowPerf(), [cell.id]);

  const morph = useMemo(() => specimenMorphology(cell), [cell]);
  // present landmarks in canonical order (organelle may be absent → no DATA scan)
  const order = useMemo(() => LANDMARK_FIELDS.filter((f) => morph.landmarks[f] !== null), [morph]);
  const probeRef = useRef<ProbeScreen>({ x: 0, y: 0, visible: false, index: 0, lockT: 0, traveling: true });

  // cross-highlight: after the scan completes the user can click a landmark ROW or
  // an ENDPOINT in the portrait to select it — both highlight in sync (bidirectional).
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  const [lastCellId, setLastCellId] = useState(cell.id);
  if (cell.id !== lastCellId) { setLastCellId(cell.id); setSelectedField(null); } // reset selection on cell change
  const selectField = (f: Field) => setSelectedField((cur) => (cur === f ? null : f));

  const DECODE: Record<Field, RowDecode> = {
    core: { label: 'CAPACITY', value: formatCkb(cell.capacity) },
    species: { label: 'ASSET', value: formatAssetKind(cell.asset_kind), color: cell.asset_kind ? ASSET_COLORS[cell.asset_kind] : HUD_COLORS.dim },
    membrane: { label: 'LOCK', value: formatLockKind(cell.lock_kind), color: cell.lock_kind ? LOCK_COLORS[cell.lock_kind] : HUD_COLORS.dim },
    organelle: { label: 'DATA', value: formatDataSize(cell.data_hex), color: HUD_COLORS.nominal },
    body: { label: 'STATE', value: alive ? '● ALIVE' : '✖ DYING', color: alive ? HUD_COLORS.nominal : HUD_COLORS.caution },
    outer: { label: 'BORN', value: `#${cell.birth_block}` },
  };
  // the reticle callout reads the field the probe locked onto (index into `order`)
  const labelFor = (index: number) => {
    const f = order[Math.min(index, order.length - 1)] ?? LANDMARK_FIELDS[0];
    const d = DECODE[f];
    return { field: d.label, value: d.value };
  };

  // probe state for THIS render (rows/status/genome); reticle position comes from
  // probeRef via SpecimenProbe's rAF. reduced → frozen fully-classified readout.
  const p = probeScan(scanEpochMs, reduced ? 0 : nowPerf(), order.length, reduced);
  const genome = hashToAcgt(cell.content_hash);
  const genomeShown = genome.slice(0, Math.floor((p.classified ? 1 : p.pct / 100) * genome.length));
  const statusText = p.classified ? '✓ CLASSIFIED' : p.status === 'unidentified' ? 'UNIDENTIFIED SPECIMEN' : `CLASSIFYING ${p.pct}%`;
  const statusColor = p.classified ? HUD_COLORS.nominal : HUD_COLORS.cyanWire;
  const interactive = p.classified; // scan finished → rows + endpoints become clickable/cross-highlight

  // All eight readout rows are ALWAYS mounted (text always in the DOM) and only
  // opacity-gated: present-landmark rows resolve as the probe reveal climbs (in
  // scan order → they light top-to-bottom in sync with the reticle); an absent
  // landmark (e.g. organelle with no data) resolves once the specimen classifies;
  // AGE + SOURCE are context, always shown.
  const rows: Array<RowDecode & { on: boolean; field?: Field }> = [
    ...LANDMARK_FIELDS.map((f) => {
      const oi = order.indexOf(f);
      const on = oi === -1 ? p.classified : oi < p.reveal;
      return { ...DECODE[f], on, field: f };
    }),
    { label: 'AGE', value: formatAge(cell.born_at_ms, now), on: true },
    { label: 'SOURCE', value: formatOutpoint(cell.out_point.tx_hash, cell.out_point.index), on: true },
  ];

  return (
    <HudPanel style={{ width: 270, pointerEvents: 'auto', ...style }}>
      <CloseButton onClose={onClose} />
      <PanelHeader en="CELL" cjk="共识细胞" idx={`0x${cell.content_hash.slice(2, 10)}`} accent={HUD_COLORS.orange} />
      {/* Portrait framed as an assay chamber: corner brackets + the marker probe
          reticle (SpecimenProbe) riding the projected landmark. */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <CellNucleusPortrait cell={cell} reducedMotion={reduced} scanEpochMs={scanEpochMs} probeRef={probeRef} interactive={interactive} selectedField={selectedField} onSelectField={selectField} />
        <span style={cornerBracket('tl')} /><span style={cornerBracket('tr')} />
        <span style={cornerBracket('bl')} /><span style={cornerBracket('br')} />
        <SpecimenProbe probeRef={probeRef} epochMs={scanEpochMs} count={order.length} reduced={reduced} labelFor={labelFor} />
      </div>
      <div key={cell.id}>
        {rows.map((row) => {
          const clickable = interactive && !!row.field && order.includes(row.field);
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
      {/* Live assay verdict + streaming genome — resolves with the scan. */}
      <div key={`assay-${cell.id}`} style={{ marginTop: 9, borderTop: `1px solid ${AMBER}22`, paddingTop: 7 }}>
        <div style={{ fontFamily: HUD_FONTS.mono, fontSize: 9.5, letterSpacing: 0.5, color: statusColor, textShadow: `0 0 6px ${statusColor}66`, transition: reduced ? undefined : 'color 320ms ease' }}>
          {statusText}
        </div>
        <div style={{ marginTop: 6, lineHeight: 1.5 }}>
          <span style={{ fontFamily: HUD_FONTS.tech, fontWeight: 500, fontSize: 8, letterSpacing: 1.4, color: HUD_COLORS.dim }}>GENOME ▸ </span>
          <span style={{ fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: HUD_COLORS.cyanWire, wordBreak: 'break-all', textShadow: `0 0 5px ${HUD_COLORS.cyanWire}55` }}>{genomeShown}</span>
        </div>
      </div>
    </HudPanel>
  );
}
