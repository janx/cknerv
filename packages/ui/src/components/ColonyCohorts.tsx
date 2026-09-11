// ColonyCohorts — what a POW cohort looks like: A MASS IN THE MEMBRANE, AND THE
// INTAKE IS THE IMAGE OF IT.
//
// ⭐⭐⭐ THE MARK IS COMPUTED AND NO LONGER COMPOSED. Until 2026-09-03 this layer
// drew a cohort three times — a disc lying in the colony plane, a camera-facing
// halo carrying the same hole, and a patch of mist under the plane the hole was
// drinking. Seven rounds of that hand-built form reached a ceiling the user
// named: it never looked like the film. The reason is structural. Gargantua's
// image is a CONSEQUENCE of light bending around a mass, and a stack of
// independently mapped parts cannot converge on shapes it does not contain. So
// the layer is TWO DRAWS now:
//
//   • the LENS — one camera-facing quad per cohort (`materials/colonyLens`), in
//     which every pixel's light ray is traced backward around a Schwarzschild
//     mass and reported where it ends: in the horizon (black, and it hides what
//     is behind), on the disc (the intake's own substance, sampled where the
//     bent ray crosses the colony plane), or in the void. The shadow, the photon
//     ring, the far side of the disc folded over the top, the beaming and the
//     redshift all FOLLOW from that trace, at every camera angle;
//   • the MOTES — 96 points per cohort (`materials/colonyMotes`), each living
//     exactly one fall along the same sink's streamline, born out in the void
//     and gone at the shadow's edge. A field alone cannot say how fast the
//     substance is moving; these can, and that is the whole reason they exist.
//
// ⭐⭐⭐ THE INTAKE IS STILL THE POINT OF THE WHOLE FEATURE (「重点是 pow cohort
// 汲取能量的视觉效果」). What the disc shows IS the mist being taken: the medium,
// the spiral back-trace and the sink's strength are `colonyMist.ts`'s own text,
// compiled into the lens program, and the motes fall on the same arithmetic. One
// substance, seen once as a field and once as parcels of it.
//
// ⚠️⚠️⚠️ RENDER ORDER IS PART OF THE DESIGN, AND THIS IS THE ONLY LAYER IN THE
// COLONY THAT IS. The lens is normally blended with premultiplied alpha —
// `dst = src + dst·(1 − a)` — because a shadow is a place where light is
// REMOVED and additive blending has no way to say that; it can only fail to
// add. So the mark OCCLUDES BY DRAW ORDER AND NOT BY DEPTH: it darkens
// everything drawn BEFORE it and nothing drawn after. Hence
//   1. this layer is mounted AFTER `ColonyEdges` and `ColonyNodes` in
//      `NetworkColony`, and before the courier and delivery layers;
//   2. the lens carries `renderOrder` 1, strictly above the edges' and the
//      nodes' 0, because three sorts equal render orders by DEPTH and both of
//      those are single draws with one z for the whole colony — a tie would let
//      the whole ghost cloud draw after the shadow and shine through it;
//   3. the motes carry 2, strictly above the lens, because the disc's alpha
//      reaches 0.85 and specks drawn under it would be attenuated exactly where
//      they are brightest.
// ⭐ The courier (1, 2) and the delivery (1–4) tie or exceed, which is right:
// where they tie, three's depth sort decides, so a carrier passing BEHIND a
// hole is darkened and one in front is not.
//
// ⛔⛔⛔ AND IT NEVER DRAWS ABOVE THE PLANE, AT ANY KNOB SETTING. The disc plane
// IS the colony plane; a mote's offset from its seat has y = 0 exactly; and the
// arc over the top of the shadow is disc light bent by the mass, not something
// emitted upward. ⛔ There is no column, plume, funnel or pillar under a mouth
// at any brightness profile — each was built and rejected by eye across
// twenty-five rounds, and each read as a searchlight, up close as a saucer with
// a tractor beam. ⭐ ONLY SURFACES BEING DRAWN EVER READ AS INTAKE.
//
// ⛔⛔⛔ THE COHORT NEVER EMITS UPWARD, AT ANY TIME. A mined block goes SIDEWAYS
// TO PEERS ONLY, because peers must verify it before it legitimately enters the
// cell galaxy. `BlockDeliveryLayer` draws that later leg, launching from
// MEASURED WORKERS on flood arrivals — never from the cohort: `planDeliveries`
// emits a carrier only for ids in `cf.arrivals`, and the flood derive writes an
// arrival only where `kind === 'measured'`, which an attested cohort is not.
// THE TWO WORLDS MEET AT THE MASS IN THE PLANE. ⚠️ Three successive plans said
// "the block leaves ABOVE and outward" from here; they were wrong, and the rule
// is written positively so the next reader inherits it and not the
// misconception.
//
// ⭐⭐ THE FORM FOLDS WITH THE CAMERA, AND ONE NUMBER DOES IT. `uPxScale` is
// written once a frame — `0.5 · drawingBufferHeight · projectionMatrix[1][1]`,
// NORMALISED TO THE REFERENCE DPR (see `cohortPxScale`) — and each program
// divides it by its own distance to the camera to get PIXELS PER WORLD UNIT at
// that cohort AS THE REFERENCE DISPLAY WOULD MEASURE THEM. Below `uUnfoldLo`
// the mass, the disc, the shadow's opacity, the motes' birth radius and their
// brightness are all folded down to a peer-sized smudge; above `uUnfoldHi` the
// film's hole is open. ⚠️ THE BAND IS 20 → 50 AND WAS 6 → 30 UNTIL 2026-09-03,
// when the user judged the mid range far too big; the edges are named rather
// than restated here so a retune never has to find this paragraph.
// ⚠️ THE FOLD IS DISPLAY-INDEPENDENT (D-5, 2026-09-06). The scale is written
// off the DRAWING BUFFER's height, never `state.size`, but divided back to the
// reference DPR by the live pixel ratio, so one CSS framing folds the SAME on a
// 1× and a 2× display and a tier's DPR step can neither fold nor unfold the
// mark (the tier changes the DPR, not the reference). It was raw device pixels
// until then, which made a 2× buffer march at the default camera and cost the
// march ×dpr² — the ratchet a single dolly could step the tier down on.
//
// This file owns the four things that cannot live in a material:
//   • WHICH nodes wear one — `cohortMarks`, pure and exported, one mark per
//     attested node, carrying its placement and a stable per-cohort seed so no
//     two discs breathe on the same beat;
//   • the live SHARE, which moves on every attributed block and must never be
//     allowed to move the geometry with it — and its MAXIMUM, because the sink's
//     factor is a ratio and only this layer sees every instance;
//   • the GULP lane, `aGulp` — the sim second of the block each cohort won,
//     which is what makes the disc pile and the specks flare; stamped off the
//     pulse below and held against the NODE ID in `wonAtRef`, so a re-plan
//     carries a win with the cohort instead of handing it to whoever takes the
//     slot;
//   • the MASS lane, `aMass` — the cohort's share of the indexer's WEEK, eased
//     toward its target over a second and a half and held against the NODE ID
//     in `massNowRef` for exactly the reason the gulp is, so a re-plan carries
//     a cohort's size with it instead of resizing whoever takes its slot.
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
// ⭐⭐⭐ THE SHARE LANE IS THE SINK'S STRENGTH, IN BOTH DRAWS. `aShare` is the
// cohort's fraction of its window; the lens's vertex stage turns it into one
// per-instance factor (`mistShareFactor`, floor 0.35, normalised by
// `uShareMax`) that scales the sink's `k` and the pile at the lip, so a cohort
// holding 62 % of its window drinks at the full rate and one holding 2 % creeps
// in at the floor. The motes take the SAME factor — this layer runs
// `mistShareFactor` on the CPU and writes the result into their `aStrength`, so
// the specks fall at exactly the speed the streamlines behind them run at.
//
// ⚠️ AND THE VALUE IN IT IS THE WEEK WHEN THERE IS A WEEK: `ledger.share` if
// the indexer named this producer over its seven days, else `share`, the
// 240-block ring's. The two are shares of DIFFERENT windows and are never mixed
// — each standing carries its own denominator — so what the lane holds is
// "this cohort's fraction of whichever window it was measured against", which
// is the quantity a rate wants. A ring that a reorg has just emptied therefore
// stops making every cohort look equal.
//
// ⭐⭐⭐ THE MASS LANE, `aMass`, IS THE FOURTH — AND THE MASS IS THE WEEK. It
// carries one factor per cohort, `clamp(cbrt(week / anchor), floor, 1)` off
// `ProducerStanding.ledger.share`, and that factor multiplies EVERY length in
// both of this layer's programs. It is the ONLY per-cohort form parameter there
// is: the horizon, the disc's stops, the colours and the fold's band are all
// GLOBAL uniforms, so until this lane was written seven cohorts were seven
// copies of one picture — which is the question that asked for it (「不同 pow
// cohort 形态是否可以根据数据不同做一些变化，方便区分？」).
//
// Four rules hold it there, and each is a ruling already on record:
//   1. THE CEILING IS TODAY'S FORM. `m = 1` at and above the anchor share, so
//      the cohort holding 62 % of the week keeps the form the user judged on
//      2026-09-03 exactly and everyone else folds DOWN. The colony gets
//      quieter, never louder — the mark stays secondary to the mesh and the
//      canopy BY CONSTRUCTION rather than by a taste that can drift.
//   2. THE WEEK ONLY, ABSOLUTE, AND NEVER THE RING. `aShare` drives a RATE and
//      takes whichever window measured a producer, normalised by the busiest
//      cohort in view. A SIZE is read at a glance, compared across days and
//      against the peers standing beside it: it must not pulse once a block
//      (the 240-block ring moves on every block, empties on every reorg, and is
//      empty for the first minute of every boot) and must not depend on who
//      else happens to be staged. No week ⇒ every mass is 1 ⇒ the picture this
//      layer drew before the lane existed, byte for byte.
//   3. THE FOLD IS PIXELS PER SHADOW, NOT PER WORLD UNIT. Both programs take
//      their closeness from `uPxScale · m / distance`, so every cohort's hole
//      opens at the same ON-SCREEN size — the only arrangement in which a small
//      cohort at the mid range is not "a small eye", a form the user refused
//      twice.
//   4. NOTHING THE TOPOLOGY READS MOVES. The hit sphere, the link stop and the
//      keep-out radius are constants sized for the MAXIMUM; the placement is
//      still a pure hash of the key. The lane is written in place and no
//      geometry is rebuilt on a tally.
//
// ⚠️ AND IT IS ALLOCATED AT 1 BEFORE ANYTHING WRITES IT, because a lane a
// geometry does not carry reads as ZERO in WebGL and zero is a mark with no
// extent at all — three independent guards, see the lanes memo below.
//
// ⚠️ THE SIGN IS THE HAND. The magnitude is the size and the sign says which
// way the cohort winds (`cohortHandLane`, off the same seed the phase comes
// from): one lane for two facts, because the motes' copy of it is 96 vertices
// wide and a bit does not deserve a second float of that.
//
// ⭐ THREE KNOBS OWN IT, AND THEY ARE THE ONLY PER-COHORT ONES IN THE PANEL:
// `cohortMassAnchor` (0.6, the week share at which a cohort is full size),
// `cohortMassFloor` (0.45, the smallest it may be drawn — and 1 is the OFF
// switch, since every mass is clamped into that range and the colony then draws
// exactly what it drew before this lane was written) and `cohortHand` (1,
// whether a cohort winds its own way or the whole colony winds one). All three
// go through the TARGETS and never through the lane, so moving one is a
// second-and-a-half ease and not a colony-wide pop.
//
// ⚠️⚠️ THE TWO DRAWS DO NOT SHARE ONE LANE OBJECT, AND THAT IS NOT AN OVERSIGHT.
// The lens is an InstancedMesh and reads ONE value per instance, so its four
// lanes are `InstancedBufferAttribute`s and the WRAPPER is what has to persist —
// a second wrapper around the same array is a second GL buffer with the first
// one orphaned. The motes are a `THREE.Points` draw with one vertex per MOTE, so
// the same lane has to be 96 copies wide: handing that geometry the instanced
// wrapper would read one cohort's stamp for the first ninety-sixth of the
// colony's motes and garbage after it. Same VALUES, two widths, written by the
// same two walks — the plan's and the pulse's — so nothing can fall out of step.
//
// ⭐⭐⭐ IT TAKES NO SHOCKWAVE AND NO FLOOD, AND EXACTLY ONE STRING OF THE
// PULSE. The two absences and the one presence are the same argument, and the
// argument MOVED rather than being overruled.
//
// The absences stand, for the reason they always had: the front crosses the
// WHOLE colony on every block, so a shockwave sampled here — one number every
// cohort reads — would flare every mark in the colony on a block exactly one of
// them won. That is the failure this layer exists not to have, and no wave-shaped
// input can avoid it.
//
// What is gone is the claim that ABSTINENCE was the only cure for it.
// `ColonyFlood.entryId` is `attested:<key>` exactly when the chain named a
// producer this colony stands a node for, and `CohortMark.nodeId` is that same
// string — ONE function builds both, `attestedNodeId` in
// `networkTopology.derive`, reached by the flood through `attestedOrigin` and by
// the mark through `stageAttested`. So the gate is one string equality against
// the identity the wave itself leaves from (`cohortWinStamp`), and a mark
// remains incapable of answering for anybody but itself — the same guarantee, at
// the same strength, while now being able to answer at all.
//
// ⭐ MEASURED ON LIVE MAINNET, 2026-09-02: over a 360-second window with
// `backfillActive` false throughout, 29 block pulses arrived, all 29 named a
// cohort, all 29 stamped a slot, and the stamped slot's `nodeId` equalled
// `cf.entryId` all 29 times — 0 mismatches, 0 pulses naming a cohort without a
// stamp, 0 stamps for a pulse that named no cohort (the anonymous ghost pick
// never appeared in this window). Four distinct cohorts won; the mark count
// never changed, so the re-lay was not exercised by a re-plan here and remains
// pinned by test rather than by measurement.
//
// ⭐ RE-MEASURED ON THE TWO-DRAW LAYER, 2026-09-03: 310 s of live mainnet, seven
// marks throughout, 28 pulses / 28 stamps / 28 matching node ids / 0 mismatches,
// and — the claim that is new here — the changed cohort's NINETY-SIX mote copies
// carried the lens slot's value on all 28 of them. Five distinct cohorts won.
// ⚠️⚠️ TWO TRAPS COST HALF THAT LEG, and both produce the symptom "the gulp
// stopped working". A watcher that CACHES `geometry.getAttribute('aGulp').array`
// goes blind at the next re-plan, because `lanes` is memoized on the mark count
// and the cached `Float32Array` becomes an orphan — re-read the attribute every
// frame. And `Time.paused` freezes `simClock.elapsedSec`, so two blocks stamp
// the same number and a differ watching the LANE sees nothing change: count the
// gulp only over a running page.
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { fnv1a } from '../geometry/edgeBezier';
import type { NetworkTopology, Vec3 } from '../types';
import type { ProducerStanding } from '../derives/blockProducers.derive';
import { ATTESTED_ID_PREFIX } from '../derives/networkTopology.derive';
import { COHORT_NEVER_WON } from '../materials/colonyCohort';
import {
  COHORT_LENS_STEPS,
  COHORT_MASS_SLEW_S,
  cohortDiscInner,
  cohortDiscStops,
  cohortHandedness,
  cohortMassApproach,
  cohortMassFactor,
  cohortMassLaneValue,
  cohortShadowRadius,
  makeCohortLensMaterial,
} from '../materials/colonyLens';
import {
  COHORT_MOTES_PER_COHORT,
  COHORT_MOTE_K,
  buildCohortMotesGeometry,
  cohortMoteColor,
  makeCohortMotesMaterial,
  markCohortAttributeRange,
  setCohortMotesDrawCount,
  stampCohortMotes,
  writeCohortMotes,
  writeCohortMotesMass,
} from '../materials/colonyMotes';
import { MIST_SINK_K, mistShareFactor } from '../materials/colonyMist';
import { useStableList } from './ColonyNodes';
import { PERFORMANCE_PROBE_LABELS } from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyDrawGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';

/** Ceiling on the marks this layer will draw at once.
 *
 *  ⚠️ A SAFETY VALVE AND NOT A BUDGET. The count is bounded on BOTH sides of
 *  the union it now stages: the rolling window holds a handful of distinct
 *  payout identities and is capped upstream, and the indexer's week is capped
 *  at `PRODUCER_LEDGER_ROW_CAP` (16) before it leaves the adapter — so their
 *  sum on a real chain (7 rows over ~6 window producers, live 2026-09-02)
 *  comes nowhere near this. It is here because "a handful" is a fact about today's mainnet
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
   *  every mark in the colony would move on the same beat and the whole set
   *  would read as one animation stamped once per producer. Both draws consume
   *  it: the lens offsets the medium's two-phase clock by it (`vSeed`), and the
   *  motes spread their births, phases and rebirth angles out of it. */
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

/** Fill the share lane: one entry per staged mark, looked up by payout key —
 *  and return the LARGEST share it wrote, which is the lens's `uShareMax`.
 *
 *  A cohort the view has dropped keeps its slot at zero rather than losing it:
 *  its node is still standing, and the next topology rebuild retires both.
 *  Pure, so the lane's contents can be pinned without a renderer.
 *
 *  ⭐⭐ BOTH DRAWS READ IT, AND WHAT THEY SPEND IT ON IS A RATE: the factor
 *  `mistShareFactor` scales the sink's `k` and the pile at the disc's inner
 *  edge, so the busiest cohort in view drinks at the full strength and every
 *  other in proportion. The lens runs the factor in its vertex stage off
 *  `aShare`; the motes take the same factor already applied, in `aStrength`,
 *  because their geometry is not instanced (see the file header).
 *
 *  ⭐⭐ THE WEEK WHEN THERE IS A WEEK. `ledger.share` is this producer's
 *  fraction of the indexer's seven complete days; `share` is its fraction of
 *  the 240-block ring. They are shares of DIFFERENT windows and are never
 *  mixed, which is why this reads one or the other rather than combining them:
 *  each standing carries the denominator its own numerator was counted against
 *  (`blockProducers.derive`), and the ring is empty for the first minute of
 *  every boot and after every reorg — exactly when a rate driven off it would
 *  say every cohort is equal.
 *
 *  ⚠️ THE MAXIMUM COMES OUT OF THE SAME WALK, so the lane and the number the
 *  shader divides by cannot disagree. It is 1 when nothing positive was
 *  written — no marks, no window, or a window in which every staged cohort
 *  holds nothing — which puts every factor at the floor, the honest reading of
 *  "no cohort here is taking anything". */
export function cohortShareLane(
  marks: readonly CohortMark[],
  producers: readonly ProducerStanding[] | null | undefined,
  share: Float32Array,
): number {
  const shareByKey = new Map<string, number>();
  for (const producer of producers ?? []) {
    shareByKey.set(producer.key, producer.ledger?.share ?? producer.share);
  }
  let max = 0;
  marks.forEach((mark, index) => {
    const value = shareByKey.get(mark.producerKey) ?? 0;
    share[index] = value;
    if (value > max) max = value;
  });
  return max > 0 ? max : 1;
}

/** Fill the MASS lane's TARGETS: one size factor per staged mark, looked up by
 *  payout key against the indexer's SEVEN-DAY window — and return whether
 *  there was a week to read at all.
 *
 *  ⭐⭐⭐ THE WEEK AND NEVER THE RING, WHICH IS THE OPPOSITE CHOICE FROM THE
 *  LANE ABOVE, and the two are right for opposite reasons. `aShare` drives a
 *  RATE: a rate is read over seconds of watching, against the busiest cohort in
 *  view, so it takes whichever window measured a producer. A SIZE is read at a
 *  glance and compared across days and against the peers standing beside it, so
 *  it must not pulse once a block — the 240-block ring moves on every block,
 *  empties on every reorg and is empty for the first minute of every boot — and
 *  must not depend on who else happens to be staged. `ledger.share` is the only
 *  reading with those properties, so this reads it ALONE and never falls back
 *  to the ring.
 *
 *  ⭐⭐ NO LEDGER ⇒ EVERY MASS IS 1 ⇒ TODAY'S PICTURE, BYTE FOR BYTE. A
 *  ckbadger outage (`producer_ledger_clear`), a devnet, a boot before the first
 *  fetch: the honest answer to "how big is this cohort" is then the form this
 *  layer drew before it could ask. The return says WHICH of the two happened,
 *  so a caller can tell "the week says everyone is full size" from "there is no
 *  week" without re-walking the standings.
 *
 *  ⚠️ A KEY THE WEEK DOES NOT NAME TAKES THE FLOOR, and that is a reading
 *  rather than a missing value: a producer inside the 240 blocks and outside
 *  the seven days is brand new, or too small to have made the adapter's 16-row
 *  cap, or a cohort the week has dropped that is still standing. Every one of
 *  those is "small this week", which is what the floor says.
 *
 *  By KEY and never by position, for the reason `cohortShareLane` is: the
 *  staged set reshuffles and a slot index is not an identity. Pure, so the
 *  targets can be pinned without a renderer.
 */
export function cohortMassLane(
  marks: readonly CohortMark[],
  producers: readonly ProducerStanding[] | null | undefined,
  anchor: number,
  floor: number,
  target: Float32Array,
): boolean {
  const weekByKey = new Map<string, number>();
  for (const producer of producers ?? []) {
    // ⚠️ `ledger` IS NULL FOR EVERY PRODUCER WHEN THERE IS NO WEEK — and
    // undefined on a standing built before the field existed. Both are "the
    // week does not name this one" and neither is a share of zero.
    const week = producer?.ledger?.share;
    if (typeof week !== 'number') continue;
    weekByKey.set(producer.key, week);
  }
  if (weekByKey.size === 0) {
    for (let index = 0; index < marks.length; index += 1) target[index] = 1;
    return false;
  }
  marks.forEach((mark, index) => {
    const week = weekByKey.get(mark.producerKey);
    target[index] = week === undefined
      ? floor
      : cohortMassFactor(week, anchor, floor);
  });
  return true;
}

/** Which way ONE cohort winds: its own hand off its seed, or +1 for the whole
 *  colony while the panel's switch is off.
 *
 *  ⭐ THE HAND IS IDENTITY AND NOT DATA. The seed is `fnv1a(payout key)`, so it
 *  is stable across churn and claims nothing about the chain — and it is what
 *  separates the middling cohorts the week makes the same size. ⚠️ The knob is
 *  a SWITCH and is read at the half-way mark, because a panel value is a float
 *  and a hand is a bit: there is no such thing as a cohort winding 0.4 of the
 *  way round.
 */
export function cohortHandLane(seed: number, handKnob: number): number {
  return handKnob >= 0.5 ? cohortHandedness(seed) : 1;
}

/** Lay the MASS lane out under a plan: one SIGNED value per staged mark, each
 *  the size that cohort is currently at, looked up by the graph id its ease is
 *  held against.
 *
 *  ⭐⭐ A SIZE FOLLOWS THE COHORT AND NEVER THE SLOT — the same law
 *  `cohortWinLane` keeps for the gulp, and it has to be kept twice because the
 *  staged set reshuffles whenever a producer enters or leaves the window. A
 *  walk that left the lane where it was would hand whoever takes slot 0 its
 *  previous occupant's size and then ease it away over a second and a half:
 *  half the colony visibly resizing because one cohort left.
 *
 *  ⚠️ A COHORT NOBODY HAS EASED YET STARTS AT ITS TARGET, which is what the
 *  `??` is for: a mark appearing at 2 % of the week must be small the frame it
 *  appears rather than shrink into it from whatever the slot held. Growth is
 *  for a mass that CHANGED, never for a cohort that arrived.
 *
 *  Pure, so a re-plan's arithmetic can be pinned without a renderer.
 */
export function cohortMassRelay(
  marks: readonly CohortMark[],
  massNow: ReadonlyMap<string, number> | null | undefined,
  target: Float32Array,
  handKnob: number,
  lane: Float32Array,
): void {
  marks.forEach((mark, index) => {
    lane[index] = cohortMassLaneValue(
      massNow?.get(mark.nodeId) ?? target[index],
      cohortHandLane(mark.seed, handKnob),
    );
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

/* -------------------------------------------------------------------------- *
 * The two per-frame numbers this layer computes rather than reads.
 * -------------------------------------------------------------------------- */

/** The reference DPR the fold is measured at. The reference display (2560×1440
 *  at DPR 1) folds one world unit onto its own device pixels; every other
 *  display folds onto the pixels IT would have at this same DPR, so a 2× buffer
 *  folds one CSS framing the way the reference machine does. */
export const COHORT_FOLD_REFERENCE_DPR = 1;

/**
 * The fold's scale: multiply by nothing and divide by a cohort's distance to
 * the camera, and the answer is PIXELS PER WORLD UNIT at that cohort — as the
 * REFERENCE DISPLAY would measure them.
 *
 * ⭐⭐ PIXELS PER WORLD UNIT AND NOT DISTANCE, because the same distance is a
 * different picture on a 1440p screen and a phone, and because a dolly and a
 * zoom must fold identically. For a perspective camera the projected height of
 * a world unit at depth `d` is `0.5 · viewportHeight · P[1][1] / d`, so this is
 * that expression with the `/ d` left to the shader, which knows each
 * instance's own depth.
 *
 * ⚠️⚠️ AND IT IS DISPLAY-INDEPENDENT (D-5, 2026-09-06). `height` is the DRAWING
 * BUFFER'S, in device pixels — `gl.domElement.height`, never `state.size.height`
 * — but it is divided back to `COHORT_FOLD_REFERENCE_DPR` by the live pixel
 * ratio, so a 2× buffer, and a tier that raises `maxDpr`, fold ONE CSS framing
 * the same way the reference machine does. At or below the reference DPR the
 * factor is 1 and this is byte-identical to the old raw-device-pixel scale, so a
 * 1× display is unchanged. It was the raw device height until 2026-09-06, which
 * made a mark march at the default camera on a 2× buffer and cost the march
 * ×dpr² — a close dolly could then step the down-only tier for the page's life.
 * The tier still changes the DPR, not this reference, so a step can neither fold
 * nor unfold the mark: the invariant the device-pixel scale was chosen for still
 * holds, now on both axes.
 *
 * Pure and exported so the DPR claim can be pinned without a renderer.
 */
export function cohortPxScale(
  drawingBufferHeight: number,
  projection11: number,
  devicePixelRatio = 1,
  referenceDpr = COHORT_FOLD_REFERENCE_DPR,
): number {
  // Divide the device height back to the reference DPR — never inflate a
  // sub-reference display (a mark there is genuinely small), only strip the
  // extra device pixels a high-DPR buffer added. `min(1, ref/dpr)` is exactly 1
  // whenever `dpr ≤ ref`, which is the byte-identical 1× path.
  const foldDpr = Math.min(1, referenceDpr / Math.max(devicePixelRatio, 1e-6));
  return 0.5 * drawingBufferHeight * foldDpr * projection11;
}

/**
 * How many RK4 steps the lens may spend on a ray this frame: the quality tier,
 * unless the knob has been moved off its own default.
 *
 * ⭐⭐ THE TIER OWNS THE PRECISION AND THE KNOB OVERRIDES IT, which is what a
 * tuner needs and what a tier is for. `cohortSteps` ships at
 * `COHORT_LENS_STEPS` — the SAME number the `high` tier carries — so an
 * untouched panel is transparent: whatever the cascade decided is what draws.
 * The moment the slider moves, this layer takes the tuner's number, because a
 * step count that silently snapped back to the tier would have made the live
 * step sweep impossible to run.
 *
 * ⭐ AND THE SWEEP CAME BACK SAYING THE TIER BUYS ALMOST NOTHING. Measured
 * 2026-09-03 on live mainnet at 2560x1440 through ANGLE/Vulkan, with the four
 * step counts interleaved in 1.8 s windows: 96 -> 40 steps moves the lens draw
 * by −4 % to −17 %, everywhere from the app camera to a hole filling the screen,
 * which is inside the ±17 % cross-run noise the app-camera control establishes.
 * The reason is in the program: the march has four early exits, so the cap binds
 * only for the thin annulus of rays that linger near the photon sphere. ⚠️ THIS
 * IS A PRECISION KNOB WITH A SINGLE-DIGIT-PERCENT PRICE, NOT A PERFORMANCE
 * LEVER — the layer's real lever is the pixels the quad covers.
 *
 * ⚠️ The consequence, stated rather than discovered: a tuner who drags the
 * slider back to exactly 96 on a `med` page gets 64. That is the price of
 * having no second piece of state for "has been touched", and it is the right
 * side of the trade — the alternative is a knob that cannot express the tier's
 * own value.
 */
export function cohortStepCount(tierSteps: number, knobSteps: number): number {
  return knobSteps === COHORT_LENS_STEPS ? tierSteps : knobSteps;
}

/**
 * ⭐ THE MOTES FALL A THIRD FASTER THAN THE DISC'S TEXTURE, AND THE KNOB MOVES
 * BOTH TOGETHER. `COHORT_MOTE_K` is 16 where the substance's own back-trace
 * runs at `MIST_SINK_K` 12: a mote is a marker the eye TRACKS over a whole fall
 * and the disc is a field it reads at a glance, so the approved preview pushed
 * the tracked thing harder. Both are rates in wu²/s on one law, so the knob
 * writes the disc's `k` and this ratio times it into the specks' — which keeps
 * the panel's default identical to what the two materials ship with, and keeps
 * a tuner from being able to make the specks disagree with the streamlines they
 * are supposed to be parcels of.
 */
const COHORT_MOTE_K_GAIN = COHORT_MOTE_K / MIST_SINK_K;

/** The colony's own centre, which is where a retired mote slot's seat goes.
 *  It never draws: `writeCohortMotes` zeroes its strength in the same call, and
 *  the program refuses a mote below `COHORT_MOTE_LIVE_STRENGTH`. */
const RETIRED_SEAT = { x: 0, y: 0, z: 0 } as const;

/**
 * Every cohort's mass, and the substance falling into it, in TWO draws off ONE
 * plan.
 *
 * The lens is one instanced camera-facing quad per cohort (`renderOrder` 1,
 * normally blended, so it darkens everything the colony drew before it); the
 * motes are one `THREE.Points` draw for the whole colony (`renderOrder` 2,
 * additive, above the disc whose alpha would otherwise attenuate them). Both
 * take their world extent from uniforms, so per-frame CPU work is a handful of
 * uniform writes.
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
   *  ⭐ It reaches BOTH programs, as the sink's strength: the lens through the
   *  `aShare` lane, the motes through `aStrength` with `mistShareFactor`
   *  already applied. */
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
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const { effective: quality } = useQualityRuntime();
  // ⭐ THE PRECISION IS ALL A TIER MAY TOUCH HERE. Nothing below is gated on it:
  // the mark is drawn at every preset, the motes are drawn at every preset, and
  // the shadow occludes at every preset. A cohort at 40 steps is the same cohort
  // with a coarser photon ring; a cohort that is not drawn is a producer the
  // scene is lying about.
  const tierSteps = QUALITY_PRESETS[quality].cohortLensSteps;
  const plan = useMemo(() => cohortMarks(topology), [topology]);
  const marks = useStableList(plan, sameCohortMark);
  const lensMeshRef = useRef<THREE.InstancedMesh>(null);
  const cappedLogged = useRef(false);
  useEffect(() => {
    if (marks.length < COHORT_MARK_CAP || cappedLogged.current) return;
    cappedLogged.current = true;
    console.warn(
      `ColonyCohorts: >=${COHORT_MARK_CAP} cohorts staged; dropping excess.`,
    );
  }, [marks]);

  // ⚠️⚠️ A UNIT QUAD, AND THE EXTENT RIDES `uQuadR`. The vertex program never
  // reads `position` as world units — it rebuilds the quad from the camera's own
  // axes — and that path is touched by neither `mesh.scale` nor a scaled
  // instance matrix, so a geometry that carried an extent would be a number
  // nothing reads. ⭐ AND A SCALED INSTANCE WOULD MOVE THE QUAD WITHOUT MOVING
  // THE MASS: the trace runs in world space from the instance's origin, so the
  // mark would become a window onto a hole standing somewhere else.
  //
  // ⚠️ It is an `InstancedBufferGeometry` holding a unit plane's own buffers
  // because the four lanes bound onto it are per-INSTANCE: the type is what
  // says so, and `instanceCount` is written beside `mesh.count` below so the
  // `renderers/common` path — which reads the geometry's count in preference to
  // the mesh's — cannot find a different answer. The source plane is never
  // rendered and owns no GL state, so it is dropped rather than disposed.
  const lensGeometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.getIndex());
    for (const [name, attribute] of Object.entries(plane.attributes)) {
      geometry.setAttribute(name, attribute);
    }
    return geometry;
  }, []);
  // ⭐⭐ THE MOTES ARE ALLOCATED FOR THE CAP AND NEVER REBUILT. A `Points`
  // geometry has one vertex per MOTE, so its lanes cannot be the instanced ones
  // and its `aGulp` is a 96-wide COPY — which means a rebuild would drop every
  // live stamp on the floor. Sizing it at `COHORT_MARK_CAP` costs 6,144 vertices
  // whose spare slots draw nothing at all (`aStrength` starts at zero and the
  // program refuses a mote below `COHORT_MOTE_LIVE_STRENGTH`), and buys a buffer
  // that outlives every re-plan.
  const motesGeometry = useMemo(
    () => buildCohortMotesGeometry(COHORT_MARK_CAP),
    [],
  );
  // Memoized on [] (stable for the component's life) so a plan rebuild never
  // forces a shader recompile; disposed on unmount only, for the same reason.
  const lensMaterial = useMemo(() => makeCohortLensMaterial(), []);
  const motesMaterial = useMemo(() => makeCohortMotesMaterial(), []);
  // True per-draw GPU timings when the opt-in render probe owns a timer-query
  // context; a boolean gate otherwise, and no query while no cohort stands (the
  // layer unmounts then anyway). ⭐ TWO LABELS BECAUSE THE TWO DRAWS FAIL
  // DIFFERENTLY: the lens's whole cost is fill × steps — every pixel it covers
  // traces a bent ray — and the motes' is 96 points per cohort with no texture
  // at all. A mean over the pair would hide either one growing.
  const cohortGpuProbes = useMemo(() => ({
    lens: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortLens),
    ),
    motes: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCohortMotes),
    ),
  }), []);
  const capacity = Math.max(1, marks.length);

  // The four per-cohort lanes, allocated once for a capacity and rewritten in
  // place. ⚠️ Wrapping data in a NEW InstancedBufferAttribute is what orphans
  // its GL buffer, and the share walk runs on every attributed block — so the
  // WRAPPER is what has to persist, not just the array. Four wrappers, one per
  // lane, and never one per draw: the wrapper is the identity four uploads by.
  //
  // ⚠️⚠️ `gulp` STARTS AT A FAR-NEGATIVE SENTINEL AND NEVER AT ZERO. The lane
  // holds the SIM SECOND of the block each cohort won, and the envelope is a
  // function of `uTime - aGulp`. A zero-filled lane therefore says "every cohort
  // won at t = 0", and since `uTime` also starts at zero the whole colony gulps
  // for the first half second of every session, for a block none of them mined.
  // R16 shipped exactly that. `COHORT_NEVER_WON` is far enough below any
  // reachable `uTime` that the envelope is identically zero.
  //
  // ⚠️ A CAPACITY CHANGE RESETS IT TO THE SENTINEL, which is correct rather
  // than lossy: the slots behind the marks are not the ones that were written,
  // and a win belongs to a NODE ID and not to a slot. Re-laying live wins into
  // a rebuilt lane is the effect below, off `wonAtRef`.
  //
  // ⚠️⚠️ …AND `mass` STARTS AT ONE AND NEVER AT ZERO, for the mirror-image
  // reason. The lane's magnitude multiplies EVERY length in both cohort
  // programs, so a zero-filled lane is a colony of marks with no extent — and
  // an attribute a geometry has never been given reads as zero in WebGL too.
  // One is the mass of a cohort nothing has been said about, which is the
  // picture this layer drew before the lane existed; the program floors
  // `abs(aMass)` at `COHORT_MASS_GLSL_FLOOR` on top of that, so the two guards
  // are independent.
  const lanes = useMemo(() => {
    const lane = (array: Float32Array) => {
      const attribute = new THREE.InstancedBufferAttribute(array, 1);
      // WebGLAttributes.createBuffer uses bufferData and otherwise leaves the
      // initialization range behind. Clear it after that upload so the first
      // one-cohort lens update is genuinely one instance too.
      attribute.onUpload(() => attribute.clearUpdateRanges());
      return attribute;
    };
    return {
    share: lane(new Float32Array(capacity)),
    seed: lane(new Float32Array(capacity)),
    gulp: lane(new Float32Array(capacity).fill(COHORT_NEVER_WON)),
    mass: lane(new Float32Array(capacity).fill(1)),
    // ⭐ WHERE THE MASS IS GOING, BESIDE WHERE IT IS. The targets are indexed
    // by the same slot as the lane and have to be rebuilt on exactly the same
    // event, so they are built by the same memo — a ref would need its own
    // resize and could be read at the previous capacity's length for the width
    // of a commit. It is a plain array and never an attribute: nothing uploads
    // it, the lane above is what the GPU ever sees.
    massTarget: new Float32Array(capacity).fill(1),
    };
  }, [capacity]);

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
  /** The largest share standing in this colony, and the lens's `uShareMax`.
   *
   *  ⭐ COMPUTED IN THE LANE'S OWN WALK, NOT ONCE A FRAME. The maximum can only
   *  move when the lane's contents do — once per attributed block — so a
   *  per-frame reduction over the marks would be the same number recomputed 60
   *  times a second. Taking it from `cohortShareLane`'s return is also what
   *  makes it impossible for the divisor and the lane to disagree: one walk,
   *  one answer. 1 until the first walk, which is what the uniform ships at. */
  const shareMaxRef = useRef(1);
  /** Each staged cohort's CURRENT size, by graph id — the value the lane holds
   *  while it eases toward `lanes.massTarget`.
   *
   *  ⚠️ THE `wonAtRef` PATTERN, FOR THE `wonAtRef` REASON: a slot index is not
   *  an identity. The lane is indexed by position and the staged set reshuffles
   *  whenever a producer enters or leaves the window, so a size held by slot
   *  would be handed to whoever took the slot — and then eased away over a
   *  second and a half, which is half the colony resizing because one cohort
   *  left. Held in a ref and never in state: this moves on every frame of an
   *  ease and must not re-render the colony.
   *
   *  ⭐ A COHORT WITH NO ENTRY STARTS AT ITS TARGET rather than at 1, which is
   *  what makes an arriving mark appear at its own size instead of growing into
   *  it. The entry is written by the ease below, so "never eased" and "not in
   *  the map" are one state and cannot disagree. */
  const massNowRef = useRef<Map<string, number>>(new Map());
  /** The panel values the targets in `lanes.massTarget` were computed under.
   *
   *  ⚠️ A KNOB THAT MOVED THE ANCHOR OR THE FLOOR MOVES EVERY TARGET AT ONCE,
   *  and the targets are otherwise only recomputed once an attributed block —
   *  so a tuner dragging the floor would see nothing until the next block
   *  landed. Compared per frame rather than pushed, because the panel writes
   *  `LIVE` in place and has no channel to push through. NaN so the first frame
   *  always recomputes, whatever the panel shipped. */
  const massKnobsRef = useRef({
    anchor: Number.NaN,
    floor: Number.NaN,
    hand: Number.NaN,
  });
  /** How many of the motes' cohort slots were last written, so a plan that
   *  SHRANK can retire exactly the tail it dropped. The geometry is allocated
   *  for the cap and never rebuilt, so a slot nobody clears keeps spiralling
   *  specks into a seat no cohort stands at any more. */
  const motesWrittenRef = useRef(0);

  // Placement and identity: written only when the staged cohort set moves.
  useLayoutEffect(() => {
    const lensMesh = lensMeshRef.current;
    if (!lensMesh) return;
    // ⭐ ONE COUNT FROM ONE LIST. A cohort cannot wear a mass without the
    // substance falling into it, whichever way the plan moves.
    lensMesh.count = marks.length;
    // ⚠️ …AND THE GEOMETRY CARRIES THE SAME NUMBER, written here so the two can
    // never disagree. An `InstancedBufferGeometry` ships with
    // `instanceCount = Infinity`; this renderer never reads it (r169's
    // `renderBufferDirect` takes the `isInstancedMesh` branch first and uses
    // `object.count`), but leaving an Infinity on a live object is a trap for
    // the next reader — and for the `renderers/common` path, which reads the
    // geometry's count in preference to the mesh's.
    lensGeometry.instanceCount = marks.length;
    const seed = lanes.seed.array as Float32Array;
    const share = lanes.share.array as Float32Array;
    const mass = lanes.mass.array as Float32Array;
    // ⭐⭐ THE MASS LANE IS RE-LAID FIRST, BECAUSE THE SPECKS READ IT OUT OF IT.
    // A size belongs to a NODE ID and never to a slot (`cohortMassRelay`), so
    // this is the same re-lay `cohortWinLane` does for the gulp below — run
    // before the walk rather than after it only because the motes' 96 copies of
    // the value are written inside that walk, and one number must reach both
    // draws or a cohort's disc and its specks are two different sizes.
    cohortMassRelay(
      marks,
      massNowRef.current,
      lanes.massTarget,
      LIVE.peer.cohortHand,
      mass,
    );
    marks.forEach((mark, index) => {
      // TRANSLATION ONLY — the quad is rebuilt from the camera's axes and takes
      // its extent from `uQuadR`, so a scale here is ignored by the geometry and
      // would move the quad without moving the mass the trace runs around.
      SCRATCH_MATRIX.makeTranslation(mark.pos[0], mark.pos[1], mark.pos[2]);
      lensMesh.setMatrixAt(index, SCRATCH_MATRIX);
      seed[index] = mark.seed;
      // ⭐⭐ THE MOTES TAKE THE SAME SEAT, IN THE SAME FRAME, FROM THE SAME PLAN.
      // `mark.pos` is a COLONY-frame point and `aOrigin` is a colony-frame seat,
      // so a mote's whole track turns with the colony exactly as the disc's
      // streamlines do — the layer applies no rotation of its own anywhere.
      // ⚠️ The strength is `mistShareFactor` ALREADY APPLIED, because this
      // program multiplies it straight into `uK` while the lens runs the same
      // factor in its vertex stage off `aShare`. Same rate, two places, one
      // function.
      // ⚠️ …and the last argument is the specks' copy of the MASS lane, read
      // straight out of the lane the re-lay above just wrote so the two draws
      // cannot be given two different sizes. Never 0 — a strength of zero is
      // how a slot is silenced, and a mass of zero is a mark with no extent at
      // all.
      writeCohortMotes(
        motesGeometry,
        index,
        { x: mark.pos[0], y: mark.pos[1], z: mark.pos[2] },
        mark.seed,
        mistShareFactor(share[index] ?? 0, shareMaxRef.current),
        mass[index],
      );
      // …and its gulp copy is re-laid from the SAME map, so a cohort that moved
      // slots keeps its burst in both draws rather than in one of them.
      stampCohortMotes(
        motesGeometry,
        index,
        wonAtRef.current.get(mark.nodeId) ?? COHORT_NEVER_WON,
      );
    });
    // ⚠️ AND THE TAIL A SHRINKING PLAN LEFT BEHIND IS RETIRED, by strength and
    // not by count: the motes' geometry is sized for the cap and its draw range
    // is the whole buffer, so a cohort that left the window would otherwise keep
    // 96 specks spiralling into the seat it used to stand at.
    // ⚠️ A retired slot still carries a mass of 1 rather than 0: it is written
    // silent by its STRENGTH, and a zero in the mass lane is the one value the
    // program cannot read as an absence.
    for (let index = marks.length; index < motesWrittenRef.current; index += 1) {
      writeCohortMotes(motesGeometry, index, RETIRED_SEAT, 0, 0, 1);
    }
    motesWrittenRef.current = marks.length;
    // …and the GULP lane is RE-LAID under the new plan, in the same walk. A win
    // belongs to a NODE ID and never to a slot: a cohort the plan dropped is
    // gone from `marks` and is written nowhere, one that survived carries its
    // own moment to wherever it now stands, and the slot it used to hold reads
    // `COHORT_NEVER_WON` rather than whatever the cohort before it left there.
    // ⚠️ The re-lay is unconditional because the lane may be BRAND NEW: a
    // capacity change rebuilds it at the sentinel, and the live wins have to be
    // put back into it before the next frame draws.
    cohortWinLane(marks, wonAtRef.current, lanes.gulp.array as Float32Array);
    lensMesh.instanceMatrix.needsUpdate = true;
    lanes.seed.needsUpdate = true;
    markCohortAttributeRange(lanes.gulp, 0, marks.length);
    markCohortAttributeRange(lanes.mass, 0, marks.length);
    // Bound on the first pass and again only when a capacity change built new
    // lanes. The geometry outlives the InstancedMesh (a capacity change rebuilds
    // it through `args`), so it can still be holding the previous set.
    //
    // ⭐ ONE GEOMETRY, SO "THE SAME OBJECT" IS STRUCTURAL. All four lanes are
    // bound to the one quad the lens draws, and the object bound is the wrapper
    // the capacity memo built — never a fresh one around `lanes.<x>.array`,
    // which would be a second GL buffer with the first one orphaned.
    if (lensGeometry.getAttribute('aSeed') !== lanes.seed) {
      lensGeometry.setAttribute('aSeed', lanes.seed);
    }
    if (lensGeometry.getAttribute('aGulp') !== lanes.gulp) {
      lensGeometry.setAttribute('aGulp', lanes.gulp);
    }
    if (lensGeometry.getAttribute('aShare') !== lanes.share) {
      lensGeometry.setAttribute('aShare', lanes.share);
    }
    if (lensGeometry.getAttribute('aMass') !== lanes.mass) {
      lensGeometry.setAttribute('aMass', lanes.mass);
    }
    // Open the submitted prefix only after every attribute for these marks is
    // committed. Keeping this inside the layout effect also avoids mutating a
    // shared Three object from an aborted concurrent render.
    setCohortMotesDrawCount(motesGeometry, marks.length);
  }, [lanes, lensGeometry, marks, motesGeometry]);

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
    const share = lanes.share.array as Float32Array;
    shareMaxRef.current = cohortShareLane(marks, producers, share);
    // Marked ONCE for the whole walk, never once per write.
    lanes.share.needsUpdate = true;
    // ⭐⭐ AND THE WEEK'S TARGETS COME OFF THE SAME STANDINGS, IN THE SAME WALK.
    // The two lanes read DIFFERENT fields of one object — the rate takes
    // whichever window measured a producer, the size takes the seven days alone
    // — so reading them apart would let a frame carry a share from one poll
    // against a week from another. Only the TARGET moves here: the lane itself
    // eases toward it on the frame below, because a ledger arriving or clearing
    // would otherwise pop every mark in the colony at once.
    const knobs = massKnobsRef.current;
    knobs.anchor = LIVE.peer.cohortMassAnchor;
    knobs.floor = LIVE.peer.cohortMassFloor;
    knobs.hand = LIVE.peer.cohortHand;
    cohortMassLane(marks, producers, knobs.anchor, knobs.floor, lanes.massTarget);
    const mass = lanes.mass.array as Float32Array;
    // ⭐⭐ AND THE SPECKS ARE RE-LAID ON THE SAME WALK, because their strength is
    // this same share with `mistShareFactor` already applied — the motes cannot
    // read the instanced lane (their geometry is one vertex per mote, so the
    // value has to be 96 copies wide), so what keeps the two in step is that the
    // one walk writes both. A cohort whose share moved falls faster in the same
    // frame its streamlines speed up.
    marks.forEach((mark, index) => {
      writeCohortMotes(
        motesGeometry,
        index,
        { x: mark.pos[0], y: mark.pos[1], z: mark.pos[2] },
        mark.seed,
        mistShareFactor(share[index] ?? 0, shareMaxRef.current),
        mass[index],
      );
    });
    writtenSharesRef.current = producers;
  }, [lanes, marks, motesGeometry]);
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

  // THE EASE: every cohort's size walking toward the week's answer, on the RAW
  // frame beside the poll above — and a SECOND callback rather than a second
  // half of that one, because that one's whole shape is a single early return
  // on an identity test and a size that moved has nothing to do with a window
  // that did not.
  //
  // ⭐⭐ THE EASE EXISTS FOR TWO EVENTS AND NOT FOR A DRIFT. A week share
  // moving by a tenth of a percent per 120-second refresh is invisible with or
  // without it. What it is for is the ledger ARRIVING after the cohorts are
  // already standing (a boot whose window fills before the first fetch returns)
  // and the ledger CLEARING (a ckbadger outage, where every mass returns to 1):
  // both are every mark in the colony changing size in one frame, which is the
  // pop the dolly strip has been measured never to make.
  //
  // ⚠️ WALL `dt`, AND IT RUNS UNDER A PAUSE. `useSimFrame` skips entirely while
  // time is paused and the sim clock freezes with it; a ledger that cleared
  // during a pause would then hold the old sizes until the clock ran again. The
  // step is clamped because a backgrounded tab hands over whole seconds on its
  // first frame back, and it is clamped with comparisons rather than
  // `Math.min`, so a NaN takes 0 instead of propagating into the lane.
  useFrame((_, dt) => {
    const anchor = LIVE.peer.cohortMassAnchor;
    const floor = LIVE.peer.cohortMassFloor;
    const handKnob = LIVE.peer.cohortHand;
    const knobs = massKnobsRef.current;
    if (anchor !== knobs.anchor || floor !== knobs.floor || handKnob !== knobs.hand) {
      knobs.anchor = anchor;
      knobs.floor = floor;
      knobs.hand = handKnob;
      // ⚠️ THE KNOB GOES THROUGH THE TARGETS AND NEVER STRAIGHT INTO THE LANE,
      // which is what makes `cohortMassFloor` 1 — the OFF switch, and the live
      // leg's whole A/B — a second-and-a-half ease rather than a colony-wide
      // pop. Recomputed from the standings the lane was LAST WRITTEN under, so
      // a knob and a block cannot disagree about which week is being read. (The
      // hand moves no target; it rides the same compare because it is packed
      // into the same lane, and seven floats is not worth a second gate.)
      cohortMassLane(marks, writtenSharesRef.current, anchor, floor, lanes.massTarget);
    }
    const step = dt > 0.1 ? 0.1 : dt > 0 ? dt : 0;
    const target = lanes.massTarget;
    const mass = lanes.mass.array as Float32Array;
    const now = massNowRef.current;
    let moved = false;
    // A plain loop and no closure: this runs on every frame of the tab's life,
    // and `forEach` would allocate one per frame for a walk over seven marks.
    for (let index = 0; index < marks.length; index += 1) {
      const mark = marks[index];
      const current = now.get(mark.nodeId);
      const eased = cohortMassApproach(
        current ?? target[index],
        target[index],
        step,
        COHORT_MASS_SLEW_S,
      );
      // Exact at the target and exact at `dt = 0`, so a converged colony stops
      // touching the map as well as the lane.
      if (eased !== current) now.set(mark.nodeId, eased);
      const value = cohortMassLaneValue(eased, cohortHandLane(mark.seed, handKnob));
      // ⚠️⚠️ THE GATE IS THE WHOLE DIFFERENCE BETWEEN AN EASE AND AN UPLOAD A
      // FRAME FOR THE LIFE OF THE TAB. Nothing moved ⇒ nothing is written and
      // neither buffer is flagged: 6,144 mote floats plus the lane, sixty times
      // a second, for a number that changes twice a session. The comparison is
      // against the LANE rather than against a written-yet flag, so a slot the
      // ease has never touched — a rebuilt lane, a new capacity — is written by
      // the same line that writes a slot that moved.
      if (Math.abs(mass[index] - value) <= 1e-4) continue;
      mass[index] = value;
      writeCohortMotesMass(motesGeometry, index, value);
      moved = true;
    }
    // Flagged ONCE for the whole walk, and only when something moved.
    if (moved) {
      // The ease commonly moves every visible cohort, but never uploads the
      // unused capacity behind the visible prefix.
      markCohortAttributeRange(lanes.mass, 0, marks.length);
    }
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
    markCohortAttributeRange(lanes.gulp, index, 1);
    // …and the SAME moment goes into that cohort's 96 mote slots, beside the
    // lane write, because a Points geometry cannot share the instanced wrapper.
    // Same value, widened; one call, so there is no path where the disc piles
    // and the specks do not.
    stampCohortMotes(motesGeometry, index, at);
    // entryId + backfillActive are read from the latest closure when
    // blockPulseAtMs advances (App recomputes cf + backfill + bumps
    // blockPulseAtMs from the same cells-cache render), so [blockPulseAtMs]
    // suffices — the gate every other layer in this colony keeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  useEffect(() => () => {
    lensGeometry.dispose();
    motesGeometry.dispose();
    lensMaterial.dispose();
    motesMaterial.dispose();
  }, [lensGeometry, lensMaterial, motesGeometry, motesMaterial]);

  /** The warmth the colour uniforms were last built at. ⭐ THE WARM LERP IS
   *  CPU-SIDE AND PER-DRAW, so it is recomputed only when the knob moves —
   *  three `THREE.Color`s and a mote colour rebuilt 60 times a second for a
   *  number that changes when a hand drags a slider would be the one piece of
   *  per-frame allocation in this layer. */
  const warmthRef = useRef(Number.NaN);

  useSimFrame(() => {
    const contextEnergy = contextEnergyRef?.current ?? 1;
    const elapsed = simClock.elapsedSec;
    // ⭐⭐⭐ ONE NUMBER FOLDS BOTH DRAWS, written from the DRAWING BUFFER but
    // normalised to the reference DPR — never from the CSS size — see
    // `cohortPxScale`. Each program divides it by its own distance to the
    // camera, so the mass, the disc, the shadow's opacity, the specks' birth
    // radius and their brightness all fold on one closeness and nothing can
    // unfold on its own schedule — nor on the physical DPR.
    const pxScale = cohortPxScale(
      gl.domElement.height,
      camera.projectionMatrix.elements[5],
      gl.getPixelRatio(),
    );
    // ⭐⭐ THE MASS IS THE SIZE PARAMETER, AND EVERY RADIUS IS A MULTIPLE OF IT.
    // Read once and written three times: the horizon itself, the disc's inner
    // edge (3 horizons — the ISCO) and the radius a mote disappears at (2.6
    // horizons — the shadow's apparent edge). A knob that moved one without the
    // others would open the shadow out through its own accretion disc, or leave
    // the specks winking out on the silhouette instead of behind it.
    const horizon = LIVE.peer.cohortHorizon;
    // The near end of the fold's band, shared so the disc and the specks unfold
    // together. (The far end is not a knob: it is where a cohort becomes a
    // peer-sized smudge, which is the layer's own rule and not a taste.)
    const unfoldHi = LIVE.peer.cohortUnfold;
    // The substance's own two numbers, and they reach both draws — see
    // `COHORT_MOTE_K_GAIN` for why the specks take a multiple of the first.
    const sinkK = LIVE.peer.cohortIntake;
    const swirl = LIVE.peer.cohortSwirl;
    const lens = lensMaterial.uniforms;
    lens.uTime.value = elapsed;
    lens.uContextEnergy.value = contextEnergy;
    lens.uPxScale.value = pxScale;
    lens.uUnfoldHi.value = unfoldHi;
    lens.uHorizon.value = horizon;
    lens.uDiscIn.value = cohortDiscInner(horizon);
    lens.uDiscOut.value = LIVE.peer.cohortDiscOut;
    lens.uDiscAmp.value = LIVE.peer.cohortDiscAmp;
    lens.uBeam.value = LIVE.peer.cohortBeam;
    lens.uFarDiscAmp.value = LIVE.peer.cohortFarAmp;
    // The far form's own three: how fast it dies with radius, the arms'
    // contrast and their extra winding — facts about the substance as the app
    // camera sees it.
    lens.uFarDiscPow.value = LIVE.peer.cohortFarFall;
    lens.uFarStreak.value = LIVE.peer.cohortFarStreak;
    lens.uFarSwirl.value = LIVE.peer.cohortFarSwirl;
    lens.uGlow.value = LIVE.peer.cohortGlow;
    lens.uK.value = sinkK;
    lens.uSwirl.value = swirl;
    // ⭐⭐ THE MAXIMUM IS THE ONE THIS LAYER OWNS. The factor is a RATIO —
    // `mix(floor, 1, share / shareMax)` — so the divisor has to be the largest
    // share among the instances actually drawn, which only the lane's own walk
    // can know. It is read from the ref that walk fills rather than reduced
    // again here: the maximum moves once an attributed block, not once a frame.
    lens.uShareMax.value = shareMaxRef.current;
    // The tier decides, unless the knob has been moved off it — see
    // `cohortStepCount`.
    lens.uSteps.value = cohortStepCount(tierSteps, LIVE.peer.cohortSteps);
    const motes = motesMaterial.uniforms;
    motes.uTime.value = elapsed;
    motes.uContextEnergy.value = contextEnergy;
    motes.uPxScale.value = pxScale;
    // A world diameter projected the way every other point in this scene is, so
    // it needs the live drawing buffer: a window resize or a quality-tier DPR
    // change moves it under the material.
    motes.uViewportHeight.value = gl.domElement.height;
    motes.uUnfoldHi.value = unfoldHi;
    motes.uShadowR.value = cohortShadowRadius(horizon);
    motes.uK.value = sinkK * COHORT_MOTE_K_GAIN;
    motes.uSwirl.value = swirl;
    motes.uOrbit.value = LIVE.peer.cohortOrbit;
    motes.uAmp.value = LIVE.peer.cohortMotes;
    const warmth = LIVE.peer.cohortWarmth;
    if (warmth !== warmthRef.current) {
      warmthRef.current = warmth;
      // ⭐ ONE RAMP, TWO DRAWS. The specks wear the disc's own mid stop pushed
      // toward its core, so a viewer dragging the temperature moves the vortex
      // and the parcels falling through it together — they are one substance at
      // one temperature, and two colour ramps would be two.
      const stops = cohortDiscStops(warmth);
      lens.uColCore.value.setRGB(...stops.core);
      lens.uColMid.value.setRGB(...stops.mid);
      lens.uColOuter.value.setRGB(...stops.outer);
      motes.uColor.value.setRGB(...cohortMoteColor(warmth));
    }
  });

  // ⭐ NO COHORTS ⇒ NO DRAW, NOT AN EMPTY ONE. Every hook above still runs, so
  // the buffers are ready the instant one appears — but nothing enters the
  // scene graph, and a material that is never rendered is never COMPILED. A
  // devnet nobody mines and a review lab that passes no window carry an empty
  // vertex program otherwise, for the whole life of the scene. Same rule the
  // colony's own tier keeps for a stop with nobody standing at it.
  if (marks.length === 0) return null;

  // ⚠️ Never a pick target. The cohort's target is the staged node's own hit
  // sphere, sized from the SHADOW in `ColonyNodes` (`COHORT_HIT_RADIUS`, 2.0
  // wu). A live raycast on the lens's quad — 64 world units across, and
  // overlapping its neighbours' — would put a wall of invisible target in front
  // of the colony.
  //
  // ⚠️⚠️ THE RENDER ORDERS ARE THE DESIGN AND NOT A COMPOSITION PREFERENCE. The
  // lens is the colony's ONLY normally-blended draw, because a shadow is a place
  // where light is REMOVED and an additive draw can only fail to add — so it
  // occludes by DRAW ORDER, darkening what came before it and nothing after. 1
  // puts it strictly above the edges and the nodes (both 0), which is what makes
  // the occlusion deterministic: three sorts EQUAL render orders by depth, and
  // each of those layers is one draw with one z for the whole colony, so a tie
  // would let the ghost cloud shine through the shadow whenever its centre sat
  // nearer than a cohort. 2 puts the specks above the disc, whose alpha reaches
  // 0.85 exactly where they are brightest.
  return (
    <group>
      <instancedMesh
        ref={lensMeshRef}
        args={[lensGeometry, lensMaterial, capacity]}
        {...cohortGpuProbes.lens}
        frustumCulled={false}
        renderOrder={1}
        raycast={() => null}
      />
      {/* ⚠️ `frustumCulled` IS FALSE FOR A REASON THE BOUND CANNOT KNOW: three
          computes it from `position`, which holds the SEATS, and the vertex
          program then moves every speck up to 27 world units away from its own.
          A culled draw would take a cohort's whole intake off screen while the
          cohort itself was still in it. */}
      <points
        geometry={motesGeometry}
        material={motesMaterial}
        {...cohortGpuProbes.motes}
        frustumCulled={false}
        renderOrder={2}
        raycast={() => null}
      />
    </group>
  );
}
