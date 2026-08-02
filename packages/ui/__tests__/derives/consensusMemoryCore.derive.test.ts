import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_MEMORY_AMBIENT_HEAD_CYCLE_S,
  CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD,
  CONSENSUS_MEMORY_AMBIENT_FLOW_SPEED,
  consensusMemoryAmbientFlowFrame,
  consensusMemoryCoreEnergy,
} from '../../src/derives/consensusMemoryCore.derive';

describe('consensusMemoryCoreEnergy', () => {
  it('hands energy from the moving read into retained agreement', () => {
    const reading = consensusMemoryCoreEnergy(1, 0);
    const converging = consensusMemoryCoreEnergy(1, 0.5);
    const retained = consensusMemoryCoreEnergy(1, 1);

    expect(reading).toEqual({ reading: 1, retained: 0 });
    expect(converging.reading).toBeLessThan(reading.reading);
    expect(converging.retained).toBeGreaterThan(reading.retained);
    expect(retained.reading).toBeCloseTo(0.1);
    expect(retained.retained).toBe(1);
  });

  it('holds the resolved Cell above a linearly fading route until release', () => {
    const releasing = consensusMemoryCoreEnergy(0.25, 1);

    expect(releasing.reading).toBeCloseTo(0.025);
    expect(releasing.retained).toBe(0.5);
    expect(releasing.retained).toBeGreaterThan(0.25);
    expect(consensusMemoryCoreEnergy(0, 1)).toEqual({
      reading: 0,
      retained: 0,
    });
  });

  it('clamps malformed inputs without inventing stored information', () => {
    expect(consensusMemoryCoreEnergy(Number.NaN, 1)).toEqual({
      reading: 0,
      retained: 0,
    });
    expect(consensusMemoryCoreEnergy(1, Number.POSITIVE_INFINITY)).toEqual({
      reading: 1,
      retained: 0,
    });
    expect(consensusMemoryCoreEnergy(2, -1)).toEqual({
      reading: 1,
      retained: 0,
    });
  });
});

describe('consensusMemoryAmbientFlowFrame', () => {
  it('moves a live Cell slowly from its stable phase and wraps seamlessly', () => {
    const initial = consensusMemoryAmbientFlowFrame(0, 0.25, true, false);
    const legible = consensusMemoryAmbientFlowFrame(2, 0.25, true, false);
    const moving = consensusMemoryAmbientFlowFrame(4, 0.25, true, false);
    const wrapped = consensusMemoryAmbientFlowFrame(
      CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD
        / CONSENSUS_MEMORY_AMBIENT_FLOW_SPEED,
      0.25,
      true,
      false,
    );

    expect(initial.dashOffset).toBeCloseTo(-0.5);
    expect(initial.headPhase).toBeCloseTo(0.25);
    expect(legible.headPhase).toBeGreaterThan(initial.headPhase);
    expect(Math.abs(legible.dashOffset - initial.dashOffset))
      .toBeGreaterThan(0.1);
    expect(moving.dashOffset).toBeLessThan(initial.dashOffset);
    expect(wrapped.dashOffset).toBeCloseTo(initial.dashOffset);
    expect(consensusMemoryAmbientFlowFrame(
      CONSENSUS_MEMORY_AMBIENT_HEAD_CYCLE_S,
      0.25,
      true,
      false,
    ).headPhase).toBeCloseTo(initial.headPhase);
    expect(CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD).toBeGreaterThanOrEqual(2);
    expect(CONSENSUS_MEMORY_AMBIENT_FLOW_SPEED).toBeGreaterThanOrEqual(0.08);
    expect(moving.opacityScale).toBeGreaterThanOrEqual(0.8);
    expect(moving.opacityScale).toBeLessThanOrEqual(1);
  });

  it('freezes a reduced-motion Cell and leaves only spent afterglow', () => {
    const reduced = consensusMemoryAmbientFlowFrame(0, 0.4, true, true);
    const reducedLater = consensusMemoryAmbientFlowFrame(99, 0.4, true, true);
    const spent = consensusMemoryAmbientFlowFrame(99, 0.4, false, false);

    expect(reducedLater).toEqual(reduced);
    expect(spent.dashOffset).toBe(reduced.dashOffset);
    expect(spent.headPhase).toBe(reduced.headPhase);
    expect(spent.opacityScale).toBeLessThan(reduced.opacityScale);
  });

  it('sanitizes malformed clocks and phases deterministically', () => {
    expect(consensusMemoryAmbientFlowFrame(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      false,
    )).toEqual(consensusMemoryAmbientFlowFrame(0, 0, true, false));
  });
});
