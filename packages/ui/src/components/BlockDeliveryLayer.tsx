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
  contactRelease,
  sharedCellNearestIndex,
  nearestCellIdsFromIndex,
  type DeliveryPhaseConfig,
} from '../derives/peers.derive';
import {
  makeCarrierCoreTexture,
  makeCarrierTrailTexture,
} from '../materials/deliveryTextures';
import {
  makeContactWaveAttribute,
  makeContactWaveGeometry,
  makeContactWaveMaterial,
  CONTACT_WAVE_CREST_UV,
  CONTACT_WAVE_WAKE_AHEAD,
  CONTACT_WAVE_WAKE_BEHIND,
} from '../materials/contactWaveMaterial';
import { BEAM_GROW_DUR_S, BEAM_CHARGE_DUR_S } from '../ui/topologyConstants';
import { CELL_GALAXY_PALETTE } from '../visualPalette';
import type { ConsensusFlowColor } from '../derives/consensusFlow.derive';
import {
  makeProtocolCarrierGeometry,
  setProtocolCarrierFacing,
} from '../geometry/protocolCarrier';
import {
  markCellFlashDirty,
  type CellFlashDirtyIdsRef,
} from './cellFlash';

// BlockDeliveryLayer — the network→Cell-field handoff in the A visual language.
//
// ONE IDEA, THREE BEATS: compression, then release.
//   gather — the worker holds still. Its glyph tightens and brightens in place;
//            nothing moves. The stillness is what gives the release a moment.
//   lob    — the glyph rises straight up, accelerating, CONTRACTING as it goes,
//            trailing a hard streak. Smallest and hottest at the membrane.
//   ingest — the seed ring is released as a thin front that races out flat
//            through the Cell field, after one ring is drawn inward and a
//            compact core sears at the landing.
//
// The glyph and the front are the same interrupted polygon at two scales (see
// geometry/protocolCarrier), so the arriving object and the spreading pressure
// are one shape, not two languages meeting at the membrane.
//
// EVERY worker gets its own front, at the SAME wave speed the peer-plane
// brightness wave uses. Identical speed and shape make ~81 latency-staggered
// commits read as one interference field converging on the galaxy core rather
// than as 81 independent events; hero emphasis is scale and reach, never a
// different form. Overlap is kept off the white rail by thin crests, a 1/r
// falloff, the rim's three gaps, and extinction where the tissue ends.
//
// Every real measured node keeps its own timing and transform, but the renderer
// submits the whole event as four semantic batches: sparse low-poly glyph rims,
// plus instanced cores, travel streaks, and contact fronts.
// Delivery count changes instance/vertex counts, never draw-call count.

const CARRIER_GEOM = makeProtocolCarrierGeometry();
const CARRIER_BASE_POSITION = CARRIER_GEOM.getAttribute('position') as THREE.BufferAttribute;
const CARRIER_VERTEX_COUNT = CARRIER_BASE_POSITION.count;
const LOB_DUR_S = BEAM_GROW_DUR_S;

/** How much larger the glyph starts the gather before tightening to its
 *  travelling size. The whole beat is scale and brightness — never motion. */
const GATHER_SWELL = 0.55;
/** Core brightness at the start of the lob; it climbs to 1 as the glyph
 *  compresses, so tightening reads as heating rather than as shrinking away. */
const LOB_CORE_ONSET = 0.55;
/** The core barely shrinks while the rim does, which is what sells compression. */
const LOB_CORE_COMPRESS = 0.20;
/** Widest radius of the drawn-inward ring, in glyph sizes. */
const INHALE_REACH = 3.2;
/** Front radius at the instant of release. Also anchors the 1/r falloff away
 *  from its singularity. */
const WAVE_START_RADIUS = 0.6;
const WAVE_FALLOFF_REFERENCE = 6;
/** Crest widening per second of travel — the same slow spread the peer-plane
 *  wave uses, so neither front reads as a rigid decal. */
const WAVE_WIDTH_GROW = 0.45;
/** Fraction of a front's reach where its extinction begins. */
const WAVE_REACH_KNEE = 0.72;
/** Ceiling on the crest half-width as a fraction of the crest radius. Without
 *  it a young front — radius still a world unit or two — is mostly crest, and
 *  the release reads as a soft doughnut instead of a thin ring leaving. */
const WAVE_WIDTH_RADIUS_CAP = 0.22;
/** Golden-angle roll per delivery so the three rim gaps never align across
 *  workers and the overlapping fronts stay an interference field, not a moiré. */
const WAVE_GAP_ROLL = 2.399963;

const TISSUE_ROSE = new THREE.Color().setRGB(...CELL_GALAXY_PALETTE.tissueRose);
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

function smoothUnit(value: number): number {
  const u = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return u * u * (3 - 2 * u);
}

/** A crest may never be a large fraction of its own radius. */
function crestHalfWidth(width: number, crestRadius: number): number {
  return Math.min(width, crestRadius * WAVE_WIDTH_RADIUS_CAP);
}

// Shared scratch state. Frame callbacks are sequential, and every setter copies
// into a GPU attribute immediately, so no per-frame object allocation is needed.
const _position = new THREE.Vector3();
const _trailPosition = new THREE.Vector3();
const _flightDirection = new THREE.Vector3();
const _cameraPosition = new THREE.Vector3();
const _wakeNormal = new THREE.Vector3();
const _wakeRight = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _bodyQuaternion = new THREE.Quaternion();
const _carrierFacingQuaternion = new THREE.Quaternion();
const _wakeQuaternion = new THREE.Quaternion();
const _spriteQuaternion = new THREE.Quaternion();
const _spriteRollQuaternion = new THREE.Quaternion();
const _wakeBasis = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const _batchColor = new THREE.Color();
const _coreColor = new THREE.Color();
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

/** Billboard a streak only around its travel axis. Local +Y follows the carrier
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

/** One front. The annulus is scaled so its crest lands on the shader's fixed UV
 * radius, which is what keeps the crest razor-thin at any world radius; the
 * per-instance attribute then carries the crest width in that same UV space. */
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
  basisQuaternion: THREE.Quaternion,
  rotationZ: number,
): void {
  const extent = crestRadius / CONTACT_WAVE_CREST_UV;
  writeSpriteInstance(
    batch,
    index,
    position,
    extent,
    extent,
    color,
    intensity,
    basisQuaternion,
    rotationZ,
  );
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

/** Append one transformed glyph to the shared line buffers. Vertex colour is
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
  // A delivery can have its drawn-inward ring and its released front alive on
  // the same frame — never more than those two.
  const waveCapacity = capacity * 2;
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

  const coreTex = useMemo(() => makeCarrierCoreTexture(), []);
  const trailTex = useMemo(() => makeCarrierTrailTexture(), []);
  const spriteGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const coreMaterial = useMemo(() => makeSpriteBatchMaterial(coreTex), [coreTex]);
  const trailMaterial = useMemo(() => makeSpriteBatchMaterial(trailTex), [trailTex]);
  const waveMaterial = useMemo(() => makeContactWaveMaterial(), []);
  const waveShape = useMemo(
    () => makeContactWaveAttribute(waveCapacity),
    [waveCapacity],
  );
  const waveGeometry = useMemo(() => {
    const geometry = makeContactWaveGeometry();
    geometry.setAttribute('aWave', waveShape);
    return geometry;
  }, [waveShape]);

  const coreBatchRef = useRef<THREE.InstancedMesh>(null);
  const trailBatchRef = useRef<THREE.InstancedMesh>(null);
  const waveBatchRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const batches = [
      coreBatchRef.current,
      trailBatchRef.current,
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
  }, [capacity, waveCapacity]);

  // Disposal is split by lifetime on purpose. Delivery count changes whenever
  // peers churn, which rebuilds the two capacity-sized geometries — bundling the
  // shared materials into that same cleanup would dispose a live shader program
  // and force a recompile on an ordinary peer join.
  useEffect(() => () => { bodyGeometry.dispose(); }, [bodyGeometry]);
  useEffect(() => () => { waveGeometry.dispose(); }, [waveGeometry]);
  useEffect(() => () => {
    bodyMaterial.dispose();
    spriteGeometry.dispose();
    coreMaterial.dispose();
    trailMaterial.dispose();
    waveMaterial.dispose();
    coreTex.dispose();
    trailTex.dispose();
  }, [
    bodyMaterial,
    spriteGeometry,
    coreMaterial,
    trailMaterial,
    waveMaterial,
    coreTex,
    trailTex,
  ]);

  useSimFrame((state) => {
    const coreBatch = coreBatchRef.current;
    const trailBatch = trailBatchRef.current;
    const waveBatch = waveBatchRef.current;
    if (!coreBatch || !trailBatch || !waveBatch) return;

    const now = simClock.elapsedSec;
    CFG.ingestDur = LIVE.delivery.ingestDur;
    const pulse = pulseRef.current;
    if (!pulse) {
      bodyGeometry.setDrawRange(0, 0);
      coreBatch.count = 0;
      trailBatch.count = 0;
      waveBatch.count = 0;
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
      coreBatch.count = 0;
      trailBatch.count = 0;
      waveBatch.count = 0;
      ignitedPulseAtRef.current = null;
      return;
    }
    // Three-arg setRGB: the spread form allocates an arguments array per frame.
    CARRIER_COLOR.setRGB(pulse.color[0], pulse.color[1], pulse.color[2]);
    state.camera.getWorldPosition(_cameraPosition);
    waveMaterial.uniforms.uWake.value = LIVE.delivery.waveWake;
    waveMaterial.uniforms.uSegmentDepth.value = LIVE.delivery.waveSegments;

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
    let coreCount = 0;
    let trailCount = 0;
    let waveCount = 0;
    let deliveryIndex = -1;

    for (const delivery of deliveries) {
      deliveryIndex += 1;
      const phase = deliveryPhase(age - delivery.startAge, CFG);
      if (phase.phase === 'idle' || phase.phase === 'done') continue;

      // Local +Z is the glyph's travel direction. Align it with the actual
      // peer→galaxy path; that also lays the rim — and the front it becomes —
      // flat in the Cell plane. Camera motion never changes where it is headed.
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
      _bodyQuaternion.copy(_carrierFacingQuaternion);

      const punch = delivery.hero ? 1 : LIVE.delivery.peerPunchScale;
      const size = delivery.hero
        ? LIVE.delivery.heroSize
        : LIVE.delivery.peerSize;
      const gapRoll = deliveryIndex * WAVE_GAP_ROLL;
      let glyphScale = 0;
      let glyphOpacity = 0;

      if (phase.phase === 'gather') {
        // Held breath: the glyph tightens and brightens where it stands. No
        // travel, no roll, no swim — the beat is the absence of motion.
        _position.set(delivery.from[0], delivery.from[1], delivery.from[2]);
        glyphScale = size * (1 + GATHER_SWELL * (1 - phase.t));
        glyphOpacity = Math.pow(phase.t, 0.6);
        writeSpriteInstance(
          coreBatch,
          coreCount,
          _position,
          glyphScale * LIVE.delivery.glyphBloom,
          glyphScale * LIVE.delivery.glyphBloom,
          CARRIER_COLOR,
          glyphOpacity * LOB_CORE_ONSET,
          _carrierFacingQuaternion,
          gapRoll,
        );
        coreCount += 1;
      } else if (phase.phase === 'lob') {
        const progress = easeInLob(phase.t);
        _position.set(
          delivery.from[0] + (delivery.to[0] - delivery.from[0]) * progress,
          delivery.from[1] + (delivery.to[1] - delivery.from[1]) * progress,
          delivery.from[2] + (delivery.to[2] - delivery.from[2]) * progress,
        );
        glyphScale = size * (1 - LIVE.delivery.glyphCompress * progress);
        glyphOpacity = 1;

        // The core barely shrinks while the rim compresses, so the carrier
        // reads as heating up on the way in rather than dwindling.
        const coreScale = size
          * LIVE.delivery.glyphBloom
          * (1 - LOB_CORE_COMPRESS * progress);
        writeSpriteInstance(
          coreBatch,
          coreCount,
          _position,
          coreScale,
          coreScale,
          CARRIER_COLOR,
          LOB_CORE_ONSET + (1 - LOB_CORE_ONSET) * progress,
          _carrierFacingQuaternion,
          gapRoll,
        );
        coreCount += 1;

        const length = (
          LIVE.delivery.trailLenBase + LIVE.delivery.trailLenGain * lobSpeed(phase.t)
        ) * punch;
        _trailPosition.copy(_position).addScaledVector(_flightDirection, -length / 2);
        setWakeQuaternion(
          _flightDirection,
          _trailPosition,
          _cameraPosition,
          _wakeQuaternion,
        );
        writeSpriteInstance(
          trailBatch,
          trailCount,
          _trailPosition,
          LIVE.delivery.trailWidth * punch,
          length,
          CARRIER_COLOR,
          LIVE.delivery.trailOpacity,
          _wakeQuaternion,
        );
        trailCount += 1;
      } else {
        const release = contactRelease(phase.t);
        // Contact is an event boundary, not another travelling object. The
        // glyph is pinned at the real landing while it is released as a front.
        _position.set(delivery.to[0], delivery.to[1], delivery.to[2]);
        glyphScale = size * release.glyphScale;
        glyphOpacity = release.glyphOpacity;

        if (release.coreOpacity > 0.002) {
          // White at the strike, cooling into the block's own carrier hue.
          _coreColor.copy(WHITE).lerp(CARRIER_COLOR, release.colorT);
          const coreScale = size
            * LIVE.delivery.coreSize
            * punch
            * (1 - 0.3 * phase.t);
          writeSpriteInstance(
            coreBatch,
            coreCount,
            _position,
            coreScale,
            coreScale,
            _coreColor,
            release.coreOpacity,
            _carrierFacingQuaternion,
            gapRoll,
          );
          coreCount += 1;
        }

        // The breath drawn in: one ring contracting onto the landing, its wake
        // trailing outward, just before the front leaves.
        const inhaleOpacity = release.inhaleOpacity * LIVE.delivery.inhaleAmount;
        const inhaleRadius = INHALE_REACH * size * punch * release.inhaleRadius;
        if (inhaleOpacity > 0.004 && inhaleRadius > 0.05) {
          writeWaveInstance(
            waveBatch,
            waveShape,
            waveCount,
            _position,
            inhaleRadius,
            crestHalfWidth(LIVE.delivery.waveWidth * 0.7 * punch, inhaleRadius),
            CONTACT_WAVE_WAKE_AHEAD,
            CARRIER_COLOR,
            inhaleOpacity,
            _carrierFacingQuaternion,
            gapRoll,
          );
          waveCount += 1;
        }

        // The released front. Radius comes from real seconds at the shared wave
        // speed — never from a normalized scale — so every worker's front
        // belongs to the same expanding field.
        const contactAge = phase.t * CFG.ingestDur;
        const crestRadius = WAVE_START_RADIUS
          + LIVE.delivery.waveSpeed * contactAge;
        const reach = delivery.hero
          ? LIVE.delivery.waveReachHero
          : LIVE.delivery.waveReachPeer;
        // Reach is extinction, not a stop: a clamped radius would freeze the
        // front mid-field and break the one-speed reading.
        const reachFade = 1 - smoothUnit(
          (crestRadius - reach * WAVE_REACH_KNEE) / (reach * (1 - WAVE_REACH_KNEE)),
        );
        const falloff = Math.pow(
          WAVE_FALLOFF_REFERENCE / (WAVE_FALLOFF_REFERENCE + crestRadius),
          LIVE.delivery.waveFalloff,
        );
        const intensity = LIVE.delivery.waveOpacity
          * release.frontOpacity
          * falloff
          * reachFade
          * punch;
        if (intensity > 0.002) {
          _waveColor.copy(CARRIER_COLOR).lerp(TISSUE_ROSE, release.colorT);
          writeWaveInstance(
            waveBatch,
            waveShape,
            waveCount,
            _position,
            crestRadius,
            crestHalfWidth(
              LIVE.delivery.waveWidth * (1 + WAVE_WIDTH_GROW * contactAge),
              crestRadius,
            ),
            CONTACT_WAVE_WAKE_BEHIND,
            _waveColor,
            intensity,
            _carrierFacingQuaternion,
            gapRoll,
          );
          waveCount += 1;
        }
      }

      if (glyphScale > 0.001 && glyphOpacity > 0.001) {
        _scale.set(glyphScale, glyphScale, glyphScale);
        _matrix.compose(_position, _bodyQuaternion, _scale);
        bodyVertexCount = writeCarrierBody(
          bodyPositions,
          bodyColors,
          bodyVertexCount,
          _matrix,
          CARRIER_COLOR,
          glyphOpacity,
        );
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
    commitInstanceBatch(coreBatch, coreCount);
    commitInstanceBatch(trailBatch, trailCount);
    commitInstanceBatch(waveBatch, waveCount);
    if (waveCount > 0) {
      waveShape.clearUpdateRanges();
      waveShape.addUpdateRange(0, waveCount * 2);
      waveShape.needsUpdate = true;
    }
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
        ref={coreBatchRef}
        args={[spriteGeometry, coreMaterial, capacity]}
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
        ref={waveBatchRef}
        args={[waveGeometry, waveMaterial, waveCapacity]}
        frustumCulled={false}
        renderOrder={4}
      />
    </group>
  );
}
