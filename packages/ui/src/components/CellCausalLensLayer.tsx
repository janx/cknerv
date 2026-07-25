import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import { Billboard, Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { CellCausalLens } from '../derives/cellCausalLens.derive';
import {
  cellCausalArcPoint,
  deriveCellCausalLensLayout,
  type CellCausalArc,
  type CellCausalArcRole,
} from '../geometry/cellCausalLens';
import { useReducedMotion } from './hud/useReducedMotion';

const ARC_SEGMENTS = 18;
const INPUT_COLOR: readonly [number, number, number] = [0.47, 0.38, 1];
const SIBLING_COLOR: readonly [number, number, number] = [1, 0.48, 0.12];
const SELECTED_COLOR: readonly [number, number, number] = [1, 0.82, 0.47];
const IDENTITY_COLOR: readonly [number, number, number] = [0.54, 0.4, 1];

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

function CellCausalLensLayer({
  lens,
}: {
  lens: CellCausalLens;
}) {
  const size = useThree((state) => state.size);
  const reducedMotion = useReducedMotion();
  const hubGlyphRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number | null>(null);
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
        cellCausalLensTx: lens.txHash,
        cellCausalLensBlock: lens.block,
        cellCausalLensInputs: lens.inputCount ?? -1,
        cellCausalLensOutputs: lens.outputCount ?? -1,
        cellCausalLensMissingInputs: lens.missingInputIds.length,
        cellCausalLensMissingOutputs: lens.missingOutputIds.length,
        cellCausalLensRenderedArcs: layout.arcs.length,
        cellCausalLensHiddenInputs: layout.hiddenInputCount,
        cellCausalLensHiddenSiblings: layout.hiddenSiblingCount,
      }}
    >
      <primitive object={built.glow} dispose={null} />
      <primitive object={built.core} dispose={null} />

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
        return (
          <group
            key={arc.key}
            position={at}
            userData={{
              cellCausalEndpoint: arc.role,
              cellCausalEndpointId: arc.endpointId,
            }}
          >
            <Billboard follow>
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
                  opacity={selected ? 0.94 : 0.76}
                  blending={THREE.AdditiveBlending}
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            </Billboard>
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
  ),
);
