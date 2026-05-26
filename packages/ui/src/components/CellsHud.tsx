import { Text } from '@react-three/drei';

import { FONT_DISPLAY, FONT_MONO } from '../ui/fonts';
import type { CellKindKey, CellsStats } from '../derives/cellsStats.derive';

interface CellsHudProps {
  x: number;
  y: number;
  width: number;
  stats: CellsStats;
}

const PAD_X = 10;
const HEADER_H = 24;
const ROW_H = 16;
const SUB_GAP = 8;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_FIELD = 10;
const FONT_SIZE_LABEL = 8.5;

const KIND_ROW_ORDER: CellKindKey[] = ['wallet', 'dex', 'cf', 'ckbloom', 'generic'];
const KIND_LABEL: Record<CellKindKey, string> = {
  wallet: 'WALLET',
  dex: 'DEX',
  cf: 'CF',
  ckbloom: 'CKBLOOM',
  generic: 'GENERIC',
};

/** Common Knowledge: bytes of on-chain state locked across all live cells.
 *  Conversion is the same shannons → CKB math (1 byte = 10^8 shannons), but
 *  presented as the underlying state-storage unit (Bytes) rather than the
 *  fee/value unit (CKB). Whole bytes only — sub-shannon fractions don't
 *  exist at this layer, and integer counts read cleaner with thousands
 *  separators. */
export function formatCommonKnowledgeBytes(shannons: number): string {
  const bytes = Math.round(shannons / 100_000_000);
  return `${bytes.toLocaleString('en-US')} Bytes`;
}

export default function CellsHud({ x, y, width, stats }: CellsHudProps) {
  // Collapse GENERIC when zero; everything else stays for stable layout.
  const kindRows = KIND_ROW_ORDER.filter(
    (k) => k !== 'generic' || stats.byKind.generic > 0,
  );

  const counters: { label: string; value: string; color?: string }[] = [
    { label: 'TOTAL', value: stats.born.toString() },
    { label: 'ALIVE', value: stats.live.toString(), color: '#34d399' },
    { label: 'DEAD', value: stats.dead.toString(), color: '#f87171' },
  ];

  const cursor = -HEADER_H - 4;

  return (
    <group position={[x, y, 0]}>
      <mesh position={[PAD_X + 1, -3, 0]}>
        <planeGeometry args={[18, 1]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.55} />
      </mesh>
      <Text
        font={FONT_DISPLAY}
        position={[PAD_X, -10, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={FONT_SIZE_HEADER}
        color="#67e8f9"
        fillOpacity={0.85}
        letterSpacing={0.32}
        outlineWidth={0.18}
        outlineColor="#0ea5e9"
        outlineOpacity={0.45}
      >
        ⟦ CELLS ⟧
      </Text>

      {counters.map((c, i) => (
        <FieldRow
          key={c.label}
          x={PAD_X}
          y={cursor - ROW_H * i}
          label={c.label}
          value={c.value}
          valueColor={c.color}
          width={width - PAD_X * 2}
        />
      ))}

      {/* BY KIND sub-header + rows. */}
      <SubHeader
        x={PAD_X}
        y={cursor - ROW_H * counters.length - SUB_GAP}
        label="BY KIND"
      />

      {kindRows.map((k, i) => (
        <FieldRow
          key={k}
          x={PAD_X}
          y={cursor - ROW_H * counters.length - SUB_GAP - ROW_H * (i + 1)}
          label={KIND_LABEL[k]}
          value={stats.byKind[k].toString()}
          width={width - PAD_X * 2}
        />
      ))}

      {/* COMMON KNOWLEDGE sub-header + bytes-locked row. */}
      <SubHeader
        x={PAD_X}
        y={
          cursor -
          ROW_H * counters.length -
          SUB_GAP -
          ROW_H * (kindRows.length + 1) -
          SUB_GAP
        }
        label="COMMON KNOWLEDGE"
      />
      <FieldRow
        x={PAD_X}
        y={
          cursor -
          ROW_H * counters.length -
          SUB_GAP -
          ROW_H * (kindRows.length + 1) -
          SUB_GAP -
          ROW_H
        }
        label=""
        value={formatCommonKnowledgeBytes(stats.capacityShannons)}
        width={width - PAD_X * 2}
      />
    </group>
  );
}

function FieldRow({
  x,
  y,
  label,
  value,
  valueColor,
  width,
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  valueColor?: string;
  width: number;
}) {
  return (
    <group position={[x, y, 0]}>
      {label ? (
        <Text
          font={FONT_DISPLAY}
          position={[0, 0, 1]}
          anchorX="left"
          anchorY="top"
          fontSize={FONT_SIZE_LABEL}
          color="#64748b"
          letterSpacing={0.28}
        >
          {label}
        </Text>
      ) : null}
      <Text
        font={FONT_MONO}
        position={[width, 0, 1]}
        anchorX="right"
        anchorY="top"
        fontSize={FONT_SIZE_FIELD}
        color={valueColor ?? '#e2e8f0'}
        letterSpacing={-0.02}
        maxWidth={width - 60}
      >
        {value}
      </Text>
    </group>
  );
}

function SubHeader({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <Text
      font={FONT_DISPLAY}
      position={[x, y, 1]}
      anchorX="left"
      anchorY="top"
      fontSize={FONT_SIZE_LABEL}
      color="#64748b"
      letterSpacing={0.28}
    >
      {label}
    </Text>
  );
}
