// ColonyCourierLayer — a faint GLINT accent riding the block wavefront. The primary
// block signal is now ColonyEdges' surge (a bright band flowing along the links); on
// top of it, a small dimmed glow-mote + short streak is flung node→node outward from
// the flood origin along the shortest-path tree (colonyCourierSchedule), timed by the
// flood arrivals — a spark tracing the surge, not a glaring projectile. Its motion is
// adapted from the retired hub-and-spoke BlockCourierLayer:
//   • straight easeOutCubic fling (fast off the launch, coasts to rest);
//   • a velocity-aligned protocol trace (length ∝ analytic speed) billboarded
//     around the flight axis, with a compact bloom as the sampled packet HEAD
//     (no solid body rides along — the mote is pure glow);
//   • driven each frame off an age-clock (age = simClock.elapsedSec − pulse.at)
//     that this layer stamps ITSELF on each blockPulseAtMs increase.
//
// Unlike the old one-object-per-peer registry (which doesn't scale to the colony's
// ~277 tree edges), this writes a FIXED COURIER_POOL into two GPU instance batches:
// one draw for every plume and one for every packet head. Only a few dozen hops
// fly at once, so 64 is ample; a burst beyond it drops the excess (warned once)
// rather than growing the buffers or draw-call count.
//
// Backfill quiescence: like NetworkColony's delivery pulse, we CONSUME a pulse
// that advances mid-backfill (advance lastPulseRef) but do NOT stamp the age
// clock — so no courier strobe replays when a large restore gap clears.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RootState } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { LIVE } from '../tweaks/liveTweaks';
import { colonyFrame } from '../tweaks/colonyFrame';
import type { Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import {
  colonyCourierSchedule,
  courierScheduleHorizon,
} from '../derives/colonyCourier.derive';
import { easeOutCubic } from '../derives/peers.derive';
import { makeCourierPlumeTexture, makeCourierBloomTexture } from '../materials/courierFlameTexture';
import {
  courierEdgeEase,
  courierHopSpeed,
  courierPlumeLength,
  writeCourierMote,
  writeCourierPlume,
} from './courierGlyph';
import {
  consensusBlockColor,
  type ConsensusFlowColor,
} from '../derives/consensusFlow.derive';
import { colonyStats } from '../derives/colonyStats';
import { PEER_NETWORK_PALETTE } from '../visualPalette';
import { PERFORMANCE_PROBE_LABELS } from '../tweaks/performanceProbeStore';
import { createGpuProbeCallbacks } from '../tweaks/gpuTimerQuery';
import { createNonEmptyDrawGpuProbeCallbacks } from '../tweaks/nonEmptyGpuProbeCallbacks';

/** Fixed courier pool. The tree has ~277 hops but only dozens are ever in flight
 *  at once (each visible for ≥ MIN_THROW_S of the ~2s flood); 64 covers the
 *  concurrency with headroom. Bursts beyond it are dropped (warned once). */
const COURIER_POOL = 64;
/** Shortest tree edges give arriveAge − launchAge ≈ 0; render each hop over at
 *  least this long so it actually reads as a throw. */
const MIN_THROW_S = 0.25;

// Glint tuning. The courier is a FAINT accent riding the edge surge (which is
// the primary block signal), so the mote + its short streak are small and dim —
// no longer a bright thrown comet. The trace is a velocity-aligned quad whose
// length tracks the courier's analytic speed; the bloom is a compact packet
// sample. The form itself (mote billboard, plume basis, end ease, speed
// stretch) is courierGlyph.ts — shared with the block's last hop.
export interface ColonyCourierLayerProps {
  /** The block flood (shortest-path tree + arrivals). */
  cf: ColonyFlood;
  /** ALL colony node id → world position (the courier hops inferred nodes too). */
  posById: Map<string, Vec3>;
  /** Increments on each new block; the layer stamps its own age clock off this. */
  blockPulseAtMs: number;
  /** Calm catch-up: consume-then-bail so no courier strobe replays post-backfill. */
  backfillActive: boolean;
}

// Scratch objects reused every frame (no per-frame allocation in the hot loop).
const _dir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _position = new THREE.Vector3();

/**
 * The new-block broadcast wave. One layer owns every courier: a glow-mote head
 * (packet-bloom sprite) + a velocity-aligned protocol trace, flung straight
 * from each node's flood predecessor to it and eased with easeOutCubic. Driven
 * each frame from colonyCourierSchedule + this layer's own pulse age clock.
 */
export default function ColonyCourierLayer({
  cf,
  posById,
  blockPulseAtMs,
  backfillActive,
}: ColonyCourierLayerProps) {
  const simClock = useSimClock();
  // The node→node throws for this block's tree. Pure; recomputed only when the
  // flood (new block / new origin) or the positions (topology) change.
  const schedule = useMemo(() => {
    // Counted where it is paid: a topology rebuild or a block re-plans every
    // hop of the tree (`colonyStats`).
    colonyStats.observeCourierSchedule();
    return colonyCourierSchedule(cf, posById);
  }, [cf, posById]);
  const scheduleHorizon = useMemo(() => courierScheduleHorizon(schedule), [schedule]);

  // Two fixed GPU batches replace 128 independently submitted scene objects.
  // Per-hop semantics still live in the matrices written below.
  const plumeMesh = useRef<THREE.InstancedMesh>(null);
  const bloomMesh = useRef<THREE.InstancedMesh>(null);
  const cappedLogged = useRef(false);

  // Own age clock: stamp { at } on each blockPulseAtMs increase, gated by backfill
  // (consume-then-bail — mirrors NetworkColony's delivery pulse). Null = no active
  // block (all couriers hidden).
  const pulseRef = useRef<{ at: number; color: ConsensusFlowColor } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs; // consume even while backfilling…
    if (backfillActive) return; //           …but don't stamp → no courier flood
    pulseRef.current = {
      at: simClock.elapsedSec,
      color: consensusBlockColor(blockPulseAtMs),
    };
    // backfillActive is read from the latest closure when blockPulseAtMs advances
    // (App recomputes cf + backfill + bumps blockPulseAtMs from the same cells-
    // cache render), so [blockPulseAtMs] suffices — matching NetworkColony's pulse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPulseAtMs]);

  // Shared flame resources (one texture / material / geometry for the whole pool).
  const plumeTex = useMemo(() => makeCourierPlumeTexture(), []);
  const bloomTex = useMemo(() => makeCourierBloomTexture(), []);
  const plumeGeom = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, -0.5, 0); // nozzle edge at the origin; plume trails toward −Y
    return g;
  }, []);
  const bloomGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const plumeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: plumeTex,
        color: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
        transparent: true,
        opacity: 0.3, // zero-drift default; live via LIVE.peer.glintPlumeOpacity per-frame
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [plumeTex],
  );
  const bloomMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: bloomTex,
        color: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
        transparent: true,
        opacity: 0.55, // zero-drift default; live via LIVE.peer.glintBloomOpacity per-frame
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [bloomTex],
  );
  // True per-draw GPU timings for the two instanced batches when the opt-in
  // render probe owns a timer-query context; a boolean gate otherwise, and no
  // query while no courier is in flight (the batches count zero then).
  const courierGpuProbes = useMemo(() => ({
    plume: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCourierPlume),
    ),
    bloom: createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.colonyCourierBloom),
    ),
  }), []);

  useLayoutEffect(() => {
    const plume = plumeMesh.current;
    const bloom = bloomMesh.current;
    if (!plume || !bloom) return;
    plume.count = 0;
    bloom.count = 0;
    plume.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bloom.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, []);

  useEffect(
    () => () => {
      plumeTex.dispose();
      bloomTex.dispose();
      plumeGeom.dispose();
      bloomGeom.dispose();
      plumeMat.dispose();
      bloomMat.dispose();
    },
    [plumeTex, bloomTex, plumeGeom, bloomGeom, plumeMat, bloomMat],
  );

  useSimFrame((state: RootState) => {
    const pulse = pulseRef.current;
    const plumeBatch = plumeMesh.current;
    const bloomBatch = bloomMesh.current;
    if (!plumeBatch || !bloomBatch) return;

    // Glint opacities refreshed each frame from LIVE.peer.* (panel drags land next
    // frame; closed panel keeps the zero-drift useMemo defaults). Runtime-settable
    // on a transparent material — no needsUpdate; scalar writes, no allocation.
    plumeMat.opacity = LIVE.peer.glintPlumeOpacity;
    bloomMat.opacity = LIVE.peer.glintBloomOpacity;

    if (!pulse) {
      plumeBatch.count = 0;
      bloomBatch.count = 0;
      return;
    }

    const age = simClock.elapsedSec - pulse.at;
    if (age >= scheduleHorizon) {
      // Every hop has arrived — retire the pulse so the resting frame pays one
      // null check instead of walking the whole tree schedule forever.
      pulseRef.current = null;
      plumeBatch.count = 0;
      bloomBatch.count = 0;
      return;
    }

    // The courier is only a moving sample of the edge surge, so both its knot
    // and trace inherit the same block carrier instead of introducing white.
    // Three-arg setRGB: the spread form allocates an arguments array per frame.
    plumeMat.color.setRGB(pulse.color[0], pulse.color[1], pulse.color[2]);
    bloomMat.color.setRGB(pulse.color[0], pulse.color[1], pulse.color[2]);

    state.camera.getWorldPosition(_camPos);
    state.camera.getWorldQuaternion(_camQuat);

    // The hops ride edges of the counter-rotating colony, but this layer
    // stays OUTSIDE the rotating group (its billboard bases are world-frame):
    // carry each sampled point and its flight axis through the live rotation
    // instead. Rotation is linear, so rotating the interpolated point keeps
    // the glint exactly ON its turning edge.
    const rotY = colonyFrame.rotationY;
    const rotC = Math.cos(rotY);
    const rotS = Math.sin(rotY);

    // Bind each in-flight hop to the next free pool slot; hide the rest below.
    let slot = 0;
    for (const hop of schedule) {
      // Min-visibility: stretch a near-instant tree edge to at least MIN_THROW_S.
      const visibleStart = Math.min(hop.launchAge, hop.arriveAge - MIN_THROW_S);
      if (age < visibleStart || age >= hop.arriveAge) continue; // not in flight
      if (slot >= COURIER_POOL) {
        // Concurrency exceeded the pool — drop the excess (deterministic: the tail
        // of the schedule). Warn once; this is a rare safety valve, not a leak.
        if (!cappedLogged.current) {
          cappedLogged.current = true;
          console.warn(
            `ColonyCourierLayer: >${COURIER_POOL} couriers in flight; dropping excess.`,
          );
        }
        break;
      }
      const dur = hop.arriveAge - visibleStart; // ≥ MIN_THROW_S, so never 0
      const t = Math.max(0, Math.min((age - visibleStart) / dur, 1));
      const s = easeOutCubic(t);

      const dx = hop.to[0] - hop.from[0];
      const dy = hop.to[1] - hop.from[1];
      const dz = hop.to[2] - hop.from[2];
      const hx = hop.from[0] + dx * s;
      const hy = hop.from[1] + dy * s;
      const hz = hop.from[2] + dz * s;
      // Colony frame → world (rotYLocalToWorldXZ, inlined: no allocation in
      // the hot loop). Y and every length are rotation-invariant.
      const wx = hx * rotC + hz * rotS;
      const wz = -hx * rotS + hz * rotC;

      _position.set(wx, hy, wz);

      // Ease presence in/out at the hop ends so nothing pops (shrinks to nothing).
      const edge = courierEdgeEase(t);

      // Glow-mote head: a camera-quaternion billboard (courierGlyph).
      writeCourierMote(bloomBatch, slot, _position, _camQuat, LIVE.peer.flameBloom, edge);

      // Comet-tail plume: length tracks the courier's analytic easeOut speed
      // (fast off the launch → long plume; decelerating in → short). The axis
      // is the hop direction carried through the same rotation as the point;
      // the helper builds the around-axis billboard from the rotated point,
      // so the view vector reads the same sample the transform does.
      const legDist = Math.hypot(dx, dy, dz) || 1;
      const speed = courierHopSpeed(legDist, dur, t);
      const length = courierPlumeLength(LIVE.peer.flameMinLen, LIVE.peer.flameMaxLen, speed);
      _dir.set(dx * rotC + dz * rotS, dy, -dx * rotS + dz * rotC);
      writeCourierPlume(
        plumeBatch,
        slot,
        _position,
        _dir,
        _camPos,
        LIVE.peer.flameWidth,
        length,
        edge,
      );
      slot += 1;
    }

    // `count` excludes every unused capacity slot without touching its matrix.
    // Active matrices move each frame; an empty batch needs no buffer upload,
    // and a populated one uploads only the live prefix, not the full pool.
    plumeBatch.count = slot;
    bloomBatch.count = slot;
    if (slot > 0) {
      const plumeAttr = plumeBatch.instanceMatrix;
      plumeAttr.clearUpdateRanges();
      plumeAttr.addUpdateRange(0, slot * 16);
      plumeAttr.needsUpdate = true;
      const bloomAttr = bloomBatch.instanceMatrix;
      bloomAttr.clearUpdateRanges();
      bloomAttr.addUpdateRange(0, slot * 16);
      bloomAttr.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={plumeMesh}
        args={[plumeGeom, plumeMat, COURIER_POOL]}
        {...courierGpuProbes.plume}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={bloomMesh}
        args={[bloomGeom, bloomMat, COURIER_POOL]}
        {...courierGpuProbes.bloom}
        frustumCulled={false}
        renderOrder={2}
      />
    </group>
  );
}
