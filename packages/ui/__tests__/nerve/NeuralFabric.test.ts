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

  it('recall aperture changes never arm a full-fabric repaint', () => {
    // The per-frame aperture bake owns the recall dim entirely (including
    // the one release-to-baseline frame). Arming the global walk from the
    // aperture setter rewrote the whole fabric on every ramp frame and
    // reset the lanes AFTER the same frame's bake — the dim snapped
    // instead of fading while uploading ~MBs per frame for nothing.
    expect(SRC).not.toMatch(/globalRepaintRef\.current = true/);
  });

  it('carries no selection-topology dimming — passive fibres keep full energy', () => {
    // The hop-field edge grading is gone end to end: no field handle, no
    // per-edge inspection lanes, no cross-fade uniform. The zoom-recede
    // (cellDetailFabric*) is the only passive view weighting left.
    expect(SRC).not.toContain('setInspectionField');
    expect(SRC).not.toContain('cellInspectionEdgeScaleAt');
    expect(SRC).not.toContain('instanceInspection');
    expect(SRC).not.toContain('inspectionTransitionProgress');
    expect(SRC).not.toContain('inspectionFieldEndpointScaleAt');
  });

  it('keeps the full four-sample passive Bezier at every quality preset', () => {
    expect(SRC).toContain('useQualityRuntime');
    expect(SRC).toContain('FABRIC_SAMPLES_PER_EDGE');
    expect(SRC).toContain('activeSamplesPerHop');
    expect(SRC).toMatch(/index\s*<=\s*FABRIC_SAMPLES_PER_EDGE/);
    expect(SRC).not.toContain('passiveSamplesPerEdge');
  });

  it('keeps weak and mid-curve resting nerves visibly present', () => {
    // The floors moved to fabricLuminance (shared with the GLSL lifecycle
    // port); the fabric still consumes them and their values stay pinned.
    expect(SRC).toContain("fabricTaper as taper");
    expect(SRC).toContain('TWIG_MIN');
    const luminanceSrc = readFileSync(
      resolve(process.cwd(), 'src/nerve/fabricLuminance.ts'),
      'utf8',
    );
    expect(luminanceSrc).toContain('export const TAPER_MIN = 0.44;');
    expect(luminanceSrc).toContain('export const TWIG_MIN = 0.34;');
  });

  it('does not rate-limit passive lifecycle or mask animation frames', () => {
    expect(SRC).not.toContain('passiveAnimationFps');
    expect(SRC).not.toContain('lastPassiveCommitSecRef');
    expect(SRC).not.toContain('minPassiveCommitInterval');
  });

  it('stops active Bezier sampling as soon as its GPU layer is full', () => {
    const activeImplementation = SRC.slice(
      SRC.lastIndexOf('pushActiveHop(hop, cells)'),
    );
    expect(activeImplementation).toContain('const layerCapacity');
    expect(activeImplementation).toMatch(
      /if \(layer\.count >= layerCapacity\) (?:return|break)/,
    );
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
    expect(SRC).toMatch(/LIVE\.cell\.fabricWidth,\s*'screen'/);
    expect(SRC).toContain("LIVE.cell.activeWidth, 'additive'");
    // Do not force passive routes ahead of Cell bodies: that destroys their
    // shared depth relationship and visibly reintroduces centre clipping.
    expect(SRC).not.toContain('mesh.renderOrder');
  });

  it('uses the two-triangle capsule only for passive screen layers', () => {
    expect(SRC).toContain('makeScreenSpaceCapsuleGeometry');
    expect(SRC).toContain('optimizeScreenSpaceCapsuleMaterial');
    expect(SRC).toContain('syncScreenSpaceCapsuleViewport');
    expect(SRC).toContain('renderer.getPixelRatio()');
    expect(SRC).toContain('renderer.getViewport(viewport)');
    expect(SRC).toContain("accumulation === 'screen'");
    expect(SRC).toContain('&& optimizePassiveGeometry');
    expect(SRC).toMatch(
      /fabricSegmentAllocation\(allocationEdges\),[\s\S]*?'screen',[\s\S]*?true,/,
    );
    expect(SRC).toContain(': new LineSegmentsGeometry()');
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

  it('never streams passive positions — the shader owns the animation', () => {
    expect(SRC).toContain('passivePositionsDirtyRef');
    // The GPU-parametric fabric writes static records once per lifecycle
    // event; per-frame CPU is the uniform sync alone, and even the compacting
    // full walk uploads static records, never sampled positions.
    expect(SRC).toContain('syncFabricLifecycleUniforms(fabric.material, now)');
    expect(SRC).toContain('writeFabricLifecycleSlot(');
    expect(SRC).toContain('commitFabricLifecycleFull(fabric)');
    expect(SRC).toContain('commitFabricLifecycleSlotRanges(');
    expect(SRC).not.toMatch(/writeFabricEdgeSegments\(\s*fabric/);
    expect(SRC).toContain('passivePositionsDirtyRef.current = false');
  });

  it('decays and uploads reinforcement through a sparse warm-route layer', () => {
    expect(SRC).toContain('warmSegmentAllocation(allocationEdges)');
    expect(SRC).toContain('warmRouteKeysRef');
    expect(SRC).toContain('warmRouteBrightnessGain(');
    // Colours ride usage and move every decaying frame; endpoints only move
    // when the packed membership does or a member is still animating.
    expect(SRC).toContain('commitLayer(warmRoutes, warmPositionsMoved, true)');
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

describe('NeuralFabric reaping without a frame', () => {
  it('keeps ONE reap implementation, in the pure module', () => {
    expect(SRC).not.toMatch(/const drainReapQueue = /);
    expect(SRC).toContain("from './fabricHiddenReap'");
    expect(SRC).toContain('drainFabricReapQueue(reapQueues.death, reapTargets, now)');
    expect(SRC).toContain('drainFabricReapQueue(reapQueues.gc, reapTargets, now)');
  });

  it('bounds every ingest handle with the retained-state ceiling', () => {
    // Ingest is effect-fed (WS → setState) and keeps running with the frame
    // loop suspended, so setFabric / growEdges / killEdges each check it.
    const ceilingCalls = SRC.match(/^\s*enforceEdgeStateCeiling\(\);$/gm) ?? [];
    expect(ceilingCalls.length).toBe(3);
    expect(SRC).toContain('fabricEdgeStateCeiling(fabricSlotCapacity)');
  });

  it('advances frameless eligibility on the wall clock and tears down', () => {
    expect(SRC).toContain('startHiddenFabricReaper(');
    expect(SRC).toContain('wallNowMs: () => performance.now()');
    expect(SRC).toContain('return () => hiddenReaper.stop();');
  });

  it('collapses frameless slot writes into the full walk, never drops them', () => {
    // Records written with no frame behind them can never upload; dropping
    // them silently would leave the GPU holding a reaped edge's record.
    const backlog = SRC.slice(
      SRC.indexOf('const reapFabricBacklog = ('),
      SRC.indexOf('const hiddenReaper = '),
    );
    expect(backlog).toContain('if (frameless && lifeDirtySlots.length > 0)');
    expect(backlog).toContain('passivePositionsDirtyRef.current = true');
    expect(backlog).toContain('emitDirtyRef.current = true');
  });

  it('spreads a returning backlog over frames, ahead of the sim-second drain', () => {
    const emitBody = SRC.slice(SRC.indexOf('emitFabric(now) {'));
    const catchUpAt = emitBody.indexOf('if (catchUpUntilSec !== null)');
    const steadyDrainAt = emitBody.indexOf(
      'drainFabricReapQueue(reapQueues.death, reapTargets, now)',
    );
    expect(catchUpAt).toBeGreaterThan(-1);
    expect(steadyDrainAt).toBeGreaterThan(catchUpAt);
    const catchUp = emitBody.slice(catchUpAt, steadyDrainAt);
    expect(catchUp).toContain('FOREGROUND_CATCH_UP_BATCH');
    // Both queues dry inside their budget ⇒ the catch-up releases and the
    // steady-state path is byte-identical again.
    expect(catchUp).toContain('catchUpUntilSec = null');
  });
});

describe('NeuralFabric oversized-diff cohort staggering', () => {
  it('staggers via the pure planner as a DELAYED-INSERTION queue', () => {
    expect(SRC).toContain('planFabricCohorts(');
    expect(SRC).toContain('pendingCohortsRef');
    // Delayed insertion, not future-bornAt: queued adds are admitted with
    // the pump frame's `now` (see fabricCohorts.ts for why).
    expect(SRC).not.toContain('bornAt: slice.startAt');
    expect(SRC).not.toContain('bornAt: cohort.startAt');
  });

  it('shares ONE insertion body between immediate, flush, and pump admissions', () => {
    // The extracted helper's three call sites (immediate pass-1, setFabric
    // flush, emitFabric pump) — a deferred admission cannot drift from an
    // immediate one.
    expect(SRC).toContain('const admitFabricEdge = (');
    const admitCalls = SRC.match(/admitFabricEdge\(\n?/g) ?? [];
    expect(admitCalls.length).toBe(3);
  });

  it('flushes pending cohorts before diffing a new authoritative graph', () => {
    const setFabricBody = SRC.slice(
      SRC.indexOf('setFabric(graph, cells, now) {'),
      SRC.indexOf('growEdges(edges, cells, bornAtByKey, dirByKey) {'),
    );
    // The flush (queue cleared, remainder admitted fully-grown) must come
    // before pass 1 so the diff always runs against complete states.
    const flushAt = setFabricBody.indexOf('pendingCohortsRef.current = null');
    const passOneAt = setFabricBody.indexOf('for (const e of graph.edges)');
    expect(flushAt).toBeGreaterThan(-1);
    expect(passOneAt).toBeGreaterThan(flushAt);
    // Flushed adds join fully grown — no animation restart on flush.
    expect(setFabricBody).toContain('const grownBornAt = now - GROWTH_MS / 1000');
  });

  it('pumps due cohorts at the emitFabric entry, ahead of the dirty gate', () => {
    const emitBody = SRC.slice(SRC.indexOf('emitFabric(now) {'));
    const pumpAt = emitBody.indexOf('pendingCohortsRef.current');
    const dirtyGateAt = emitBody.indexOf('if (!emitDirtyRef.current)');
    expect(pumpAt).toBeGreaterThan(-1);
    expect(dirtyGateAt).toBeGreaterThan(pumpAt);
    // Cohort gc-fades keep the deaths-at-now invariant and killEdges
    // idempotency (never reset an in-flight death clock).
    const pump = emitBody.slice(0, dirtyGateAt);
    expect(pump).toContain('st.dyingAt = now');
    expect(pump).toContain('if (!st || st.dyingAt !== null) continue');
  });

  it('meters passive-fabric uploads through fabricUploadBytes', () => {
    expect(SRC).toContain('fabricUploadBytes');
    const observeCalls = SRC.match(/fabricStats\.observeUpload\(/g) ?? [];
    // Legacy slot ranges (test surface), the three lifecycle commits (event
    // ranges, full population, aperture prefix), and the warm-route overlay —
    // the fabric family's largest steady-state uploader, and for a long time
    // the only one RENDER STATS·08 could not see.
    expect(observeCalls.length).toBe(5);
  });
});
