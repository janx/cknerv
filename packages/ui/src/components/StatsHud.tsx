import { Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';

import { FONT_DISPLAY, FONT_MONO } from '../ui/fonts';

interface StatsHudProps {
  x: number;
  y: number;
  width: number;
  height: number;
  nodeCount: number;
  edgeCount: number;
  cellCount: number;
}

interface RuntimeStats {
  fps: number;
  msPerFrame: number;
  drawCalls: number;
  triangles: number;
}

const ZERO_STATS: RuntimeStats = {
  fps: 0,
  msPerFrame: 0,
  drawCalls: 0,
  triangles: 0,
};

const PAD_X = 10;
const HEADER_H = 24;
const ROW_H = 14;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_FIELD = 10;
const FONT_SIZE_LABEL = 8.5;

const UPDATE_INTERVAL_MS = 250;

/** Pick a color for an FPS readout. Mirrors typical perf-overlay
 *  thresholds: green at 55+ (smooth 60), amber 30-54 (jank), red below
 *  30 (unusable). */
export function fpsColor(fps: number): string {
  if (fps >= 55) return '#86efac';
  if (fps >= 30) return '#fbbf24';
  return '#f87171';
}

/** Format an integer count with a SI-ish suffix to keep the panel narrow.
 *  TRIS counts hit 100k+ once the cell galaxy populates, which would
 *  overflow the value column at full precision. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}

export default function StatsHud({
  x,
  y,
  width,
  nodeCount,
  edgeCount,
  cellCount,
}: StatsHudProps) {
  const { gl } = useThree();
  const [stats, setStats] = useState<RuntimeStats>(ZERO_STATS);

  // Disable autoReset so info.render counters accumulate across the
  // multiple render passes (main scene + post fx + hud scene) of a single
  // frame. We sample once per UPDATE_INTERVAL_MS, divide by the frames
  // since the last sample to get per-frame averages, and reset manually.
  // Restore the prior mode on unmount so we don't leak global renderer
  // state if this panel is ever toggled off.
  useEffect(() => {
    const prev = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = prev;
    };
  }, [gl]);

  const frameCount = useRef(0);
  const lastSampleAt = useRef(performance.now());

  useFrame(() => {
    frameCount.current += 1;
    const now = performance.now();
    const elapsed = now - lastSampleAt.current;
    if (elapsed < UPDATE_INTERVAL_MS) return;

    const frames = frameCount.current;
    const fps = (frames * 1000) / elapsed;
    const msPerFrame = frames > 0 ? elapsed / frames : 0;
    const info = gl.info;
    setStats({
      fps,
      msPerFrame,
      drawCalls: frames > 0 ? info.render.calls / frames : 0,
      triangles: frames > 0 ? info.render.triangles / frames : 0,
    });
    info.reset();
    frameCount.current = 0;
    lastSampleAt.current = now;
  });

  const fpsValue = stats.fps > 0 ? stats.fps.toFixed(1) : '—';
  const fpsValueColor = stats.fps > 0 ? fpsColor(stats.fps) : '#94a3b8';
  const msValue = stats.msPerFrame > 0 ? stats.msPerFrame.toFixed(1) : '—';

  const fields: Array<{ label: string; value: string; color?: string }> = [
    { label: 'FPS', value: fpsValue, color: fpsValueColor },
    { label: 'MS', value: msValue },
    { label: 'DRAW', value: fmtCompact(stats.drawCalls) },
    { label: 'TRIS', value: fmtCompact(stats.triangles) },
    { label: 'NODES', value: nodeCount.toString() },
    { label: 'EDGES', value: edgeCount.toString() },
    { label: 'CELLS', value: cellCount.toString() },
  ];

  return (
    <group position={[x, y, 0]}>
      <mesh position={[PAD_X + 1, -3, 0]}>
        <planeGeometry args={[18, 1]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.55} />
      </mesh>
      <Text
        font={FONT_DISPLAY}
        position={[PAD_X, -10, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={FONT_SIZE_HEADER}
        color="#a78bfa"
        fillOpacity={0.85}
        letterSpacing={0.32}
        outlineWidth={0.18}
        outlineColor="#7c3aed"
        outlineOpacity={0.45}
      >
        ⟦ STATS ⟧
      </Text>

      {fields.map((f, i) => (
        <FieldRow
          key={f.label}
          x={PAD_X}
          y={-HEADER_H - 4 - ROW_H * i}
          label={f.label}
          value={f.value}
          valueColor={f.color}
          width={width - PAD_X * 2}
        />
      ))}
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
      <Text
        font={FONT_MONO}
        position={[width, 0, 1]}
        anchorX="right"
        anchorY="top"
        fontSize={FONT_SIZE_FIELD}
        color={valueColor ?? '#e2e8f0'}
        letterSpacing={-0.02}
        maxWidth={width - 50}
      >
        {value}
      </Text>
    </group>
  );
}
