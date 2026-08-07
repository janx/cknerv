import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  makeProtocolCarrierGeometry,
  PROTOCOL_FIELD_RING_RADII,
  PROTOCOL_FIELD_SIDES,
  protocolCarrierBellPulse,
  setProtocolFieldFacing,
} from '../../src/geometry/protocolCarrier';

const source = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/components/${file}`),
  'utf8',
);

describe('A protocol event relay', () => {
  it('uses a minimal octagonal jellyfish bell instead of a solid carrier', () => {
    const geometry = makeProtocolCarrierGeometry();
    const positions = geometry.getAttribute('position');
    const depths = new Set<number>();
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      depths.add(Number(positions.getZ(vertex).toFixed(3)));
    }

    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(PROTOCOL_FIELD_SIDES).toBe(8);
    expect(PROTOCOL_FIELD_RING_RADII).toEqual([0.96, 0.24]);
    expect(positions.count).toBe(40);
    expect(depths.size).toBe(2);
    expect(geometry.index).toBeNull();
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('BoxGeometry');
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('makeProtocolLandingTexture');
    expect(source('BlockDeliveryLayer.tsx')).toContain(
      'setProtocolFieldFacing(_fieldFacingQuaternion, _flightDirection)',
    );
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('getWorldQuaternion');
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('TUMBLE_RATE');
    geometry.dispose();
  });

  it('opens the bell while its five tentacles stretch in the opposite phase', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(protocolCarrierBellPulse(Math.PI / 2)).toBe(1);
    expect(protocolCarrierBellPulse(Math.PI * 1.5)).toBe(0);
    expect(delivery).toContain('makeJellyfishWakeTexture()');
    expect(delivery).toContain('JELLY_TENTACLE_STRETCH_AMOUNT * (1 - bellPulse)');
    expect(delivery).toContain('bodyScale * bellDepthScale');
    expect(delivery).not.toContain('_scale.setScalar(bodyScale)');
  });

  it('aims the field and expanding impact wave at the Cell galaxy', () => {
    const delivery = source('BlockDeliveryLayer.tsx');
    const direction = new THREE.Vector3(0.25, 1, -0.4).normalize();
    const facing = setProtocolFieldFacing(new THREE.Quaternion(), direction);
    const transformedNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);

    expect(transformedNormal.distanceTo(direction)).toBeLessThan(1e-9);
    expect(delivery).toContain('delivery.to[1] - delivery.from[1]');
    expect(delivery).toContain('_bodyQuaternion.copy(_fieldFacingQuaternion)');
    expect(delivery).toContain('ingest.impactScale');
    expect(delivery).toContain('_fieldFacingQuaternion,\n            -fieldRotation * 0.45');
    expect(delivery).toContain('side: THREE.DoubleSide');
  });

  it('keeps one block carrier hue across P2P surge, courier, and delivery', () => {
    expect(source('NetworkColony.tsx')).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(source('ColonyEdges.tsx')).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(source('ColonyCourierLayer.tsx')).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(source('BlockDeliveryLayer.tsx')).toContain(
      'CARRIER_COLOR.setRGB(pulse.color[0], pulse.color[1], pulse.color[2])',
    );
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
    expect(delivery).toContain('Delivery count changes instance/vertex counts, never draw-call count.');
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
