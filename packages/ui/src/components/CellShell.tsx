// CellShell — cyan truncated-octahedron wireframe around every cell.
// Sits as a sibling of NeuralNetwork / NeuralFabric inside the rotating
// canopy group; reads cells from the cells projection; rebuilds its
// merged LineSegments BufferGeometry only on cells-Map identity change.

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useControls } from 'leva';
import { useCellGalaxy } from '../hooks/cellGalaxyContext';
import { useSimFrame } from '../tweaks/useSimFrame';
import { useSimClock } from '../tweaks/SimClockScope';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  INSTANCE_CAPACITY,
} from '../geometry/cellPositions';
import { useQualityRuntime } from '../tweaks/qualityPresets';
import {
  resolveCellDisplayLimit,
  useCellDisplayRuntime,
} from '../tweaks/cellDisplay';
import { BLOCK_HIGHLIGHT_DELAY_S } from './CellGalaxy';
import { buildTruncatedOctahedron } from '../geometry/truncatedOctahedron';
import { makeCellShellMaterial } from '../materials/cellShellMaterial';
import {
  allocCellShellBuffers,
  writeCellShellBuffers,
  writeCellShellFlashSlots,
} from '../derives/cellShell.derive';
import type { Cell } from '@cknerv/types';

const GENERIC_HALO_SIZE = 1.6;
const TAGGED_HALO_SIZE = 3.0;
const SHELL_HALO_FACTOR = 0.075;
/** Shell circumradius in world units, before `shellScale` is applied.
 *  Exported because `CellPicker` (in `CellGalaxy.tsx`) projects this to
 *  screen space as part of the per-cell click radius — keeping the
 *  shell's visual footprint and its click footprint in lockstep. */
export const GENERIC_SHELL_SIZE = GENERIC_HALO_SIZE * SHELL_HALO_FACTOR;
export const TAGGED_SHELL_SIZE = TAGGED_HALO_SIZE * SHELL_HALO_FACTOR;

const REBUILD_THROTTLE_MS = 250;

interface CellShellProps {
  /** Shared cell.id → scene-seconds flash timestamp map (owned by CellGalaxy). */
  cellFlashRef: React.MutableRefObject<Map<number, number>>;
  /** True when cellFlashRef gained an entry CellShell hasn't pushed yet. */
  flashDirtyRef: React.MutableRefObject<boolean>;
}

export default function CellShell({ cellFlashRef, flashDirtyRef }: CellShellProps) {
  const simClock = useSimClock();
  const cellsCache = useCellGalaxy();
  const { effective: quality } = useQualityRuntime();
  const cellDisplay = useCellDisplayRuntime();
  const cellDisplayLimit = resolveCellDisplayLimit(cellDisplay, quality);

  const { shellScale, shellOpacity } = useControls('Galaxy 共识记忆', {
    shellScale:   { value: 1.0, min: 0.1, max: 3.0, step: 0.05, label: 'scale' },
    shellOpacity: { value: 0.75, min: 0.05, max: 1.0, step: 0.05, label: 'opacity' },
  });

  // Geometry + material — one allocation each.
  const oct = useMemo(() => buildTruncatedOctahedron(1), []);
  const material = useMemo(() => makeCellShellMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);

  // Bind duration uniforms once.
  useEffect(() => {
    material.uniforms.uBirthDurS.value = BIRTH_DURATION_MS / 1000;
    material.uniforms.uDeathDurS.value = DEATH_DURATION_MS / 1000;
  }, [material]);

  // Pre-allocated typed-array buffers, never reallocated.
  const buffers = useMemo(() => allocCellShellBuffers(INSTANCE_CAPACITY), []);

  // BufferAttributes wrapping the typed arrays.
  const positionAttr = useMemo(() => new THREE.BufferAttribute(buffers.positionArr, 3), [buffers]);
  const posAttr      = useMemo(() => new THREE.BufferAttribute(buffers.posArr, 3), [buffers]);
  const colorAttr    = useMemo(() => new THREE.BufferAttribute(buffers.colorArr, 3), [buffers]);
  const bornAttr     = useMemo(() => new THREE.BufferAttribute(buffers.bornArr, 1), [buffers]);
  const deathAttr    = useMemo(() => new THREE.BufferAttribute(buffers.deathArr, 1), [buffers]);
  const flashAttr    = useMemo(() => new THREE.BufferAttribute(buffers.flashArr, 1), [buffers]);
  const rotPhaseAttr = useMemo(() => new THREE.BufferAttribute(buffers.rotPhaseArr, 1), [buffers]);
  const sizeAttr     = useMemo(() => new THREE.BufferAttribute(buffers.sizeArr, 1), [buffers]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', positionAttr);
    g.setAttribute('aPos', posAttr);
    g.setAttribute('aColor', colorAttr);
    g.setAttribute('aBornAt', bornAttr);
    g.setAttribute('aDeathAt', deathAttr);
    g.setAttribute('aFlashAt', flashAttr);
    g.setAttribute('aRotPhase', rotPhaseAttr);
    g.setAttribute('aSize', sizeAttr);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 100);
    return g;
  }, [positionAttr, posAttr, colorAttr, bornAttr, deathAttr, flashAttr, rotPhaseAttr, sizeAttr]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Membership-hash short-circuit (mirrors NeuralNetwork.tsx).
  const cellsListRef = useRef<Cell[]>([]);
  const drawCountRef = useRef(0);
  const lastCellsRef = useRef<Map<number, Cell> | null>(null);
  const lastRebuildAtRef = useRef(0);
  const pendingRebuildRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMembershipHashRef = useRef(-1);
  const lastDisplayLimitRef = useRef<number>(0);
  const lastShellScaleRef = useRef<number>(1);

  useEffect(() => {
    let idsXor = 0;
    for (const id of cellsCache.cells.keys()) idsXor ^= id;
    const membershipHash = (cellsCache.cells.size * 0x100000) ^ idsXor;
    if (membershipHash === lastMembershipHashRef.current) {
      // Membership-stable delta (e.g. tag changed on an existing cell):
      // the new cells Map has a different identity but the same id set,
      // so the per-cell static attributes are still valid. Silently
      // adopt the new identity so useSimFrame's
      // `cellsCache.cells !== lastCellsRef.current` check below
      // does NOT trigger a redundant rewrite.
      if (pendingRebuildRef.current) {
        clearTimeout(pendingRebuildRef.current);
        pendingRebuildRef.current = null;
      }
      lastCellsRef.current = cellsCache.cells;
      return;
    }
    lastMembershipHashRef.current = membershipHash;

    function rebuild() {
      pendingRebuildRef.current = null;
      // Note: the actual buffer write happens inside useSimFrame on the next
      // frame, because we need the live wall→scene-seconds conversion. Here
      // we only invalidate so useSimFrame knows it has to rewrite.
      lastCellsRef.current = null; // force rewrite next frame
      lastRebuildAtRef.current = performance.now();
    }
    const now = performance.now();
    const sinceLast = now - lastRebuildAtRef.current;
    if (pendingRebuildRef.current) {
      clearTimeout(pendingRebuildRef.current);
      pendingRebuildRef.current = null;
    }
    if (sinceLast >= REBUILD_THROTTLE_MS) {
      rebuild();
    } else {
      pendingRebuildRef.current = setTimeout(rebuild, REBUILD_THROTTLE_MS - sinceLast);
    }
    return () => {
      if (pendingRebuildRef.current) {
        clearTimeout(pendingRebuildRef.current);
        pendingRebuildRef.current = null;
      }
    };
  }, [cellsCache.revision, cellsCache.cells]);

  useSimFrame(() => {
    const now = simClock.elapsedSec;
    // Match CellGalaxy.tsx's live wall→scene-seconds derivation.
    const sceneStartWallMs = Date.now() - now * 1000;
    const toSceneSeconds = (ms: number) => (ms - sceneStartWallMs) / 1000;

    const inputsChanged =
      cellsCache.cells !== lastCellsRef.current ||
      cellDisplayLimit !== lastDisplayLimitRef.current ||
      shellScale !== lastShellScaleRef.current;

    if (inputsChanged) {
      const cellsList = Array.from(cellsCache.cells.values());
      cellsListRef.current = cellsList;
      const count = Math.min(
        cellsList.length,
        cellDisplayLimit,
      );
      drawCountRef.current = count;

      writeCellShellBuffers(
        cellsList,
        count,
        toSceneSeconds,
        BLOCK_HIGHLIGHT_DELAY_S,
        cellFlashRef.current,
        oct,
        GENERIC_SHELL_SIZE * shellScale,
        TAGGED_SHELL_SIZE * shellScale,
        buffers,
      );

      geometry.setDrawRange(0, buffers.vertexCount);
      positionAttr.needsUpdate = true;
      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      bornAttr.needsUpdate = true;
      deathAttr.needsUpdate = true;
      flashAttr.needsUpdate = true;
      rotPhaseAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;

      lastCellsRef.current = cellsCache.cells;
      lastDisplayLimitRef.current = cellDisplayLimit;
      lastShellScaleRef.current = shellScale;
    } else if (flashDirtyRef.current) {
      writeCellShellFlashSlots(
        cellsListRef.current,
        drawCountRef.current,
        cellFlashRef.current,
        buffers.flashArr,
      );
      flashAttr.needsUpdate = true;
      // Note: do not clear flashDirtyRef here — CellGalaxy clears it.
    }

    material.uniforms.uOpacity.value = shellOpacity;
    material.uniforms.uTime.value = now;
  });

  return (
    <lineSegments geometry={geometry} material={material} frustumCulled={false} />
  );
}
