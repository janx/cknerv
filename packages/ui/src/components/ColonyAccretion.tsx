// ColonyAccretion — what a POW cohort looks like: an accreting void.
//
// A soft light-removing gravity depression sits under a cyan-white photon ring,
// peer-profile halo, lensed accretion disc, and continuous gas drawn inward
// from the surrounding void.
// It runs continuously for as long as the payout identity is in the recent
// window. On the block it wins, the colony's own outward surge already erupts
// from that node, so nothing here fires and nothing here reads the pulse.
//
// The whole design argument — why the aperture and light need separate passes,
// and how this differs from the Cell canopy's contact wave — lives in
// `materials/colonyAccretion`. Read it before touching either.
//
// This file owns the two things that cannot live in a material:
//   • WHICH nodes wear one — `cohortAccretionMarks`, pure and exported, one
//     mark per attested node, carrying its placement and a stable per-cohort
//     seed so no two holes swirl on the same beat;
//   • the live SHARE, which moves on every attributed block and must never be
//     allowed to move the geometry with it.
//
// ⚠️ IT TAKES NO PULSE, NO FLOOD AND NO SHOCKWAVE, and all three absences are
// deliberate. The front crosses the WHOLE colony on every block, so anything
// here that answered it would flare for every cohort on a block one of them
// won; and the win itself is already drawn, by the wave that starts at this
// very node. A layer with no per-block input is structurally incapable of
// discharging for the wrong cohort.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { fnv1a } from '../geometry/edgeBezier';
import type { NetworkTopology, Vec3 } from '../types';
import type { ProducerStanding } from '../derives/blockProducers.derive';
import { ATTESTED_ID_PREFIX } from '../derives/networkTopology.derive';
import {
  COHORT_MARK_HALF_EXTENT,
  COHORT_SHADOW_HALF_EXTENT,
  makeColonyAccretionMaterial,
  makeColonyHorizonMaterial,
} from '../materials/colonyAccretion';
import { useStableList } from './ColonyNodes';

/** Ceiling on the holes this layer will draw at once.
 *
 *  ⚠️ A SAFETY VALVE AND NOT A BUDGET. The count is bounded twice over already
 *  — a rolling window holds a handful of distinct payout identities, and the
 *  producer window itself is capped upstream — so nothing on a real chain comes
 *  near this. It is here because "a handful" is a fact about today's mainnet
 *  rather than a property of the wire, and a layer whose instance count is
 *  sized from upstream data should say out loud where it stops. The excess is
 *  dropped deterministically (the tail of the staged list) and warned once. */
export const COHORT_MARK_CAP = 64;

/** One cohort's mark: where the hole stands, and what makes it its own. */
export interface CohortMark {
  /** The payout key this hole belongs to. The live share is looked up by it. */
  readonly producerKey: string;
  /** The cohort's graph id — `attested:<key>`. */
  readonly nodeId: string;
  /** Where it stands, in colony-frame coordinates. */
  readonly pos: Vec3;
  /** Per-cohort de-sync in [0,1), a stable hash of the payout key. Without it
   *  every hole in the colony would swirl on the same beat and six of them
   *  would read as one animation stamped six times. */
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

/** Whether two marks describe the same hole standing in the same place.
 *
 *  ⚠️ IT COMPARES THE POSITION AND NOT ONLY THE ID, which is the trap the ghost
 *  cloud names on its own held list: a RESEED keeps every `inf:n` id while
 *  moving every point, so an id-only test would call an entirely rearranged
 *  colony unchanged and leave these holes hanging in the space the old one used
 *  to occupy. Every position here is a pure hash of the key under a seed, so a
 *  value test costs three comparisons and is exact in both directions. */
export function sameCohortMark(a: CohortMark, b: CohortMark): boolean {
  return a.nodeId === b.nodeId && samePoint(a.pos, b.pos);
}

const SCRATCH_MATRIX = new THREE.Matrix4();

/**
 * Every cohort's accreting void, in two instanced draws.
 *
 * The compact normal-blended pass makes the gravity depression able to soften
 * the mesh behind it; the larger additive pass supplies the photon ring, disc,
 * lensing arcs and gaseous infall. Both are camera-facing and rebuilt in the
 * vertex shader, so per-frame CPU work remains a handful of uniform writes.
 */
export default function ColonyAccretion({
  topology,
  producers,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  /** ⭐⭐ THE LIVE WINDOW, and the only thing here allowed to say how fast a
   *  hole eats. The staged node carries the standing it had at the last KEY-SET
   *  change, because that is what the topology memo is keyed on and it must be.
   *  So the node is identity and placement; this is the share. Optional: a
   *  scene with no cohorts, a devnet that has not mined and a caller that never
   *  learned about producers are one code path. */
  producers?: readonly ProducerStanding[] | null;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const plan = useMemo(() => cohortAccretionMarks(topology), [topology]);
  const marks = useStableList(plan, sameCohortMark);
  const horizonMeshRef = useRef<THREE.InstancedMesh>(null);
  const accretionMeshRef = useRef<THREE.InstancedMesh>(null);
  const cappedLogged = useRef(false);
  useEffect(() => {
    if (marks.length < COHORT_MARK_CAP || cappedLogged.current) return;
    cappedLogged.current = true;
    console.warn(
      `ColonyAccretion: >=${COHORT_MARK_CAP} cohorts staged; dropping excess.`,
    );
  }, [marks]);

  const horizonGeometry = useMemo(
    () => new THREE.PlaneGeometry(
      COHORT_SHADOW_HALF_EXTENT * 2,
      COHORT_SHADOW_HALF_EXTENT * 2,
    ),
    [],
  );
  const accretionGeometry = useMemo(
    () => new THREE.PlaneGeometry(
      COHORT_MARK_HALF_EXTENT * 2,
      COHORT_MARK_HALF_EXTENT * 2,
    ),
    [],
  );
  // Memoized on [] (stable for the component's life) so a plan rebuild never
  // forces a shader recompile; disposed on unmount only, for the same reason.
  const horizonMaterial = useMemo(() => makeColonyHorizonMaterial(), []);
  const accretionMaterial = useMemo(() => makeColonyAccretionMaterial(), []);
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
    const horizonMesh = horizonMeshRef.current;
    const accretionMesh = accretionMeshRef.current;
    if (!horizonMesh || !accretionMesh) return;
    horizonMesh.count = marks.length;
    accretionMesh.count = marks.length;
    const seed = lanes.seed.array as Float32Array;
    marks.forEach((mark, index) => {
      // TRANSLATION ONLY — the quad's own orientation is rebuilt from the view
      // matrix in the shader, so a rotation here would be undone and a scale
      // here would fight the geometry's world extent.
      SCRATCH_MATRIX.makeTranslation(mark.pos[0], mark.pos[1], mark.pos[2]);
      horizonMesh.setMatrixAt(index, SCRATCH_MATRIX);
      accretionMesh.setMatrixAt(index, SCRATCH_MATRIX);
      seed[index] = mark.seed;
    });
    horizonMesh.instanceMatrix.needsUpdate = true;
    accretionMesh.instanceMatrix.needsUpdate = true;
    lanes.seed.needsUpdate = true;
    // Bound on the first pass and again only when a capacity change built new
    // lanes. The geometry outlives the InstancedMesh (a capacity change
    // rebuilds the mesh through `args`), so it can still be holding the
    // previous set.
    if (accretionMesh.geometry.getAttribute('aSeed') !== lanes.seed) {
      accretionMesh.geometry.setAttribute('aSeed', lanes.seed);
      accretionMesh.geometry.setAttribute('aShare', lanes.share);
    }
  }, [lanes, marks]);

  // The live share, written in place whenever the window moves — which is once
  // per attributed block, and never touches the geometry.
  useEffect(() => {
    if (!accretionMeshRef.current) return;
    const shareByKey = new Map<string, number>();
    for (const producer of producers ?? []) shareByKey.set(producer.key, producer.share);
    const share = lanes.share.array as Float32Array;
    marks.forEach((mark, index) => {
      // A cohort the view has dropped keeps eating at the floor rate rather
      // than stopping: its node is still standing, and a hole that had gone
      // still would say the machines behind it had. The next topology rebuild
      // retires both.
      share[index] = shareByKey.get(mark.producerKey) ?? 0;
    });
    // Marked ONCE for the whole walk, never once per write.
    lanes.share.needsUpdate = true;
  }, [lanes, marks, producers]);

  useEffect(() => () => {
    horizonGeometry.dispose();
    accretionGeometry.dispose();
    horizonMaterial.dispose();
    accretionMaterial.dispose();
  }, [accretionGeometry, accretionMaterial, horizonGeometry, horizonMaterial]);

  useSimFrame(() => {
    const contextEnergy = contextEnergyRef?.current ?? 1;
    horizonMaterial.uniforms.uContextEnergy.value = contextEnergy;
    accretionMaterial.uniforms.uTime.value = simClock.elapsedSec;
    accretionMaterial.uniforms.uContextEnergy.value = contextEnergy;
    accretionMaterial.uniforms.uRimAmp.value = LIVE.peer.holeRim;
    accretionMaterial.uniforms.uGasAmp.value = LIVE.peer.holeGas;
    accretionMaterial.uniforms.uInfall.value = LIVE.peer.holeInfall;
    accretionMaterial.uniforms.uSwirl.value = LIVE.peer.holeSwirl;
    accretionMaterial.uniforms.uSpin.value = LIVE.peer.holeSpin;
  });

  // ⭐ NO COHORTS ⇒ NO DRAW, NOT AN EMPTY ONE. Every hook above still runs, so
  // the buffers are ready the instant one appears — but nothing enters the
  // scene graph, and a material that is never rendered is never COMPILED. A
  // devnet nobody mines and a review lab that passes no window carry an empty
  // vertex program otherwise, for the whole life of the scene. Same rule the
  // colony's own tier keeps for a stop with nobody standing at it.
  if (marks.length === 0) return null;

  // ⚠️ Never a pick target. The hole's target is the staged node's own hit
  // sphere, sized from this mark's rim in `ColonyNodes`; a live raycast on a
  // billboard several world units across would put a wall of invisible quads
  // in front of the colony.
  return (
    <group>
      <instancedMesh
        ref={horizonMeshRef}
        args={[horizonGeometry, horizonMaterial, capacity]}
        frustumCulled={false}
        renderOrder={1}
        raycast={() => null}
      />
      <instancedMesh
        ref={accretionMeshRef}
        args={[accretionGeometry, accretionMaterial, capacity]}
        frustumCulled={false}
        renderOrder={2}
        raycast={() => null}
      />
    </group>
  );
}
