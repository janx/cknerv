// ColonyNodes — the P2P "colony" rendered in three honesty classes:
//   • inferred ghosts   — ONE faint additive <points> cloud (~240): a "possible
//     network" haze. Each block ignites a spreading wavefront: per-point flashes
//     are written into `aFlashAt` (absolute simClock seconds; sentinel -1e9 ⇒
//     "never") on the pulse, and the ghost shader boosts brightness by
//     `flashEnv(uTime - aFlashAt)`.
//   • measured crystals — one clickable CrystalGlow per real peer, bright and
//     saturated: the honest "measured core." Flares as the front reaches it.
//   • local marker      — one larger, distinctly-tinted CrystalGlow = "you."
//     Flares as the front reaches it.
//
// Scene-clock discipline: the ghost shader's `uTime` is driven by
// simClock.elapsedSec inside useSimFrame (NOT performance.now), so it shares the
// exact time base the flood writes `aFlashAt` against. Same pattern as CrystalGlow.
//
// Component-owned flood write (NOT external refs): each buffer owner captures its
// OWN flood t0 in ITS OWN pulse effect and sets its geometry's needsUpdate. t0 is
// simClock.elapsedSec, which is mutated ONLY in the r3f loop (never during React's
// effect flush) — so InferredCloud's, the crystals', and ColonyEdges' captures in
// the same pulse's effect flush are identical (perfectly synced), while capturing
// LOCALLY avoids the child-before-parent trap of reading a parent-set ref in a
// child effect.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { phaseFor } from './GlowNode';
import { PEER_COLORS, peerColorKind } from '../derives/peers.derive';
import { FLASH_ENV_GLSL } from '../materials/cellEnvelope.glsl';
import CrystalGlow from './CrystalGlow';
import type { NetworkNode, NetworkTopology } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';

// Unit octahedron shared by every measured + local crystal (caller-owned; NOT
// disposed by CrystalGlow). A deliberately-separate copy from the retired
// hub-and-spoke layer's module-private geometry, so we don't reach into it.
const PEER_GEOM = new THREE.OctahedronGeometry(1, 0);

// Ghost-cloud palette/scale. Faint blue haze; the flood flash boosts it.
const INFERRED_COLOR = new THREE.Color('#8fb7ff');
const INFERRED_DIM = 0.18; // base brightness — "possible network," barely there
const INFERRED_PEAK = 2.6; // flood-flash ceiling
const INFERRED_SIZE = 2.2; // point-size factor (perspective-scaled)

// Measured core: bright, near the top of the peer crystal range (0.55..1.65).
const MEASURED_SIZE = 1.4;
const MEASURED_BRIGHTNESS = 1.0;

// Local "you": larger than any peer and a warm gold that reads clear of the cool
// inferred/measured palette (cyan / teal / violet). Non-selectable.
const LOCAL_MARKER_COLOR = new THREE.Color('#ffd27f');
const LOCAL_SIZE = 2.5;

// Crystal arrival flare: a short additive brightness spike layered ON TOP of a
// crystal's breathe when the wavefront reaches it. 0 before arrival; decays over
// ~FLARE_DUR_S. Tune K live against the real (brighter) backend flood.
const FLARE_K = 1.5;      // peak boost at arrival
const FLARE_DUR_S = 0.6;  // flare lifetime
function arrivalFlare(nowSec: number, floodT0: number, arrivalS: number): number {
  const age = nowSec - (floodT0 + arrivalS);
  return age >= 0 && age < FLARE_DUR_S ? FLARE_K * Math.exp(-age * 6) : 0;
}

/** Measured node tint = the real peer palette: version-mismatch (violet) wins,
 *  else connection direction — single-sourced via peerColorKind. */
function measuredColor(node: NetworkNode, localVersion: string): THREE.Color {
  const [r, g, b] = PEER_COLORS[peerColorKind(node.peer!, localVersion)];
  return new THREE.Color(r, g, b);
}

/**
 * The inferred scaffold as a single additive point cloud. `position` +
 * `aFlashAt` are allocated once; the flash buffer is written IN PLACE on each
 * block (this component owns the geometry, so it captures the flood t0 and sets
 * needsUpdate itself). The ghost shader boosts brightness by
 * `flashEnv(uTime - aFlashAt)` — a spreading wavefront across the cloud.
 */
function InferredCloud({
  topology,
  cf,
  blockPulseAtMs,
  backfillActive,
}: {
  topology: NetworkTopology;
  cf: ColonyFlood;
  blockPulseAtMs: number;
  backfillActive: boolean;
}) {
  const inferred = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'inferred'),
    [topology],
  );

  // Per-point flash peak time, ABSOLUTE simClock seconds; -1e9 ⇒ "never." Held
  // in its own stable memo (not written from render) so it survives StrictMode's
  // double-invoked factories and stays the exact array bound to `aFlashAt`. Slot
  // i ↔ inferred[i].id (the SAME memoized array that builds the geometry below).
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

  // Ignite the wavefront on each NEW block: write each inferred point's absolute
  // flash time (t0 + its graph-flood arrival) and flag the attribute dirty. t0 is
  // captured HERE (the buffer owner's own effect), never read from a parent ref,
  // so it can't go stale before a parent effect runs (child effects flush first).
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    // Consume even while backfilling (advance the guard so the backlog can't
    // replay when `backfill` clears), then bail WITHOUT writing the flash buffer
    // → the ghost cloud stays quiescent during catch-up (no wavefront strobe).
    lastPulseRef.current = blockPulseAtMs;
    if (backfillActive) return;
    const t0 = simClock.elapsedSec;
    for (let i = 0; i < inferred.length; i++) {
      flash[i] = t0 + (cf.colonyArrivalS[inferred[i].id] ?? 0);
    }
    geom.getAttribute('aFlashAt').needsUpdate = true;
    // cf + backfillActive + inferred/flash/geom are read from the render that
    // bumped blockPulseAtMs (App recomputes cf + backfill + bumps the pulse
    // together), so [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

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

  // Dispose the geometry whenever it is rebuilt (and on unmount).
  useEffect(() => () => geom.dispose(), [geom]);
  // The material is memoized on [] (stable for the component's life), so dispose
  // it on UNMOUNT ONLY. Tearing it down on a geometry rebuild would dispose the
  // live, reused material and force a needless shader recompile every time the
  // topology re-clones (e.g. on each peer poll).
  useEffect(() => () => mat.dispose(), [mat]);

  // Drive the shader clock off the sim clock (see file header).
  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
  });

  // Non-selectable: an explicit no-op raycast so the ghost cloud can NEVER be
  // picked. r3f's pointer events already skip it (it has no event handlers, so
  // it's not in the interaction set), but — unlike a plain Object3D — THREE.Points
  // ships a real default raycast, so guard it defensively. Only the measured/local
  // CrystalGlows carry onClick → onSelect('peer:…'); the inferred haze stays inert.
  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />;
}

/**
 * One measured peer crystal. A per-node component (not an inline map) so it can
 * own an `intensityRef` the child reads every frame — a gentle seeded breathe
 * keeps the measured core visibly alive against the inert ghost haze, plus a
 * flood flare when the wavefront reaches it, animated on the scene clock without
 * a React re-render. `floodT0Ref` is captured by ColonyNodes and read here in
 * useSimFrame (after the effect flush → no staleness).
 */
function MeasuredCrystal({
  node,
  cf,
  floodT0Ref,
  selectedId,
  onSelect,
  localVersion,
}: {
  node: NetworkNode;
  cf: ColonyFlood;
  floodT0Ref: React.MutableRefObject<number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  localVersion: string;
}) {
  const peerId = node.peer!.node_id;
  const color = useMemo(() => measuredColor(node, localVersion), [node, localVersion]);
  const phase = useMemo(() => phaseFor(peerId), [peerId]);
  const intensityRef = useRef(MEASURED_BRIGHTNESS);

  useSimFrame(() => {
    const now = simClock.elapsedSec;
    const breathe = MEASURED_BRIGHTNESS * (0.9 + 0.1 * Math.sin(now * 0.8 + phase));
    intensityRef.current =
      breathe + arrivalFlare(now, floodT0Ref.current, cf.colonyArrivalS[node.id] ?? 0);
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
 * The single local "you" marker: distinct color, larger, non-selectable. Base
 * intensity 1 (CrystalGlow's internal halo breathe keeps it alive) plus the same
 * flood flare when the wavefront reaches it.
 */
function LocalCrystal({
  node,
  cf,
  floodT0Ref,
}: {
  node: NetworkNode;
  cf: ColonyFlood;
  floodT0Ref: React.MutableRefObject<number>;
}) {
  const intensityRef = useRef(1);
  useSimFrame(() => {
    intensityRef.current =
      1 + arrivalFlare(simClock.elapsedSec, floodT0Ref.current, cf.colonyArrivalS[node.id] ?? 0);
  });

  return (
    <group position={node.pos}>
      <CrystalGlow
        geom={PEER_GEOM}
        size={LOCAL_SIZE}
        color={LOCAL_MARKER_COLOR}
        intensityRef={intensityRef}
        seed={node.id}
      />
    </group>
  );
}

/**
 * Composes the colony: the inferred ghost cloud + one CrystalGlow per measured
 * peer + the single local "you" marker. On each block the wavefront lights the
 * cloud (InferredCloud owns its buffer) and flares the crystals; ColonyNodes owns
 * the shared `floodT0Ref` the crystals read.
 */
export default function ColonyNodes({
  topology,
  cf,
  blockPulseAtMs,
  backfillActive = false,
  selectedId,
  onSelect,
  localVersion,
}: {
  topology: NetworkTopology;
  cf: ColonyFlood;
  blockPulseAtMs: number;
  /** Calm catch-up: when true, consume the block pulse but skip the wavefront
   *  flash + crystal flares (see NetworkColony header). Optional/defaults false
   *  so standalone/external mounts keep the un-gated behaviour. */
  backfillActive?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  localVersion: string;
}) {
  const measured = useMemo(
    () => topology.nodes.filter((n) => n.kind === 'measured'),
    [topology],
  );
  const local = useMemo(
    () => topology.nodes.find((n) => n.kind === 'local'),
    [topology],
  );

  // Flood t0 for the measured/local crystal flares. Captured in THIS component's
  // own pulse effect; the crystals read it in useSimFrame (after the effect flush
  // → no child-before-parent staleness). Equals InferredCloud's / ColonyEdges'
  // own captures (same commit's effect flush reads the same simClock.elapsedSec).
  const floodT0Ref = useRef(-1e9);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    // Consume even while backfilling, then bail WITHOUT advancing floodT0Ref → the
    // measured/local crystals don't flare during catch-up (arrivalFlare reads the
    // stale t0, so its age stays past the flare window). No replay on clear.
    lastPulseRef.current = blockPulseAtMs;
    if (backfillActive) return;
    floodT0Ref.current = simClock.elapsedSec;
    // backfillActive is read from the render that bumped blockPulseAtMs (App
    // recomputes backfill + bumps the pulse together), so [blockPulseAtMs] suffices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  return (
    <group>
      <InferredCloud
        topology={topology}
        cf={cf}
        blockPulseAtMs={blockPulseAtMs}
        backfillActive={backfillActive}
      />
      {measured.map((n) => (
        <MeasuredCrystal
          key={n.id}
          node={n}
          cf={cf}
          floodT0Ref={floodT0Ref}
          selectedId={selectedId}
          onSelect={onSelect}
          localVersion={localVersion}
        />
      ))}
      {local ? <LocalCrystal node={local} cf={cf} floodT0Ref={floodT0Ref} /> : null}
    </group>
  );
}
