import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import {
  cellBirthAnchorReadFrame,
  cellBirthAnchorSegmentEnergy,
  cellOutpointLocatorReadFrame,
  cellOutpointLocatorSegmentEnergy,
  deriveCellBirthAnchorEncoding,
  deriveCellBirthAnchorSegments,
  deriveCellOutpointLocatorEncoding,
  deriveCellOutpointLocatorSegments,
  type CellBirthAnchorSegment,
  type CellIdentityProofKind,
  type CellOutpointLocatorSegment,
} from '../../derives/cellIdentityProof.derive';

const PORTRAIT_LOCATOR_SCALE = 0.92;
const PORTRAIT_ANCHOR_DEPTH = 0.86;

function makeProofLineMaterial(
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

function buildProofLines(
  segments: ReadonlyArray<{
    from: readonly [number, number, number];
    to: readonly [number, number, number];
    color: readonly [number, number, number];
    energy: number;
  }>,
  boundingRadius: number,
) {
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
    boundingRadius,
  );
  const glowMaterial = makeProofLineMaterial(
    4.2,
    0,
    THREE.AdditiveBlending,
  );
  const coreMaterial = makeProofLineMaterial(
    0.82,
    0,
    THREE.NormalBlending,
  );
  const glow = new LineSegments2(geometry, glowMaterial);
  const core = new LineSegments2(geometry, coreMaterial);
  glow.frustumCulled = false;
  core.frustumCulled = false;
  glow.renderOrder = 12;
  core.renderOrder = 13;
  return {
    geometry,
    glowMaterial,
    coreMaterial,
    glow,
    core,
    baseColors: new Float32Array(colors),
    segmentCount: positions.length / 6,
  };
}

function updateProofColors(
  geometry: LineSegmentsGeometry,
  baseColors: Float32Array,
  segmentCount: number,
  energyForSegment: (segmentIndex: number) => number,
): void {
  const colorAttribute = geometry.getAttribute(
    'instanceColorStart',
  ) as THREE.InterleavedBufferAttribute | undefined;
  const colorArray = colorAttribute?.data.array as Float32Array | undefined;
  if (!colorAttribute || !colorArray) return;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const energy = energyForSegment(segment);
    const offset = segment * 6;
    for (let channel = 0; channel < 6; channel += 1) {
      colorArray[offset + channel] = baseColors[offset + channel] * energy;
    }
  }
  colorAttribute.data.needsUpdate = true;
}

function OutpointLocatorRead({
  cell,
  reducedMotion,
  onReadResolved,
}: {
  cell: Cell;
  reducedMotion: boolean;
  onReadResolved?: (kind: CellIdentityProofKind) => void;
}) {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);
  const startedAtRef = useRef<number | null>(null);
  const resolvedNotifiedRef = useRef(false);
  const settledRef = useRef(false);
  const onReadResolvedRef = useRef(onReadResolved);
  onReadResolvedRef.current = onReadResolved;
  const encoding = useMemo(
    () => deriveCellOutpointLocatorEncoding(
      cell.out_point.tx_hash,
      cell.out_point.index,
    ),
    [cell.out_point.index, cell.out_point.tx_hash],
  );
  const segments = useMemo(
    () => deriveCellOutpointLocatorSegments(encoding),
    [encoding],
  );
  const built = useMemo(
    () => buildProofLines(segments, 0.98),
    [segments],
  );
  const auditData = useMemo(() => ({
    memoryPortraitProof: 'address',
    memoryPortraitProofFingerprint: encoding.fingerprint,
    memoryPortraitProofIndex: encoding.index,
    memoryPortraitProofIndexBytes: encoding.indexBytes.join(','),
    memoryPortraitProofLanes: encoding.lanes
      .map((lane) => lane.toFixed(3))
      .join(','),
    memoryPortraitProofRead: reducedMotion ? 'reduced' : 'reading',
    memoryPortraitProofProgress: reducedMotion ? 1 : 0,
    memoryPortraitProofActiveLane: -1,
    memoryPortraitProofIndexProgress: reducedMotion ? 1 : 0,
  }), [encoding, reducedMotion]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
    invalidate();
  }, [built, invalidate, size.height, size.width]);

  useFrame((state) => {
    if (settledRef.current) return;
    if (startedAtRef.current === null) {
      startedAtRef.current = state.clock.elapsedTime;
    }
    const frame = cellOutpointLocatorReadFrame(
      state.clock.elapsedTime - startedAtRef.current,
      true,
      reducedMotion,
    );
    updateProofColors(
      built.geometry,
      built.baseColors,
      built.segmentCount,
      (index) => cellOutpointLocatorSegmentEnergy(
        frame,
        segments[index] as CellOutpointLocatorSegment,
      ),
    );
    built.glowMaterial.opacity = frame.state === 'reading'
      ? 0.17
      : 0.11;
    built.coreMaterial.opacity = frame.state === 'reading'
      ? 0.86
      : 0.72;
    const group = groupRef.current;
    if (group) {
      group.scale.setScalar(PORTRAIT_LOCATOR_SCALE * frame.lockScale);
      group.rotation.z = (
        Math.sin(encoding.phase) * 0.055
      ) * (1 - frame.progress);
      group.userData.memoryPortraitProofRead = frame.state;
      group.userData.memoryPortraitProofProgress = frame.progress;
      group.userData.memoryPortraitProofActiveLane =
        frame.activeLane ?? -1;
      group.userData.memoryPortraitProofIndexProgress =
        frame.indexProgress;
    }
    if (
      !resolvedNotifiedRef.current
      && (frame.state === 'resolved' || frame.state === 'reduced')
    ) {
      resolvedNotifiedRef.current = true;
      onReadResolvedRef.current?.('address');
      settledRef.current = true;
    }
    if (frame.state === 'reading') invalidate();
  });

  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={groupRef}
      position={[0, 0, 0.38]}
      userData={auditData}
    >
      <primitive object={built.glow} />
      <primitive object={built.core} />
    </group>
  );
}

function BirthAnchorRead({
  cell,
  reducedMotion,
  onReadResolved,
}: {
  cell: Cell;
  reducedMotion: boolean;
  onReadResolved?: (kind: CellIdentityProofKind) => void;
}) {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const rootRef = useRef<THREE.Group>(null);
  const lineGroupRef = useRef<THREE.Group>(null);
  const terminalRef = useRef<THREE.Mesh>(null);
  const terminalMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const startedAtRef = useRef<number | null>(null);
  const resolvedNotifiedRef = useRef(false);
  const settledRef = useRef(false);
  const onReadResolvedRef = useRef(onReadResolved);
  onReadResolvedRef.current = onReadResolved;
  const encoding = useMemo(
    () => deriveCellBirthAnchorEncoding(cell.birth_block),
    [cell.birth_block],
  );
  const segments = useMemo(
    () => deriveCellBirthAnchorSegments(encoding),
    [encoding],
  );
  const built = useMemo(
    () => buildProofLines(segments, 1.04),
    [segments],
  );
  const auditData = useMemo(() => ({
    memoryPortraitProof: 'anchor',
    memoryPortraitProofBlock: encoding.block,
    memoryPortraitProofHex: encoding.hexadecimal,
    memoryPortraitProofDigits: encoding.digits.join(','),
    memoryPortraitProofRead: reducedMotion ? 'reduced' : 'reading',
    memoryPortraitProofProgress: reducedMotion ? 1 : 0,
    memoryPortraitProofDepth: reducedMotion ? 1 : 0,
    memoryPortraitProofActiveDigit: -1,
  }), [encoding, reducedMotion]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
    invalidate();
  }, [built, invalidate, size.height, size.width]);

  useFrame((state) => {
    if (settledRef.current) return;
    if (startedAtRef.current === null) {
      startedAtRef.current = state.clock.elapsedTime;
    }
    const frame = cellBirthAnchorReadFrame(
      state.clock.elapsedTime - startedAtRef.current,
      true,
      encoding.digits.length,
      reducedMotion,
    );
    updateProofColors(
      built.geometry,
      built.baseColors,
      built.segmentCount,
      (index) => cellBirthAnchorSegmentEnergy(
        frame,
        segments[index] as CellBirthAnchorSegment,
        encoding.digits.length,
      ),
    );
    built.glowMaterial.opacity = frame.state === 'reading'
      ? 0.2
      : 0.12;
    built.coreMaterial.opacity = frame.state === 'reading'
      ? 0.9
      : 0.74;
    if (lineGroupRef.current) {
      lineGroupRef.current.scale.set(
        PORTRAIT_ANCHOR_DEPTH,
        PORTRAIT_ANCHOR_DEPTH * Math.max(0.012, frame.depthProgress),
        PORTRAIT_ANCHOR_DEPTH,
      );
    }
    if (terminalRef.current) {
      terminalRef.current.position.y =
        -PORTRAIT_ANCHOR_DEPTH * frame.depthProgress;
      terminalRef.current.rotation.z = Math.PI / 4 + (
        frame.state === 'reading' && !reducedMotion
          ? frame.progress * Math.PI * 0.46
          : encoding.phase * 0.035
      );
      terminalRef.current.scale.setScalar(
        frame.state === 'reading'
          ? 0.86 + Math.sin(frame.progress * Math.PI * 4) * 0.12
          : 0.92,
      );
    }
    if (terminalMaterialRef.current) {
      terminalMaterialRef.current.opacity = frame.state === 'idle'
        ? 0
        : frame.state === 'reading'
          ? 0.84
          : 0.68;
    }
    const root = rootRef.current;
    if (root) {
      root.userData.memoryPortraitProofRead = frame.state;
      root.userData.memoryPortraitProofProgress = frame.progress;
      root.userData.memoryPortraitProofDepth = frame.depthProgress;
      root.userData.memoryPortraitProofActiveDigit =
        frame.activeDigit ?? -1;
    }
    if (
      !resolvedNotifiedRef.current
      && (frame.state === 'resolved' || frame.state === 'reduced')
    ) {
      resolvedNotifiedRef.current = true;
      onReadResolvedRef.current?.('anchor');
      settledRef.current = true;
    }
    if (frame.state === 'reading') invalidate();
  });

  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);

  return (
    <group
      ref={rootRef}
      position={[0, 0.08, 0.38]}
      userData={auditData}
    >
      <group ref={lineGroupRef}>
        <primitive object={built.glow} />
        <primitive object={built.core} />
      </group>
      <mesh ref={terminalRef} renderOrder={14}>
        <ringGeometry args={[0.038, 0.055, 4]} />
        <meshBasicMaterial
          ref={terminalMaterialRef}
          color="#FFD58F"
          transparent
          opacity={0}
          blending={THREE.NormalBlending}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Portrait-side WHERE / WHEN reader. WHAT remains the full-hash horizon in
 * CellContentAddressHalo; only the currently inspected proof is mounted.
 */
export default function CellIdentityProofReader({
  cell,
  proof,
  reducedMotion,
  onReadResolved,
}: {
  cell: Cell;
  proof: 'address' | 'anchor' | null;
  reducedMotion: boolean;
  onReadResolved?: (kind: CellIdentityProofKind) => void;
}) {
  if (proof === 'address') {
    return (
      <OutpointLocatorRead
        cell={cell}
        reducedMotion={reducedMotion}
        onReadResolved={onReadResolved}
      />
    );
  }
  if (proof === 'anchor') {
    return (
      <BirthAnchorRead
        cell={cell}
        reducedMotion={reducedMotion}
        onReadResolved={onReadResolved}
      />
    );
  }
  return null;
}
