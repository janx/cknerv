import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
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
  protocolLandingSealState,
  nearestCellIds,
  type DeliveryPhaseConfig,
} from '../derives/peers.derive';
import {
  makeProtocolCarrierTexture,
  makeIngestFlashTexture,
  makeBolusTrailTexture,
  makeProtocolLandingTexture,
} from '../materials/deliveryTextures';
import { BEAM_GROW_DUR_S, BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';
import { CONSENSUS_BRAID_PALETTE } from '../derives/consensusBraid.derive';
import type { ConsensusFlowColor } from '../derives/consensusFlow.derive';
import { makeProtocolCarrierGeometry } from '../geometry/protocolCarrier';

// BlockDeliveryLayer — the network→Cell-field handoff in the A visual language.
// Every real measured node keeps its own timing and transform, but the renderer
// submits the whole event as five semantic batches: one merged woven-line body,
// plus instanced carrier glyph, information rails, contact flash, and landing
// seal. Delivery count therefore changes instance/vertex counts, not draw calls.

const CARRIER_GEOM = makeProtocolCarrierGeometry();
const CARRIER_BASE_POSITION = CARRIER_GEOM.getAttribute('position') as THREE.BufferAttribute;
const CARRIER_VERTEX_COUNT = CARRIER_BASE_POSITION.count;
const LOB_DUR_S = BEAM_GROW_DUR_S;
const TUMBLE_RATE = 0.78;
const PALE_CONSENSUS = new THREE.Color().setRGB(...CONSENSUS_BRAID_PALETTE.pale);
const CARRIER_COLOR = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const BLACK = new THREE.Color(0, 0, 0);
const LOCAL_Z = new THREE.Vector3(0, 0, 1);

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
const _scale = new THREE.Vector3();
const _bodyEuler = new THREE.Euler();
const _bodyQuaternion = new THREE.Quaternion();
const _cameraQuaternion = new THREE.Quaternion();
const _screenQuaternion = new THREE.Quaternion();
const _instanceQuaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _batchColor = new THREE.Color();
const _flashColor = new THREE.Color();
const _sealColor = new THREE.Color();

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
  });
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
  cameraQuaternion: THREE.Quaternion,
  screenRotation = 0,
): void {
  _instanceQuaternion.copy(cameraQuaternion);
  if (screenRotation !== 0) {
    _screenQuaternion.setFromAxisAngle(LOCAL_Z, screenRotation);
    _instanceQuaternion.multiply(_screenQuaternion);
  }
  _scale.set(width, height, 1);
  _matrix.compose(position, _instanceQuaternion, _scale);
  batch.setMatrixAt(index, _matrix);
  _batchColor.copy(color).multiplyScalar(Math.max(0, opacity));
  batch.setColorAt(index, _batchColor);
}

function commitInstanceBatch(batch: THREE.InstancedMesh, count: number): void {
  batch.count = count;
  if (count === 0) return;
  batch.instanceMatrix.needsUpdate = true;
  if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
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
}: BlockDeliveryLayerProps) {
  const cellsCache = useCellGalaxyOptional();
  const deliveries = useMemo(
    () => planDeliveries(localOrigins, localReceiveDelayS, posById, arrivals, CELLS_Y),
    [localOrigins, localReceiveDelayS, posById, arrivals],
  );
  const capacity = Math.max(1, deliveries.length);
  const ignitedPulseAtRef = useRef<number | null>(null);

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

  const bloomTex = useMemo(() => makeProtocolCarrierTexture(), []);
  const flashTex = useMemo(() => makeIngestFlashTexture(), []);
  const trailTex = useMemo(() => makeBolusTrailTexture(), []);
  const sealTex = useMemo(() => makeProtocolLandingTexture(), []);
  const spriteGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const bloomMaterial = useMemo(() => makeSpriteBatchMaterial(bloomTex), [bloomTex]);
  const trailMaterial = useMemo(() => makeSpriteBatchMaterial(trailTex), [trailTex]);
  const flashMaterial = useMemo(() => makeSpriteBatchMaterial(flashTex), [flashTex]);
  const sealMaterial = useMemo(() => makeSpriteBatchMaterial(sealTex), [sealTex]);

  const bloomBatchRef = useRef<THREE.InstancedMesh>(null);
  const trailBatchRef = useRef<THREE.InstancedMesh>(null);
  const flashBatchRef = useRef<THREE.InstancedMesh>(null);
  const sealBatchRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const batches = [
      bloomBatchRef.current,
      trailBatchRef.current,
      flashBatchRef.current,
      sealBatchRef.current,
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
    bloomMaterial.dispose();
    trailMaterial.dispose();
    flashMaterial.dispose();
    sealMaterial.dispose();
    bloomTex.dispose();
    flashTex.dispose();
    trailTex.dispose();
    sealTex.dispose();
  }, [
    bodyGeometry,
    bodyMaterial,
    spriteGeometry,
    bloomMaterial,
    trailMaterial,
    flashMaterial,
    sealMaterial,
    bloomTex,
    flashTex,
    trailTex,
    sealTex,
  ]);

  useSimFrame((state) => {
    const bloomBatch = bloomBatchRef.current;
    const trailBatch = trailBatchRef.current;
    const flashBatch = flashBatchRef.current;
    const sealBatch = sealBatchRef.current;
    if (!bloomBatch || !trailBatch || !flashBatch || !sealBatch) return;

    const now = simClock.elapsedSec;
    CFG.ingestDur = LIVE.delivery.ingestDur;
    const pulse = pulseRef.current;
    if (!pulse) {
      bodyGeometry.setDrawRange(0, 0);
      bloomBatch.count = 0;
      trailBatch.count = 0;
      flashBatch.count = 0;
      sealBatch.count = 0;
      ignitedPulseAtRef.current = null;
      return;
    }

    const age = now - pulse.at;
    CARRIER_COLOR.setRGB(...pulse.color);
    state.camera.getWorldQuaternion(_cameraQuaternion);
    _bodyEuler.set(
      now * TUMBLE_RATE * 0.62,
      now * TUMBLE_RATE,
      now * TUMBLE_RATE * -0.34,
    );
    _bodyQuaternion.setFromEuler(_bodyEuler);

    // Galaxy RECEIVES the wave: once per real block, schedule a flare on the
    // Cells nearest each real delivery landing. Batching never changes this data
    // path or its event timing.
    if (cellsCache && ignitedPulseAtRef.current !== pulse.at) {
      ignitedPulseAtRef.current = pulse.at;
      const rotY = galaxyFrame.rotationY;
      const cells = cellsCache.cells;
      let budget = LIVE.delivery.igniteMax;
      for (const delivery of deliveries) {
        if (budget <= 0) break;
        const k = Math.min(
          delivery.hero ? LIVE.delivery.igniteKHero : LIVE.delivery.igniteKPeer,
          budget,
        );
        const ids = nearestCellIds(
          [delivery.to[0], delivery.to[2]],
          rotY,
          cells.values(),
          k,
        );
        const ingestSceneS = pulse.at + delivery.startAge + LOB_DUR_S;
        for (let index = 0; index < ids.length; index += 1) {
          const flashAt = ingestSceneS + index * LIVE.delivery.igniteRipple;
          const previous = cellFlashRef.current.get(ids[index]) ?? -1e9;
          if (flashAt > previous) {
            cellFlashRef.current.set(ids[index], flashAt);
            flashDirtyRef.current = true;
          }
          budget -= 1;
        }
      }
    }

    let bodyVertexCount = 0;
    let bloomCount = 0;
    let trailCount = 0;
    let flashCount = 0;
    let sealCount = 0;

    for (const delivery of deliveries) {
      const phase = deliveryPhase(age - delivery.startAge, CFG);
      if (phase.phase === 'idle' || phase.phase === 'done') continue;

      const punch = delivery.hero ? 1 : LIVE.delivery.peerPunchScale;
      const inFlight = phase.phase === 'gather' || phase.phase === 'lob';
      let bodyScale = 0;
      let bodyOpacity = 0;
      let bloomScale = 0;

      if (inFlight) {
        const progress = phase.phase === 'lob' ? easeInLob(phase.t) : 0;
        _position.set(
          delivery.from[0] + (delivery.to[0] - delivery.from[0]) * progress,
          delivery.from[1] + (delivery.to[1] - delivery.from[1]) * progress,
          delivery.from[2] + (delivery.to[2] - delivery.from[2]) * progress,
        );
        const grow = phase.phase === 'gather' ? phase.t : 1;
        bodyScale = (delivery.hero ? LIVE.delivery.heroSize : LIVE.delivery.peerSize) * grow;
        bodyOpacity = 1;
        bloomScale = LIVE.delivery.bolusBloom * punch * grow;

        if (phase.phase === 'lob') {
          const length = (
            LIVE.delivery.trailLenBase + LIVE.delivery.trailLenGain * lobSpeed(phase.t)
          ) * punch;
          _trailPosition.set(_position.x, _position.y - length / 2, _position.z);
          writeSpriteInstance(
            trailBatch,
            trailCount,
            _trailPosition,
            LIVE.delivery.trailWidth * punch,
            length,
            CARRIER_COLOR,
            LIVE.delivery.trailOpacity,
            _cameraQuaternion,
          );
          trailCount += 1;
        }
      } else {
        const ingest = bolusIngest(phase.t);
        const inwardLength = Math.hypot(delivery.to[0], delivery.to[2]) || 1;
        const pull = LIVE.delivery.ingestPull * ingest.pull;
        _position.set(
          delivery.to[0] - (delivery.to[0] / inwardLength) * pull,
          delivery.to[1],
          delivery.to[2] - (delivery.to[2] / inwardLength) * pull,
        );
        bodyScale = (
          delivery.hero ? LIVE.delivery.heroSize : LIVE.delivery.peerSize
        ) * ingest.bodyScale;
        bodyOpacity = ingest.bodyOpacity;
        bloomScale = LIVE.delivery.bolusBloom * punch * ingest.bodyScale;

        if (ingest.flashOpacity > 0.001) {
          const swell = 1 + LIVE.delivery.recoil
            * Math.sin(Math.min(1, phase.t * 3) * Math.PI);
          _flashColor.copy(CARRIER_COLOR).lerp(PALE_CONSENSUS, ingest.colorT);
          const size = LIVE.delivery.flashSize * punch * swell;
          writeSpriteInstance(
            flashBatch,
            flashCount,
            _position,
            size,
            size,
            _flashColor,
            ingest.flashOpacity,
            _cameraQuaternion,
          );
          flashCount += 1;
        }

        const landing = protocolLandingSealState(phase.t);
        if (landing.opacity > 0.001) {
          _sealColor.copy(CARRIER_COLOR).lerp(PALE_CONSENSUS, landing.paleMix);
          const size = LIVE.delivery.ringMax * punch * landing.scale;
          writeSpriteInstance(
            sealBatch,
            sealCount,
            _position,
            size,
            size,
            _sealColor,
            landing.opacity,
            _cameraQuaternion,
            landing.rotation,
          );
          sealCount += 1;
        }
      }

      if (bodyScale > 0.001 && bodyOpacity > 0.001) {
        _scale.setScalar(bodyScale);
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
      if (bloomScale > 0.001 && bodyOpacity > 0.001) {
        writeSpriteInstance(
          bloomBatch,
          bloomCount,
          _position,
          bloomScale,
          bloomScale,
          CARRIER_COLOR,
          bodyOpacity,
          _cameraQuaternion,
        );
        bloomCount += 1;
      }
    }

    bodyGeometry.setDrawRange(0, bodyVertexCount);
    if (bodyVertexCount > 0) {
      bodyPositionAttr.needsUpdate = true;
      bodyColorAttr.needsUpdate = true;
    }
    commitInstanceBatch(bloomBatch, bloomCount);
    commitInstanceBatch(trailBatch, trailCount);
    commitInstanceBatch(flashBatch, flashCount);
    commitInstanceBatch(sealBatch, sealCount);
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
        ref={bloomBatchRef}
        args={[spriteGeometry, bloomMaterial, capacity]}
        frustumCulled={false}
        renderOrder={2}
      />
      <instancedMesh
        ref={trailBatchRef}
        args={[spriteGeometry, trailMaterial, capacity]}
        frustumCulled={false}
        renderOrder={3}
      />
      <instancedMesh
        ref={flashBatchRef}
        args={[spriteGeometry, flashMaterial, capacity]}
        frustumCulled={false}
        renderOrder={4}
      />
      <instancedMesh
        ref={sealBatchRef}
        args={[spriteGeometry, sealMaterial, capacity]}
        frustumCulled={false}
        renderOrder={5}
      />
    </group>
  );
}
