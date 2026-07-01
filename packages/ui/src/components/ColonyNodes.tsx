// ColonyNodes — the P2P "colony" rendered in three honesty classes:
//   • inferred ghosts   — ONE faint additive <points> cloud (~240): a "possible
//     network" haze. Inert until M3's flood drives per-point flashes through
//     `flashRef` (absolute simClock seconds; sentinel -1e9 ⇒ "never").
//   • measured crystals — one clickable CrystalGlow per real peer, bright and
//     saturated: the honest "measured core."
//   • local marker      — one larger, distinctly-tinted CrystalGlow = "you."
//
// Scene-clock discipline: the ghost shader's `uTime` is driven by
// simClock.elapsedSec inside useSimFrame (NOT performance.now), so it shares the
// exact time base M3 writes `aFlashAt` against. Same pattern as CrystalGlow.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { phaseFor } from './GlowNode';
import { PEER_COLORS } from '../derives/peers.derive';
import { FLASH_ENV_GLSL } from '../materials/cellEnvelope.glsl';
import CrystalGlow from './CrystalGlow';
import type { NetworkNode, NetworkTopology } from '../types';

// Unit octahedron shared by every measured + local crystal (caller-owned; NOT
// disposed by CrystalGlow). A deliberately-separate copy from PeerConstellation's
// module-private geometry — that component is retired in Task 8, so we don't
// reach into it.
const PEER_GEOM = new THREE.OctahedronGeometry(1, 0);

// Ghost-cloud palette/scale. Faint blue haze; the flash boost is inert here.
const INFERRED_COLOR = new THREE.Color('#8fb7ff');
const INFERRED_DIM = 0.18; // base brightness — "possible network," barely there
const INFERRED_PEAK = 2.6; // flood-flash ceiling (driven in M3)
const INFERRED_SIZE = 2.2; // point-size factor (perspective-scaled)

// Measured core: bright, near the top of the peer crystal range (0.55..1.65).
const MEASURED_SIZE = 1.4;
const MEASURED_BRIGHTNESS = 1.0;

// Local "you": larger than any peer and a warm gold that reads clear of the cool
// inferred/measured palette (cyan / teal / violet). Non-selectable.
const LOCAL_MARKER_COLOR = new THREE.Color('#ffd27f');
const LOCAL_SIZE = 2.5;

/** Measured node tint = the real peer palette, keyed by connection direction. */
function measuredColor(node: NetworkNode): THREE.Color {
  const [r, g, b] = PEER_COLORS[node.peer!.direction];
  return new THREE.Color(r, g, b);
}

/**
 * The inferred scaffold as a single additive point cloud. `position` +
 * `aFlashAt` are allocated once; the flash buffer is handed out via `flashRef`
 * so M3's flood layer can ignite points in place without touching React. The
 * ghost shader boosts brightness by `flashEnv(uTime - aFlashAt)` — currently
 * always 0 (every `aFlashAt` sits at the -1e9 sentinel).
 */
function InferredCloud({
  topology,
  flashRef,
}: {
  topology: NetworkTopology;
  flashRef: React.MutableRefObject<Float32Array>;
}) {
  const inferred = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'inferred'),
    [topology],
  );

  // Per-point flash peak time, ABSOLUTE simClock seconds; -1e9 ⇒ "never." Held
  // in its own stable memo (not written from render) so it survives StrictMode's
  // double-invoked factories and stays the exact array bound to `aFlashAt`.
  const flash = useMemo(
    () => new Float32Array(inferred.length).fill(-1e9),
    [inferred],
  );

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(inferred.length * 3);
    inferred.forEach((n, i) => {
      pos[i * 3] = n.pos[0];
      pos[i * 3 + 1] = n.pos[1];
      pos[i * 3 + 2] = n.pos[2];
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFlashAt', new THREE.BufferAttribute(flash, 1));
    return g;
  }, [inferred, flash]);

  // Hand the live flash buffer to the flood layer (M3) after commit, so
  // `flashRef.current` is always the array actually bound to the geometry.
  useEffect(() => {
    flashRef.current = flash;
  }, [flash, flashRef]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: INFERRED_COLOR },
          uPeak: { value: INFERRED_PEAK },
          uDim: { value: INFERRED_DIM },
          uSize: { value: INFERRED_SIZE },
        },
        vertexShader: /* glsl */ `
          attribute float aFlashAt;
          uniform float uTime, uSize;
          varying float vAge;
          void main() {
            vAge = uTime - aFlashAt;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize * (300.0 / max(-mv.z, 0.001));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;

          uniform vec3 uColor;
          uniform float uPeak, uDim;
          varying float vAge;

          ${FLASH_ENV_GLSL}

          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float e = flashEnv(vAge);
            float b = uDim + (uPeak - uDim) * e;
            gl_FragColor = vec4(uColor * b, (1.0 - d * 2.0) * (uDim + 0.5 * e));
          }
        `,
      }),
    [],
  );

  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
    },
    [geom, mat],
  );

  // Drive the shader clock off the sim clock (see file header).
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
  });

  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

/**
 * One measured peer crystal. A per-node component (not an inline map) so it can
 * own an `intensityRef` the child reads every frame — a gentle seeded breathe
 * keeps the measured core visibly alive against the inert ghost haze, animated
 * on the scene clock without a React re-render.
 */
function MeasuredCrystal({
  node,
  selectedId,
  onSelect,
}: {
  node: NetworkNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const peerId = node.peer!.node_id;
  const color = useMemo(() => measuredColor(node), [node]);
  const phase = useMemo(() => phaseFor(peerId), [peerId]);
  const intensityRef = useRef(MEASURED_BRIGHTNESS);

  useSimFrame(() => {
    intensityRef.current =
      MEASURED_BRIGHTNESS * (0.9 + 0.1 * Math.sin(simClock.elapsedSec * 0.8 + phase));
  });

  return (
    <group position={node.pos}>
      <CrystalGlow
        geom={PEER_GEOM}
        size={MEASURED_SIZE}
        color={color}
        intensityRef={intensityRef}
        seed={peerId}
        selected={selectedId === `peer:${peerId}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(`peer:${peerId}`);
        }}
      />
    </group>
  );
}

/**
 * Composes the colony: the inferred ghost cloud + one CrystalGlow per measured
 * peer + the single local "you" marker. Does not wire into the app (Task 8).
 */
export default function ColonyNodes({
  topology,
  flashRef,
  selectedId,
  onSelect,
}: {
  topology: NetworkTopology;
  flashRef: React.MutableRefObject<Float32Array>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const measured = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'measured'),
    [topology],
  );
  const local = useMemo(
    () => topology.nodes.find((n) => n.kind === 'local'),
    [topology],
  );

  return (
    <group>
      <InferredCloud topology={topology} flashRef={flashRef} />
      {measured.map((n) => (
        <MeasuredCrystal
          key={n.id}
          node={n}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
      {local ? (
        // Bespoke "you" marker: distinct color, larger, non-selectable.
        <group position={local.pos}>
          <CrystalGlow
            geom={PEER_GEOM}
            size={LOCAL_SIZE}
            color={LOCAL_MARKER_COLOR}
            seed={local.id}
          />
        </group>
      ) : null}
    </group>
  );
}
