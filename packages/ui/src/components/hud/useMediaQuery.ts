import { useEffect, useState } from 'react';

/** What `matchMedia` says right now, synchronously, or `false` where there is
 *  no `matchMedia` to ask (SSR, jsdom without a stub, an ancient browser).
 *
 *  Exported because two hooks need the same answer and a second copy of this
 *  three-line function is how the two of them drifted apart in the first
 *  place. */
export function mediaQueryMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Reactive `matchMedia` boolean, correct on the FIRST committed frame.
 *
 *  ⭐ It used to start `false` and correct itself in an effect, and the cost
 *  was a wrong first frame for every viewport the query is about: at 1,280 px
 *  the HUD committed one frame with the wide 36 px strip and then moved every
 *  rail down 28 px when the effect ran — a jump on the page's first paint, in
 *  the same frames the boot band is trying to hold still (report E, E-4).
 *  `useState`'s initialiser runs before that first commit, so the answer is
 *  there in time.
 *
 *  The effect stays, and it is a subscription rather than a correction: a
 *  viewport that changes mid-session still moves the HUD. It re-reads on
 *  subscribe as well, because a query can flip between the initialiser and the
 *  effect — a resize during hydration is rare and free to handle. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaQueryMatches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const on = () => setMatches(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}
