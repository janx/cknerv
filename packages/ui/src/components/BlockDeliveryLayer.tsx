import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import { colonyFrame } from '../tweaks/colonyFrame';
import { LIVE } from '../tweaks/liveTweaks';
import { useCellGalaxyOptional } from '../hooks/cellGalaxyContext';
import type { Vec3 } from '../types';
import { CELLS_Y } from '../layout';
import {
  planDeliveries,
  deliveryPhase,
  deliveryScheduleHorizon,
  easeOutCubic,
  contactRelease,
  contactFrontState,
  peerAngle,
  sharedCellNearestIndex,
  nearestCellIdsFromIndex,
  type ContactFrontLive,
  type DeliveryPhaseConfig,
} from '../derives/peers.derive';
import {
  makeCourierBloomTexture,
  makeCourierPlumeTexture,
} from '../materials/courierFlameTexture';
import {
  makeContactWaveAttribute,
  makeContactWaveGeometry,
  makeContactWaveMaterial,
  CONTACT_WAVE_CREST_UV,
  CONTACT_WAVE_WAKE_BEHIND,
} from '../materials/contactWaveMaterial';
import { BEAM_GROW_DUR_S, BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';
import { FIELD_HALF_X, FIELD_HALF_Z } from '../helix';
import { CELL_GALAXY_PALETTE } from '../visualPalette';
import type { ConsensusFlowColor } from '../derives/consensusFlow.derive';
import {
  courierEdgeEase,
  courierHopSpeed,
  courierPlumeLength,
  writeCourierMote,
  writeCourierPlume,
} from './courierGlyph';
import {
  markCellFlashDirty,
  type CellFlashDirtyIdsRef,
} from './cellFlash';

// BlockDeliveryLayer — the block's LAST HOP: peer plane → Cell field.
//
// ONE IDEA, THREE BEATS: compression, then release.
//   gather — the worker holds its breath. This layer draws NOTHING for it:
//            the held breath is the peer's own halo contracting, in the peer
//            material (ColonyNodes / CkbNodeAnchor), because the peer plane is
//            soft light and a glyph there was HUD chrome that escaped.
//   lob    — the block leaves the peer as a COURIER: the same mote + plume the
//            propagation tree's hops are drawn with (courierGlyph.ts), thrown
//            with easeOutCubic like every courier hop, in the block's own
//            carrier hue. The mote's end ease shrinks it to nothing at the
//            membrane — contact is absorption, not a pop. No glyph, no streak,
//            no sear, nothing white.
//   ingest — the tissue answers in its own vocabulary: a soft front released
//            flat in the Cell field, carrier hue resolving into tissue rose.
//
// EVERY worker gets its own front, all at ONE shared speed: the peer-plane
// brightness wave's SHOCKWAVE_SPEED divided by CONTACT_WAVE_SCALE. Speed and
// reach divide by it TOGETHER — that is the invariant, not raw speed
// equality: it keeps a front's lifetime equal to the peer wave's structure,
// so the two planes read as one event at two scales. (Restore the raw speed
// without restoring the reach with it and every front extinguishes in a
// fraction of its window — a blink.) Hero emphasis is scale and reach, never
// a different form. Overlap is kept off the white rail by a 1/r falloff, the
// rim's three gaps, and extinction where the tissue ends.
//
// Every real measured node keeps its own timing and transform, but the renderer
// submits the whole event as three semantic batches: instanced motes, plumes
// and contact fronts. Delivery count changes instance counts, never draw-call count.

const LOB_DUR_S = BEAM_GROW_DUR_S;

const TISSUE_ROSE = new THREE.Color().setRGB(...CELL_GALAXY_PALETTE.tissueRose);
const CARRIER_COLOR = new THREE.Color();
const BLACK = new THREE.Color(0, 0, 0);
const FRONT_LOCAL_NORMAL = new THREE.Vector3(0, 0, 1);
/** The front lives FLAT in the Cell plane for its whole life, whatever the
 *  hop's path: an over-rim worker's landing is pulled onto the tissue
 *  (peers.derive), which slants its hop, and a front that pitched along that
 *  slant would tilt out of the disc. Only the plume follows the true velocity.
 *  The annulus spans local XY, so aiming local +Z up the world axis lays it in
 *  the tissue. */
const FRONT_FLAT_FACING = new THREE.Quaternion().setFromUnitVectors(
  FRONT_LOCAL_NORMAL,
  new THREE.Vector3(0, 1, 0),
);

const CFG: DeliveryPhaseConfig = {
  chargeDur: BEAM_CHARGE_DUR_S,
  lobDur: LOB_DUR_S,
  ingestDur: LIVE.delivery.ingestDur,
};

// The released front's live knobs, refreshed once per frame beside CFG. The
// algebra itself (radius, reach completion, knee fade, 1/r, width rate+cap)
// lives in peers.derive where it is numerically tested.
const FRONT_LIVE: ContactFrontLive = {
  speed: LIVE.delivery.waveSpeed,
  width: LIVE.delivery.waveWidth,
  falloffPower: LIVE.delivery.waveFalloff,
  windowS: LIVE.delivery.ingestDur,
};

// Shared scratch state. Frame callbacks are sequential, and every setter copies
// into a GPU attribute immediately, so no per-frame object allocation is needed.
const _position = new THREE.Vector3();
const _flightDirection = new THREE.Vector3();
const _cameraPosition = new THREE.Vector3();
const _cameraQuaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _frontQuaternion = new THREE.Quaternion();
const _frontRollQuaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _batchColor = new THREE.Color();
const _waveColor = new THREE.Color();

export interface BlockDeliveryPulse {
  at: number;
  entryId: string | null;
  color: ConsensusFlowColor;
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
  /** Current block protocol carrier (null = no active block). */
  pulseRef: MutableRefObject<BlockDeliveryPulse | null>;
  /** Galaxy's cell.id → scene-seconds flash map (owned by CellGalaxy). */
  cellFlashRef: MutableRefObject<Map<number, number>>;
  /** Set true when we add a flash CellGalaxy hasn't pushed to the GPU yet. */
  flashDirtyRef: MutableRefObject<boolean>;
  /** Exact dirty ids used by CellGalaxy's sparse flash upload path. */
  flashDirtyIdsRef?: CellFlashDirtyIdsRef;
}

/** The hop's two batches share the courier layer's material recipe (additive,
 *  no depth write, tone mapping off) so the last hop is the same light as the
 *  glints; the material colour stays neutral because each instance carries
 *  its own carrier hue × opacity (below). Depth test is off like the front's:
 *  the hop crosses the gap between the planes and is the block's climax, so
 *  nothing standing in that gap may hide it. */
function makeHopBatchMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/** Additive blending makes RGB×opacity exactly equivalent to one material
 * opacity per delivery. One instance material keeps independent phase
 * envelopes without a custom shader or one draw per delivery. */
function writeInstanceColor(
  batch: THREE.InstancedMesh,
  index: number,
  color: THREE.Color,
  opacity: number,
): void {
  _batchColor.copy(color).multiplyScalar(Math.max(0, opacity));
  batch.setColorAt(index, _batchColor);
}

/** One front. The annulus is scaled so its crest lands on the shader's fixed UV
 * radius, which is what keeps the crest's shape independent of its world
 * radius; the per-instance attribute then carries the crest width in that same
 * UV space. The front lies flat (FRONT_FLAT_FACING) and rolls about its own
 * normal by `rotationZ` so each worker's three gaps sit at their own angle. */
function writeWaveInstance(
  batch: THREE.InstancedMesh,
  shape: THREE.InstancedBufferAttribute,
  index: number,
  position: THREE.Vector3,
  crestRadius: number,
  crestHalfWidth: number,
  wakeSide: number,
  color: THREE.Color,
  intensity: number,
  rotationZ: number,
): void {
  const extent = crestRadius / CONTACT_WAVE_CREST_UV;
  _scale.set(extent, extent, 1);
  _frontQuaternion.copy(FRONT_FLAT_FACING);
  if (rotationZ !== 0) {
    _frontRollQuaternion.setFromAxisAngle(FRONT_LOCAL_NORMAL, rotationZ);
    _frontQuaternion.multiply(_frontRollQuaternion);
  }
  _matrix.compose(position, _frontQuaternion, _scale);
  batch.setMatrixAt(index, _matrix);
  writeInstanceColor(batch, index, color, intensity);
  const shapeArray = shape.array as Float32Array;
  shapeArray[index * 2] = crestHalfWidth / extent;
  shapeArray[index * 2 + 1] = wakeSide;
}

function commitInstanceBatch(batch: THREE.InstancedMesh, count: number): void {
  batch.count = count;
  if (count === 0) return;
  // Upload only the live prefix — slots past `count` are never sampled.
  const matrixAttr = batch.instanceMatrix;
  matrixAttr.clearUpdateRanges();
  matrixAttr.addUpdateRange(0, count * 16);
  matrixAttr.needsUpdate = true;
  const colorAttr = batch.instanceColor;
  if (colorAttr) {
    colorAttr.clearUpdateRanges();
    colorAttr.addUpdateRange(0, count * 3);
    colorAttr.needsUpdate = true;
  }
}

export default function BlockDeliveryLayer({
  posById,
  arrivals,
  localOrigins,
  localReceiveDelayS,
  pulseRef,
  cellFlashRef,
  flashDirtyRef,
  flashDirtyIdsRef,
}: BlockDeliveryLayerProps) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxyOptional();
  const deliveries = useMemo(
    () => planDeliveries(
      localOrigins,
      localReceiveDelayS,
      posById,
      arrivals,
      CELLS_Y,
      {
        halfX: FIELD_HALF_X,
        halfZ: FIELD_HALF_Z,
        // Plan-time rotation, same trick as the ignition pass below: the galaxy
        // turns ≤ ~0.02 rad across a whole pulse at the default rate, so pinning
        // the ellipse where it stood when the plan was made is exact enough for
        // a landing clamp and keeps this memo off the frame clock.
        rotationY: galaxyFrame.rotationY,
      },
      // The colony's rotation gets the same plan-time pin for the LANDING
      // (Delivery.to is world); the launch stays colony-frame and is carried
      // through the live rotation every frame below, so the hop leaves from
      // its turning node however long a pulse runs.
      colonyFrame.rotationY,
    ),
    [localOrigins, localReceiveDelayS, posById, arrivals],
  );
  // One mote, one plume and one front per delivery, at most.
  const capacity = Math.max(1, deliveries.length);
  const ignitedPulseAtRef = useRef<number | null>(null);
  const cellsToken = cellsCache?.cellsToken ?? null;
  const nearestCellIndex = useMemo(
    () => sharedCellNearestIndex(
      cellsToken,
      cellsCache?.cells ?? new Map(),
      cellsCache?.cellChanges,
    ),
    // The cache publishes a fresh token exactly when Cell membership/position
    // changes, so peer deliveries share one index without rebuilding per peer —
    // and the galaxy's local-ignition pass shares the very same build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellsToken],
  );

  // Shared hop resources: the courier layer's own textures, one material and
  // one geometry per batch for every delivery.
  const bloomTex = useMemo(() => makeCourierBloomTexture(), []);
  const plumeTex = useMemo(() => makeCourierPlumeTexture(), []);
  const moteGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const plumeGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, -0.5, 0); // nozzle edge at the origin; plume trails toward −Y
    return g;
  }, []);
  const moteMaterial = useMemo(() => makeHopBatchMaterial(bloomTex), [bloomTex]);
  const plumeMaterial = useMemo(() => makeHopBatchMaterial(plumeTex), [plumeTex]);
  const waveMaterial = useMemo(() => makeContactWaveMaterial(), []);
  const waveShape = useMemo(
    () => makeContactWaveAttribute(capacity),
    [capacity],
  );
  const waveGeometry = useMemo(() => {
    const geometry = makeContactWaveGeometry();
    geometry.setAttribute('aWave', waveShape);
    return geometry;
  }, [waveShape]);

  const moteBatchRef = useRef<THREE.InstancedMesh>(null);
  const plumeBatchRef = useRef<THREE.InstancedMesh>(null);
  const waveBatchRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const batches = [
      moteBatchRef.current,
      plumeBatchRef.current,
      waveBatchRef.current,
    ];
    for (const batch of batches) {
      if (!batch) continue;
      batch.count = 0;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Allocate instanceColor before the first render so the material program
      // is compiled once with the independent phase-colour channel enabled.
      batch.setColorAt(0, BLACK);
      batch.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    }
  }, [capacity]);

  // Disposal is split by lifetime on purpose. Delivery count changes whenever
  // peers churn, which rebuilds the capacity-sized wave geometry — bundling the
  // shared materials into that same cleanup would dispose a live shader program
  // and force a recompile on an ordinary peer join.
  useEffect(() => () => { waveGeometry.dispose(); }, [waveGeometry]);
  useEffect(() => () => {
    moteGeometry.dispose();
    plumeGeometry.dispose();
    moteMaterial.dispose();
    plumeMaterial.dispose();
    waveMaterial.dispose();
    bloomTex.dispose();
    plumeTex.dispose();
  }, [
    moteGeometry,
    plumeGeometry,
    moteMaterial,
    plumeMaterial,
    waveMaterial,
    bloomTex,
    plumeTex,
  ]);

  useSimFrame((state) => {
    const moteBatch = moteBatchRef.current;
    const plumeBatch = plumeBatchRef.current;
    const waveBatch = waveBatchRef.current;
    if (!moteBatch || !plumeBatch || !waveBatch) return;

    const now = simClock.elapsedSec;
    CFG.ingestDur = LIVE.delivery.ingestDur;
    FRONT_LIVE.speed = LIVE.delivery.waveSpeed;
    FRONT_LIVE.width = LIVE.delivery.waveWidth;
    FRONT_LIVE.falloffPower = LIVE.delivery.waveFalloff;
    FRONT_LIVE.windowS = CFG.ingestDur;
    const pulse = pulseRef.current;
    if (!pulse) {
      moteBatch.count = 0;
      plumeBatch.count = 0;
      waveBatch.count = 0;
      ignitedPulseAtRef.current = null;
      return;
    }

    const age = now - pulse.at;
    if (age >= deliveryScheduleHorizon(deliveries, CFG)) {
      // Every delivery is past `done` — retire the pulse (this layer is the
      // ref's only reader) so the resting frame pays one null check instead of
      // walking every delivery + committing empty batches forever.
      pulseRef.current = null;
      moteBatch.count = 0;
      plumeBatch.count = 0;
      waveBatch.count = 0;
      ignitedPulseAtRef.current = null;
      return;
    }
    // Three-arg setRGB: the spread form allocates an arguments array per frame.
    CARRIER_COLOR.setRGB(pulse.color[0], pulse.color[1], pulse.color[2]);
    // One camera read per frame for every mote (billboard) and plume (view
    // vector) — never per delivery.
    state.camera.getWorldPosition(_cameraPosition);
    state.camera.getWorldQuaternion(_cameraQuaternion);
    // Launches live in the colony's rotating frame (Delivery.from); landings
    // are world (Delivery.to). One cos/sin pair per frame carries every
    // launch through the LIVE colony rotation (rotYLocalToWorldXZ inlined —
    // no allocation in the frame loop), so the hop leaves FROM its node
    // while the node turns.
    const colonyRotC = Math.cos(colonyFrame.rotationY);
    const colonyRotS = Math.sin(colonyFrame.rotationY);
    waveMaterial.uniforms.uWake.value = LIVE.delivery.waveWake;
    waveMaterial.uniforms.uSegmentDepth.value = LIVE.delivery.waveSegments;
    // The rim-extinction ellipse turns with the galaxy; track it exactly. The
    // front resolves the turn per FRAGMENT, so the pair is resolved here —
    // the galaxy's own angle, not the colony's: the two planes share a rate
    // knob and a sign, never a value (the colony damps its own under a
    // selection).
    waveMaterial.uniforms.uGalaxyRot.value.set(
      Math.cos(galaxyFrame.rotationY),
      Math.sin(galaxyFrame.rotationY),
    );

    // Galaxy RECEIVES the wave: once per real block, schedule a flare on the
    // Cells nearest each real delivery landing. Batching never changes this data
    // path or its event timing.
    if (cellsCache && ignitedPulseAtRef.current !== pulse.at) {
      ignitedPulseAtRef.current = pulse.at;
      const rotY = galaxyFrame.rotationY;
      let budget = LIVE.delivery.igniteMax;
      for (const delivery of deliveries) {
        if (budget <= 0) break;
        const k = Math.min(
          delivery.hero ? LIVE.delivery.igniteKHero : LIVE.delivery.igniteKPeer,
          budget,
        );
        const ids = nearestCellIdsFromIndex(
          [delivery.to[0], delivery.to[2]],
          rotY,
          nearestCellIndex,
          k,
        );
        const ingestSceneS = pulse.at + delivery.startAge + LOB_DUR_S;
        for (let index = 0; index < ids.length; index += 1) {
          const flashAt = ingestSceneS + index * LIVE.delivery.igniteRipple;
          const previous = cellFlashRef.current.get(ids[index]) ?? -1e9;
          if (flashAt > previous) {
            cellFlashRef.current.set(ids[index], flashAt);
            markCellFlashDirty(
              ids[index],
              flashDirtyRef,
              flashDirtyIdsRef,
            );
          }
          budget -= 1;
        }
      }
    }

    let hopCount = 0;
    let waveCount = 0;

    for (const delivery of deliveries) {
      const phase = deliveryPhase(age - delivery.startAge, CFG);
      // idle / gather / done draw nothing here: the gather beat is the peer's
      // own halo compressing, in the peer material.
      if (phase.phase !== 'lob' && phase.phase !== 'ingest') continue;

      const punch = delivery.hero ? 1 : LIVE.delivery.peerPunchScale;

      if (phase.phase === 'lob') {
        // This delivery's launch in world, at the colony's rotation THIS frame.
        const fromX = delivery.from[0] * colonyRotC + delivery.from[2] * colonyRotS;
        const fromY = delivery.from[1];
        const fromZ = -delivery.from[0] * colonyRotS + delivery.from[2] * colonyRotC;

        // The hop is thrown — easeOutCubic, as every courier hop is thrown —
        // from the turning node to the world-pinned landing.
        const progress = easeOutCubic(phase.t);
        _position.set(
          fromX + (delivery.to[0] - fromX) * progress,
          fromY + (delivery.to[1] - fromY) * progress,
          fromZ + (delivery.to[2] - fromZ) * progress,
        );
        // Presence eases in off the node and shrinks to nothing at the
        // membrane: the block is absorbed by the tissue, not popped.
        const edge = courierEdgeEase(phase.t);

        // Mote: the block itself, per tier in size, in its carrier hue.
        writeCourierMote(
          moteBatch,
          hopCount,
          _position,
          _cameraQuaternion,
          delivery.hero ? LIVE.delivery.moteHero : LIVE.delivery.motePeer,
          edge,
        );
        writeInstanceColor(
          moteBatch,
          hopCount,
          CARRIER_COLOR,
          LIVE.delivery.hopBloomOpacity,
        );

        // Plume: along the true node→landing velocity (a rim worker's
        // inward-slanted throw reads here), stretched by the hop's analytic
        // easeOut speed — long off the launch, short arriving.
        _flightDirection.set(
          delivery.to[0] - fromX,
          delivery.to[1] - fromY,
          delivery.to[2] - fromZ,
        );
        const legDist = _flightDirection.length() || 1;
        const length = courierPlumeLength(
          LIVE.delivery.plumeMinLen,
          LIVE.delivery.plumeMaxLen,
          courierHopSpeed(legDist, LOB_DUR_S, phase.t),
        ) * punch;
        writeCourierPlume(
          plumeBatch,
          hopCount,
          _position,
          _flightDirection,
          _cameraPosition,
          LIVE.delivery.plumeWidth,
          length,
          edge,
        );
        writeInstanceColor(
          plumeBatch,
          hopCount,
          CARRIER_COLOR,
          LIVE.delivery.hopPlumeOpacity,
        );
        hopCount += 1;
      } else {
        const release = contactRelease(phase.t);
        // Contact is an event boundary, not another travelling object: the
        // front is released at the real landing and stays there.
        _position.set(delivery.to[0], delivery.to[1], delivery.to[2]);
        // The released front. All of its spatial algebra — radius from real
        // seconds at the shared wave speed, reach completion against the
        // window, knee extinction, 1/r falloff, width rate + cap — is
        // contactFrontState in peers.derive, numerically tested there. This
        // loop only composes strengths on top.
        const contactAge = phase.t * CFG.ingestDur;
        const reach = delivery.hero
          ? LIVE.delivery.waveReachHero
          : LIVE.delivery.waveReachPeer;
        const front = contactFrontState(contactAge, reach, FRONT_LIVE);
        const intensity = LIVE.delivery.waveOpacity
          * release.frontOpacity
          * front.falloff
          * front.reachFade
          * punch;
        if (intensity > 0.002) {
          // Carrier hue resolving into the tissue's own rose — nothing white.
          _waveColor.copy(CARRIER_COLOR).lerp(TISSUE_ROSE, release.colorT);
          writeWaveInstance(
            waveBatch,
            waveShape,
            waveCount,
            _position,
            front.crestRadius,
            front.crestHalfWidth,
            CONTACT_WAVE_WAKE_BEHIND,
            _waveColor,
            intensity,
            // One roll per WORKER, hashed from the delivery's stable key: the
            // three rim gaps never align across workers, so overlapping fronts
            // stay an interference field instead of a moiré — and because the
            // key never moves, peer churn mid-pulse cannot snap-rotate a front
            // already released the way an array index (shifting under every
            // join/leave) did.
            peerAngle(delivery.key),
          );
          waveCount += 1;
        }
      }
    }

    commitInstanceBatch(moteBatch, hopCount);
    commitInstanceBatch(plumeBatch, hopCount);
    commitInstanceBatch(waveBatch, waveCount);
    if (waveCount > 0) {
      waveShape.clearUpdateRanges();
      waveShape.addUpdateRange(0, waveCount * 2);
      waveShape.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh
        ref={plumeBatchRef}
        args={[plumeGeometry, plumeMaterial, capacity]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={moteBatchRef}
        args={[moteGeometry, moteMaterial, capacity]}
        frustumCulled={false}
        renderOrder={2}
      />
      <instancedMesh
        ref={waveBatchRef}
        args={[waveGeometry, waveMaterial, capacity]}
        frustumCulled={false}
        renderOrder={3}
      />
    </group>
  );
}
