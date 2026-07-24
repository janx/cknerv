import type { CellIdentityProofKind } from '@cknerv/ui';

export const CELL_IDENTITY_PROOF_REVIEW_STAGES = [
  'entry',
  'key',
  'late',
  'reduced',
] as const;

export type CellIdentityProofReviewStage =
  (typeof CELL_IDENTITY_PROOF_REVIEW_STAGES)[number];

export const CELL_IDENTITY_PROOF_REVIEW_KINDS = [
  'address',
  'content',
  'anchor',
] as const satisfies readonly CellIdentityProofKind[];

/** Stable samples chosen inside each proof's visible semantic window. */
export const CELL_IDENTITY_PROOF_REVIEW_ELAPSED_S: Record<
  Exclude<CellIdentityProofReviewStage, 'reduced'>,
  Record<CellIdentityProofKind, number>
> = {
  entry: {
    address: 0.16,
    content: 0.17,
    anchor: 0.28,
  },
  key: {
    address: 0.36,
    content: 0.36,
    anchor: 0.72,
  },
  late: {
    address: 0.84,
    content: 0.88,
    anchor: 1.16,
  },
};

export interface CellIdentityProofReviewFrame {
  elapsedSeconds: number;
  reducedMotion: boolean;
}

export function resolveCellIdentityProofReviewStage(
  search: string,
): CellIdentityProofReviewStage {
  const requested = new URLSearchParams(search).get('stage');
  return CELL_IDENTITY_PROOF_REVIEW_STAGES.includes(
    requested as CellIdentityProofReviewStage,
  )
    ? requested as CellIdentityProofReviewStage
    : 'key';
}

export function cellIdentityProofReviewFrame(
  stage: CellIdentityProofReviewStage,
  kind: CellIdentityProofKind,
): CellIdentityProofReviewFrame {
  if (stage === 'reduced') {
    return {
      elapsedSeconds: 0,
      reducedMotion: true,
    };
  }
  return {
    elapsedSeconds: CELL_IDENTITY_PROOF_REVIEW_ELAPSED_S[stage][kind],
    reducedMotion: false,
  };
}
