import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Billboard } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import { makeHaloMaterial, phaseFor, rateFor } from './GlowNode';
import { CkbSelectionReticle } from './CellGalaxy';

interface CrystalGlowProps {
  /** Unit-radius solid form; edges are derived from it. Caller-owned and NOT
   *  disposed here (peers pass one module-level geometry shared by all). */
  geom: THREE.BufferGeometry;
  /** Characteristic radius: the body group is scaled to this; the halo plane
   *  is `size * haloScale`. */
  size: number;
  /** Tints wireframe, halo core, and fill. */
  color: THREE.ColorRepresentation;
  /** Read every frame; multiplies halo intensity + line/fill opacity. Lets the
   *  parent animate fade/brightness without per-frame React re-renders.
   *  Omitted ⇒ constant 1. */
  intensityRef?: React.MutableRefObject<number>;
  /** Stable seed (e.g. node id) so each instance breathes/tumbles out of phase. */
  seed?: string;
  selected?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** Halo-plane edge as a multiple of `size`. Default 6 (matches the LOCAL node). */
  haloScale?: number;
}

export default function CrystalGlow({
  geom,
  size,
  color,
  intensityRef,
  seed = '',
  selected = false,
  onClick,
  haloScale = 6,
}: CrystalGlowProps) {
  const bodyRef = useRef<THREE.Group>(null);
  const lineRef = useRef<THREE.LineBasicMaterial>(null);
  const fillRef = useRef<THREE.MeshBasicMaterial>(null);
  const fallbackIntensity = useRef(1);

  // Hex form for the halo shader palette (makeHaloMaterial reads palette.halo
  // as a color string). The line/fill meshes take the raw color directly.
  const hex = useMemo(() => `#${new THREE.Color(color).getHexString()}`, [color]);

  const haloMat = useMemo(() => {
    const m = makeHaloMaterial({ edge: hex, halo: hex, fill: hex });
    m.uniforms.uPhase.value = phaseFor(seed);
    return m;
  }, [hex, seed]);

  const edgesGeom = useMemo(() => new THREE.EdgesGeometry(geom), [geom]);
  const phase = useMemo(() => phaseFor(seed), [seed]);
  const rate = useMemo(() => 0.7 + 0.6 * rateFor(seed), [seed]);

  useEffect(
    () => () => {
      haloMat.dispose();
      edgesGeom.dispose();
    },
    [haloMat, edgesGeom],
  );

  useSimFrame((_, dt) => {
    const k = (intensityRef ?? fallbackIntensity).current;
    if (bodyRef.current) {
      bodyRef.current.rotation.x += dt * 0.15;
      bodyRef.current.rotation.y += dt * 0.1;
    }
    const t = simClock.elapsedSec;
    haloMat.uniforms.uTime.value = t;
    haloMat.uniforms.uIntensity.value = k * (0.85 + 0.15 * Math.sin(t * rate + phase));
    if (lineRef.current) lineRef.current.opacity = k;
    if (fillRef.current) fillRef.current.opacity = 0.12 * k;
  });

  return (
    <group>
      {/* Camera-facing circular halo — same shader as the LOCAL node. */}
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <mesh material={haloMat}>
          <planeGeometry args={[size * haloScale, size * haloScale]} />
        </mesh>
      </Billboard>
      {/* Tumbling wireframe crystal (unit geom scaled to `size`). */}
      <group ref={bodyRef} scale={size}>
        <lineSegments>
          <primitive object={edgesGeom} attach="geometry" />
          <lineBasicMaterial
            ref={lineRef}
            color={color}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </lineSegments>
        {/* Faint solid fill doubles as the click/hit target. */}
        <mesh onClick={onClick}>
          <primitive object={geom} attach="geometry" />
          <meshBasicMaterial
            ref={fillRef}
            color={color}
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
      {selected ? <CkbSelectionReticle size={size * 2.4} /> : null}
    </group>
  );
}
