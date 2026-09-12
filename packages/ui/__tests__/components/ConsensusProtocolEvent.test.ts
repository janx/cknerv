import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  CONTACT_RING_GAPS,
  CONTACT_RING_GAP_EVERY,
  CONTACT_RING_SIDES,
  makeContactWaveMaterial,
} from '../../src/materials/contactWaveMaterial';
import { SHOCKWAVE_SPEED, CONTACT_WAVE_SCALE } from '../../src/ui/topologyConstants';
import { deliverySchema } from '../../src/tweaks/tweakSchema';
import {
  stampPeerLaunches,
  type PeerLaunchSchedule,
} from '../../src/components/ColonyNodes';
import { PEER_LAUNCH_SENTINEL } from '../../src/derives/peers.derive';
import type { NetworkNode } from '../../src/types';

const source = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/components/${file}`),
  'utf8',
);

const material = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/materials/${file}`),
  'utf8',
);

describe('A protocol event relay', () => {
  it('throws the last hop as a courier — no glyph, no streak, no sear, nothing white', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    // The glyph dialect is gone: no line-drawn rim, no carrier geometry, no
    // hard streak texture, no searing core, no inhale ring.
    expect(delivery).not.toMatch(/LineSegments|lineSegments|BoxGeometry/);
    expect(delivery).not.toMatch(/protocolCarrier|deliveryTextures|makeCarrier\w+Texture/);
    expect(delivery).not.toMatch(/GATHER_SWELL|LOB_CORE|INHALE_|glyphScale|glyphOpacity|coreOpacity|inhaleRadius|inhaleOpacity/);
    expect(existsSync(resolve(process.cwd(), 'src/geometry/protocolCarrier.ts'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/materials/deliveryTextures.ts'))).toBe(false);
    // Nothing survives of the organism that used to drift in, either.
    expect(delivery).not.toMatch(/jellyfish|bellPulse|tentacle|swimPhase|propulsion/i);

    // Nothing white: the delivery paints only the carrier hue and tissue rose.
    expect(delivery).not.toContain('WHITE');
    expect(delivery).not.toMatch(/Color\(\s*1\s*,\s*1\s*,\s*1\s*\)|#fff|0xffffff/i);

    // The hop IS the courier vocabulary: the shared helper, the shared textures.
    expect(delivery).toContain("from './courierGlyph'");
    expect(delivery).toContain("from '../materials/courierFlameTexture'");
    expect(delivery).toContain('makeCourierBloomTexture()');
    expect(delivery).toContain('makeCourierPlumeTexture()');
    // Thrown, as every courier hop is thrown — never the old accelerate-in lob.
    expect(delivery).toContain('const progress = easeOutCubic(phase.t)');
    expect(delivery).not.toContain('easeInLob');
    // Absorbed at contact: the end ease shrinks the mote to nothing at t = 1.
    expect(delivery).toContain('const edge = courierEdgeEase(phase.t)');
    // Per-tier mote; the peer's punch lands on its plume length only.
    expect(delivery).toContain('delivery.hero ? LIVE.delivery.moteHero : LIVE.delivery.motePeer');
    expect(delivery).toMatch(/courierHopSpeed\(legDist, LOB_DUR_S, phase\.t\),\n\s*\) \* punch;/);
    expect(delivery).toContain('LIVE.delivery.plumeWidth,');
    expect(delivery).toContain('LIVE.delivery.hopBloomOpacity,');
    expect(delivery).toContain('LIVE.delivery.hopPlumeOpacity,');
    // The nozzle edge sits at the origin so the plume trails the mote.
    expect(delivery).toContain('g.translate(0, -0.5, 0)');

    // The camera is read ONCE per frame for every mote and plume, before the
    // render loop — never per delivery.
    const camRead = delivery.indexOf('state.camera.getWorldQuaternion(_cameraQuaternion)');
    const renderLoop = delivery.indexOf('const phase = deliveryPhase(age - delivery.startAge, CFG)');
    expect(camRead).toBeGreaterThan(-1);
    expect(renderLoop).toBeGreaterThan(camRead);
    expect(delivery.match(/getWorldQuaternion/g)).toHaveLength(1);

    // Gather draws nothing here: the held breath belongs to the peer halos.
    expect(delivery).toContain("if (phase.phase !== 'lob' && phase.phase !== 'ingest') continue;");
    expect(delivery).not.toContain("phase.phase === 'gather'");
  });

  it('gives every worker its own front, and all of them one wave field', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    // One shape at one speed is the whole reason staggered commits read as
    // one interference field instead of independent events. The Cell-field
    // front is the peer-plane wave divided by CONTACT_WAVE_SCALE — same shape,
    // same timing, a fraction of the reach — so the two planes stay one
    // synchronised event.
    expect(deliverySchema.waveSpeed.value).toBe(SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE);
    // closeTo, not toBe: these only survive exact === today because the scale
    // is a power of two — the relationship, not the bit pattern, is the pin.
    expect(deliverySchema.waveReachHero.value * CONTACT_WAVE_SCALE).toBeCloseTo(52, 10);
    expect(deliverySchema.waveReachPeer.value * CONTACT_WAVE_SCALE).toBeCloseTo(34, 10);
    // The crest is derived on the same scale so a scale retune moves it too;
    // 3.2 (0.40 wu) is the soft, overview-legible crest of 2026-08-28.
    expect(deliverySchema.waveWidth.value * CONTACT_WAVE_SCALE).toBeCloseTo(3.2, 10);
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
    // array index shifts under peer churn and snap-rotates released fronts.
    expect(delivery).toContain('peerAngle(delivery.key)');
    expect(delivery).not.toContain('deliveryIndex');
    expect(delivery).toContain('_frontQuaternion.multiply(_frontRollQuaternion)');
    // One front per delivery: the annulus batch is sized to the plan, not 2×.
    expect(delivery).toContain('makeContactWaveAttribute(capacity)');
    expect(delivery).not.toContain('waveCapacity');
  });

  it('resolves the contact into the Cell field\'s own tissue, not a cool pale', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(delivery).toContain('CELL_GALAXY_PALETTE.tissueRose');
    expect(delivery).toContain('_waveColor.copy(CARRIER_COLOR).lerp(TISSUE_ROSE, release.colorT)');
    // Carrier hue → rose is the ONLY colour arc: no white strike cooling into
    // the carrier, no second lerp.
    expect(delivery.match(/\.lerp\(/g)).toHaveLength(1);
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
    // The interrupted 12-gon with three gaps is the front's own: the numbers
    // live with their only reader now that the carrier glyph is gone.
    expect(wave).not.toContain('protocolCarrier');
    expect(CONTACT_RING_SIDES).toBe(12);
    expect(CONTACT_RING_GAPS).toBe(3);
    expect(CONTACT_RING_GAP_EVERY).toBe(4);
    expect(wave).toContain('export const CONTACT_RING_SIDES = 12');
    expect(wave).toContain('${CONTACT_RING_SIDES.toFixed(1)}');
    expect(wave).toContain('${CONTACT_RING_GAP_EVERY.toFixed(1)}');
    // A front only propagates through tissue: the extinction band is the
    // helix footprint's own ellipse, tracked through the galaxy's rotation —
    // never a second hand-typed radius.
    expect(wave).toContain("from '../helix'");
    expect(wave).toContain('FIELD_HALF_X');
    // As a (cos, sin) pair the renderer resolves once a frame — the fragment
    // stage may not re-derive a value that is constant across the whole draw.
    expect(wave).toContain('uniform vec2 uGalaxyRot;');
    expect(wave).not.toMatch(/\b(cos|sin)\(uGalaxy/);
    expect(source('BlockDeliveryLayer.tsx'))
      .toContain('waveMaterial.uniforms.uGalaxyRot.value.set(');
    expect(wave).not.toMatch(/uDiskFade|smoothstep\(\s*44/);
    // An annulus, not a quad: full-screen-ish fills per front are not free.
    expect(wave).toContain('THREE.RingGeometry');
    // The two LIVE-driven uniforms are seeded with the schema's own defaults
    // for the frames before the first pulse — a mirror, and a mirror that
    // must not rot: the soft front's wake and gaps (2026-08-28).
    const seeded = makeContactWaveMaterial();
    expect(seeded.uniforms.uWake.value).toBe(deliverySchema.waveWake.value);
    expect(seeded.uniforms.uSegmentDepth.value).toBe(deliverySchema.waveSegments.value);
    expect(deliverySchema.waveWake.value).toBe(0.45);
    expect(deliverySchema.waveSegments.value).toBe(0.3);
    expect(deliverySchema.waveOpacity.value).toBe(0.9);
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
    // …drawn in the shared courier vocabulary, the same one the last hop uses.
    expect(courier).toContain("from './courierGlyph'");
  });

  it('submits every concurrent field delivery in three semantic batches', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(delivery.match(/<instancedMesh/g)).toHaveLength(3);
    expect(delivery).not.toContain('<lineSegments');
    expect(delivery).toContain('Delivery count changes instance counts, never draw-call count.');
    expect(delivery).toContain('delivery.to[0]');
    expect(delivery).not.toContain('ingestPull');
    expect(delivery).not.toContain('sealBatch');
    expect(delivery).toContain('colorAttr.addUpdateRange(0, count * 3)');
    expect(delivery).toContain('colorAttr.needsUpdate = true');
    expect(delivery).not.toContain('<ProtocolCarrier');
    expect(delivery).not.toContain('registry.current');
    // The mote and plume batches share one slot index — a hop is one thing.
    expect(delivery).toContain('commitInstanceBatch(moteBatch, hopCount)');
    expect(delivery).toContain('commitInstanceBatch(plumeBatch, hopCount)');
    expect(delivery).toContain('commitInstanceBatch(waveBatch, waveCount)');
  });

  it('hands each landing to the galaxy\'s landing queue — never to the write seal', () => {
    const colony = source('NetworkColony.tsx');
    const delivery = source('BlockDeliveryLayer.tsx');

    expect(colony).toContain('landingFlashRef={landingFlashRef}');
    expect(colony).not.toMatch(/cellFlashRef|flashDirty/);
    expect(delivery).toContain('landingFlashRef: { readonly current: LandingFlashQueue };');
    // No k-nearest ignition, no seal writes, no ripple: a landing is not a write.
    expect(delivery).not.toMatch(/cellFlashRef|markCellFlashDirty|flashDirty|nearestCellIdsFromIndex|ignite/);
    // The schedule is the pure, tested one, on the SAME origin and contact
    // instant the flush is stamped with, within this front's budget and what
    // is left of the pulse's; each flash carries the crest's own strength
    // there, times the front's punch.
    // The index is READ HERE, at ingest, off the cells context's ref lane —
    // this layer looks at the stage once per landing and subscribing to the
    // value re-rendered the whole delivery layer on every cells batch.
    expect(delivery).toMatch(
      /landingFlashSchedule\(\s*landingLocal,\s*contactSceneS,\s*reach,\s*budget,\s*FRONT_LIVE,\s*readNearestCellIndex\(\),\s*\)/,
    );
    expect(delivery).toContain('delivery.hero ? LIVE.delivery.landingHero : LIVE.delivery.landingPeer');
    expect(delivery).toContain('landingBudgetRef.current = LIVE.delivery.landingMax;');
    expect(delivery).toContain('landingBudgetRef.current -= landings.length;');
    expect(delivery).toContain('queue.push(landing.id, landing.at, landing.amp * punch);');
    // Scheduled inside the once-per-delivery-per-pulse gate the flush uses.
    const gate = delivery.indexOf('if (!flushed.has(delivery.key)) {');
    const schedule = delivery.indexOf('landingFlashSchedule(\n');
    const front = delivery.indexOf('contactFrontState(contactAge, reach, FRONT_LIVE)');
    expect(gate).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(gate);
    expect(front).toBeGreaterThan(schedule);
  });

  it('lays the front flat in the Cell plane whatever the hop\'s slant', () => {
    const delivery = source('BlockDeliveryLayer.tsx');
    // The annulus spans local XY; the one flat facing aims local +Z up the
    // world axis, which lays the ring in the tissue.
    const facing = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    );
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);
    expect(normal.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
    expect(delivery).toContain('const FRONT_FLAT_FACING = new THREE.Quaternion().setFromUnitVectors(');
    expect(delivery).toContain('_frontQuaternion.copy(FRONT_FLAT_FACING)');
    // The plume reads the true node→landing velocity (fromX/Y/Z is the
    // launch carried through the live colony rotation)…
    expect(delivery).toContain('delivery.to[1] - fromY');
    expect(delivery).toMatch(/writeCourierPlume\(\s*plumeBatch,\s*hopCount,\s*_position,\s*_flightDirection,\s*_cameraPosition/);
    // …but the front rides the one flat basis, so a slanted (rim-clamped)
    // arrival can never release a front tilted out of the disc.
    expect(delivery).not.toMatch(/writeWaveInstance\([^)]*_flightDirection/);
    expect(delivery).toContain('side: THREE.DoubleSide');
  });

  it('hands the same hue to the peer-network shockwave instead of bleaching it white', () => {
    const nodes = source('ColonyNodes.tsx');
    expect(nodes).toContain('consensusBlockColor(blockPulseAtMs)');
    expect(nodes).toContain('writeShockwaveSlot(');
    expect(source('CellGalaxy.tsx')).not.toContain('writeShockwaveSlot(');
  });
});

describe('The exhale — the flush along the fibres', () => {
  it('is stamped by the delivery layer once per delivery per pulse, at the true contact instant, in the tissue\'s own frame', () => {
    const delivery = source('BlockDeliveryLayer.tsx');

    // The tissue's ring is the singleton the fabric shader is bound to; the
    // origin is projected into the galaxy's rotating local frame with the
    // one world→local map (never a private re-derivation of the rotation).
    expect(delivery).toContain("import { stampTissueFlush } from '../tweaks/tissueFlush';");
    expect(delivery).toContain('rotYWorldToLocalXZ,');
    expect(delivery.match(/stampTissueFlush\(/g)).toHaveLength(1);
    // The five lanes, in order: the contact instant (pulse + this delivery's
    // launch + the lob — NOT this frame's clock, so a late first ingest
    // frame still stamps the true instant), the landing in the galaxy's
    // local frame, the block's carrier hue, the front's own reach and punch.
    expect(delivery).toContain('const contactSceneS = pulse.at + delivery.startAge + LOB_DUR_S;');
    expect(delivery).toMatch(
      /const landingLocal = rotYWorldToLocalXZ\(\s*delivery\.to\[0\],\s*delivery\.to\[2\],\s*galaxyFrame\.rotationY,\s*\);/,
    );
    expect(delivery).toContain('stampTissueFlush(contactSceneS, landingLocal, pulse.color, reach, punch);');
    // …and the landing schedule reads those SAME two values — three media,
    // one origin — so there is exactly one projection in the file and no
    // second one to drift from the stamp's.
    expect(delivery.match(/rotYWorldToLocalXZ\(/g)).toHaveLength(1);
    expect(delivery).toMatch(/landingFlashSchedule\(\s*landingLocal,\s*contactSceneS,/);
    // Exactly once per delivery per pulse, however many frames ingest spans:
    // keyed by the delivery's stable key (peer churn re-cuts the plan) and
    // cleared when the pulse changes or retires.
    expect(delivery).toContain('if (!flushed.has(delivery.key)) {');
    expect(delivery).toContain('flushed.add(delivery.key);');
    expect(delivery).toContain('if (flushedPulseAtRef.current !== pulse.at) {');
    expect(delivery.match(/flushedKeysRef\.current\.clear\(\)/g)).toHaveLength(2);
    // Stamped from the ingest beat — after the hop, before the front is
    // composed from the same reach.
    const lob = delivery.indexOf("if (phase.phase === 'lob') {");
    const stamp = delivery.indexOf('stampTissueFlush(contactSceneS');
    const front = delivery.indexOf('contactFrontState(contactAge, reach, FRONT_LIVE)');
    expect(lob).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(lob);
    expect(front).toBeGreaterThan(stamp);
  });
});

describe('The held breath', () => {
  it('is scheduled in the measured belt, on the pulse edge, at the delivery layer\'s own launch instant', () => {
    const nodes = source('ColonyNodes.tsx');
    const belt = nodes.slice(
      nodes.indexOf('function MeasuredPeerHalos('),
      nodes.indexOf('const SCRATCH_MATRIX'),
    );
    // The lane is allocated with the other four and bound in the same
    // one-time pass — one instanced float, never re-wrapped.
    expect(belt).toContain('launchAt: new THREE.InstancedBufferAttribute(');
    expect(belt).toContain('new Float32Array(capacity).fill(PEER_LAUNCH_SENTINEL)');
    expect(belt).toContain("mesh.geometry.setAttribute('aPeerLaunchAt', lanes.launchAt);");
    // Stamped on the pulse edge, consume-then-bail on backfill exactly as the
    // shockwave slot is…
    expect(belt).toContain('if (blockPulseAtMs <= lastPulseRef.current) return;');
    expect(belt).toContain('if (backfillActive) return;');
    expect(belt).toContain('}, [blockPulseAtMs]);');
    // …at `now + cf.arrivals[id]`: the instant BlockDeliveryLayer lets that
    // peer's hop go (pulse.at + startAge, startAge = arrivals[id]).
    expect(belt).toContain('launchRef.current = { atSec: simClock.elapsedSec, arrivals: cf.arrivals };');
    // Written from the schedule in BOTH walks: the pulse, and the identity
    // pass a roster round re-runs — so a re-cut list re-derives by id.
    expect(belt.match(/stampPeerLaunches\(lanes\.launchAt\.array as Float32Array, measured, launchRef\.current\)/g))
      .toHaveLength(2);
    // The belt is fed the pulse it stamps from.
    expect(nodes).toMatch(
      /<MeasuredPeerHalos[^>]*cf=\{cf\}[^>]*blockPulseAtMs=\{blockPulseAtMs\}[^>]*backfillActive=\{backfillActive\}[^>]*\/>/,
    );
    // The two knobs reach the material every frame.
    expect(belt).toContain('material.uniforms.uCompressDepth.value = LIVE.delivery.compressDepth;');
    expect(belt).toContain('material.uniforms.uCompressGain.value = LIVE.delivery.compressGain;');
    // And the delivery layer draws no breath of its own.
    expect(source('BlockDeliveryLayer.tsx')).not.toMatch(/peerCompression|uCompress|aPeerLaunchAt/);
  });

  it('stamps each peer by ID at now + its arrival, sentinel for a peer the flood never reached — never by slot', () => {
    const node = (id: string): NetworkNode => ({ id, kind: 'measured', pos: [0, 0, 0] });
    const schedule: PeerLaunchSchedule = { atSec: 100, arrivals: { A: 0.4, B: 1.7 } };
    const lane = new Float32Array(4).fill(PEER_LAUNCH_SENTINEL);

    stampPeerLaunches(lane, [node('A'), node('B'), node('C')], schedule);
    expect(lane[0]).toBeCloseTo(100.4, 4);
    expect(lane[1]).toBeCloseTo(101.7, 4);
    expect(lane[2]).toBe(PEER_LAUNCH_SENTINEL);
    expect(lane[3]).toBe(PEER_LAUNCH_SENTINEL);

    // A roster round re-cuts the list: the stamp follows the id, not the index.
    stampPeerLaunches(lane, [node('C'), node('B'), node('D'), node('A')], schedule);
    expect(lane[0]).toBe(PEER_LAUNCH_SENTINEL);
    expect(lane[1]).toBeCloseTo(101.7, 4);
    expect(lane[2]).toBe(PEER_LAUNCH_SENTINEL);
    expect(lane[3]).toBeCloseTo(100.4, 4);

    // No block yet: everything rests.
    stampPeerLaunches(lane, [node('A'), node('B')], null);
    expect(lane[0]).toBe(PEER_LAUNCH_SENTINEL);
    expect(lane[1]).toBe(PEER_LAUNCH_SENTINEL);
  });

  it('the hero breathes in from the anchor\'s own trigger, on the same envelope', () => {
    const galaxy = source('CellGalaxy.tsx');
    expect(galaxy).toContain(
      'haloMat.uniforms.uLaunchAt.value = trigger ? trigger.firedAt : PEER_LAUNCH_SENTINEL;',
    );
    expect(galaxy).toContain('haloMat.uniforms.uCompressDepth.value = LIVE.delivery.compressDepth;');
    expect(galaxy).toContain('haloMat.uniforms.uCompressGain.value = LIVE.delivery.compressGain;');
    // `firedAt` IS the hero launch: the pulse instant plus the local receive
    // delay — the delivery layer's own `localStartAge`.
    expect(galaxy).toContain('const blockTriggerSceneS = simClock.elapsedSec + receiveDelayS;');
    expect(galaxy).toContain('flashSlot.current = { firedAt: blockTriggerSceneS, color: blockColor };');
    // Only the halo breathes: the icosahedron and its fill never see the launch.
    expect(galaxy.match(/uLaunchAt/g)).toHaveLength(1);
  });
});
