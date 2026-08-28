import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useReducedMotion } from '../components/hud/useReducedMotion';
import type { CellCausalLens } from '../derives/cellCausalLens.derive';
import {
  CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE,
  CONSENSUS_ROUTE_CAMERA_DISTANCE,
  consensusRouteHopWorldPosition,
  deriveConsensusCausalCameraDistance,
  deriveConsensusCausalCameraPose,
  deriveConsensusCellInspectionCameraPose,
  deriveConsensusRecordCameraDistance,
  deriveConsensusRecordCameraIntent,
  deriveConsensusRecordCameraPose,
  deriveConsensusRecordNeutralCameraPose,
  deriveConsensusRecordSafeAnchor,
  deriveConsensusRouteCameraPose,
  type ConsensusCameraWorldPoint,
  type ConsensusRecordCameraScreenRect,
} from '../derives/consensusRouteCamera.derive';
import { deriveCellCausalLensLayout } from '../geometry/cellCausalLens';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { galaxyFrame } from '../tweaks/galaxyFrame';
import { CONSENSUS_MEMORY_RECORD_BRIDGE_MAX_SECONDS } from './consensusMemoryRecordBridge';
import type {
  ConsensusMemoryRouteHopFocus,
  ConsensusMemoryTraceReadout,
} from './consensusMemoryTrace';

const CAMERA_RESPONSE = 6.5;
const POSITION_EPSILON_SQ = 0.0025;
const TARGET_EPSILON_SQ = 0.001;
export const CONSENSUS_ROUTE_CAMERA_RELEASE_HOLD_SECONDS = 0.32;
export const CONSENSUS_RECORD_CAMERA_ENTRY_DELAY_SECONDS =
  CONSENSUS_MEMORY_RECORD_BRIDGE_MAX_SECONDS;

/** The small OrbitControls surface needed by the route camera. */
export interface ConsensusRouteCameraControls {
  target: THREE.Vector3;
  update: () => void;
}

export interface ConsensusRouteCameraProps {
  /** Only a persistent route lock belongs here; hover previews must not move the camera. */
  focus?: ConsensusMemoryRouteHopFocus | null;
  controlsRef: RefObject<ConsensusRouteCameraControls | null>;
  /** Incremented by the host whenever OrbitControls starts a manual gesture. */
  manualRevision?: number;
  /** Exact selected Cell to place in measured HUD-safe inspection space. */
  inspectionCellId?: number | null;
  /** Real selected-Cell transaction geometry that may widen inspection. */
  causalLens?: CellCausalLens | null;
  /** Keep the verified framing while its route afterimage begins to recede. */
  releaseHoldSeconds?: number;
  /** Stable link + target identity; replay nonce must not create a new frame. */
  recordIdentity?: string | null;
  /** Exact real Cell framed only after an independent record switch settles. */
  recordTargetCellId?: number | null;
  /** Exact retained routes whose real Cell extent determines broad framing. */
  recordTraceReadout?: ConsensusMemoryTraceReadout | null;
  /** A different Cell is being mapped, but its record is not recalled yet. */
  recordSwitchPending?: boolean;
  /** Delay broad record framing until endpoint entry has completed. */
  recordEntryDelaySeconds?: number;
  /** Written every frame, never read here: true while this controller owns
   *  the camera — a transition is flying, a release hold is counting down to
   *  one, or a queued transition is waiting its turn. The Cell picker skips
   *  hover probes while it is set, and the adaptive-quality sampler can
   *  exclude those frames; a plain ref, so no render is spent on it. */
  automationActiveRef?: { current: boolean };
}

interface CameraPoseVectors {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface CameraSession {
  returnPose: CameraPoseVectors;
  restPose: CameraPoseVectors;
  manuallyAdjusted: boolean;
  neutralized: boolean;
  inspectionCellId: number | null;
  recordFramed: boolean;
  recordIdentity: string | null;
}

interface CameraTransition {
  pose: CameraPoseVectors;
  restoring: boolean;
}

interface CameraReleaseHold {
  pose: CameraPoseVectors;
  remainingSeconds: number;
  restoring: boolean;
}

interface QueuedCameraTransition {
  transition: CameraTransition;
  remainingSeconds: number;
}

function poseVectors(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): CameraPoseVectors {
  return {
    position: new THREE.Vector3(...position),
    target: new THREE.Vector3(...target),
  };
}

function clonePose(pose: CameraPoseVectors): CameraPoseVectors {
  return {
    position: pose.position.clone(),
    target: pose.target.clone(),
  };
}

function measureHudOcclusions(
  canvas: HTMLCanvasElement,
  viewportWidth: number,
  viewportHeight: number,
): ConsensusRecordCameraScreenRect[] {
  if (typeof document === 'undefined') return [];
  const canvasRect = canvas.getBoundingClientRect();
  const hasCanvasBounds = canvasRect.width > 0 && canvasRect.height > 0;
  const left = hasCanvasBounds ? canvasRect.left : 0;
  const top = hasCanvasBounds ? canvasRect.top : 0;
  const scaleX = hasCanvasBounds ? viewportWidth / canvasRect.width : 1;
  const scaleY = hasCanvasBounds ? viewportHeight / canvasRect.height : 1;
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-hud-occlusion="true"]'),
  ).flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const measured = {
      left: (rect.left - left) * scaleX,
      top: (rect.top - top) * scaleY,
      right: (rect.right - left) * scaleX,
      bottom: (rect.bottom - top) * scaleY,
    };
    const clipped = {
      left: Math.max(0, measured.left),
      top: Math.max(0, measured.top),
      right: Math.min(viewportWidth, measured.right),
      bottom: Math.min(viewportHeight, measured.bottom),
    };
    return clipped.right > clipped.left && clipped.bottom > clipped.top
      ? [clipped]
      : [];
  });
}

/**
 * Frames explicit Cell selection, record recall, and route inspection while
 * hover remains passive. Record replacement crosses identity-free neutral
 * space before a broad target frame; a verified route lock may then move
 * closer. Manual control cancels the remaining automatic session.
 */
export default function ConsensusRouteCamera({
  focus = null,
  controlsRef,
  manualRevision = 0,
  inspectionCellId = null,
  causalLens = null,
  releaseHoldSeconds = CONSENSUS_ROUTE_CAMERA_RELEASE_HOLD_SECONDS,
  recordIdentity = null,
  recordTargetCellId = null,
  recordTraceReadout = null,
  recordSwitchPending = false,
  recordEntryDelaySeconds = CONSENSUS_RECORD_CAMERA_ENTRY_DELAY_SECONDS,
  automationActiveRef,
}: ConsensusRouteCameraProps) {
  const reducedMotion = useReducedMotion();
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const viewportWidth = useThree((state) => state.size.width);
  const viewportHeight = useThree((state) => state.size.height);
  const cellsCache = useCellGalaxy();
  const sessionRef = useRef<CameraSession | null>(null);
  const transitionRef = useRef<CameraTransition | null>(null);
  const releaseHoldRef = useRef<CameraReleaseHold | null>(null);
  const queuedTransitionRef = useRef<QueuedCameraTransition | null>(null);
  const manualRevisionRef = useRef(manualRevision);
  const previousRecordIdentityRef = useRef(recordIdentity);
  const previousRecordSwitchPendingRef = useRef(recordSwitchPending);
  const previousRouteFocusIdentityRef = useRef<string | null>(null);
  const previousInspectionCellIdRef = useRef<number | null>(null);
  const verticalFovDegrees = camera instanceof THREE.PerspectiveCamera
    ? camera.fov
    : 50;
  const compositionKey = `${viewportWidth}:${viewportHeight}:${verticalFovDegrees}`;
  const previousCompositionKeyRef = useRef(compositionKey);

  const causalCameraLocalPoints = useMemo(() => {
    if (
      !causalLens
      || causalLens.status === 'unavailable'
      || causalLens.selectedCell.id !== inspectionCellId
    ) return [];
    const layout = deriveCellCausalLensLayout(causalLens);
    const points: ConsensusCameraWorldPoint[] = [{
      position: [...causalLens.selectedCell.pos_seed],
      role: 'endpoint',
    }];
    points.push({ position: [...layout.hub], role: 'carrier' });
    for (const arc of layout.arcs) {
      points.push({ position: [...arc.control], role: 'carrier' });
      points.push({
        position: [...(arc.role === 'input' ? arc.from : arc.to)],
        role: 'endpoint',
      });
    }
    return points;
  }, [causalLens, inspectionCellId]);
  const causalGeometryKey = causalLens
    && causalLens.status !== 'unavailable'
    && causalLens.selectedCell.id === inspectionCellId
    ? [
      causalLens.key,
      ...causalCameraLocalPoints.map(({ position, role }) => (
        `${role}:${position.join(',')}`
      )),
    ].join('|')
    : '';
  const previousCausalGeometryKeyRef = useRef(causalGeometryKey);

  const recordRouteCells = useMemo(() => {
    if (
      recordIdentity === null
      || recordTargetCellId === null
      || recordTraceReadout?.targetCellId !== recordTargetCellId
      || !recordTraceReadout.key.startsWith(`${recordIdentity}:`)
    ) return [];
    const evidenceRoutes = recordTraceReadout.evidence.filter((evidence) => (
      evidence.route[0] === evidence.sourceId
      && evidence.route.at(-1) === recordTargetCellId
    ));
    const endpointIds = new Set<number>([
      recordTargetCellId,
      ...evidenceRoutes.map((evidence) => evidence.sourceId),
    ]);
    const orderedIds: number[] = [];
    const seen = new Set<number>();
    const append = (id: number) => {
      if (!Number.isFinite(id) || seen.has(id)) return;
      seen.add(id);
      orderedIds.push(id);
    };
    append(recordTargetCellId);
    for (const evidence of evidenceRoutes) {
      evidence.route.forEach(append);
    }
    return orderedIds.map((id) => ({
      id,
      role: endpointIds.has(id) ? 'endpoint' : 'carrier',
    } as const));
  }, [recordIdentity, recordTargetCellId, recordTraceReadout]);
  const recordGeometryKey = recordRouteCells
    .map(({ id, role }) => `${id}:${role}`)
    .join('|');
  const previousRecordGeometryKeyRef = useRef(recordGeometryKey);

  const focusedCell = focus ? cellsCache.cells.get(focus.cellId) ?? null : null;
  const cellX = focusedCell?.pos_seed[0] ?? null;
  const cellY = focusedCell?.pos_seed[1] ?? null;
  const cellZ = focusedCell?.pos_seed[2] ?? null;
  const inspectionCell = inspectionCellId === null
    ? null
    : cellsCache.cells.get(inspectionCellId) ?? null;
  const inspectionCellX = inspectionCell?.pos_seed[0] ?? null;
  const inspectionCellY = inspectionCell?.pos_seed[1] ?? null;
  const inspectionCellZ = inspectionCell?.pos_seed[2] ?? null;
  const recordTargetCell = recordTargetCellId === null
    ? null
    : cellsCache.cells.get(recordTargetCellId) ?? null;
  const recordCellX = recordTargetCell?.pos_seed[0] ?? null;
  const recordCellY = recordTargetCell?.pos_seed[1] ?? null;
  const recordCellZ = recordTargetCell?.pos_seed[2] ?? null;

  useEffect(() => {
    if (manualRevisionRef.current === manualRevision) return;
    manualRevisionRef.current = manualRevision;
    const session = sessionRef.current;
    if (!session) return;
    session.manuallyAdjusted = true;
    transitionRef.current = null;
    queuedTransitionRef.current = null;
    if (releaseHoldRef.current) {
      releaseHoldRef.current = null;
      sessionRef.current = null;
    }
  }, [manualRevision]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const previousRecordIdentity = previousRecordIdentityRef.current;
    const previousSwitchPending = previousRecordSwitchPendingRef.current;
    const previousRouteFocusIdentity = previousRouteFocusIdentityRef.current;
    const previousInspectionCellId = previousInspectionCellIdRef.current;
    const compositionChanged = previousCompositionKeyRef.current !== compositionKey;
    const causalGeometryChanged = previousCausalGeometryKeyRef.current
      !== causalGeometryKey;
    const recordGeometryChanged = previousRecordGeometryKeyRef.current
      !== recordGeometryKey;
    const routeFocusIdentity = focus
      && cellX !== null
      && cellY !== null
      && cellZ !== null
      ? [
        focus.traceKey,
        focus.sourceId,
        focus.targetCellId,
        focus.cellId,
        focus.hopIndex,
      ].join(':')
      : null;
    const recordIntent = deriveConsensusRecordCameraIntent(
      previousRecordIdentity,
      recordIdentity,
      previousSwitchPending,
      recordSwitchPending,
      recordCellX !== null && recordCellY !== null && recordCellZ !== null,
    );
    previousRecordIdentityRef.current = recordIdentity;
    previousRecordSwitchPendingRef.current = recordSwitchPending;
    previousRouteFocusIdentityRef.current = routeFocusIdentity;
    previousInspectionCellIdRef.current = inspectionCellId;
    previousCompositionKeyRef.current = compositionKey;
    previousCausalGeometryKeyRef.current = causalGeometryKey;
    previousRecordGeometryKeyRef.current = recordGeometryKey;

    const existingSession = sessionRef.current;
    if (existingSession?.manuallyAdjusted) {
      transitionRef.current = null;
      releaseHoldRef.current = null;
      queuedTransitionRef.current = null;
      sessionRef.current = null;
      return;
    }

    const ensureSession = (): CameraSession => {
      const existing = sessionRef.current;
      if (existing) return existing;
      const returnPose = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
      const session: CameraSession = {
        returnPose,
        restPose: clonePose(returnPose),
        manuallyAdjusted: false,
        neutralized: false,
        inspectionCellId: null,
        recordFramed: false,
        recordIdentity: null,
      };
      sessionRef.current = session;
      return session;
    };
    const transitionTo = (
      pose: CameraPoseVectors,
      restoring: boolean,
    ) => {
      transitionRef.current = { pose, restoring };
    };
    const holdSeconds = reducedMotion || !Number.isFinite(releaseHoldSeconds)
      ? 0
      : Math.max(0, releaseHoldSeconds);
    const measureSafeComposition = () => {
      const hudOcclusions = measureHudOcclusions(
        canvas,
        viewportWidth,
        viewportHeight,
      );
      const anchor = deriveConsensusRecordSafeAnchor(
        viewportWidth,
        viewportHeight,
        hudOcclusions,
      );
      const composition = {
        viewportWidth,
        viewportHeight,
        verticalFovDegrees,
        anchor,
        cameraUp: camera.up.toArray(),
      };
      return { composition, hudOcclusions };
    };
    const deriveInspectionPose = (): CameraPoseVectors | null => {
      if (
        inspectionCellX === null
        || inspectionCellY === null
        || inspectionCellZ === null
      ) return null;
      const cellWorld = consensusRouteHopWorldPosition(
        [inspectionCellX, inspectionCellY, inspectionCellZ],
        galaxyFrame.rotationY,
      );
      const { composition, hudOcclusions } = measureSafeComposition();
      if (causalCameraLocalPoints.length > 1) {
        const causalWorldPoints = causalCameraLocalPoints.map((point) => ({
          ...point,
          position: consensusRouteHopWorldPosition(
            point.position,
            galaxyFrame.rotationY,
          ),
        }));
        const distance = deriveConsensusCausalCameraDistance(
          camera.position.toArray(),
          controls.target.toArray(),
          cellWorld,
          causalWorldPoints,
          composition,
          hudOcclusions,
        );
        const causal = deriveConsensusCausalCameraPose(
          camera.position.toArray(),
          controls.target.toArray(),
          cellWorld,
          distance,
          composition,
        );
        return poseVectors(causal.position, causal.target);
      }
      const inspection = deriveConsensusCellInspectionCameraPose(
        camera.position.toArray(),
        controls.target.toArray(),
        cellWorld,
        CONSENSUS_CELL_INSPECTION_CAMERA_DISTANCE,
        composition,
      );
      return poseVectors(inspection.position, inspection.target);
    };
    const deriveRecordPose = (): CameraPoseVectors | null => {
      if (recordCellX === null || recordCellY === null || recordCellZ === null) {
        return null;
      }
      const recordWorld = consensusRouteHopWorldPosition(
        [recordCellX, recordCellY, recordCellZ],
        galaxyFrame.rotationY,
      );
      const { composition, hudOcclusions } = measureSafeComposition();
      const routePoints = recordRouteCells.flatMap(({ id, role }) => {
        const cell = cellsCache.cells.get(id);
        return cell ? [{
          position: consensusRouteHopWorldPosition(
            cell.pos_seed,
            galaxyFrame.rotationY,
          ),
          role,
        }] : [];
      });
      const distance = deriveConsensusRecordCameraDistance(
        camera.position.toArray(),
        controls.target.toArray(),
        recordWorld,
        routePoints,
        composition,
        hudOcclusions,
      );
      const record = deriveConsensusRecordCameraPose(
        camera.position.toArray(),
        controls.target.toArray(),
        recordWorld,
        distance,
        composition,
      );
      return poseVectors(record.position, record.target);
    };

    if (recordIntent === 'neutral') {
      const session = ensureSession();
      const neutral = deriveConsensusRecordNeutralCameraPose(
        camera.position.toArray(),
        controls.target.toArray(),
        session.returnPose.position.toArray(),
        session.returnPose.target.toArray(),
      );
      const neutralPose = poseVectors(neutral.position, neutral.target);
      session.restPose = neutralPose;
      session.neutralized = true;
      session.recordFramed = false;
      session.recordIdentity = null;
      queuedTransitionRef.current = null;
      if (holdSeconds > 0) {
        transitionRef.current = null;
        releaseHoldRef.current = {
          pose: neutralPose,
          remainingSeconds: holdSeconds,
          restoring: false,
        };
      } else {
        releaseHoldRef.current = null;
        transitionTo(neutralPose, false);
      }
      return;
    }

    if (
      recordIntent === 'record'
      && recordCellX !== null
      && recordCellY !== null
      && recordCellZ !== null
    ) {
      const session = ensureSession();
      const recordPose = deriveRecordPose();
      if (!recordPose) return;
      session.restPose = recordPose;
      session.recordFramed = true;
      session.recordIdentity = recordIdentity;
      releaseHoldRef.current = null;
      const delaySeconds = reducedMotion
        || !Number.isFinite(recordEntryDelaySeconds)
        ? 0
        : Math.max(0, recordEntryDelaySeconds);
      if (!session.neutralized) {
        const neutral = deriveConsensusRecordNeutralCameraPose(
          camera.position.toArray(),
          controls.target.toArray(),
          session.returnPose.position.toArray(),
          session.returnPose.target.toArray(),
        );
        transitionTo(poseVectors(neutral.position, neutral.target), false);
      }
      session.neutralized = false;
      if (delaySeconds > 0) {
        queuedTransitionRef.current = {
          transition: { pose: recordPose, restoring: false },
          remainingSeconds: delaySeconds,
        };
      } else {
        queuedTransitionRef.current = null;
        transitionTo(recordPose, false);
      }
      return;
    }

    if (
      recordIntent === 'idle'
      && (compositionChanged || recordGeometryChanged)
      && routeFocusIdentity === null
      && existingSession?.recordFramed
      && existingSession.recordIdentity === recordIdentity
    ) {
      const recordPose = deriveRecordPose();
      if (!recordPose) return;
      existingSession.restPose = recordPose;
      const queued = queuedTransitionRef.current;
      if (queued) queued.transition.pose = recordPose;
      else transitionTo(recordPose, false);
      return;
    }

    if (focus && cellX !== null && cellY !== null && cellZ !== null) {
      releaseHoldRef.current = null;
      queuedTransitionRef.current = null;
      ensureSession();
      const hopWorld = consensusRouteHopWorldPosition(
        [cellX, cellY, cellZ],
        galaxyFrame.rotationY,
      );
      const { composition } = measureSafeComposition();
      const pose = deriveConsensusRouteCameraPose(
        camera.position.toArray(),
        controls.target.toArray(),
        hopWorld,
        CONSENSUS_ROUTE_CAMERA_DISTANCE,
        composition,
      );
      transitionRef.current = {
        pose: poseVectors(pose.position, pose.target),
        restoring: false,
      };
      return;
    }

    const inspectionChanged = previousInspectionCellId !== inspectionCellId;
    if (
      recordIdentity === null
      && routeFocusIdentity === null
      && inspectionCellId !== null
      && (
        inspectionChanged
        || (
          (compositionChanged || causalGeometryChanged)
          && existingSession?.inspectionCellId === inspectionCellId
        )
      )
    ) {
      const inspectionPose = deriveInspectionPose();
      if (!inspectionPose) return;
      const session = ensureSession();
      session.restPose = inspectionPose;
      session.inspectionCellId = inspectionCellId;
      session.recordFramed = false;
      session.recordIdentity = null;
      session.neutralized = false;
      releaseHoldRef.current = null;
      queuedTransitionRef.current = null;
      transitionTo(inspectionPose, false);
      return;
    }

    const session = sessionRef.current;
    if (!session) return;
    const recordEnded = previousRecordIdentity !== null
      && recordIdentity === null;
    const routeFocusReleased = previousRouteFocusIdentity !== null
      && routeFocusIdentity === null;
    const inspectionEnded = previousInspectionCellId !== null
      && inspectionCellId === null
      && recordIdentity === null;
    if (!recordEnded && !routeFocusReleased && !inspectionEnded) return;
    if (
      routeFocusReleased
      && !recordEnded
      && queuedTransitionRef.current
    ) return;
    queuedTransitionRef.current = null;
    if (
      routeFocusReleased
      && !recordEnded
      && session.recordFramed
      && session.recordIdentity === recordIdentity
    ) {
      const recordPose = deriveRecordPose();
      if (recordPose) session.restPose = recordPose;
    }
    let restoring = false;
    let restPose = session.restPose;
    if (recordIdentity === null) {
      const inspectionPose = deriveInspectionPose();
      if (inspectionPose && inspectionCellId !== null) {
        session.restPose = inspectionPose;
        session.inspectionCellId = inspectionCellId;
        session.recordFramed = false;
        session.recordIdentity = null;
        restPose = inspectionPose;
      } else {
        restoring = true;
        restPose = session.returnPose;
      }
    }
    if (holdSeconds > 0) {
      transitionRef.current = null;
      releaseHoldRef.current = {
        pose: restPose,
        remainingSeconds: holdSeconds,
        restoring,
      };
      return;
    }
    transitionRef.current = {
      pose: restPose,
      restoring,
    };
  }, [
    camera,
    canvas,
    causalCameraLocalPoints,
    causalGeometryKey,
    cellX,
    cellY,
    cellZ,
    controlsRef,
    compositionKey,
    focus?.cellId,
    focus?.hopIndex,
    focus?.sourceId,
    focus?.targetCellId,
    focus?.traceKey,
    inspectionCellId,
    inspectionCellX,
    inspectionCellY,
    inspectionCellZ,
    recordCellX,
    recordCellY,
    recordCellZ,
    recordEntryDelaySeconds,
    recordGeometryKey,
    recordIdentity,
    recordSwitchPending,
    reducedMotion,
    releaseHoldSeconds,
    verticalFovDegrees,
    viewportHeight,
    viewportWidth,
  ]);

  const stepCamera = (deltaSeconds: number): void => {
    const safeDeltaSeconds = Math.min(Math.max(deltaSeconds, 0), 0.1);
    const queued = queuedTransitionRef.current;
    if (queued) {
      queued.remainingSeconds -= safeDeltaSeconds;
      if (queued.remainingSeconds <= 0) {
        transitionRef.current = queued.transition;
        queuedTransitionRef.current = null;
      }
    }
    const releaseHold = releaseHoldRef.current;
    if (releaseHold) {
      releaseHold.remainingSeconds -= safeDeltaSeconds;
      if (releaseHold.remainingSeconds > 0) return;
      releaseHoldRef.current = null;
      transitionRef.current = {
        pose: releaseHold.pose,
        restoring: releaseHold.restoring,
      };
    }
    const transition = transitionRef.current;
    const controls = controlsRef.current;
    if (!transition || !controls) return;

    const alpha = reducedMotion
      ? 1
      : 1 - Math.exp(-safeDeltaSeconds * CAMERA_RESPONSE);
    camera.position.lerp(transition.pose.position, alpha);
    controls.target.lerp(transition.pose.target, alpha);
    controls.update();

    if (
      camera.position.distanceToSquared(transition.pose.position) > POSITION_EPSILON_SQ
      || controls.target.distanceToSquared(transition.pose.target) > TARGET_EPSILON_SQ
    ) return;

    camera.position.copy(transition.pose.position);
    controls.target.copy(transition.pose.target);
    controls.update();
    transitionRef.current = null;
    if (transition.restoring) sessionRef.current = null;
  };

  useFrame((_, deltaSeconds) => {
    stepCamera(deltaSeconds);
    // Published after the step, so the frame the flight settles on is the
    // first frame reported at rest — and a manual cancel (the effect above)
    // reads as at rest on the very next frame.
    if (automationActiveRef) {
      automationActiveRef.current = transitionRef.current !== null
        || releaseHoldRef.current !== null
        || queuedTransitionRef.current !== null;
    }
  });

  useEffect(() => () => {
    // A flag that outlived its writer would keep hover suspended for good.
    if (automationActiveRef) automationActiveRef.current = false;
  }, [automationActiveRef]);

  return null;
}
