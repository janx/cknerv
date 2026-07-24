import { useEffect, useMemo, useRef } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import {
  cellBirthAnchorEchoFrame,
  deriveCellBirthAnchorEncoding,
  deriveCellBirthAnchorSegments,
  type CellIdentityProofEvent,
} from '../derives/cellIdentityProof.derive';
import {
  deriveCellIdentityProofLabel,
} from '../derives/cellIdentityProofLabel.derive';
import { CELLS_Y, CHAIN_Y } from '../layout';
import CellIdentityProofLabel, {
  presentCellIdentityProofLabel,
} from './CellIdentityProofLabel';

const CHAIN_LOCAL_Y = CHAIN_Y - CELLS_Y;
const ANCHOR_TICK_WORLD_SCALE = 0.92;

function makeAnchorLineMaterial(
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

/**
 * A gold chronology plumb drops from the Cell canopy to the actual chain
 * plane. Hexadecimal birth-height notches preserve WHEN along the tether.
 */
export default function CellBirthAnchorMarker({
  cell,
  event,
}: {
  cell: Cell;
  event: CellIdentityProofEvent;
}) {
  const size = useThree((state) => state.size);
  const rootRef = useRef<THREE.Group>(null);
  const lineGroupRef = useRef<THREE.Group>(null);
  const terminalRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const terminalRingMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const terminalCoreMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const settledSequenceRef = useRef<number | null>(null);
  const encoding = useMemo(
    () => deriveCellBirthAnchorEncoding(cell.birth_block),
    [cell.birth_block],
  );
  const label = useMemo(
    () => deriveCellIdentityProofLabel(cell, 'anchor'),
    [cell.birth_block],
  );
  const anchorDepth = Math.max(0.1, cell.pos_seed[1] - CHAIN_LOCAL_Y);
  const terminalWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const terminalProjectedPosition = useMemo(() => new THREE.Vector3(), []);
  const built = useMemo(() => {
    const segments = deriveCellBirthAnchorSegments(encoding);
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
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.08);
    const underlayMaterial = makeAnchorLineMaterial(
      5.4,
      0,
      THREE.NormalBlending,
    );
    underlayMaterial.color.set('#050914');
    const glowMaterial = makeAnchorLineMaterial(
      6.2,
      0,
      THREE.AdditiveBlending,
    );
    const coreMaterial = makeAnchorLineMaterial(
      1.08,
      0,
      THREE.NormalBlending,
    );
    const underlay = new LineSegments2(geometry, underlayMaterial);
    const glow = new LineSegments2(geometry, glowMaterial);
    const core = new LineSegments2(geometry, coreMaterial);
    underlay.frustumCulled = false;
    glow.frustumCulled = false;
    core.frustumCulled = false;
    underlay.renderOrder = 14;
    glow.renderOrder = 15;
    core.renderOrder = 16;
    return {
      geometry,
      underlayMaterial,
      glowMaterial,
      coreMaterial,
      underlay,
      glow,
      core,
      segmentCount: positions.length / 6,
    };
  }, [encoding]);
  const auditData = useMemo(() => ({
    memoryIdentityProof: 'anchor',
    memoryBirthAnchor: 'idle',
    memoryBirthAnchorCell: cell.id,
    memoryBirthAnchorSequence: event.sequence,
    memoryBirthAnchorBlock: encoding.block,
    memoryBirthAnchorHex: encoding.hexadecimal,
    memoryBirthAnchorDigits: encoding.digits.join(','),
    memoryBirthAnchorSegments: built.segmentCount,
    memoryBirthAnchorDepth: anchorDepth,
    memoryBirthAnchorTargetLocalY: CHAIN_LOCAL_Y,
    memoryBirthAnchorTargetWorldY: CHAIN_Y,
    memoryBirthAnchorProgress: 0,
    memoryBirthAnchorStrength: 0,
  }), [
    anchorDepth,
    built.segmentCount,
    cell.id,
    encoding.block,
    encoding.digits,
    encoding.hexadecimal,
    event.sequence,
  ]);

  useEffect(() => {
    built.underlayMaterial.resolution.set(size.width, size.height);
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
  }, [built, size.height, size.width]);

  useFrame((state) => {
    const root = rootRef.current;
    if (!root || settledSequenceRef.current === event.sequence) return;
    const frame = cellBirthAnchorEchoFrame(
      (performance.now() - event.emittedAtMs) / 1000,
      event.reducedMotion,
    );
    root.userData.memoryBirthAnchor = frame.state;
    root.userData.memoryBirthAnchorProgress = frame.progress;
    root.userData.memoryBirthAnchorStrength = frame.strength;
    root.userData.memoryBirthAnchorDepthProgress = frame.depthProgress;
    const active = (frame.state === 'confirming' || frame.state === 'reduced')
      && frame.strength > 0.001;
    root.visible = active;
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
        radiusPx: 12,
      });
      if (frame.state === 'settled') {
        settledSequenceRef.current = event.sequence;
      }
      return;
    }

    if (lineGroupRef.current) {
      lineGroupRef.current.scale.set(
        ANCHOR_TICK_WORLD_SCALE,
        anchorDepth * Math.max(0.001, frame.depthProgress),
        ANCHOR_TICK_WORLD_SCALE,
      );
    }
    if (terminalRef.current) {
      terminalRef.current.position.y = -anchorDepth * frame.depthProgress;
      terminalRef.current.rotation.z = encoding.phase * 0.045;
      const pulse = event.reducedMotion
        ? 0.92
        : 0.84 + frame.pulseStrength * 0.36;
      terminalRef.current.scale.setScalar(pulse);
      terminalRef.current.getWorldPosition(terminalWorldPosition);
      terminalProjectedPosition
        .copy(terminalWorldPosition)
        .project(state.camera);
      presentCellIdentityProofLabel(labelRef.current, {
        state: frame.state,
        progress: frame.progress,
        strength: frame.strength,
        reducedMotion: event.reducedMotion,
        screenX: (terminalProjectedPosition.x + 1)
          * 0.5 * state.size.width,
        screenY: (1 - terminalProjectedPosition.y)
          * 0.5 * state.size.height,
        viewportWidth: state.size.width,
        viewportHeight: state.size.height,
        radiusPx: 12,
      });
    }
    if (terminalRingMaterialRef.current) {
      terminalRingMaterialRef.current.opacity = frame.strength * 0.94;
    }
    if (terminalCoreMaterialRef.current) {
      terminalCoreMaterialRef.current.opacity = (
        frame.strength * 0.72 + frame.pulseStrength * 0.24
      );
    }
    built.underlayMaterial.opacity = frame.strength * 0.72;
    built.glowMaterial.opacity = frame.strength * 0.2;
    built.coreMaterial.opacity = frame.strength * 0.94;
  });

  useEffect(() => () => {
    built.geometry.dispose();
    built.underlayMaterial.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={rootRef}
      position={cell.pos_seed}
      visible={false}
      userData={auditData}
    >
      <group ref={lineGroupRef}>
        <primitive object={built.underlay} />
        <primitive object={built.glow} />
        <primitive object={built.core} />
      </group>
      <Billboard ref={terminalRef} follow>
        <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={17}>
          <ringGeometry args={[0.19, 0.245, 4]} />
          <meshBasicMaterial
            ref={terminalRingMaterialRef}
            color="#FFD48C"
            transparent
            opacity={0}
            blending={THREE.NormalBlending}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 4]} renderOrder={18}>
          <planeGeometry args={[0.105, 0.105]} />
          <meshBasicMaterial
            ref={terminalCoreMaterialRef}
            color="#FFF1C7"
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <CellIdentityProofLabel ref={labelRef} label={label} />
      </Billboard>
    </group>
  );
}
