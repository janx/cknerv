import { beforeEach, describe, expect, it, vi } from 'vitest';

const useFrameMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => useFrameMock(cb),
}));

let mockTimeScale = 1;
let mockPaused = false;
const scopeMock = vi.hoisted(() => ({
  current: null as null | {
    paused: boolean;
    frameDeltaSecRef: { current: number };
  },
}));

vi.mock('../../src/tweaks/SimClockScope', () => ({
  useSimClockScope: () => scopeMock.current,
}));

vi.mock('leva', () => ({
  useControls: () => ({
    timeScale: mockTimeScale,
    paused: mockPaused,
  }),
}));

import { useSimFrame } from '../../src/tweaks/useSimFrame';

describe('useSimFrame', () => {
  beforeEach(() => {
    scopeMock.current = null;
  });

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

  it('uses the exact bounded delta written by a scoped ticker', () => {
    mockTimeScale = 0.25;
    mockPaused = true;
    scopeMock.current = {
      paused: false,
      frameDeltaSecRef: { current: 0.0125 },
    };
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.5);
    expect(userCb).toHaveBeenCalledWith({}, 0.0125);
  });

  it('skips a scoped callback while that scope is paused', () => {
    scopeMock.current = {
      paused: true,
      frameDeltaSecRef: { current: 0 },
    };
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).not.toHaveBeenCalled();
  });
});
