// Locked route-hop glyphs — one procedural, Cell-anchored marker that makes
// the HUD's source / display-carrier / maintained-record semantics spatial.
// Intermediate Cells remain explicitly visual routing context, never lineage.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useReducedMotion } from '../components/hud/useReducedMotion';
import {
  CONSENSUS_ROUTE_HOP_AGREEMENT_CAP,
  deriveConsensusRouteHopAgreementCallout,
  deriveConsensusRouteHopAgreementEmphasis,
  deriveConsensusRouteHopAgreementNavigationIndex,
  deriveConsensusRouteHopAgreementPlan,
  type ConsensusRouteHopAgreementPlan,
} from '../derives/consensusRouteHopAgreement.derive';
import {
  CELL_CONTENT_ADDRESS_CYAN,
  CELL_CONTENT_ADDRESS_HALF_SPAN_MAX,
  CELL_CONTENT_ADDRESS_HALF_SPAN_MIN,
  CELL_CONTENT_ADDRESS_RADIUS_MAX,
  CELL_CONTENT_ADDRESS_RADIUS_MIN,
  CELL_CONTENT_ADDRESS_SPINE_THRESHOLD,
  CELL_CONTENT_ADDRESS_VIOLET,
  deriveCellContentAddressEncoding,
  type CellContentAddressEncoding,
} from '../derives/cellContentAddress.derive';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemorySourceHandoffActive,
  consensusMemorySourceHandoffEvidenceScale,
  consensusMemorySourceHandoffProgress,
  type ConsensusMemorySourceHandoff,
} from './consensusMemorySourceHandoff';
import {
  CONSENSUS_ROUTE_HOP_PULSE_MS,
  CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
  consensusMemoryRouteHopPulseFrame,
  consensusMemoryRouteHopPulseKey,
  type ConsensusMemoryRouteHopPulseClock,
} from './consensusRouteHopPulse';
import {
  consensusRouteHopAddressResidueFrame,
  type ConsensusRouteHopAddressResidueFrame,
} from './consensusRouteHopAddressResidue';
import {
  frameDatasetBind,
  frameDatasetDelete,
  frameDatasetWrite,
  frameDatasetWriteNumber,
  frameDatasetWriteVector,
  frameStyleWriteNumber,
  makeFrameDatasetLedger,
} from './frameDatasetLedger';
import {
  consensusMemoryTraceFocusStrength,
  consensusMemoryCellResponseForFrame,
  classifyConsensusMemoryRouteHopTransition,
  deriveConsensusMemoryRouteHopSpatialFocus,
  deriveConsensusMemoryRouteHopTangent,
  shouldAnimateConsensusMemoryRouteHopTargetLatch,
  type ConsensusMemoryCellResponse,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryRouteHopRole,
  type ConsensusMemoryRouteHopSpatialFocus,
  type ConsensusMemoryTraceFocus,
} from './consensusMemoryTrace';

const PALE = [0.79, 0.98, 1] as const;
const CYAN = [0.13, 0.94, 1] as const;
const VIOLET = [0.58, 0.38, 1] as const;
const GOLD = [1, 0.72, 0.38] as const;
const HANDOFF_MIN_SECONDS = 0.28;
const HANDOFF_MAX_SECONDS = 0.48;
const HANDOFF_SECONDS_PER_UNIT = 0.018;
const TARGET_LATCH_SECONDS = 0.82;
const EMPTY_AGREEMENT_PLAN: ConsensusRouteHopAgreementPlan = {
  targetCellId: -1,
  routedSourceCount: 0,
  visibleSourceCount: 0,
  hiddenSourceCount: 0,
  ticks: [],
};

interface RolePresentation {
  index: number;
  label: string;
  claim: string;
  primary: readonly [number, number, number];
  secondary: readonly [number, number, number];
  radius: number;
}

interface GlyphWaypoint {
  spatial: ConsensusMemoryRouteHopSpatialFocus;
  presentation: RolePresentation;
  agreementPlan: ConsensusRouteHopAgreementPlan;
  position: THREE.Vector3;
  phase: number;
}

interface GlyphSegment {
  from: GlyphWaypoint;
  to: GlyphWaypoint;
  elapsedSeconds: number;
  durationSeconds: number;
}

interface GlyphMotion {
  destination: GlyphWaypoint;
  segment: GlyphSegment | null;
  queue: GlyphWaypoint[];
  latch: GlyphLatch | null;
  latchedCellId: number | null;
}

interface GlyphLatch {
  cellId: number;
  elapsedSeconds: number;
  durationSeconds: number;
}

interface SourceHandoffAudit {
  key: string;
  traceKey: string;
  fromSourceId: number;
  toSourceId: number;
  frames: number;
  minProgress: number;
  maxProgress: number;
  midDistance: number;
  midProgress: number;
  midAgreementScales: string;
}

function rolePresentation(
  spatial: ConsensusMemoryRouteHopSpatialFocus,
): RolePresentation {
  if (spatial.role === 'source') {
    return {
      index: 0,
      label: 'EVIDENCE SOURCE',
      claim: 'REAL RETAINED EVIDENCE',
      primary: spatial.routeColor,
      secondary: PALE,
      radius: 1.55,
    };
  }
  if (spatial.role === 'target') {
    return {
      index: 2,
      label: 'MAINTAINED RECORD',
      claim: 'REAL TARGET RECORD',
      primary: GOLD,
      secondary: VIOLET,
      radius: 1.68,
    };
  }
  return {
    index: 1,
    label: 'DISPLAY CARRIER',
    claim: 'NO CAUSAL CLAIM',
    primary: CYAN,
    secondary: spatial.routeColor,
    radius: 1.48,
  };
}

function cssColor(
  color: readonly [number, number, number],
  alpha = 1,
): string {
  const channels = color
    .map((channel) => Math.round(channel * 255))
    .join(' ');
  return `rgb(${channels} / ${alpha})`;
}

function glyphPhase(cellId: number): number {
  return ((cellId % 4096) * 0.61803398875 % 1) * Math.PI * 2;
}

function glyphWaypoint(
  spatial: ConsensusMemoryRouteHopSpatialFocus,
  presentation: RolePresentation,
  agreementPlan: ConsensusRouteHopAgreementPlan,
): GlyphWaypoint {
  return {
    spatial,
    presentation,
    agreementPlan,
    position: new THREE.Vector3(...spatial.cell.pos_seed),
    phase: glyphPhase(spatial.cell.id),
  };
}

function glyphSegment(from: GlyphWaypoint, to: GlyphWaypoint): GlyphSegment {
  return {
    from,
    to,
    elapsedSeconds: 0,
    durationSeconds: THREE.MathUtils.clamp(
      HANDOFF_MIN_SECONDS
        + from.position.distanceTo(to.position) * HANDOFF_SECONDS_PER_UNIT,
      HANDOFF_MIN_SECONDS,
      HANDOFF_MAX_SECONDS,
    ),
  };
}

function smoothstep01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function phaseLerp(from: number, to: number, progress: number): number {
  const turn = Math.PI * 2;
  const delta = ((to - from + Math.PI) % turn + turn) % turn - Math.PI;
  return from + delta * progress;
}

function applyAgreementPlan(
  material: THREE.ShaderMaterial,
  plan: ConsensusRouteHopAgreementPlan,
): void {
  material.uniforms.uAgreementCount.value = plan.visibleSourceCount;
  for (let index = 0; index < CONSENSUS_ROUTE_HOP_AGREEMENT_CAP; index += 1) {
    const tick = plan.ticks[index] ?? null;
    material.uniforms[`uAgreementAngle${index}`].value = tick?.angle ?? 0;
    material.uniforms[`uAgreementArrival${index}`].value =
      tick?.arrivalProgress ?? 1;
    material.uniforms[`uAgreementFocus${index}`].value = 1;
    material.uniforms[`uAgreementStrength${index}`].value = 0;
    material.uniforms[`uAgreementColor${index}`].value.setRGB(
      ...(tick?.color ?? PALE),
    );
  }
}

function applyGlyphBlend(
  material: THREE.ShaderMaterial,
  from: GlyphWaypoint,
  to: GlyphWaypoint,
  progress: number,
): void {
  const t = smoothstep01(progress);
  const fromRole = from.presentation;
  const toRole = to.presentation;
  applyAgreementPlan(
    material,
    to.agreementPlan.visibleSourceCount > 0
      ? to.agreementPlan
      : from.agreementPlan,
  );
  material.uniforms.uRole.value = THREE.MathUtils.lerp(
    fromRole.index,
    toRole.index,
    t,
  );
  material.uniforms.uRadius.value = THREE.MathUtils.lerp(
    fromRole.radius,
    toRole.radius,
    t,
  );
  material.uniforms.uPhase.value = phaseLerp(from.phase, to.phase, t);
  material.uniforms.uPrimary.value.setRGB(
    THREE.MathUtils.lerp(fromRole.primary[0], toRole.primary[0], t),
    THREE.MathUtils.lerp(fromRole.primary[1], toRole.primary[1], t),
    THREE.MathUtils.lerp(fromRole.primary[2], toRole.primary[2], t),
  );
  material.uniforms.uSecondary.value.setRGB(
    THREE.MathUtils.lerp(fromRole.secondary[0], toRole.secondary[0], t),
    THREE.MathUtils.lerp(fromRole.secondary[1], toRole.secondary[1], t),
    THREE.MathUtils.lerp(fromRole.secondary[2], toRole.secondary[2], t),
  );
}

function applyGlyphWaypoint(
  material: THREE.ShaderMaterial,
  waypoint: GlyphWaypoint,
): void {
  applyGlyphBlend(material, waypoint, waypoint, 1);
}

/** Convergence of one routed source inside a shared frame response. Index
 *  loop rather than `find`: this runs once per agreement tick per frame, and
 *  the predicate closure is exactly the allocation being removed. */
function agreementConvergence(
  response: ConsensusMemoryCellResponse | null,
  sourceId: number,
): number {
  const evidence = response?.evidence;
  if (!evidence) return 0;
  for (let index = 0; index < evidence.length; index += 1) {
    if (evidence[index].sourceId === sourceId) {
      return evidence[index].convergence;
    }
  }
  return 0;
}

function motionAgreementPlan(motion: GlyphMotion): ConsensusRouteHopAgreementPlan {
  const segment = motion.segment;
  if (!segment) return motion.destination.agreementPlan;
  return segment.to.agreementPlan.visibleSourceCount > 0
    ? segment.to.agreementPlan
    : segment.from.agreementPlan;
}

function clearTargetLatch(material: THREE.ShaderMaterial): void {
  material.uniforms.uLatchActive.value = 0;
  material.uniforms.uLatchProgress.value = 0;
}

function clearFocusPulse(material: THREE.ShaderMaterial): void {
  material.uniforms.uFocusPulseProgress.value = 1;
  material.uniforms.uFocusPulseStrength.value = 0;
}

function applyAddressEncoding(
  material: THREE.ShaderMaterial,
  encoding: CellContentAddressEncoding,
): void {
  material.uniforms.uAddressLaneA.value.set(
    encoding.lanes[0],
    encoding.lanes[1],
    encoding.lanes[2],
    encoding.lanes[3],
  );
  material.uniforms.uAddressLaneB.value.set(
    encoding.lanes[4],
    encoding.lanes[5],
    encoding.lanes[6],
    encoding.lanes[7],
  );
  material.uniforms.uAddressPhase.value = encoding.phase;
}

function applyAddressResidueFrame(
  material: THREE.ShaderMaterial,
  frame: ConsensusRouteHopAddressResidueFrame,
): void {
  material.uniforms.uAddressReveal.value = frame.reveal;
  material.uniforms.uAddressStrength.value = frame.strength;
}

function clearAddressResidue(material: THREE.ShaderMaterial): void {
  material.uniforms.uAddressReveal.value = 0;
  material.uniforms.uAddressStrength.value = 0;
}

function makeGlyphMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRole: { value: 1 },
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uRouteAngle: { value: 0 },
      uLatchActive: { value: 0 },
      uLatchProgress: { value: 0 },
      uFocusPulseProgress: { value: 1 },
      uFocusPulseStrength: { value: 0 },
      uAddressLaneA: { value: new THREE.Vector4() },
      uAddressLaneB: { value: new THREE.Vector4() },
      uAddressPhase: { value: 0 },
      uAddressReveal: { value: 0 },
      uAddressStrength: { value: 0 },
      uAgreementCount: { value: 0 },
      uAgreementAngle0: { value: 0 },
      uAgreementAngle1: { value: 0 },
      uAgreementAngle2: { value: 0 },
      uAgreementArrival0: { value: 1 },
      uAgreementArrival1: { value: 1 },
      uAgreementArrival2: { value: 1 },
      uAgreementFocus0: { value: 1 },
      uAgreementFocus1: { value: 1 },
      uAgreementFocus2: { value: 1 },
      uAgreementStrength0: { value: 0 },
      uAgreementStrength1: { value: 0 },
      uAgreementStrength2: { value: 0 },
      uAgreementColor0: { value: new THREE.Color(...PALE) },
      uAgreementColor1: { value: new THREE.Color(...PALE) },
      uAgreementColor2: { value: new THREE.Color(...PALE) },
      uOpacity: { value: 0 },
      uRadius: { value: 1.5 },
      uViewportHeight: { value: 1 },
      uPixelRatio: { value: 1 },
      uPrimary: { value: new THREE.Color(...CYAN) },
      uSecondary: { value: new THREE.Color(...PALE) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uRadius;
      uniform float uViewportHeight;
      uniform float uPixelRatio;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float worldDiameterPx = (uRadius * 2.0) * (uViewportHeight * 0.5) / max(0.001, -mv.z);
        float cssDiameterPx = clamp(max(78.0, worldDiameterPx * 1.35), 78.0, 118.0);
        gl_PointSize = cssDiameterPx * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uRole;
      uniform float uTime;
      uniform float uPhase;
      uniform float uRouteAngle;
      uniform float uLatchActive;
      uniform float uLatchProgress;
      uniform float uFocusPulseProgress;
      uniform float uFocusPulseStrength;
      uniform vec4 uAddressLaneA;
      uniform vec4 uAddressLaneB;
      uniform float uAddressPhase;
      uniform float uAddressReveal;
      uniform float uAddressStrength;
      uniform float uAgreementCount;
      uniform float uAgreementAngle0;
      uniform float uAgreementAngle1;
      uniform float uAgreementAngle2;
      uniform float uAgreementArrival0;
      uniform float uAgreementArrival1;
      uniform float uAgreementArrival2;
      uniform float uAgreementFocus0;
      uniform float uAgreementFocus1;
      uniform float uAgreementFocus2;
      uniform float uAgreementStrength0;
      uniform float uAgreementStrength1;
      uniform float uAgreementStrength2;
      uniform vec3 uAgreementColor0;
      uniform vec3 uAgreementColor1;
      uniform vec3 uAgreementColor2;
      uniform float uOpacity;
      uniform vec3 uPrimary;
      uniform vec3 uSecondary;

      mat2 rotate2d(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c);
      }
      float stroke(float distanceToLine, float width) {
        return exp(-pow(distanceToLine / width, 2.0));
      }
      float ring(float radius, float center, float width) {
        return stroke(abs(radius - center), width);
      }
      float segmentDistance(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / max(0.0001, dot(ba, ba)), 0.0, 1.0);
        return length(pa - ba * h);
      }
      float segment(vec2 p, vec2 a, vec2 b, float width) {
        return stroke(segmentDistance(p, a, b), width);
      }
      float angularTick(float angle, float centre) {
        float delta = abs(atan(sin(angle - centre), cos(angle - centre)));
        return exp(-pow(delta / 0.090, 2.0));
      }
      float addressLane(float index) {
        if (index < 0.5) return uAddressLaneA.x;
        if (index < 1.5) return uAddressLaneA.y;
        if (index < 2.5) return uAddressLaneA.z;
        if (index < 3.5) return uAddressLaneA.w;
        if (index < 4.5) return uAddressLaneB.x;
        if (index < 5.5) return uAddressLaneB.y;
        if (index < 6.5) return uAddressLaneB.z;
        return uAddressLaneB.w;
      }

      void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0 || uOpacity <= 0.001) discard;
        float theta = atan(p.y, p.x);
        // Evidence source: three independent, broken contributor orbits
        // converge on one addressable knot without forming an atom icon.
        vec2 sourceA = rotate2d(uPhase + uTime * 0.055) * p;
        vec2 sourceB = rotate2d(uPhase + 1.047 - uTime * 0.042) * p;
        vec2 sourceC = rotate2d(uPhase - 1.047 + uTime * 0.034) * p;
        float sourceGateA = smoothstep(0.16, 0.48, abs(sin(theta * 3.0 + 0.4)));
        float sourceGateB = smoothstep(0.14, 0.46, abs(sin(theta * 3.0 - 0.8)));
        float sourceOrbitA = ring(length(vec2(sourceA.x, sourceA.y * 1.72)), 0.62, 0.024)
          * sourceGateA;
        float sourceOrbitB = ring(length(vec2(sourceB.x, sourceB.y * 1.72)), 0.62, 0.022)
          * sourceGateB;
        float sourceOrbitC = ring(length(vec2(sourceC.x, sourceC.y * 1.72)), 0.62, 0.020)
          * 0.68;
        float sourceNodes = ring(r, 0.67, 0.043)
          * exp(-pow(abs(sin(theta * 1.5 + uPhase)) / 0.085, 2.0));
        float sourceKnot = 1.0 - smoothstep(0.075, 0.145, abs(p.x) + abs(p.y));
        float sourceGlyph = sourceOrbitA + sourceOrbitB + sourceOrbitC
          + sourceNodes * 1.1 + sourceKnot;
        float sourceSecondary = sourceOrbitC * 0.6 + sourceNodes + sourceKnot;

        // Display carrier: an open, bidirectional waveguide. Its screen-space
        // axis follows the real previous→current→next route tangent.
        vec2 carrierP = rotate2d(uRouteAngle) * p;
        float carrierWindow = 1.0 - smoothstep(0.70, 0.84, abs(carrierP.x));
        float carrierWave = 0.13 * sin(carrierP.x * 6.2 - uTime * 1.2);
        float carrierRails = (
          stroke(abs(carrierP.y - carrierWave), 0.022)
          + stroke(abs(carrierP.y + carrierWave), 0.022)
        ) * carrierWindow;
        float carrierLeftGate = segment(
          carrierP,
          vec2(-0.78, -0.34),
          vec2(-0.55, 0.0),
          0.026
        ) + segment(
          carrierP,
          vec2(-0.78, 0.34),
          vec2(-0.55, 0.0),
          0.026
        );
        float carrierRightGate = segment(
          carrierP,
          vec2(0.78, -0.34),
          vec2(0.55, 0.0),
          0.026
        ) + segment(
          carrierP,
          vec2(0.78, 0.34),
          vec2(0.55, 0.0),
          0.026
        );
        float carrierAperture = ring(
          length(vec2(carrierP.x * 1.58, carrierP.y)),
          0.49,
          0.025
        ) * smoothstep(0.12, 0.42, abs(carrierP.y));
        float carrierRelay = ring(
          abs(carrierP.x) + abs(carrierP.y),
          0.18,
          0.026
        );
        float carrierGlyph = carrierRails + carrierLeftGate + carrierRightGate
          + carrierAperture * 0.72 + carrierRelay;
        float carrierSecondary = carrierRails * 0.45 + carrierRelay
          + carrierAperture * 0.35;

        // Maintained record: counter-phased checksum rings close around one
        // stable knot; four sparse brackets make the state addressable.
        vec2 targetP = rotate2d(uPhase + uTime * 0.035) * p;
        float targetOuterGate = smoothstep(
          0.18,
          0.48,
          abs(sin(theta * 4.0 + uTime * 0.12))
        );
        float targetInnerGate = smoothstep(
          0.14,
          0.44,
          abs(sin(theta * 3.0 - uTime * 0.10 + 0.7))
        );
        float targetOuter = ring(length(targetP), 0.70, 0.025) * targetOuterGate;
        float targetInner = ring(r, 0.48, 0.022) * targetInnerGate;
        float latchProgress = clamp(uLatchProgress, 0.0, 1.0);
        float latchClose = smoothstep(0.04, 0.68, latchProgress);
        float latchEnvelope = uLatchActive
          * sin(3.14159265 * latchProgress);
        // Evidence identities sit outside the maintained record as sparse
        // address signatures, clear of the Cell body's own bright nucleus.
        float agreementRing = ring(r, 0.82, 0.034) * 1.18;
        float agreementStem = smoothstep(0.64, 0.69, r)
          * (1.0 - smoothstep(0.80, 0.85, r)) * 0.34;
        float agreementAddress = agreementRing + agreementStem;
        float agreementEnable0 = step(0.5, uAgreementCount);
        float agreementEnable1 = step(1.5, uAgreementCount);
        float agreementEnable2 = step(2.5, uAgreementCount);
        float agreementReplay0 = mix(
          1.0,
          0.16 + 0.84 * smoothstep(
            uAgreementArrival0,
            uAgreementArrival0 + 0.10,
            latchProgress
          ),
          uLatchActive
        );
        float agreementReplay1 = mix(
          1.0,
          0.16 + 0.84 * smoothstep(
            uAgreementArrival1,
            uAgreementArrival1 + 0.10,
            latchProgress
          ),
          uLatchActive
        );
        float agreementReplay2 = mix(
          1.0,
          0.16 + 0.84 * smoothstep(
            uAgreementArrival2,
            uAgreementArrival2 + 0.10,
            latchProgress
          ),
          uLatchActive
        );
        float agreementPulse0 = uLatchActive * uAgreementStrength0
          * exp(-pow((latchProgress - uAgreementArrival0) / 0.065, 2.0));
        float agreementPulse1 = uLatchActive * uAgreementStrength1
          * exp(-pow((latchProgress - uAgreementArrival1) / 0.065, 2.0));
        float agreementPulse2 = uLatchActive * uAgreementStrength2
          * exp(-pow((latchProgress - uAgreementArrival2) / 0.065, 2.0));
        float agreementTick0 = agreementAddress
          * angularTick(theta, uAgreementAngle0)
          * agreementEnable0
          * uAgreementFocus0
          * (
            mix(0.14, 1.0, uAgreementStrength0) * agreementReplay0
            + agreementPulse0 * 0.9
          );
        float agreementTick1 = agreementAddress
          * angularTick(theta, uAgreementAngle1)
          * agreementEnable1
          * uAgreementFocus1
          * (
            mix(0.14, 1.0, uAgreementStrength1) * agreementReplay1
            + agreementPulse1 * 0.9
          );
        float agreementTick2 = agreementAddress
          * angularTick(theta, uAgreementAngle2)
          * agreementEnable2
          * uAgreementFocus2
          * (
            mix(0.14, 1.0, uAgreementStrength2) * agreementReplay2
            + agreementPulse2 * 0.9
          );
        float agreementGlyph = agreementTick0 + agreementTick1 + agreementTick2;
        vec3 agreementEmission = uAgreementColor0 * agreementTick0
          + uAgreementColor1 * agreementTick1
          + uAgreementColor2 * agreementTick2;
        float targetBracketOuter = mix(
          0.76,
          mix(0.86, 0.76, latchClose),
          uLatchActive
        );
        float targetBracketInner = mix(
          0.58,
          mix(0.48, 0.58, latchClose),
          uLatchActive
        );
        float targetBrackets = 0.0;
        targetBrackets += segment(
          p,
          vec2(-targetBracketOuter, -targetBracketInner),
          vec2(-targetBracketOuter, -targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(-targetBracketOuter, -targetBracketOuter),
          vec2(-targetBracketInner, -targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(targetBracketOuter, -targetBracketInner),
          vec2(targetBracketOuter, -targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(targetBracketOuter, -targetBracketOuter),
          vec2(targetBracketInner, -targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(-targetBracketOuter, targetBracketInner),
          vec2(-targetBracketOuter, targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(-targetBracketOuter, targetBracketOuter),
          vec2(-targetBracketInner, targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(targetBracketOuter, targetBracketInner),
          vec2(targetBracketOuter, targetBracketOuter),
          0.024
        );
        targetBrackets += segment(
          p,
          vec2(targetBracketOuter, targetBracketOuter),
          vec2(targetBracketInner, targetBracketOuter),
          0.024
        );
        float targetKnot = 1.0 - smoothstep(0.080, 0.155, abs(p.x) + abs(p.y));
        float latchSweep = ring(
          r,
          mix(0.90, 0.18, latchClose),
          mix(0.018, 0.040, latchClose)
        ) * latchEnvelope * 1.25;
        float latchWriteGate = uLatchActive
          * smoothstep(0.34, 0.54, latchProgress)
          * (1.0 - smoothstep(0.90, 1.0, latchProgress));
        float latchDiamond = ring(
          abs(p.x) + abs(p.y),
          mix(0.34, 0.11, smoothstep(0.42, 0.86, latchProgress)),
          0.024
        ) * latchWriteGate;
        float latchCore = (1.0 - smoothstep(
          0.030,
          0.105,
          abs(p.x) + abs(p.y)
        )) * uLatchActive
          * smoothstep(0.56, 0.72, latchProgress)
          * (1.0 - smoothstep(0.90, 1.0, latchProgress));
        float latchGlyph = latchSweep + latchDiamond * 1.15 + latchCore * 1.25;
        float targetGlyph = targetOuter + targetInner * 0.72 + agreementGlyph
          + targetBrackets * 0.82 + targetKnot + latchGlyph;
        float targetSecondary = targetInner + targetKnot
          + latchDiamond + latchCore;

        // uRole continuously travels 0→1→2 so endpoint handoffs morph
        // through the carrier language instead of switching silhouettes.
        float sourceWeight = 1.0 - clamp(uRole, 0.0, 1.0);
        float targetWeight = clamp(uRole - 1.0, 0.0, 1.0);
        float carrierWeight = 1.0 - sourceWeight - targetWeight;
        float glyph = sourceGlyph * sourceWeight
          + carrierGlyph * carrierWeight
          + targetGlyph * targetWeight;
        float secondaryMask = sourceSecondary * sourceWeight
          + carrierSecondary * carrierWeight
          + targetSecondary * targetWeight;

        // The locked Cell's complete content_hash resolves into eight
        // prismatic checksum cuts on its inner horizon. The cuts alter an
        // existing optical boundary instead of adding a plate or shell; the
        // surrounding role glyph still says source / carrier / record.
        float addressAngle = mix(
          uAddressPhase,
          uRouteAngle + 0.54,
          carrierWeight
        );
        vec2 addressP = rotate2d(addressAngle) * p;
        float addressTheta = atan(addressP.y, addressP.x);
        float addressCoord = (
          addressTheta + 3.14159265
        ) / 6.28318530 * 8.0;
        float addressIndex = clamp(floor(addressCoord), 0.0, 7.0);
        float addressValue = addressLane(addressIndex);
        float addressLocal = abs(fract(addressCoord) - 0.5);
        float addressHalfSpan = mix(
          ${CELL_CONTENT_ADDRESS_HALF_SPAN_MIN.toFixed(3)},
          ${CELL_CONTENT_ADDRESS_HALF_SPAN_MAX.toFixed(3)},
          addressValue
        );
        float addressSectorGate = 1.0 - smoothstep(
          addressHalfSpan,
          addressHalfSpan + 0.060,
          addressLocal
        );
        float addressRadius = mix(
          ${CELL_CONTENT_ADDRESS_RADIUS_MIN.toFixed(3)},
          ${CELL_CONTENT_ADDRESS_RADIUS_MAX.toFixed(3)},
          addressValue
        );
        float addressRadiusDistance = abs(r - addressRadius);
        float addressFacet = (
          stroke(addressRadiusDistance, 0.014)
          + stroke(addressRadiusDistance, 0.036) * 0.16
        ) * addressSectorGate;
        float addressSpineDistance = addressLocal * 0.78539816 * r;
        float addressSpine = (
          stroke(addressSpineDistance, 0.010)
          + stroke(addressSpineDistance, 0.026) * 0.12
        )
          * smoothstep(0.33, 0.38, r)
          * (
            1.0 - smoothstep(
              addressRadius + 0.015,
              addressRadius + 0.045,
              r
            )
          )
          * step(
            ${CELL_CONTENT_ADDRESS_SPINE_THRESHOLD.toFixed(3)},
            addressValue
          );
        float addressResolveAt = abs(addressIndex - 3.5) / 3.5;
        float addressResolve = smoothstep(
          addressResolveAt * 0.70 - 0.10,
          addressResolveAt * 0.70 + 0.12,
          uAddressReveal
        ) * uAddressReveal;
        float addressGlyph = (addressFacet + addressSpine * 0.72)
          * addressResolve
          * uAddressStrength;
        glyph += addressGlyph * mix(0.92, 1.08, carrierWeight);
        secondaryMask += addressGlyph * 0.88;

        // A lock acknowledgement is one sparse address echo around whichever
        // semantic glyph is active. It changes emphasis, never role meaning.
        float focusPulseProgress = clamp(uFocusPulseProgress, 0.0, 1.0);
        float focusEchoRadius = mix(
          0.40,
          0.94,
          smoothstep(0.0, 1.0, focusPulseProgress)
        );
        float focusEchoGate = 0.22 + 0.78 * smoothstep(
          0.18,
          0.84,
          abs(sin(theta * 4.0 + uPhase))
        );
        float focusEcho = ring(
          r,
          focusEchoRadius,
          mix(0.042, 0.018, focusPulseProgress)
        ) * focusEchoGate * uFocusPulseStrength;

        float field = exp(-pow((r - 0.58) / 0.28, 2.0)) * 0.055;
        float intensity = min(1.52, glyph + field + focusEcho * 0.82)
          * uOpacity;
        if (intensity < 0.008) discard;
        vec3 baseColor = mix(
          uPrimary,
          uSecondary,
          clamp(secondaryMask, 0.0, 1.0)
        );
        float agreementVisible = agreementGlyph * targetWeight;
        vec3 agreementColor = agreementEmission
          / max(0.0001, agreementGlyph);
        vec3 color = mix(
          baseColor,
          agreementColor,
          clamp(agreementVisible * 0.88, 0.0, 1.0)
        );
        vec3 addressColor = mix(
          vec3(${CELL_CONTENT_ADDRESS_CYAN
            .map((channel) => channel.toFixed(2))
            .join(', ')}),
          vec3(${CELL_CONTENT_ADDRESS_VIOLET
            .map((channel) => channel.toFixed(2))
            .join(', ')}),
          addressValue
        );
        color = mix(
          color,
          addressColor,
          clamp(addressGlyph * 1.36, 0.0, 0.84)
        );
        vec3 focusEchoColor = mix(uPrimary, uSecondary, 0.58);
        color = mix(
          color,
          focusEchoColor,
          clamp(focusEcho * 0.92, 0.0, 1.0)
        );
        gl_FragColor = vec4(color * intensity, intensity);
      }
    `,
  });
}

export default function ConsensusRouteHopMarker({
  focus,
  lockedHop,
  focusedSourceId = null,
  pulseClockRef,
  sourceHandoffRef,
  sourceHandoffTimeRef,
  onAgreementPreviewChange,
  onAgreementLockChange,
}: {
  focus: ConsensusMemoryTraceFocus | null;
  lockedHop?: ConsensusMemoryRouteHopFocus | null;
  focusedSourceId?: number | null;
  pulseClockRef: RefObject<ConsensusMemoryRouteHopPulseClock | null>;
  sourceHandoffRef?: RefObject<ConsensusMemorySourceHandoff | null>;
  sourceHandoffTimeRef?: RefObject<number>;
  onAgreementPreviewChange?: (sourceId: number | null) => void;
  onAgreementLockChange?: (focus: ConsensusMemoryRouteHopFocus) => void;
}) {
  const simClock = useSimClock();
  const reducedMotion = useReducedMotion();
  const cellsCache = useCellGalaxy();
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<GlyphMotion | null>(null);
  const sourceHandoffAuditRef = useRef<SourceHandoffAudit | null>(null);
  // Per-frame telemetry storage: the chip republishes its state every frame,
  // and a held recall would otherwise turn that into steady garbage.
  const agreementStrengthsRef = useRef<number[]>([]);
  const agreementFocusScalesRef = useRef<number[]>([]);
  const tickSourceIdsRef = useRef<number[]>([]);
  const tickArrivalsRef = useRef<number[]>([]);
  const handoffObservedRangeRef = useRef<number[]>([0, 0]);
  const chipLedgerRef = useRef(makeFrameDatasetLedger());
  // The opacity pass runs in its own frame hook, so it keeps its own ledger.
  const chipOpacityLedgerRef = useRef(makeFrameDatasetLedger());
  // A commit rewrites the chip attributes from the markup, which is not
  // always what the frame loop last published. Every commit voids the ledger.
  const commitEpochRef = useRef(0);
  const [inspectedAgreementSourceId, setInspectedAgreementSourceId] =
    useState<number | null>(null);
  const routeFromNdc = useMemo(() => new THREE.Vector3(), []);
  const routeToNdc = useMemo(() => new THREE.Vector3(), []);
  const spatial = useMemo(() => deriveConsensusMemoryRouteHopSpatialFocus(
    focus,
    lockedHop ?? null,
    cellsCache.cells,
  ), [cellsCache.cells, focus, lockedHop]);
  const pulseKey = consensusMemoryRouteHopPulseKey(spatial?.focus ?? null);
  const addressEncoding = useMemo(
    () => spatial
      ? deriveCellContentAddressEncoding(spatial.cell.content_hash)
      : null,
    [spatial],
  );
  const agreementPlan = useMemo(
    () => spatial
      ? deriveConsensusRouteHopAgreementPlan(focus, spatial.cell)
      : EMPTY_AGREEMENT_PLAN,
    [focus, spatial],
  );
  const presentation = useMemo(
    () => spatial ? rolePresentation(spatial) : null,
    [spatial],
  );
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(3), 3),
    );
    value.setDrawRange(0, 0);
    value.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return value;
  }, []);
  const material = useMemo(() => makeGlyphMaterial(), []);
  const renderStrength = spatial
    ? consensusMemoryTraceFocusStrength(focus, simClock.elapsedSec)
    : 0;

  useEffect(() => {
    if (inspectedAgreementSourceId === null) return;
    const retainsInspectedSignature = spatial?.role === 'target'
      && agreementPlan.ticks.some(
        (tick) => tick.sourceId === inspectedAgreementSourceId,
      );
    if (!retainsInspectedSignature) setInspectedAgreementSourceId(null);
  }, [agreementPlan.ticks, inspectedAgreementSourceId, spatial?.role]);

  useEffect(() => {
    onAgreementPreviewChange?.(inspectedAgreementSourceId);
  }, [inspectedAgreementSourceId, onAgreementPreviewChange]);

  useEffect(() => () => {
    onAgreementPreviewChange?.(null);
  }, [onAgreementPreviewChange]);

  useLayoutEffect(() => {
    if (!spatial || !presentation || !addressEncoding) {
      geometry.setDrawRange(0, 0);
      motionRef.current = null;
      clearTargetLatch(material);
      clearFocusPulse(material);
      clearAddressResidue(material);
      return;
    }
    const group = groupRef.current;
    if (!group) return;
    if (pointsRef.current) pointsRef.current.visible = renderStrength > 0.001;
    material.uniforms.uOpacity.value = renderStrength;
    if (chipRef.current) chipRef.current.style.opacity = renderStrength.toFixed(3);
    const destination = glyphWaypoint(spatial, presentation, agreementPlan);
    const motion = motionRef.current;
    geometry.setDrawRange(0, 1);
    const destinationPulseKey = consensusMemoryRouteHopPulseKey(
      destination.spatial.focus,
    );
    const pulseClock = pulseClockRef.current;
    const pulseFrame = pulseClock?.key === destinationPulseKey
      ? pulseClock.frame
      : consensusMemoryRouteHopPulseFrame(
        CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
        reducedMotion,
      );
    const addressFrame = consensusRouteHopAddressResidueFrame(
      pulseFrame,
      pulseClock?.key === destinationPulseKey,
    );
    material.uniforms.uFocusPulseProgress.value = pulseFrame.progress;
    material.uniforms.uFocusPulseStrength.value = pulseFrame.strength;
    applyAddressEncoding(material, addressEncoding);
    applyAddressResidueFrame(material, addressFrame);

    if (!motion) {
      motionRef.current = {
        destination,
        segment: null,
        queue: [],
        latch: null,
        latchedCellId: null,
      };
      group.position.copy(destination.position);
      applyGlyphWaypoint(material, destination);
      clearTargetLatch(material);
      return;
    }

    const transition = classifyConsensusMemoryRouteHopTransition(
      motion.destination.spatial.focus,
      destination.spatial.focus,
    );
    if (reducedMotion || transition === 'discontinuous') {
      const preservesSealedTarget = destination.spatial.role === 'target'
        && motion.latchedCellId === destination.spatial.cell.id;
      motionRef.current = {
        destination,
        segment: null,
        queue: [],
        latch: null,
        latchedCellId: preservesSealedTarget
          ? destination.spatial.cell.id
          : null,
      };
      group.position.copy(destination.position);
      applyGlyphWaypoint(material, destination);
      clearTargetLatch(material);
      return;
    }

    if (transition === 'stationary') {
      motion.destination = destination;
      if (motion.queue.length > 0) {
        motion.queue[motion.queue.length - 1] = destination;
      } else if (motion.segment) {
        motion.segment.to = destination;
      } else {
        group.position.copy(destination.position);
        applyGlyphWaypoint(material, destination);
      }
      return;
    }

    motion.latch = null;
    motion.latchedCellId = null;
    clearTargetLatch(material);
    if (motion.segment) {
      motion.queue.push(destination);
    } else {
      motion.segment = glyphSegment(motion.destination, destination);
    }
    motion.destination = destination;
  }, [
    addressEncoding,
    agreementPlan,
    geometry,
    material,
    presentation,
    reducedMotion,
    renderStrength,
    spatial,
    pulseClockRef,
  ]);

  useEffect(() => { commitEpochRef.current += 1; });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state, rawDeltaSeconds) => {
    const group = groupRef.current;
    const motion = motionRef.current;
    if (!group || !motion) return;

    const motionPulseKey = consensusMemoryRouteHopPulseKey(
      motion.destination.spatial.focus,
    );
    const candidatePulseClock = pulseClockRef.current;
    const pulseClock = candidatePulseClock?.key === motionPulseKey
      ? candidatePulseClock
      : null;
    const pulseFrame = pulseClock?.frame ?? consensusMemoryRouteHopPulseFrame(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
      reducedMotion,
    );
    const addressFrame = consensusRouteHopAddressResidueFrame(
      pulseFrame,
      !!pulseClock,
    );
    material.uniforms.uFocusPulseProgress.value = pulseFrame.progress;
    material.uniforms.uFocusPulseStrength.value = pulseFrame.strength;
    applyAddressResidueFrame(material, addressFrame);

    let remainingSeconds = Math.min(Math.max(rawDeltaSeconds, 0), 0.1);
    while (motion.segment && remainingSeconds > 0) {
      const segment = motion.segment;
      const available = segment.durationSeconds - segment.elapsedSeconds;
      const consumed = Math.min(remainingSeconds, available);
      segment.elapsedSeconds += consumed;
      remainingSeconds -= consumed;
      const progress = segment.durationSeconds > 0
        ? segment.elapsedSeconds / segment.durationSeconds
        : 1;
      const eased = smoothstep01(progress);
      group.position.lerpVectors(segment.from.position, segment.to.position, eased);
      applyGlyphBlend(material, segment.from, segment.to, progress);
      if (segment.elapsedSeconds < segment.durationSeconds) break;

      group.position.copy(segment.to.position);
      applyGlyphWaypoint(material, segment.to);
      const next = motion.queue.shift() ?? null;
      motion.segment = next ? glyphSegment(segment.to, next) : null;
      if (shouldAnimateConsensusMemoryRouteHopTargetLatch(
        segment.from.spatial,
        segment.to.spatial,
        {
          reducedMotion,
          hasQueuedHandoff: !!next,
        },
      )) {
        motion.latch = {
          cellId: segment.to.spatial.cell.id,
          elapsedSeconds: 0,
          durationSeconds: TARGET_LATCH_SECONDS,
        };
        motion.latchedCellId = null;
        material.uniforms.uLatchActive.value = 1;
        material.uniforms.uLatchProgress.value = 0;
      }
    }

    if (motion.latch && !motion.segment) {
      motion.latch.elapsedSeconds += remainingSeconds;
      const latchProgress = Math.min(
        1,
        motion.latch.elapsedSeconds / motion.latch.durationSeconds,
      );
      material.uniforms.uLatchActive.value = 1;
      material.uniforms.uLatchProgress.value = latchProgress;
      if (latchProgress >= 1) {
        motion.latchedCellId = motion.latch.cellId;
        motion.latch = null;
        material.uniforms.uLatchActive.value = 0;
      }
    }

    const tangentSpatial = motion.segment?.to.spatial
      ?? motion.destination.spatial;
    const tangent = deriveConsensusMemoryRouteHopTangent(tangentSpatial);
    const parent = group.parent;
    if (tangent && parent) {
      parent.updateWorldMatrix(true, false);
      routeFromNdc
        .set(...tangent.from.pos_seed)
        .applyMatrix4(parent.matrixWorld)
        .project(state.camera);
      routeToNdc
        .set(...tangent.to.pos_seed)
        .applyMatrix4(parent.matrixWorld)
        .project(state.camera);
      const screenDx = (routeToNdc.x - routeFromNdc.x) * state.size.width;
      const screenDy = (routeToNdc.y - routeFromNdc.y) * state.size.height;
      if (screenDx * screenDx + screenDy * screenDy > 0.0001) {
        material.uniforms.uRouteAngle.value = Math.atan2(screenDy, screenDx);
      }
    } else {
      material.uniforms.uRouteAngle.value = 0;
    }

    const nowSec = simClock.elapsedSec;
    const activeAgreementPlan = motionAgreementPlan(motion);
    const agreementEmphasis = deriveConsensusRouteHopAgreementEmphasis(
      activeAgreementPlan,
      inspectedAgreementSourceId ?? focusedSourceId,
    );
    const sourceHandoff = sourceHandoffRef?.current ?? null;
    const sourceHandoffNowSec = sourceHandoffTimeRef?.current ?? nowSec;
    const sourceHandoffActive = consensusMemorySourceHandoffActive(
      sourceHandoff,
      focusedSourceId,
      sourceHandoffNowSec,
    );
    const handoffControlsAgreement = sourceHandoffActive
      && (
        inspectedAgreementSourceId === null
        || inspectedAgreementSourceId === sourceHandoff.to.sourceId
    );
    const handoffProgress = sourceHandoffActive
      ? consensusMemorySourceHandoffProgress(sourceHandoff, sourceHandoffNowSec)
      : 1;
    const agreementResponse = activeAgreementPlan.visibleSourceCount > 0
      ? consensusMemoryCellResponseForFrame(
        focus,
        activeAgreementPlan.targetCellId,
        nowSec,
      )
      : null;
    const agreementStrengths = agreementStrengthsRef.current;
    const agreementFocusScales = agreementFocusScalesRef.current;
    agreementStrengths.length = 0;
    agreementFocusScales.length = 0;
    for (
      let index = 0;
      index < CONSENSUS_ROUTE_HOP_AGREEMENT_CAP;
      index += 1
    ) {
      const tick = activeAgreementPlan.ticks[index] ?? null;
      const tickStrength = tick
        ? agreementConvergence(agreementResponse, tick.sourceId)
        : 0;
      const agreementFocusScale = tick && handoffControlsAgreement
        ? consensusMemorySourceHandoffEvidenceScale(
          tick.sourceId,
          focusedSourceId,
          sourceHandoff,
          sourceHandoffNowSec,
        )
        : agreementEmphasis.scales[index] ?? 1;
      material.uniforms[`uAgreementFocus${index}`].value = agreementFocusScale;
      material.uniforms[`uAgreementStrength${index}`].value = tickStrength;
      if (tick) {
        agreementStrengths.push(tickStrength);
        agreementFocusScales.push(agreementFocusScale);
      }
    }
    if (sourceHandoffActive) {
      const auditKey = [
        sourceHandoff.from.traceKey,
        sourceHandoff.from.sourceId,
        sourceHandoff.to.sourceId,
      ].join(':');
      let audit = sourceHandoffAuditRef.current;
      if (!audit || audit.key !== auditKey) {
        audit = {
          key: auditKey,
          traceKey: sourceHandoff.from.traceKey,
          fromSourceId: sourceHandoff.from.sourceId,
          toSourceId: sourceHandoff.to.sourceId,
          frames: 0,
          minProgress: handoffProgress,
          maxProgress: handoffProgress,
          midDistance: Number.POSITIVE_INFINITY,
          midProgress: handoffProgress,
          midAgreementScales: agreementFocusScales
            .map((value) => value.toFixed(3))
            .join(','),
        };
        sourceHandoffAuditRef.current = audit;
      }
      audit.frames += 1;
      audit.minProgress = Math.min(audit.minProgress, handoffProgress);
      audit.maxProgress = Math.max(audit.maxProgress, handoffProgress);
      const midDistance = Math.abs(handoffProgress - 0.5);
      if (midDistance < audit.midDistance) {
        audit.midDistance = midDistance;
        audit.midProgress = handoffProgress;
        audit.midAgreementScales = agreementFocusScales
          .map((value) => value.toFixed(3))
          .join(',');
      }
    }

    if (chipRef.current) {
      // Every value below used to be republished each frame, which a held
      // recall turned into ~25 pointless attribute writes per frame. The
      // ledger keeps the last published value and writes only real changes:
      // state values immediately, scalar progress on a 1e-2 quantum plus an
      // exact write once it settles, joined series component-wise at full
      // precision. Nothing in the repo reads these — they are the live
      // session's window into the chip — so the contract is only that a
      // reader sees the same figures, not that they are rewritten.
      const chip = chipRef.current;
      const ledger = chipLedgerRef.current;
      const data = chip.dataset;
      // React remounts this chip on every pulse key, and any commit rewrites
      // the markup's own attributes over ours: both void the ledger.
      frameDatasetBind(ledger, chip, commitEpochRef.current);
      const segment = motion.segment;
      frameDatasetWrite(
        ledger,
        data,
        'memoryRouteHopMotion',
        segment ? 'moving' : 'settled',
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopMotionProgress',
        segment
          ? Math.min(1, segment.elapsedSeconds / segment.durationSeconds)
          : 1,
        3,
        0.01,
      );
      frameDatasetWrite(ledger, data, 'memoryRouteHopPulse', pulseFrame.state);
      frameDatasetWrite(
        ledger,
        data,
        'memoryRouteHopPulseKey',
        pulseClock?.key ?? 'none',
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopPulseProgress',
        pulseFrame.progress,
        3,
        0.01,
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopPulseStrength',
        pulseFrame.strength,
        3,
        0.01,
      );
      frameDatasetWrite(ledger, data, 'memoryRouteHopAddress', addressFrame.state);
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopAddressReveal',
        addressFrame.reveal,
        3,
        0.01,
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopAddressStrength',
        addressFrame.strength,
        3,
        0.01,
      );
      if (tangent) {
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopAngle',
          material.uniforms.uRouteAngle.value,
          3,
          0.01,
        );
      } else {
        frameDatasetWrite(ledger, data, 'memoryRouteHopAngle', 'none');
      }
      const sealed = motion.latchedCellId === motion.destination.spatial.cell.id;
      frameDatasetWrite(
        ledger,
        data,
        'memoryRouteHopLatch',
        motion.latch ? 'closing' : sealed ? 'sealed' : 'idle',
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopLatchProgress',
        motion.latch
          ? Math.min(
            1,
            motion.latch.elapsedSeconds / motion.latch.durationSeconds,
          )
          : sealed ? 1 : 0,
        3,
        0.01,
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopAgreementCount',
        activeAgreementPlan.visibleSourceCount,
        0,
        1,
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopAgreementTotal',
        activeAgreementPlan.routedSourceCount,
        0,
        1,
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopAgreementHidden',
        activeAgreementPlan.hiddenSourceCount,
        0,
        1,
      );
      const ticks = activeAgreementPlan.ticks;
      const tickSourceIds = tickSourceIdsRef.current;
      const tickArrivals = tickArrivalsRef.current;
      tickSourceIds.length = ticks.length;
      tickArrivals.length = ticks.length;
      for (let index = 0; index < ticks.length; index += 1) {
        tickSourceIds[index] = ticks[index].sourceId;
        tickArrivals[index] = ticks[index].arrivalProgress;
      }
      frameDatasetWriteVector(
        ledger,
        data,
        'memoryRouteHopAgreementSources',
        tickSourceIds,
        0,
        1,
      );
      frameDatasetWriteVector(
        ledger,
        data,
        'memoryRouteHopAgreementArrivals',
        tickArrivals,
        3,
        0.001,
      );
      frameDatasetWriteVector(
        ledger,
        data,
        'memoryRouteHopAgreementStrengths',
        agreementStrengths,
        3,
        0.001,
      );
      if (agreementEmphasis.sourceId === null) {
        frameDatasetWrite(ledger, data, 'memoryRouteHopAgreementFocus', 'none');
      } else {
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopAgreementFocus',
          agreementEmphasis.sourceId,
          0,
          1,
        );
      }
      frameDatasetWriteVector(
        ledger,
        data,
        'memoryRouteHopAgreementFocusScales',
        agreementFocusScales,
        3,
        0.001,
      );
      frameDatasetWrite(
        ledger,
        data,
        'memoryRouteHopSourceHandoff',
        sourceHandoffActive ? 'active' : 'settled',
      );
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopSourceHandoffProgress',
        handoffProgress,
        3,
        0.01,
      );
      const retainedSourceHandoffAudit = sourceHandoffAuditRef.current;
      const sourceHandoffAudit = retainedSourceHandoffAudit?.traceKey
        === motion.destination.spatial.focus.traceKey
        ? retainedSourceHandoffAudit
        : null;
      if (sourceHandoffActive) {
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopSourceHandoffFrom',
          sourceHandoff.from.sourceId,
          0,
          1,
        );
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopSourceHandoffTo',
          sourceHandoff.to.sourceId,
          0,
          1,
        );
      } else if (sourceHandoffAudit) {
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopSourceHandoffFrom',
          sourceHandoffAudit.fromSourceId,
          0,
          1,
        );
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopSourceHandoffTo',
          sourceHandoffAudit.toSourceId,
          0,
          1,
        );
      } else {
        frameDatasetDelete(ledger, data, 'memoryRouteHopSourceHandoffFrom');
        frameDatasetDelete(ledger, data, 'memoryRouteHopSourceHandoffTo');
      }
      frameDatasetWriteNumber(
        ledger,
        data,
        'memoryRouteHopSourceHandoffObservedFrames',
        sourceHandoffAudit?.frames ?? 0,
        0,
        1,
      );
      if (sourceHandoffAudit) {
        const observedRange = handoffObservedRangeRef.current;
        observedRange[0] = sourceHandoffAudit.minProgress;
        observedRange[1] = sourceHandoffAudit.maxProgress;
        frameDatasetWriteVector(
          ledger,
          data,
          'memoryRouteHopSourceHandoffObservedRange',
          observedRange,
          3,
          0.001,
        );
        frameDatasetWriteNumber(
          ledger,
          data,
          'memoryRouteHopSourceHandoffMidProgress',
          sourceHandoffAudit.midProgress,
          3,
          0.001,
        );
        frameDatasetWrite(
          ledger,
          data,
          'memoryRouteHopSourceHandoffMidAgreementScales',
          sourceHandoffAudit.midAgreementScales,
        );
      } else {
        frameDatasetWrite(
          ledger,
          data,
          'memoryRouteHopSourceHandoffObservedRange',
          'none',
        );
        frameDatasetWrite(
          ledger,
          data,
          'memoryRouteHopSourceHandoffMidProgress',
          'none',
        );
        frameDatasetWrite(
          ledger,
          data,
          'memoryRouteHopSourceHandoffMidAgreementScales',
          'none',
        );
      }
    }
  });

  useSimFrame((state) => {
    const strength = spatial
      ? consensusMemoryTraceFocusStrength(focus, simClock.elapsedSec)
      : 0;
    if (pointsRef.current) pointsRef.current.visible = strength > 0.001;
    material.uniforms.uOpacity.value = strength;
    material.uniforms.uTime.value = reducedMotion ? 0 : simClock.elapsedSec;
    material.uniforms.uViewportHeight.value = state.size.height;
    material.uniforms.uPixelRatio.value = state.viewport.dpr ?? 1;
    if (chipRef.current) {
      const ledger = chipOpacityLedgerRef.current;
      frameDatasetBind(ledger, chipRef.current, commitEpochRef.current);
      frameStyleWriteNumber(
        ledger,
        chipRef.current.style,
        'opacity',
        strength,
        3,
        0.001,
      );
    }
  });

  if (!spatial || !presentation) return null;
  const color = cssColor(presentation.primary);
  const chipPulseStyle = {
    '--route-hop-pulse-color': color,
    animation: reducedMotion || !pulseKey
      ? undefined
      : `cknerv-route-hop-lock-pulse ${CONSENSUS_ROUTE_HOP_PULSE_MS}ms cubic-bezier(.18,.72,.2,1) both`,
  } as CSSProperties & { '--route-hop-pulse-color': string };

  return (
    <group ref={groupRef}>
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={8}
      />
      {spatial.role === 'target' && agreementPlan.ticks.length > 0 ? (
        <Html
          position={[0, 0, 0]}
          zIndexRange={[8, 8]}
          occlude={false}
          style={{ pointerEvents: 'none' }}
        >
          <div
            role="group"
            aria-label={`${agreementPlan.visibleSourceCount} agreement evidence signatures`}
            data-memory-route-hop-agreement-controls="true"
            data-memory-route-hop-agreement-navigation="arrows-home-end"
            style={{ position: 'relative', width: 0, height: 0 }}
          >
            {agreementPlan.ticks.map((tick, tickIndex) => {
              const callout = deriveConsensusRouteHopAgreementCallout(tick, {
                visibleSourceCount: agreementPlan.visibleSourceCount,
              });
              const signatureColor = cssColor(tick.color);
              const signatureLineStart = cssColor(tick.color, 0.9);
              const signatureLineEnd = cssColor(tick.color, 0.26);
              const signatureGlow = cssColor(tick.color, 0.5);
              const signatureBorder = cssColor(tick.color, 0.32);
              const signatureFill = cssColor(tick.color, 0.09);
              const signatureShadow = cssColor(tick.color, 0.15);
              const inspected = inspectedAgreementSourceId === tick.sourceId;
              const labelX = callout.side === 'right' ? 12 : -12;
              const inspectionLabel = [
                `Inspect ${callout.evidenceCode}`,
                `signature ${tick.ordinal} of ${agreementPlan.visibleSourceCount}`,
                `source ${callout.sourceLabel}`,
                `fingerprint ${callout.fingerprint}`,
                `at maintained record Cell ${agreementPlan.targetCellId}`,
              ].join(', ');
              const connectorAngle = Math.atan2(callout.offsetYPx, labelX);
              const connectorLength = Math.max(
                0,
                Math.hypot(labelX, callout.offsetYPx) - 5,
              );
              const calloutBackground = callout.side === 'right'
                ? `linear-gradient(90deg, rgba(1,5,14,.96), ${signatureFill}, rgba(1,5,14,.82))`
                : `linear-gradient(270deg, rgba(1,5,14,.96), ${signatureFill}, rgba(1,5,14,.82))`;
              return (
                <div
                  key={tick.sourceId}
                  style={{
                    position: 'absolute',
                    left: callout.anchorXPx,
                    top: callout.anchorYPx,
                    width: 0,
                    height: 0,
                    pointerEvents: 'none',
                  }}
                >
                  <button
                    type="button"
                    aria-label={inspectionLabel}
                    aria-pressed={focusedSourceId === tick.sourceId}
                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
                    data-memory-route-hop-agreement-control={tick.ordinal}
                    data-memory-route-hop-agreement-source={tick.sourceId}
                    data-memory-route-hop-agreement-position={
                      callout.sequenceLabel
                    }
                    data-memory-route-hop-agreement-focus={
                      focusedSourceId === tick.sourceId ? 'active' : 'idle'
                    }
                    data-memory-route-hop-agreement-inspection={
                      inspected ? 'active' : 'idle'
                    }
                    title={`${callout.evidenceCode} · ${callout.sourceLabel} · ${callout.fingerprint}`}
                    disabled={!onAgreementLockChange}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerEnter={() => {
                      setInspectedAgreementSourceId(tick.sourceId);
                    }}
                    onPointerLeave={(event) => {
                      if (document.activeElement === event.currentTarget) return;
                      setInspectedAgreementSourceId((current) =>
                        current === tick.sourceId ? null : current,
                      );
                    }}
                    onFocus={() => {
                      setInspectedAgreementSourceId(tick.sourceId);
                    }}
                    onBlur={() => {
                      setInspectedAgreementSourceId((current) =>
                        current === tick.sourceId ? null : current,
                      );
                    }}
                    onKeyDown={(event) => {
                      const nextIndex =
                        deriveConsensusRouteHopAgreementNavigationIndex(
                          tickIndex,
                          event.key,
                          agreementPlan.visibleSourceCount,
                        );
                      if (nextIndex === null) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const controls = event.currentTarget.closest(
                        '[data-memory-route-hop-agreement-controls]',
                      )?.querySelectorAll<HTMLButtonElement>(
                        '[data-memory-route-hop-agreement-control]',
                      );
                      controls?.item(nextIndex).focus();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAgreementLockChange?.(tick.targetFocus);
                    }}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: 16,
                      height: 16,
                      margin: 0,
                      padding: 0,
                      transform: 'translate(-50%, -50%)',
                      border: 0,
                      borderRadius: '50%',
                      outline: 0,
                      background: 'transparent',
                      pointerEvents: 'auto',
                      cursor: onAgreementLockChange ? 'pointer' : 'default',
                    }}
                  />
                  {inspected ? (
                    <>
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: Math.cos(connectorAngle) * 5,
                          top: Math.sin(connectorAngle) * 5,
                          width: connectorLength,
                          height: 1,
                          transform: `translateY(-50%) rotate(${connectorAngle}rad)`,
                          transformOrigin: 'left center',
                          background: `linear-gradient(90deg, ${signatureLineStart}, ${signatureLineEnd})`,
                          boxShadow: `0 0 4px ${signatureGlow}`,
                          pointerEvents: 'none',
                        }}
                      />
                      <div
                        aria-hidden="true"
                        data-memory-route-hop-agreement-callout={tick.ordinal}
                        data-memory-route-hop-agreement-callout-source={
                          tick.sourceId
                        }
                        data-memory-route-hop-agreement-callout-fingerprint={
                          callout.fingerprint
                        }
                        data-memory-route-hop-agreement-callout-position={
                          callout.sequenceLabel
                        }
                        style={{
                          position: 'absolute',
                          left: labelX,
                          top: callout.offsetYPx,
                          minWidth: 66,
                          padding: callout.side === 'right'
                            ? '3px 5px 3px 6px'
                            : '3px 6px 3px 5px',
                          transform: callout.side === 'right'
                            ? 'translate(0, -50%)'
                            : 'translate(-100%, -50%)',
                          borderLeft: callout.side === 'right'
                            ? `1px solid ${signatureColor}`
                            : undefined,
                          borderRight: callout.side === 'left'
                            ? `1px solid ${signatureColor}`
                            : undefined,
                          borderBottom: `1px solid ${signatureBorder}`,
                          background: calloutBackground,
                          boxShadow: `0 0 10px ${signatureShadow}`,
                          color: 'rgba(232, 247, 255, .92)',
                          fontFamily: '"JetBrains Mono Local", ui-monospace, monospace',
                          fontSize: 6,
                          lineHeight: 1.12,
                          letterSpacing: '0.08em',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 4 }}>
                          <span style={{ color: signatureColor }}>
                            {callout.sequenceLabel}
                          </span>
                          <span>{callout.sourceLabel}</span>
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            color: 'rgba(167, 204, 220, .72)',
                            fontSize: 5.4,
                            letterSpacing: '0.11em',
                          }}
                        >
                          {callout.fingerprint}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Html>
      ) : null}
      <Html
        position={[0, 0, 0]}
        zIndexRange={[7, 7]}
        occlude={false}
        style={{ pointerEvents: 'none' }}
      >
        <div
          key={pulseKey}
          ref={chipRef}
          aria-hidden="true"
          data-memory-route-hop-spatial={spatial.role}
          data-memory-route-hop-source={spatial.focus.sourceId}
          data-memory-route-hop-cell={spatial.focus.cellId}
          data-memory-route-hop-index={spatial.focus.hopIndex}
          data-memory-route-hop-claim={presentation.claim}
          data-memory-route-hop-pulse={reducedMotion ? 'reduced' : 'active'}
          data-memory-route-hop-pulse-key={pulseKey ?? undefined}
          data-memory-route-hop-pulse-progress={reducedMotion ? '1.000' : '0.000'}
          data-memory-route-hop-pulse-strength="0.000"
          data-memory-route-hop-address="hidden"
          data-memory-route-hop-address-fingerprint={
            addressEncoding?.fingerprint
          }
          data-memory-route-hop-address-lanes={
            addressEncoding?.lanes
              .map((lane) => lane.toFixed(3))
              .join(',')
          }
          data-memory-route-hop-address-phase={
            addressEncoding?.phase.toFixed(3)
          }
          data-memory-route-hop-address-reveal="0.000"
          data-memory-route-hop-address-strength="0.000"
          data-memory-route-hop-source-handoff="settled"
          data-memory-route-hop-source-handoff-progress="1.000"
          data-memory-route-hop-source-handoff-observed-frames="0"
          data-memory-route-hop-source-handoff-observed-range="none"
          data-memory-route-hop-source-handoff-mid-progress="none"
          data-memory-route-hop-source-handoff-mid-agreement-scales="none"
          data-memory-trace-continuity={
            focus?.visualContinuity?.mode ?? 'native'
          }
          data-memory-trace-continuity-floor={
            focus?.visualContinuity?.floorStrength.toFixed(3) ?? '0.000'
          }
          style={{
            position: 'relative',
            transform: 'translate(-50%, 39px)',
            padding: '2px 5px 2px 6px',
            borderLeft: `1px solid ${color}`,
            borderBottom: `1px solid ${cssColor(presentation.primary, 0.4)}`,
            background: `linear-gradient(90deg, rgba(1,5,14,.92), ${cssColor(presentation.primary, 0.07)}, rgba(1,5,14,.78))`,
            boxShadow: `0 0 10px ${cssColor(presentation.primary, 0.17)}`,
            opacity: renderStrength,
            whiteSpace: 'nowrap',
            fontFamily: '"JetBrains Mono Local", ui-monospace, monospace',
            fontSize: 6.4,
            letterSpacing: '0.12em',
            color,
            ...chipPulseStyle,
          }}
        >
          H{String(spatial.focus.hopIndex).padStart(2, '0')} · {presentation.label}
        </div>
      </Html>
    </group>
  );
}
