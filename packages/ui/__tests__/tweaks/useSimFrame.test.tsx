import { describe, expect, it, vi } from 'vitest';

const useFrameMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => useFrameMock(cb),
}));

let mockTimeScale = 1;
let mockPaused = false;

vi.mock('leva', () => ({
  useControls: () => ({
    timeScale: mockTimeScale,
    paused: mockPaused,
  }),
}));

import { useSimFrame } from '../../src/tweaks/useSimFrame';

describe('useSimFrame', () => {
  it('forwards delta scaled by timeScale to user callback', () => {
    mockTimeScale = 0.5;
    mockPaused = false;
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).toHaveBeenCalledWith({}, 0.008);
  });

  it('skips user callback entirely when paused', () => {
    mockTimeScale = 1;
    mockPaused = true;
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).not.toHaveBeenCalled();
  });

  it('skips user callback when timeScale is 0', () => {
    mockTimeScale = 0;
    mockPaused = false;
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).not.toHaveBeenCalled();
  });
});
