// Locked route-hop glyphs — one procedural, Cell-anchored marker that makes
// the HUD's source / display-carrier / maintained-record semantics spatial.
// Intermediate Cells remain explicitly visual routing context, never lineage.

import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useReducedMotion } from '../components/hud/useReducedMotion';
import { useSimClock } from '../tweaks/SimClockScope';
import { useSimFrame } from '../tweaks/useSimFrame';
import {
  consensusMemoryTraceFocusStrength,
  deriveConsensusMemoryRouteHopSpatialFocus,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryRouteHopRole,
  type ConsensusMemoryRouteHopSpatialFocus,
  type ConsensusMemoryTraceFocus,
} from './consensusMemoryTrace';

const PALE = [0.79, 0.98, 1] as const;
const CYAN = [0.13, 0.94, 1] as const;
const VIOLET = [0.58, 0.38, 1] as const;
const GOLD = [1, 0.72, 0.38] as const;

interface RolePresentation {
  index: number;
  label: string;
  claim: string;
  primary: readonly [number, number, number];
  secondary: readonly [number, number, number];
  radius: number;
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

function makeGlyphMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRole: { value: 1 },
      uTime: { value: 0 },
      uPhase: { value: 0 },
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
        float glyph = 0.0;
        float secondaryMask = 0.0;

        if (uRole < 0.5) {
          // Evidence source: three independent, broken contributor orbits
          // converge on one addressable knot without forming an atom icon.
          vec2 a = rotate2d(uPhase + uTime * 0.055) * p;
          vec2 b = rotate2d(uPhase + 1.047 - uTime * 0.042) * p;
          vec2 c = rotate2d(uPhase - 1.047 + uTime * 0.034) * p;
          float gateA = smoothstep(0.16, 0.48, abs(sin(theta * 3.0 + 0.4)));
          float gateB = smoothstep(0.14, 0.46, abs(sin(theta * 3.0 - 0.8)));
          float orbitA = ring(length(vec2(a.x, a.y * 1.72)), 0.62, 0.024) * gateA;
          float orbitB = ring(length(vec2(b.x, b.y * 1.72)), 0.62, 0.022) * gateB;
          float orbitC = ring(length(vec2(c.x, c.y * 1.72)), 0.62, 0.020) * 0.68;
          float nodes = ring(r, 0.67, 0.043)
            * exp(-pow(abs(sin(theta * 1.5 + uPhase)) / 0.085, 2.0));
          float knot = 1.0 - smoothstep(0.075, 0.145, abs(p.x) + abs(p.y));
          glyph = orbitA + orbitB + orbitC + nodes * 1.1 + knot;
          secondaryMask = orbitC * 0.6 + nodes + knot;
        } else if (uRole < 1.5) {
          // Display carrier: an open, bidirectional waveguide. It shows where
          // the visual route passes, while its open ends deny provenance.
          vec2 q = rotate2d(uPhase * 0.08) * p;
          float laneWindow = 1.0 - smoothstep(0.70, 0.84, abs(q.x));
          float wave = 0.13 * sin(q.x * 6.2 - uTime * 1.2);
          float rails = (
            stroke(abs(q.y - wave), 0.022)
            + stroke(abs(q.y + wave), 0.022)
          ) * laneWindow;
          float leftGate = segment(q, vec2(-0.78, -0.34), vec2(-0.55, 0.0), 0.026)
            + segment(q, vec2(-0.78, 0.34), vec2(-0.55, 0.0), 0.026);
          float rightGate = segment(q, vec2(0.78, -0.34), vec2(0.55, 0.0), 0.026)
            + segment(q, vec2(0.78, 0.34), vec2(0.55, 0.0), 0.026);
          float aperture = ring(length(vec2(q.x * 1.58, q.y)), 0.49, 0.025)
            * smoothstep(0.12, 0.42, abs(q.y));
          float relay = ring(abs(q.x) + abs(q.y), 0.18, 0.026);
          glyph = rails + leftGate + rightGate + aperture * 0.72 + relay;
          secondaryMask = rails * 0.45 + relay + aperture * 0.35;
        } else {
          // Maintained record: counter-phased checksum rings close around one
          // stable knot; four sparse brackets make the state addressable.
          vec2 q = rotate2d(uPhase + uTime * 0.035) * p;
          float outerGate = smoothstep(0.18, 0.48, abs(sin(theta * 4.0 + uTime * 0.12)));
          float innerGate = smoothstep(0.14, 0.44, abs(sin(theta * 3.0 - uTime * 0.10 + 0.7)));
          float outer = ring(length(q), 0.70, 0.025) * outerGate;
          float inner = ring(r, 0.48, 0.022) * innerGate;
          float agreements = ring(r, 0.59, 0.040)
            * exp(-pow(abs(sin(theta * 2.0 + 0.785)) / 0.075, 2.0));
          float brackets = 0.0;
          brackets += segment(p, vec2(-0.74, -0.58), vec2(-0.74, -0.76), 0.024);
          brackets += segment(p, vec2(-0.74, -0.76), vec2(-0.56, -0.76), 0.024);
          brackets += segment(p, vec2(0.74, -0.58), vec2(0.74, -0.76), 0.024);
          brackets += segment(p, vec2(0.74, -0.76), vec2(0.56, -0.76), 0.024);
          brackets += segment(p, vec2(-0.74, 0.58), vec2(-0.74, 0.76), 0.024);
          brackets += segment(p, vec2(-0.74, 0.76), vec2(-0.56, 0.76), 0.024);
          brackets += segment(p, vec2(0.74, 0.58), vec2(0.74, 0.76), 0.024);
          brackets += segment(p, vec2(0.74, 0.76), vec2(0.56, 0.76), 0.024);
          float knot = 1.0 - smoothstep(0.080, 0.155, abs(p.x) + abs(p.y));
          glyph = outer + inner * 0.72 + agreements + brackets * 0.82 + knot;
          secondaryMask = inner + agreements + knot;
        }

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
  const pointsRef = useRef<THREE.Points>(null);
  const chipRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!spatial || !presentation) {
      geometry.setDrawRange(0, 0);
      position.needsUpdate = true;
      return;
    }
    position.setXYZ(
      0,
      spatial.cell.pos_seed[0],
      spatial.cell.pos_seed[1],
      spatial.cell.pos_seed[2],
    );
    position.needsUpdate = true;
    geometry.setDrawRange(0, 1);
    material.uniforms.uRole.value = presentation.index;
    material.uniforms.uRadius.value = presentation.radius;
    material.uniforms.uPrimary.value.setRGB(...presentation.primary);
    material.uniforms.uSecondary.value.setRGB(...presentation.secondary);
    material.uniforms.uPhase.value = (
      (spatial.cell.id % 4096) * 0.61803398875 % 1
    ) * Math.PI * 2;
  }, [geometry, material, presentation, spatial]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

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
  const { cell } = spatial;

  return (
    <>
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={8}
      />
      <Html
        position={[cell.pos_seed[0], cell.pos_seed[1], cell.pos_seed[2]]}
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
    </>
  );
}
