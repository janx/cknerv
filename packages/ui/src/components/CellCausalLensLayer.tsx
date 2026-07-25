import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Billboard, Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { CellCausalLens } from '../derives/cellCausalLens.derive';
import { cellCanvasCursor } from '../derives/cellInteraction.derive';
import {
  cellCausalArcPoint,
  deriveCellCausalLensLayout,
  type CellCausalArc,
  type CellCausalArcRole,
} from '../geometry/cellCausalLens';
import { useReducedMotion } from './hud/useReducedMotion';

const ARC_SEGMENTS = 18;
const ENDPOINT_PICK_RADIUS_PX = 10;
const INPUT_COLOR: readonly [number, number, number] = [0.47, 0.38, 1];
const SIBLING_COLOR: readonly [number, number, number] = [1, 0.48, 0.12];
const SELECTED_COLOR: readonly [number, number, number] = [1, 0.82, 0.47];
const IDENTITY_COLOR: readonly [number, number, number] = [0.54, 0.4, 1];

function syncCanvasPointerCursor(canvas: HTMLCanvasElement): void {
  canvas.style.cursor = cellCanvasCursor(
    canvas.dataset.cellPickerHover !== undefined,
    canvas.dataset.cellCausalNavigationHover !== undefined,
  );
}

function lineMaterial(
  linewidth: number,
  blending: THREE.Blending,
): LineMaterial {
  const material = new LineMaterial({
    linewidth,
    opacity: 0,
    transparent: true,
    blending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
  });
  material.worldUnits = false;
  return material;
}

function arcColor(
  role: CellCausalArcRole,
  identityOnly: boolean,
): readonly [number, number, number] {
  if (identityOnly) return IDENTITY_COLOR;
  if (role === 'input') return INPUT_COLOR;
  return role === 'selected-output' ? SELECTED_COLOR : SIBLING_COLOR;
}

function buildLinework(
  arcs: readonly CellCausalArc[],
  identityOnly: boolean,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const arc of arcs) {
    const color = arcColor(arc.role, identityOnly);
    for (let index = 0; index < ARC_SEGMENTS; index += 1) {
      const fromT = index / ARC_SEGMENTS;
      const toT = (index + 1) / ARC_SEGMENTS;
      const from = cellCausalArcPoint(arc, fromT);
      const to = cellCausalArcPoint(arc, toT);
      positions.push(...from, ...to);
      // Both semantic directions run along arc.from → arc.to. A restrained
      // luminance ramp supplies direction without a looping fake packet.
      const fromEnergy = 0.24 + fromT * 0.76;
      const toEnergy = 0.24 + toT * 0.76;
      colors.push(
        color[0] * fromEnergy,
        color[1] * fromEnergy,
        color[2] * fromEnergy,
        color[0] * toEnergy,
        color[1] * toEnergy,
        color[2] * toEnergy,
      );
    }
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);
  geometry.computeBoundingSphere();
  const glowMaterial = lineMaterial(5.4, THREE.AdditiveBlending);
  const coreMaterial = lineMaterial(1.05, THREE.NormalBlending);
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
  };
}

function cssStatusColor(lens: CellCausalLens): string {
  if (lens.status === 'exact') return '#91F7FF';
  if (lens.status === 'partial') return '#FFD48C';
  return '#9D7BD8';
}

function endpointCssColor(
  role: CellCausalArcRole,
  identityOnly: boolean,
): string {
  if (identityOnly) return '#9D7BD8';
  if (role === 'input') return '#9D8BFF';
  return role === 'selected-output' ? '#FFD48C' : '#FF9830';
}

function navigationRoleLabel(role: CellCausalArcRole): string {
  return role === 'input' ? 'INPUT CELL' : 'SIBLING OUTPUT';
}

function shortHash(value: string): string {
  return value.length <= 14
    ? value
    : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function sceneSignature(lens: CellCausalLens): string {
  const endpoints = [...lens.inputs, ...lens.outputs].map((item) => (
    item.record
      ? `${item.role}:${item.id}:${item.record.pos_seed.join(',')}`
      : `${item.role}:${item.id}:missing`
  ));
  return [
    lens.key,
    lens.status,
    lens.inputCount ?? '?',
    lens.outputCount ?? '?',
    ...endpoints,
  ].join('|');
}

type NavigableCausalArc = CellCausalArc & {
  navigationTargetId: number;
};

function CellCausalEndpointPicker({
  arcs,
  onHover,
  onNavigateCell,
}: {
  arcs: readonly CellCausalArc[];
  onHover: (cellId: number | null) => void;
  onNavigateCell: (cellId: number) => void;
}) {
  const ref = useRef<THREE.Object3D>(null);
  const { gl, size } = useThree();
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const navigableArcs = useMemo(
    () => arcs.filter((arc): arc is NavigableCausalArc => (
      arc.navigationTargetId !== null
    )),
    [arcs],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const world = new THREE.Vector3();
    const ndc = new THREE.Vector3();
    const rayNdc = new THREE.Vector3();
    const bestWorld = new THREE.Vector3();

    node.raycast = function raycastCausalEndpoints(raycaster, intersects) {
      const camera = raycaster.camera;
      if (!camera || navigableArcs.length === 0) return;
      rayNdc
        .copy(raycaster.ray.origin)
        .addScaledVector(raycaster.ray.direction, 1)
        .project(camera);
      const halfWidth = sizeRef.current.width * 0.5;
      const halfHeight = sizeRef.current.height * 0.5;
      let bestIndex = -1;
      let bestPixelDistanceSq = Infinity;
      let bestDepth = Infinity;

      for (let index = 0; index < navigableArcs.length; index += 1) {
        const arc = navigableArcs[index];
        const local = arc.role === 'input' ? arc.from : arc.to;
        world.set(...local).applyMatrix4(this.matrixWorld);
        ndc.copy(world).project(camera);
        if (ndc.z < -1 || ndc.z > 1) continue;
        const dx = (ndc.x - rayNdc.x) * halfWidth;
        const dy = (ndc.y - rayNdc.y) * halfHeight;
        const pixelDistanceSq = dx * dx + dy * dy;
        if (pixelDistanceSq > ENDPOINT_PICK_RADIUS_PX ** 2) continue;
        if (
          pixelDistanceSq < bestPixelDistanceSq - 0.25
          || (
            Math.abs(pixelDistanceSq - bestPixelDistanceSq) <= 0.25
            && ndc.z < bestDepth
          )
        ) {
          bestIndex = index;
          bestPixelDistanceSq = pixelDistanceSq;
          bestDepth = ndc.z;
          bestWorld.copy(world);
        }
      }
      if (bestIndex < 0) return;
      intersects.push({
        distance: raycaster.ray.origin.distanceTo(bestWorld),
        point: bestWorld.clone(),
        object: this,
        instanceId: bestIndex,
      });
    };

    return () => {
      node.raycast = THREE.Object3D.prototype.raycast;
    };
  }, [navigableArcs]);

  useEffect(() => () => {
    delete gl.domElement.dataset.cellCausalNavigationHover;
    syncCanvasPointerCursor(gl.domElement);
  }, [gl]);

  const setHovered = (cellId: number | null) => {
    if (cellId === null) {
      delete gl.domElement.dataset.cellCausalNavigationHover;
      syncCanvasPointerCursor(gl.domElement);
      onHover(null);
      return;
    }
    gl.domElement.dataset.cellCausalNavigationHover = String(cellId);
    syncCanvasPointerCursor(gl.domElement);
    onHover(cellId);
  };

  return (
    <object3D
      ref={ref}
      userData={{
        cellCausalEndpointPicker: true,
        cellCausalEndpointPickRadiusPx: ENDPOINT_PICK_RADIUS_PX,
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        if (
          typeof event.instanceId !== 'number'
          || event.instanceId < 0
          || event.instanceId >= navigableArcs.length
        ) {
          setHovered(null);
          return;
        }
        setHovered(navigableArcs[event.instanceId].navigationTargetId);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        setHovered(null);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (
          typeof event.instanceId !== 'number'
          || event.instanceId < 0
          || event.instanceId >= navigableArcs.length
        ) return;
        onNavigateCell(
          navigableArcs[event.instanceId].navigationTargetId,
        );
      }}
    />
  );
}

export interface CellCausalLensLayerProps {
  lens: CellCausalLens;
  /** Navigate only to retained input/sibling records exposed by the layout. */
  onNavigateCell?: (cellId: number) => void;
}

function CellCausalLensLayer({
  lens,
  onNavigateCell,
}: CellCausalLensLayerProps) {
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const reducedMotion = useReducedMotion();
  const hubGlyphRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number | null>(null);
  const [hoveredNavigationTargetId, setHoveredNavigationTargetId] = useState<
    number | null
  >(null);
  const layout = useMemo(() => deriveCellCausalLensLayout(lens), [lens]);
  const identityOnly = lens.status === 'unavailable';
  const built = useMemo(
    () => buildLinework(layout.arcs, identityOnly),
    [identityOnly, layout],
  );
  const statusColor = cssStatusColor(lens);
  const labelStyle = useMemo<CSSProperties>(() => ({
    minWidth: 104,
    padding: '3px 6px 3px',
    border: `1px solid ${statusColor}55`,
    borderLeftColor: statusColor,
    background: 'linear-gradient(90deg,rgba(1,5,15,.94),rgba(2,7,18,.76))',
    boxShadow: `0 0 13px ${statusColor}20, inset 0 0 9px ${statusColor}10`,
    color: statusColor,
    fontFamily: "'Share Tech Mono', ui-monospace, monospace",
    fontSize: 8,
    letterSpacing: 0.68,
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    opacity: 0,
  }), [statusColor]);

  useEffect(() => {
    built.glowMaterial.resolution.set(size.width, size.height);
    built.coreMaterial.resolution.set(size.width, size.height);
  }, [built, size.height, size.width]);
  useEffect(() => {
    startedAtRef.current = null;
  }, [lens.key]);
  useEffect(() => () => {
    built.geometry.dispose();
    built.glowMaterial.dispose();
    built.coreMaterial.dispose();
  }, [built]);
  useEffect(() => () => {
    delete gl.domElement.dataset.cellCausalNavigationHover;
    syncCanvasPointerCursor(gl.domElement);
  }, [gl, lens.key]);
  useEffect(() => {
    if (hoveredNavigationTargetId === null) return undefined;
    // CellPicker occupies the same screen point and may receive a synthetic
    // pointer-out after this nearer marker stops propagation. Reassert cursor
    // ownership after the hover state commits so that farther-layer cleanup
    // cannot erase the causal affordance.
    gl.domElement.dataset.cellCausalNavigationHover = String(
      hoveredNavigationTargetId,
    );
    syncCanvasPointerCursor(gl.domElement);
    return () => {
      if (
        gl.domElement.dataset.cellCausalNavigationHover
        === String(hoveredNavigationTargetId)
      ) {
        delete gl.domElement.dataset.cellCausalNavigationHover;
      }
      syncCanvasPointerCursor(gl.domElement);
    };
  }, [gl, hoveredNavigationTargetId]);

  useFrame((state) => {
    if (startedAtRef.current === null) {
      startedAtRef.current = state.clock.elapsedTime;
    }
    const age = Math.max(0, state.clock.elapsedTime - startedAtRef.current);
    const intro = reducedMotion ? 1 : 1 - Math.exp(-age * 5.4);
    const completeness = lens.status === 'partial' ? 0.78 : 1;
    built.glowMaterial.opacity = 0.19 * intro * completeness;
    built.coreMaterial.opacity = 0.86 * intro * completeness;
    if (hubGlyphRef.current) {
      hubGlyphRef.current.rotation.z = reducedMotion
        ? Math.PI * 0.25
        : Math.PI * 0.25 + Math.min(1, age / 0.8) * Math.PI * 0.5;
      hubGlyphRef.current.scale.setScalar(0.82 + intro * 0.18);
    }
    if (labelRef.current) {
      labelRef.current.style.opacity = intro.toFixed(3);
    }
  });

  return (
    <group
      userData={{
        cellCausalLens: true,
        cellCausalLensStatus: lens.status,
        cellCausalLensProvenance: identityOnly ? 'identity-only' : 'observed',
        cellCausalLensSelectedCell: lens.selectedCell.id,
        cellCausalLensTx: lens.txHash,
        cellCausalLensBlock: lens.block,
        cellCausalLensInputs: lens.inputCount ?? -1,
        cellCausalLensOutputs: lens.outputCount ?? -1,
        cellCausalLensMissingInputs: lens.missingInputIds.length,
        cellCausalLensMissingOutputs: lens.missingOutputIds.length,
        cellCausalLensRenderedArcs: layout.arcs.length,
        cellCausalLensNavigableEndpoints: layout.arcs.filter(
          (arc) => arc.navigationTargetId !== null,
        ).length,
        cellCausalLensHiddenInputs: layout.hiddenInputCount,
        cellCausalLensHiddenSiblings: layout.hiddenSiblingCount,
      }}
    >
      <primitive object={built.glow} dispose={null} />
      <primitive object={built.core} dispose={null} />
      {onNavigateCell ? (
        <CellCausalEndpointPicker
          arcs={layout.arcs}
          onHover={setHoveredNavigationTargetId}
          onNavigateCell={onNavigateCell}
        />
      ) : null}

      <group position={layout.hub}>
        <Billboard follow>
          <group ref={hubGlyphRef}>
            <mesh renderOrder={15}>
              <circleGeometry args={[0.42, 32]} />
              <meshBasicMaterial
                color="#01040B"
                transparent
                opacity={0.94}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <mesh renderOrder={16}>
              <ringGeometry args={[0.46, 0.58, 4, 1]} />
              <meshBasicMaterial
                color={statusColor}
                transparent
                opacity={lens.status === 'partial' ? 0.72 : 0.94}
                blending={THREE.AdditiveBlending}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <mesh rotation={[0, 0, Math.PI * 0.25]} renderOrder={16}>
              <ringGeometry args={[0.22, 0.27, 4, 1]} />
              <meshBasicMaterial
                color={identityOnly ? '#9D7BD8' : '#FFD48C'}
                transparent
                opacity={0.9}
                blending={THREE.AdditiveBlending}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        </Billboard>
      </group>

      {layout.arcs.map((arc) => {
        const at = arc.role === 'input' ? arc.from : arc.to;
        const color = endpointCssColor(arc.role, identityOnly);
        const selected = arc.role === 'selected-output';
        const navigationTargetId = arc.navigationTargetId;
        const navigable = (
          navigationTargetId !== null
          && onNavigateCell !== undefined
        );
        const hovered = navigable
          && hoveredNavigationTargetId === navigationTargetId;
        return (
          <group
            key={arc.key}
            position={at}
            userData={{
              cellCausalEndpoint: arc.role,
              cellCausalEndpointId: arc.endpointId,
              cellCausalEndpointNavigable: navigable,
              cellCausalNavigationTarget: navigationTargetId ?? -1,
            }}
          >
            <Billboard follow>
              <group scale={hovered ? 1.16 : 1}>
                <mesh rotation={[0, 0, Math.PI * 0.25]} renderOrder={14}>
                  <ringGeometry args={[
                    selected ? 0.26 : 0.16,
                    selected ? 0.34 : 0.23,
                    4,
                    1,
                  ]} />
                  <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={selected ? 0.94 : hovered ? 1 : 0.76}
                    blending={THREE.AdditiveBlending}
                    depthTest={false}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
                {navigable ? (
                  <>
                    <mesh
                      rotation={[0, 0, Math.PI * 0.25]}
                      renderOrder={14}
                    >
                      <ringGeometry args={[0.29, 0.315, 4, 1]} />
                      <meshBasicMaterial
                        color={color}
                        transparent
                        opacity={hovered ? 0.92 : 0.27}
                        blending={THREE.AdditiveBlending}
                        depthTest={false}
                        depthWrite={false}
                        toneMapped={false}
                      />
                    </mesh>
                  </>
                ) : null}
              </group>
            </Billboard>
            {hovered && navigationTargetId !== null ? (
              <Html
                position={[0, 0.62, 0]}
                center
                zIndexRange={[8, 8]}
                occlude={false}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  aria-hidden="true"
                  data-cell-causal-navigation-label="true"
                  data-causal-navigation-target={navigationTargetId}
                  style={{
                    padding: '3px 6px',
                    border: `1px solid ${color}66`,
                    borderLeftColor: color,
                    background: 'rgba(1,5,15,.92)',
                    boxShadow: `0 0 12px ${color}22`,
                    color,
                    fontFamily: "'Share Tech Mono', ui-monospace, monospace",
                    fontSize: 7.5,
                    letterSpacing: 0.62,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  {navigationRoleLabel(arc.role)} #{navigationTargetId}
                  <span style={{ color: '#E8E8E8', opacity: 0.62 }}>
                    {' · FOLLOW'}
                  </span>
                </div>
              </Html>
            ) : null}
          </group>
        );
      })}

      <Html
        position={[layout.hub[0], layout.hub[1] + 0.88, layout.hub[2]]}
        center
        zIndexRange={[7, 7]}
        occlude={false}
        style={{ pointerEvents: 'none' }}
      >
        <div
          ref={labelRef}
          aria-hidden="true"
          data-cell-causal-lens-label="true"
          data-causal-status={lens.status}
          data-causal-provenance={identityOnly ? 'identity-only' : 'observed'}
          data-causal-tx={lens.txHash}
          style={labelStyle}
        >
          <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
            <span>
              {identityOnly
                ? 'TX IDENTITY'
                : lens.status === 'partial'
                  ? 'OBSERVED TX · PARTIAL'
                  : 'OBSERVED TX'}
            </span>
            <span style={{ marginLeft: 'auto', color: '#E8E8E8', opacity: 0.68 }}>
              #{lens.block}
            </span>
          </div>
          <div style={{ marginTop: 2, color: '#E8E8E8', opacity: 0.76 }}>
            {shortHash(lens.txHash)}
          </div>
        </div>
      </Html>
    </group>
  );
}

export default memo(
  CellCausalLensLayer,
  (previous, next) => (
    sceneSignature(previous.lens) === sceneSignature(next.lens)
    && previous.onNavigateCell === next.onNavigateCell
  ),
);
