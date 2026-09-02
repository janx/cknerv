// ColonyCohorts — what a POW cohort looks like: THE MARK IS THE APERTURE.
//
// A cohort is where the colony plane is OPEN, and this layer draws that opening
// twice: a disc lying IN the plane, and a camera-facing halo carrying the same
// hole. Nothing volumetric, nothing hanging under the slab, and no second
// cadence — one hole, two rays through it. The win itself is an instant the
// colony's own outward surge already draws, from this very node, so nothing
// here fires and nothing here reads the pulse.
//
// ⭐⭐⭐ AND THE HOLE HAS A WINDOW IN IT. The peer mesh is the boundary between
// two universes — above it the cell canopy, below it the one a cohort drinks
// from — so looking into the aperture is looking at the other world: the
// throat's wall lit FROM BELOW, and, deeper than `COHORT_INTAKE_LEVEL`, the
// surface of the medium rising toward the lip. That is how 「从下方汲取能量」 is
// said, and it is the only way twenty-five rounds found to say it that does not
// lie: ⛔ NO PLUME, COLUMN, FUNNEL OR PILLAR under the mouth at any brightness
// profile — only SURFACES BEING DRAWN ever read as intake.
//
// ⛔⛔⛔ THE COHORT NEVER EMITS UPWARD, AT ANY TIME. A mined block goes SIDEWAYS
// TO PEERS ONLY, because peers must verify it before it legitimately enters the
// cell galaxy. `BlockDeliveryLayer` draws that later leg, launching from
// MEASURED WORKERS on flood arrivals — never from the cohort: `planDeliveries`
// emits a carrier only for ids in `cf.arrivals`, and the flood derive writes an
// arrival only where `kind === 'measured'`, which an attested cohort is not.
// THE TWO WORLDS MEET AT THE APERTURE IN THE PLANE. ⚠️ Three successive plans
// said "the block leaves ABOVE and outward" from here; they were wrong, and the
// rule is written positively so the next reader inherits it and not the
// misconception.
//
// The face draws a CIRCLE; every ellipse a viewer sees is projection, and
// because every cohort foreshortens identically that agreement is what makes
// the colony plane itself legible. The plane's normal is world Y, which is also
// the colony's rotation axis, so the mark turns with the plate and needs no
// frame of its own — and it has no axis anybody could read as pointing
// somewhere.
//
// The pupil's darkness is a REFUSAL and never a painted disc: both draws are
// additive and depth-read-only, and the middle is simply where bright structure
// declines to fill. The corollary lives one layer over — `ColonyEdges` stops a
// cohort's own links at the mark's outer edge, because with nothing to occlude
// and nothing to depth-reject, a link run into the disc would be ADDED to the
// grain it crosses and to the one pixel the form spends itself keeping empty.
//
// The whole design argument — why a hole rather than a volume, why the aura is
// not decoration, and why the two knees are a Pythagorean pair — lives in
// `materials/colonyCohort`. Read it before touching either face.
//
// This file owns the three things that cannot live in a material:
//   • WHICH nodes wear one — `cohortMarks`, pure and exported, one mark per
//     attested node, carrying its placement and a stable per-cohort seed so no
//     two apertures breathe on the same beat;
//   • the live SHARE, which moves on every attributed block and must never be
//     allowed to move the geometry with it;
//   • the GULP lane, `aGulp` — the sim second of the block each cohort won,
//     which is what makes the mouth swallow.
//
// ⚠️ THE GULP LANE IS ALLOCATED AND NOBODY WRITES IT YET. It is filled with
// `COHORT_NEVER_WON`, a far-negative sentinel, and stays there: the block path
// that stamps it lands in the next commit. That is why the paragraph below
// still says this layer takes no pulse — it does not, today, and the lane reads
// as "has never won" at every cohort until it does. ⚠️ The sentinel is not a
// nicety: zero would read as "won at t = 0" and flare the whole colony on load.
//
// ⚠️ THE SHARE LANE IS DORMANT, AND DELIBERATELY SO. Neither aperture program
// declares `aShare`: share means RATE on this layer, and the aperture has no
// rate a share could drive that survives the grain's own prefilter (see
// `COHORT_FACE_DRIFT`). It is written but NOT bound to the geometry, because
// binding an attribute no program declares would tell the next reader that
// something consumes it. `aGulp` IS bound, because the face really does declare
// it — which is the whole difference between the two.
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
  COHORT_NEVER_WON,
  cohortAuraHalfExtent,
  cohortFaceHalfExtent,
  makeCohortAuraMaterial,
  makeCohortFaceMaterial,
} from '../materials/colonyCohort';
import { useStableList } from './ColonyNodes';
import { PERFORMANCE_PROBE_LABELS } from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyDrawGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';

/** Ceiling on the marks this layer will draw at once.
 *
 *  ⚠️ A SAFETY VALVE AND NOT A BUDGET. The count is bounded twice over already
 *  — a rolling window holds a handful of distinct payout identities, and the
 *  producer window itself is capped upstream — so nothing on a real chain comes
 *  near this. It is here because "a handful" is a fact about today's mainnet
 *  rather than a property of the wire, and a layer whose instance count is
 *  sized from upstream data should say out loud where it stops. The excess is
 *  dropped deterministically (the tail of the staged list) and warned once. */
export const COHORT_MARK_CAP = 64;

/** One cohort's mark: where the aperture stands, and what makes it its own. */
export interface CohortMark {
  /** The payout key this mark belongs to. The live share is looked up by it. */
  readonly producerKey: string;
  /** The cohort's graph id — `attested:<key>`. */
  readonly nodeId: string;
  /** Where it stands, in colony-frame coordinates. */
  readonly pos: Vec3;
  /** Per-cohort de-sync in [0,1), a stable hash of the payout key. Without it
   *  every aperture in the colony would breathe on the same beat and six of
   *  them would read as one animation stamped six times. It is a fraction of a
   *  TURN, and both faces consume it: the face's grain takes it as an azimuthal
   *  offset, both breathes take it in radians. */
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
export function cohortMarks(
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

/** Whether two marks describe the same aperture standing in the same place.
 *
 *  ⚠️ IT COMPARES THE POSITION AND NOT ONLY THE ID, which is the trap the ghost
 *  cloud names on its own held list: a RESEED keeps every `inf:n` id while
 *  moving every point, so an id-only test would call an entirely rearranged
 *  colony unchanged and leave these marks hanging in the space the old one used
 *  to occupy. Every position here is a pure hash of the key under a seed, so a
 *  value test costs three comparisons and is exact in both directions. */
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
 *  A cohort the view has dropped keeps its slot at zero rather than losing it:
 *  its node is still standing, and the next topology rebuild retires both.
 *  Pure, so the lane's contents can be pinned without a renderer.
 *
 *  ⚠️ NOTHING READS THE LANE TODAY — see the file header. It is kept written
 *  and kept tested so the deferred 汲取 work inherits a correct in-place lane
 *  rather than a rebuilt one, and the layer says out loud that it is dormant
 *  rather than letting a reader infer a consumer that does not exist. */
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
 * Every cohort's aperture, in two instanced draws.
 *
 * The face is the disc lying in the colony plane (`renderOrder` 1); the aura is
 * the camera-facing halo around it (`renderOrder` 2), drawn after so the mark
 * composites as a disc inside its own glow. Both are additive, both carry their
 * world extent in a uniform, and per-frame CPU work stays a handful of uniform
 * writes.
 */
export default function ColonyCohorts({
  topology,
  producersRef,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  /** ⭐⭐ THE LIVE WINDOW. The staged node carries the standing it had at the
   *  last KEY-SET change, because that is what the topology memo is keyed on and
   *  it must be. So the node is identity and placement; this is the share.
   *  Optional: a scene with no cohorts, a devnet that has not mined and a caller
   *  that never learned about producers are one code path. By reference, and
   *  read once a frame, so the window can move once a block without a React
   *  render anywhere in the colony — see `ProducerSharesRef`.
   *
   *  ⚠️ It reaches no shader today; see the file header on the dormant lane. */
  producersRef?: ProducerSharesRef | null;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const plan = useMemo(() => cohortMarks(topology), [topology]);
  const marks = useStableList(plan, sameCohortMark);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);
  const auraMeshRef = useRef<THREE.InstancedMesh>(null);
  const cappedLogged = useRef(false);
  useEffect(() => {
    if (marks.length < COHORT_MARK_CAP || cappedLogged.current) return;
    cappedLogged.current = true;
    console.warn(
      `ColonyCohorts: >=${COHORT_MARK_CAP} cohorts staged; dropping excess.`,
    );
  }, [marks]);

  // ⚠️⚠️ ONE `PlaneGeometry(1, 1)`, SHARED BY BOTH DRAWS, AND NOT A DETAIL.
  // Neither vertex program reads `position` as world units: the face lays the
  // unit plane into the instance's own XZ and the aura rebuilds its quad from
  // the camera axes, and NEITHER path is touched by `mesh.scale` or by a scaled
  // instance matrix — so the world extent has to ride each material's own
  // `uHalf` UNIFORM instead. The two materials this layer used to draw did the
  // opposite, baking their extent into `PlaneGeometry(half * 2, half * 2)`, so
  // a quad carried over from that habit renders a mark several times too big.
  // Sharing ONE unit plane between two draws of different sizes — 3 world units
  // and 4.293 — is what makes the rule structural instead of remembered: there
  // is no geometry here that could carry an extent, right or wrong.
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  // Memoized on [] (stable for the component's life) so a plan rebuild never
  // forces a shader recompile; disposed on unmount only, for the same reason.
  const faceMaterial = useMemo(() => makeCohortFaceMaterial(), []);
  const auraMaterial = useMemo(() => makeCohortAuraMaterial(), []);
  // True per-draw GPU timings for the two instanced passes when the opt-in
  // render probe owns a timer-query context; a boolean gate otherwise, and no
  // query while no cohort stands (the layer unmounts then anyway). ⭐ Two
  // labels because the two draws fail differently: the face is a small disc
  // whose cost is its grain, the aura is a bigger quad whose cost is fill, and
  // a mean over both would hide either one growing.
  const cohortGpuProbes = useMemo(() => ({
    face: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortFace),
    ),
    aura: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortAura),
    ),
  }), []);
  const capacity = Math.max(1, marks.length);

  // The three per-cohort lanes, allocated once for a capacity and rewritten in
  // place. ⚠️ Wrapping data in a NEW InstancedBufferAttribute is what orphans
  // its GL buffer, and the share walk runs on every attributed block — so the
  // WRAPPER is what has to persist, not just the array. That is also why the
  // gulp lane is ONE wrapper rather than one per draw: the wrapper is the
  // identity three uploads by, and a second wrapper around the same array would
  // hand the GPU a second copy of it.
  //
  // ⚠️⚠️ `gulp` STARTS AT A FAR-NEGATIVE SENTINEL AND NEVER AT ZERO. The lane
  // holds the SIM SECOND of the block each cohort won, and the mouth's envelope
  // is a function of `uTime - aGulp`. A zero-filled lane therefore says "every
  // cohort won at t = 0", and since `uTime` also starts at zero the whole
  // colony gulps for the first half second of every session, for a block none
  // of them mined. R16 shipped exactly that. `COHORT_NEVER_WON` is far enough
  // below any reachable `uTime` that the envelope is identically zero.
  //
  // ⚠️ A CAPACITY CHANGE RESETS IT TO THE SENTINEL, which is correct rather
  // than lossy: the slots behind the marks are not the ones that were written,
  // and a win belongs to a NODE ID and not to a slot. Re-laying live wins into
  // a rebuilt lane is the block path's job (T3), off a map keyed on the id.
  const lanes = useMemo(() => ({
    share: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    seed: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    gulp: new THREE.InstancedBufferAttribute(
      new Float32Array(capacity).fill(COHORT_NEVER_WON),
      1,
    ),
  }), [capacity]);

  // Placement and identity: written only when the staged cohort set moves.
  useEffect(() => {
    const faceMesh = faceMeshRef.current;
    const auraMesh = auraMeshRef.current;
    if (!faceMesh || !auraMesh) return;
    faceMesh.count = marks.length;
    auraMesh.count = marks.length;
    const seed = lanes.seed.array as Float32Array;
    marks.forEach((mark, index) => {
      // TRANSLATION ONLY — the face's quad is laid into local XZ and the
      // aura's is rebuilt from the view matrix, and both take their extent
      // from a uniform, so a scale here is ignored outright.
      // ⭐⭐ AND A SCALE HERE WOULD SPLIT THE ONE HOLE IN TWO. The face reads
      // its radius in the instance's own plane while the aura reads the same
      // radius off a ray/plane crossing in world space; a scaled instance
      // would move the first and not the second, and the two faces would stop
      // agreeing about where the pupil is.
      SCRATCH_MATRIX.makeTranslation(mark.pos[0], mark.pos[1], mark.pos[2]);
      faceMesh.setMatrixAt(index, SCRATCH_MATRIX);
      auraMesh.setMatrixAt(index, SCRATCH_MATRIX);
      seed[index] = mark.seed;
    });
    faceMesh.instanceMatrix.needsUpdate = true;
    auraMesh.instanceMatrix.needsUpdate = true;
    lanes.seed.needsUpdate = true;
    // Bound on the first pass and again only when a capacity change built new
    // lanes. The quad outlives both InstancedMeshes (a capacity change rebuilds
    // them through `args`), so it can still be holding the previous set.
    // ⚠️ `aSeed` AND `aGulp` ARE BOUND, `aShare` IS NOT. Both programs declare
    // the seed and the face declares the gulp; nothing declares the share, and
    // an attribute no program declares would never be uploaded — so binding it
    // costs nothing at runtime and buys a false claim in the source. The share
    // lane is kept and written (see the file header) but is not attached to a
    // geometry until a program asks for it.
    //
    // ⭐ ONE GEOMETRY, SO "THE SAME OBJECT ON BOTH DRAWS" IS STRUCTURAL. Both
    // InstancedMeshes take this one `quad`, so a lane bound here is by
    // construction the same attribute — and the same GL buffer — on both. The
    // aura simply does not declare `aGulp`, which costs it nothing: three binds
    // only what a program asks for.
    if (quad.getAttribute('aSeed') !== lanes.seed) quad.setAttribute('aSeed', lanes.seed);
    if (quad.getAttribute('aGulp') !== lanes.gulp) quad.setAttribute('aGulp', lanes.gulp);
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
  // clock must not hold the lane at a window that has already moved on — the
  // effect this replaces ran under a pause too.
  useFrame(() => {
    const live = producersRef?.current ?? null;
    if (live === writtenSharesRef.current) return;
    writeShares(live);
  });

  useEffect(() => () => {
    quad.dispose();
    faceMaterial.dispose();
    auraMaterial.dispose();
  }, [auraMaterial, faceMaterial, quad]);

  useSimFrame(() => {
    const contextEnergy = contextEnergyRef?.current ?? 1;
    const elapsed = simClock.elapsedSec;
    const apR = LIVE.peer.cohortApR;
    const haloR = LIVE.peer.cohortHaloR;
    const face = faceMaterial.uniforms;
    face.uTime.value = elapsed;
    face.uContextEnergy.value = contextEnergy;
    face.uApR.value = apR;
    // ⚠️ THE QUAD HAS TO FOLLOW THE MARK. `uHalf` is not an independent
    // number: the disc is exactly `apR` across its own half-diagonal, so a
    // knob that grows the mark while the quad stays where it was crops the rim
    // against its own proxy. The radius test inside the fragment would still
    // be exact — the pixels carrying the rim would simply never be rasterised
    // to run it, which reads as a straight edge across a circle that has none.
    // Re-derived through the same function the constant is defined with, so
    // there is one authority. That bug has shipped on this layer once already.
    face.uHalf.value = cohortFaceHalfExtent(apR);
    face.uPupilFrac.value = LIVE.peer.cohortPupil;
    face.uRimAmp.value = LIVE.peer.cohortRimAmp;
    face.uInAmp.value = LIVE.peer.cohortIntakeAmp;
    face.uStriae.value = LIVE.peer.cohortStriae;
    face.uStriaAmp.value = LIVE.peer.cohortStriaAmp;
    const aura = auraMaterial.uniforms;
    aura.uTime.value = elapsed;
    aura.uContextEnergy.value = contextEnergy;
    aura.uApR.value = apR;
    aura.uHaloR.value = haloR;
    // ⚠️ Same rule, two inputs: the halo reaches `apR * haloR`, so BOTH knobs
    // move this quad and the margin is a derived perspective correction rather
    // than a guess. See `cohortAuraHalfExtent`.
    aura.uHalf.value = cohortAuraHalfExtent(apR, haloR);
    aura.uPupilFrac.value = LIVE.peer.cohortPupil;
    aura.uHaloBias.value = LIVE.peer.cohortHaloBias;
  });

  // ⭐ NO COHORTS ⇒ NO DRAW, NOT AN EMPTY ONE. Every hook above still runs, so
  // the buffers are ready the instant one appears — but nothing enters the
  // scene graph, and a material that is never rendered is never COMPILED. A
  // devnet nobody mines and a review lab that passes no window carry an empty
  // vertex program otherwise, for the whole life of the scene. Same rule the
  // colony's own tier keeps for a stop with nobody standing at it.
  if (marks.length === 0) return null;

  // ⚠️ Never a pick target. The cohort's target is the staged node's own hit
  // sphere, sized from the mark's radius in `ColonyNodes` — half of it, because
  // `COLONY_MIN_SPACING` forbids a target that reaches a neighbour's half of
  // the gap. A live raycast on the aura's quad — 8.6 world units across, and
  // overlapping its neighbours' — would put a wall of invisible target in front
  // of the colony.
  //
  // ⭐ THE FACE IS DRAWN FIRST AND THE AURA OVER IT. Both are additive, so the
  // order moves no pixel; it is the composition order the two faces read in —
  // a disc inside its own glow, rather than a glow with a disc laid across it
  // — and saying it costs nothing.
  return (
    <group>
      <instancedMesh
        ref={faceMeshRef}
        args={[quad, faceMaterial, capacity]}
        {...cohortGpuProbes.face}
        frustumCulled={false}
        renderOrder={1}
        raycast={() => null}
      />
      <instancedMesh
        ref={auraMeshRef}
        args={[quad, auraMaterial, capacity]}
        {...cohortGpuProbes.aura}
        frustumCulled={false}
        renderOrder={2}
        raycast={() => null}
      />
    </group>
  );
}
