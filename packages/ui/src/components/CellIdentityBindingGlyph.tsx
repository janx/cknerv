import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CELL_IDENTITY_PROOF_KINDS,
  cellIdentityProofBindingComplete,
  type CellIdentityBindingPhase,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '../derives/cellIdentityProof.derive';

const TAU = Math.PI * 2;
const GLYPH_META: Record<CellIdentityProofKind, {
  angle: number;
  color: string;
}> = {
  address: { angle: Math.PI / 6, color: '#9DF7FF' },
  content: { angle: Math.PI * 5 / 6, color: '#C7A7FF' },
  anchor: { angle: Math.PI * 3 / 2, color: '#FFD48C' },
};

/** The knot's centre reads its phase back as colour. Parsed once, at module
 *  load: a hex string in the frame loop is a parse per frame per material. */
const CENTRE_COLORS: Record<CellIdentityBindingPhase, THREE.Color> = {
  collecting: new THREE.Color('#D9F8FF'),
  verified: new THREE.Color('#D9F8FF'),
  recalling: new THREE.Color('#C7A7FF'),
  retained: new THREE.Color('#FFD48C'),
};

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/**
 * Three independently verified facets converge on one quiet information knot.
 * This is shared by the HUD portrait and the selected Cell in the main scene.
 */
export default function CellIdentityBindingGlyph({
  binding,
  mode,
}: {
  binding: CellIdentityProofBinding;
  mode: 'portrait' | 'scene';
}) {
  const rootRef = useRef<THREE.Group>(null);
  const arcMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const railMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const terminalMaterialRefs = useRef<Array<THREE.MeshBasicMaterial | null>>(
    [],
  );
  const centreRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const centreCoreMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  // The binding this glyph has finished painting. `retained` is the terminal
  // phase: nothing below it moves once the arrival has eased home, so the
  // frame that finishes it is the last one worth spending. Only a different
  // binding — a new proof, a recall, another Cell — un-latches it.
  const latchedBindingRef = useRef<CellIdentityProofBinding | null>(null);
  const resolved = useMemo(
    () => new Set(binding.resolvedKinds),
    [binding.resolvedKinds],
  );
  const resolvedText = useMemo(
    () => binding.resolvedKinds.join(','),
    [binding.resolvedKinds],
  );
  const complete = cellIdentityProofBindingComplete(binding);
  const baseRotation = useMemo(
    () => ((binding.cellId * 0.61803398875) % 1) * TAU,
    [binding.cellId],
  );

  useFrame((state) => {
    const root = rootRef.current;
    if (!root) return;
    if (latchedBindingRef.current === binding) return;
    const elapsedSeconds = Math.max(
      0,
      (performance.now() - binding.changedAtMs) / 1000,
    );
    const transition = binding.reducedMotion
      ? 1
      : smoothstep(elapsedSeconds / 0.52);
    const moving = !binding.reducedMotion && binding.phase !== 'retained';
    const phasePulse = moving
      ? 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * (
        binding.phase === 'recalling' ? 4.2 : 2.2
      ))
      : 0.5;
    const phaseRotationRate = binding.phase === 'recalling'
      ? 0.24
      : binding.phase === 'collecting'
        ? 0.035
        : 0.012;
    root.rotation.z = baseRotation + (
      moving ? state.clock.elapsedTime * phaseRotationRate : 0
    );

    const modeScale = mode === 'portrait' ? 0.78 : 1;
    const targetScale = binding.phase === 'retained'
      ? 0.88
      : binding.phase === 'recalling'
        ? 0.96 + phasePulse * 0.025
        : complete
          ? 0.94
          : 1;
    const sourceScale = complete ? 1.2 : 0.78;
    root.scale.setScalar(
      modeScale * THREE.MathUtils.lerp(sourceScale, targetScale, transition),
    );

    CELL_IDENTITY_PROOF_KINDS.forEach((kind, index) => {
      const isResolved = resolved.has(kind);
      const isLatest = binding.lastResolvedKind === kind;
      const arrival = isLatest
        ? (1 - transition) * 0.28
        : 0;
      const arcMaterial = arcMaterialRefs.current[index];
      const railMaterial = railMaterialRefs.current[index];
      const terminalMaterial = terminalMaterialRefs.current[index];
      if (arcMaterial) {
        arcMaterial.opacity = isResolved
          ? 0.62 + arrival + (
            binding.phase === 'recalling' ? phasePulse * 0.16 : 0
          )
          : 0.12;
      }
      if (railMaterial) {
        railMaterial.opacity = isResolved
          ? complete
            ? 0.42 + phasePulse * (
              binding.phase === 'recalling' ? 0.18 : 0.04
            )
            : 0.16 + arrival
          : 0.035;
      }
      if (terminalMaterial) {
        terminalMaterial.opacity = isResolved
          ? 0.7 + arrival
          : 0.14;
      }
    });

    const centreStrength = complete
      ? THREE.MathUtils.lerp(0.08, 1, transition)
      : 0.035;
    const centreColor = CENTRE_COLORS[binding.phase];
    if (centreRingMaterialRef.current) {
      centreRingMaterialRef.current.color.copy(centreColor);
      centreRingMaterialRef.current.opacity = centreStrength * (
        binding.phase === 'recalling'
          ? 0.72 + phasePulse * 0.26
          : 0.82
      );
    }
    if (centreCoreMaterialRef.current) {
      centreCoreMaterialRef.current.color.copy(centreColor);
      centreCoreMaterialRef.current.opacity = centreStrength * (
        binding.phase === 'retained'
          ? 0.62
          : 0.42 + phasePulse * 0.28
      );
    }
    root.userData.memoryIdentityBindingPhase = binding.phase;
    root.userData.memoryIdentityBindingResolved = resolvedText;
    root.userData.memoryIdentityBindingCount = binding.resolvedKinds.length;
    root.userData.memoryIdentityBindingComplete = complete;
    root.userData.memoryIdentityBindingRevision = binding.revision;

    // Everything above is now a constant of this binding: the pulse rests at
    // a half, the rotation has stopped, and the arrival transition has
    // reached its end. Sign off on it and let the frame loop walk past.
    if (binding.phase === 'retained' && transition >= 1) {
      latchedBindingRef.current = binding;
    }
  });

  return (
    <group
      ref={rootRef}
      userData={{
        memoryIdentityBinding: true,
        memoryIdentityBindingCell: binding.cellId,
        memoryIdentityBindingMode: mode,
        memoryIdentityBindingPhase: binding.phase,
        memoryIdentityBindingResolved: resolvedText,
        memoryIdentityBindingCount: binding.resolvedKinds.length,
        memoryIdentityBindingComplete: complete,
        memoryIdentityBindingRevision: binding.revision,
      }}
    >
      {CELL_IDENTITY_PROOF_KINDS.map((kind, index) => {
        const meta = GLYPH_META[kind];
        return (
          <group key={kind} rotation={[0, 0, meta.angle]}>
            <mesh renderOrder={18}>
              <ringGeometry args={[0.57, 0.625, 28, 1, -0.42, 0.84]} />
              <meshBasicMaterial
                ref={(material) => {
                  arcMaterialRefs.current[index] = material;
                }}
                color={meta.color}
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh position={[0.31, 0, 0]} renderOrder={17}>
              <planeGeometry args={[0.45, 0.012]} />
              <meshBasicMaterial
                ref={(material) => {
                  railMaterialRefs.current[index] = material;
                }}
                color={meta.color}
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              position={[0.625, 0, 0]}
              rotation={[0, 0, Math.PI / 4]}
              renderOrder={19}
            >
              <ringGeometry args={[0.036, 0.054, 4]} />
              <meshBasicMaterial
                ref={(material) => {
                  terminalMaterialRefs.current[index] = material;
                }}
                color={meta.color}
                transparent
                opacity={0}
                blending={THREE.NormalBlending}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
      <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={20}>
        <ringGeometry args={[0.105, 0.142, 4]} />
        <meshBasicMaterial
          ref={centreRingMaterialRef}
          color="#D9F8FF"
          transparent
          opacity={0}
          blending={THREE.NormalBlending}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={19}>
        <planeGeometry args={[0.105, 0.105]} />
        <meshBasicMaterial
          ref={centreCoreMaterialRef}
          color="#D9F8FF"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
