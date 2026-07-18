import { describe, expect, it } from 'vitest';
import {
  consensusMemoryEvidenceBindings,
  consensusMemoryEvidenceColor,
  consensusMemoryEvidenceCssColor,
  consensusMemoryEvidenceFingerprint,
} from '../../src/derives/consensusMemoryEvidence.derive';

const EVIDENCE = [
  { sourceId: 11, ordinal: 1, contentHash: `0x${'12'.repeat(32)}` },
  { sourceId: 12, ordinal: 2, contentHash: `0x${'ab'.repeat(32)}` },
  { sourceId: 13, ordinal: 3, contentHash: `0x${'ef'.repeat(32)}` },
];

describe('consensus memory evidence bindings', () => {
  it('binds real source identities to deterministic target-specific knots', () => {
    const first = consensusMemoryEvidenceBindings(
      `0x${'34'.repeat(32)}`,
      EVIDENCE,
      8,
    );
    const second = consensusMemoryEvidenceBindings(
      `0x${'34'.repeat(32)}`,
      EVIDENCE,
      8,
    );

    expect(second).toEqual(first);
    expect(first.map((binding) => binding.sourceId)).toEqual([11, 12, 13]);
    expect(new Set(first.map((binding) => binding.knotIndex)).size).toBe(3);
    expect(first.every((binding) => (
      binding.knotIndex >= 0 && binding.knotIndex < 8
    ))).toBe(true);
    expect(consensusMemoryEvidenceBindings('target-b', EVIDENCE, 8))
      .not.toEqual(first);
  });

  it('reuses existing knots only when evidence outnumbers the topology', () => {
    const bindings = consensusMemoryEvidenceBindings('target', EVIDENCE, 2);
    expect(bindings).toHaveLength(3);
    expect(new Set(bindings.slice(0, 2).map((binding) => binding.knotIndex)).size)
      .toBe(2);
    expect(consensusMemoryEvidenceBindings('target', EVIDENCE, 0)).toEqual([]);
  });

  it('formats compact fingerprints and one shared source palette', () => {
    expect(consensusMemoryEvidenceFingerprint(EVIDENCE[0].contentHash))
      .toBe('1212121·1212');
    expect(consensusMemoryEvidenceFingerprint('0xabcd')).toBe('ABCD');
    expect(consensusMemoryEvidenceFingerprint('')).toBe('UNAVAILABLE');
    expect(consensusMemoryEvidenceColor(3)).toEqual(
      consensusMemoryEvidenceColor(0),
    );
    expect(consensusMemoryEvidenceCssColor(1)).toMatch(/^rgb\(/);
  });
});
