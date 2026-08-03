import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { makeProtocolCarrierGeometry } from '../../src/geometry/protocolCarrier';

const source = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/components/${file}`),
  'utf8',
);

describe('A protocol event relay', () => {
  it('uses a woven open carrier instead of a cube or solid crystal', () => {
    const geometry = makeProtocolCarrierGeometry();
    const positions = geometry.getAttribute('position');

    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(positions.count).toBeGreaterThan(120);
    expect(geometry.index).toBeNull();
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('BoxGeometry');
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('makeProtocolLandingTexture');
    geometry.dispose();
  });

  it('keeps one block carrier hue across P2P surge, courier, and delivery', () => {
    expect(source('NetworkColony.tsx')).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(source('ColonyEdges.tsx')).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(source('ColonyCourierLayer.tsx')).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(source('BlockDeliveryLayer.tsx')).toContain('CARRIER_COLOR.setRGB(...pulse.color)');
  });

  it('submits every concurrent colony courier in two fixed GPU batches', () => {
    const courier = source('ColonyCourierLayer.tsx');

    expect(courier.match(/<instancedMesh/g)).toHaveLength(2);
    expect(courier).toContain('instanceMatrix.setUsage(THREE.DynamicDrawUsage)');
    expect(courier).not.toContain('<CourierSlot');
    expect(courier).not.toContain('<sprite');
  });

  it('submits every concurrent field delivery in four semantic batches', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(delivery.match(/<instancedMesh/g)).toHaveLength(3);
    expect(delivery.match(/<lineSegments/g)).toHaveLength(1);
    expect(delivery).toContain('therefore changes instance/vertex counts, not draw calls.');
    expect(delivery).toContain('delivery.to[0]');
    expect(delivery).not.toContain('ingestPull');
    expect(delivery).not.toContain('sealBatch');
    expect(delivery).toContain('batch.instanceColor.needsUpdate = true');
    expect(delivery).not.toContain('<ProtocolCarrier');
    expect(delivery).not.toContain('registry.current');
  });

  it('journals delivered Cell ids for sparse galaxy flash uploads', () => {
    const colony = source('NetworkColony.tsx');
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(colony).toContain('flashDirtyIdsRef={flashDirtyIdsRef}');
    expect(delivery).toContain('flashDirtyIdsRef?: CellFlashDirtyIdsRef');
    expect(delivery.match(/markCellFlashDirty\(/g)).toHaveLength(1);
  });

  it('hands the same hue to the peer-network shockwave instead of bleaching it white', () => {
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(nodes).toContain('writeShockwaveSlot(');
    expect(source('CellGalaxy.tsx')).not.toContain('writeShockwaveSlot(');
  });
});
