import { describe, expect, it } from 'vitest';
import { installPulseStatsHook } from '../src/pulse-stats-hook';

describe('installPulseStatsHook', () => {
  it('attaches read + reset functions to window', () => {
    installPulseStatsHook();
    expect(typeof window.__pulseStats).toBe('function');
    expect(typeof window.__pulseStatsReset).toBe('function');
    // The read hook returns a snapshot object with the expected shape.
    const snap = window.__pulseStats!();
    expect(snap).toHaveProperty('blocksTotal');
    expect(snap).toHaveProperty('linkReasons');
    // Recall counters ride the same surface: unification moved historical
    // recall onto the staged graph, so its availability has to be observable.
    expect(snap).toHaveProperty('recallOutcomes');
    expect(snap).toHaveProperty('recalledRatePct');
    // The quality verdict rides the same surface: the lock is only
    // verifiable if a probe can read `locked`/`switches` from the page.
    expect(typeof window.__qualityStats).toBe('function');
    const quality = window.__qualityStats!();
    expect(quality).toHaveProperty('effective');
    expect(quality).toHaveProperty('locked');
    expect(typeof quality.switches).toBe('number');
    // ⭐ And where each block wave started, on the same surface for the same
    // reason: "the flood begins at the node that made the block" is a claim
    // about a distribution, and a distribution cannot be verified by looking at
    // a scene. A probe resets, waits out a few dozen blocks, and divides.
    expect(typeof window.__producerOriginStats).toBe('function');
    expect(typeof window.__producerOriginStatsReset).toBe('function');
    const origins = window.__producerOriginStats!();
    expect(origins).toHaveProperty('waves');
    expect(origins).toHaveProperty('attested');
    expect(origins).toHaveProperty('anonymous');
    expect(origins).toHaveProperty('byProducer');
    expect(typeof origins.attestedRatePct).toBe('number');
    // Always attached, exactly as its neighbours are: the live pass runs
    // against a release build, and an instrument a release build drops is an
    // instrument that is not there when it is wanted.
    window.__producerOriginStatsReset!();
    expect(window.__producerOriginStats!().waves).toBe(0);

    // Bytes flagged for bufferSubData, by lane: the one upload reading
    // gl.info cannot give, on the surface the fabric counters already use.
    expect(typeof window.__uploadStats).toBe('function');
    expect(typeof window.__uploadStatsReset).toBe('function');
    const uploads = window.__uploadStats!();
    expect(uploads).toHaveProperty('lanes.fabric');
    expect(uploads).toHaveProperty('lanes.bridge');
    expect(uploads).toHaveProperty('lanes.cells');
    expect(typeof uploads.bytes).toBe('number');
    window.__uploadStatsReset!();
    expect(window.__uploadStats!().bytes).toBe(0);

    // The bridge layer's counters and the topology pipeline's ride inside the
    // fabric's snapshot: the layer the fabric is built beside, and the worker
    // every build came through, read off one hook.
    const fabric = window.__fabricStats!();
    expect(fabric).toHaveProperty('bridge.selectionsSkipped');
    expect(fabric).toHaveProperty('bridge.strokesMoved');
    expect(fabric).toHaveProperty('topology.patchedApplies');
    expect(fabric).toHaveProperty('topology.unchainedApplies');
    expect(fabric).toHaveProperty('topology.staleResends');
    expect(fabric).toHaveProperty('topology.workerFallbacks');

    // What one landed block costs the main thread, task by task: the whole
    // sustain wave is graded on these three numbers, and none of them can be
    // read from a scene or a frame rate.
    expect(typeof window.__blockFrameStats).toBe('function');
    expect(typeof window.__blockFrameStatsReset).toBe('function');
    const blockFrame = window.__blockFrameStats!();
    expect(blockFrame).toHaveProperty('max.landingMs');
    expect(blockFrame).toHaveProperty('max.bridgeMs');
    expect(blockFrame).toHaveProperty('max.frameGapMs');
    expect(Array.isArray(blockFrame.recent)).toBe(true);
    window.__blockFrameStatsReset!();
    expect(window.__blockFrameStats!().count).toBe(0);

    // The colony's rebuild cadence and the Cell picker's rebuilds: both were
    // "unmeasurable today" in the review that asked, and each answers from
    // the page now, on the same surface with the same reset discipline.
    expect(typeof window.__colonyStats).toBe('function');
    expect(typeof window.__colonyStatsReset).toBe('function');
    const colony = window.__colonyStats!();
    expect(colony).toHaveProperty('topologyBuilds');
    expect(colony).toHaveProperty('scaffoldMisses');
    expect(colony).toHaveProperty('edgeGeometryBuilds');
    window.__colonyStatsReset!();
    expect(window.__colonyStats!().topologyBuilds).toBe(0);
    expect(typeof window.__cellPickStats).toBe('function');
    expect(typeof window.__cellPickStatsReset).toBe('function');
    const picker = window.__cellPickStats!();
    expect(picker).toHaveProperty('rebuilds');
    expect(picker).toHaveProperty('suspendedSkips');
    expect(picker).toHaveProperty('rebuildReasons.pointerdown');
    // The two incremental outcomes ride the same surface: a rebuild count
    // that fell is only readable as a WIN beside the patches that replaced it
    // and the deferrals a gesture left for its settle.
    expect(picker).toHaveProperty('patches');
    expect(picker).toHaveProperty('deferredRebuilds');
    window.__cellPickStatsReset!();
    expect(window.__cellPickStats!().raycasts).toBe(0);

    // The opt-in render probe rides the same devtools surface. The hooks are
    // always discoverable, but the snapshot proves measurement itself remains
    // disabled until RenderStatsSampler is demanded / ?render-stats=1.
    expect(typeof window.__renderPerformanceStats).toBe('function');
    expect(typeof window.__renderPerformanceStatsJson).toBe('function');
    expect(typeof window.__renderPerformanceStatsReset).toBe('function');
    const performance = window.__renderPerformanceStats!();
    // Schema 2: the frame bracket and its ledger joined the export.
    expect(performance.schemaVersion).toBe(2);
    expect(performance.enabled).toBe(false);
    expect(performance.gpu.metrics).toEqual({});
    expect(performance.gpu.frameLedger.frames).toBe(0);
    expect(JSON.parse(window.__renderPerformanceStatsJson!())).toMatchObject({
      schemaVersion: 2,
      enabled: false,
    });
  });
});
