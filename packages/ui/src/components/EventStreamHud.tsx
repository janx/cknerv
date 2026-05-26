import { useMemo } from 'react';
import { Text } from '@react-three/drei';

import { FONT_DISPLAY, FONT_MONO, FONT_MONO_BOLD } from '../ui/fonts';
import { buildEventLines } from '../derives/eventStreamLines';

/**
 * A rendered event line. Consumers supply a `formatRow` that converts
 * each entry of their chosen shape into this canonical record (or
 * `null` to omit the entry from the HUD).
 */
export interface RenderedLine {
  seq: number;
  ts: number;
  kind: string;
  detail: string;
  color: string;
}

export interface EventStreamHudProps<Entry> {
  entries: Entry[];
  formatRow: (entry: Entry) => RenderedLine | null;
  /** Top-left corner of the HUD area in pixel coordinates (camera-local). */
  x: number;
  y: number;
  /** Total width of the HUD column in pixels. */
  width: number;
  /** Maximum number of events to show. */
  limit?: number;
}

const LINE_HEIGHT = 16;
const FONT_SIZE = 12;
const KIND_FONT_SIZE = 10;
const HEADER_FONT_SIZE = 10;
const PAD_X = 10;
const PAD_TOP = 26;
// Pixel width allotted to the time + kind columns. The detail span
// gets the rest. Adjusting these numbers re-balances how much
// horizontal real estate each column claims.
const TIME_COL = 64;
const KIND_COL = 64;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function EventStreamHud<Entry>({
  entries,
  formatRow,
  x,
  y,
  width,
  limit = 16,
}: EventStreamHudProps<Entry>) {
  const lines = useMemo(
    () => buildEventLines(entries, formatRow, limit),
    [entries, formatRow, limit],
  );

  return (
    <group position={[x, y, 0]}>
      {/* Accent rule above the header. */}
      <mesh position={[PAD_X + 1, -3, 0]}>
        <planeGeometry args={[18, 1]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.55} />
      </mesh>
      <Text
        font={FONT_DISPLAY}
        position={[PAD_X, -10, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={HEADER_FONT_SIZE}
        color="#67e8f9"
        fillOpacity={0.85}
        letterSpacing={0.32}
        outlineWidth={0.18}
        outlineColor="#0ea5e9"
        outlineOpacity={0.45}
      >
        ⟦ EVENTS ⟧
      </Text>
      <Text
        font={FONT_MONO_BOLD}
        position={[width - PAD_X, -10, 1]}
        anchorX="right"
        anchorY="top"
        fontSize={HEADER_FONT_SIZE}
        color="#67e8f9"
        fillOpacity={0.75}
        letterSpacing={0.08}
      >
        {`Σ ${entries.length.toString().padStart(4, '0')}`}
      </Text>

      {/* Event lines — uniform opacity (no fade). */}
      {lines.map((line, idx) => {
        const yLine = -PAD_TOP - idx * LINE_HEIGHT - 2;
        const opacity = 1;
        const detailX = PAD_X + TIME_COL + KIND_COL;
        const detailW = width - detailX - PAD_X;
        return (
          <group key={line.seq} position={[0, yLine, 0]}>
            <Text
              font={FONT_MONO}
              position={[PAD_X, 0, 1]}
              anchorX="left"
              anchorY="top"
              fontSize={FONT_SIZE - 1}
              color="#64748b"
              fillOpacity={opacity}
              letterSpacing={-0.02}
            >
              {formatTime(line.ts)}
            </Text>
            <Text
              font={FONT_MONO_BOLD}
              position={[PAD_X + TIME_COL, 0, 1]}
              anchorX="left"
              anchorY="top"
              fontSize={KIND_FONT_SIZE}
              color={line.color}
              fillOpacity={opacity}
              letterSpacing={0.18}
              outlineWidth={0.12}
              outlineColor={line.color}
              outlineOpacity={0.35}
            >
              {line.kind.padEnd(6, ' ')}
            </Text>
            <Text
              font={FONT_MONO}
              position={[detailX, 0, 1]}
              anchorX="left"
              anchorY="top"
              fontSize={FONT_SIZE - 1}
              color="#e2e8f0"
              fillOpacity={opacity}
              letterSpacing={-0.02}
              maxWidth={detailW}
              clipRect={[0, -LINE_HEIGHT, detailW, 0]}
              overflowWrap="normal"
              whiteSpace="nowrap"
            >
              {line.detail}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
