import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import {
  CELL_OUTPOINT_LOCATOR_BOUND_RADIUS,
  cellOutpointLocatorEchoFrame,
  deriveCellOutpointLocatorEncoding,
  deriveCellOutpointLocatorSegments,
  type CellIdentityProofEvent,
} from '../derives/cellIdentityProof.derive';
import {
  deriveCellIdentityProofLabel,
} from '../derives/cellIdentityProofLabel.derive';
import CellIdentityProofLabel, {
  presentCellIdentityProofLabel,
} from './CellIdentityProofLabel';

function makeLocatorLineMaterial(
  linewidth: number,
  opacity: number,
  blending: THREE.Blending,
): LineMaterial {
  const material = new LineMaterial({
    linewidth,
    opacity,
    transparent: true,
    blending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.vertexColors = true;
  material.worldUnits = false;
  return material;
}

/** Contracting, open-corner WHERE proof at the Cell's exact scene position. */
export default function CellOutpointLocatorMarker({
  cell,
  event,
}: {
  cell: Cell;
  event: CellIdentityProofEvent;
}) {
  const size = useThree((state) => state.size);
  const groupRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const settledSequenceRef = useRef<number | null>(null);
  const encoding = useMemo(
    () => deriveCellOutpointLocatorEncoding(
      cell.out_point.tx_hash,
      cell.out_point.index,
    ),
    [cell.out_point.index, cell.out_point.tx_hash],
  );
  const label = useMemo(
    () => deriveCellIdentityProofLabel(cell, 'address'),
    [cell.out_point.index, cell.out_point.tx_hash],
  );
  const built = useMemo(() => {
    const segments = deriveCellOutpointLocatorSegments(encoding);
    const positions: number[] = [];
    const colors: number[] = [];
    for (const segment of segments) {
      positions.push(...segment.from, ...segment.to);
      colors.push(
        segment.color[0] * segment.energy,
        segment.color[1] * segment.energy,
        segment.color[2] * segment.energy,
        segment.color[0] * segment.energy,
        segment.color[1] * segment.energy,
        segment.color[2] * segment.energy,
      );
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      CELL_OUTPOINT_LOCATOR_BOUND_RADIUS,
    );
    const glowMaterial = makeLocatorLineMaterial(
      4.4,
      0,
      THREE.AdditiveBlending,
    );
    const coreMaterial = makeLocatorLineMaterial(
      0.86,
      0,
      THREE.NormalBlending,
    );
    const glow = new LineSegments2(geometry, glowMaterial);
    const core = new LineSegments2(geometry, coreMaterial);
    glow.frustumCulled = false;
    core.frustumCulled = false;
    glow.renderOrder = 16;
    core.renderOrder = 17;
    return {
      geometry,
      glowMaterial,
      coreMaterial,
      glow,
      core,
      segmentCount: positions.length / 6,
    };
  }, [encoding]);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const projectedPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const parentScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const encodedTilt = useMemo(() => (
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (Math.sin(encoding.phase) * 0.055),
    )
  ), [encoding.phase]);
  const tiltQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const identityQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const auditData = useMemo(() => ({
    memoryIdentityProof: 'address',
    memoryOutpointLocator: 'idle',
    memoryOutpointLocatorCell: cell.id,
    memoryOutpointLocatorSequence: event.sequence,
    memoryOutpointLocatorFingerprint: encoding.fingerprint,
    memoryOutpointLocatorIndex: encoding.index,
    memoryOutpointLocatorIndexBytes: encoding.indexBytes.join(','),
    memoryOutpointLocatorLanes: encoding.lanes
      .map((lane) => lane.toFixed(3))
      .join(','),
    memoryOutpointLocatorSegments: built.segmentCount,
    memoryOutpointLocatorProgress: 0,
    memoryOutpointLocatorStrength: 0,
    memoryOutpointLocatorRadiusPx: 0,
  }), [
    built.segmentCount,
    cell.id,
    encoding.fingerprint,
    encoding.index,
    encoding.indexBytes,
    encoding.lanes,
    event.sequence,
  ]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
  }, [built, size.height, size.width]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group || settledSequenceRef.current === event.sequence) return;
    const frame = cellOutpointLocatorEchoFrame(
      (performance.now() - event.emittedAtMs) / 1000,
      event.reducedMotion,
    );
    group.userData.memoryOutpointLocator = frame.state;
    group.userData.memoryOutpointLocatorProgress = frame.progress;
    group.userData.memoryOutpointLocatorStrength = frame.strength;
    group.userData.memoryOutpointLocatorRadiusPx = frame.radiusPx;
    const active = (frame.state === 'confirming' || frame.state === 'reduced')
      && frame.strength > 0.001;
    group.visible = active;
    if (!active) {
      presentCellIdentityProofLabel(labelRef.current, {
        state: frame.state,
        progress: frame.progress,
        strength: 0,
        reducedMotion: event.reducedMotion,
        screenX: state.size.width * 0.5,
        screenY: state.size.height * 0.5,
        viewportWidth: state.size.width,
        viewportHeight: state.size.height,
        radiusPx: frame.radiusPx,
      });
      if (frame.state === 'settled') {
        settledSequenceRef.current = event.sequence;
      }
      return;
    }

    const parent = group.parent;
    parent?.updateWorldMatrix(true, false);
    state.camera.updateWorldMatrix(true, false);
    group.getWorldPosition(worldPosition);
    projectedPosition.copy(worldPosition).project(state.camera);
    state.camera.getWorldPosition(cameraPosition);
    state.camera.getWorldQuaternion(cameraQuaternion);
    if (parent) {
      parent.getWorldQuaternion(parentQuaternion);
      parent.getWorldScale(parentScale);
    } else {
      parentQuaternion.identity();
      parentScale.set(1, 1, 1);
    }
    group.quaternion
      .copy(parentQuaternion)
      .invert()
      .multiply(cameraQuaternion);
    if (frame.state === 'confirming') {
      const tiltStrength = 1 - Math.min(1, frame.progress / 0.74);
      tiltQuaternion.copy(encodedTilt).slerp(
        identityQuaternion,
        1 - tiltStrength,
      );
      group.quaternion.multiply(tiltQuaternion);
    }
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
    const localScale = frame.radiusPx * worldPerCssPixel
      / (CELL_OUTPOINT_LOCATOR_BOUND_RADIUS * inheritedScale);
    group.scale.setScalar(localScale);
    built.glowMaterial.opacity = frame.strength * 0.18;
    built.coreMaterial.opacity = frame.strength * 0.9;
    presentCellIdentityProofLabel(labelRef.current, {
      state: frame.state,
      progress: frame.progress,
      strength: frame.strength,
      reducedMotion: event.reducedMotion,
      screenX: (projectedPosition.x + 1) * 0.5 * state.size.width,
      screenY: (1 - projectedPosition.y) * 0.5 * state.size.height,
      viewportWidth: state.size.width,
      viewportHeight: state.size.height,
      radiusPx: frame.radiusPx,
    });
  });

  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={groupRef}
      position={cell.pos_seed}
      visible={false}
      userData={auditData}
    >
      <primitive object={built.glow} />
      <primitive object={built.core} />
      <CellIdentityProofLabel ref={labelRef} label={label} />
    </group>
  );
}
