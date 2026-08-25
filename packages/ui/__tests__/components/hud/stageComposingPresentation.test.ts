import { describe, expect, it } from 'vitest';
import { BOOT_SEQUENCE_TITLE } from '../../../src/components/hud/bootSequencePresentation';
import {
  STAGE_COMPOSING_TITLE,
  stageComposingLine,
} from '../../../src/components/hud/stageComposingPresentation';

const BUDGET = 12_000;

describe('stage composing — the title', () => {
  it('is the same instrument still speaking', () => {
    // Two chapters of one readout in one slot. The word that changes is the
    // one that says what it is doing now; the word that does not is what makes
    // the handover read as continuation rather than as a second object.
    const [bootFirst] = BOOT_SEQUENCE_TITLE.split(' ');
    const [composingFirst] = STAGE_COMPOSING_TITLE.split(' ');
    expect(composingFirst).toBe(bootFirst);
    expect(STAGE_COMPOSING_TITLE).toBe('STAGE COMPOSING');
  });
});

describe('stage composing — the line', () => {
  it('says nothing without a stage to say it about', () => {
    expect(stageComposingLine({ staged: null, budget: BUDGET, curated: 0, composed: false }))
      .toBeNull();
    expect(stageComposingLine({ staged: 9_298, budget: null, curated: 0, composed: false }))
      .toBeNull();
    expect(stageComposingLine({ staged: 9_298, budget: 0, curated: 0, composed: false }))
      .toBeNull();
  });

  it('counts seats against the budget while they are still filling', () => {
    const line = stageComposingLine({
      staged: 9_298, budget: BUDGET, curated: 0, composed: false,
    });
    expect(line?.text).toBe('STAGED 9,298 / 12,000');
    // The one moment with an honest denominator, so the one that draws a bar.
    expect(line?.fill).toBeCloseTo(9_298 / BUDGET, 6);
  });

  it('names a full stage that is still the canonical prefix', () => {
    const line = stageComposingLine({
      staged: BUDGET, budget: BUDGET, curated: 0, composed: false,
    });
    expect(line?.text).toBe('AWAITING COMPOSITION · STAGED 12,000');
    expect(line?.fill).toBeNull();
  });

  it('reports the curated share as a count, never as a fraction', () => {
    // Measured: seats sit pinned at the budget from t+7.6s while the curated
    // share climbs for another half-minute. A bar drawn off the seat count
    // would read 100% through every second of that — the exact reading the old
    // readout ended on — and the curated share has no published target to
    // divide by (the tip window keeps canonical seats on purpose, and a class
    // the chain cannot supply leaves a permanent shortfall).
    const line = stageComposingLine({
      staged: BUDGET, budget: BUDGET, curated: 10_169, composed: true,
    });
    expect(line?.text).toBe('CURATED 10,169 · STAGED 12,000');
    expect(line?.fill).toBeNull();
  });

  it('never draws a full bar', () => {
    for (const composed of [false, true]) {
      const line = stageComposingLine({
        staged: BUDGET, budget: BUDGET, curated: BUDGET, composed,
      });
      expect(line?.fill, 'a readout at 100% is a readout that has left').toBeNull();
    }
  });
});
