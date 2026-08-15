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
  CELL_EXPANDED_DETAIL_THRESHOLD,
  cellNucleusLodRefreshDue,
  cellFocusTarget,
  consensusBraidRenderScale,
  dampCellFocus,
} from '../derives/cellInteraction.derive';
import {
  cellNucleusFarFieldBeyond,
  ensureCellFieldBounds,
  makeCellFieldBoundsCache,
} from '../derives/cellNucleusFarField.derive';
import { makeNucleusPointMaterial } from '../materials/cellNucleusMaterial';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../materials/pointSpritePresentation';
import { QUALITY_PRESETS, useQualityRuntime } from '../tweaks/qualityPresets';
import { useSimClock } from '../tweaks/SimClockScope';
import { useConsensusMemoryFocusRef } from '../hooks/consensusMemoryFocusContext';
import {
  consensusMemoryCellResponseForFrame,
  consensusMemoryRouteHopCellFocus,
  type ConsensusMemoryCellResponse,
} from '../nerve/consensusMemoryTrace';
import {
  writeSparseScalarAttribute,
  type ScalarAttributeSlotWrite,
} from '../geometry/sparseScalarAttribute';
import { markPopulatedBufferUpdate } from '../geometry/populatedBufferAttribute';

const NEAR_DIST = 2.5;
const FAR_DIST = 9.5;
const MAX_NEAR_CAPACITY = 12;
const MAX_SEG = 420;
const MAX_NODE = 12;

const BRAID_GLOW_WIDTH_PX = 2.7;
const BRAID_CORE_WIDTH_PX = 0.78;
const BRAID_GLOW_OPACITY = 0.11;
const BRAID_CORE_OPACITY = 0.86;
const FAR_DIST_SQ = FAR_DIST * FAR_DIST;
const EMPTY_RECALL_BY_CELL: ReadonlyMap<
  number,
  ConsensusMemoryCellResponse
> = new Map();

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
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'aSize',
    new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'aAlpha',
    new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'aResolve',
    new THREE.BufferAttribute(resolve, 1).setUsage(THREE.DynamicDrawUsage),
  );
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
  const memorySignal = QUALITY_PRESETS[quality].memorySignal;
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
    const positionAttribute = geometry.getAttribute(
      'instanceStart',
    ) as THREE.InterleavedBufferAttribute;
    const colorAttribute = geometry.getAttribute(
      'instanceColorStart',
    ) as THREE.InterleavedBufferAttribute;
    positionAttribute.data.setUsage(THREE.DynamicDrawUsage);
    colorAttribute.data.setUsage(THREE.DynamicDrawUsage);
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
  const recallResponses = useRef<Map<number, ConsensusMemoryCellResponse>>(
    new Map(),
  );
  const focusByCell = useRef<Map<number, number>>(new Map());
  const visibleIndexByCell = useRef<Map<number, number>>(new Map());
  const detailSlots = useRef<number[]>([]);
  const focusSlots = useRef<number[]>([]);
  const recallSlots = useRef<number[]>([]);
  const recallStateSlots = useRef<number[]>([]);
  const cursor = useRef<GalaxyNucleusCursor>({ lineVertices: 0, nodes: 0 });
  const committedDrawCounts = useRef({ lineSegments: 0, nodes: 0 });
  const lodElapsedS = useRef(Number.POSITIVE_INFINITY);
  const lastCellsList = useRef<Cell[] | null>(null);
  const lastCount = useRef(-1);
  const lastSelectedCellId = useRef<number | null>(null);
  const lastHoveredCellId = useRef<number | null>(null);
  const lastRecallKey = useRef<string | null>(null);
  const lastNearCap = useRef(-1);
  const routeHopIndexCache = useRef({
    cells: null as Cell[] | null,
    count: -1,
    cellId: -1,
    index: -1,
  });
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const cameraLocalPosition = useMemo(() => new THREE.Vector3(), []);
  const groupWorldInverse = useMemo(() => new THREE.Matrix4(), []);
  const fieldBounds = useMemo(makeCellFieldBoundsCache, []);

  useFrame((state, deltaSeconds) => {
    const group = groupRef.current;
    const cells = cellsListRef.current;
    const count = Math.min(drawCountRef.current ?? 0, cells?.length ?? 0);
    if (!group || !cells || count === 0) {
      const committed = committedDrawCounts.current;
      if (committed.lineSegments !== 0) {
        lineGeometry.instanceCount = 0;
        committed.lineSegments = 0;
      }
      if (committed.nodes !== 0) {
        nodeGeometry.setDrawRange(0, 0);
        committed.nodes = 0;
      }
      return;
    }

    const pointPixelRatio = resolvePointSpritePixelRatio(
      state.gl.getPixelRatio(),
    );
    nodeMaterial.uniforms.uViewportHeight.value = pointSpriteDeviceViewportHeight(
      state.size.height,
      pointPixelRatio,
    );
    nodeMaterial.uniforms.uProjY.value = state.camera.projectionMatrix.elements[5];
    glowMaterial.linewidth = BRAID_GLOW_WIDTH_PX
      * memorySignal.expandedLineScale;
    coreMaterial.linewidth = BRAID_CORE_WIDTH_PX
      * memorySignal.expandedLineScale;
    glowMaterial.opacity = BRAID_GLOW_OPACITY * memorySignal.energyScale;
    coreMaterial.opacity = BRAID_CORE_OPACITY * memorySignal.energyScale;
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
    let recallByCell = EMPTY_RECALL_BY_CELL;
    if (recallFocus) {
      // Rebuilt in place every frame: a held recall would otherwise leave a
      // fresh Map, a fresh Set and two spread arrays behind on each one. The
      // Map itself de-duplicates a Cell that is both a source and a target.
      const responses = recallResponses.current;
      responses.clear();
      for (const source of recallFocus.sources) {
        const response = consensusMemoryCellResponseForFrame(
          recallFocus,
          source.id,
          simClock.elapsedSec,
        );
        if (response) responses.set(source.id, response);
      }
      for (const targetId of recallFocus.targetIds) {
        const response = consensusMemoryCellResponseForFrame(
          recallFocus,
          targetId,
          simClock.elapsedSec,
        );
        if (response) responses.set(targetId, response);
      }
      recallByCell = responses;
    }
    const interactionChanged = selectedCellId !== lastSelectedCellId.current
      || hoveredCellId !== lastHoveredCellId.current
      || recallChanged;
    lastSelectedCellId.current = selectedCellId;
    lastHoveredCellId.current = hoveredCellId;
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
    let focusEnvelopeChanged = false;
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
      if (next !== current) focusEnvelopeChanged = true;
      if (next === 0 && target === 0) focusByCell.current.delete(cellId);
      else focusByCell.current.set(cellId, next);
    }

    lodElapsedS.current += Math.max(0, deltaSeconds);
    const qualityBudgetChanged = nucleusNearCap !== lastNearCap.current;
    const renderCellsChanged = cells !== lastCellsList.current
      || count !== lastCount.current;
    const cellsChanged = renderCellsChanged || qualityBudgetChanged;
    const focusNeedsWrite = focusEnvelopeChanged
      || (renderCellsChanged && focusByCell.current.size > 0);
    if (renderCellsChanged) {
      const indices = visibleIndexByCell.current;
      indices.clear();
      for (let index = 0; index < count; index += 1) {
        indices.set(cells[index].id, index);
      }
    }
    const refreshLod = cellNucleusLodRefreshDue(
      lodElapsedS.current,
      cellsChanged,
      interactionChanged,
    );
    let rewriteDetailAttribute = false;

    if (refreshLod) {
      lodElapsedS.current = 0;
      lastCellsList.current = cells;
      lastCount.current = count;
      lastNearCap.current = nucleusNearCap;
      state.camera.getWorldPosition(cameraPosition);
      // CellGalaxy rotates the parent in its frame callback. Refresh its world
      // matrix only on the 12 Hz selection tick, not for every rendered frame.
      group.updateWorldMatrix(true, false);
      groupWorldInverse.copy(group.matrixWorld).invert();
      cameraLocalPosition
        .copy(cameraPosition)
        .applyMatrix4(groupWorldInverse);

      near.current.length = 0;
      // Whole-field early-out. Identity is a zoom-in detail: under the
      // resting overview camera every Cell is beyond FAR_DIST, so the
      // O(count) walk below can admit nothing distance-wise. Proving that
      // from one cached bounding-sphere distance (same group-local camera
      // math, same 12 Hz tick) drops `lodWalkCount` to 0. Focus entries
      // (selection / hover / route-hop cells) are the only far-camera
      // admissions, and they are walked directly from the envelope below —
      // an open detail panel must not resurrect the full per-Cell walk for
      // the whole time it stays open. Recall keeps the full walk: its
      // response set spans endpoint Cells beyond the envelope. When the
      // distance predicate declines, the walk runs exactly as before.
      const bounds = ensureCellFieldBounds(fieldBounds, cells, count);
      const envelopeOnlyLod = recallFocus === null
        && cellNucleusFarFieldBeyond(
          cameraLocalPosition.x,
          cameraLocalPosition.y,
          cameraLocalPosition.z,
          bounds,
          FAR_DIST,
        );
      const lodWalkCount = envelopeOnlyLod ? 0 : count;
      if (envelopeOnlyLod && focusByCell.current.size > 0) {
        for (const [cellId, userFocus] of focusByCell.current) {
          if (userFocus <= 0) continue;
          const index = visibleIndexByCell.current.get(cellId);
          if (index === undefined || index >= count) continue;
          const cell = cells[index];
          const dx = cell.pos_seed[0] - cameraLocalPosition.x;
          const dy = cell.pos_seed[1] - cameraLocalPosition.y;
          const dz = cell.pos_seed[2] - cameraLocalPosition.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // Beyond-field cameraDetail is provably 0; the envelope term is
          // the byte-identical interaction formula from the full walk.
          const detail = userFocus * 0.68;
          if (detail > CELL_EXPANDED_DETAIL_THRESHOLD) {
            near.current.push({
              cell,
              index,
              detail,
              cameraDetail: 0,
              focus: userFocus,
              userFocus,
              recall: null,
              dist,
            });
          }
        }
      }
      for (let index = 0; index < lodWalkCount; index += 1) {
        const cell = cells[index];
        const userFocus = focusByCell.current.get(cell.id) ?? 0;
        const recall = recallByCell.get(cell.id) ?? null;
        // Only the retained record expands its canonical structure at a
        // distance. Sources keep their physical footprint and expose the
        // bounded address-rail signal on the shared Cell body.
        const recallDetailFocus = recall?.role === 'target' ? recall.strength : 0;
        const focus = Math.max(userFocus, recallDetailFocus);
        const dx = cell.pos_seed[0] - cameraLocalPosition.x;
        const dy = cell.pos_seed[1] - cameraLocalPosition.y;
        const dz = cell.pos_seed[2] - cameraLocalPosition.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        // Resting Cells outside the LOD radius cannot contribute. Avoid both
        // a square root and the former per-Cell world-matrix transform for the
        // overwhelmingly common far-field path.
        if (focus <= 0 && distSq >= FAR_DIST_SQ) continue;
        const dist = Math.sqrt(distSq);
        const cameraDetail = Math.max(
          0,
          Math.min(1, (FAR_DIST - dist) / (FAR_DIST - NEAR_DIST)),
        );
        // Interaction reveals the identity at any distance, but it does not
        // pretend a 20 px far-field mark can carry every microscopic stitch.
        // Hover = contributor paths; selected = paths + partial agreements;
        // actual camera proximity remains the only route to full micro-detail.
        const interactionDetail = focus * (0.68 + cameraDetail * 0.32);
        const detail = Math.max(cameraDetail, interactionDetail);
        if (detail > CELL_EXPANDED_DETAIL_THRESHOLD) {
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
      // The beyond-prefix scan is O(all retained cells); cache it per
      // (cells list, prefix, hop cell) so steady LOD ticks skip the walk.
      let routeHopIndex = -1;
      if (routeHopFocus !== null) {
        const cached = routeHopIndexCache.current;
        if (
          cached.cells !== cells
          || cached.count !== count
          || cached.cellId !== routeHopFocus.cellId
        ) {
          cached.cells = cells;
          cached.count = count;
          cached.cellId = routeHopFocus.cellId;
          cached.index = cells.findIndex((cell, index) => (
            index >= count && cell.id === routeHopFocus.cellId
          ));
        }
        routeHopIndex = cached.index;
      }
      if (routeHopIndex >= count) {
        const cell = cells[routeHopIndex];
        const dx = cell.pos_seed[0] - cameraLocalPosition.x;
        const dy = cell.pos_seed[1] - cameraLocalPosition.y;
        const dz = cell.pos_seed[2] - cameraLocalPosition.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
        if (detail > CELL_EXPANDED_DETAIL_THRESHOLD) {
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
      rewriteDetailAttribute = true;
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
      }
      rewriteDetailAttribute = true;
    }

    if (rewriteDetailAttribute) {
      const writes: ScalarAttributeSlotWrite[] = [];
      for (const entry of near.current) {
        if (entry.index < count) {
          writes.push({ index: entry.index, value: entry.detail });
        }
      }
      writeSparseScalarAttribute(detailAttr, detailSlots.current, writes);
    }

    // The focus buffer is entirely idle in the resting state. Clear and upload
    // it only while an envelope is active, plus one final frame on release.
    if (focusNeedsWrite) {
      const writes: ScalarAttributeSlotWrite[] = [];
      for (const entry of near.current) {
        if (entry.index < count && entry.userFocus !== 0) {
          writes.push({ index: entry.index, value: entry.userFocus });
        }
      }
      writeSparseScalarAttribute(focusAttr, focusSlots.current, writes);
    }

    // Recall buffers are dormant outside an explicit user request. The final
    // release frame clears both arrays, so a historical read never leaves a
    // persistent mark or masquerades as a new chain write.
    if (recallNeedsWrite) {
      const recallWrites: ScalarAttributeSlotWrite[] = [];
      const stateWrites: ScalarAttributeSlotWrite[] = [];
      for (const [cellId, response] of recallByCell) {
        const index = visibleIndexByCell.current.get(cellId);
        if (index === undefined) continue;
        recallWrites.push({
          index,
          value: response.role === 'target'
            ? response.strength
            : -response.strength,
        });
        stateWrites.push({ index, value: response.convergence });
      }
      writeSparseScalarAttribute(
        recallAttr,
        recallSlots.current,
        recallWrites,
      );
      writeSparseScalarAttribute(
        recallStateAttr,
        recallStateSlots.current,
        stateWrites,
      );
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
        entry.userFocus,
      );
    }

    const lineFloatCount = writeCursor.lineVertices * 3;
    const lineSegmentCount = writeCursor.lineVertices / 2;
    const committed = committedDrawCounts.current;
    if (lineSegmentCount !== committed.lineSegments) {
      lineGeometry.instanceCount = lineSegmentCount;
      committed.lineSegments = lineSegmentCount;
    }
    const positionAttribute = lineGeometry.getAttribute(
      'instanceStart',
    ) as THREE.InterleavedBufferAttribute;
    const colorAttribute = lineGeometry.getAttribute(
      'instanceColorStart',
    ) as THREE.InterleavedBufferAttribute;
    markPopulatedBufferUpdate(positionAttribute.data, lineFloatCount);
    markPopulatedBufferUpdate(colorAttribute.data, lineFloatCount);

    if (writeCursor.nodes !== committed.nodes) {
      nodeGeometry.setDrawRange(0, writeCursor.nodes);
      committed.nodes = writeCursor.nodes;
    }
    const nodePositionAttribute = nodeGeometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const nodeSizeAttribute = nodeGeometry.getAttribute(
      'aSize',
    ) as THREE.BufferAttribute;
    const nodeAlphaAttribute = nodeGeometry.getAttribute(
      'aAlpha',
    ) as THREE.BufferAttribute;
    const nodeResolveAttribute = nodeGeometry.getAttribute(
      'aResolve',
    ) as THREE.BufferAttribute;
    markPopulatedBufferUpdate(
      nodePositionAttribute,
      writeCursor.nodes * nodePositionAttribute.itemSize,
    );
    markPopulatedBufferUpdate(nodeSizeAttribute, writeCursor.nodes);
    markPopulatedBufferUpdate(nodeAlphaAttribute, writeCursor.nodes);
    markPopulatedBufferUpdate(nodeResolveAttribute, writeCursor.nodes);
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
