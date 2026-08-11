import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import { LIVE } from '../tweaks/liveTweaks';
import { useCellGalaxyOptional } from '../hooks/cellGalaxyContext';
import type { Vec3 } from '../types';
import { CELLS_Y } from '../layout';
import {
  planDeliveries,
  deliveryPhase,
  deliveryScheduleHorizon,
  easeInLob,
  bolusIngest,
  sharedCellNearestIndex,
  nearestCellIdsFromIndex,
  type DeliveryPhaseConfig,
} from '../derives/peers.derive';
import {
  makeJellyfishBellTexture,
  makeIngestShockwaveTexture,
  makeJellyfishWakeTexture,
} from '../materials/deliveryTextures';
import { BEAM_GROW_DUR_S, BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import type { ConsensusFlowColor } from '../derives/consensusFlow.derive';
import {
  makeProtocolCarrierGeometry,
  protocolCarrierBellPulse,
  protocolCarrierShockwaveProgress,
  setProtocolCarrierFacing,
} from '../geometry/protocolCarrier';
import {
  markCellFlashDirty,
  type CellFlashDirtyIdsRef,
} from './cellFlash';

// BlockDeliveryLayer — the network→Cell-field handoff in the A visual language.
// Every real measured node keeps its own timing and transform, but the renderer
// submits the whole event as four semantic batches: one sparse low-poly canopy,
// plus instanced unmarked membrane, three angular tentacles, and pressure rings.
// The open dodecagonal skirt swims head-first along the peer→Cell travel axis.
// Each restrained contraction sheds a segmented propulsion ring; contact
// resolves the carrier into the same geometry at Cell-field scale.
// Delivery count changes instance/vertex counts, never draw-call count.

const CARRIER_GEOM = makeProtocolCarrierGeometry();
const CARRIER_BASE_POSITION = CARRIER_GEOM.getAttribute('position') as THREE.BufferAttribute;
const CARRIER_VERTEX_COUNT = CARRIER_BASE_POSITION.count;
const LOB_DUR_S = BEAM_GROW_DUR_S;
const JELLY_BELL_ROLL_RATE = 0.18;
const JELLY_BELL_PULSE_RATE = 7.2;
const JELLY_BELL_OPEN_MIN = 0.96;
const JELLY_BELL_OPEN_AMOUNT = 0.08;
const JELLY_BELL_DEPTH_MAX = 1.20;
const JELLY_BELL_DEPTH_SWING = 0.20;
const JELLY_TENTACLE_STRETCH_MIN = 0.98;
const JELLY_TENTACLE_STRETCH_AMOUNT = 0.12;
const JELLY_TENTACLE_WIDTH_MIN = 1.65;
const JELLY_TENTACLE_WIDTH_AMOUNT = 0.20;
const PALE_CONSENSUS = new THREE.Color().setRGB(...CONSENSUS_BRAID_PALETTE.pale);
const CARRIER_COLOR = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const BLACK = new THREE.Color(0, 0, 0);
const CARRIER_LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const CARRIER_FALLBACK_DIRECTION = new THREE.Vector3(0, 1, 0);
const WAKE_FALLBACK_NORMAL = new THREE.Vector3(0, 0, 1);
const WAKE_SECONDARY_NORMAL = new THREE.Vector3(1, 0, 0);

const CFG: DeliveryPhaseConfig = {
  chargeDur: BEAM_CHARGE_DUR_S,
  lobDur: LOB_DUR_S,
  ingestDur: LIVE.delivery.ingestDur,
};

// Analytic speed of easeInLob(t) = 0.15t + 0.85t².
const lobSpeed = (t: number) => 0.15 + 1.7 * t;

// Shared scratch state. Frame callbacks are sequential, and every setter copies
// into a GPU attribute immediately, so no per-frame object allocation is needed.
const _position = new THREE.Vector3();
const _trailPosition = new THREE.Vector3();
const _wavePosition = new THREE.Vector3();
const _flightDirection = new THREE.Vector3();
const _cameraPosition = new THREE.Vector3();
const _wakeNormal = new THREE.Vector3();
const _wakeRight = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _bodyQuaternion = new THREE.Quaternion();
const _carrierFacingQuaternion = new THREE.Quaternion();
const _bellRollQuaternion = new THREE.Quaternion();
const _wakeQuaternion = new THREE.Quaternion();
const _spriteQuaternion = new THREE.Quaternion();
const _spriteRollQuaternion = new THREE.Quaternion();
const _wakeBasis = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const _batchColor = new THREE.Color();
const _flashColor = new THREE.Color();

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

function makeSpriteBatchMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color: WHITE,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/** Billboard a wake only around its travel axis. Local +Y follows the carrier
 * path, while local +Z faces the camera as closely as that constraint allows. */
function setWakeQuaternion(
  axis: THREE.Vector3,
  position: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  target: THREE.Quaternion,
): void {
  _wakeNormal.subVectors(cameraPosition, position);
  _wakeNormal.addScaledVector(axis, -_wakeNormal.dot(axis));
  if (_wakeNormal.lengthSq() < 1e-8) {
    const fallback = Math.abs(axis.dot(WAKE_FALLBACK_NORMAL)) < 0.98
      ? WAKE_FALLBACK_NORMAL
      : WAKE_SECONDARY_NORMAL;
    _wakeNormal.copy(fallback).addScaledVector(axis, -fallback.dot(axis));
  }
  _wakeNormal.normalize();
  _wakeRight.crossVectors(axis, _wakeNormal).normalize();
  _wakeBasis.makeBasis(_wakeRight, axis, _wakeNormal);
  target.setFromRotationMatrix(_wakeBasis);
}

/** Additive blending makes RGB×opacity exactly equivalent to one material
 * opacity per carrier. This lets one instance material retain independent phase
 * envelopes without a custom shader or one draw per delivery. */
function writeSpriteInstance(
  batch: THREE.InstancedMesh,
  index: number,
  position: THREE.Vector3,
  width: number,
  height: number,
  color: THREE.Color,
  opacity: number,
  basisQuaternion: THREE.Quaternion,
  rotationZ = 0,
): void {
  _scale.set(width, height, 1);
  _spriteQuaternion.copy(basisQuaternion);
  if (rotationZ !== 0) {
    _spriteRollQuaternion.setFromAxisAngle(CARRIER_LOCAL_FORWARD, rotationZ);
    _spriteQuaternion.multiply(_spriteRollQuaternion);
  }
  _matrix.compose(position, _spriteQuaternion, _scale);
  batch.setMatrixAt(index, _matrix);
  _batchColor.copy(color).multiplyScalar(Math.max(0, opacity));
  batch.setColorAt(index, _batchColor);
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

/** Append one transformed carrier to the shared line buffers. Vertex colour is
 * premultiplied by the carrier's independent opacity for additive equivalence. */
function writeCarrierBody(
  positions: Float32Array,
  colors: Float32Array,
  vertexOffset: number,
  matrix: THREE.Matrix4,
  color: THREE.Color,
  opacity: number,
): number {
  const source = CARRIER_BASE_POSITION.array as Float32Array;
  const e = matrix.elements;
  const r = color.r * opacity;
  const g = color.g * opacity;
  const b = color.b * opacity;
  for (let vertex = 0; vertex < CARRIER_VERTEX_COUNT; vertex += 1) {
    const sourceOffset = vertex * 3;
    const targetOffset = (vertexOffset + vertex) * 3;
    const x = source[sourceOffset];
    const y = source[sourceOffset + 1];
    const z = source[sourceOffset + 2];
    positions[targetOffset] = e[0] * x + e[4] * y + e[8] * z + e[12];
    positions[targetOffset + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    positions[targetOffset + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    colors[targetOffset] = r;
    colors[targetOffset + 1] = g;
    colors[targetOffset + 2] = b;
  }
  return vertexOffset + CARRIER_VERTEX_COUNT;
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
    () => planDeliveries(localOrigins, localReceiveDelayS, posById, arrivals, CELLS_Y),
    [localOrigins, localReceiveDelayS, posById, arrivals],
  );
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

  const bodyPositions = useMemo(
    () => new Float32Array(capacity * CARRIER_VERTEX_COUNT * 3),
    [capacity],
  );
  const bodyColors = useMemo(
    () => new Float32Array(capacity * CARRIER_VERTEX_COUNT * 3),
    [capacity],
  );
  const bodyPositionAttr = useMemo(() => {
    const attribute = new THREE.BufferAttribute(bodyPositions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  }, [bodyPositions]);
  const bodyColorAttr = useMemo(() => {
    const attribute = new THREE.BufferAttribute(bodyColors, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
  }, [bodyColors]);
  const bodyGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', bodyPositionAttr);
    geometry.setAttribute('color', bodyColorAttr);
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return geometry;
  }, [bodyPositionAttr, bodyColorAttr]);
  const bodyMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: WHITE,
    vertexColors: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);

  const membraneTex = useMemo(() => makeJellyfishBellTexture(), []);
  const impactTex = useMemo(() => makeIngestShockwaveTexture(), []);
  const wakeTex = useMemo(() => makeJellyfishWakeTexture(), []);
  const spriteGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const membraneMaterial = useMemo(
    () => makeSpriteBatchMaterial(membraneTex),
    [membraneTex],
  );
  const wakeMaterial = useMemo(() => makeSpriteBatchMaterial(wakeTex), [wakeTex]);
  const impactMaterial = useMemo(() => makeSpriteBatchMaterial(impactTex), [impactTex]);

  const membraneBatchRef = useRef<THREE.InstancedMesh>(null);
  const wakeBatchRef = useRef<THREE.InstancedMesh>(null);
  const impactBatchRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const batches = [
      membraneBatchRef.current,
      wakeBatchRef.current,
      impactBatchRef.current,
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

  useEffect(() => () => {
    bodyGeometry.dispose();
    bodyMaterial.dispose();
    spriteGeometry.dispose();
    membraneMaterial.dispose();
    wakeMaterial.dispose();
    impactMaterial.dispose();
    membraneTex.dispose();
    impactTex.dispose();
    wakeTex.dispose();
  }, [
    bodyGeometry,
    bodyMaterial,
    spriteGeometry,
    membraneMaterial,
    wakeMaterial,
    impactMaterial,
    membraneTex,
    impactTex,
    wakeTex,
  ]);

  useSimFrame((state) => {
    const membraneBatch = membraneBatchRef.current;
    const wakeBatch = wakeBatchRef.current;
    const impactBatch = impactBatchRef.current;
    if (!membraneBatch || !wakeBatch || !impactBatch) return;

    const now = simClock.elapsedSec;
    CFG.ingestDur = LIVE.delivery.ingestDur;
    const pulse = pulseRef.current;
    if (!pulse) {
      bodyGeometry.setDrawRange(0, 0);
      membraneBatch.count = 0;
      wakeBatch.count = 0;
      impactBatch.count = 0;
      ignitedPulseAtRef.current = null;
      return;
    }

    const age = now - pulse.at;
    if (age >= deliveryScheduleHorizon(deliveries, CFG)) {
      // Every carrier is past `done` — retire the pulse (this layer is the
      // ref's only reader) so the resting frame pays one null check instead of
      // walking every delivery + committing empty batches forever.
      pulseRef.current = null;
      bodyGeometry.setDrawRange(0, 0);
      membraneBatch.count = 0;
      wakeBatch.count = 0;
      impactBatch.count = 0;
      ignitedPulseAtRef.current = null;
      return;
    }
    // Three-arg setRGB: the spread form allocates an arguments array per frame.
    CARRIER_COLOR.setRGB(pulse.color[0], pulse.color[1], pulse.color[2]);
    state.camera.getWorldPosition(_cameraPosition);
    const bellRoll = now * JELLY_BELL_ROLL_RATE;
    _bellRollQuaternion.setFromAxisAngle(CARRIER_LOCAL_FORWARD, bellRoll);

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

    let bodyVertexCount = 0;
    let membraneCount = 0;
    let wakeCount = 0;
    let impactCount = 0;

    for (const delivery of deliveries) {
      const phase = deliveryPhase(age - delivery.startAge, CFG);
      if (phase.phase === 'idle' || phase.phase === 'done') continue;

      // Local +Z is the bell's swimming direction. Align it with the actual
      // peer→galaxy path, then roll only around that axis. Camera motion never
      // changes where the carrier is headed.
      _flightDirection.set(
        delivery.to[0] - delivery.from[0],
        delivery.to[1] - delivery.from[1],
        delivery.to[2] - delivery.from[2],
      );
      if (_flightDirection.lengthSq() < 1e-8) {
        _flightDirection.copy(CARRIER_FALLBACK_DIRECTION);
      } else {
        _flightDirection.normalize();
      }
      setProtocolCarrierFacing(_carrierFacingQuaternion, _flightDirection);
      _bodyQuaternion.copy(_carrierFacingQuaternion).multiply(_bellRollQuaternion);

      const punch = delivery.hero ? 1 : LIVE.delivery.peerPunchScale;
      const inFlight = phase.phase === 'gather' || phase.phase === 'lob';
      let bodyScale = 0;
      let bodyOpacity = 0;
      let membraneScale = 0;
      const swimPhase = now * JELLY_BELL_PULSE_RATE + delivery.startAge * 5.3;
      const bellPulse = protocolCarrierBellPulse(swimPhase);
      const bellOpenScale = JELLY_BELL_OPEN_MIN
        + JELLY_BELL_OPEN_AMOUNT * bellPulse;
      const bellDepthScale = JELLY_BELL_DEPTH_MAX
        - JELLY_BELL_DEPTH_SWING * bellPulse;
      const tentacleStretch = JELLY_TENTACLE_STRETCH_MIN
        + JELLY_TENTACLE_STRETCH_AMOUNT * (1 - bellPulse);
      const tentacleWidthScale = JELLY_TENTACLE_WIDTH_MIN
        + JELLY_TENTACLE_WIDTH_AMOUNT * bellPulse;

      if (inFlight) {
        const progress = phase.phase === 'lob' ? easeInLob(phase.t) : 0;
        _position.set(
          delivery.from[0] + (delivery.to[0] - delivery.from[0]) * progress,
          delivery.from[1] + (delivery.to[1] - delivery.from[1]) * progress,
          delivery.from[2] + (delivery.to[2] - delivery.from[2]) * progress,
        );
        const grow = phase.phase === 'gather' ? phase.t : 1;
        bodyScale = (
          delivery.hero ? LIVE.delivery.heroSize : LIVE.delivery.peerSize
        ) * grow;
        bodyOpacity = 1;
        membraneScale = LIVE.delivery.bolusBloom * punch * grow * bellOpenScale;

        if (phase.phase === 'lob') {
          const length = (
            LIVE.delivery.trailLenBase + LIVE.delivery.trailLenGain * lobSpeed(phase.t)
          ) * punch * tentacleStretch;
          _trailPosition.copy(_position).addScaledVector(_flightDirection, -length / 2);
          setWakeQuaternion(
            _flightDirection,
            _trailPosition,
            _cameraPosition,
            _wakeQuaternion,
          );
          writeSpriteInstance(
            wakeBatch,
            wakeCount,
            _trailPosition,
            LIVE.delivery.trailWidth * punch * tentacleWidthScale,
            length,
            CARRIER_COLOR,
            LIVE.delivery.trailOpacity * (0.84 + 0.16 * (1 - bellPulse)),
            _wakeQuaternion,
          );
          wakeCount += 1;

          // A contracted bell pushes water/energy backward. Reuse the pressure
          // texture for one faint, expanding propulsion ring per carrier; the
          // stronger instance at contact occupies this same fixed batch later.
          const propulsionT = protocolCarrierShockwaveProgress(swimPhase);
          const propulsionOpacity = 0.30 * Math.pow(1 - propulsionT, 2.4);
          if (propulsionOpacity > 0.004) {
            _wavePosition.copy(_position).addScaledVector(
              _flightDirection,
              -bodyScale * (0.20 + propulsionT * 0.55),
            );
            const propulsionScale = bodyScale * (1.10 + propulsionT * 1.65);
            writeSpriteInstance(
              impactBatch,
              impactCount,
              _wavePosition,
              propulsionScale,
              propulsionScale,
              CARRIER_COLOR,
              propulsionOpacity,
              _carrierFacingQuaternion,
              -bellRoll * 0.35,
            );
            impactCount += 1;
          }
        }
      } else {
        const ingest = bolusIngest(phase.t);
        // Contact is an event boundary, not another travelling object. Keep the
        // carrier and pressure wave pinned to the real landing while the wave
        // spreads across the field and nearby Cells flare in response.
        _position.set(
          delivery.to[0],
          delivery.to[1],
          delivery.to[2],
        );
        const recoil = 1 + LIVE.delivery.recoil * Math.sin(
          Math.min(1, phase.t / 0.32) * Math.PI,
        );
        bodyScale = (
          delivery.hero ? LIVE.delivery.heroSize : LIVE.delivery.peerSize
        ) * ingest.bodyScale * recoil;
        bodyOpacity = ingest.bodyOpacity;
        membraneScale = LIVE.delivery.bolusBloom
          * punch
          * ingest.bodyScale
          * recoil
          * bellOpenScale;

        if (ingest.flashOpacity > 0.001) {
          _flashColor.copy(CARRIER_COLOR).lerp(PALE_CONSENSUS, ingest.colorT);
          const size = LIVE.delivery.flashSize * punch * ingest.impactScale;
          writeSpriteInstance(
            impactBatch,
            impactCount,
            _position,
            size,
            size,
            _flashColor,
            ingest.flashOpacity,
            _carrierFacingQuaternion,
            -bellRoll * 0.45,
          );
          impactCount += 1;
        }
      }

      if (bodyScale > 0.001 && bodyOpacity > 0.001) {
        // Local XY opens/closes the umbrella; local Z (the flight axis) moves
        // inversely, giving the wireframe bell a soft jellyfish contraction.
        _scale.set(
          bodyScale * bellOpenScale,
          bodyScale * bellOpenScale,
          bodyScale * bellDepthScale,
        );
        _matrix.compose(_position, _bodyQuaternion, _scale);
        bodyVertexCount = writeCarrierBody(
          bodyPositions,
          bodyColors,
          bodyVertexCount,
          _matrix,
          CARRIER_COLOR,
          bodyOpacity,
        );
      }
      if (membraneScale > 0.001 && bodyOpacity > 0.001) {
        writeSpriteInstance(
          membraneBatch,
          membraneCount,
          _position,
          membraneScale,
          membraneScale,
          CARRIER_COLOR,
          bodyOpacity,
          _carrierFacingQuaternion,
          -bellRoll * 0.7,
        );
        membraneCount += 1;
      }
    }

    bodyGeometry.setDrawRange(0, bodyVertexCount);
    if (bodyVertexCount > 0) {
      bodyPositionAttr.clearUpdateRanges();
      bodyPositionAttr.addUpdateRange(0, bodyVertexCount * 3);
      bodyPositionAttr.needsUpdate = true;
      bodyColorAttr.clearUpdateRanges();
      bodyColorAttr.addUpdateRange(0, bodyVertexCount * 3);
      bodyColorAttr.needsUpdate = true;
    }
    commitInstanceBatch(membraneBatch, membraneCount);
    commitInstanceBatch(wakeBatch, wakeCount);
    commitInstanceBatch(impactBatch, impactCount);
  });

  return (
    <group>
      <lineSegments
        geometry={bodyGeometry}
        material={bodyMaterial}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={membraneBatchRef}
        args={[spriteGeometry, membraneMaterial, capacity]}
        frustumCulled={false}
        renderOrder={2}
      />
      <instancedMesh
        ref={wakeBatchRef}
        args={[spriteGeometry, wakeMaterial, capacity]}
        frustumCulled={false}
        renderOrder={3}
      />
      <instancedMesh
        ref={impactBatchRef}
        args={[spriteGeometry, impactMaterial, capacity]}
        frustumCulled={false}
        renderOrder={4}
      />
    </group>
  );
}
