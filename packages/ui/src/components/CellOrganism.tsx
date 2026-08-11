import { useEffect, useMemo, useRef } from 'react';
import { useControls } from 'leva';
import * as THREE from 'three';
import type { Cell } from '@cknerv/types';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  INSTANCE_CAPACITY,
} from '../geometry/cellPositions';
import { deriveCellVisual } from '../derives/cellVisual.derive';
import { makeCellOrganismMaterial } from '../materials/cellOrganismMaterial';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import { useQualityRuntime } from '../tweaks/qualityPresets';
import {
  resolveCellDisplayLimit,
  useCellDisplayRuntime,
} from '../tweaks/cellDisplay';
import { CELL_FORM_FOLDER } from '../tweaks/cellFormControl';

const MEMBRANE_R = 0.155;
const TAU = Math.PI * 2;

interface CellOrganismProps {
  /** Keeps membrane morphogenesis aligned with the existing point core. */
  eventDelayS?: number;
}

export function makeOrganismGeometry(detail: number): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  if (geometry.index) geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  const count = geometry.getAttribute('position').count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    bary.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 3);
  }
  geometry.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
  return geometry;
}

/**
 * Real-time code mockup for the programmable silicon Cell.
 * One InstancedMesh covers the whole visible Cell sample; no per-Cell objects.
 */
export default function CellOrganism({
  eventDelayS = 0,
}: CellOrganismProps) {
  const simClock = useSimClock();
  const cache = useCellGalaxy();
  const { effective: quality } = useQualityRuntime();
  const cellDisplay = useCellDisplayRuntime();
  const { membraneOpacity, membraneScale } = useControls(CELL_FORM_FOLDER, {
    membraneOpacity: {
      value: 0.78,
      min: 0.25,
      max: 1.0,
      step: 0.025,
      label: 'shell alpha',
    },
    membraneScale: {
      value: 1.0,
      min: 0.7,
      max: 1.5,
      step: 0.025,
      label: 'shell scale',
    },
  });
  const cellDisplayLimit = resolveCellDisplayLimit(cellDisplay);
  const geometryDetail = quality === 'high' ? 1 : 0;

  const accent = useMemo(() => new Float32Array(INSTANCE_CAPACITY * 3), []);
  const genome = useMemo(() => new Float32Array(INSTANCE_CAPACITY * 4), []);
  const semantic = useMemo(() => new Float32Array(INSTANCE_CAPACITY * 4), []);
  const born = useMemo(() => new Float32Array(INSTANCE_CAPACITY), []);
  const death = useMemo(() => {
    const values = new Float32Array(INSTANCE_CAPACITY);
    values.fill(1e9);
    return values;
  }, []);
  const phase = useMemo(() => new Float32Array(INSTANCE_CAPACITY), []);

  const attributes = useMemo(() => ({
    accent: new THREE.InstancedBufferAttribute(accent, 3).setUsage(THREE.DynamicDrawUsage),
    genome: new THREE.InstancedBufferAttribute(genome, 4).setUsage(THREE.DynamicDrawUsage),
    semantic: new THREE.InstancedBufferAttribute(semantic, 4).setUsage(THREE.DynamicDrawUsage),
    born: new THREE.InstancedBufferAttribute(born, 1).setUsage(THREE.DynamicDrawUsage),
    death: new THREE.InstancedBufferAttribute(death, 1).setUsage(THREE.DynamicDrawUsage),
    phase: new THREE.InstancedBufferAttribute(phase, 1).setUsage(THREE.DynamicDrawUsage),
  }), [accent, genome, semantic, born, death, phase]);

  const geometry = useMemo(() => {
    const next = makeOrganismGeometry(geometryDetail);
    next.setAttribute('aAccent', attributes.accent);
    next.setAttribute('aGenome', attributes.genome);
    next.setAttribute('aSemantic', attributes.semantic);
    next.setAttribute('aBornAt', attributes.born);
    next.setAttribute('aDeathAt', attributes.death);
    next.setAttribute('aRotPhase', attributes.phase);
    return next;
  }, [geometryDetail, attributes]);
  const material = useMemo(() => makeCellOrganismMaterial(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    material.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    material.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
  }, [material]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  const lastDisplayLimitRef = useRef(-1);
  const lastScaleRef = useRef(-1);

  useSimFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const now = simClock.elapsedSec;
    const sceneStartWallMs = Date.now() - now * 1000;
    const toScene = (ms: number) => (ms - sceneStartWallMs) / 1000;
    material.uniforms.uTime.value = now;
    material.uniforms.uOpacity.value = membraneOpacity;

    if (
      cache.cells === lastCellsRef.current
      && cellDisplayLimit === lastDisplayLimitRef.current
      && membraneScale === lastScaleRef.current
    ) return;

    const count = Math.min(
      cache.cells.size,
      cellDisplayLimit,
    );
    let i = 0;
    for (const cell of cache.cells.values()) {
      if (i >= count) break;
      const visual = deriveCellVisual(cell);
      accent.set(visual.accent, i * 3);
      genome.set(visual.seeds, i * 4);
      semantic[i * 4] = visual.assetClass;
      semantic[i * 4 + 1] = visual.lockClass;
      semantic[i * 4 + 2] = visual.payload;
      semantic[i * 4 + 3] = visual.mass;
      born[i] = toScene(cell.born_at_ms) + eventDelayS;
      death[i] = cell.death_at_ms === null
        ? 1e9
        : toScene(cell.death_at_ms) + eventDelayS;
      phase[i] = visual.seeds[3] * TAU;

      dummy.position.set(cell.pos_seed[0], cell.pos_seed[1], cell.pos_seed[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(MEMBRANE_R * membraneScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      i += 1;
    }

    mesh.count = i;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    attributes.accent.needsUpdate = true;
    attributes.genome.needsUpdate = true;
    attributes.semantic.needsUpdate = true;
    attributes.born.needsUpdate = true;
    attributes.death.needsUpdate = true;
    attributes.phase.needsUpdate = true;
    lastCellsRef.current = cache.cells;
    lastDisplayLimitRef.current = cellDisplayLimit;
    lastScaleRef.current = membraneScale;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, INSTANCE_CAPACITY]}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}
