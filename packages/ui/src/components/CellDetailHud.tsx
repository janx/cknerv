import { Text } from '@react-three/drei';
import * as THREE from 'three';

import type { Cell } from '@cknerv/types';
import { FONT_DISPLAY, FONT_MONO, FONT_MONO_BOLD } from '../ui/fonts';
import {
  formatCkb, midTruncate, formatOutpoint, formatDataHex, formatCellKind,
} from './hud/cellFormat';
export { formatCkb, midTruncate, formatOutpoint, formatDataHex, formatCellKind };

export interface CellDetailHudProps {
  cell: Cell;
  onClose: () => void;
  /** Top-left corner of the HUD area in pixel coordinates (camera-local). */
  x: number;
  y: number;
  width: number;
}

const PAD_X = 10;
const HEADER_H = 24;
const ROW_H = 16;

export default function CellDetailHud({
  cell,
  onClose,
  x,
  y,
  width,
}: CellDetailHudProps) {
  return (
    <group position={[x, y, 0]}>
      {/* Header accent rule + title. */}
      <mesh position={[PAD_X + 1, -3, 0]}>
        <planeGeometry args={[18, 1]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.55} />
      </mesh>
      <Text
        font={FONT_DISPLAY}
        position={[PAD_X, -10, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={9.5}
        color="#67e8f9"
        fillOpacity={0.85}
        letterSpacing={0.32}
        outlineWidth={0.18}
        outlineColor="#0ea5e9"
        outlineOpacity={0.45}
      >
        ⟦ CELL ⟧
      </Text>
      <Text
        font={FONT_MONO_BOLD}
        position={[width - PAD_X - 22, -10, 1]}
        anchorX="right"
        anchorY="top"
        fontSize={11}
        color="#e2e8f0"
        letterSpacing={0.04}
      >
        {`#${cell.id}`}
      </Text>
      <Text
        font={FONT_MONO}
        position={[width - PAD_X, -10, 1]}
        anchorX="right"
        anchorY="top"
        fontSize={14}
        color="#94a3b8"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerOver={(e) => {
          (e.object as { material?: { color?: THREE.Color } }).material?.color?.set(
            '#f87171',
          );
        }}
        onPointerOut={(e) => {
          (e.object as { material?: { color?: THREE.Color } }).material?.color?.set(
            '#94a3b8',
          );
        }}
      >
        ×
      </Text>

      {/* Single-column 6-field body. The 3D scan viewport is rendered
          as a sibling block to the LEFT of this panel by the HUD
          layout, not inside the panel. */}
      <FieldRow
        x={PAD_X}
        y={-HEADER_H - 4 - 0}
        label="KIND"
        value={formatCellKind(cell.tag)}
        width={width - PAD_X * 2}
      />
      <FieldRow
        x={PAD_X}
        y={-HEADER_H - 4 - ROW_H * 1}
        label="BLOCK"
        value={`#${cell.birth_block}`}
        width={width - PAD_X * 2}
      />
      <FieldRow
        x={PAD_X}
        y={-HEADER_H - 4 - ROW_H * 2}
        label="OUTPOINT"
        value={formatOutpoint(cell.out_point.tx_hash, cell.out_point.index)}
        width={width - PAD_X * 2}
      />
      <FieldRow
        x={PAD_X}
        y={-HEADER_H - 4 - ROW_H * 3}
        label="STATE"
        value={cell.death_at_ms === null ? 'ALIVE' : 'DYING'}
        width={width - PAD_X * 2}
      />
      <FieldRow
        x={PAD_X}
        y={-HEADER_H - 4 - ROW_H * 4}
        label="CAPACITY"
        value={formatCkb(cell.capacity)}
        width={width - PAD_X * 2}
      />
      <FieldRow
        x={PAD_X}
        y={-HEADER_H - 4 - ROW_H * 5}
        label="DATA"
        value={formatDataHex(cell.data_hex, 14)}
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
  width,
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  width: number;
}) {
  return (
    <group position={[x, y, 0]}>
      <Text
        font={FONT_DISPLAY}
        position={[0, 0, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={8.5}
        color="#64748b"
        letterSpacing={0.28}
      >
        {label}
      </Text>
      <Text
        font={FONT_MONO}
        position={[width, 0, 1]}
        anchorX="right"
        anchorY="top"
        fontSize={11}
        color="#e2e8f0"
        letterSpacing={-0.02}
        maxWidth={width - 60}
      >
        {value}
      </Text>
    </group>
  );
}
