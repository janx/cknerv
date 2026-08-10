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
  makeMeasuredPeerHalosMaterial,
  makePeerCloudMaterial,
} from '../materials/peerNodeMaterial';

// Measured core: bright, saturated, larger than the ghost haze.
const MEASURED_SIZE = 1.4;

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
 * EVERY measured peer's glow-halo in one instanced draw. Replaces the
 * per-peer drei Billboard + single-quad mesh (two frame subscribers and a
 * fresh Euler per peer per frame): the shader rebuilds the camera-facing
 * quad from the view matrix and evaluates the per-node breathe from
 * instanced rate/phase against one shared clock. Per-peer identity (tint,
 * phase, rate, selection) rides instanced attributes rewritten only when
 * the measured set or the selection changes.
 */
function MeasuredPeerHalos({
  measured,
  localVersion,
  selectedId,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  measured: NetworkNode[];
  localVersion: string;
  selectedId: string | null;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () => makeMeasuredPeerHalosMaterial(shockwaveUniforms),
    [shockwaveUniforms],
  );
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(MEASURED_SIZE * 6, MEASURED_SIZE * 6);
    return plane;
  }, []);
  const capacity = Math.max(1, measured.length);

  // Static per-peer identity: rebuilt only when the measured set (or a
  // version tint input) changes — the topology memo is churn-stable.
  const identity = useMemo(() => {
    const color = new Float32Array(capacity * 3);
    const phase = new Float32Array(capacity);
    const rate = new Float32Array(capacity);
    measured.forEach((node, index) => {
      const [r, g, b] = PEER_COLORS[peerColorKind(node.peer!, localVersion)];
      color[index * 3] = r;
      color[index * 3 + 1] = g;
      color[index * 3 + 2] = b;
      phase[index] = phaseFor(node.id);
      rate[index] = 0.7 + 0.6 * rateFor(node.id);
    });
    return { color, phase, rate };
  }, [capacity, measured, localVersion]);
  const selectedArray = useMemo(
    () => new Float32Array(capacity),
    [capacity],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = measured.length;
    measured.forEach((node, index) => {
      SCRATCH_MATRIX.makeTranslation(node.pos[0], node.pos[1], node.pos[2]);
      mesh.setMatrixAt(index, SCRATCH_MATRIX);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute(
      'aPeerColor',
      new THREE.InstancedBufferAttribute(identity.color, 3),
    );
    mesh.geometry.setAttribute(
      'aPeerPhase',
      new THREE.InstancedBufferAttribute(identity.phase, 1),
    );
    mesh.geometry.setAttribute(
      'aPeerRate',
      new THREE.InstancedBufferAttribute(identity.rate, 1),
    );
  }, [identity, measured]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    measured.forEach((node, index) => {
      selectedArray[index] =
        selectedId === `peer:${node.peer!.node_id}` ? 1 : 0;
    });
    const attribute = new THREE.InstancedBufferAttribute(selectedArray, 1);
    mesh.geometry.setAttribute('aPeerSelected', attribute);
    attribute.needsUpdate = true;
  }, [measured, selectedArray, selectedId]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  // The single frame subscriber the whole measured belt now costs.
  useSimFrame(() => {
    material.uniforms.uTime.value = simClock.elapsedSec;
    material.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
    />
  );
}

const SCRATCH_MATRIX = new THREE.Matrix4();

/**
 * One measured peer's INTERACTION surface: the invisible solid hit-target
 * (a camera-facing plane raycasts poorly) and the selection reticle. The
 * visible halo itself is drawn by MeasuredPeerHalos in one instanced pass.
 */
function MeasuredNode({
  node,
  selected,
  onSelect,
}: {
  node: NetworkNode;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  return (
    <group position={node.pos}>
      {/* An invisible MATERIAL keeps the raycast (the Raycaster never
          consults material.visible) while the renderer skips the draw. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(`peer:${node.peer!.node_id}`);
        }}
      >
        <sphereGeometry args={[MEASURED_SIZE, 8, 8]} />
        <meshBasicMaterial visible={false} />
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
      <MeasuredPeerHalos
        measured={measured}
        localVersion={localVersion}
        selectedId={selectedId}
        contextEnergyRef={contextEnergyRef}
        shockwaveUniforms={shockwaveUniforms}
      />
      {measured.map((n) => (
        <MeasuredNode
          key={n.id}
          node={n}
          selected={selectedId === `peer:${n.peer!.node_id}`}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
