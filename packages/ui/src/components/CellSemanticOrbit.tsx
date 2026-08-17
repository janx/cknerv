import { useMemo } from 'react';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type {
  Cell,
  CellSemanticRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  CELL_SEMANTIC_TAU,
  cellSemanticAssetAccent,
  cellSemanticVisualState,
  deriveCellSemanticComposition,
} from '../derives/cellSemantics.derive';
import { cellSemanticRecordMorphologyMismatch } from '../derives/cellSemanticMorphology.derive';

const COMPOSITION_INNER_RADIUS = 2.08;
const COMPOSITION_OUTER_RADIUS = 2.24;
const ASSET_INNER_RADIUS = 2.47;
const ASSET_OUTER_RADIUS = 2.53;

/**
 * One bounded, source-agnostic marker for the selected canonical Cell.
 * The inner orbit is exact occupied-byte composition; an outer notched orbit
 * appears only when an indexed asset identity was resolved.
 */
export default function CellSemanticOrbit({ cell, record, source }: {
  cell: Cell;
  record: CellSemanticRecord;
  source: EnrichmentSourceStatus;
}) {
  const composition = useMemo(
    () => deriveCellSemanticComposition(record),
    [record],
  );
  const visualState = cellSemanticVisualState(source, record);
  if (
    !visualState
    || cellSemanticRecordMorphologyMismatch(cell, record)
    || (!composition && !record.asset)
  ) return null;

  const stale = visualState === 'stale';
  const compositionOpacity = stale ? 0.3 : 0.68;
  const assetColor = record.asset
    ? cellSemanticAssetAccent(record.asset)
    : null;

  return (
    <group
      position={cell.pos_seed}
      userData={{
        cellSemanticOrbit: true,
        cellSemanticCellId: cell.id,
        cellSemanticSourceState: visualState,
        cellSemanticCompositionBytes: composition?.totalBytes ?? 0,
        cellSemanticAssetStandard: record.asset?.standard ?? 'none',
      }}
    >
      <Billboard follow>
        {composition ? (
          <>
            <mesh renderOrder={20}>
              <ringGeometry args={[
                COMPOSITION_INNER_RADIUS - 0.035,
                COMPOSITION_OUTER_RADIUS + 0.035,
                72,
              ]} />
              <meshBasicMaterial
                color="#020712"
                transparent
                opacity={stale ? 0.52 : 0.72}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            {composition.segments.map((segment) => (
              <mesh key={segment.kind} renderOrder={21}>
                <ringGeometry args={[
                  COMPOSITION_INNER_RADIUS,
                  COMPOSITION_OUTER_RADIUS,
                  72,
                  1,
                  segment.start,
                  segment.sweep,
                ]} />
                <meshBasicMaterial
                  color={segment.color}
                  transparent
                  opacity={compositionOpacity}
                  blending={THREE.AdditiveBlending}
                  depthTest={false}
                  depthWrite={false}
                  toneMapped={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ))}
          </>
        ) : null}
        {assetColor ? (
          <mesh renderOrder={22}>
            <ringGeometry args={[
              ASSET_INNER_RADIUS,
              ASSET_OUTER_RADIUS,
              72,
              1,
              -Math.PI / 2 + 0.14,
              CELL_SEMANTIC_TAU - 0.28,
            ]} />
            <meshBasicMaterial
              color={assetColor}
              transparent
              opacity={stale ? 0.28 : 0.76}
              blending={THREE.AdditiveBlending}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ) : null}
      </Billboard>
    </group>
  );
}
