import { describe, expect, it } from 'vitest';
import { protocolEventReviewCameraPose } from '../src/protocol-event-review-camera';

const local = [24, 22, -18] as const;
const focus = [-8, 38, 12] as const;

describe('protocol event review camera', () => {
  it('gives every fixed review stage a distinct semantic composition', () => {
    const network = protocolEventReviewCameraPose(0.3, local, focus);
    const carrier = protocolEventReviewCameraPose(1.1, local, focus);
    const commit = protocolEventReviewCameraPose(3.4, local, focus);
    const settled = protocolEventReviewCameraPose(6.2, local, focus);

    expect(network).toEqual({
      position: [82, 74, 82],
      target: [0, 28, 0],
      fov: 47,
    });
    expect(carrier.target).toEqual([24, 30, -18]);
    expect(commit.target).toEqual([-8, 38.4, 12]);
    expect(settled.target).toEqual([-8, 38.2, 12]);
    expect([network.fov, carrier.fov, commit.fov, settled.fov]).toEqual([
      47, 39, 34, 29,
    ]);
  });

  it('interpolates continuously between semantic views', () => {
    const before = protocolEventReviewCameraPose(0.4, local, focus);
    const middle = protocolEventReviewCameraPose(0.675, local, focus);
    const after = protocolEventReviewCameraPose(0.95, local, focus);

    expect(middle.position[0]).toBeGreaterThan(Math.min(before.position[0], after.position[0]));
    expect(middle.position[0]).toBeLessThan(Math.max(before.position[0], after.position[0]));
    expect(middle.fov).toBeCloseTo(43);
  });

  it('retains useful fallbacks before a real event target is injected', () => {
    expect(protocolEventReviewCameraPose(1.1, null, null).target).toEqual([0, 30, 0]);
    expect(protocolEventReviewCameraPose(3.4, null, null).target).toEqual([0, 38.4, 0]);
  });

  it('backs out just enough to contain a real multi-witness route frame', () => {
    const close = protocolEventReviewCameraPose(6.2, local, focus);
    const framed = protocolEventReviewCameraPose(6.2, local, focus, 12);
    const closeDistance = Math.hypot(
      close.position[0] - focus[0],
      close.position[1] - focus[1],
      close.position[2] - focus[2],
    );
    const framedDistance = Math.hypot(
      framed.position[0] - focus[0],
      framed.position[1] - focus[1],
      framed.position[2] - focus[2],
    );

    expect(framed.target).toEqual(close.target);
    expect(framedDistance).toBeGreaterThan(closeDistance);
    expect(framed.fov).toBeGreaterThan(close.fov);
  });
});
