// Detail panel for a selected peer (a node in the PeerConstellation).
// Mirrors ChainNodeDetailHud's visual language.

import { Text } from '@react-three/drei';
import type { ChainEntry, Peer } from '@cknerv/types';
import { FONT_DISPLAY, FONT_MONO, syncProximity } from '@cknerv/ui';

export interface PeerDetailHudProps {
  peer: Peer;
  chain: ChainEntry;
  x: number;
  y: number;
  width: number;
}

const PAD_X = 10;
const HEADER_H = 24;
const ROW_H = 14;
const VALUE_X = 64;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_FIELD = 10;
const FONT_SIZE_LABEL = 8.5;
const LABEL_LETTER_SPACING = 0.18;

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function PeerDetailHud({ peer, chain, x, y, width }: PeerDetailHudProps) {
  const lag = peer.best_known == null ? null : Math.max(0, chain.tip - peer.best_known);
  const syncLabel =
    peer.best_known == null
      ? '—'
      : syncProximity(peer.best_known, chain.tip) >= 1
        ? 'at tip'
        : `${lag} behind`;

  const fields: Array<{ label: string; value: string }> = [
    { label: 'ADDR', value: peer.addr || '—' },
    { label: 'DIR', value: peer.direction.toUpperCase() },
    { label: 'VER', value: peer.version || '—' },
    { label: 'PING', value: peer.latency_ms == null ? '—' : `${peer.latency_ms} ms` },
    { label: 'SYNC', value: syncLabel },
    { label: 'UPTIME', value: fmtUptime(peer.connected_ms) },
  ];

  return (
    <group position={[x, y, 0]}>
      <mesh position={[PAD_X + 1, -3, 0]}>
        <planeGeometry args={[18, 1]} />
        <meshBasicMaterial color="#7df9ff" transparent opacity={0.55} />
      </mesh>
      <Text
        font={FONT_DISPLAY}
        position={[PAD_X, -10, 1]}
        anchorX="left"
        anchorY="top"
        fontSize={FONT_SIZE_HEADER}
        color="#7df9ff"
        fillOpacity={0.9}
        letterSpacing={0.32}
        outlineWidth={0.18}
        outlineColor="#0ea5e9"
        outlineOpacity={0.45}
      >
        ⟦ PEER ⟧
      </Text>
      {fields.map((f, i) => (
        <group key={f.label} position={[PAD_X, -HEADER_H - 4 - ROW_H * i, 0]}>
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
            {f.label}
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
            {f.value}
          </Text>
        </group>
      ))}
    </group>
  );
}
