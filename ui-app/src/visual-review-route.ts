export type VisualReviewRoute =
  | 'protocol-event'
  | 'cell-proof'
  | 'cell-relic'
  | 'cell-form';

/** Preserve the historical review-route priority when switches overlap. */
export function resolveVisualReviewRoute(search: string): VisualReviewRoute | null {
  const params = new URLSearchParams(search);
  if (params.get('protocol-event-lab') === '1') return 'protocol-event';
  if (params.get('cell-proof-lab') === '1') return 'cell-proof';
  if (params.get('cell-relic-lab') === '1') return 'cell-relic';
  if (params.get('cell-form-lab') === '1') return 'cell-form';
  return null;
}
