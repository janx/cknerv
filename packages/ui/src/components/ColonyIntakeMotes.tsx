// ColonyIntakeMotes — what a mining node draws IN.
//
// A soft mote slides along each of a miner's own links, from the far end
// inward, and is swallowed at the node; continuously, on every incident link,
// for as long as that node is in the chain's recent window. That is the shape
// of the thing being drawn: transactions arrive over exactly these links, the
// miner aggregates them, and what leaves is a block.
//
// The whole design argument — why motion, why a line and never a sprite, and
// the six ways this is not a courier glint — lives on `makeColonyIntakeMaterial`
// in `materials/colonyIntakeMotes`. Read it before touching either.
//
// This file owns the three things that cannot live in a material:
//   • WHICH links carry a stream — `colonyIntakeSegments`, pure and exported,
//     one segment per (link, miner) pair with the vertex order baked so
//     direction is a property of the buffer rather than a sign in a shader;
//   • the live SHARE, which moves on every attributed block and must never be
//     allowed to move the geometry with it;
//   • the per-block win, stamped from the flood's own entry node.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { fnv1a } from '../geometry/edgeBezier';
import type { NetworkTopology, Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import type { ProducerStanding } from '../derives/blockProducers.derive';
import { ATTESTED_ID_PREFIX } from '../derives/networkTopology.derive';
import {
  COLONY_INTAKE_UNFIRED,
  makeColonyIntakeMaterial,
} from '../materials/colonyIntakeMotes';
import { useStableList } from './ColonyNodes';

/** Ceiling on the streams this layer will draw at once.
 *
 *  ⚠️ A SAFETY VALVE AND NOT A BUDGET. The count is already bounded twice over
 *  — the colony holds a few hundred links and a window holds a handful of
 *  distinct payout identities — so nothing on a real chain comes near this. It
 *  is here because "a few" is a fact about today's mainnet rather than a
 *  property of the wire, and a layer whose geometry is sized from upstream data
 *  should say out loud where it stops. The excess is dropped deterministically
 *  (the tail of the link list) and warned once, the same shape
 *  `ColonyCourierLayer` gives its pool. */
export const COLONY_INTAKE_SEGMENT_CAP = 256;

/** One stream: a mote's whole journey, from where it is born to the node that
 *  swallows it. */
export interface IntakeSegment {
  /** The payout key of the miner this stream feeds. The live share is looked
   *  up by it, and the per-block win is stamped by it. */
  readonly producerKey: string;
  /** The miner's graph id — the `to` end of this segment. */
  readonly nodeId: string;
  /** The graph id of the far end. Identity only: it is what makes two plans
   *  comparable across a rebuild that did not move anything. */
  readonly fromId: string;
  /** Where the mote is born: the far end of a real link of this colony. */
  readonly from: Vec3;
  /** Where it is swallowed: the miner's own node. */
  readonly to: Vec3;
  /** Link length in world units. The mote's speed and width are both world
   *  quantities, so this is what converts them into the link's own parameter. */
  readonly length: number;
  /** Per-segment de-sync in [0,1), a stable hash of the two ends. Without it
   *  every link of a miner would deliver on the same beat and the stream would
   *  read as one synchronised pulse rather than as feeding. */
  readonly phase: number;
}

/**
 * Every intake stream in a colony, from the topology and nothing else.
 *
 * ⭐⭐ IT TAKES NO STANDINGS, AND THAT IS WHAT KEEPS THE GEOMETRY STILL. A
 * miner's blocks and share move on EVERY block while its key, its placement and
 * its links do not. A plan that read the window would rebuild this layer's
 * buffers once a block — and a buffer rebuilt mid-flight takes the `aFireAt`
 * lane with it, which is exactly how the colony's edge surge learned to
 * truncate its own wavefront. So the plan is a pure function of the staged
 * colony, the share rides a lane written in place, and the two cadences never
 * meet. Same split `producerRingInstances` was taught and `selectedSighted`
 * has always kept: the node is identity and placement, the view is the window.
 *
 * ⭐ ONE SEGMENT PER (LINK, MINER), so a link between two miners feeds both.
 * That is not a degenerate case handled grudgingly — it is true, and the
 * alternative (pick one) would silently starve whichever end lost a tie-break.
 *
 * ⚠️ THE LINKS ARE THE COLONY'S OWN, INCLUDING THE INVENTED ONES. Every edge
 * touching an attested node is inferred fiction: a crawler tells us a node
 * exists and never who it talks to, and the chain attests that something made a
 * block and never who it talks to either. The stream is drawn on them because
 * it is drawn on whatever this scene believes the links to be, and this scene
 * has never claimed those are measured.
 */
export function colonyIntakeSegments(
  topology: NetworkTopology,
  cap: number = COLONY_INTAKE_SEGMENT_CAP,
): IntakeSegment[] {
  const miners = new Map<string, Vec3>();
  for (const node of topology.nodes) {
    if (node.kind === 'attested') miners.set(node.id, node.pos);
  }
  if (miners.size === 0) return [];
  const posById = new Map<string, Vec3>();
  for (const node of topology.nodes) posById.set(node.id, node.pos);

  const out: IntakeSegment[] = [];
  // Walked in EDGE ORDER, never in producer order: the standings reorder
  // whenever one miner overtakes another, and a plan that followed them would
  // renumber every segment — and rebuild every buffer — for a swap that moved
  // nothing on screen.
  for (const edge of topology.edges) {
    for (const [nodeId, fromId] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const to = miners.get(nodeId);
      if (to === undefined) continue;
      const from = posById.get(fromId);
      if (from === undefined) continue;
      if (out.length >= cap) return out;
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      // A zero-length link would divide the mote's width by nothing. It cannot
      // happen (the scatter enforces a minimum spacing and an edge never joins
      // a node to itself), which is the only reason a guard rather than a
      // clamp is enough.
      if (!(length > 0)) continue;
      out.push({
        producerKey: nodeId.slice(ATTESTED_ID_PREFIX.length),
        nodeId,
        fromId,
        from,
        to,
        length,
        phase: (fnv1a(`${fromId}|${nodeId}`) >>> 0) / 4294967296,
      });
    }
  }
  return out;
}

/** Same point, by value. The scaffold hands back cached node objects and would
 *  compare by reference, but `stageAttested` builds a fresh node — and a fresh
 *  `pos` array — on every call, so a reference test would report every miner as
 *  having moved on every poll. */
function samePoint(a: Vec3, b: Vec3): boolean {
  return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

/** Whether two plans describe the same streams. The colony rebuilds its
 *  topology on every peer poll, and a measured ping moves nothing an intake
 *  stream is drawn from — so the buffers are held across those rebuilds rather
 *  than deleted and re-uploaded, exactly as the point clouds are held.
 *
 *  ⚠️ IT COMPARES THE ENDS' POSITIONS AND NOT ONLY THEIR IDS, which is the same
 *  trap the ghost cloud names on its own held list: a RESEED keeps every
 *  `inf:n` id while moving every point, so an id-only test would report a
 *  colony that had entirely rearranged itself as unchanged and leave these
 *  lines hanging in the space the old one used to occupy. Every position here
 *  is a pure hash of the id under a seed, so a value test costs six comparisons
 *  and is exact in both directions. */
export function sameIntakeSegment(a: IntakeSegment, b: IntakeSegment): boolean {
  return a.nodeId === b.nodeId && a.fromId === b.fromId
    && samePoint(a.from, b.from) && samePoint(a.to, b.to);
}

/**
 * Every miner's intake, in ONE additive `lineSegments` draw over the miner's
 * own links.
 *
 * Nothing here runs per frame but seven uniform writes: the motes are a
 * function of `uTime` and the buffers, so the CPU is idle between blocks no
 * matter how many streams are on screen. That is the other half of why this is
 * a line layer and not a sprite pool — a pool of continuously flying motes
 * would be a per-frame walk for the whole idle life of the scene.
 */
export default function ColonyIntakeMotes({
  topology,
  producers,
  cf,
  blockPulseAtMs,
  backfillActive = false,
  contextEnergyRef,
}: {
  topology: NetworkTopology;
  /** ⭐⭐ THE LIVE WINDOW, and the only thing here allowed to say how fast a
   *  miner pulls. The staged node carries the standing it had at the last
   *  KEY-SET change, because that is what the topology memo is keyed on and it
   *  must be. So the node is identity and placement; this is the share.
   *  Optional: a scene with no miners, a devnet that has not mined and a caller
   *  that never learned about miners are one code path. */
  producers?: readonly ProducerStanding[] | null;
  cf: ColonyFlood;
  /** Increments on each new block; the spent stamp is armed off this. */
  blockPulseAtMs: number;
  /** Calm catch-up: consume-then-bail so no backlog replays as one strobe. */
  backfillActive?: boolean;
  contextEnergyRef?: { readonly current: number };
}) {
  const simClock = useSimClock();
  const plan = useMemo(() => colonyIntakeSegments(topology), [topology]);
  const segments = useStableList(plan, sameIntakeSegment);
  const cappedLogged = useRef(false);
  useEffect(() => {
    if (segments.length < COLONY_INTAKE_SEGMENT_CAP || cappedLogged.current) return;
    cappedLogged.current = true;
    console.warn(
      `ColonyIntakeMotes: >=${COLONY_INTAKE_SEGMENT_CAP} intake streams; dropping excess.`,
    );
  }, [segments]);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(segments.length * 6);
    // Per-vertex; segment i → verts 2i (the far end) and 2i+1 (the miner).
    const param = new Float32Array(segments.length * 2);
    const invLen = new Float32Array(segments.length * 2);
    const phase = new Float32Array(segments.length * 2);
    // The live lanes, seeded so a frame drawn before either has been written is
    // a stream running at the floor rate and never one that has just fired.
    const share = new Float32Array(segments.length * 2);
    const fireAt = new Float32Array(segments.length * 2).fill(COLONY_INTAKE_UNFIRED);
    segments.forEach((seg, i) => {
      pos.set([seg.from[0], seg.from[1], seg.from[2], seg.to[0], seg.to[1], seg.to[2]], i * 6);
      // ⭐ DIRECTION IS THE VERTEX ORDER. 0 is where the mote is born, 1 is the
      // node that swallows it, and the shader only ever travels 0 → 1 — so
      // there is no sign, no branch, and no way to draw a mote going out.
      param[2 * i] = 0;
      param[2 * i + 1] = 1;
      const inv = 1 / seg.length;
      invLen[2 * i] = inv;
      invLen[2 * i + 1] = inv;
      phase[2 * i] = seg.phase;
      phase[2 * i + 1] = seg.phase;
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aParam', new THREE.BufferAttribute(param, 1));
    g.setAttribute('aInvLen', new THREE.BufferAttribute(invLen, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aShare', new THREE.BufferAttribute(share, 1));
    g.setAttribute('aFireAt', new THREE.BufferAttribute(fireAt, 1));
    return g;
  }, [segments]);

  // Memoized on [] (stable for the component's life) so a plan rebuild never
  // forces a shader recompile; disposed on unmount only, for the same reason.
  const mat = useMemo(() => makeColonyIntakeMaterial(), []);

  // The live share, written in place whenever the window moves — which is once
  // per attributed block, and never touches the geometry.
  useEffect(() => {
    const shareByKey = new Map<string, number>();
    for (const producer of producers ?? []) shareByKey.set(producer.key, producer.share);
    const attr = geom.getAttribute('aShare') as THREE.BufferAttribute;
    const lane = attr.array as Float32Array;
    segments.forEach((seg, i) => {
      // A miner the view has dropped keeps a stream at the floor rate rather
      // than stopping: its node is still standing, and a stream that stopped
      // would say the machine had. The next topology rebuild retires both.
      const value = shareByKey.get(seg.producerKey) ?? 0;
      lane[2 * i] = value;
      lane[2 * i + 1] = value;
    });
    attr.needsUpdate = true;
  }, [geom, producers, segments]);

  // Per block: the miner the flood is entering through — which is the miner the
  // chain named on this block, or nobody — has its stream go dark. `t0` is
  // captured HERE, in this owner's own effect, the way every per-block armer in
  // the colony captures its own: simClock is constant across React's effect
  // flush, so the stamps are synced without a parent ref a child could read
  // before it was written.
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    // Consume while backfilling so a historical backlog cannot replay as one
    // strobe of spent streams when live mode resumes.
    lastPulseRef.current = blockPulseAtMs;
    if (backfillActive) return;
    // ⭐ THE WINNER IS THE FLOOD'S OWN ENTRY NODE, not a second lookup. The
    // flood already resolved this block's producer key against the staged
    // colony, and asking that question twice is how this layer and the wave
    // would come to disagree about which block it was. An anonymous block
    // enters through a ghost and no stream is spent — which is the truth:
    // nobody we can name won it.
    if (cf.entryId === null || !cf.entryId.startsWith(ATTESTED_ID_PREFIX)) return;
    const winner = cf.entryId;
    const t0 = simClock.elapsedSec;
    const attr = geom.getAttribute('aFireAt') as THREE.BufferAttribute;
    const lane = attr.array as Float32Array;
    let stamped = false;
    segments.forEach((seg, i) => {
      if (seg.nodeId !== winner) return;
      lane[2 * i] = t0;
      lane[2 * i + 1] = t0;
      stamped = true;
    });
    // Marked ONCE for the whole walk, and only if the walk wrote anything.
    if (stamped) attr.needsUpdate = true;
    // cf/backfillActive/segments are recomputed in the same render that
    // advances blockPulseAtMs; use the pulse as the sole event edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);

  useSimFrame(() => {
    mat.uniforms.uTime.value = simClock.elapsedSec;
    mat.uniforms.uContextEnergy.value = contextEnergyRef?.current ?? 1;
    mat.uniforms.uAmp.value = LIVE.peer.intakeAmp;
    mat.uniforms.uSpeed.value = LIVE.peer.intakeSpeed;
    mat.uniforms.uWidth.value = LIVE.peer.intakeWidth;
    mat.uniforms.uEase.value = LIVE.peer.intakeEase;
    mat.uniforms.uSpentS.value = LIVE.peer.intakeSpentS;
  });

  // ⭐ NO MINERS ⇒ NO DRAW, NOT AN EMPTY ONE. Every hook above still runs, so
  // the buffers are ready the instant one appears — but nothing enters the
  // scene graph, and a material that is never rendered is never COMPILED. A
  // devnet nobody mines and a review lab that passes no window carry an empty
  // vertex program otherwise, for the whole life of the scene. Same rule the
  // colony's own tier keeps for a stop with nobody standing at it.
  if (segments.length === 0) return null;

  // ⚠️ Never a pick target. The stream is a mark on a link and the thing it is
  // about is the node at its end, which stands its own hit sphere; a live
  // raycast here would put a hundred invisible lines in front of the colony.
  return (
    <lineSegments
      geometry={geom}
      material={mat}
      frustumCulled={false}
      raycast={() => null}
    />
  );
}
