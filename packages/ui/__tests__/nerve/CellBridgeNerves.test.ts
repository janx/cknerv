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
import { commitLayer, makeFatLineLayer } from '../../src/nerve/NeuralFabric';

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
        /pathRouter|consensusMemory|fabricReinforce|pulse|screenSpaceHitIndex|NeuralNetwork$/i,
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

  it('selects only for a build whose hosts moved, and walks only to repaint or compact', () => {
    // The registry is exact about what the selection reads, so a build it
    // reports as unmoved skips the selection and the reconcile alike — the
    // gate sits in front of the resumable selector, not behind it.
    expect(LAYER_CODE).toContain('running.syncJob ??= createBridgeHostSyncJob(');
    expect(LAYER_CODE)
      .toContain('&& !running.syncJob.moved');
    expect(LAYER_CODE.indexOf('&& !running.syncJob.moved'))
      .toBeLessThan(LAYER_CODE.indexOf('createBridgeSelectionJob('));
    // A selection that moved reaches the layer as the LIST of strokes it
    // moved, which the next frame admits into spans of their own. It never
    // arms a walk.
    expect(LAYER_CODE)
      .toContain('strokesRef.current, selection.bridges, now, pendingRef.current');
    // Two arms for the full walk and no third: the knob that moves every
    // stroke's energy at once, and the allocation overflow the walk compacts.
    expect(LAYER_CODE.match(/fullWalkRef\.current = '/g)).toHaveLength(2);
    expect(LAYER_CODE).toContain("fullWalkRef.current = 'repaint'");
    expect(LAYER_CODE).toContain("fullWalkRef.current = 'overflow'");
    // The boot deadline is reported on BOTH paths — the skipped build answers
    // with the last selection, and first report wins in the gate — and on the
    // selecting path it is not behind any movement test.
    expect(LAYER_CODE.match(/reportBootBridgeSelected\(/g)).toHaveLength(2);
    expect(LAYER_CODE.indexOf('reportBootBridgeSelected('))
      .toBeLessThan(LAYER_CODE.indexOf('createBridgeSelectionJob('));
  });

  it('arms the selection in the commit and runs it a step at a time on frames', () => {
    // ⭐ Hosts are keyed on the DRAWN fabric, and the owner drains a build's
    // grow and kill across the frames AFTER the commit that publishes its
    // version. So the commit may not select: it writes the slot and stops,
    // and the frame fires it once `fabricLandedVersionRef` says that build's
    // fabric is whole — one STEP of it per frame, because the body itself was
    // 33 ms on the one frame the drain and the live-plan slice also want. The
    // three regions, sliced where the file puts them.
    const body = LAYER_CODE.slice(
      LAYER_CODE.indexOf('const runBridgeBuild ='),
      LAYER_CODE.lastIndexOf('useEffect('),
    );
    const arming = LAYER_CODE.slice(
      LAYER_CODE.lastIndexOf('useEffect('),
      LAYER_CODE.indexOf('useSimFrame('),
    );
    const bridgeFrame = LAYER_CODE.slice(LAYER_CODE.indexOf('useSimFrame('));
    expect(body.length).toBeGreaterThan(0);
    expect(arming.length).toBeGreaterThan(0);

    // The commit writes the slot and nothing else. Every piece of the old
    // body — including T1's gauge — has left it.
    expect(arming).toContain('pendingBuildRef.current = {');
    for (const work of [
      'createBridgeHostSyncJob(',
      'runBridgeHostSyncJobSlice(',
      'createBridgeSelectionJob(',
      'runBridgeSelectionJobSlice(',
      'createBridgeReconcileJob(',
      'runBridgeReconcileJobSlice(',
      'reportBootBridgeSelected(',
      'bridgeStats.observeBuild(',
      'blockFrameStats.observeBridge(',
    ]) {
      expect(arming).not.toContain(work);
      expect(body).toContain(work);
    }

    // ⚠️ T1's constraint: the gauge travels WITH the body. Left around the
    // arming it would time two ref writes and report the win as already won.
    // It is per STEP now — the block frame is only as short as its longest
    // task — and the build's own entry is the sum of them plus the longest.
    expect(body).toContain('const stepStartedAtMs = blockFrameNowMs();');
    expect(body).toContain(
      'blockFrameStats.observeBridge(running.spentMs, running.stepMaxMs);',
    );
    // One step a frame, and only on a frame that has room for it: the shared
    // ledger is asked with the step's own last measured cost.
    expect(body).toContain('spendFrameBudget(FRAME_BUDGET_BRIDGE_STEP, elapsedMs);')

    // ⚠️ What the skip tests may only claim what the layer HOLDS. A sequence a
    // newer arm replaced between the selection and the reconcile chose bridges
    // that never reached a stroke, so the anchor it selected against is
    // written by the reconcile step and never beside the selection.
    const select = body.indexOf('createBridgeSelectionJob(');
    const reconcile = body.indexOf('createBridgeReconcileJob(');
    expect(select).toBeGreaterThan(-1);
    expect(body.indexOf('selectedAgainstRef.current = anchorIndex;'))
      .toBeGreaterThan(select);
    expect(body.indexOf('selectedAgainstRef.current = anchorIndex;'))
      .toBeGreaterThan(reconcile);

    // The frame asks the rule before it does anything else, so the strokes a
    // selection moves still reach the admission pass on the same frame — and
    // it hands the rule the LANDED version, which is the whole point.
    expect(bridgeFrame).toContain('bridgeRunDecision(');
    expect(bridgeFrame).toContain('fabricLandedVersionRef?.current');
    expect(bridgeFrame.indexOf('bridgeRunDecision('))
      .toBeLessThan(bridgeFrame.indexOf('lastTweakRef.current'));
    expect(bridgeFrame).toContain('mayStartFrameWork(');
    expect(bridgeFrame.indexOf('runBridgeBuild(running)'))
      .toBeLessThan(bridgeFrame.indexOf('fullWalkRef.current = '));
    // A newer arm restarts the sequence rather than resuming it, so a
    // selection and the reconcile that lands it are always the same build's.
    expect(bridgeFrame).toContain("step: 'sync',");
  });

  it('gives a birth a parked hole before it grows the prefix', () => {
    // The fabric's `allocateFabricSlot` rule: reuse first, high-water mark
    // next, and at capacity fall back to the compacting walk.
    const allocator = LAYER_CODE.slice(
      LAYER_CODE.indexOf('function allocateBridgeSlot('),
      LAYER_CODE.indexOf('function commitBridgeSlotRanges('),
    );
    expect(allocator).toContain('free.pop()');
    expect(allocator.indexOf('free.pop()'))
      .toBeLessThan(allocator.indexOf('layer.count += BRIDGE_SLOT_SEGMENTS'));
    expect(allocator).toContain('if (next >= BRIDGE_ALLOCATION_BRIDGES) return BRIDGE_NO_SLOT;');
    // And a reap hands its slot back on the frame it parks it.
    expect(LAYER_CODE).toContain('free.push(stroke.slot);');
  });

  it('draws living strokes before retracting ones', () => {
    // So an allocation overflow can only clip an afterimage.
    const living = LAYER.indexOf('if (stroke.dyingAt !== null) continue;');
    const dying = LAYER.indexOf('if (stroke.dyingAt === null) continue;');
    expect(living).toBeGreaterThan(-1);
    expect(dying).toBeGreaterThan(living);
  });
});

describe('the bridge layer is the only tapered-width stroke in the scene', () => {
  it('builds its layer with the per-instance width lane', () => {
    // The taper is the class signature (see `BRIDGE_TIP_WIDTH_RATIO`), so it
    // has to be asked for at build time — the buffer and the shader patch both
    // ride the same flag, and a layer that does not ask for them allocates
    // nothing and compiles the stock capsule.
    const layer = makeFatLineLayer(8, 2.4, 'screen', true, false, true);
    expect(layer.widths).toBeDefined();
    expect(layer.widths).toHaveLength(8 * 2);
    expect(layer.widthBuf).toBeDefined();
    expect(layer.geometry.getAttribute('instanceWidthStart')).toBeDefined();
    expect(layer.geometry.getAttribute('instanceWidthEnd')).toBeDefined();
    expect(layer.material.vertexShader)
      .toContain('attribute float instanceWidthStart;');
    // ⚠️ The sentinel is 1, not 0: an instance the emit never reaches draws
    // the material's own width rather than vanishing.
    expect([...layer.widths!]).toEqual(new Array(16).fill(1));
    layer.geometry.dispose();
    layer.material.dispose();
  });

  it('costs every other layer nothing at all', () => {
    const plain = makeFatLineLayer(8, 2.5, 'screen', true);
    expect(plain.widths).toBeUndefined();
    expect(plain.widthBuf).toBeUndefined();
    expect(plain.geometry.getAttribute('instanceWidthStart')).toBeUndefined();
    expect(plain.material.vertexShader).toContain('offset *= linewidth;');
    plain.geometry.dispose();
    plain.material.dispose();
    // And the lane is meaningless without the screen capsule it patches, so
    // asking for it on an additive layer is refused rather than ignored.
    expect(() => makeFatLineLayer(8, 2.5, 'additive', false, false, true))
      .toThrow(/screen-capsule/);
  });

  it('uploads the width lane on the same gate the positions ride', () => {
    // A tapered stroke's width is a function of where it is along its own
    // curve, so widths and positions are dirty together and never separately.
    const layer = makeFatLineLayer(8, 2.4, 'screen', true, false, true);
    layer.count = 3;
    const before = layer.widthBuf!.version;
    commitLayer(layer);
    // Stride 2 against the positions' 6: three segments are six floats.
    expect(layer.widthBuf!.updateRanges).toEqual([{ start: 0, count: 6 }]);
    expect(layer.widthBuf!.version).toBeGreaterThan(before);
    // A colours-only commit leaves it alone, exactly as it leaves the
    // positions alone.
    const uploaded = layer.widthBuf!.version;
    commitLayer(layer, false, true);
    expect(layer.widthBuf!.updateRanges).toEqual([]);
    expect(layer.widthBuf!.version).toBe(uploaded);
    layer.geometry.dispose();
    layer.material.dispose();
  });
});

describe('shared halo placement', () => {
  afterEach(() => { resetPopulationPlacement(); });

  it('publishes one snapshot both consumers read', () => {
    const placement = {
      positions: new Float32Array([1, 2, 3]),
      segments: new Uint32Array([0, 0]),
      backboneSegments: new Uint32Array(0),
      backboneSegmentCount: 0,
      residualSegments: new Uint32Array([0, 0]),
      residualSegmentCount: 1,
      backboneComponents: 0,
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
