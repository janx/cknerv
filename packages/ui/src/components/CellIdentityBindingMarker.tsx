import { useMemo, useRef } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import type {
  CellIdentityProofBinding,
} from '../derives/cellIdentityProof.derive';
import CellIdentityBindingGlyph from './CellIdentityBindingGlyph';

const GLYPH_RADIUS = 0.64;

/** Selected-Cell identity aperture, open at 0/3 and bound by resolved proofs. */
export default function CellIdentityBindingMarker({
  cell,
  binding,
}: {
  cell: Cell;
  binding: CellIdentityProofBinding;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const billboardRef = useRef<THREE.Group>(null);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const parentScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  useFrame((state) => {
    const root = rootRef.current;
    const billboard = billboardRef.current;
    if (!root || !billboard) return;
    root.parent?.updateWorldMatrix(true, false);
    root.getWorldPosition(worldPosition);
    state.camera.getWorldPosition(cameraPosition);
    root.parent?.getWorldScale(parentScale);
    const distance = Math.max(0.001, worldPosition.distanceTo(cameraPosition));
    const worldPerCssPixel = 2 * distance / (
      Math.max(1, state.size.height)
      * Math.max(0.001, state.camera.projectionMatrix.elements[5])
    );
    const inheritedScale = Math.max(
      0.001,
      (Math.abs(parentScale.x) + Math.abs(parentScale.y)
        + Math.abs(parentScale.z)) / 3,
    );
    const radiusPx = binding.phase === 'collecting' ? 25 : 29;
    billboard.scale.setScalar(
      radiusPx * worldPerCssPixel / (GLYPH_RADIUS * inheritedScale),
    );
  });

  if (binding.cellId !== cell.id) return null;

  return (
    <group
      ref={rootRef}
      position={cell.pos_seed}
      userData={{
        memoryIdentityBindingMarker: true,
        memoryIdentityBindingMarkerCell: cell.id,
        memoryIdentityBindingMarkerPhase: binding.phase,
      }}
    >
      <Billboard ref={billboardRef} follow>
        <CellIdentityBindingGlyph binding={binding} mode="scene" />
      </Billboard>
    </group>
  );
}
