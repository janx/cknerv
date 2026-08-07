// ColonyNodes — the P2P "colony" rendered as ONE glow-node primitive across two
// honesty classes, separated only by a confidence gradient (never two visual
// languages):
//   • inferred ghosts   — ONE faint additive <points> cloud (~240): a "possible
//     network" haze. Each point is the SAME soft core+halo radial as the measured
//     halo, drawn small and dim. Non-selectable.
//   • measured nodes    — one bright, saturated, larger glow-halo per real peer:
//     a billboarded plane carrying that same core+halo shader,
//     gently breathing, with an invisible solid sphere hit-target so it stays
//     clickable (a camera-facing plane raycasts poorly). The honest "measured
//     core."
// The local "you" is NOT drawn here: the colony's local node is pinned onto the
// galaxy's labeled CkbNodeAnchor (App feeds inferredTopology its world pos), so
// that single cyan anchor is the one "you" and the measured belts converge on it.
//
// A new block stamps a radial brightness shockwave at the colony flood's entry
// node. It brightens these existing topology nodes while ColonyEdges carries the
// graph-accurate surge and ColonyCourierLayer supplies the moving glint. The Cell
// field keeps only delivery/commit feedback; the broad wave belongs here.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Billboard } from '@react-three/drei';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { phaseFor, rateFor } from './GlowNode';
import { CkbSelectionReticle } from './CellGalaxy';
import { PEER_COLORS, peerColorKind } from '../derives/peers.derive';
import type { NetworkNode, NetworkTopology } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import { consensusBlockColor } from '../derives/consensusFlow.derive';
import {
  makeShockwaveUniforms,
  SHOCKWAVE_SLOTS,
  writeShockwaveSlot,
  type ShockwaveUniforms,
} from '../materials/shockwaveMaterial';
import {
  makePeerCloudMaterial,
  makePeerHaloMaterial,
} from '../materials/peerNodeMaterial';

// Measured core: bright, saturated, larger than the ghost haze.
const MEASURED_SIZE = 1.4;
const MEASURED_BRIGHTNESS = 1.6;

// Measured node tint = the real peer palette: version-mismatch (violet) wins,
// else connection direction — single-sourced via peerColorKind (see the
// value-keyed memo in MeasuredNode).

/**
 * The inferred scaffold as a single additive point cloud. `position` is
 * allocated once (this component owns the geometry) and never mutated. Per-block
 * state stays in shared uniforms, so every in-flight wave crosses the same fixed
 * topology without rebuilding the point buffer.
 */
function InferredCloud({
  topology,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  topology: NetworkTopology;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
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

  const mat = useMemo(
    () => makePeerCloudMaterial(shockwaveUniforms),
    [shockwaveUniforms],
  );

  // Dispose the geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY — tearing it down on a geometry rebuild would dispose the
  // live, reused material and force a needless shader recompile on every re-clone.
  useEffect(() => () => mat.dispose(), [mat]);
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
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
  shockwaveUniforms,
}: {
  node: NetworkNode;
  localVersion: string;
  selected: boolean;
  onSelect: (id: string | null) => void;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
  // Key the tint on its VALUE inputs, not the node object: the topology memo
  // hands MeasuredNode a fresh `node` per latency poll, and a fresh Color here
  // would rebuild the ShaderMaterial (program-cache churn) every rebuild.
  const colorKind = peerColorKind(node.peer!, localVersion);
  const color = useMemo(
    () => new THREE.Color(...PEER_COLORS[colorKind]),
    [colorKind],
  );
  const haloMat = useMemo(() => {
    const m = makePeerHaloMaterial(color, shockwaveUniforms);
    // Per-node phase so the shader's secondary breathe isn't synced colony-wide
    // (defaults to 0 → a phantom colony-wide pulse). Matches GlowNode/CrystalGlow.
    m.uniforms.uPhase.value = phaseFor(node.id);
    return m;
  }, [color, node.id, shockwaveUniforms]);
  const phase = useMemo(() => phaseFor(node.id), [node.id]);
  const rate = useMemo(() => 0.7 + 0.6 * rateFor(node.id), [node.id]);

  useSimFrame(() => {
    const t = simClock.elapsedSec;
    haloMat.uniforms.uTime.value = t;
    haloMat.uniforms.uIntensity.value =
      MEASURED_BRIGHTNESS
      * (0.85 + 0.15 * Math.sin(t * rate + phase));
    haloMat.uniforms.uContextEnergy.value =
      selected ? 1 : contextEnergyRef?.current ?? 1;
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
 * "you" is drawn by the galaxy (its labeled CkbNodeAnchor), NOT here. This owner
 * stamps one shared ring-buffer slot per block so inferred and measured nodes
 * cannot drift or cancel an older in-flight wave.
 */
export default function ColonyNodes({
  topology,
  cf,
  blockPulseAtMs,
  backfillActive = false,
  selectedId,
  onSelect,
  localVersion,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  cf: ColonyFlood;
  blockPulseAtMs: number;
  backfillActive?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  localVersion: string;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const measured = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'measured'),
    [topology],
  );
  const shockwaveUniforms = useMemo(() => makeShockwaveUniforms(), []);
  const shockwaveSlotRef = useRef(0);
  const lastPulseRef = useRef(blockPulseAtMs);

  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs;
    // Consume while backfilling so a historical backlog cannot replay as one
    // network-wide strobe when live mode resumes.
    if (backfillActive) return;

    const origin = topology.nodes.find((node) => node.id === cf.entryId)
      ?? topology.nodes.find((node) => node.id === topology.localId);
    if (!origin) return;

    const slot = shockwaveSlotRef.current;
    shockwaveSlotRef.current = (slot + 1) % SHOCKWAVE_SLOTS;
    writeShockwaveSlot(
      shockwaveUniforms.uShockwaveAt.value,
      shockwaveUniforms.uShockwaveOriginXZ.value,
      shockwaveUniforms.uShockwaveColor.value,
      slot,
      simClock.elapsedSec,
      [origin.pos[0], origin.pos[2]],
      consensusBlockColor(blockPulseAtMs),
    );
    // cf/topology/backfillActive are recomputed in the same render that advances
    // blockPulseAtMs; use the pulse as the sole event edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // These values are shared by every peer material. Refreshing them here lets a
  // panel drag reshape waves already in flight instead of only the next block.
  useSimFrame(() => {
    shockwaveUniforms.uShockwaveColorBoost.value = LIVE.peer.colorBoost;
    shockwaveUniforms.uShockwaveAlphaBoost.value = LIVE.peer.alphaBoost;
    shockwaveUniforms.uShockwaveColorCeil.value = LIVE.peer.colorCeil;
    shockwaveUniforms.uShockwaveAlphaCeil.value = LIVE.peer.alphaCeil;
    shockwaveUniforms.uShockwaveSizeBoost.value = LIVE.peer.sizeBoost;
    shockwaveUniforms.uShockwaveTrailBoost.value = LIVE.peer.trailBoost;
  });

  // NB: no local "you" node is rendered here — the visible local node is the
  // galaxy's labeled CkbNodeAnchor (App pins the colony's local node onto it via
  // inferredTopology's localPos). The measured belts converge on that same point.

  return (
    <group>
      <InferredCloud
        topology={topology}
        contextEnergyRef={contextEnergyRef}
        shockwaveUniforms={shockwaveUniforms}
      />
      {measured.map((n) => (
        <MeasuredNode
          key={n.id}
          node={n}
          selected={selectedId === `peer:${n.peer!.node_id}`}
          onSelect={onSelect}
          localVersion={localVersion}
          contextEnergyRef={contextEnergyRef}
          shockwaveUniforms={shockwaveUniforms}
        />
      ))}
    </group>
  );
}
