// ColonyNodes — the P2P "colony" rendered as ONE glow-node primitive across two
// honesty classes, separated only by a confidence gradient (never two visual
// languages):
//   • inferred ghosts   — ONE faint additive <points> cloud (~240): a "possible
//     network" haze. Each point is the SAME soft core+halo radial as the measured
//     halo (makeHaloMaterial), drawn small and dim and STATIC. Non-selectable.
//   • measured nodes    — one bright, saturated, larger glow-halo per real peer:
//     a billboarded plane carrying that same core+halo shader (makeHaloMaterial),
//     gently breathing, with an invisible solid sphere hit-target so it stays
//     clickable (a camera-facing plane raycasts poorly). The honest "measured
//     core."
// The local "you" is NOT drawn here: the colony's local node is pinned onto the
// galaxy's labeled CkbNodeAnchor (App feeds inferredTopology its world pos), so
// that single cyan anchor is the one "you" and the measured belts converge on it.
//
// NO per-block flash lives here anymore. Earlier this layer wrote a spreading
// wavefront into a per-point `aFlashAt` buffer and flared the crystals on each
// block; that flood is now owned entirely by the courier / BlockDeliveryLayer.
// ColonyNodes is a pure confidence-gradient render: it takes topology + selection
// + local version and nothing block-timed.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Billboard } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { makeHaloMaterial, phaseFor, rateFor } from './GlowNode';
import { CkbSelectionReticle } from './CellGalaxy';
import { PEER_COLORS, peerColorKind } from '../derives/peers.derive';
import type { NetworkNode, NetworkTopology } from '../types';

// Ghost-cloud palette/scale. A faint blue "possible network" haze — the same
// core+halo radial as the measured halo, only dim and small.
const INFERRED_COLOR = '#8fb7ff';
const INFERRED_DIM = 0.9; // fixed base brightness — a clearly visible haze, not barely-there
const INFERRED_SIZE = 5.5; // point-size factor (perspective-scaled) — bigger so the dots read

// Measured core: bright, saturated, larger than the ghost haze.
const MEASURED_SIZE = 1.4;
const MEASURED_BRIGHTNESS = 1.6;

/** Measured node tint = the real peer palette: version-mismatch (violet) wins,
 *  else connection direction — single-sourced via peerColorKind. */
function measuredColor(node: NetworkNode, localVersion: string): THREE.Color {
  const [r, g, b] = PEER_COLORS[peerColorKind(node.peer!, localVersion)];
  return new THREE.Color(r, g, b);
}

/**
 * The inferred scaffold as a single additive point cloud. `position` is
 * allocated once (this component owns the geometry) and never mutated: the cloud
 * is a STATIC haze — no flash attribute, no per-block write. Each point renders
 * the same soft core+halo as `makeHaloMaterial`, faint and fixed.
 */
function InferredCloud({
  topology,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  contextEnergyRef?: { readonly current: number };
}) {
  const inferred = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'inferred'),
    [topology],
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
    return g;
  }, [inferred]);

  // Inferred glow-point material — the SAME core+halo look as makeHaloMaterial,
  // faint & static (no uTime, no flash). Memoized on [] (stable for the
  // component's life) so it survives topology re-clones without a shader recompile.
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: {
          uColor: { value: new THREE.Color(INFERRED_COLOR) },
          uDim: { value: INFERRED_DIM },
          uSize: { value: INFERRED_SIZE },
          uContextEnergy: { value: 1 },
        },
        vertexShader: /* glsl */ `
          uniform float uSize;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize * (300.0 / max(-mv.z, 0.001));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform vec3 uColor;
          uniform float uDim;
          uniform float uContextEnergy;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            if (r > 1.0) discard;
            float core = pow(1.0 - r, 2.0); // broader than the halo's pow-4 so a small point still reads
            float halo = pow(1.0 - r, 1.6) * 0.42;
            float a = (core + halo) * uDim * uContextEnergy;
            gl_FragColor = vec4(uColor * a, a);
          }
        `,
      }),
    [],
  );

  // Dispose the geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the
  // live, reused material and force a needless shader recompile on every re-clone.
  useEffect(() => () => mat.dispose(), [mat]);
  useSimFrame(() => {
    mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
  });

  // Non-selectable: an explicit no-op raycast so the ghost cloud can NEVER be
  // picked. r3f's pointer events already skip it (no handlers), but — unlike a
  // plain Object3D — THREE.Points ships a real default raycast, so guard it
  // defensively. Only the measured nodes carry onClick → onSelect('peer:…').
  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />;
}

/**
 * One measured peer as a glow-node: the same core+halo shader (makeHaloMaterial)
 * on a camera-facing plane — bright, saturated, larger than the ghost haze, and
 * gently modulating (per-node phase/rate so the colony reads distributed, not synced).
 * A small invisible solid sphere sits underneath as the hit-target so the halo is
 * clickable (a billboarded plane raycasts poorly). Selection draws the reticle.
 */
function MeasuredNode({
  node,
  localVersion,
  selected,
  onSelect,
  contextEnergyRef,
}: {
  node: NetworkNode;
  localVersion: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const color = useMemo(() => measuredColor(node, localVersion), [node, localVersion]);
  const haloMat = useMemo(() => {
    // makeHaloMaterial only reads palette.halo for the tint, but Palette requires
    // all three fields — set them all to the node's hex.
    const hex = `#${color.getHexString()}`;
    const m = makeHaloMaterial({ edge: hex, halo: hex, fill: hex });
    // Per-node phase so the shader's secondary breathe isn't synced colony-wide
    // (defaults to 0 → a phantom colony-wide pulse). Matches GlowNode/CrystalGlow.
    m.uniforms.uPhase.value = phaseFor(node.id);
    return m;
  }, [color, node.id]);
  const phase = useMemo(() => phaseFor(node.id), [node.id]);
  const rate = useMemo(() => 0.7 + 0.6 * rateFor(node.id), [node.id]);

  useSimFrame(() => {
    const t = simClock.elapsedSec;
    haloMat.uniforms.uTime.value = t;
    haloMat.uniforms.uIntensity.value =
      MEASURED_BRIGHTNESS
      * (0.85 + 0.15 * Math.sin(t * rate + phase))
      * (selected ? 1 : contextEnergyRef?.current ?? 1);
  });

  useEffect(() => () => haloMat.dispose(), [haloMat]);

  return (
    <group position={node.pos}>
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh material={haloMat}>
          <planeGeometry args={[MEASURED_SIZE * 6, MEASURED_SIZE * 6]} />
        </mesh>
      </Billboard>
      {/* Small invisible solid hit-target so the halo is clickable (a plane
          raycasts poorly). */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(`peer:${node.peer!.node_id}`);
        }}
      >
        <sphereGeometry args={[MEASURED_SIZE, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected ? <CkbSelectionReticle size={MEASURED_SIZE * 2.4} /> : null}
    </group>
  );
}

/**
 * Composes the colony: the inferred ghost cloud + one measured glow-node per real
 * peer, unified as a single glow primitive on a confidence gradient. The local
 * "you" is drawn by the galaxy (its labeled CkbNodeAnchor), NOT here. No block
 * timing flows through here — the flood is the courier layer's job now.
 */
export default function ColonyNodes({
  topology,
  selectedId,
  onSelect,
  localVersion,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  localVersion: string;
  contextEnergyRef?: { readonly current: number };
}) {
  const measured = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'measured'),
    [topology],
  );

  // NB: no local "you" node is rendered here — the visible local node is the
  // galaxy's labeled CkbNodeAnchor (App pins the colony's local node onto it via
  // inferredTopology's localPos). The measured belts converge on that same point.

  return (
    <group>
      <InferredCloud
        topology={topology}
        contextEnergyRef={contextEnergyRef}
      />
      {measured.map((n) => (
        <MeasuredNode
          key={n.id}
          node={n}
          selected={selectedId === `peer:${n.peer!.node_id}`}
          onSelect={onSelect}
          localVersion={localVersion}
          contextEnergyRef={contextEnergyRef}
        />
      ))}
    </group>
  );
}
