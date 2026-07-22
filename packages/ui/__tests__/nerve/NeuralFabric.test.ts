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

  it('uses A route endpoints and preserves each packet colour on active hops', () => {
    expect(SRC).toContain('consensusRouteColors');
    expect(SRC).toContain('consensusRouteGoldMix');
    expect(SRC).toContain('consensusChromaIntensity');
    expect(SRC).toContain('CONSENSUS_BRAID_PALETTE.retire');
    expect(SRC).toContain('color: Vec3');
    expect(SRC).toContain('hop.color[0]');
    expect(SRC).not.toContain('new THREE.Color(0.48, 0.06, 0.16)');
  });

  it('lets completed memory routes broaden their tail without changing live wavefronts', () => {
    expect(SRC).toContain('tailDecay?: number');
    expect(SRC).toContain('hop.tailDecay ?? 7.5');
  });

  it('isolates distance-compensated memory weight from live writes', () => {
    expect(SRC).toContain('MAX_MEMORY_SEGMENTS');
    expect(SRC).toContain("mode: 'live' | 'memory'");
    expect(SRC).toContain('setMemoryRouteWidthScale');
    expect(SRC).toContain("hop.mode === 'memory' ? memory : active");
    expect(SRC).toContain(
      'memory.material.linewidth = LIVE.cell.activeWidth * safeScale',
    );
    expect(SRC).not.toContain(
      'active.material.linewidth = LIVE.cell.activeWidth * safeScale',
    );
  });

  it('clears passive noise only around exact recalled-route apertures', () => {
    expect(SRC).toContain('setRecallAperture');
    expect(SRC).toContain('consensusMemoryApertureScale');
    expect(SRC).toContain('consensusMemoryApertureAnimating');
    expect(SRC).toContain('apertureAnimationRef');
    expect(SRC).toContain('prevSpatial * prevAperture');
    expect(SRC).toContain('endSpatial * endAperture');
    expect(SRC).not.toMatch(/fabric\.material\.opacity\s*=/);
    expect(SRC).not.toMatch(/active\.material\.opacity\s*=/);
  });

  it('spends fewer samples on passive fabric before simplifying active writes', () => {
    expect(SRC).toContain('useQualityRuntime');
    expect(SRC).toContain('fabricSamplesPerEdge');
    expect(SRC).toContain('activeSamplesPerHop');
    expect(SRC).not.toMatch(/i\s*<=\s*FABRIC_SAMPLES_PER_EDGE/);
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
});
