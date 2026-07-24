import { describe, expect, it } from 'vitest';
import { resolveVisualReviewRoute } from '../src/visual-review-route';

describe('visual review route', () => {
  it('keeps the production app as the default', () => {
    expect(resolveVisualReviewRoute('')).toBeNull();
    expect(resolveVisualReviewRoute('?cell-form-lab=0')).toBeNull();
  });

  it.each([
    ['?cell-form-lab=1', 'cell-form'],
    ['?cell-relic-lab=1', 'cell-relic'],
    ['?cell-proof-lab=1', 'cell-proof'],
    ['?protocol-event-lab=1', 'protocol-event'],
  ] as const)('routes %s to %s', (search, route) => {
    expect(resolveVisualReviewRoute(search)).toBe(route);
  });

  it('preserves protocol, proof, relic, form priority when switches overlap', () => {
    expect(resolveVisualReviewRoute(
      '?cell-form-lab=1&cell-relic-lab=1&cell-proof-lab=1&protocol-event-lab=1',
    )).toBe('protocol-event');
    expect(resolveVisualReviewRoute(
      '?cell-form-lab=1&cell-relic-lab=1&cell-proof-lab=1',
    )).toBe('cell-proof');
    expect(resolveVisualReviewRoute(
      '?cell-form-lab=1&cell-relic-lab=1',
    )).toBe('cell-relic');
  });
});
