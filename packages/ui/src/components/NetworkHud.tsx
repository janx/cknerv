import { Text } from '@react-three/drei';
import type { ChainEntry, ChainNode, Peer } from '@cknerv/types';
import { FONT_DISPLAY, FONT_MONO } from '../ui/fonts';
import { summarizeNetwork } from '../derives/peers.derive';

interface NetworkHudProps {
  x: number;
  y: number;
  width: number;
  peers: Peer[];
  chain: ChainEntry;
  localNode: ChainNode | undefined;
}

const PAD_X = 10;
const HEADER_H = 24;
const ROW_H = 14;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_FIELD = 10;
const FONT_SIZE_LABEL = 8.5;
const VALUE_X = 86;
const LABEL_LETTER_SPACING = 0.18;

export default function NetworkHud({ x, y, width, peers, chain, localNode }: NetworkHudProps) {
  const s = summarizeNetwork(peers, chain, localNode);
  const fields: Array<{ label: string; value: string }> = [
    { label: 'PEERS', value: s.peerCount.toString() },
    { label: 'OUT · IN', value: `${s.outbound} · ${s.inbound}` },
    { label: 'VERSION', value: s.version || '—' },
    { label: 'CONNECTS', value: s.connections.toString() },
    { label: 'PING med', value: s.medianPingMs == null ? '—' : `${Math.round(s.medianPingMs)} ms` },
    { label: 'SYNC', value: s.syncLabel },
    { label: 'BEST', value: `#${s.bestKnown}` },
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
        ⟦ NETWORK ⟧
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
            color={f.label === 'SYNC' && s.syncLabel === 'AT TIP' ? '#6ee7b7' : '#e2e8f0'}
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
