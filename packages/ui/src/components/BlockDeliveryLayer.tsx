import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import type { Vec3 } from '../types';
import { CELLS_Y } from '../layout';
import {
  planDeliveries,
  deliveryPhase,
  easeInLob,
  easeOutCubic,
  type DeliveryPhaseConfig,
} from '../derives/peers.derive';
import {
  makeBolusBloomTexture,
  makeIngestFlashTexture,
  makeBolusTrailTexture,
  makeRingTexture,
} from '../materials/deliveryTextures';
import { BEAM_GROW_DUR_S, BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';

// --- tuning knobs ---------------------------------------------------------
const BOLUS_GEOM = new THREE.BoxGeometry(1, 1, 1);
const HERO_SIZE = 0.82; // mass: bigger than the flat version (was 0.62)
const PEER_SIZE = 0.5; // (was 0.42)
const LOB_DUR_S = BEAM_GROW_DUR_S; // UNCHANGED — ingest lands at the strike moment
const INGEST_DUR_S = 0.34;
const TUMBLE_RATE = 1.6;
const BOLUS_BLOOM_SIZE = 2.1; // (was 1.5)
const INGEST_FLASH_SIZE = 4.4; // (was 3.4)
const FLASH_DECAY = 7.0; // sharp white-hot attack, exp fall
const TRAIL_WIDTH = 0.85;
const TRAIL_LEN_BASE = 1.2; // trail min length
const TRAIL_LEN_GAIN = 2.0; // × analytic lob speed (longest right before impact)
const TRAIL_OPACITY = 0.85;
const RING_MAX = 6.5; // shockwave ring max scale (hero)
const RECOIL_OVERSHOOT = 0.22; // elastic flash swell = light membrane recoil (0 to drop)
const PEER_PUNCH_SCALE = 0.55; // peers dialed down so 81 read as one wave
const GOLD = new THREE.Color('#ffcf6a');
const WHITE_HOT = new THREE.Color('#fffcf2'); // her flare colour at impact
const AMBER = new THREE.Color('#ff8c26'); // flash resolves into her cortex amber

const CFG: DeliveryPhaseConfig = {
  chargeDur: BEAM_CHARGE_DUR_S,
  lobDur: LOB_DUR_S,
  ingestDur: INGEST_DUR_S,
};

// analytic speed of easeInLob(t) = 0.15t + 0.85t^2  →  d/dt = 0.15 + 1.7t
const lobSpeed = (t: number) => 0.15 + 1.7 * t;

interface BolusHandle {
  group: React.RefObject<THREE.Group | null>;
  body: React.RefObject<THREE.Mesh | null>;
  bloom: React.RefObject<THREE.Sprite | null>;
  trail: React.RefObject<THREE.Sprite | null>;
  flash: React.RefObject<THREE.Sprite | null>;
  ring: React.RefObject<THREE.Sprite | null>;
}

export interface BlockDeliveryLayerProps {
  /** Rendered peer id → world position (CHAIN_Y plane). */
  posById: Map<string, Vec3>;
  /** peer id → arrival age (s since pulse). */
  arrivals: Record<string, number>;
  /** Local/hero CKB node world positions (the delivery origins). */
  localOrigins: Vec3[];
  /** Local node's delivery start age (= blockSchedule.localReceiveDelayS). */
  localReceiveDelayS: number;
  /** When the current block fired (null = no active block). */
  pulseRef: React.MutableRefObject<{ at: number; entryId: string | null } | null>;
}

export default function BlockDeliveryLayer({
  posById,
  arrivals,
  localOrigins,
  localReceiveDelayS,
  pulseRef,
}: BlockDeliveryLayerProps) {
  const deliveries = useMemo(
    () => planDeliveries(localOrigins, localReceiveDelayS, posById, arrivals, CELLS_Y),
    [localOrigins, localReceiveDelayS, posById, arrivals],
  );

  const registry = useRef<Map<string, BolusHandle>>(new Map());
  const register = useMemo(
    () => (key: string, h: BolusHandle | null) => {
      if (h) registry.current.set(key, h);
      else registry.current.delete(key);
    },
    [],
  );

  // Shared textures (cheap); each child clones its own materials so per-frame
  // opacity/colour writes never collide across the ~81 boluses.
  const bloomTex = useMemo(() => makeBolusBloomTexture(), []);
  const flashTex = useMemo(() => makeIngestFlashTexture(), []);
  const trailTex = useMemo(() => makeBolusTrailTexture(), []);
  const ringTex = useMemo(() => makeRingTexture(), []);
  useEffect(
    () => () => {
      bloomTex.dispose();
      flashTex.dispose();
      trailTex.dispose();
      ringTex.dispose();
    },
    [bloomTex, flashTex, trailTex, ringTex],
  );

  useSimFrame(() => {
    const now = simClock.elapsedSec;
    const pulse = pulseRef.current;
    const reg = registry.current;

    if (!pulse) {
      reg.forEach((h) => {
        if (h.group.current) h.group.current.visible = false;
      });
      return;
    }
    const age = now - pulse.at;

    for (const d of deliveries) {
      const h = reg.get(d.key);
      if (!h || !h.group.current) continue;
      const g = h.group.current;
      const ph = deliveryPhase(age - d.startAge, CFG);

      if (ph.phase === 'idle' || ph.phase === 'done') {
        g.visible = false;
        continue;
      }
      g.visible = true;
      const punch = d.hero ? 1 : PEER_PUNCH_SCALE;

      const inFlight = ph.phase === 'gather' || ph.phase === 'lob';
      if (h.body.current) h.body.current.visible = inFlight;
      if (h.bloom.current) h.bloom.current.visible = inFlight;
      if (h.trail.current) h.trail.current.visible = ph.phase === 'lob';
      if (h.flash.current) h.flash.current.visible = ph.phase === 'ingest';
      if (h.ring.current) h.ring.current.visible = ph.phase === 'ingest';

      if (inFlight) {
        const s = ph.phase === 'lob' ? easeInLob(ph.t) : 0; // accelerate in; gather sits at `from`
        g.position.set(
          d.from[0] + (d.to[0] - d.from[0]) * s,
          d.from[1] + (d.to[1] - d.from[1]) * s,
          d.from[2] + (d.to[2] - d.from[2]) * s,
        );
        const grow = ph.phase === 'gather' ? ph.t : 1; // form during the gather pre-roll
        if (h.body.current) {
          h.body.current.rotation.set(now * TUMBLE_RATE, now * TUMBLE_RATE * 0.7, 0);
          h.body.current.scale.setScalar((d.hero ? HERO_SIZE : PEER_SIZE) * grow);
        }
        if (h.bloom.current) h.bloom.current.scale.setScalar(BOLUS_BLOOM_SIZE * punch * grow);
        // speed trail: vertical streak behind the head, length ∝ acceleration.
        if (h.trail.current && ph.phase === 'lob') {
          const len = (TRAIL_LEN_BASE + TRAIL_LEN_GAIN * lobSpeed(ph.t)) * punch;
          h.trail.current.scale.set(TRAIL_WIDTH * punch, len, 1);
          h.trail.current.position.set(0, -len / 2, 0); // head at the bolus, tail toward `from`
          (h.trail.current.material as THREE.SpriteMaterial).opacity = TRAIL_OPACITY;
        }
      } else {
        // ingest: park at the membrane; hard white→amber flash + shockwave ring.
        g.position.set(d.to[0], d.to[1], d.to[2]);
        const it = ph.t;
        if (h.flash.current) {
          const op = Math.exp(-FLASH_DECAY * it); // sharp attack, fast fall
          const swell = 1 + RECOIL_OVERSHOOT * Math.sin(Math.min(1, it) * Math.PI); // recoil
          h.flash.current.scale.setScalar(INGEST_FLASH_SIZE * punch * swell);
          const m = h.flash.current.material as THREE.SpriteMaterial;
          m.opacity = op;
          m.color.lerpColors(WHITE_HOT, AMBER, easeOutCubic(it)); // white impact → her amber
        }
        if (h.ring.current) {
          h.ring.current.scale.setScalar(RING_MAX * punch * (0.15 + it));
          (h.ring.current.material as THREE.SpriteMaterial).opacity = (1 - it) * 0.9;
        }
      }
    }
  });

  return (
    <group>
      {deliveries.map((d) => (
        <BolusBody
          key={d.key}
          dkey={d.key}
          register={register}
          bloomTex={bloomTex}
          flashTex={flashTex}
          trailTex={trailTex}
          ringTex={ringTex}
        />
      ))}
    </group>
  );
}

interface BolusBodyProps {
  dkey: string;
  register: (key: string, h: BolusHandle | null) => void;
  bloomTex: THREE.Texture;
  flashTex: THREE.Texture;
  trailTex: THREE.Texture;
  ringTex: THREE.Texture;
}

function BolusBody({ dkey, register, bloomTex, flashTex, trailTex, ringTex }: BolusBodyProps) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const bloom = useRef<THREE.Sprite>(null);
  const trail = useRef<THREE.Sprite>(null);
  const flash = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Sprite>(null);

  const bodyMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
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
  const trailMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: trailTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0,
      }),
    [trailTex],
  );
  const flashMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: flashTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0,
      }),
    [flashTex],
  );
  const ringMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: ringTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 0,
      }),
    [ringTex],
  );

  useEffect(() => {
    register(dkey, { group, body, bloom, trail, flash, ring });
    return () => {
      register(dkey, null);
      bodyMat.dispose();
      bloomMat.dispose();
      trailMat.dispose();
      flashMat.dispose();
      ringMat.dispose();
    };
  }, [dkey, register, bodyMat, bloomMat, trailMat, flashMat, ringMat]);

  return (
    <group ref={group} visible={false}>
      <mesh ref={body} geometry={BOLUS_GEOM} material={bodyMat} frustumCulled={false} />
      <sprite ref={bloom} material={bloomMat} />
      <sprite ref={trail} material={trailMat} visible={false} />
      <sprite ref={flash} material={flashMat} visible={false} />
      <sprite ref={ring} material={ringMat} visible={false} />
    </group>
  );
}
