// Locked route-hop glyphs — one procedural, Cell-anchored marker that makes
// the HUD's source / display-carrier / maintained-record semantics spatial.
// Intermediate Cells remain explicitly visual routing context, never lineage.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useReducedMotion } from '../components/hud/useReducedMotion';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemoryTraceFocusStrength,
  classifyConsensusMemoryRouteHopTransition,
  deriveConsensusMemoryRouteHopSpatialFocus,
  deriveConsensusMemoryRouteHopTangent,
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

function cssColor(color: readonly [number, number, number]): string {
  return `rgb(${color.map((channel) => Math.round(channel * 255)).join(' ')})`;
}

function glyphPhase(cellId: number): number {
  return ((cellId % 4096) * 0.61803398875 % 1) * Math.PI * 2;
}

function glyphWaypoint(
  spatial: ConsensusMemoryRouteHopSpatialFocus,
  presentation: RolePresentation,
): GlyphWaypoint {
  return {
    spatial,
    presentation,
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

function applyGlyphBlend(
  material: THREE.ShaderMaterial,
  from: GlyphWaypoint,
  to: GlyphWaypoint,
  progress: number,
): void {
  const t = smoothstep01(progress);
  const fromRole = from.presentation;
  const toRole = to.presentation;
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

function makeGlyphMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRole: { value: 1 },
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uRouteAngle: { value: 0 },
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
        float targetAgreements = ring(r, 0.59, 0.040)
          * exp(-pow(abs(sin(theta * 2.0 + 0.785)) / 0.075, 2.0));
        float targetBrackets = 0.0;
        targetBrackets += segment(p, vec2(-0.74, -0.58), vec2(-0.74, -0.76), 0.024);
        targetBrackets += segment(p, vec2(-0.74, -0.76), vec2(-0.56, -0.76), 0.024);
        targetBrackets += segment(p, vec2(0.74, -0.58), vec2(0.74, -0.76), 0.024);
        targetBrackets += segment(p, vec2(0.74, -0.76), vec2(0.56, -0.76), 0.024);
        targetBrackets += segment(p, vec2(-0.74, 0.58), vec2(-0.74, 0.76), 0.024);
        targetBrackets += segment(p, vec2(-0.74, 0.76), vec2(-0.56, 0.76), 0.024);
        targetBrackets += segment(p, vec2(0.74, 0.58), vec2(0.74, 0.76), 0.024);
        targetBrackets += segment(p, vec2(0.74, 0.76), vec2(0.56, 0.76), 0.024);
        float targetKnot = 1.0 - smoothstep(0.080, 0.155, abs(p.x) + abs(p.y));
        float targetGlyph = targetOuter + targetInner * 0.72 + targetAgreements
          + targetBrackets * 0.82 + targetKnot;
        float targetSecondary = targetInner + targetAgreements + targetKnot;

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
        vec3 color = mix(uPrimary, uSecondary, clamp(secondaryMask, 0.0, 1.0));
        gl_FragColor = vec4(color * intensity, intensity);
      }
    `,
  });
}

export default function ConsensusRouteHopMarker({
  focus,
  lockedHop,
}: {
  focus: ConsensusMemoryTraceFocus | null;
  lockedHop?: ConsensusMemoryRouteHopFocus | null;
}) {
  const simClock = useSimClock();
  const reducedMotion = useReducedMotion();
  const cellsCache = useCellGalaxy();
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<GlyphMotion | null>(null);
  const routeFromNdc = useMemo(() => new THREE.Vector3(), []);
  const routeToNdc = useMemo(() => new THREE.Vector3(), []);
  const spatial = useMemo(() => deriveConsensusMemoryRouteHopSpatialFocus(
    focus,
    lockedHop ?? null,
    cellsCache.cells,
  ), [cellsCache.cells, focus, lockedHop]);
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

  useLayoutEffect(() => {
    if (!spatial || !presentation) {
      geometry.setDrawRange(0, 0);
      motionRef.current = null;
      return;
    }
    const group = groupRef.current;
    if (!group) return;
    const destination = glyphWaypoint(spatial, presentation);
    const motion = motionRef.current;
    geometry.setDrawRange(0, 1);

    if (!motion) {
      motionRef.current = {
        destination,
        segment: null,
        queue: [],
      };
      group.position.copy(destination.position);
      applyGlyphWaypoint(material, destination);
      return;
    }

    const transition = classifyConsensusMemoryRouteHopTransition(
      motion.destination.spatial.focus,
      destination.spatial.focus,
    );
    if (reducedMotion || transition === 'discontinuous') {
      motionRef.current = {
        destination,
        segment: null,
        queue: [],
      };
      group.position.copy(destination.position);
      applyGlyphWaypoint(material, destination);
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

    if (motion.segment) {
      motion.queue.push(destination);
    } else {
      motion.segment = glyphSegment(motion.destination, destination);
    }
    motion.destination = destination;
  }, [geometry, material, presentation, reducedMotion, spatial]);

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
          data-memory-route-hop-cell={spatial.focus.cellId}
          data-memory-route-hop-index={spatial.focus.hopIndex}
          data-memory-route-hop-claim={presentation.claim}
          style={{
            position: 'relative',
            transform: 'translate(-50%, 39px)',
            padding: '2px 5px 2px 6px',
            borderLeft: `1px solid ${color}`,
            borderBottom: `1px solid ${color}66`,
            background: `linear-gradient(90deg, rgba(1,5,14,.92), ${color}12, rgba(1,5,14,.78))`,
            boxShadow: `0 0 10px ${color}2b`,
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
