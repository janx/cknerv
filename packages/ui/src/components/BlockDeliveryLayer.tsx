import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import type { Vec3 } from '../types';
import { CELLS_Y } from '../layout';
import {
  planDeliveries,
  deliveryPhase,
  easeOutCubic,
  type DeliveryPhaseConfig,
} from '../derives/peers.derive';
import { makeBolusBloomTexture, makeIngestFlashTexture } from '../materials/deliveryTextures';
import { BEAM_GROW_DUR_S, BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';

// --- tuning knobs ---------------------------------------------------------
const BOLUS_GEOM = new THREE.BoxGeometry(1, 1, 1);
const HERO_SIZE = 0.62;
const PEER_SIZE = 0.42;
const LOB_DUR_S = BEAM_GROW_DUR_S; // land (ingest) at the old strike moment — keep cadence
const INGEST_DUR_S = 0.34; // soft swallow
const TUMBLE_RATE = 1.6; // rad/s free tumble (no reorient-to-travel)
const BOLUS_BLOOM_SIZE = 1.5;
const INGEST_FLASH_SIZE = 3.4;
const GOLD = new THREE.Color('#ffcf6a');

const CFG: DeliveryPhaseConfig = {
  chargeDur: BEAM_CHARGE_DUR_S,
  lobDur: LOB_DUR_S,
  ingestDur: INGEST_DUR_S,
};

interface BolusHandle {
  group: React.RefObject<THREE.Group | null>;
  body: React.RefObject<THREE.Mesh | null>;
  bloom: React.RefObject<THREE.Sprite | null>;
  flash: React.RefObject<THREE.Sprite | null>;
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
  useEffect(
    () => () => {
      bloomTex.dispose();
      flashTex.dispose();
    },
    [bloomTex, flashTex],
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

      const showBolus = ph.phase === 'gather' || ph.phase === 'lob';
      if (h.body.current) h.body.current.visible = showBolus;
      if (h.bloom.current) h.bloom.current.visible = showBolus;
      if (h.flash.current) h.flash.current.visible = ph.phase === 'ingest';

      if (showBolus) {
        const s = ph.phase === 'lob' ? easeOutCubic(ph.t) : 0; // gather sits at `from`
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
        if (h.bloom.current) h.bloom.current.scale.setScalar(BOLUS_BLOOM_SIZE * grow);
      } else {
        // ingest: park at the membrane; soft rise-then-fade swallow flash.
        g.position.set(d.to[0], d.to[1], d.to[2]);
        const a = Math.sin(Math.min(1, ph.t) * Math.PI);
        if (h.flash.current) {
          h.flash.current.scale.setScalar(INGEST_FLASH_SIZE * (0.5 + 0.5 * ph.t));
          (h.flash.current.material as THREE.SpriteMaterial).opacity = a;
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
}

function BolusBody({ dkey, register, bloomTex, flashTex }: BolusBodyProps) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const bloom = useRef<THREE.Sprite>(null);
  const flash = useRef<THREE.Sprite>(null);

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

  useEffect(() => {
    register(dkey, { group, body, bloom, flash });
    return () => {
      register(dkey, null);
      bodyMat.dispose();
      bloomMat.dispose();
      flashMat.dispose();
    };
  }, [dkey, register, bodyMat, bloomMat, flashMat]);

  return (
    <group ref={group} visible={false}>
      <mesh ref={body} geometry={BOLUS_GEOM} material={bodyMat} frustumCulled={false} />
      <sprite ref={bloom} material={bloomMat} />
      <sprite ref={flash} material={flashMat} visible={false} />
    </group>
  );
}
