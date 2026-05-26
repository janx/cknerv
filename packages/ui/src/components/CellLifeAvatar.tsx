// CellLifeAvatar — per-cell procedural seed-of-life billboard.
// Sits as a sibling of NeuralNetwork / CellShell inside the rotating canopy
// group; reads cells from the cells projection; packs each cell's
// content_hash into per-instance bit attributes; renders 0 or 1 instanced
// quad per cell via the shared shader material.

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import type { Cell } from '@cknerv/types';
import { useSimFrame } from '../tweaks/useSimFrame';
import { simClock } from '../tweaks/simClock';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  INSTANCE_CAPACITY,
} from '../geometry/cellPositions';
import { GENERIC_SHELL_SIZE, TAGGED_SHELL_SIZE } from './CellShell';
import { BLOCK_HIGHLIGHT_DELAY_S } from './CellGalaxy';
import { makeCellLifeAvatarMaterial } from '../materials/cellLifeAvatarMaterial';
import { packFromHash } from '../cellLife/bitsPack';

interface AvatarBuffers {
  posArr: Float32Array;        // vec3 per instance
  bornArr: Float32Array;
  deathArr: Float32Array;
  sizeArr: Float32Array;
  alive0Arr: Float32Array;     // vec4 per instance
  alive1Arr: Float32Array;
  color0Arr: Float32Array;     // vec4
  color1Arr: Float32Array;
  shapeArr: Float32Array;
  dualArr: Float32Array;
}

function allocAvatarBuffers(cap: number): AvatarBuffers {
  return {
    posArr:    new Float32Array(cap * 3),
    bornArr:   new Float32Array(cap),
    deathArr:  new Float32Array(cap),
    sizeArr:   new Float32Array(cap),
    alive0Arr: new Float32Array(cap * 4),
    alive1Arr: new Float32Array(cap),
    color0Arr: new Float32Array(cap * 4),
    color1Arr: new Float32Array(cap),
    shapeArr:  new Float32Array(cap),
    dualArr:   new Float32Array(cap),
  };
}

function writeAvatarBuffers(
  cells: Cell[],
  count: number,
  toSceneSeconds: (ms: number) => number,
  buffers: AvatarBuffers,
  shellScale: number,
) {
  for (let i = 0; i < count; i++) {
    const cell = cells[i];
    const [x, y, z] = cell.pos_seed;
    buffers.posArr[i * 3 + 0] = x;
    buffers.posArr[i * 3 + 1] = y;
    buffers.posArr[i * 3 + 2] = z;

    buffers.bornArr[i]  = toSceneSeconds(cell.born_at_ms) + BLOCK_HIGHLIGHT_DELAY_S;
    buffers.deathArr[i] = cell.death_at_ms !== null
      ? toSceneSeconds(cell.death_at_ms) + BLOCK_HIGHLIGHT_DELAY_S
      : 1e9;

    const isTagged = cell.tag !== null;
    const radius = (isTagged ? TAGGED_SHELL_SIZE : GENERIC_SHELL_SIZE) * shellScale;
    buffers.sizeArr[i] = radius;

    const packed = packFromHash(cell.content_hash, isTagged);
    buffers.alive0Arr[i * 4 + 0] = packed.alive0[0];
    buffers.alive0Arr[i * 4 + 1] = packed.alive0[1];
    buffers.alive0Arr[i * 4 + 2] = packed.alive0[2];
    buffers.alive0Arr[i * 4 + 3] = packed.alive0[3];
    buffers.alive1Arr[i] = packed.alive1;
    buffers.color0Arr[i * 4 + 0] = packed.color0[0];
    buffers.color0Arr[i * 4 + 1] = packed.color0[1];
    buffers.color0Arr[i * 4 + 2] = packed.color0[2];
    buffers.color0Arr[i * 4 + 3] = packed.color0[3];
    buffers.color1Arr[i] = packed.color1;
    buffers.shapeArr[i] = packed.shape;
    buffers.dualArr[i] = packed.dual;
  }
}

interface CellLifeAvatarProps {
  shellScale: number;
}

export default function CellLifeAvatar({ shellScale }: CellLifeAvatarProps) {
  const cellsCache = useCellGalaxy();
  const material = useMemo(() => makeCellLifeAvatarMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);

  const baseGeom = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  useEffect(() => () => baseGeom.dispose(), [baseGeom]);

  const buffers = useMemo(() => allocAvatarBuffers(INSTANCE_CAPACITY), []);

  const posAttr    = useMemo(() => new THREE.InstancedBufferAttribute(buffers.posArr, 3), [buffers]);
  const bornAttr   = useMemo(() => new THREE.InstancedBufferAttribute(buffers.bornArr, 1), [buffers]);
  const deathAttr  = useMemo(() => new THREE.InstancedBufferAttribute(buffers.deathArr, 1), [buffers]);
  const sizeAttr   = useMemo(() => new THREE.InstancedBufferAttribute(buffers.sizeArr, 1), [buffers]);
  const alive0Attr = useMemo(() => new THREE.InstancedBufferAttribute(buffers.alive0Arr, 4), [buffers]);
  const alive1Attr = useMemo(() => new THREE.InstancedBufferAttribute(buffers.alive1Arr, 1), [buffers]);
  const color0Attr = useMemo(() => new THREE.InstancedBufferAttribute(buffers.color0Arr, 4), [buffers]);
  const color1Attr = useMemo(() => new THREE.InstancedBufferAttribute(buffers.color1Arr, 1), [buffers]);
  const shapeAttr  = useMemo(() => new THREE.InstancedBufferAttribute(buffers.shapeArr, 1), [buffers]);
  const dualAttr   = useMemo(() => new THREE.InstancedBufferAttribute(buffers.dualArr, 1), [buffers]);

  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = baseGeom.index;
    g.attributes.position = baseGeom.attributes.position;
    g.attributes.uv = baseGeom.attributes.uv;
    g.attributes.normal = baseGeom.attributes.normal;
    g.setAttribute('aPos', posAttr);
    g.setAttribute('aBornAt', bornAttr);
    g.setAttribute('aDeathAt', deathAttr);
    g.setAttribute('aSizeWorld', sizeAttr);
    g.setAttribute('aAlive0', alive0Attr);
    g.setAttribute('aAlive1', alive1Attr);
    g.setAttribute('aColor0', color0Attr);
    g.setAttribute('aColor1', color1Attr);
    g.setAttribute('aShape', shapeAttr);
    g.setAttribute('aDual', dualAttr);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 100);
    return g;
  }, [baseGeom, posAttr, bornAttr, deathAttr, sizeAttr, alive0Attr, alive1Attr, color0Attr, color1Attr, shapeAttr, dualAttr]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  const lastShellScaleRef = useRef<number>(0);

  useEffect(() => {
    material.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    material.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
  }, [material]);

  useSimFrame(() => {
    const now = simClock.elapsedSec;
    const sceneStartWallMs = Date.now() - now * 1000;
    const toSceneSeconds = (ms: number) => (ms - sceneStartWallMs) / 1000;

    const inputsChanged =
      cellsCache.cells !== lastCellsRef.current ||
      shellScale !== lastShellScaleRef.current;

    if (inputsChanged) {
      const cellsList = Array.from(cellsCache.cells.values());
      const count = Math.min(cellsList.length, INSTANCE_CAPACITY);
      writeAvatarBuffers(cellsList, count, toSceneSeconds, buffers, shellScale);
      geometry.instanceCount = count;
      posAttr.needsUpdate = true;
      bornAttr.needsUpdate = true;
      deathAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      alive0Attr.needsUpdate = true;
      alive1Attr.needsUpdate = true;
      color0Attr.needsUpdate = true;
      color1Attr.needsUpdate = true;
      shapeAttr.needsUpdate = true;
      dualAttr.needsUpdate = true;
      lastCellsRef.current = cellsCache.cells;
      lastShellScaleRef.current = shellScale;
    }

    material.uniforms.uTime.value = now;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
