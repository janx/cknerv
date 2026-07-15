import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { simClock, type MutableSimClock } from './simClock';

export interface SimClockScopeValue {
  clock: MutableSimClock;
  paused: boolean;
  timeScale: number;
  /** A fixed wall-frame delta makes review seeks independent of display FPS. */
  fixedDeltaSec: number | null;
  /** Optional exact stopping boundary for fixed review stages. */
  maxElapsedSec: number | null;
  /** Actual bounded sim delta written by SimClockTicker before consumers run. */
  frameDeltaSecRef: MutableRefObject<number>;
}

const SimClockContext = createContext<SimClockScopeValue | null>(null);

export function SimClockScope({
  clock,
  paused,
  timeScale,
  fixedDeltaSec = null,
  maxElapsedSec = null,
  children,
}: {
  clock: MutableSimClock;
  paused: boolean;
  timeScale: number;
  fixedDeltaSec?: number | null;
  maxElapsedSec?: number | null;
  children: ReactNode;
}) {
  const frameDeltaSecRef = useRef(0);
  const value = useMemo<SimClockScopeValue>(() => ({
    clock,
    paused,
    timeScale,
    fixedDeltaSec,
    maxElapsedSec,
    frameDeltaSecRef,
  }), [clock, paused, timeScale, fixedDeltaSec, maxElapsedSec]);

  return (
    <SimClockContext.Provider value={value}>
      {children}
    </SimClockContext.Provider>
  );
}

export function useSimClockScope(): SimClockScopeValue | null {
  return useContext(SimClockContext);
}

/** Read the nearest review clock, falling back to the production singleton. */
export function useSimClock(): MutableSimClock {
  return useSimClockScope()?.clock ?? simClock;
}
