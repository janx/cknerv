import { Text } from '@react-three/drei';

import type { ChainEntry } from '@cknerv/types';
import { FONT_DISPLAY, FONT_MONO } from '../ui/fonts';

interface CkbNetworkHudProps {
  x: number;
  y: number;
  width: number;
  height: number;
  chain: ChainEntry;
}

const PAD_X = 10;
const HEADER_H = 24;
const ROW_H = 14;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_FIELD = 10;
const FONT_SIZE_LABEL = 8.5;
// Value column x within a FieldRow group. Sized for the widest label
// in `fields` ("TPS (60s)") rendered in Orbitron Medium at
// FONT_SIZE_LABEL with LABEL_LETTER_SPACING — leaves a one-char gap
// before the value so label and number never visually merge.
const VALUE_X = 82;
const LABEL_LETTER_SPACING = 0.18;

/** Average a number array, returning 0 for an empty array. Avoids the
 *  NaN that comes from `sum/0` when the rolling rings haven't seen
 *  their first sample yet. */
function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Render a duration in ms as either `<n>ms` (sub-second) or `<n.n>s`. */
function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Compute rolling TPS and rolling avg block interval from the parallel
 *  per-block rings on `chain`. Both rings are bounded by the backend cap;
 *  here we just sum what's there. Exported for unit tests. */
export function computeRollingStats(chain: ChainEntry): {
  tps: number;
  intervalAvgMs: number;
  intervalLastMs: number | null;
} {
  const intervals = chain.recent_block_intervals_ms;
  const txCounts = chain.recent_block_tx_counts;
  const intervalAvgMs = avg(intervals);
  const intervalLastMs =
    intervals.length > 0 ? intervals[intervals.length - 1] : null;
  // TPS = (sum of tx_counts in the same window the intervals cover) / (sum
  // of those intervals in seconds). We only count tx_counts whose
  // *preceding-interval* lives in the ring — the first tx_count entry has
  // no preceding interval, so the windows are off-by-one. Slice tx_counts
  // to align with intervals.
  const aligned = txCounts.slice(Math.max(0, txCounts.length - intervals.length));
  const totalTx = aligned.reduce((a, b) => a + b, 0);
  const totalSec = intervals.reduce((a, b) => a + b, 0) / 1000;
  const tps = totalSec > 0 ? totalTx / totalSec : 0;
  return { tps, intervalAvgMs, intervalLastMs };
}

export default function CkbNetworkHud({
  x,
  y,
  width,
  chain,
}: CkbNetworkHudProps) {
  // Newest-first: take the tail of the recent ring, then reverse so
  // the highest-numbered block sits at the top of the LATEST list.
  const latestBlocks = chain.recent_blocks.slice(-4).slice().reverse();
  const { tps, intervalAvgMs, intervalLastMs } = computeRollingStats(chain);

  const epochLabel =
    chain.epoch.length > 0
      ? `${chain.epoch.number}.${chain.epoch.index}/${chain.epoch.length}`
      : '—';
  const intervalLabel =
    intervalLastMs === null
      ? '—'
      : `${fmtMs(intervalAvgMs)} · ${fmtMs(intervalLastMs)}`;
  const mempoolLabel = `${chain.mempool.pending} · ${chain.mempool.proposed}`;
  const tpsLabel = tps > 0 ? tps.toFixed(2) : '0.00';

  // Field layout — order matters: most-actionable fields on top, history
  // (LATEST) on the bottom.
  const fields: Array<{ label: string; value: string; title?: string }> = [
    { label: 'TIP', value: `#${chain.tip}` },
    { label: 'EPOCH', value: epochLabel, title: 'epoch number . index / length' },
    { label: 'BLOCKS', value: chain.total_blocks.toString() },
    { label: 'TXS', value: chain.total_txs.toString() },
    { label: 'TPS (60s)', value: tpsLabel, title: 'rolling tx/s over the recent block ring' },
    { label: 'INTERVAL', value: intervalLabel, title: 'avg · last block interval' },
    {
      label: 'MEMPOOL',
      value: mempoolLabel,
      title: 'pending · proposed (tx_pool_info)',
    },
    { label: 'REORGS', value: chain.reorgs.toString() },
  ];

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
        ⟦ BLOCKCHAIN ⟧
      </Text>

      {fields.map((f, i) => (
        <FieldRow
          key={f.label}
          x={PAD_X}
          y={-HEADER_H - 4 - ROW_H * i}
          label={f.label}
          value={f.value}
          width={width - PAD_X * 2}
        />
      ))}

      {/* LATEST sub-section */}
      <Text
        font={FONT_DISPLAY}
        position={[PAD_X, -HEADER_H - 4 - ROW_H * fields.length - 6, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={FONT_SIZE_LABEL}
        color="#64748b"
        letterSpacing={0.28}
      >
        LATEST
      </Text>

      {latestBlocks.map((blk, i) => {
        const shortHash = blk.hash.slice(0, 12);
        const yRow =
          -HEADER_H - 4 - ROW_H * fields.length - 6 - ROW_H - i * ROW_H;
        return (
          <group key={blk.number} position={[PAD_X, yRow, 0]}>
            <Text
              font={FONT_MONO}
              position={[0, 0, 1]}
              anchorX="left"
              anchorY="top"
              fontSize={FONT_SIZE_FIELD}
              color="#94a3b8"
              letterSpacing={-0.02}
              maxWidth={width - PAD_X * 2}
            >
              {`#${blk.number.toString().padEnd(8, ' ')} ${shortHash}`}
            </Text>
          </group>
        );
      })}
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
        fontSize={FONT_SIZE_LABEL}
        color="#64748b"
        letterSpacing={LABEL_LETTER_SPACING}
        maxWidth={VALUE_X - 4}
      >
        {label}
      </Text>
      <Text
        font={FONT_MONO}
        position={[VALUE_X, 0, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={FONT_SIZE_FIELD}
        color="#e2e8f0"
        letterSpacing={-0.02}
        maxWidth={width - VALUE_X}
      >
        {value}
      </Text>
    </group>
  );
}
