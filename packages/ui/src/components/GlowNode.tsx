import { useMemo, useRef } from 'react';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';

import type { AnimationHint, GraphNode, Vec3 } from '../types';

export interface Palette {
  /** Wireframe + halo tint. */
  edge: string;
  halo: string;
  /** Faint translucent fill for the solid faces — kept very low alpha so
   *  the wireframe edges dominate and the form reads as a clean shape. */
  fill: string;
}

export interface Shape {
  geom: THREE.BufferGeometry;
  size: number;
}

interface GlowNodeProps {
  node: GraphNode;
  position: Vec3;
  selected: boolean;
  hint: AnimationHint | undefined;
  onSelect: (id: string) => void;
  /** Edge/halo/fill colours. Supplied by the caller — `GlowNode` itself is
   *  kind-agnostic. RCG callers derive this via
   *  `_rcg/glowNodePalette#paletteFor`. */
  palette: Palette;
  /** Solid geometry + characteristic size. Supplied by the caller — `GlowNode`
   *  itself is kind-agnostic. RCG callers derive this via
   *  `_rcg/glowNodePalette#shapeFor`. */
  shape: Shape;
}

export function makeHaloMaterial(palette: Palette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(palette.halo) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uPhase;
      uniform float uIntensity;
      uniform vec3 uColor;
      void main() {
        vec2 uv = vUv - 0.5;
        float r = length(uv) * 2.0;
        if (r > 1.0) discard;
        // Tight bright core + soft halo trailing out to the edge.
        float core = pow(1.0 - r, 4.0);
        float halo = pow(1.0 - r, 1.6) * 0.42;
        float breathe = 0.78 + 0.22 * sin(uTime * 1.2 + uPhase);
        float a = (core + halo) * uIntensity * breathe;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}

export function phaseFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ((h % 1000) / 1000) * Math.PI * 2;
}

export function rateFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 17 + id.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

export default function GlowNode({
  node,
  position,
  selected,
  hint,
  onSelect,
  palette,
  shape,
}: GlowNodeProps) {
  const simClock = useSimClock();
  // Wireframe edges geometry derived once from the solid.
  const edgesGeom = useMemo(
    () => new THREE.EdgesGeometry(shape.geom),
    [shape.geom],
  );

  const haloMat = useMemo(() => {
    const m = makeHaloMaterial(palette);
    m.uniforms.uPhase.value = phaseFor(node.id);
    return m;
  }, [palette, node.id]);

  const phase = useMemo(() => phaseFor(node.id), [node.id]);
  const rate = useMemo(() => 0.7 + 0.6 * rateFor(node.id), [node.id]);

  const rotationRef = useRef<THREE.Group>(null);
  const intensityRef = useRef(1);

  useSimFrame((_, dt) => {
    const t = simClock.elapsedSec;

    // Slow drifting rotation — different axis speeds give a "floating
    // in space" tumble rather than a rigid spin.
    if (rotationRef.current) {
      rotationRef.current.rotation.y += dt * 0.12;
      rotationRef.current.rotation.x += dt * 0.05;
    }

    // Hint-driven multiplicative intensity.
    let target = 1;
    if (hint?.type === 'pulse_blue') {
      target = 1.5 + 0.5 * Math.sin(t * 14);
    } else if (hint?.type === 'flash_green' || hint?.type === 'flash_red') {
      target = 2.4;
    }
    intensityRef.current += (target - intensityRef.current) * Math.min(1, dt * 12);

    haloMat.uniforms.uTime.value = t;
    // Combined breathing rhythm + hint pulse.
    const breathe = 0.85 + 0.15 * Math.sin(t * rate + phase);
    haloMat.uniforms.uIntensity.value = intensityRef.current * breathe;
    if (hint?.type === 'flash_green') {
      haloMat.uniforms.uColor.value.set('#bbf7d0');
    } else if (hint?.type === 'flash_red') {
      haloMat.uniforms.uColor.value.set('#fecaca');
    } else {
      haloMat.uniforms.uColor.value.set(palette.halo);
    }
  });

  return (
    <group position={position}>
      {/* Outer halo: camera-facing additive sprite, dwarfs the shape so
          it reads as a built-in glow surrounding the form. */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh material={haloMat}>
          <planeGeometry args={[shape.size * 6.0, shape.size * 6.0]} />
        </mesh>
      </Billboard>

      {/* Geometric form — slowly tumbling. Bright wireframe edges +
          a solid invisible click-target sphere underneath so picking
          works anywhere within the halo. */}
      <group ref={rotationRef}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onSelect(node.id);
          }}
        >
          <primitive object={shape.geom} attach="geometry" />
          <meshBasicMaterial
            color={palette.edge}
            transparent
            opacity={0.08}
            side={THREE.DoubleSide}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <lineSegments>
          <primitive object={edgesGeom} attach="geometry" />
          <lineBasicMaterial
            color={palette.edge}
            transparent
            opacity={1}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      </group>

      {selected ? <SelectionReticle size={shape.size * 2.4} /> : null}
    </group>
  );
}

function SelectionReticle({ size }: { size: number }) {
  const ref = useRef<THREE.Group>(null);
  useSimFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * 0.6;
  });
  const half = size / 2;
  const ticks: [Vec3, Vec3][] = [
    [[-half, -half * 0.7, 0], [-half, -half, 0]],
    [[-half * 0.7, -half, 0], [-half, -half, 0]],
    [[half, -half * 0.7, 0], [half, -half, 0]],
    [[half * 0.7, -half, 0], [half, -half, 0]],
    [[-half, half * 0.7, 0], [-half, half, 0]],
    [[-half * 0.7, half, 0], [-half, half, 0]],
    [[half, half * 0.7, 0], [half, half, 0]],
    [[half * 0.7, half, 0], [half, half, 0]],
  ];
  return (
    <group ref={ref}>
      {ticks.map(([a, b], i) => (
        <mesh
          key={i}
          position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]}
          rotation={[0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])]}
        >
          <planeGeometry
            args={[Math.hypot(b[0] - a[0], b[1] - a[1]), 0.18]}
          />
          <meshBasicMaterial
            color="#e0f2fe"
            transparent
            opacity={0.9}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
