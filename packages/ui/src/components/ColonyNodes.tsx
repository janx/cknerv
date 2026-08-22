// ColonyNodes — the P2P "colony" rendered as ONE glow-node primitive across
// three honesty classes, separated only by a confidence gradient (never three
// visual languages):
//   • inferred ghosts   — ONE faint additive <points> cloud (~240 minus the
//     sighted count): a "possible network" haze. Each point is the SAME soft
//     core+halo radial as the measured halo, drawn small and — this is the
//     part that has to hold — under the additive clip, so it stays haze
//     instead of a white speck the eye reads as a node. Non-selectable.
//   • sighted nodes     — TWO more <points> draws off the same factory (the
//     crawler reached it / only remembers it), a stop brighter than the ghosts
//     and a stop below the measured core, and ~3x their diameter: the tiers
//     have to separate in FOOTPRINT, because brightness clips and the inferred
//     edges pile light onto every junction they cross. Real identity, invented
//     position, no link of ours — so they are clickable through ONE instanced
//     invisible hit mesh sized from those same marks, and every edge they
//     carry stays inferred fiction.
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
import { useThree } from '@react-three/fiber';
import {
  cellCanvasCursor,
  NETWORK_PEER_PICK_FLAG,
} from '../derives/cellInteraction.derive';
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
  peerCloudHitRadius,
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
  type PeerCloudTone,
} from '../materials/peerNodeMaterial';

// Measured core: bright, saturated, larger than the ghost haze.
const MEASURED_SIZE = 1.4;

/** Selection id prefix for a sighted node — the colony's third dialect beside
 *  `peer:` (measured) and the bare chain-node id. */
const SIGHTED_SELECTION_PREFIX = 'sighted:';
/** A sighted node's invisible hit sphere IS its mark: both stops hand their own
 *  world diameter to `peerCloudHitRadius`, so the reachable stop's larger glow
 *  carries the larger target and a retune of one moves the other with it. The
 *  target is the footprint, never a generous pick disc — the Cell canopy yields
 *  this pixel through NETWORK_PEER_PICK_FLAG, so it is taken from that layer. */
const SIGHTED_HIT_RADIUS = peerCloudHitRadius(PEER_CLOUD_SIGHTED_TONE);
const SIGHTED_DARK_HIT_RADIUS = peerCloudHitRadius(PEER_CLOUD_SIGHTED_DARK_TONE);

function sightedHitRadius(node: NetworkNode): number {
  return node.sighted?.reachable === false
    ? SIGHTED_DARK_HIT_RADIUS
    : SIGHTED_HIT_RADIUS;
}

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
  const gl = useThree((state) => state.gl);
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
    // The sprite is sized in world units, so it needs the live drawing buffer:
    // a window resize or a quality-tier DPR change moves it under the material.
    mat.uniforms.uViewportHeight.value = gl.domElement.height;
  });

  // Non-selectable: an explicit no-op raycast so the ghost cloud can NEVER be
  // picked. r3f's pointer events already skip it (no handlers), but — unlike a
  // plain Object3D — THREE.Points ships a real default raycast, so guard it
  // defensively. Only the measured nodes carry onClick → onSelect('peer:…').
  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />;
}

/**
 * One tone's worth of sighted nodes as a single additive point cloud — the
 * ghost cloud's pattern, cloned: `position` only, one shared material, the same
 * wave uniforms and the same context-energy damping. The tone (brightness,
 * size) is a creation-time uniform rather than a per-point attribute, because
 * the vertex-attribute budget sits at a cliff and a second Points draw is
 * cheaper than a slot.
 *
 * Its raycast is a no-op too: the pixel belongs to the instanced hit mesh below,
 * so the visible sprite never competes with it.
 */
function SightedCloud({
  nodes,
  tone,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  nodes: NetworkNode[];
  tone: PeerCloudTone;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const simClock = useSimClock();
  const gl = useThree((state) => state.gl);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nodes.length * 3);
    nodes.forEach((n, i) => {
      pos[i * 3] = n.pos[0];
      pos[i * 3 + 1] = n.pos[1];
      pos[i * 3 + 2] = n.pos[2];
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [nodes]);

  const mat = useMemo(
    () => makePeerCloudMaterial(shockwaveUniforms, tone),
    [shockwaveUniforms, tone],
  );

  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
    mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
    mat.uniforms.uViewportHeight.value = gl.domElement.height;
  });

  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />;
}

/**
 * The sighted tier: two point clouds (reached / only remembered) plus ONE
 * instanced invisible hit mesh covering every sighted node, and the reticle for
 * the selected one.
 *
 * Hundreds of one-mesh-per-node targets would be the wrong shape for the
 * raycaster, so a single InstancedMesh answers once and hands back
 * `e.instanceId`. The invisible MATERIAL keeps that raycast alive while the
 * renderer skips the draw (the MeasuredNode/anchor trick), and the mesh carries
 * NETWORK_PEER_PICK_FLAG so the Cell picker yields the pixel — the existing
 * arbitration path, not a new one.
 */
function SightedNodes({
  sighted,
  selectedId,
  onSelect,
  contextEnergyRef,
  shockwaveUniforms,
}: {
  sighted: NetworkNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  contextEnergyRef?: { readonly current: number };
  shockwaveUniforms: ShockwaveUniforms;
}) {
  const gl = useThree((state) => state.gl);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);
  // A crawler that could not reach a node this round still knows it exists;
  // that is real, dimmer information, and it costs one extra draw, not a slot.
  const reached = useMemo(
    () => sighted.filter((n) => n.sighted?.reachable !== false),
    [sighted],
  );
  const remembered = useMemo(
    () => sighted.filter((n) => n.sighted?.reachable === false),
    [sighted],
  );
  const selected = useMemo(() => {
    if (selectedId === null || !selectedId.startsWith(SIGHTED_SELECTION_PREFIX)) return null;
    const id = selectedId.slice(SIGHTED_SELECTION_PREFIX.length);
    return sighted.find((n) => n.id === id) ?? null;
  }, [selectedId, sighted]);

  // A UNIT sphere: each instance is scaled to its own stop's mark below.
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 8, 8), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  // Per-instance placement, written once per topology (never per frame).
  const capacity = Math.max(1, sighted.length);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = sighted.length;
    sighted.forEach((node, index) => {
      const radius = sightedHitRadius(node);
      SCRATCH_MATRIX.makeScale(radius, radius, radius);
      SCRATCH_MATRIX.setPosition(node.pos[0], node.pos[1], node.pos[2]);
      mesh.setMatrixAt(index, SCRATCH_MATRIX);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // An instanced raycast rejects on the bounding sphere first, and the one
    // three computed for the previous matrices would answer for the wrong
    // volume — recompute it or the whole tier silently stops being clickable.
    mesh.computeBoundingSphere();
  }, [sighted, capacity]);

  const syncCursor = () => {
    const canvas = gl.domElement;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      canvas.dataset.peerNodeHover !== undefined,
    );
  };

  // Which ids this layer is allowed to clear: the hover word is shared with the
  // measured peers and the chain anchor, so we only ever retract our own.
  const ownedRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const canvas = gl.domElement;
    const previous = ownedRef.current;
    ownedRef.current = new Set(sighted.map((n) => n.id));
    // A roster round can retire a node while the pointer is still on it, and no
    // pointer-out ever fires for a node that stopped existing.
    const hovered = canvas.dataset.peerNodeHover;
    if (hovered === undefined || ownedRef.current.has(hovered) || !previous.has(hovered)) return;
    delete canvas.dataset.peerNodeHover;
    syncCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, sighted]);
  // …and the same guard for the layer's own unmount (gl is stable for the
  // canvas's life, so this cleanup runs on unmount only).
  useEffect(() => () => {
    const canvas = gl.domElement;
    const hovered = canvas.dataset.peerNodeHover;
    if (hovered === undefined || !ownedRef.current.has(hovered)) return;
    delete canvas.dataset.peerNodeHover;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      false,
    );
  }, [gl]);

  const idAt = (instanceId: number | undefined): string | undefined => (
    instanceId === undefined ? undefined : sighted[instanceId]?.id
  );

  return (
    <group>
      {/* A tone with nobody in it is not drawn at all: an all-reachable roster
          costs one cloud, not two empty ones. */}
      {reached.length > 0 ? (
        <SightedCloud
          nodes={reached}
          tone={PEER_CLOUD_SIGHTED_TONE}
          contextEnergyRef={contextEnergyRef}
          shockwaveUniforms={shockwaveUniforms}
        />
      ) : null}
      {remembered.length > 0 ? (
        <SightedCloud
          nodes={remembered}
          tone={PEER_CLOUD_SIGHTED_DARK_TONE}
          contextEnergyRef={contextEnergyRef}
          shockwaveUniforms={shockwaveUniforms}
        />
      ) : null}
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, capacity]}
        frustumCulled={false}
        userData={hitUserData}
        onClick={(e) => {
          const id = idAt(e.instanceId);
          if (id === undefined) return;
          e.stopPropagation();
          onSelect(`${SIGHTED_SELECTION_PREFIX}${id}`);
        }}
        onPointerOver={(e) => {
          const id = idAt(e.instanceId);
          if (id === undefined) return;
          gl.domElement.dataset.peerNodeHover = id;
          syncCursor();
        }}
        onPointerOut={(e) => {
          // r3f v8 cancels the stale instance BEFORE it enters the new one, so
          // by the time a word belongs to somebody else it is somebody else's
          // hand — retracting it here would strand the cursor on a live target.
          const id = idAt(e.instanceId);
          if (id !== undefined && gl.domElement.dataset.peerNodeHover === id) {
            delete gl.domElement.dataset.peerNodeHover;
          }
          syncCursor();
        }}
      />
      {selected ? (
        <group position={selected.pos}>
          <CkbSelectionReticle size={sightedHitRadius(selected) * 2.4} />
        </group>
      ) : null}
    </group>
  );
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
 *
 * The hit mesh carries NETWORK_PEER_PICK_FLAG so the Cell picker can yield
 * the pixel (a nearer Cell would otherwise win every distance sort), and it
 * advertises itself through the shared canvas-cursor arbitration — the same
 * dataset-flag contract the Cell picker and causal lens already follow.
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
  const gl = useThree((state) => state.gl);
  const peerId = node.peer!.node_id;
  const hitUserData = useMemo(() => ({ [NETWORK_PEER_PICK_FLAG]: true }), []);

  const syncCursor = () => {
    const canvas = gl.domElement;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      canvas.dataset.peerNodeHover !== undefined,
    );
  };

  // Churn can unmount a hovered peer without a pointer-out; never leave the
  // canvas advertising a hand for a node that no longer exists.
  useEffect(() => () => {
    const canvas = gl.domElement;
    if (canvas.dataset.peerNodeHover !== peerId) return;
    delete canvas.dataset.peerNodeHover;
    canvas.style.cursor = cellCanvasCursor(
      canvas.dataset.cellPickerHover !== undefined,
      canvas.dataset.cellCausalNavigationHover !== undefined,
      false,
    );
  }, [gl, peerId]);

  return (
    <group position={node.pos}>
      {/* An invisible MATERIAL keeps the raycast (the Raycaster never
          consults material.visible) while the renderer skips the draw. */}
      <mesh
        userData={hitUserData}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(`peer:${peerId}`);
        }}
        onPointerOver={() => {
          gl.domElement.dataset.peerNodeHover = peerId;
          syncCursor();
        }}
        onPointerOut={() => {
          if (gl.domElement.dataset.peerNodeHover === peerId) {
            delete gl.domElement.dataset.peerNodeHover;
          }
          syncCursor();
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
 * Composes the colony: the inferred ghost cloud + the sighted tier + one
 * measured glow-node per real peer, unified as a single glow primitive on a
 * confidence gradient. The local
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
  const sighted = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'sighted'),
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
      {/* No crawler, or a crawler that knows nobody: the tier costs the scene
          nothing at all — not an empty draw, not an idle hit mesh. */}
      {sighted.length > 0 ? (
        <SightedNodes
          sighted={sighted}
          selectedId={selectedId}
          onSelect={onSelect}
          contextEnergyRef={contextEnergyRef}
          shockwaveUniforms={shockwaveUniforms}
        />
      ) : null}
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
