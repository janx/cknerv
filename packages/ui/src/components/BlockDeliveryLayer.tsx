import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import { LIVE } from '../tweaks/liveTweaks';
import { useCellGalaxyOptional } from '../hooks/cellGalaxyContext';
import type { Vec3 } from '../types';
import { CELLS_Y } from '../layout';
import {
  planDeliveries,
  deliveryPhase,
  easeInLob,
  bolusIngest,
  nearestCellIds,
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
const LOB_DUR_S = BEAM_GROW_DUR_S; // UNCHANGED — ingest lands at the strike moment
const TUMBLE_RATE = 1.6;
const GOLD = new THREE.Color('#ffcf6a');
const WHITE_HOT = new THREE.Color('#fffcf2'); // her flare colour at impact
const AMBER = new THREE.Color('#ff8c26'); // flash resolves into her cortex amber

const CFG: DeliveryPhaseConfig = {
  chargeDur: BEAM_CHARGE_DUR_S,
  lobDur: LOB_DUR_S,
  ingestDur: LIVE.delivery.ingestDur, // seeded at default; refreshed per-frame in the sim loop
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
  /** Galaxy's cell.id → scene-seconds flash map (owned by CellGalaxy). Each
   *  bolus ignites the cells it lands on by writing here — the galaxy visibly
   *  RECEIVES the delivery through its existing flare path. */
  cellFlashRef: React.MutableRefObject<Map<number, number>>;
  /** Set true when we add a flash CellGalaxy hasn't pushed to the GPU yet. */
  flashDirtyRef: React.MutableRefObject<boolean>;
}

export default function BlockDeliveryLayer({
  posById,
  arrivals,
  localOrigins,
  localReceiveDelayS,
  pulseRef,
  cellFlashRef,
  flashDirtyRef,
}: BlockDeliveryLayerProps) {
  const cellsCache = useCellGalaxyOptional();
  const deliveries = useMemo(
    () => planDeliveries(localOrigins, localReceiveDelayS, posById, arrivals, CELLS_Y),
    [localOrigins, localReceiveDelayS, posById, arrivals],
  );

  const registry = useRef<Map<string, BolusHandle>>(new Map());
  // pulse.at of the block whose landings we've already scheduled flares for.
  const ignitedPulseAtRef = useRef<number | null>(null);
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
    CFG.ingestDur = LIVE.delivery.ingestDur; // live: `ingest dur` knob picks up drags next frame
    const pulse = pulseRef.current;
    const reg = registry.current;

    if (!pulse) {
      reg.forEach((h) => {
        if (h.group.current) h.group.current.visible = false;
      });
      ignitedPulseAtRef.current = null;
      return;
    }
    const age = now - pulse.at;

    // Galaxy RECEIVES the wave: once per block, schedule a flare on the cells
    // nearest each bolus's landing, timed to that bolus's ingest (+ a tiny
    // nearest-first ripple). Writes CellGalaxy's own flash buffer, so the cells
    // light up in her existing amber flare where each delivery lands.
    if (cellsCache && ignitedPulseAtRef.current !== pulse.at) {
      ignitedPulseAtRef.current = pulse.at;
      const rotY = galaxyFrame.rotationY;
      const cells = cellsCache.cells;
      let budget = LIVE.delivery.igniteMax;
      for (const d of deliveries) {
        if (budget <= 0) break;
        const k = Math.min(d.hero ? LIVE.delivery.igniteKHero : LIVE.delivery.igniteKPeer, budget);
        const ids = nearestCellIds([d.to[0], d.to[2]], rotY, cells.values(), k);
        const ingestSceneS = pulse.at + d.startAge + LOB_DUR_S;
        for (let i = 0; i < ids.length; i += 1) {
          const flashAt = ingestSceneS + i * LIVE.delivery.igniteRipple; // nearest cell flares first
          const prev = cellFlashRef.current.get(ids[i]) ?? -1e9;
          if (flashAt > prev) {
            cellFlashRef.current.set(ids[i], flashAt);
            flashDirtyRef.current = true;
          }
          budget -= 1;
        }
      }
    }

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
      const punch = d.hero ? 1 : LIVE.delivery.peerPunchScale;

      const inFlight = ph.phase === 'gather' || ph.phase === 'lob';
      const ingesting = ph.phase === 'ingest';
      // Body + bloom now persist INTO ingest so the bolus visibly dissolves
      // instead of hard-cutting to invisible (which read as "vanished").
      if (h.body.current) h.body.current.visible = inFlight || ingesting;
      if (h.bloom.current) h.bloom.current.visible = inFlight || ingesting;
      if (h.trail.current) h.trail.current.visible = ph.phase === 'lob';
      if (h.flash.current) h.flash.current.visible = ingesting;
      if (h.ring.current) h.ring.current.visible = ingesting;

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
          h.body.current.scale.setScalar((d.hero ? LIVE.delivery.heroSize : LIVE.delivery.peerSize) * grow);
          (h.body.current.material as THREE.MeshBasicMaterial).opacity = 1; // reset — ingest fades it toward 0
        }
        if (h.bloom.current) {
          h.bloom.current.scale.setScalar(LIVE.delivery.bolusBloom * punch * grow);
          (h.bloom.current.material as THREE.SpriteMaterial).opacity = 1; // reset — ingest fades it toward 0
        }
        // speed trail: vertical streak behind the head, length ∝ acceleration.
        if (h.trail.current && ph.phase === 'lob') {
          const len = (LIVE.delivery.trailLenBase + LIVE.delivery.trailLenGain * lobSpeed(ph.t)) * punch;
          h.trail.current.scale.set(LIVE.delivery.trailWidth * punch, len, 1);
          h.trail.current.position.set(0, -len / 2, 0); // head at the bolus, tail toward `from`
          (h.trail.current.material as THREE.SpriteMaterial).opacity = LIVE.delivery.trailOpacity;
        }
      } else {
        // ingest: the bolus is ABSORBED — the body dissolves (shrink + fade)
        // while drawn toward the galaxy core, and the membrane flash resolves
        // white-hot → her amber. No hard cut; by t=1 nothing is left to blink off.
        const it = ph.t;
        const ing = bolusIngest(it);
        // Slide inward on xz toward the core (0,·,0) as it dissolves.
        const inLen = Math.hypot(d.to[0], d.to[2]) || 1;
        const pull = LIVE.delivery.ingestPull * ing.pull;
        g.position.set(
          d.to[0] - (d.to[0] / inLen) * pull,
          d.to[1],
          d.to[2] - (d.to[2] / inLen) * pull,
        );
        if (h.body.current) {
          h.body.current.rotation.set(now * TUMBLE_RATE, now * TUMBLE_RATE * 0.7, 0);
          h.body.current.scale.setScalar((d.hero ? LIVE.delivery.heroSize : LIVE.delivery.peerSize) * ing.bodyScale);
          (h.body.current.material as THREE.MeshBasicMaterial).opacity = ing.bodyOpacity;
        }
        if (h.bloom.current) {
          h.bloom.current.scale.setScalar(LIVE.delivery.bolusBloom * punch * ing.bodyScale);
          (h.bloom.current.material as THREE.SpriteMaterial).opacity = ing.bodyOpacity;
        }
        if (h.flash.current) {
          const swell = 1 + LIVE.delivery.recoil * Math.sin(Math.min(1, it * 3) * Math.PI); // membrane recoil (peaks early)
          h.flash.current.scale.setScalar(LIVE.delivery.flashSize * punch * swell);
          const m = h.flash.current.material as THREE.SpriteMaterial;
          m.opacity = ing.flashOpacity;
          m.color.lerpColors(WHITE_HOT, AMBER, ing.colorT); // white-hot strike → her amber
        }
        if (h.ring.current) {
          h.ring.current.scale.setScalar(LIVE.delivery.ringMax * punch * (0.15 + it));
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
