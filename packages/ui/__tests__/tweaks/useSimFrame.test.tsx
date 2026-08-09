import { beforeEach, describe, expect, it, vi } from 'vitest';

const useFrameMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void) => useFrameMock(cb),
}));

const scopeMock = vi.hoisted(() => ({
  current: null as null | {
    paused: boolean;
    frameDeltaSecRef: { current: number };
  },
}));

vi.mock('../../src/tweaks/SimClockScope', () => ({
  useSimClockScope: () => scopeMock.current,
}));

// useSimFrame must NOT subscribe to leva — the one Time subscription belongs
// to SimClockTicker, which write-through publishes productionTimeControls.
vi.mock('leva', () => ({
  useControls: () => {
    throw new Error('useSimFrame must not hold its own leva subscription');
  },
}));

import { useSimFrame } from '../../src/tweaks/useSimFrame';
import { productionTimeControls } from '../../src/tweaks/timeControls';

describe('useSimFrame', () => {
  beforeEach(() => {
    scopeMock.current = null;
    productionTimeControls.paused = false;
    productionTimeControls.timeScale = 1;
  });

  it('forwards delta scaled by the published timeScale to user callback', () => {
    productionTimeControls.timeScale = 0.5;
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).toHaveBeenCalledWith({}, 0.008);
  });

  it('reads the snapshot per frame, not per render', () => {
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).toHaveBeenCalledWith({}, 0.016);
    // A knob change lands on the NEXT frame with no re-render of consumers.
    productionTimeControls.timeScale = 0.25;
    wrapper({}, 0.016);
    expect(userCb).toHaveBeenLastCalledWith({}, 0.004);
  });

  it('skips user callback entirely when paused', () => {
    productionTimeControls.paused = true;
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).not.toHaveBeenCalled();
  });

  it('skips user callback when timeScale is 0', () => {
    productionTimeControls.timeScale = 0;
    useFrameMock.mockClear();
    const userCb = vi.fn();
    useSimFrame(userCb);
    const wrapper = useFrameMock.mock.calls[0][0];
    wrapper({}, 0.016);
    expect(userCb).not.toHaveBeenCalled();
  });

  it('uses the exact bounded delta written by a scoped ticker', () => {
    productionTimeControls.timeScale = 0.25;
    productionTimeControls.paused = true;
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
