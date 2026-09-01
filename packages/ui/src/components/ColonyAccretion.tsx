// ColonyAccretion — what a POW cohort looks like: a vertical throat.
//
// Energy enters from BELOW the colony slab, continuously, as an analytic
// volume marched in the shader, and converges on a centre that is an ordinary
// peer stop with its own middle refused. The block leaves above and outward,
// briefly — and this layer does not draw that at all. It runs for as long as
// the payout identity is in the recent window. On the block it wins, the
// colony's own outward surge already erupts from that node, so nothing here
// fires and nothing here reads the pulse.
//
// The whole design argument — why the intake is a marched volume rather than
// shells or particles, why it accumulates optical depth instead of emission,
// and why the centre is deliberately not the brightest pixel on stage — lives
// in `materials/colonyAccretion`. Read it before touching either face.
//
// This file owns the two things that cannot live in a material:
//   • WHICH nodes wear one — `cohortAccretionMarks`, pure and exported, one
//     mark per attested node, carrying its placement and a stable per-cohort
//     seed so no two throats run their crests on the same beat;
//   • the live SHARE, which moves on every attributed block and must never be
//     allowed to move the geometry with it.
//
// ⚠️ IT TAKES NO PULSE, NO FLOOD AND NO SHOCKWAVE, and all three absences are
// deliberate. The front crosses the WHOLE colony on every block, so anything
// here that answered it would flare for every cohort on a block one of them
// won; and the win itself is already drawn, by the wave that starts at this
// very node. A layer with no per-block input is structurally incapable of
// discharging for the wrong cohort.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { fnv1a } from '../geometry/edgeBezier';
import type { NetworkTopology, Vec3 } from '../types';
import type { ProducerStanding } from '../derives/blockProducers.derive';
import { ATTESTED_ID_PREFIX } from '../derives/networkTopology.derive';
import {
  cohortIntakeHalfExtent,
  makeCohortCoreMaterial,
  makeCohortIntakeMaterial,
} from '../materials/colonyAccretion';
import { useStableList } from './ColonyNodes';
import { PERFORMANCE_PROBE_LABELS } from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyDrawGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';

/** Ceiling on the throats this layer will draw at once.
 *
 *  ⚠️ A SAFETY VALVE AND NOT A BUDGET. The count is bounded twice over already
 *  — a rolling window holds a handful of distinct payout identities, and the
 *  producer window itself is capped upstream — so nothing on a real chain comes
 *  near this. It is here because "a handful" is a fact about today's mainnet
 *  rather than a property of the wire, and a layer whose instance count is
 *  sized from upstream data should say out loud where it stops. The excess is
 *  dropped deterministically (the tail of the staged list) and warned once. */
export const COHORT_MARK_CAP = 64;

/** One cohort's mark: where the throat stands, and what makes it its own. */
export interface CohortMark {
  /** The payout key this throat belongs to. The live share is looked up by it. */
  readonly producerKey: string;
  /** The cohort's graph id — `attested:<key>`. */
  readonly nodeId: string;
  /** Where it stands, in colony-frame coordinates. */
  readonly pos: Vec3;
  /** Per-cohort de-sync in [0,1), a stable hash of the payout key. Without it
   *  every throat in the colony would run its crests on the same beat and six
   *  of them would read as one animation stamped six times. It is a fraction
   *  of a TURN, and both faces consume it: the intake takes it raw as crest
   *  phase, the centre's breathe takes it in radians. */
  readonly seed: number;
}

/**
 * Every cohort mark in a colony, from the topology and nothing else.
 *
 * ⭐⭐ IT TAKES NO STANDINGS, AND THAT IS WHAT KEEPS THE GEOMETRY STILL. A
 * cohort's blocks and share move on EVERY block while its key, its placement
 * and its seed do not. A plan that read the window would rewrite this layer's
 * instance matrices once a block for a numerator that moved, and the colony has
 * already learned what a buffer rebuilt on a tally costs. So the plan is a pure
 * function of the staged colony, the share rides a lane written in place, and
 * the two cadences never meet. Same split `selectedSighted` has always kept:
 * the node carries placement and identity, the view carries the live window.
 */
export function cohortAccretionMarks(
  topology: NetworkTopology,
  cap: number = COHORT_MARK_CAP,
): CohortMark[] {
  const out: CohortMark[] = [];
  for (const node of topology.nodes) {
    if (node.kind !== 'attested') continue;
    if (out.length >= cap) return out;
    const producerKey = node.attested?.key ?? node.id.slice(ATTESTED_ID_PREFIX.length);
    out.push({
      producerKey,
      nodeId: node.id,
      pos: node.pos,
      seed: (fnv1a(producerKey) >>> 0) / 4294967296,
    });
  }
  return out;
}

/** Same point, by value. `stageAttested` builds a fresh node — and a fresh
 *  `pos` array — on every call, so a reference test would report every cohort
 *  as having moved on every poll. */
function samePoint(a: Vec3, b: Vec3): boolean {
  return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

/** Whether two marks describe the same throat standing in the same place.
 *
 *  ⚠️ IT COMPARES THE POSITION AND NOT ONLY THE ID, which is the trap the ghost
 *  cloud names on its own held list: a RESEED keeps every `inf:n` id while
 *  moving every point, so an id-only test would call an entirely rearranged
 *  colony unchanged and leave these throats hanging in the space the old one
 *  used to occupy. Every position here is a pure hash of the key under a seed,
 *  so a value test costs three comparisons and is exact in both directions. */
export function sameCohortMark(a: CohortMark, b: CohortMark): boolean {
  return a.nodeId === b.nodeId && samePoint(a.pos, b.pos);
}

const SCRATCH_MATRIX = new THREE.Matrix4();

/** The live window, carried BY REFERENCE.
 *
 *  `BlockProducerView.staging` is a fresh array on every attributed block —
 *  its tallies moved — and handing it to the colony as a prop re-rendered the
 *  whole memoized colony subtree once a block, on top of the render the pulse
 *  itself already costs. The holder's identity never changes, so the colony's
 *  memo holds; this layer reads `current` once a frame and rewrites its share
 *  lane exactly when the array does. Read-only from here: the app owns it. */
export interface ProducerSharesRef {
  readonly current: readonly ProducerStanding[] | null;
}

/** Fill the share lane: one entry per staged mark, looked up by payout key.
 *
 *  A cohort the view has dropped keeps running at the floor rate rather than
 *  stopping: its node is still standing, and a throat that had gone still
 *  would say the machines behind it had. The next topology rebuild retires
 *  both.
 *  Pure, so the lane's contents can be pinned without a renderer. */
export function cohortShareLane(
  marks: readonly CohortMark[],
  producers: readonly ProducerStanding[] | null | undefined,
  share: Float32Array,
): void {
  const shareByKey = new Map<string, number>();
  for (const producer of producers ?? []) shareByKey.set(producer.key, producer.share);
  marks.forEach((mark, index) => {
    share[index] = shareByKey.get(mark.producerKey) ?? 0;
  });
}

/**
 * Every cohort's throat, in two instanced draws.
 *
 * The intake is the raymarched volume hanging below the node (`renderOrder` 1);
 * the centre is a camera-facing billboard on the node itself (`renderOrder` 2),
 * drawn after it so the convergence composites over the funnel that runs into
 * it rather than under it. Both are additive, both rebuild their quad in the
 * vertex shader, and per-frame CPU work stays a handful of uniform writes.
 */
export default function ColonyAccretion({
  topology,
  producersRef,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  /** ⭐⭐ THE LIVE WINDOW, and the only thing here allowed to say how fast a
   *  throat runs. The staged node carries the standing it had at the last KEY-SET
   *  change, because that is what the topology memo is keyed on and it must be.
   *  So the node is identity and placement; this is the share. Optional: a
   *  scene with no cohorts, a devnet that has not mined and a caller that never
   *  learned about producers are one code path. By reference, and read once a
   *  frame, so the window can move once a block without a React render
   *  anywhere in the colony — see `ProducerSharesRef`. */
  producersRef?: ProducerSharesRef | null;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const plan = useMemo(() => cohortAccretionMarks(topology), [topology]);
  const marks = useStableList(plan, sameCohortMark);
  const intakeMeshRef = useRef<THREE.InstancedMesh>(null);
  const coreMeshRef = useRef<THREE.InstancedMesh>(null);
  const cappedLogged = useRef(false);
  useEffect(() => {
    if (marks.length < COHORT_MARK_CAP || cappedLogged.current) return;
    cappedLogged.current = true;
    console.warn(
      `ColonyAccretion: >=${COHORT_MARK_CAP} cohorts staged; dropping excess.`,
    );
  }, [marks]);

  // ⚠️⚠️ ONE `PlaneGeometry(1, 1)`, SHARED BY BOTH DRAWS, AND NOT A DETAIL.
  // Each vertex program rebuilds its quad from raw `position` and the camera
  // axes, which no model matrix ever touches — so a scale on the mesh or on
  // the instance matrix is silently ignored, and the world extent has to ride
  // each material's own `uHalf` UNIFORM instead. The two materials this layer
  // used to draw did the opposite, baking their extent into
  // `PlaneGeometry(half * 2, half * 2)`, so a quad carried over from that
  // habit renders the intake 3.7x too big. Sharing ONE unit plane between two
  // draws of very different sizes — 11.662 world units and 2.3 — is what makes
  // the rule structural instead of remembered: there is no geometry here that
  // could carry an extent, right or wrong.
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  // Memoized on [] (stable for the component's life) so a plan rebuild never
  // forces a shader recompile; disposed on unmount only, for the same reason.
  const intakeMaterial = useMemo(() => makeCohortIntakeMaterial(), []);
  const coreMaterial = useMemo(() => makeCohortCoreMaterial(), []);
  // True per-draw GPU timings for the two instanced passes when the opt-in
  // render probe owns a timer-query context; a boolean gate otherwise, and no
  // query while no cohort stands (the layer unmounts then anyway). ⚠️ The
  // march is the one real perf risk on this layer — at inspection zoom the
  // intake's proxy can fill the frame — and its own label is what says so.
  const cohortGpuProbes = useMemo(() => ({
    intake: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortIntake),
    ),
    core: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortCore),
    ),
  }), []);
  const capacity = Math.max(1, marks.length);

  // The two per-cohort lanes, allocated once for a capacity and rewritten in
  // place. ⚠️ Wrapping data in a NEW InstancedBufferAttribute is what orphans
  // its GL buffer, and the share walk runs on every attributed block — so the
  // WRAPPER is what has to persist, not just the array.
  const lanes = useMemo(() => ({
    share: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    seed: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  }), [capacity]);

  // Placement and identity: written only when the staged cohort set moves.
  useEffect(() => {
    const intakeMesh = intakeMeshRef.current;
    const coreMesh = coreMeshRef.current;
    if (!intakeMesh || !coreMesh) return;
    intakeMesh.count = marks.length;
    coreMesh.count = marks.length;
    const seed = lanes.seed.array as Float32Array;
    marks.forEach((mark, index) => {
      // TRANSLATION ONLY — each quad's orientation is rebuilt from the view
      // matrix in the shader and its extent comes from a uniform, so a
      // rotation here would be undone and a scale here ignored outright.
      // ⭐ It is also what keeps the intake's throat exact: that vertex shader
      // reads the instance origin AS the convergence point, so a pure
      // translation is the whole of what the CPU has to say about placement.
      SCRATCH_MATRIX.makeTranslation(mark.pos[0], mark.pos[1], mark.pos[2]);
      intakeMesh.setMatrixAt(index, SCRATCH_MATRIX);
      coreMesh.setMatrixAt(index, SCRATCH_MATRIX);
      seed[index] = mark.seed;
    });
    intakeMesh.instanceMatrix.needsUpdate = true;
    coreMesh.instanceMatrix.needsUpdate = true;
    lanes.seed.needsUpdate = true;
    // Bound on the first pass and again only when a capacity change built new
    // lanes. The quad outlives both InstancedMeshes (a capacity change rebuilds
    // them through `args`), so it can still be holding the previous set. Both
    // programs read `aSeed`; only the intake declares `aShare`, and an
    // attribute a program never declares is never bound and costs nothing.
    if (quad.getAttribute('aSeed') !== lanes.seed) {
      quad.setAttribute('aSeed', lanes.seed);
      quad.setAttribute('aShare', lanes.share);
    }
  }, [lanes, marks, quad]);

  // The live share, written in place whenever the window moves — which is once
  // per attributed block — and never touching the geometry. The window last
  // written is remembered by identity: the app replaces the array exactly
  // once per attributed block, so an identity test once a frame is the whole
  // cost of following it, and the walk runs exactly as often as the effect
  // keyed on the array used to.
  const writtenSharesRef = useRef<readonly ProducerStanding[] | null | undefined>(
    undefined,
  );
  const writeShares = useCallback((producers: readonly ProducerStanding[] | null) => {
    cohortShareLane(marks, producers, lanes.share.array as Float32Array);
    // Marked ONCE for the whole walk, never once per write.
    lanes.share.needsUpdate = true;
    writtenSharesRef.current = producers;
  }, [lanes, marks]);
  // A new lane or a moved cohort set needs the walk regardless of whether the
  // window moved: the slots behind the marks are not the ones written before.
  useEffect(() => {
    writeShares(producersRef?.current ?? null);
  }, [producersRef, writeShares]);
  // Raw frame, not the sim frame: the standings are chain state, and a paused
  // clock must not hold a throat at a rate the window has already left behind —
  // the effect this replaces ran under a pause too.
  useFrame(() => {
    const live = producersRef?.current ?? null;
    if (live === writtenSharesRef.current) return;
    writeShares(live);
  });

  useEffect(() => () => {
    quad.dispose();
    intakeMaterial.dispose();
    coreMaterial.dispose();
  }, [coreMaterial, intakeMaterial, quad]);

  useSimFrame(() => {
    const contextEnergy = contextEnergyRef?.current ?? 1;
    const elapsed = simClock.elapsedSec;
    const reach = LIVE.peer.cohortReach;
    const mouth = LIVE.peer.cohortMouth;
    const intake = intakeMaterial.uniforms;
    intake.uTime.value = elapsed;
    intake.uContextEnergy.value = contextEnergy;
    intake.uReach.value = reach;
    intake.uMouth.value = mouth;
    // ⚠️ THE PROXY HAS TO FOLLOW THE VOLUME. `uHalf` is not an independent
    // number: it is the bounding-sphere radius of a cylinder of radius `mouth`
    // and height `reach`, so a knob that grows either one while the quad stays
    // where it was crops the funnel against its own bounding proxy. The ray
    // clip inside would still be exact — the pixels carrying the far side of
    // the mouth would simply never be rasterised to run it, which reads as a
    // straight edge across a volume that has none. Re-derived through the same
    // function the constant is defined with, so there is one authority.
    intake.uHalf.value = cohortIntakeHalfExtent(mouth, reach);
    intake.uAmp.value = LIVE.peer.cohortAmp;
    intake.uDensity.value = LIVE.peer.cohortDensity;
    intake.uCrests.value = LIVE.peer.cohortCrests;
    intake.uRate.value = LIVE.peer.cohortRate;
    intake.uGather.value = LIVE.peer.cohortGather;
    const core = coreMaterial.uniforms;
    core.uTime.value = elapsed;
    core.uContextEnergy.value = contextEnergy;
    core.uAmp.value = LIVE.peer.cohortCoreAmp;
  });

  // ⭐ NO COHORTS ⇒ NO DRAW, NOT AN EMPTY ONE. Every hook above still runs, so
  // the buffers are ready the instant one appears — but nothing enters the
  // scene graph, and a material that is never rendered is never COMPILED. A
  // devnet nobody mines and a review lab that passes no window carry an empty
  // vertex program otherwise, for the whole life of the scene. Same rule the
  // colony's own tier keeps for a stop with nobody standing at it.
  if (marks.length === 0) return null;

  // ⚠️ Never a pick target. The cohort's target is the staged node's own hit
  // sphere, sized from the CENTRE's extent in `ColonyNodes`; a live raycast on
  // the intake's proxy — 23 world units across, hanging below a plane where
  // nothing else is drawn — would put a wall of invisible quads in front of
  // the colony.
  //
  // ⭐ THE INTAKE IS DRAWN FIRST AND THE CENTRE OVER IT. Both are additive, so
  // the order moves no pixel; it is the composition order the two faces read
  // in — a funnel running into a point, rather than a point with a funnel laid
  // across it — and saying it costs nothing.
  return (
    <group>
      <instancedMesh
        ref={intakeMeshRef}
        args={[quad, intakeMaterial, capacity]}
        {...cohortGpuProbes.intake}
        frustumCulled={false}
        renderOrder={1}
        raycast={() => null}
      />
      <instancedMesh
        ref={coreMeshRef}
        args={[quad, coreMaterial, capacity]}
        {...cohortGpuProbes.core}
        frustumCulled={false}
        renderOrder={2}
        raycast={() => null}
      />
    </group>
  );
}
