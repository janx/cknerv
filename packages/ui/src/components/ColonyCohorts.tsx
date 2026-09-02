// ColonyCohorts — what a POW cohort looks like: THE MARK IS THE APERTURE, AND
// THE MIST UNDER IT IS WHAT THE APERTURE IS FOR.
//
// A cohort is where the colony plane is OPEN, and this layer draws that opening
// three times: a disc lying IN the plane, a camera-facing halo carrying the
// same hole, and — under the plane — the PATCH of mist that hole is drinking.
// Nothing volumetric, nothing hanging under the slab, and no second cadence:
// one hole, two rays through it, and one surface being taken through it. And on
// the block a cohort wins, its mouth SWALLOWS: the one thing this layer takes
// from the block path is the flood's entry id, and the whole gate is a string
// compare — see the invariant paragraph at the end of this header, which is the
// argument that moved here.
//
// ⭐⭐⭐ THE PATCH IS THE INTAKE, AND IT IS THE POINT OF THE WHOLE FEATURE
// (「重点是 pow cohort 汲取能量的视觉效果」). It is one instance per cohort, sharing
// this layer's plan, its seed lane and its gulp lane — the same objects, so the
// mouth and the mist under it cannot disagree about which cohort stands where
// or which block it swallowed — lying 2.5 wu under the membrane and lifted into
// a mound whose top is exactly the level the window shows. It carries the
// medium's own texture advected along the streamlines of a sink with a vortex,
// brightens as it gathers, goes dark inside the rim and thins in its wake. The
// arithmetic and the design argument are in `materials/colonyMist`; the ambient
// haze that same substance makes everywhere else is `ColonyMist`, one layer out.
//
// ⛔⛔⛔ AND IT NEVER DRAWS ABOVE THE PLANE, AT ANY KNOB SETTING. The patch's
// vertex stage can only put a vertex BELOW its instance's origin, which is a
// property of the form (`MIST_PATCH_NEVER_ABOVE_GLSL`) and not of this file's
// props. ⛔ There is no column, plume, funnel or pillar under the mouth at any
// brightness profile — each was built and rejected by eye, and each read as a
// searchlight, up close as a saucer with a tractor beam. ⭐ ONLY SURFACES BEING
// DRAWN EVER READ AS INTAKE.
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
//     which is what makes the mouth swallow; stamped off the pulse below and
//     held against the NODE ID in `wonAtRef`, so a re-plan carries a win with
//     the cohort instead of handing it to whoever takes the slot.
//
// ⚠️⚠️ THE GULP LANE IS SIM SECONDS, ON THE CLOCK THIS FILE ALREADY WRITES.
// The envelope is `uTime - aGulp`; `uTime` is written from `simClock.elapsedSec`
// in the sim frame below; and the stamp reads `elapsedSec` off THE SAME
// `simClock` — one scope call in this component, two readers, so the two
// sides of that subtraction cannot come from different clocks. A
// `performance.now()` stamp would not merely be offset by the session's start:
// the difference is hundreds of thousands, `exp(-age / 0.45)` of that is zero,
// and the mouth would simply never move. Until a block names it, a slot holds
// `COHORT_NEVER_WON` — a far-negative sentinel, and not a nicety: zero reads as
// "won at t = 0" and flares the whole colony on load, which R16 shipped.
//
// ⭐ FLOAT32 IS THE LANE'S TYPE AND IT IS ENOUGH — measured, not assumed. The
// spacing of float32 over the sim seconds a session reaches is 61 µs at 1e3 s,
// 0.98 ms at 1e4 s (2.8 hours) and 7.8 ms at 1e5 s (27.8 hours) — still under a
// SEVENTH of the gulp's 0.06 s attack; it only widens to 1 s at 2^23 s, which is
// 97 days of unbroken session against an envelope that is over in three. And
// `uTime` is a float32 uniform on the other side of the same subtraction, so
// the lane is never coarser than the number it is compared against.
//
// ⚠️ THE SHARE LANE IS DORMANT, AND DELIBERATELY SO. Neither aperture program
// declares `aShare`: share means RATE on this layer, and the aperture has no
// rate a share could drive that survives the grain's own prefilter (see
// `COHORT_FACE_DRIFT`). It is written but NOT bound to the geometry, because
// binding an attribute no program declares would tell the next reader that
// something consumes it. `aGulp` IS bound, because the face really does declare
// it — which is the whole difference between the two.
//
// ⭐⭐⭐ IT TAKES NO SHOCKWAVE AND NO FLOOD, AND EXACTLY ONE STRING OF THE
// PULSE. The two absences and the one presence are the same argument, and the
// argument MOVED rather than being overruled.
//
// The absences stand, for the reason they always had: the front crosses the
// WHOLE colony on every block, so a shockwave sampled here — one number every
// cohort reads — would flare all six of them on a block exactly one of them
// won. That is the failure this layer exists not to have, and no wave-shaped
// input can avoid it.
//
// What is gone is the claim that ABSTINENCE was the only cure for it. This
// header used to argue that a layer with no per-block input is structurally
// incapable of discharging for the wrong cohort, which is true and is a SMALLER
// guarantee than the one available: `ColonyFlood.entryId` is `attested:<key>`
// exactly when the chain named a producer this colony stands a node for, and
// `CohortMark.nodeId` is that same string — ONE function builds both,
// `attestedNodeId` in `networkTopology.derive`, reached by the flood through
// `attestedOrigin` and by the mark through `stageAttested`. So the gate is one
// string equality against the identity the wave itself leaves from
// (`cohortWinStamp`), and a mark remains incapable of answering for anybody but
// itself — the same guarantee, at the same strength, while now being able to
// answer at all.
//
// ⚠️ THE DELIVERY PULSE REF WAS THE OTHER CANDIDATE, AND IT WAS REFUSED ON TWO
// MEASURED FACTS RATHER THAN ON TASTE. `NetworkColony` already stamps
// `{ at: simClock.elapsedSec, entryId, color }` into a ref for
// `BlockDeliveryLayer` — the sim seconds and the entry id this lane needs, at
// no new prop. But (1) it also carries `color`, that block's carrier hue — the
// tint the courier and the edge surge take — into a layer whose palette is
// `PEER_NETWORK_PALETTE.scaffold` and which is pinned not to know that hue's
// deriving function by name at all; and (2) it is DESTRUCTIVELY
// consumed — `BlockDeliveryLayer` nulls it once its carriers are done, saying
// in its own comment that it is "the ref's only reader", and
// `deliveryScheduleHorizon` returns 0 for an empty delivery list, so on a
// topology with no local node and no arrivals that retire lands in the same
// frame as the stamp. A second reader of a ref whose retire policy belongs to
// another layer is a gulp that stops working with no diff to point at. Three
// props and this layer's own copy of the colony's gate instead.
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
  cohortRimRadius,
  makeCohortAuraMaterial,
  makeCohortFaceMaterial,
} from '../materials/colonyCohort';
import {
  MIST_PATCH_SEGMENTS,
  makeCohortIntakePatchMaterial,
} from '../materials/colonyMist';
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

/** Lay the GULP lane out under a plan: one entry per staged mark, each the sim
 *  second that cohort last won a block, looked up by the graph id the flood's
 *  own origin is quoted in.
 *
 *  ⭐⭐ A WIN FOLLOWS THE COHORT AND NEVER THE SLOT, which is the law
 *  `cohortShareLane` above has always kept and the reason its first test is
 *  「by key and never by position」. The lane is indexed by POSITION and the
 *  staged set reshuffles whenever a producer enters or leaves the rolling
 *  window, so a walk that left the lane where it was would hand whoever takes
 *  slot 0 the moment its previous occupant won — a mark gulping for somebody
 *  else's block, arriving through a re-plan rather than through a bad key. A
 *  cohort the plan dropped is not in `marks` and therefore cannot be written
 *  anywhere; one that survived keeps its own moment wherever it now stands.
 *
 *  Pure, so the lane's contents can be pinned without a renderer — which they
 *  have to be, because r3f effects do not run under jsdom. */
export function cohortWinLane(
  marks: readonly CohortMark[],
  wonAt: ReadonlyMap<string, number> | null | undefined,
  gulp: Float32Array,
): void {
  marks.forEach((mark, index) => {
    gulp[index] = wonAt?.get(mark.nodeId) ?? COHORT_NEVER_WON;
  });
}

/**
 * Stamp `at` into the GULP lane of the ONE mark standing on `entryId`, and
 * return which index moved — or `-1`, having moved nothing at all.
 *
 * ⭐⭐⭐ ONE STRING COMPARE, AND IT IS THE WHOLE GATE. `ColonyFlood.entryId` is
 * `attested:<key>` exactly when the chain named a producer this colony stands a
 * node for, and `CohortMark.nodeId` is that same string from the same
 * `attestedNodeId` — so this is not a lookup that happens to agree with the
 * flood's origin, it IS the flood's origin. A mark cannot be stamped for a
 * block it did not make, because there is no path here from a block to a mark
 * except the identity the chain itself attested.
 *
 * ⭐ AND THE WAYS IT FIRES NOTHING ARE THE HONEST ANSWER, not a defensive
 * branch. `entryId` is the ANONYMOUS GHOST PICK whenever the cellbase named
 * nobody, whenever the producer left the rolling window between the pulse and
 * this render, and after every mid-session resync — three ordinary events, all
 * argued on `pickOrigin` — and a ghost id belongs to no cohort, so no mouth
 * moves. A colony with no cohorts at all hands over `null` for the same reason.
 * Nothing swallowing when the chain named nobody is the scene telling the truth
 * about what it was told.
 */
export function cohortWinStamp(
  marks: readonly CohortMark[],
  entryId: string | null | undefined,
  at: number,
  gulp: Float32Array,
): number {
  if (typeof entryId !== 'string' || entryId.length === 0) return -1;
  const index = marks.findIndex((mark) => mark.nodeId === entryId);
  if (index < 0) return -1;
  gulp[index] = at;
  return index;
}

/**
 * Every cohort's aperture, and the mist it is drinking, in three instanced
 * draws off ONE plan.
 *
 * The patch is the mist under the plane (`renderOrder` 0, drawn first because
 * it is the thing the other two are an opening onto); the face is the disc
 * lying in the colony plane (`renderOrder` 1); the aura is the camera-facing
 * halo around it (`renderOrder` 2), drawn last so the mark composites as a disc
 * inside its own glow. All three are additive and take their world extent from
 * a uniform — `uHalf` on the two faces, `uReach` on the patch — and per-frame
 * CPU work stays a handful of uniform writes.
 */
export default function ColonyCohorts({
  topology,
  producersRef,
  entryId = null,
  blockPulseAtMs = 0,
  backfillActive = false,
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
  /** ⭐⭐ WHERE THIS BLOCK'S WAVE LEAVES FROM — `ColonyFlood.entryId`, and ONE
   *  STRING of it rather than the flood. It is `attested:<key>` exactly when
   *  the chain named a producer this colony stands a node for, which is the
   *  same string `attestedNodeId` gives `CohortMark.nodeId`, so the whole gate
   *  is a compare against it (`cohortWinStamp`). Passing `cf` itself would hand
   *  this layer an arrival time for every node in the colony — a per-cohort
   *  answer built out of a colony-wide fact, which is the shape of the failure
   *  the header is about. Optional: a lab, a devnet nobody mines and a caller
   *  that never learned about the flood are one code path, and it is the one
   *  where no mouth ever moves. */
  entryId?: string | null;
  /** When the last block landed, in WALL-CLOCK ms. Read for its EDGE only. The
   *  moment written into the lane comes from `simClock.elapsedSec` instead,
   *  because the shader's `uTime` is sim seconds and a difference of two
   *  clocks is not an age — see the header. */
  blockPulseAtMs?: number;
  /** Whether the client is replaying a restore gap. ⚠️ Consume-then-bail: the
   *  pulse's edge is taken even while this is true, so a backlog cannot
   *  discharge as six gulps in a row the moment it clears. */
  backfillActive?: boolean;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const plan = useMemo(() => cohortMarks(topology), [topology]);
  const marks = useStableList(plan, sameCohortMark);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);
  const auraMeshRef = useRef<THREE.InstancedMesh>(null);
  const patchMeshRef = useRef<THREE.InstancedMesh>(null);
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
  // ⭐⭐ THE MIST'S PATCH IS THE ONE DRAW THAT CANNOT SHARE THAT QUAD, and the
  // reason is the MOUND: the patch rises toward the mouth in its VERTEX stage,
  // and a mound on two triangles is a tent. So it carries its own subdivided
  // unit plane — still a UNIT plane, with the extent riding `uReach` exactly as
  // the two faces' ride `uHalf`, so the live `cohortReach` knob stays a slider
  // instead of a rebuild.
  //
  // ⚠️ AND IT IS AN `InstancedBufferGeometry` HOLDING THE PLANE'S OWN BUFFERS,
  // per the geometry contract in `colonyMist.ts`'s header. The source plane is
  // never rendered and owns no GL state — the attributes ARE the resource, and
  // they live on here — so it is dropped rather than disposed, and disposing
  // THIS geometry on unmount frees exactly one copy of them.
  const patchGeometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1, MIST_PATCH_SEGMENTS, MIST_PATCH_SEGMENTS);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.getIndex());
    for (const [name, attribute] of Object.entries(plane.attributes)) {
      geometry.setAttribute(name, attribute);
    }
    return geometry;
  }, []);
  // Memoized on [] (stable for the component's life) so a plan rebuild never
  // forces a shader recompile; disposed on unmount only, for the same reason.
  const faceMaterial = useMemo(() => makeCohortFaceMaterial(), []);
  const auraMaterial = useMemo(() => makeCohortAuraMaterial(), []);
  const patchMaterial = useMemo(() => makeCohortIntakePatchMaterial(), []);
  // True per-draw GPU timings for the three instanced passes when the opt-in
  // render probe owns a timer-query context; a boolean gate otherwise, and no
  // query while no cohort stands (the layer unmounts then anyway). ⭐ Three
  // labels because the three draws fail differently: the face is a small disc
  // whose cost is its grain, the aura is a bigger quad whose cost is fill, the
  // patch is a 28 wu disc whose cost is two back-traces and four fetches per
  // fragment — and a mean over any two of them would hide one growing.
  const cohortGpuProbes = useMemo(() => ({
    face: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortFace),
    ),
    aura: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortAura),
    ),
    patch: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyMistPatch),
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

  /** When each staged cohort last won a block, in sim seconds, by graph id.
   *
   *  ⚠️ THE ONE PIECE OF STATE THE LANE CANNOT BE, and it is here for exactly
   *  the reason `cohortShareLane` looks its value up by key: a slot index is
   *  not an identity. The lane is indexed by position and the staged set
   *  reshuffles, so the moment a cohort won has to be held against the COHORT
   *  and re-laid whenever the plan moves. Held in a ref and never in state: the
   *  block that writes it must not re-render this subtree, which is the whole
   *  argument on `ProducerSharesRef`.
   *
   *  ⭐ A COHORT THE PLAN DROPPED KEEPS ITS ENTRY, which is a deliberate
   *  departure from R16's version of this map. R16 pruned to the staged set on
   *  every re-plan; the cost of that is a peer poll which briefly loses a
   *  producer from the rolling window CUTTING A SWALLOW SHORT — the mark
   *  returns two polls later reading the sentinel, for a block the chain never
   *  un-mined. The benefit it bought was a bound on the map, and the bound is
   *  already there without it: the keys are the distinct payout identities one
   *  session ever saw a block from, which is the same "handful" `COHORT_MARK_CAP`
   *  is a safety valve over — a number about how PoW rewards concentrate, not
   *  about how long the tab is left open. Nothing here is read for a cohort
   *  that is not staged, so a stale entry costs a string and a float. */
  const wonAtRef = useRef<Map<string, number>>(new Map());

  // Placement and identity: written only when the staged cohort set moves.
  useEffect(() => {
    const faceMesh = faceMeshRef.current;
    const auraMesh = auraMeshRef.current;
    const patchMesh = patchMeshRef.current;
    if (!faceMesh || !auraMesh || !patchMesh) return;
    // ⭐ ONE COUNT, WRITTEN THREE TIMES FROM ONE LIST. A cohort cannot wear a
    // mouth without the mist under it, or the mist without the mouth, whichever
    // way the plan moves — the hole and what it is drinking are one object.
    faceMesh.count = marks.length;
    auraMesh.count = marks.length;
    patchMesh.count = marks.length;
    // ⚠️ …AND THE PATCH'S GEOMETRY CARRIES THE SAME NUMBER, written here so the
    // two can never disagree. An `InstancedBufferGeometry` ships with
    // `instanceCount = Infinity`; this renderer never reads it (r169's
    // `renderBufferDirect` takes the `isInstancedMesh` branch first and uses
    // `object.count`), but leaving an Infinity on a live object is a trap for
    // the next reader — and for the `renderers/common` path, which reads the
    // geometry's count in preference to the mesh's.
    patchGeometry.instanceCount = marks.length;
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
      // ⭐⭐ THE PATCH TAKES THE SAME TRANSLATION, UNMODIFIED. It lies under
      // the plane, but the DEPTH belongs to its vertex stage (the statement
      // `MIST_PATCH_NEVER_ABOVE_GLSL` names): lowering the instance here
      // instead would put the mound's top somewhere other than the level the
      // window shows, and the sink's origin somewhere other than the mouth it
      // belongs to.
      SCRATCH_MATRIX.makeTranslation(mark.pos[0], mark.pos[1], mark.pos[2]);
      faceMesh.setMatrixAt(index, SCRATCH_MATRIX);
      auraMesh.setMatrixAt(index, SCRATCH_MATRIX);
      patchMesh.setMatrixAt(index, SCRATCH_MATRIX);
      seed[index] = mark.seed;
    });
    // …and the GULP lane is RE-LAID under the new plan, in the same walk. A win
    // belongs to a NODE ID and never to a slot: a cohort the plan dropped is
    // gone from `marks` and is written nowhere, one that survived carries its
    // own moment to wherever it now stands, and the slot it used to hold reads
    // `COHORT_NEVER_WON` rather than whatever the cohort before it left there.
    // ⚠️ The re-lay is unconditional because the lane may be BRAND NEW: a
    // capacity change rebuilds it at the sentinel, and the live wins have to be
    // put back into it before the next frame draws.
    cohortWinLane(marks, wonAtRef.current, lanes.gulp.array as Float32Array);
    faceMesh.instanceMatrix.needsUpdate = true;
    auraMesh.instanceMatrix.needsUpdate = true;
    patchMesh.instanceMatrix.needsUpdate = true;
    lanes.seed.needsUpdate = true;
    lanes.gulp.needsUpdate = true;
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
    // ⭐ ONE GEOMETRY, SO "THE SAME OBJECT ON BOTH APERTURE DRAWS" IS
    // STRUCTURAL. Both InstancedMeshes take this one `quad`, so a lane bound
    // here is by construction the same attribute — and the same GL buffer — on
    // both. The aura simply does not declare `aGulp`, which costs it nothing:
    // three binds only what a program asks for.
    if (quad.getAttribute('aSeed') !== lanes.seed) quad.setAttribute('aSeed', lanes.seed);
    if (quad.getAttribute('aGulp') !== lanes.gulp) quad.setAttribute('aGulp', lanes.gulp);
    // ⭐⭐⭐ …AND THE PATCH BINDS THE SAME TWO OBJECTS ONTO ITS OWN GEOMETRY,
    // WHICH IS THE WHOLE MECHANISM. One `InstancedBufferAttribute` bound to two
    // geometries is ONE GL buffer — three keys its upload on the ATTRIBUTE, not
    // on the geometry — so the re-lay above and the stamp below reach the mist
    // and the mouth in the same write, and `needsUpdate` set once serves both
    // draws. ⚠️ Wrapping `lanes.gulp.array` in a second attribute for the patch
    // would hand the GPU a second copy of the lane and orphan the first one's
    // buffer on the next capacity change, and the two copies would fall out of
    // step the first time only one of them was marked — a mouth swallowing one
    // block while the mist under it swallowed another.
    if (patchGeometry.getAttribute('aSeed') !== lanes.seed) {
      patchGeometry.setAttribute('aSeed', lanes.seed);
    }
    if (patchGeometry.getAttribute('aGulp') !== lanes.gulp) {
      patchGeometry.setAttribute('aGulp', lanes.gulp);
    }
  }, [lanes, marks, patchGeometry, quad]);

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

  // THE WIN, stamped on a `blockPulseAtMs` INCREASE into the one mark standing
  // on the node this block's wave leaves from — and into nothing else, ever.
  //
  // ⚠️ AN EFFECT AND NOT THE SIM FRAME, which is what every other block-reading
  // layer in this colony does: `ColonyEdges`, `ColonyNodes`,
  // `ColonyCourierLayer` and `NetworkColony`'s own delivery stamp all key on
  // `[blockPulseAtMs]`. A pulse is an EVENT with an edge, and a frame poll would
  // have to re-derive that edge from a number it is also free to miss. It also
  // means the stamp survives a pause: `useSimFrame` skips entirely while time is
  // paused, so a block arriving during one would be LOST rather than deferred —
  // and the sim clock is frozen too, so the moment recorded here is the moment
  // `uTime` resumes from, exactly as the colony's other surges do it.
  //
  // ⚠️ CONSUME-THEN-BAIL, word for word from `ColonyCourierLayer`. A restore gap
  // replays a backlog of pulses; taking the edge without stamping is what stops
  // that backlog discharging as six gulps in a row the moment `backfill` clears,
  // and a bail that forgot to consume would fire LATE instead — a gulp with no
  // block, which is worse than a gulp missed.
  //
  // ⚠️ AND IT WRITES A BUFFER, NEVER A STATE. All three props already reach this
  // layer's parent on every block, so nothing here is a new React render; if any
  // of it became state, the memoized colony subtree would re-render once a block
  // and the argument on `ProducerSharesRef` would have been undone by the very
  // layer it was written for.
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs; // consume even while backfilling…
    if (backfillActive) return; //           …but stamp nothing
    // ⭐ THE SIM CLOCK, NEVER THE PULSE'S OWN WALL-CLOCK MS. `uTime` is sim
    // seconds and is written from this same `simClock` in the frame below, so
    // an age is only a subtraction when both sides come from here.
    const at = simClock.elapsedSec;
    // ⭐⭐⭐ ONE STRING COMPARE. Nothing is stamped when the chain named nobody
    // this colony stands a node for — `entryId` is then the anonymous ghost
    // pick, which belongs to no cohort — and nothing is stamped for a producer
    // whose mark is not staged. Both are ordinary events (see `pickOrigin`),
    // and no mouth moving is the honest answer to each.
    const index = cohortWinStamp(marks, entryId, at, lanes.gulp.array as Float32Array);
    if (index < 0) return;
    // Keyed off the MARK's own id rather than off `entryId`, so the map and the
    // lane cannot disagree about which cohort was stamped.
    wonAtRef.current.set(marks[index].nodeId, at);
    lanes.gulp.needsUpdate = true;
    // entryId + backfillActive are read from the latest closure when
    // blockPulseAtMs advances (App recomputes cf + backfill + bumps
    // blockPulseAtMs from the same cells-cache render), so [blockPulseAtMs]
    // suffices — the gate every other layer in this colony keeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  useEffect(() => () => {
    quad.dispose();
    patchGeometry.dispose();
    faceMaterial.dispose();
    auraMaterial.dispose();
    patchMaterial.dispose();
  }, [auraMaterial, faceMaterial, patchGeometry, patchMaterial, quad]);

  useSimFrame(() => {
    const contextEnergy = contextEnergyRef?.current ?? 1;
    const elapsed = simClock.elapsedSec;
    const apR = LIVE.peer.cohortApR;
    const haloR = LIVE.peer.cohortHaloR;
    // ⭐⭐⭐ ONE LEVEL, TWO CONSUMERS, READ ONCE AND WRITTEN TWICE. This is the
    // depth at which the window stops showing the throat's wall and starts
    // showing the medium's surface, and it is ALSO the top of the mound the
    // patch below is lifted into. They are ONE SURFACE — a viewer looking into
    // the mouth and a viewer looking at the mist beside it are looking at the
    // same substance — so a knob that reached one of them would be a knob that
    // makes the layer lie. `COHORT_INTAKE_LEVEL` says the same thing at the
    // constant's own site.
    const level = LIVE.peer.cohortLevel;
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
    face.uInteriorAmp.value = LIVE.peer.cohortInteriorAmp;
    face.uLevel.value = level;
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
    // The mist being taken, on the same clock and the same energy as the mouth
    // taking it: `uTime - aGulp` is only an age when both sides come from this
    // one `simClock`, and the proximity exemption has to let a cohort the
    // camera flew to keep BOTH its light and its substance.
    const patch = patchMaterial.uniforms;
    patch.uTime.value = elapsed;
    patch.uContextEnergy.value = contextEnergy;
    patch.uLevel.value = level;
    // ⚠️ THE GATE, THE EYE, THE PILE AND THE WAKE ARE ALL FRACTIONS OF THE
    // MOUTH'S OWN HOLE, so the patch's rim radius is re-derived from the LIVE
    // `cohortApR` through the same function the mark's own radii come from. A
    // patch that held `COHORT_RIM_R` while the face read `uApR * uRimFrac`
    // would go dark inside a circle the mouth no longer has — two holes at one
    // cohort, drawn by two layers that both believed they were right.
    patch.uRimR.value = cohortRimRadius(apR);
    patch.uAmp.value = LIVE.peer.cohortMistAmp;
    patch.uContrastNear.value = LIVE.peer.cohortGather;
    patch.uK.value = LIVE.peer.cohortIntake;
    patch.uSwirl.value = LIVE.peer.cohortSwirl;
    patch.uReach.value = LIVE.peer.cohortReach;
    patch.uWake.value = LIVE.peer.cohortWake;
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
  // ⭐ THE PATCH IS DRAWN FIRST, THEN THE FACE, THEN THE AURA OVER BOTH. All
  // three are additive, so the order moves no pixel; it is the composition
  // order they read in — the substance under the plane, the disc that opens
  // onto it, and the glow around that — and saying it costs nothing.
  return (
    <group>
      {/* ⛔ THE MIST BEING TAKEN, AND IT NEVER DRAWS ABOVE THE PLANE. One
          instance per cohort, its sink at its own origin, lying
          `MIST_FLOOR_DEPTH` under the membrane and rising into a mound whose
          top is exactly what the window in the mouth shows. It is a SURFACE
          seen from outside and moving, which is the only thing twenty-five
          rounds found that reads as intake: a column, plume, funnel or pillar
          under the mouth reads as a searchlight at every brightness profile
          that was tried. The vertex stage cannot produce a vertex above its
          own origin (`MIST_PATCH_NEVER_ABOVE_GLSL`), so that is a property of
          the form and not of these props. */}
      <instancedMesh
        ref={patchMeshRef}
        args={[patchGeometry, patchMaterial, capacity]}
        {...cohortGpuProbes.patch}
        frustumCulled={false}
        renderOrder={0}
        raycast={() => null}
      />
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
