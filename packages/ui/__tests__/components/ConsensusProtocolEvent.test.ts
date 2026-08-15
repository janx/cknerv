import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  CARRIER_KEEL_COUNT,
  CARRIER_KEEL_DEPTH,
  CONTACT_RING_GAPS,
  CONTACT_RING_GAP_EVERY,
  CONTACT_RING_SIDES,
  isContactRingGap,
  makeProtocolCarrierGeometry,
  setProtocolCarrierFacing,
} from '../../src/geometry/protocolCarrier';
import { SHOCKWAVE_SPEED, CONTACT_WAVE_SCALE } from '../../src/ui/topologyConstants';
import { deliverySchema } from '../../src/tweaks/tweakSchema';

const source = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/components/${file}`),
  'utf8',
);

const material = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/materials/${file}`),
  'utf8',
);

describe('A protocol event relay', () => {
  it('carries the block as an interrupted rim with three trailing keels', () => {
    const geometry = makeProtocolCarrierGeometry();
    const positions = geometry.getAttribute('position');
    const depths = new Set<number>();
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      depths.add(Number(positions.getZ(vertex).toFixed(3)));
    }

    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(CONTACT_RING_SIDES).toBe(12);
    expect(CONTACT_RING_GAPS).toBe(3);
    expect(CONTACT_RING_GAP_EVERY).toBe(4);
    // Nine kept rim sides plus three keels, two vertices each.
    expect(positions.count).toBe((CONTACT_RING_SIDES - CONTACT_RING_GAPS) * 2 + CARRIER_KEEL_COUNT * 2);
    expect(depths).toEqual(new Set([0, -CARRIER_KEEL_DEPTH]));
    expect(geometry.index).toBeNull();
    // Keels hang off kept corners, never off an open side.
    for (let keel = 0; keel < CARRIER_KEEL_COUNT; keel += 1) {
      expect(isContactRingGap(1 + keel * CONTACT_RING_GAP_EVERY)).toBe(false);
    }
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('BoxGeometry');
    // The rim lives flat in the Cell plane for its whole life — a clamped
    // rim landing slants the flight, and only the streak may follow that.
    expect(source('BlockDeliveryLayer.tsx')).toContain('const CARRIER_FLAT_FACING');
    expect(source('BlockDeliveryLayer.tsx')).not.toContain(
      'setProtocolCarrierFacing(_carrierFacingQuaternion',
    );
    expect(source('BlockDeliveryLayer.tsx')).not.toMatch(/A\.T\.-Field|octagon/i);
    expect(source('BlockDeliveryLayer.tsx')).not.toContain('getWorldQuaternion');
    geometry.dispose();
  });

  it('abandons the swimming carrier for compression into a released front', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    // Nothing survives of the organism that used to drift in: no swim cycle, no
    // bell contraction, no tentacles, no shed propulsion rings.
    expect(delivery).not.toMatch(/jellyfish|bellPulse|tentacle|swimPhase|propulsion/i);
    // Gather holds still; the lob compresses the rim while the core heats.
    expect(delivery).toContain('LIVE.delivery.glyphCompress * progress');
    expect(delivery).toContain('GATHER_SWELL * (1 - phase.t)');
    expect(delivery).toContain('LOB_CORE_COMPRESS * progress');
    // And the release keeps the compressed size the lob arrived at — scale is
    // continuous across the contact boundary, no full-size pop at the strike.
    expect(delivery).toContain('(1 - LIVE.delivery.glyphCompress) * release.glyphScale');
  });

  it('gives every worker its own front, and all of them one wave field', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    // One shape at one speed is the whole reason ~81 staggered commits read as
    // one interference field instead of 81 independent events. The Cell-field
    // front is the peer-plane wave divided by CONTACT_WAVE_SCALE — same shape,
    // same timing, a fraction of the reach — so the two planes stay one
    // synchronised event.
    expect(deliverySchema.waveSpeed.value).toBe(SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE);
    // closeTo, not toBe: these only survive exact === today because the scale
    // is a power of two — the relationship, not the bit pattern, is the pin.
    expect(deliverySchema.waveReachHero.value * CONTACT_WAVE_SCALE).toBeCloseTo(52, 10);
    expect(deliverySchema.waveReachPeer.value * CONTACT_WAVE_SCALE).toBeCloseTo(34, 10);
    expect(deliverySchema.waveWidth.value * CONTACT_WAVE_SCALE).toBeCloseTo(0.55, 10);
    // The front's spatial algebra lives in peers.derive (numerically tested
    // there — radius from real seconds, reach completion, knee fade, 1/r,
    // width rate+cap); the frame loop only composes strengths on top.
    expect(delivery).toContain('contactFrontState(contactAge, reach, FRONT_LIVE)');
    // Hero emphasis is reach and scale, never a different shape.
    expect(delivery).toContain('LIVE.delivery.waveReachHero');
    expect(delivery).toContain('LIVE.delivery.waveReachPeer');
    // Reach must extinguish rather than clamp, or fronts freeze mid-field.
    // (The crest WIDTH is capped against the radius — that is a different knob.)
    expect(delivery).not.toMatch(/crestRadius\s*=\s*Math\.(min|max)/);
    expect(delivery).toContain('front.reachFade');
    // Overlap safety: a 1/r falloff dims a front before it can meet a neighbour.
    expect(delivery).toContain('front.falloff');
    // The rim-gap roll is keyed to the WORKER, not to a queue position: an
    // array index shifts under peer churn and snap-rotates in-flight fronts.
    expect(delivery).toContain('peerAngle(delivery.key)');
    expect(delivery).not.toContain('deliveryIndex');
    // And the glyph rim carries the same roll as the front it is released as.
    expect(delivery).toContain('_bodyQuaternion.multiply(_bodyRollQuaternion)');
  });

  it('resolves the contact into the Cell field\'s own tissue, not a cool pale', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(delivery).toContain('CELL_GALAXY_PALETTE.tissueRose');
    expect(delivery).toContain('_waveColor.copy(CARRIER_COLOR).lerp(TISSUE_ROSE, release.colorT)');
    // White at the strike, cooling into the block's own carrier hue.
    expect(delivery).toContain('_coreColor.copy(WHITE).lerp(CARRIER_COLOR, release.colorT)');
    expect(delivery).not.toContain('PALE_CONSENSUS');
  });

  it('resolves the front analytically so its crest stays sharp at any radius', () => {
    const wave = material('contactWaveMaterial.ts');

    // The crest is pinned to a fixed UV radius and the instance scale does the
    // rest — a baked ring texture smears the moment a front grows.
    expect(wave).toContain('(radius - ${CONTACT_WAVE_CREST_UV.toFixed(2)}) / halfWidth');
    // The crest+wake waveform is the peer-plane shockwave's own GLSL at the
    // front's scale: one profile, two planes, no second copy to drift.
    expect(wave).toContain('waveCrestWake(');
    expect(wave).toContain("from './shockwaveMaterial'");
    // The front blends against built-in sprite materials inside one release
    // event, so it must encode to the output colour space like they do.
    expect(wave).toContain('#include <colorspace_fragment>');
    // One vocabulary: the front's gaps come from the carrier rim's own numbers.
    expect(wave).toContain("from '../geometry/protocolCarrier'");
    expect(wave).toContain('CONTACT_RING_SIDES');
    // A front only propagates through tissue: the extinction band is the
    // helix footprint's own ellipse, tracked through the galaxy's rotation —
    // never a second hand-typed radius.
    expect(wave).toContain("from '../helix'");
    expect(wave).toContain('FIELD_HALF_X');
    expect(wave).toContain('uGalaxyRotY');
    expect(wave).not.toMatch(/uDiskFade|smoothstep\(\s*44/);
    // An annulus, not a quad: ~81 full-screen-ish fills per block is not free.
    expect(wave).toContain('THREE.RingGeometry');
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
    expect(delivery).toContain('colorAttr.addUpdateRange(0, count * 3)');
    expect(delivery).toContain('colorAttr.needsUpdate = true');
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

  it('lays the glyph — and the front it becomes — flat in the Cell plane', () => {
    const delivery = source('BlockDeliveryLayer.tsx');
    const direction = new THREE.Vector3(0.25, 1, -0.4).normalize();
    const facing = setProtocolCarrierFacing(new THREE.Quaternion(), direction);
    const transformedNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);

    expect(transformedNormal.distanceTo(direction)).toBeLessThan(1e-9);
    // The streak still reads the true node→landing velocity…
    expect(delivery).toContain('delivery.to[1] - delivery.from[1]');
    // …but the rim itself rides the one flat basis, so a slanted (rim-clamped)
    // arrival can never release a front tilted out of the disc.
    expect(delivery).toContain('_bodyQuaternion.copy(CARRIER_FLAT_FACING)');
    expect(delivery).toContain('side: THREE.DoubleSide');
  });

  it('hands the same hue to the peer-network shockwave instead of bleaching it white', () => {
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(nodes).toContain('writeShockwaveSlot(');
    expect(source('CellGalaxy.tsx')).not.toContain('writeShockwaveSlot(');
  });
});
