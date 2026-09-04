import { useEffect, useState } from 'react';
import { mediaQueryMatches } from './useMediaQuery';

/** The query, once. `HudOverlay` reads it synchronously too, for the one
 *  decision that cannot wait for a hook at all (`prefersFullMotion`). */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Does this visitor want motion stopped — answered on the FIRST committed
 *  frame.
 *
 *  ⭐ It used to start `false` and correct itself in an effect, which means a
 *  visitor who asked for stillness was shown one frame of everything they
 *  asked not to see: the scan-line layer, the ECG's loop, the CELL MESH
 *  breathe, and the alarm's flash if one was standing (report E, E-4).
 *  `HudOverlay` already refused that for the boot count-off, reading
 *  `matchMedia` synchronously and saying so in a comment — "someone who asked
 *  motion to stop must not be shown even one ghosted frame". The same
 *  sentence is true of every other loop in the file, so the hook does it for
 *  all of them.
 *
 *  No `matchMedia` at all (jsdom, an ancient browser) is not a request for
 *  stillness, so the answer there is `false` — motion runs. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => mediaQueryMatches(REDUCED_MOTION_QUERY));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}
