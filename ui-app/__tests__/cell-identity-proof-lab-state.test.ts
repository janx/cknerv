import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CELL_IDENTITY_PROOF_REVIEW_ELAPSED_S,
  CELL_IDENTITY_PROOF_REVIEW_KINDS,
  CELL_IDENTITY_PROOF_REVIEW_STAGES,
  cellIdentityProofReviewFrame,
  resolveCellIdentityProofReviewStage,
} from '../src/cell-identity-proof-lab-state';

const LAB_SOURCE = resolve(process.cwd(), 'src/CellIdentityProofLab.tsx');

describe('Cell identity proof review lab state', () => {
  it('resolves stable direct-link stages', () => {
    for (const stage of CELL_IDENTITY_PROOF_REVIEW_STAGES) {
      expect(resolveCellIdentityProofReviewStage(`?stage=${stage}`))
        .toBe(stage);
    }
    expect(resolveCellIdentityProofReviewStage('')).toBe('key');
    expect(resolveCellIdentityProofReviewStage('?stage=unknown')).toBe('key');
  });

  it('keeps every animated sample inside its non-zero event window', () => {
    const durations = {
      address: 1.12,
      content: 1.18,
      anchor: 1.52,
    } as const;

    for (const stage of ['entry', 'key', 'late'] as const) {
      for (const kind of CELL_IDENTITY_PROOF_REVIEW_KINDS) {
        const elapsed = CELL_IDENTITY_PROOF_REVIEW_ELAPSED_S[stage][kind];
        expect(elapsed).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(durations[kind]);
      }
    }
  });

  it('switches reduced motion without advancing a second clock', () => {
    expect(cellIdentityProofReviewFrame('key', 'content')).toEqual({
      elapsedSeconds: 0.36,
      reducedMotion: false,
    });
    expect(cellIdentityProofReviewFrame('reduced', 'content')).toEqual({
      elapsedSeconds: 0,
      reducedMotion: true,
    });
  });

  it('reviews the production renderer at a fixed clock, without image mocks', () => {
    const source = readFileSync(LAB_SOURCE, 'utf8');

    expect(source).toContain('<CellGalaxy');
    expect(source).toContain('identityProofSampleElapsedSeconds=');
    expect(source).toContain('<SimClockScope');
    expect(source).toContain('fixedDeltaSec={0}');
    expect(source).toContain('NORMALIZED REVIEW POSE');
    expect(source).not.toContain('<img');
    expect(source).not.toContain('backgroundImage:');
  });
});
