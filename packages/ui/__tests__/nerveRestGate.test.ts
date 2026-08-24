import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBootSequence,
  resetBootSequenceForTest,
  type BootPhaseState,
} from '../src/boot/bootSequence';
import {
  bootNerveRestDone,
  reportBootBridgeSelected,
  reportBootGraphApplied,
  reportBootNerveGrowth,
  reportBootPopulationExpected,
  reportBootPopulationReady,
  resetNerveRestGateForTest,
  tickBootNerveRest,
} from '../src/boot/nerveRestGate';

function fabricState(): BootPhaseState {
  const phase = getBootSequence().phases.find((p) => p.id === 'fabric');
  if (!phase) throw new Error('fabric phase missing from the boot record');
  return phase.state;
}

beforeEach(() => {
  resetBootSequenceForTest();
  resetNerveRestGateForTest();
});

describe('nerveRestGate', () => {
  it('opens the fabric line when the first build applies', () => {
    expect(fabricState()).toBe('pending');
    reportBootGraphApplied();
    expect(fabricState()).toBe('active');
    expect(bootNerveRestDone()).toBe(false);
  });

  it('never completes before a build applied, whatever else landed', () => {
    reportBootNerveGrowth(1.2);
    reportBootPopulationExpected();
    reportBootPopulationReady(1000);
    reportBootBridgeSelected(2.4);
    tickBootNerveRest(100);
    expect(fabricState()).toBe('pending');
  });

  it('a field too small to wire completes on the graph landing alone', () => {
    // No growth reported, no placement expected: the degenerate scene keeps
    // the line's historical semantics — done at apply.
    reportBootGraphApplied();
    tickBootNerveRest(0);
    expect(fabricState()).toBe('done');
    expect(bootNerveRestDone()).toBe(true);
  });

  it('holds for the boot cohort growth deadline', () => {
    reportBootGraphApplied();
    reportBootNerveGrowth(5.2);
    tickBootNerveRest(5.19);
    expect(fabricState()).toBe('active');
    tickBootNerveRest(5.2);
    expect(fabricState()).toBe('done');
  });

  it('growth deadline max-latches across re-admissions', () => {
    reportBootGraphApplied();
    reportBootNerveGrowth(5.2);
    reportBootNerveGrowth(3.0); // an earlier deadline never rewinds the later
    tickBootNerveRest(4.0);
    expect(fabricState()).toBe('active');
    reportBootNerveGrowth(6.0); // a re-grow during boot extends it
    tickBootNerveRest(5.9);
    expect(fabricState()).toBe('active');
    tickBootNerveRest(6.0);
    expect(fabricState()).toBe('done');
  });

  it('an expected placement holds the line until it publishes', () => {
    reportBootGraphApplied();
    reportBootNerveGrowth(1.2);
    reportBootPopulationExpected();
    tickBootNerveRest(100);
    expect(fabricState()).toBe('active');
    reportBootPopulationReady(0);
    tickBootNerveRest(100);
    expect(fabricState()).toBe('done');
  });

  it('an empty placement waives the bridge wait', () => {
    reportBootGraphApplied();
    reportBootPopulationExpected();
    reportBootPopulationReady(0);
    tickBootNerveRest(0);
    expect(fabricState()).toBe('done');
  });

  it('a populated placement requires the first bridge selection + growth', () => {
    reportBootGraphApplied();
    reportBootNerveGrowth(1.2);
    reportBootPopulationExpected();
    reportBootPopulationReady(96_000);
    tickBootNerveRest(100);
    expect(fabricState()).toBe('active'); // no selection yet
    reportBootBridgeSelected(103.4);
    tickBootNerveRest(103.39);
    expect(fabricState()).toBe('active');
    tickBootNerveRest(103.4);
    expect(fabricState()).toBe('done');
  });

  it('first bridge selection wins; refill churn never stretches the boot', () => {
    reportBootGraphApplied();
    reportBootPopulationExpected();
    reportBootPopulationReady(1000);
    reportBootBridgeSelected(2.4);
    reportBootBridgeSelected(500); // a later re-selection is post-boot life
    tickBootNerveRest(2.4);
    expect(fabricState()).toBe('done');
  });

  it('first placement publish wins', () => {
    reportBootGraphApplied();
    reportBootPopulationExpected();
    reportBootPopulationReady(0);
    reportBootPopulationReady(1000); // cannot re-arm the bridge requirement
    tickBootNerveRest(0);
    expect(fabricState()).toBe('done');
  });

  it('a NaN clock or deadline holds the gate rather than releasing it', () => {
    reportBootGraphApplied();
    reportBootNerveGrowth(Number.NaN); // ignored, not a poisoned deadline
    reportBootNerveGrowth(2.0);
    tickBootNerveRest(Number.NaN);
    expect(fabricState()).toBe('active');
    reportBootBridgeSelected(Number.NaN);
    reportBootPopulationExpected();
    reportBootPopulationReady(5);
    reportBootBridgeSelected(Number.NaN); // still ignored
    reportBootBridgeSelected(2.0);
    tickBootNerveRest(2.0);
    expect(fabricState()).toBe('done');
  });

  it('is inert after completion', () => {
    reportBootGraphApplied();
    tickBootNerveRest(0);
    expect(bootNerveRestDone()).toBe(true);
    // Post-boot reports create no new requirement and change nothing.
    reportBootPopulationExpected();
    reportBootNerveGrowth(50);
    tickBootNerveRest(0);
    expect(fabricState()).toBe('done');
  });

  it('resets for tests', () => {
    reportBootGraphApplied();
    tickBootNerveRest(0);
    resetNerveRestGateForTest();
    resetBootSequenceForTest();
    expect(bootNerveRestDone()).toBe(false);
    expect(fabricState()).toBe('pending');
  });
});
