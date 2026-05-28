// Detail panel for a selected chain node (the CKB icosahedron).
//
// Chain-node detail is RCG-specific in ckb-rcg (`RcgNodeDetailHud`, which
// knows about RCG agents), so @cknerv/ui ships no node-detail primitive.
// This is a minimal cknerv-local equivalent: it shows the observed node
// plus chain context. Mirrors CkbNetworkHud's visual language so the two
// panels read as one family. Closed by clicking empty space (the Canvas
// `onPointerMissed` clears the selection).

import { Text } from '@react-three/drei';

import type { ChainEntry, ChainNode } from '@cknerv/types';
import { FONT_DISPLAY, FONT_MONO } from '@cknerv/ui';

export interface ChainNodeDetailHudProps {
  node: ChainNode;
  /** Chain entity — supplies the chain-level context rows (name/tip/epoch). */
  chain: ChainEntry;
  /** Top-left corner of the panel in pixel coordinates (camera-local). */
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

function midTruncate(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export default function ChainNodeDetailHud({
  node,
  chain,
  x,
  y,
  width,
}: ChainNodeDetailHudProps) {
  const epochLabel =
    chain.epoch.length > 0
      ? `${chain.epoch.number}.${chain.epoch.index}/${chain.epoch.length}`
      : '—';

  const fields: Array<{ label: string; value: string }> = [
    { label: 'LABEL', value: node.label },
    { label: 'ID', value: midTruncate(node.id, 10, 8) },
    // cknerv issues read-only RPCs; a node it observes is an OBSERVER
    // unless the adapter flags it as the canonical miner.
    { label: 'ROLE', value: node.is_miner ? 'MINER' : 'OBSERVER' },
    { label: 'CHAIN', value: chain.chain_name },
    { label: 'TIP', value: `#${chain.tip}` },
    { label: 'EPOCH', value: epochLabel },
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
        ⟦ NODE ⟧
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
