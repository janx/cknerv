// The alarm's dwell, wired to a clock.
//
// `holdAlert` beside `alertLevel` is the whole rule and it is pure; this is the
// two lines of React that give it a now and a wake-up. It lives in a hook
// rather than in `HudOverlay` for the reason `usePeerInspectionRetention` does:
// a dwell is a small state machine with a timer in it, and a component that
// owns six of those has stopped being readable.

import { useEffect, useRef, useState } from 'react';

import {
  alertHoldRemainingMs,
  holdAlert,
  type AlertHold,
  type AlertState,
} from '../derives/alertLevel';

/**
 * The alert as it should be DRAWN: the live reading, or the one still standing
 * out its dwell.
 *
 * The timer is the load-bearing half. Without it a held alert would sit there
 * until something else re-rendered the HUD — which on a quiet chain is the
 * next block, seconds away, and on a dead one is never. So the hook schedules
 * exactly the remainder and re-reads at the deadline; nothing polls.
 */
export function useHeldAlert(next: AlertState, now: () => number = Date.now): AlertState {
  const [, tick] = useState(0);
  const hold = useRef<AlertHold | null>(null);
  hold.current = holdAlert(hold.current, next, now());
  const standing = hold.current;

  useEffect(() => {
    const remainingMs = alertHoldRemainingMs(hold.current, now());
    if (remainingMs <= 0) return undefined;
    // A new object every re-read, so the deadline moves with the hold rather
    // than being pinned to whichever render happened to arm it first.
    const timer = setTimeout(() => tick((count) => count + 1), remainingMs);
    return () => clearTimeout(timer);
    // Keyed on the hold itself: a hold that has not changed has not moved its
    // deadline, and re-arming on every render would be a timer that never
    // fires on a busy chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standing]);

  return standing.state;
}
