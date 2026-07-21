// Locked route-hop glyphs — one procedural, Cell-anchored marker that makes
// the HUD's source / display-carrier / maintained-record semantics spatial.
// Intermediate Cells remain explicitly visual routing context, never lineage.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemorySourceHandoffActive,
  consensusMemorySourceHandoffEvidenceScale,
  consensusMemorySourceHandoffProgress,
  type ConsensusMemorySourceHandoff,
} from './consensusMemorySourceHandoff';
import {
  consensusMemoryTraceFocusStrength,
  consensusMemoryCellResponse,
  classifyConsensusMemoryRouteHopTransition,
  deriveConsensusMemoryRouteHopSpatialFocus,
  deriveConsensusMemoryRouteHopTangent,
  shouldAnimateConsensusMemoryRouteHopTargetLatch,
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

function makeGlyphMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRole: { value: 1 },
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uRouteAngle: { value: 0 },
      uLatchActive: { value: 0 },
      uLatchProgress: { value: 0 },
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

        float field = exp(-pow((r - 0.58) / 0.28, 2.0)) * 0.055;
        float intensity = min(1.45, glyph + field) * uOpacity;
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
        gl_FragColor = vec4(color * intensity, intensity);
      }
    `,
  });
}

export default function ConsensusRouteHopMarker({
  focus,
  lockedHop,
  focusedSourceId = null,
  sourceHandoffRef,
  sourceHandoffTimeRef,
  onAgreementPreviewChange,
  onAgreementLockChange,
}: {
  focus: ConsensusMemoryTraceFocus | null;
  lockedHop?: ConsensusMemoryRouteHopFocus | null;
  focusedSourceId?: number | null;
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
  const [inspectedAgreementSourceId, setInspectedAgreementSourceId] =
    useState<number | null>(null);
  const routeFromNdc = useMemo(() => new THREE.Vector3(), []);
  const routeToNdc = useMemo(() => new THREE.Vector3(), []);
  const spatial = useMemo(() => deriveConsensusMemoryRouteHopSpatialFocus(
    focus,
    lockedHop ?? null,
    cellsCache.cells,
  ), [cellsCache.cells, focus, lockedHop]);
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
    if (!spatial || !presentation) {
      geometry.setDrawRange(0, 0);
      motionRef.current = null;
      clearTargetLatch(material);
      return;
    }
    const group = groupRef.current;
    if (!group) return;
    const destination = glyphWaypoint(spatial, presentation, agreementPlan);
    const motion = motionRef.current;
    geometry.setDrawRange(0, 1);

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
    agreementPlan,
    geometry,
    material,
    presentation,
    reducedMotion,
    spatial,
  ]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((state, rawDeltaSeconds) => {
    const group = groupRef.current;
    const motion = motionRef.current;
    if (!group || !motion) return;

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
      ? consensusMemoryCellResponse(
        focus,
        activeAgreementPlan.targetCellId,
        nowSec,
      )
      : null;
    const agreementStrengths: number[] = [];
    const agreementFocusScales: number[] = [];
    for (
      let index = 0;
      index < CONSENSUS_ROUTE_HOP_AGREEMENT_CAP;
      index += 1
    ) {
      const tick = activeAgreementPlan.ticks[index] ?? null;
      const tickStrength = tick
        ? agreementResponse?.evidence?.find(
          (evidence) => evidence.sourceId === tick.sourceId,
        )?.convergence ?? 0
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
      const segment = motion.segment;
      chipRef.current.dataset.memoryRouteHopMotion = segment
        ? 'moving'
        : 'settled';
      chipRef.current.dataset.memoryRouteHopMotionProgress = segment
        ? Math.min(1, segment.elapsedSeconds / segment.durationSeconds).toFixed(3)
        : '1.000';
      chipRef.current.dataset.memoryRouteHopAngle = tangent
        ? material.uniforms.uRouteAngle.value.toFixed(3)
        : 'none';
      chipRef.current.dataset.memoryRouteHopLatch = motion.latch
        ? 'closing'
        : motion.latchedCellId === motion.destination.spatial.cell.id
          ? 'sealed'
          : 'idle';
      chipRef.current.dataset.memoryRouteHopLatchProgress = motion.latch
        ? Math.min(
            1,
            motion.latch.elapsedSeconds / motion.latch.durationSeconds,
          ).toFixed(3)
        : motion.latchedCellId === motion.destination.spatial.cell.id
          ? '1.000'
          : '0.000';
      chipRef.current.dataset.memoryRouteHopAgreementCount = String(
        activeAgreementPlan.visibleSourceCount,
      );
      chipRef.current.dataset.memoryRouteHopAgreementTotal = String(
        activeAgreementPlan.routedSourceCount,
      );
      chipRef.current.dataset.memoryRouteHopAgreementHidden = String(
        activeAgreementPlan.hiddenSourceCount,
      );
      chipRef.current.dataset.memoryRouteHopAgreementSources =
        activeAgreementPlan.ticks.map(({ sourceId }) => sourceId).join(',');
      chipRef.current.dataset.memoryRouteHopAgreementArrivals =
        activeAgreementPlan.ticks
          .map(({ arrivalProgress }) => arrivalProgress.toFixed(3))
          .join(',');
      chipRef.current.dataset.memoryRouteHopAgreementStrengths =
        agreementStrengths.map((value) => value.toFixed(3)).join(',');
      chipRef.current.dataset.memoryRouteHopAgreementFocus =
        agreementEmphasis.sourceId === null
          ? 'none'
          : String(agreementEmphasis.sourceId);
      chipRef.current.dataset.memoryRouteHopAgreementFocusScales =
        agreementFocusScales.map((value) => value.toFixed(3)).join(',');
      chipRef.current.dataset.memoryRouteHopSourceHandoff =
        sourceHandoffActive ? 'active' : 'settled';
      chipRef.current.dataset.memoryRouteHopSourceHandoffProgress =
        handoffProgress.toFixed(3);
      const retainedSourceHandoffAudit = sourceHandoffAuditRef.current;
      const sourceHandoffAudit = retainedSourceHandoffAudit?.traceKey
        === motion.destination.spatial.focus.traceKey
        ? retainedSourceHandoffAudit
        : null;
      if (sourceHandoffActive) {
        chipRef.current.dataset.memoryRouteHopSourceHandoffFrom = String(
          sourceHandoff.from.sourceId,
        );
        chipRef.current.dataset.memoryRouteHopSourceHandoffTo = String(
          sourceHandoff.to.sourceId,
        );
      } else if (sourceHandoffAudit) {
        chipRef.current.dataset.memoryRouteHopSourceHandoffFrom = String(
          sourceHandoffAudit.fromSourceId,
        );
        chipRef.current.dataset.memoryRouteHopSourceHandoffTo = String(
          sourceHandoffAudit.toSourceId,
        );
      } else {
        delete chipRef.current.dataset.memoryRouteHopSourceHandoffFrom;
        delete chipRef.current.dataset.memoryRouteHopSourceHandoffTo;
      }
      chipRef.current.dataset.memoryRouteHopSourceHandoffObservedFrames = String(
        sourceHandoffAudit?.frames ?? 0,
      );
      chipRef.current.dataset.memoryRouteHopSourceHandoffObservedRange =
        sourceHandoffAudit
          ? `${sourceHandoffAudit.minProgress.toFixed(3)},${sourceHandoffAudit.maxProgress.toFixed(3)}`
          : 'none';
      chipRef.current.dataset.memoryRouteHopSourceHandoffMidProgress =
        sourceHandoffAudit?.midProgress.toFixed(3) ?? 'none';
      chipRef.current.dataset.memoryRouteHopSourceHandoffMidAgreementScales =
        sourceHandoffAudit?.midAgreementScales ?? 'none';
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
    if (chipRef.current) chipRef.current.style.opacity = strength.toFixed(3);
  });

  if (!spatial || !presentation) return null;
  const color = cssColor(presentation.primary);

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
          ref={chipRef}
          aria-hidden="true"
          data-memory-route-hop-spatial={spatial.role}
          data-memory-route-hop-source={spatial.focus.sourceId}
          data-memory-route-hop-cell={spatial.focus.cellId}
          data-memory-route-hop-index={spatial.focus.hopIndex}
          data-memory-route-hop-claim={presentation.claim}
          data-memory-route-hop-source-handoff="settled"
          data-memory-route-hop-source-handoff-progress="1.000"
          data-memory-route-hop-source-handoff-observed-frames="0"
          data-memory-route-hop-source-handoff-observed-range="none"
          data-memory-route-hop-source-handoff-mid-progress="none"
          data-memory-route-hop-source-handoff-mid-agreement-scales="none"
          style={{
            position: 'relative',
            transform: 'translate(-50%, 39px)',
            padding: '2px 5px 2px 6px',
            borderLeft: `1px solid ${color}`,
            borderBottom: `1px solid ${cssColor(presentation.primary, 0.4)}`,
            background: `linear-gradient(90deg, rgba(1,5,14,.92), ${cssColor(presentation.primary, 0.07)}, rgba(1,5,14,.78))`,
            boxShadow: `0 0 10px ${cssColor(presentation.primary, 0.17)}`,
            opacity: 0,
            whiteSpace: 'nowrap',
            fontFamily: '"JetBrains Mono Local", ui-monospace, monospace',
            fontSize: 6.4,
            letterSpacing: '0.12em',
            color,
          }}
        >
          H{String(spatial.focus.hopIndex).padStart(2, '0')} · {presentation.label}
        </div>
      </Html>
    </group>
  );
}
