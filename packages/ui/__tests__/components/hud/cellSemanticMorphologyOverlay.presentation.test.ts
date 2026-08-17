import { describe, expect, it } from 'vitest';
import type { ConsensusBraidField } from '../../../src/derives/consensusBraid.derive';
import {
  cellSemanticKnowledgeArcWindow,
  cellSemanticKnowledgeRingVisible,
} from '../../../src/components/hud/cellSemanticMorphologyOverlay.presentation';

describe('Cell semantic morphology occupied-byte presentation', () => {
  it.each([
    [null, false],
    ['asset', false],
    ['lock', false],
    ['state', false],
    ['born', false],
    ['capacity', true],
    ['data', true],
  ] satisfies Array<[ConsensusBraidField | null, boolean]>)(
    'shows the ring for %s focus: %s',
    (focusField, expected) => {
      expect(cellSemanticKnowledgeRingVisible(focusField)).toBe(expected);
    },
  );

  it('leaves a visible gap at both ends of a normal segment', () => {
    expect(cellSemanticKnowledgeArcWindow({ bytes: 25, start: 0, end: 0.25 }))
      .toEqual({ start: 0.01, end: 0.24 });
  });

  it('preserves small byte roles while still separating their ends', () => {
    const window = cellSemanticKnowledgeArcWindow({ bytes: 1, start: 0, end: 0.005 });
    expect(window?.start).toBeCloseTo(0.001);
    expect(window?.end).toBeCloseTo(0.004);
    expect(cellSemanticKnowledgeArcWindow({ bytes: 0, start: 0, end: 0 })).toBeNull();
  });
});
