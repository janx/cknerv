// CellNucleus — production LOD for the selected A visual language.
//
// Far cells remain one hash-stable consensus light in the shared Points draw.
// The closest cells expand into the same contributor paths used by the detail
// portrait: mid LOD reveals the braid, near LOD resolves stitches, agreement
// bridges and knots. All admitted Cells share two Line2 draws plus one point
// draw; there are no per-Cell React objects or WebGL materials.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Cell } from '@cknerv/types';
import {
  deriveGalaxyConsensusBraid,
  writeGalaxyConsensusBraidBuffers,
  type GalaxyConsensusBraid,
  type GalaxyNucleusBuffers,
  type GalaxyNucleusCursor,
} from '../derives/galaxyNucleus.derive';
import {
  cellNucleusLodRefreshDue,
  cellFocusTarget,
  consensusBraidRenderScale,
  dampCellFocus,
} from '../derives/cellInteraction.derive';
import { makeNucleusPointMaterial } from '../materials/cellNucleusMaterial';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { useSimClock } from '../tweaks/SimClockScope';
import { useConsensusMemoryFocusRef } from '../hooks/consensusMemoryFocusContext';
import {
  consensusMemoryCellResponse,
  consensusMemoryRouteHopCellFocus,
  type ConsensusMemoryCellResponse,
} from '../nerve/consensusMemoryTrace';

const NEAR_DIST = 2.5;
const FAR_DIST = 9.5;
const MAX_NEAR_CAPACITY = 12;
const MAX_SEG = 420;
const MAX_NODE = 12;

const BRAID_GLOW_WIDTH_PX = 2.7;
const BRAID_CORE_WIDTH_PX = 0.78;
const BRAID_GLOW_OPACITY = 0.11;
const BRAID_CORE_OPACITY = 0.86;

interface Props {
  cellsListRef: { readonly current: Cell[] };
  drawCountRef: { readonly current: number };
  groupRef: { readonly current: THREE.Group | null };
  detailAttr: THREE.BufferAttribute;
  focusAttr: THREE.BufferAttribute;
  recallAttr: THREE.BufferAttribute;
  recallStateAttr: THREE.BufferAttribute;
  selectedCellIdRef: { readonly current: number | null };
  hoveredCellIdRef: { readonly current: number | null };
}

function makePointGeometry(
  position: Float32Array,
  size: Float32Array,
  alpha: Float32Array,
  resolve: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute('aResolve', new THREE.BufferAttribute(resolve, 1));
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geometry;
}

function makeBraidMaterial(linewidth: number, opacity: number): LineMaterial {
  const material = new LineMaterial({
    linewidth,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  material.vertexColors = true;
  material.worldUnits = false;
  return material;
}

export default function CellNucleus({
  cellsListRef,
  drawCountRef,
  groupRef,
  detailAttr,
  focusAttr,
  recallAttr,
  recallStateAttr,
  selectedCellIdRef,
  hoveredCellIdRef,
}: Props) {
  const simClock = useSimClock();
  const recallFocusRef = useConsensusMemoryFocusRef();
  const { effective: quality } = useQualityRuntime();
  const nucleusNearCap = QUALITY_PRESETS[quality].nucleusNearCap;
  const lineVertexCap = MAX_NEAR_CAPACITY * MAX_SEG * 2;
  const nodeCap = MAX_NEAR_CAPACITY * MAX_NODE;
  const linePos = useMemo(() => new Float32Array(lineVertexCap * 3), [lineVertexCap]);
  const lineCol = useMemo(() => new Float32Array(lineVertexCap * 3), [lineVertexCap]);
  const nodePos = useMemo(() => new Float32Array(nodeCap * 3), [nodeCap]);
  const nodeSize = useMemo(() => new Float32Array(nodeCap), [nodeCap]);
  const nodeAlpha = useMemo(() => new Float32Array(nodeCap), [nodeCap]);
  const nodeResolve = useMemo(() => new Float32Array(nodeCap), [nodeCap]);
  const buffers = useMemo<GalaxyNucleusBuffers>(() => ({
    linePos,
    lineCol,
    nodePos,
    nodeSize,
    nodeAlpha,
    nodeResolve,
  }), [linePos, lineCol, nodePos, nodeSize, nodeAlpha, nodeResolve]);

  const lineGeometry = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(linePos);
    geometry.setColors(lineCol);
    geometry.instanceCount = 0;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return geometry;
  }, [linePos, lineCol]);
  const nodeGeometry = useMemo(
    () => makePointGeometry(nodePos, nodeSize, nodeAlpha, nodeResolve),
    [nodePos, nodeSize, nodeAlpha, nodeResolve],
  );
  const glowMaterial = useMemo(
    () => makeBraidMaterial(BRAID_GLOW_WIDTH_PX, BRAID_GLOW_OPACITY),
    [],
  );
  const coreMaterial = useMemo(
    () => makeBraidMaterial(BRAID_CORE_WIDTH_PX, BRAID_CORE_OPACITY),
    [],
  );
  const nodeMaterial = useMemo(() => {
    const material = makeNucleusPointMaterial(0.38);
    material.uniforms.uWarmth.value = 0;
    return material;
  }, []);
  const glow = useMemo(() => {
    const line = new LineSegments2(lineGeometry, glowMaterial);
    line.frustumCulled = false;
    line.renderOrder = 2;
    return line;
  }, [lineGeometry, glowMaterial]);
  const core = useMemo(() => {
    const line = new LineSegments2(lineGeometry, coreMaterial);
    line.frustumCulled = false;
    line.renderOrder = 3;
    return line;
  }, [lineGeometry, coreMaterial]);

  useEffect(() => () => {
    lineGeometry.dispose();
    nodeGeometry.dispose();
    glowMaterial.dispose();
    coreMaterial.dispose();
    nodeMaterial.dispose();
  }, [lineGeometry, nodeGeometry, glowMaterial, coreMaterial, nodeMaterial]);

  // Cells are immutable cache values, so WeakMap naturally invalidates when a
  // reducer replaces a Cell without growing an unbounded hash cache.
  const cache = useRef<WeakMap<Cell, GalaxyConsensusBraid>>(new WeakMap());
  const near = useRef<{
    cell: Cell;
    index: number;
    detail: number;
    cameraDetail: number;
    focus: number;
    userFocus: number;
    recall: ConsensusMemoryCellResponse | null;
    dist: number;
  }[]>([]);
  const focusByCell = useRef<Map<number, number>>(new Map());
  const cursor = useRef<GalaxyNucleusCursor>({ lineVertices: 0, nodes: 0 });
  const lodElapsedS = useRef(Number.POSITIVE_INFINITY);
  const lastCellsList = useRef<Cell[] | null>(null);
  const lastCount = useRef(-1);
  const lastSelectedCellId = useRef<number | null>(null);
  const lastHoveredCellId = useRef<number | null>(null);
  const lastRecallKey = useRef<string | null>(null);
  const lastNearCap = useRef(-1);
  const localPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, deltaSeconds) => {
    const group = groupRef.current;
    const cells = cellsListRef.current;
    const count = Math.min(drawCountRef.current ?? 0, cells?.length ?? 0);
    const detailArray = detailAttr.array as Float32Array;
    const focusArray = focusAttr.array as Float32Array;
    const recallArray = recallAttr.array as Float32Array;
    const recallStateArray = recallStateAttr.array as Float32Array;
    if (!group || !cells || count === 0) {
      lineGeometry.instanceCount = 0;
      nodeGeometry.setDrawRange(0, 0);
      return;
    }

    nodeMaterial.uniforms.uViewportHeight.value = state.size.height;
    nodeMaterial.uniforms.uProjY.value = state.camera.projectionMatrix.elements[5];
    glowMaterial.resolution.set(state.size.width, state.size.height);
    coreMaterial.resolution.set(state.size.width, state.size.height);

    const selectedCellId = selectedCellIdRef.current;
    const hoveredCellId = hoveredCellIdRef.current;
    const recallFocus = recallFocusRef?.current ?? null;
    const previousRecallKey = lastRecallKey.current;
    const routeHopFocus = recallFocus?.routeHopFocus ?? null;
    const recallKey = recallFocus
      ? `${recallFocus.key}:${routeHopFocus?.sourceId ?? '-'}:${routeHopFocus?.hopIndex ?? '-'}`
      : null;
    const recallChanged = recallKey !== previousRecallKey;
    const recallNeedsWrite = recallFocus !== null || previousRecallKey !== null;
    lastRecallKey.current = recallKey;
    const recallByCell = new Map<number, ConsensusMemoryCellResponse>();
    if (recallFocus) {
      const endpointIds = new Set([
        ...recallFocus.sources.map((source) => source.id),
        ...recallFocus.targetIds,
      ]);
      for (const cellId of endpointIds) {
        const response = consensusMemoryCellResponse(
          recallFocus,
          cellId,
          simClock.elapsedSec,
        );
        if (response) recallByCell.set(cellId, response);
      }
    }
    const interactionChanged = selectedCellId !== lastSelectedCellId.current
      || hoveredCellId !== lastHoveredCellId.current
      || recallChanged;
    lastSelectedCellId.current = selectedCellId;
    lastHoveredCellId.current = hoveredCellId;
    const focusPreviouslyActive = focusByCell.current.size > 0;
    if (selectedCellId !== null && !focusByCell.current.has(selectedCellId)) {
      focusByCell.current.set(selectedCellId, 0);
    }
    if (hoveredCellId !== null && !focusByCell.current.has(hoveredCellId)) {
      focusByCell.current.set(hoveredCellId, 0);
    }
    if (
      routeHopFocus !== null
      && !focusByCell.current.has(routeHopFocus.cellId)
    ) {
      focusByCell.current.set(routeHopFocus.cellId, 0);
    }
    for (const [cellId, current] of focusByCell.current) {
      const target = Math.max(
        cellFocusTarget(cellId, selectedCellId, hoveredCellId),
        consensusMemoryRouteHopCellFocus(
          recallFocus,
          cellId,
          simClock.elapsedSec,
        ),
      );
      const next = dampCellFocus(current, target, deltaSeconds);
      if (next === 0 && target === 0) focusByCell.current.delete(cellId);
      else focusByCell.current.set(cellId, next);
    }
    const focusNeedsWrite = focusPreviouslyActive || focusByCell.current.size > 0;

    lodElapsedS.current += Math.max(0, deltaSeconds);
    const qualityBudgetChanged = nucleusNearCap !== lastNearCap.current;
    const cellsChanged = cells !== lastCellsList.current
      || count !== lastCount.current
      || qualityBudgetChanged;
    const refreshLod = cellNucleusLodRefreshDue(
      lodElapsedS.current,
      cellsChanged,
      interactionChanged,
    );

    if (refreshLod) {
      lodElapsedS.current = 0;
      lastCellsList.current = cells;
      lastCount.current = count;
      lastNearCap.current = nucleusNearCap;
      state.camera.getWorldPosition(cameraPosition);
      // CellGalaxy rotates the parent in its frame callback. Refresh its world
      // matrix only on the 12 Hz selection tick, not for every rendered frame.
      group.updateWorldMatrix(true, false);
      const groupMatrix = group.matrixWorld;

      detailArray.fill(0, 0, count);
      near.current.length = 0;
      for (let index = 0; index < count; index += 1) {
        const cell = cells[index];
        localPosition
          .set(cell.pos_seed[0], cell.pos_seed[1], cell.pos_seed[2])
          .applyMatrix4(groupMatrix);
        const dist = localPosition.distanceTo(cameraPosition);
        const cameraDetail = Math.max(
          0,
          Math.min(1, (FAR_DIST - dist) / (FAR_DIST - NEAR_DIST)),
        );
        const userFocus = focusByCell.current.get(cell.id) ?? 0;
        const recall = recallByCell.get(cell.id) ?? null;
        // Only the retained record expands its canonical structure at a
        // distance. Sources keep their physical footprint and expose the
        // bounded address-rail signal on the shared Cell body.
        const recallDetailFocus = recall?.role === 'target' ? recall.strength : 0;
        const focus = Math.max(userFocus, recallDetailFocus);
        // Interaction reveals the identity at any distance, but it does not
        // pretend a 20 px far-field mark can carry every microscopic stitch.
        // Hover = contributor paths; selected = paths + partial agreements;
        // actual camera proximity remains the only route to full micro-detail.
        const interactionDetail = focus * (0.68 + cameraDetail * 0.32);
        const detail = Math.max(cameraDetail, interactionDetail);
        if (detail > 0.02) {
          near.current.push({
            cell,
            index,
            detail,
            cameraDetail,
            focus,
            userFocus,
            recall,
            dist,
          });
        }
      }
      // Quality presets may draw only a prefix of the retained Cell cache.
      // A verified ledger hop still gets its canonical A braid even when its
      // base sprite falls outside that prefix; this does not increase the
      // shared Points draw range or invent a surrogate Cell.
      const routeHopIndex = routeHopFocus === null
        ? -1
        : cells.findIndex((cell, index) => (
          index >= count && cell.id === routeHopFocus.cellId
        ));
      if (routeHopIndex >= count) {
        const cell = cells[routeHopIndex];
        localPosition
          .set(cell.pos_seed[0], cell.pos_seed[1], cell.pos_seed[2])
          .applyMatrix4(groupMatrix);
        const dist = localPosition.distanceTo(cameraPosition);
        const cameraDetail = Math.max(
          0,
          Math.min(1, (FAR_DIST - dist) / (FAR_DIST - NEAR_DIST)),
        );
        const userFocus = focusByCell.current.get(cell.id) ?? 0;
        const recall = recallByCell.get(cell.id) ?? null;
        const recallDetailFocus = recall?.role === 'target' ? recall.strength : 0;
        const focus = Math.max(userFocus, recallDetailFocus);
        const interactionDetail = focus * (0.68 + cameraDetail * 0.32);
        const detail = Math.max(cameraDetail, interactionDetail);
        if (detail > 0.02) {
          near.current.push({
            cell,
            index: routeHopIndex,
            detail,
            cameraDetail,
            focus,
            userFocus,
            recall,
            dist,
          });
        }
      }
      near.current.sort((left, right) => (
        Number(right.cell.id === routeHopFocus?.cellId)
          - Number(left.cell.id === routeHopFocus?.cellId)
        || right.focus - left.focus
        || left.dist - right.dist
      ));
      if (near.current.length > nucleusNearCap) near.current.length = nucleusNearCap;
      for (const entry of near.current) {
        if (entry.index < count) detailArray[entry.index] = entry.detail;
      }
      detailAttr.needsUpdate = true;
    } else if (focusNeedsWrite || recallNeedsWrite) {
      // Camera selection is cached between LOD ticks, but the semantic focus
      // envelope remains full-rate so hover/selection never feels quantized.
      for (const entry of near.current) {
        entry.userFocus = focusByCell.current.get(entry.cell.id) ?? 0;
        entry.recall = recallByCell.get(entry.cell.id) ?? null;
        const recallDetailFocus = entry.recall?.role === 'target'
          ? entry.recall.strength
          : 0;
        entry.focus = Math.max(entry.userFocus, recallDetailFocus);
        const interactionDetail = entry.focus * (0.68 + entry.cameraDetail * 0.32);
        entry.detail = Math.max(entry.cameraDetail, interactionDetail);
        if (entry.index < count) detailArray[entry.index] = entry.detail;
      }
      detailAttr.needsUpdate = true;
    }

    // The focus buffer is entirely idle in the resting state. Clear and upload
    // it only while an envelope is active, plus one final frame on release.
    if (focusNeedsWrite) {
      focusArray.fill(0, 0, count);
      for (const entry of near.current) {
        if (entry.index < count) focusArray[entry.index] = entry.userFocus;
      }
      focusAttr.needsUpdate = true;
    }

    // Recall buffers are dormant outside an explicit user request. The final
    // release frame clears both arrays, so a historical read never leaves a
    // persistent mark or masquerades as a new chain write.
    if (recallNeedsWrite) {
      recallArray.fill(0, 0, count);
      recallStateArray.fill(0, 0, count);
      for (let index = 0; index < count; index += 1) {
        const response = recallByCell.get(cells[index].id);
        if (!response) continue;
        recallArray[index] = response.role === 'target'
          ? response.strength
          : -response.strength;
        recallStateArray[index] = response.convergence;
      }
      recallAttr.needsUpdate = true;
      recallStateAttr.needsUpdate = true;
    }

    // Geometry is stable in the rotating group's local frame. Only rewrite it
    // when LOD membership changes or a semantic focus envelope is animating.
    if (!refreshLod && !focusNeedsWrite && !recallNeedsWrite) return;

    const writeCursor = cursor.current;
    writeCursor.lineVertices = 0;
    writeCursor.nodes = 0;
    for (const entry of near.current) {
      let braid = cache.current.get(entry.cell);
      if (!braid) {
        braid = deriveGalaxyConsensusBraid(entry.cell);
        cache.current.set(entry.cell, braid);
      }
      writeGalaxyConsensusBraidBuffers(
        entry.cell,
        braid,
        entry.detail,
        consensusBraidRenderScale(
          entry.dist,
          state.size.height,
          state.camera.projectionMatrix.elements[5],
          entry.focus,
          braid.presenceScale,
        ),
        buffers,
        writeCursor,
        entry.recall,
      );
    }

    lineGeometry.instanceCount = writeCursor.lineVertices / 2;
    const positionAttribute = lineGeometry.getAttribute(
      'instanceStart',
    ) as THREE.InterleavedBufferAttribute;
    const colorAttribute = lineGeometry.getAttribute(
      'instanceColorStart',
    ) as THREE.InterleavedBufferAttribute;
    positionAttribute.data.needsUpdate = true;
    colorAttribute.data.needsUpdate = true;

    nodeGeometry.setDrawRange(0, writeCursor.nodes);
    (nodeGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (nodeGeometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (nodeGeometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (nodeGeometry.getAttribute('aResolve') as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <group>
      <primitive object={glow} />
      <primitive object={core} />
      <points
        geometry={nodeGeometry}
        material={nodeMaterial}
        frustumCulled={false}
        renderOrder={4}
      />
    </group>
  );
}
