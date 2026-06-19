import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RootState } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import type { Vec3 } from '../types';
import {
  courierFlight,
  courierLeg,
  easeOutCubic,
  type CourierSchedule,
} from '../derives/peers.derive';
import { makeCourierWakeMaterial } from '../materials/courierWakeMaterial';
import { makeCourierPlumeTexture, makeCourierBloomTexture } from '../materials/courierFlameTexture';
import CrystalGlow from './CrystalGlow';

/** Block courier cube — shared geometry/size/color. */
const BLOCK_GEOM = new THREE.BoxGeometry(1, 1, 1);
const BLOCK_SIZE = 0.5; // smaller "thrown" block
const BLOCK_COLOR = new THREE.Color('#d8faff');

/** Jet-thrust flame tuning (harness-tunable). The plume is a velocity-aligned quad
 *  whose length tracks the courier's speed; the bloom is a fixed round nozzle sprite. */
const FLAME_WIDTH = 1.5;           // plume width (world units)
const FLAME_MIN_LEN = 1.6;         // plume length at rest
const FLAME_MAX_LEN = 9.0;         // plume length cap on the fast launch
const FLAME_SPEED_STRETCH = 0.04;  // length added per (world-unit/s) of courier speed
const FLAME_BLOOM_SIZE = 1.25;     // round nozzle-bloom diameter (world units)
/** Cube + flame presence: ease in/out over this fraction of each leg so nothing pops. */
const COURIER_END_EASE = 0.08;
/** Flash tuning (harness-tunable). */
const FLASH_DUR_S = 0.4;
const FLASH_POINT_SIZE = 5.0;
const FLASH_CAPACITY = 32;

interface Handle {
  group: React.RefObject<THREE.Group | null>;
  intensity: React.MutableRefObject<number>;
  plume: React.RefObject<THREE.Mesh | null>;
  bloom: React.RefObject<THREE.Sprite | null>;
}

interface Flash {
  pos: Vec3;
  bornSec: number;
}

export interface BlockCourierLayerProps {
  /** Peer id → world position (the rendered set). */
  posById: Map<string, Vec3>;
  /** node_id → the node its courier flies FROM (entry peer → null). */
  senders: Record<string, string | null>;
  /** node_id → arrival age (s since pulse). */
  arrivals: Record<string, number>;
  /** Earliest-arriving peer; its courier relays inward to the hub. */
  entryId: string | null;
  /** When the current block fired (null = no active block). */
  pulseRef: React.MutableRefObject<{ at: number; entryId: string | null } | null>;
  /** Inward-relay destination (local node). */
  hubPos: Vec3;
}

// Scratch objects reused every frame (no per-frame allocation).
const _dir = new THREE.Vector3();
const _view = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();
const _camPos = new THREE.Vector3();

/**
 * The new-block broadcast wave. One layer owns every courier: a CrystalGlow cube
 * per peer (eased straight flight), a velocity-aligned jet-thrust flame (plume quad
 * + nozzle bloom) behind it, and launch/arrival flashes in one shared Points.
 * Driven each frame from the schedule PeerConstellation already computes.
 */
export default function BlockCourierLayer({
  posById,
  senders,
  arrivals,
  entryId,
  pulseRef,
  hubPos,
}: BlockCourierLayerProps) {
  const ids = useMemo(() => Array.from(posById.keys()), [posById]);

  // Cube/flame handles by id, populated by CourierCube children.
  const registry = useRef<Map<string, Handle>>(new Map());
  const register = useMemo(
    () => (id: string, handle: Handle | null) => {
      if (handle) registry.current.set(id, handle);
      else registry.current.delete(id);
    },
    [],
  );

  // Shared flame resources (one texture/material/geometry for all couriers).
  const plumeTex = useMemo(() => makeCourierPlumeTexture(), []);
  const bloomTex = useMemo(() => makeCourierBloomTexture(), []);
  const plumeGeom = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, -0.5, 0); // nozzle edge at the origin; plume extends toward -Y
    return g;
  }, []);
  const plumeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: plumeTex,
        transparent: true,
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
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [bloomTex],
  );

  // Shared flash Points (ring buffer of live blooms). Uniform size → aSize ≡ 1.
  const flashGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLASH_CAPACITY * 3), 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(FLASH_CAPACITY), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(FLASH_CAPACITY).fill(1), 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const flashMat = useMemo(() => makeCourierWakeMaterial(BLOCK_COLOR, FLASH_POINT_SIZE), []);
  const flashes = useRef<Flash[]>([]);

  // Crossing detector (age is monotonic within one pulse).
  const prevPulseAt = useRef(-1);
  const prevAge = useRef(-1);

  useEffect(
    () => () => {
      plumeTex.dispose();
      bloomTex.dispose();
      plumeGeom.dispose();
      plumeMat.dispose();
      bloomMat.dispose();
      flashGeom.dispose();
      flashMat.dispose();
    },
    [plumeTex, bloomTex, plumeGeom, plumeMat, bloomMat, flashGeom, flashMat],
  );

  useSimFrame((state: RootState) => {
    const now = simClock.elapsedSec;
    const pulse = pulseRef.current;
    const reg = registry.current;

    flashMat.uniforms.uViewportHeight.value = state.size.height;

    if (pulse && pulse.at !== prevPulseAt.current) {
      prevPulseAt.current = pulse.at;
      prevAge.current = -1;
    }

    const age = pulse ? now - pulse.at : 0;
    const schedule: CourierSchedule = { entryId, senders, arrivals };

    const spawnFlash = (pos: Vec3) => {
      const arr = flashes.current;
      arr.push({ pos, bornSec: now });
      if (arr.length > FLASH_CAPACITY) arr.shift();
    };

    const hideCourier = (h?: Handle) => {
      if (!h) return;
      if (h.group.current) h.group.current.visible = false;
      h.intensity.current = 0;
      if (h.plume.current) h.plume.current.visible = false;
      if (h.bloom.current) h.bloom.current.visible = false;
    };

    if (!pulse) {
      reg.forEach((h) => hideCourier(h));
      prevAge.current = -1;
    } else {
      state.camera.getWorldPosition(_camPos);
      for (const id of ids) {
        const h = reg.get(id);
        const flight = courierFlight(id, schedule, posById, hubPos);
        if (!flight) {
          hideCourier(h);
          continue;
        }
        const leg = courierLeg(flight.startAge, flight.dur, age);
        const arrAge = flight.startAge + flight.dur;

        // Launch / arrival flash crossings.
        if (prevAge.current < flight.startAge && age >= flight.startAge) spawnFlash(flight.from);
        if (prevAge.current < arrAge && age >= arrAge) spawnFlash(flight.to);

        if (!h || !h.group.current) continue;
        if (!leg.visible) {
          hideCourier(h);
          continue;
        }

        // Eased straight head position.
        const s = easeOutCubic(leg.t);
        const dx = flight.to[0] - flight.from[0];
        const dy = flight.to[1] - flight.from[1];
        const dz = flight.to[2] - flight.from[2];
        const hx = flight.from[0] + dx * s;
        const hy = flight.from[1] + dy * s;
        const hz = flight.from[2] + dz * s;
        const g = h.group.current;
        g.visible = true;
        g.position.set(hx, hy, hz);
        const edge = Math.max(0, Math.min(leg.t / COURIER_END_EASE, (1 - leg.t) / COURIER_END_EASE, 1));
        h.intensity.current = edge;

        // Flame length tracks the courier's analytic speed (easeOut derivative):
        // fast off the launch (long plume) → decelerating into B (short).
        const legDist = Math.hypot(dx, dy, dz) || 1;
        const speed = (legDist * 3 * (1 - leg.t) * (1 - leg.t)) / flight.dur;
        const length = Math.min(FLAME_MAX_LEN, FLAME_MIN_LEN + speed * FLAME_SPEED_STRETCH);

        if (h.plume.current) {
          const plume = h.plume.current;
          // Orient the plume's +Y along the flight direction, billboarded around
          // that axis so the quad faces the camera. (Group rotation is identity,
          // so the local quaternion is the world orientation.)
          _dir.set(dx, dy, dz).normalize();
          _view.set(_camPos.x - hx, _camPos.y - hy, _camPos.z - hz).normalize();
          _x.crossVectors(_dir, _view);
          // Camera looking straight down the flight axis → dir×view ≈ 0; fall back to
          // dir×up. Safe because every leg is horizontal (peers + hub sit at constant
          // CHAIN_Y), so _dir is never parallel to _up. If legs ever leave that plane,
          // pick the fallback axis by |_dir.y| instead, or this basis can collapse.
          if (_x.lengthSq() < 1e-6) _x.crossVectors(_dir, _up);
          _x.normalize();
          _z.crossVectors(_x, _dir).normalize();
          _basis.makeBasis(_x, _dir, _z);
          plume.quaternion.setFromRotationMatrix(_basis);
          plume.scale.set(FLAME_WIDTH, length * edge, 1); // edge shrinks it to nothing at the leg ends
          plume.visible = true;
        }
        if (h.bloom.current) {
          h.bloom.current.scale.setScalar(FLAME_BLOOM_SIZE * edge);
          h.bloom.current.visible = true;
        }
      }
      prevAge.current = age;
    }

    // Advance + write flashes (drop expired, then fill the buffer).
    const live = flashes.current.filter((f) => now - f.bornSec < FLASH_DUR_S);
    flashes.current = live;
    const fPos = flashGeom.getAttribute('position') as THREE.BufferAttribute;
    const fAlpha = flashGeom.getAttribute('aAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < live.length; i += 1) {
      const f = live[i];
      fPos.setXYZ(i, f.pos[0], f.pos[1], f.pos[2]);
      fAlpha.setX(i, 1 - (now - f.bornSec) / FLASH_DUR_S);
    }
    flashGeom.setDrawRange(0, live.length);
    fPos.needsUpdate = true;
    fAlpha.needsUpdate = true;
  });

  return (
    <group>
      {ids.map((id) => (
        <CourierCube
          key={id}
          id={id}
          register={register}
          plumeGeom={plumeGeom}
          plumeMat={plumeMat}
          bloomMat={bloomMat}
        />
      ))}
      <points geometry={flashGeom} material={flashMat} frustumCulled={false} />
    </group>
  );
}

/** One pooled courier: a CrystalGlow cube + its jet-thrust flame (plume quad +
 *  nozzle-bloom sprite). Registers its refs; the layer drives them each frame. */
function CourierCube({
  id,
  register,
  plumeGeom,
  plumeMat,
  bloomMat,
}: {
  id: string;
  register: (id: string, handle: Handle | null) => void;
  plumeGeom: THREE.PlaneGeometry;
  plumeMat: THREE.Material;
  bloomMat: THREE.SpriteMaterial;
}) {
  const group = useRef<THREE.Group>(null);
  const intensity = useRef(0);
  const plume = useRef<THREE.Mesh>(null);
  const bloom = useRef<THREE.Sprite>(null);
  useEffect(() => {
    register(id, { group, intensity, plume, bloom });
    return () => register(id, null);
  }, [id, register]);
  return (
    <group ref={group} visible={false}>
      <CrystalGlow
        geom={BLOCK_GEOM}
        size={BLOCK_SIZE}
        color={BLOCK_COLOR}
        intensityRef={intensity}
        seed={id}
      />
      <mesh ref={plume} geometry={plumeGeom} material={plumeMat} frustumCulled={false} />
      <sprite ref={bloom} material={bloomMat} />
    </group>
  );
}
