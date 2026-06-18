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
  wakeSamples,
  PEER_RENDER_CAP,
  type CourierSchedule,
} from '../derives/peers.derive';
import { makeCourierWakeMaterial } from '../materials/courierWakeMaterial';
import CrystalGlow from './CrystalGlow';

/** Block courier cube — shared geometry/size/color (moved here from PeerConstellation). */
const BLOCK_GEOM = new THREE.BoxGeometry(1, 1, 1);
const BLOCK_SIZE = 0.5; // smaller "thrown" block
const BLOCK_COLOR = new THREE.Color('#d8faff');

/** Comet-tail tuning (harness-tunable). Dense + tightly spaced so the points read as
 *  one tapering tail, not a dot cloud; size tapers WAKE_HEAD_SIZE → ×WAKE_TAIL_FRAC. */
const WAKE_SAMPLES = 24;
const WAKE_DT_S = 0.022;
const WAKE_GAIN = 1.0;
const WAKE_HEAD_SIZE = 2.2;  // bright wide head (the material's uBaseSize for the wake)
const WAKE_TAIL_FRAC = 0.18; // tail size as a fraction of the head
/** Cube presence: ease intensity in/out over this fraction of each leg so the
 *  solid cube doesn't pop at the endpoints (the flashes cover those moments). */
const COURIER_END_EASE = 0.08;
/** Flash tuning (harness-tunable). */
const FLASH_DUR_S = 0.4;
const FLASH_POINT_SIZE = 5.0;
const FLASH_CAPACITY = 32;

/** Capacity for the shared wake buffer (PEER_RENDER_CAP × WAKE_SAMPLES). */
const MAX_WAKE_POINTS = PEER_RENDER_CAP * WAKE_SAMPLES;

interface Handle {
  group: React.RefObject<THREE.Group | null>;
  intensity: React.MutableRefObject<number>;
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

/**
 * The new-block broadcast wave. One layer owns every courier: a CrystalGlow cube
 * per peer (eased straight flight, free tumble preserved), all wakes in one shared
 * Points, and launch/arrival flashes in a second small Points. Driven each frame
 * from the schedule PeerConstellation already computes — no per-peer courier code.
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

  // Cube handles by id, populated by CourierCube children.
  const registry = useRef<Map<string, Handle>>(new Map());
  const register = useMemo(
    () => (id: string, handle: Handle | null) => {
      if (handle) registry.current.set(id, handle);
      else registry.current.delete(id);
    },
    [],
  );

  // Shared wake Points (one draw call for the whole wave). `aSize` carries the
  // per-point comet taper (head → tail); the material multiplies it by uBaseSize.
  const wakeGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_WAKE_POINTS * 3), 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAX_WAKE_POINTS), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_WAKE_POINTS), 1));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const wakeMat = useMemo(() => makeCourierWakeMaterial(BLOCK_COLOR, WAKE_HEAD_SIZE), []);

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
      wakeGeom.dispose();
      wakeMat.dispose();
      flashGeom.dispose();
      flashMat.dispose();
    },
    [wakeGeom, wakeMat, flashGeom, flashMat],
  );

  useSimFrame((state: RootState) => {
    const now = simClock.elapsedSec;
    const pulse = pulseRef.current;
    const reg = registry.current;

    // Depth-attenuation basis.
    wakeMat.uniforms.uViewportHeight.value = state.size.height;
    flashMat.uniforms.uViewportHeight.value = state.size.height;

    // Reset the crossing detector on a fresh pulse.
    if (pulse && pulse.at !== prevPulseAt.current) {
      prevPulseAt.current = pulse.at;
      prevAge.current = -1;
    }

    const age = pulse ? now - pulse.at : 0;
    const schedule: CourierSchedule = { entryId, senders, arrivals };
    const wakePos = wakeGeom.getAttribute('position') as THREE.BufferAttribute;
    const wakeAlpha = wakeGeom.getAttribute('aAlpha') as THREE.BufferAttribute;
    const wakeSize = wakeGeom.getAttribute('aSize') as THREE.BufferAttribute;
    let w = 0;

    const spawnFlash = (pos: Vec3) => {
      const arr = flashes.current;
      arr.push({ pos, bornSec: now });
      if (arr.length > FLASH_CAPACITY) arr.shift();
    };

    if (!pulse) {
      reg.forEach((h) => {
        if (h.group.current) h.group.current.visible = false;
        h.intensity.current = 0;
      });
      prevAge.current = -1;
    } else {
      for (const id of ids) {
        const h = reg.get(id);
        const flight = courierFlight(id, schedule, posById, hubPos);
        if (!flight) {
          if (h?.group.current) h.group.current.visible = false;
          if (h) h.intensity.current = 0;
          continue;
        }
        const leg = courierLeg(flight.startAge, flight.dur, age);
        const arrAge = flight.startAge + flight.dur;

        // Launch / arrival flash crossings.
        if (prevAge.current < flight.startAge && age >= flight.startAge) spawnFlash(flight.from);
        if (prevAge.current < arrAge && age >= arrAge) spawnFlash(flight.to);

        // Cube: eased straight position; solid with short end-eases.
        if (h?.group.current) {
          const g = h.group.current;
          if (!leg.visible) {
            g.visible = false;
            h.intensity.current = 0;
          } else {
            const s = easeOutCubic(leg.t);
            g.visible = true;
            g.position.set(
              flight.from[0] + (flight.to[0] - flight.from[0]) * s,
              flight.from[1] + (flight.to[1] - flight.from[1]) * s,
              flight.from[2] + (flight.to[2] - flight.from[2]) * s,
            );
            const edge = Math.min(leg.t / COURIER_END_EASE, (1 - leg.t) / COURIER_END_EASE, 1);
            h.intensity.current = Math.max(0, edge);
          }
        }

        // Wake samples → shared comet-tail buffer.
        if (leg.visible) {
          const samples = wakeSamples(flight, age, {
            samples: WAKE_SAMPLES,
            dtS: WAKE_DT_S,
            gain: WAKE_GAIN,
            tailFrac: WAKE_TAIL_FRAC,
          });
          for (const sm of samples) {
            if (w >= MAX_WAKE_POINTS) break;
            wakePos.setXYZ(w, sm.pos[0], sm.pos[1], sm.pos[2]);
            wakeAlpha.setX(w, sm.alpha);
            wakeSize.setX(w, sm.size);
            w += 1;
          }
        }
      }
      prevAge.current = age;
    }

    wakeGeom.setDrawRange(0, w);
    wakePos.needsUpdate = true;
    wakeAlpha.needsUpdate = true;
    wakeSize.needsUpdate = true;

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
        <CourierCube key={id} id={id} register={register} />
      ))}
      <points geometry={wakeGeom} material={wakeMat} frustumCulled={false} />
      <points geometry={flashGeom} material={flashMat} frustumCulled={false} />
    </group>
  );
}

/** One pooled courier cube: registers its group + intensity refs with the layer,
 *  which positions/shows it each frame. CrystalGlow keeps the halo + free tumble. */
function CourierCube({
  id,
  register,
}: {
  id: string;
  register: (id: string, handle: Handle | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const intensity = useRef(0);
  useEffect(() => {
    register(id, { group, intensity });
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
    </group>
  );
}
