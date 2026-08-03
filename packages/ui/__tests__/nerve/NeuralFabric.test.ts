import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fabricEdgeKey, orderFabricStateKeys } from '../../src/nerve/fabricOrder';

const SRC = readFileSync(resolve(process.cwd(), 'src/nerve/NeuralFabric.tsx'), 'utf8');

describe('NeuralFabric edge ordering', () => {
  it('follows the latest graph priority even for already-seen edges', () => {
    const existingInsertionOrder = [
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
      fabricEdgeKey(3, 4),
      fabricEdgeKey(9, 10),
    ];

    const { order, liveKeys } = orderFabricStateKeys(
      [
        { from: 3, to: 4 },
        { from: 1, to: 2 },
        { from: 2, to: 3 },
      ],
      existingInsertionOrder,
    );

    expect(order).toEqual([
      fabricEdgeKey(3, 4),
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
      fabricEdgeKey(9, 10),
    ]);
    expect(liveKeys).toEqual(new Set([
      fabricEdgeKey(3, 4),
      fabricEdgeKey(1, 2),
      fabricEdgeKey(2, 3),
    ]));
  });
});

describe('NeuralFabric living-mesh handles', () => {
  it('exposes growEdges and killEdges and uses the pure render math', () => {
    expect(SRC).toContain('growEdges');
    expect(SRC).toContain('killEdges');
    expect(SRC).toContain('fabricEdgeRenderState');
  });

  it('reconciliation deaths via setFabric are tagged gc (quiet), not death', () => {
    // setFabric's pass-2 must set deathKind 'gc' so corrections fade, not retract+flash.
    expect(SRC).toMatch(/deathKind\s*=\s*['"]gc['"]/);
  });

  it('drops the local GROWTH_MS/DECAY_MS consts in favour of the pure module (single source of truth)', () => {
    // The lifecycle timings live in ./fabricEdgeRender now; NeuralFabric imports them.
    expect(SRC).not.toMatch(/const\s+GROWTH_MS\s*=/);
    expect(SRC).not.toMatch(/const\s+DECAY_MS\s*=/);
    expect(SRC).toMatch(/from\s+['"]\.\/fabricEdgeRender['"]/);
  });

  it('uses vascular route endpoints and preserves each packet colour on active hops', () => {
    expect(SRC).toContain('consensusRouteColors');
    expect(SRC).toContain('consensusRouteGoldMix');
    expect(SRC).toContain('consensusChromaIntensity');
    expect(SRC).toContain('CONSENSUS_BRAID_PALETTE.retire');
    expect(SRC).toContain('color: Vec3');
    expect(SRC).toContain('hop.color[0]');
  });

  it('lets completed memory routes broaden their tail without changing live wavefronts', () => {
    expect(SRC).toContain('tailDecay?: number');
    expect(SRC).toContain('hop.tailDecay ?? 7.5');
  });

  it('can reverse wave travel without changing the route-order Bezier', () => {
    expect(SRC).toContain('direction?: 1 | -1');
    expect(SRC).toContain('const direction = hop.direction ?? 1');
    expect(SRC).toContain(
      'const curveT = direction === 1 ? travelT : 1 - travelT',
    );
    expect(SRC).toContain('if (travelMid <= hop.frontT)');
    expect(SRC).toContain('const distBehind = hop.frontT - travelMid');
  });

  it('isolates distance-compensated memory weight from live writes', () => {
    expect(SRC).toContain('MAX_MEMORY_SEGMENTS');
    expect(SRC).toContain("mode: 'live' | 'memory' | 'lock'");
    expect(SRC).toContain('setMemoryRouteWidthScale');
    expect(SRC).toContain("const layer = hop.mode === 'memory'");
    expect(SRC).toContain(': active;');
    expect(SRC).toContain(
      'memory.material.linewidth = LIVE.cell.activeWidth * safeScale',
    );
    expect(SRC).not.toContain(
      'active.material.linewidth = LIVE.cell.activeWidth * safeScale',
    );
  });

  it('keeps the raw-clock lock response out of sim-clock activity buffers', () => {
    expect(SRC).toContain('MAX_ROUTE_HOP_PULSE_SEGMENTS');
    expect(SRC).toContain('ROUTE_HOP_PULSE_SAMPLES_PER_HOP = 24');
    expect(SRC).toContain("const samplesPerHop = hop.mode === 'lock'");
    expect(SRC).toContain('flushRouteHopPulse');
    expect(SRC).toContain("hop.mode === 'lock'");
    expect(SRC).toContain('routeHopPulse.geometry.instanceCount === 0');
    expect(SRC).toContain('commitLayer(routeHopPulse)');
    expect(SRC).toContain('routeHopPulse.count = 0');
  });

  it('clears passive noise only around exact recalled-route apertures', () => {
    expect(SRC).toContain('setRecallAperture');
    expect(SRC).toContain('consensusMemoryApertureScale');
    expect(SRC).toContain('consensusMemoryApertureAnimating');
    expect(SRC).toContain('apertureAnimationRef');
    expect(SRC).toContain('* prevSpatial');
    expect(SRC).toContain('* prevAperture');
    expect(SRC).toContain('* endSpatial');
    expect(SRC).toContain('* endAperture');
    expect(SRC).not.toMatch(/fabric\.material\.opacity\s*=/);
    expect(SRC).not.toMatch(/active\.material\.opacity\s*=/);
  });

  it('grades passive fibres by real selected-Cell topology without dimming events', () => {
    expect(SRC).toContain('setInspectionField');
    expect(SRC).toContain('cellInspectionFieldTransitionScaleAt');
    expect(SRC).toContain('st.fromCellId');
    expect(SRC).toContain('st.toCellId');
    expect(SRC).toContain('* prevInspection');
    expect(SRC).toContain('* endInspection');
    expect(SRC).toContain('(1 - fieldScale) * lifecycleFlash');
    const activeImplementation = SRC.slice(
      SRC.lastIndexOf('pushActiveHop(hop, cells)'),
    );
    expect(activeImplementation).not.toContain('inspectionFieldScaleAt');
  });

  it('keeps passive Bezier curvature fixed while active writes adapt', () => {
    expect(SRC).toContain('useQualityRuntime');
    expect(SRC).toContain('FABRIC_SAMPLES_PER_EDGE');
    expect(SRC).not.toContain('fabricSamplesPerEdge');
    expect(SRC).toContain('activeSamplesPerHop');
    expect(SRC).toMatch(/index\s*<=\s*FABRIC_SAMPLES_PER_EDGE/);
  });

  it('compresses only passive core energy while semantic routes reclaim contrast', () => {
    expect(SRC).toContain('passiveFabricEnergyScale');
    expect(SRC).toContain('LIVE.cell.centerDim');
    expect(SRC).toContain('hierarchy');
    // Active packet paths intentionally bypass passive density compression.
    const activeImplementation = SRC.slice(SRC.lastIndexOf('pushActiveHop(hop, cells)'));
    expect(activeImplementation).not.toContain('passiveFabricEnergyScale');
  });

  it('uses bounded screen accumulation only for passive structure', () => {
    expect(SRC).toContain("'screen' | 'additive'");
    expect(SRC).toContain('THREE.CustomBlending');
    expect(SRC).toContain('THREE.OneMinusSrcColorFactor');
    expect(SRC).toContain("LIVE.cell.fabricWidth, 'screen'");
    expect(SRC).toContain("LIVE.cell.activeWidth, 'additive'");
    // Do not force passive routes ahead of Cell bodies: that destroys their
    // shared depth relationship and visibly reintroduces centre clipping.
    expect(SRC).not.toContain('mesh.renderOrder');
  });

  it('raises only passive fabric screen weight in a close Cell view', () => {
    expect(SRC).toContain('cellDetailViewFocusRef?:');
    expect(SRC).toContain('cellDetailFabricEnergyGain(focus)');
    expect(SRC).toContain('cellDetailFabricWidthScale(focus)');
    expect(SRC).toContain('fabric.material.color.setRGB(');
    expect(SRC).toContain('warmRoutes.material.color.setRGB(');
    expect(SRC).toContain('useFrame(applyPassiveViewWeight)');
    const activeImplementation = SRC.slice(
      SRC.lastIndexOf('pushActiveHop(hop, cells)'),
    );
    expect(activeImplementation).not.toContain('cellDetailFabricEnergyGain');
    expect(activeImplementation).not.toContain('cellDetailFabricWidthScale');
  });

  it('uploads only the populated dynamic segment range', () => {
    expect(SRC).toContain('setUsage(THREE.DynamicDrawUsage)');
    expect(SRC).toContain('const usedFloats = layer.count * 6');
    expect(SRC).toContain('addUpdateRange(0, usedFloats)');
    expect(SRC).toContain('clearUpdateRanges()');
  });

  it('decays and uploads reinforcement through a sparse warm-route layer', () => {
    expect(SRC).toContain('MAX_WARM_FABRIC_SEGMENTS');
    expect(SRC).toContain('warmRouteKeysRef');
    expect(SRC).toContain('warmRouteBrightnessGain(');
    expect(SRC).toContain('commitLayer(warmRoutes)');
    expect(SRC).toContain('<primitive object={warmRoutes.mesh} />');

    const reinforceImplementation = SRC.slice(
      SRC.indexOf('reinforce(fromCellId, toCellId) {'),
      SRC.indexOf('emitFabric(now) {'),
    );
    expect(reinforceImplementation).toContain(
      'warmRouteKeysRef.current.add(key)',
    );
    expect(reinforceImplementation).not.toContain('emitDirtyRef.current');

    const passiveLoop = SRC.slice(
      SRC.indexOf('for (const key of renderOrderRef.current)'),
      SRC.indexOf('commitLayer(fabric)'),
    );
    expect(passiveLoop).not.toContain('decayUsage(');
    expect(passiveLoop).not.toContain('st.usage');
  });
});
