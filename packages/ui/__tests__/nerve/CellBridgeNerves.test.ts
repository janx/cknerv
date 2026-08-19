import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_ALLOCATION_BRIDGES,
  BRIDGE_BUDGET,
} from '../../src/geometry/bridgeEdges';
import { FABRIC_SAMPLES_PER_EDGE } from '../../src/nerve/fabricCapacity';
import {
  getPopulationPlacement,
  resetPopulationPlacement,
  setPopulationPlacement,
} from '../../src/geometry/populationPlacementStore';

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

/** Source with comments removed. The layer's own header NAMES the systems it
 *  must stay out of, so a plain text search would find every one of them and
 *  prove nothing; what has to be checked is the code. */
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const LAYER = read('src/nerve/CellBridgeNerves.tsx');
const LAYER_CODE = stripComments(LAYER);
const LAYER_IMPORTS = [...LAYER.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
const NETWORK = read('src/nerve/NeuralNetwork.tsx');
const HALO = read('src/components/CellPopulationField.tsx');

describe('the bridge layer stays render-only', () => {
  it('answers no raycast and registers no pointer handler', () => {
    expect(LAYER_CODE).toContain('built.mesh.raycast = neverRaycast');
    expect(LAYER_CODE).not.toMatch(/onPointer/);
    expect(LAYER_CODE).not.toContain('ScreenSpaceHitIndex');
  });

  it('is invisible to every actual-register system', () => {
    // The register boundary, asserted where it can be: this module names none
    // of the systems that may not traverse a bridge. It is a leaf — it reads
    // the staged Cells and the halo buffers and emits geometry.
    for (const forbidden of [
      'pathRouter',
      'routePath',
      'reinforce',
      'pushActiveHop',
      'InspectionField',
      'consensusMemory',
      'ConsensusMemory',
      'warmRoute',
      'recall',
      'Recall',
    ]) {
      expect(LAYER_CODE).not.toContain(forbidden);
    }
    // Structural, not textual: the layer imports geometry, the fabric's own
    // drawing parts, and nothing that carries a pulse, a route, a selection
    // or a memory.
    for (const specifier of LAYER_IMPORTS) {
      expect(specifier).not.toMatch(
        /pathRouter|consensusMemory|cellInspectionField|fabricReinforce|pulse|screenSpaceHitIndex|NeuralNetwork$/i,
      );
    }
    expect(LAYER_IMPORTS).toContain('./NeuralFabric');
  });

  it('never feeds bridge data back into a graph builder', () => {
    // The one wiring point. It hands the layer two READ-ONLY refs and a
    // version; nothing flows the other way.
    expect(NETWORK).toContain('<CellBridgeNerves');
    expect(NETWORK).not.toMatch(/bridge[A-Za-z]*\s*(=>|\.)?\s*(edges|adjacency)/);
    expect(NETWORK).not.toContain('selectBridgeEdges');
    expect(NETWORK).not.toContain('bridgeEdges');
  });
});

describe('the bridge layer stays inside its own budget', () => {
  it('allocates its own segments and does not grow the fabric', () => {
    expect(LAYER).toContain(
      'BRIDGE_ALLOCATION_BRIDGES * FABRIC_SAMPLES_PER_EDGE',
    );
    // The brief's ceiling: <= ~2K bridges x 4 samples = <= 8K segments.
    expect(BRIDGE_ALLOCATION_BRIDGES * FABRIC_SAMPLES_PER_EDGE)
      .toBeLessThanOrEqual(8_000);
    expect(BRIDGE_BUDGET).toBeLessThan(BRIDGE_ALLOCATION_BRIDGES);
  });

  it('is one draw call', () => {
    expect(LAYER.match(/<primitive/g)).toHaveLength(1);
    expect(LAYER.match(/makeFatLineLayer\(/g)).toHaveLength(1);
  });

  it('draws living strokes before retracting ones', () => {
    // So an allocation overflow can only clip an afterimage.
    const living = LAYER.indexOf('if (stroke.dyingAt !== null) continue;');
    const dying = LAYER.indexOf('if (stroke.dyingAt === null) continue;');
    expect(living).toBeGreaterThan(-1);
    expect(dying).toBeGreaterThan(living);
  });
});

describe('shared halo placement', () => {
  afterEach(() => { resetPopulationPlacement(); });

  it('publishes one snapshot both consumers read', () => {
    const placement = {
      positions: new Float32Array([1, 2, 3]),
      segments: new Uint32Array([0, 0]),
      weights: new Float32Array([0.5]),
      count: 1,
      segmentCount: 1,
      streamlines: 1,
      work: 1,
    };
    setPopulationPlacement(placement);
    expect(getPopulationPlacement()).toBe(placement);
    // Stable identity between publishes — useSyncExternalStore re-renders on
    // every change of the value it is handed.
    expect(getPopulationPlacement()).toBe(getPopulationPlacement());
  });

  it('runs the placement pass at most once', () => {
    // The halo layer adopts a published placement instead of spawning a
    // second worker, so two mounts can never produce two buffers.
    expect(HALO).toContain('const published = getPopulationPlacement();');
    expect(HALO).toContain('if (published) {');
    expect(HALO.indexOf('const published = getPopulationPlacement();'))
      .toBeLessThan(HALO.indexOf('new Worker('));
    // And it publishes before it builds its own geometries, so the two
    // consumers cannot be looking at different buffers even for one frame.
    expect(HALO.indexOf('setPopulationPlacement(placement);'))
      .toBeLessThan(HALO.lastIndexOf('adopt(placement);'));
  });

  it('leaves the halo geometry lifecycle where it was', () => {
    expect(HALO).toContain('placed?.points.dispose();');
    expect(HALO).toContain('placed?.fibres.dispose();');
    expect(HALO).toContain('populationSegmentsForPointPrefix(');
    expect(HALO).toContain('if (!placed || !wanted) return null;');
  });
});
