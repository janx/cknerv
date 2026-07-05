// ColonyCourierLayer — a faint GLINT accent riding the block wavefront. The primary
// block signal is now ColonyEdges' surge (a bright band flowing along the links); on
// top of it, a small dimmed glow-mote + short streak is flung node→node outward from
// the flood origin along the shortest-path tree (colonyCourierSchedule), timed by the
// flood arrivals — a spark tracing the surge, not a glaring projectile. Its motion is
// adapted from the retired hub-and-spoke BlockCourierLayer:
//   • straight easeOutCubic fling (fast off the launch, coasts to rest);
//   • a velocity-aligned jet-thrust plume (length ∝ analytic speed) billboarded
//     around the flight axis, with a nozzle-bloom sprite as the glow-mote HEAD
//     (the old CrystalGlow cube is GONE — the mote is pure glow now);
//   • driven each frame off an age-clock (age = simClock.elapsedSec − pulse.at)
//     that this layer stamps ITSELF on each blockPulseAtMs increase.
//
// Unlike the old one-cube-per-peer registry (which doesn't scale to the colony's
// ~277 tree edges), this uses a FIXED pool of COURIER_POOL reused instances: each
// frame we take the schedule's currently-in-flight hops and bind them to pool
// slots, hiding the rest. Only a few dozen hops fly at once, so 64 is ample; a
// burst beyond it drops the excess (warned once) rather than growing the pool.
//
// Backfill quiescence: like NetworkColony's delivery pulse, we CONSUME a pulse
// that advances mid-backfill (advance lastPulseRef) but do NOT stamp the age
// clock — so no courier strobe replays when a large restore gap clears.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RootState } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { LIVE } from '../tweaks/liveTweaks';
import type { Vec3 } from '../types';
import type { ColonyFlood } from '../derives/networkFlood.derive';
import { colonyCourierSchedule } from '../derives/colonyCourier.derive';
import { easeOutCubic } from '../derives/peers.derive';
import { makeCourierPlumeTexture, makeCourierBloomTexture } from '../materials/courierFlameTexture';

/** Fixed courier pool. The tree has ~277 hops but only dozens are ever in flight
 *  at once (each visible for ≥ MIN_THROW_S of the ~2s flood); 64 covers the
 *  concurrency with headroom. Bursts beyond it are dropped (warned once). */
const COURIER_POOL = 64;
/** Shortest tree edges give arriveAge − launchAge ≈ 0; render each hop over at
 *  least this long so it actually reads as a throw. */
const MIN_THROW_S = 0.25;

/** Glint tuning. The courier is now a FAINT accent riding the edge surge (which is
 *  the primary block signal), so the mote + its short streak are small and dim —
 *  no longer a bright thrown comet. The plume is a velocity-aligned quad whose
 *  length tracks the courier's analytic speed; the bloom is a round nozzle sprite. */
const FLAME_SPEED_STRETCH = 0.02;  // length added per (world-unit/s) of courier speed
/** Ease the mote + flame in/out over this fraction of each hop so nothing pops. */
const COURIER_END_EASE = 0.08;
/** Glow-mote tint — a pale white-cyan; multiplies the (already white→cyan) bloom
 *  texture so the mote head carries one defined colour. */
const MOTE_COLOR = '#d8faff';

interface Slot {
  group: React.RefObject<THREE.Group | null>;
  plume: React.RefObject<THREE.Mesh | null>;
  bloom: React.RefObject<THREE.Sprite | null>;
}

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
const _view = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _worldX = new THREE.Vector3(1, 0, 0);
const _basis = new THREE.Matrix4();
const _camPos = new THREE.Vector3();

/**
 * The new-block broadcast wave. One layer owns every courier: a glow-mote head
 * (nozzle-bloom sprite) + a velocity-aligned jet-thrust plume, flung straight
 * from each node's flood predecessor to it and eased with easeOutCubic. Driven
 * each frame from colonyCourierSchedule + this layer's own pulse age clock.
 */
export default function ColonyCourierLayer({
  cf,
  posById,
  blockPulseAtMs,
  backfillActive,
}: ColonyCourierLayerProps) {
  // The node→node throws for this block's tree. Pure; recomputed only when the
  // flood (new block / new origin) or the positions (topology) change.
  const schedule = useMemo(() => colonyCourierSchedule(cf, posById), [cf, posById]);

  // Fixed pool of reusable courier instances, populated by CourierSlot children.
  const pool = useRef<Array<Slot | null>>(new Array(COURIER_POOL).fill(null));
  const register = useMemo(
    () => (i: number, slot: Slot | null) => {
      pool.current[i] = slot;
    },
    [],
  );
  const cappedLogged = useRef(false);

  // Own age clock: stamp { at } on each blockPulseAtMs increase, gated by backfill
  // (consume-then-bail — mirrors NetworkColony's delivery pulse). Null = no active
  // block (all couriers hidden).
  const pulseRef = useRef<{ at: number } | null>(null);
  const lastPulseRef = useRef(blockPulseAtMs);
  useEffect(() => {
    if (blockPulseAtMs <= lastPulseRef.current) return;
    lastPulseRef.current = blockPulseAtMs; // consume even while backfilling…
    if (backfillActive) return; //           …but don't stamp → no courier flood
    pulseRef.current = { at: simClock.elapsedSec };
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
  const plumeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: plumeTex,
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
      new THREE.SpriteMaterial({
        map: bloomTex,
        color: new THREE.Color(MOTE_COLOR),
        transparent: true,
        opacity: 0.55, // zero-drift default; live via LIVE.peer.glintBloomOpacity per-frame
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [bloomTex],
  );

  useEffect(
    () => () => {
      plumeTex.dispose();
      bloomTex.dispose();
      plumeGeom.dispose();
      plumeMat.dispose();
      bloomMat.dispose();
    },
    [plumeTex, bloomTex, plumeGeom, plumeMat, bloomMat],
  );

  useSimFrame((state: RootState) => {
    const pulse = pulseRef.current;
    const slots = pool.current;

    // Glint opacities refreshed each frame from LIVE.peer.* (panel drags land next
    // frame; closed panel keeps the zero-drift useMemo defaults). Runtime-settable
    // on a transparent material — no needsUpdate; scalar writes, no allocation.
    plumeMat.opacity = LIVE.peer.glintPlumeOpacity;
    bloomMat.opacity = LIVE.peer.glintBloomOpacity;

    if (!pulse) {
      for (let i = 0; i < slots.length; i += 1) {
        const s = slots[i];
        if (s?.group.current) s.group.current.visible = false;
      }
      return;
    }

    const age = simClock.elapsedSec - pulse.at;
    state.camera.getWorldPosition(_camPos);

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
      const h = slots[slot];
      slot += 1;
      if (!h || !h.group.current) continue;

      const dur = hop.arriveAge - visibleStart; // ≥ MIN_THROW_S, so never 0
      const t = Math.max(0, Math.min((age - visibleStart) / dur, 1));
      const s = easeOutCubic(t);

      const dx = hop.to[0] - hop.from[0];
      const dy = hop.to[1] - hop.from[1];
      const dz = hop.to[2] - hop.from[2];
      const hx = hop.from[0] + dx * s;
      const hy = hop.from[1] + dy * s;
      const hz = hop.from[2] + dz * s;

      const g = h.group.current;
      g.visible = true;
      g.position.set(hx, hy, hz);

      // Ease presence in/out at the hop ends so nothing pops (shrinks to nothing).
      const edge = Math.max(
        0,
        Math.min(t / COURIER_END_EASE, (1 - t) / COURIER_END_EASE, 1),
      );

      // Glow-mote head (sprite auto-billboards; scale → 0 hides it at the ends).
      if (h.bloom.current) h.bloom.current.scale.setScalar(LIVE.peer.flameBloom * edge);

      // Comet-tail plume: length tracks the courier's analytic easeOut speed
      // (fast off the launch → long plume; decelerating in → short).
      if (h.plume.current) {
        const legDist = Math.hypot(dx, dy, dz) || 1;
        const speed = (legDist * 3 * (1 - t) * (1 - t)) / dur;
        const length = Math.min(LIVE.peer.flameMaxLen, LIVE.peer.flameMinLen + speed * FLAME_SPEED_STRETCH);
        const plume = h.plume.current;
        // Orient +Y along the flight direction, billboarded around that axis so
        // the quad faces the camera. Group rotation is identity, so the local
        // quaternion IS the world orientation.
        _dir.set(dx, dy, dz).normalize();
        _view.set(_camPos.x - hx, _camPos.y - hy, _camPos.z - hz).normalize();
        _x.crossVectors(_dir, _view);
        if (_x.lengthSq() < 1e-6) {
          // Camera dead-on the flight axis → dir×view collapses. Fall back to a
          // world axis guaranteed non-parallel to _dir. The colony is a 3D cloud
          // (nodes at CHAIN_Y ± y), so a near-vertical hop needs world-X, not up.
          _x.crossVectors(_dir, Math.abs(_dir.y) < 0.9 ? _up : _worldX);
        }
        _x.normalize();
        _z.crossVectors(_x, _dir).normalize();
        _basis.makeBasis(_x, _dir, _z);
        plume.quaternion.setFromRotationMatrix(_basis);
        plume.scale.set(LIVE.peer.flameWidth, length * edge, 1); // edge shrinks it at the ends
      }
    }

    // Hide the pool slots this frame didn't use.
    for (let i = slot; i < slots.length; i += 1) {
      const s = slots[i];
      if (s?.group.current) s.group.current.visible = false;
    }
  });

  return (
    <group>
      {Array.from({ length: COURIER_POOL }, (_, i) => (
        <CourierSlot
          key={i}
          index={i}
          register={register}
          plumeGeom={plumeGeom}
          plumeMat={plumeMat}
          bloomMat={bloomMat}
        />
      ))}
    </group>
  );
}

/** One pooled courier: a glow-mote (nozzle-bloom sprite) HEAD + its velocity-
 *  aligned comet-tail plume. Registers its refs into the pool; the layer binds an
 *  in-flight hop to it each frame (or hides it). Materials/geometry are shared —
 *  only per-object transforms are written, so nothing collides across the pool. */
function CourierSlot({
  index,
  register,
  plumeGeom,
  plumeMat,
  bloomMat,
}: {
  index: number;
  register: (i: number, slot: Slot | null) => void;
  plumeGeom: THREE.PlaneGeometry;
  plumeMat: THREE.Material;
  bloomMat: THREE.SpriteMaterial;
}) {
  const group = useRef<THREE.Group>(null);
  const plume = useRef<THREE.Mesh>(null);
  const bloom = useRef<THREE.Sprite>(null);
  useEffect(() => {
    register(index, { group, plume, bloom });
    return () => register(index, null);
  }, [index, register]);
  return (
    <group ref={group} visible={false}>
      <sprite ref={bloom} material={bloomMat} />
      <mesh ref={plume} geometry={plumeGeom} material={plumeMat} frustumCulled={false} />
    </group>
  );
}
