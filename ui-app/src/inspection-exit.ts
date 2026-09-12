// The hold that gives an inspection card an exit.
//
// Five card dialects share one chassis and none of them had a way to leave:
// the card, its leader and its dot were unmounted in a single frame, which is
// the only transition in this app that is a CUT (report E, E-5). A card cannot
// fade after it has been unmounted, so something has to keep the SELECTION
// alive for exactly as long as the fade — and that something is the app, which
// owns the selection, rather than the chassis, which owns the card.
//
// What is held is the selection and never a copy of the subject. Every prop a
// card is drawn from is derived from the selected id; a hold that kept the Cell
// while its semantics, its lens and its trace went null would empty the card as
// it faded, which is a worse ending than the cut.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface InspectionExit {
  /** True while a card is on its way out. Handed to the overlay, which fades
   *  the chassis and tells the frame writer to leave it alone. */
  leaving: boolean;
  /** End a selection. `run` is what actually clears it, and it lands when the
   *  fade is over. A second call while one is running is ignored: a card can
   *  only leave once, and two closes must not stack two timers. */
  close: (run: () => void) => void;
  /** A selection that MOVED rather than ended — a cell → cell switch, a peer
   *  clicked while a card was leaving. The card stays, re-dressed for its new
   *  subject, so the hold is abandoned and nothing is cleared. */
  cancel: () => void;
}

export function useInspectionExit(exitMs: number): InspectionExit {
  const timer = useRef<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const cancel = useCallback(() => {
    if (timer.current === null) return;
    if (typeof window !== 'undefined') window.clearTimeout(timer.current);
    timer.current = null;
    setLeaving(false);
  }, []);
  const close = useCallback((run: () => void) => {
    if (timer.current !== null) return;
    if (typeof window === 'undefined' || exitMs <= 0) {
      run();
      return;
    }
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      // Cleared BEFORE the body runs: clearing the selection is what makes the
      // app re-render, and the effect that cancels a moved selection must not
      // find a timer that has already fired.
      timer.current = null;
      setLeaving(false);
      run();
    }, exitMs);
  }, [exitMs]);
  // A page that goes away mid-exit owes nobody the rest of it.
  useEffect(() => () => {
    if (timer.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timer.current);
    }
    timer.current = null;
  }, []);
  // ⭐ ONE IDENTITY, or the hold defeats every memo under App. `close` and
  // `cancel` are stable, but a fresh WRAPPER each render is just as fatal:
  // App keys `clearCellSelection` on this object and `handleSelect` on that,
  // so a new object per render meant a new `onSelect` per render — and
  // `memo(CellGalaxy)`, `memo(NetworkColony)` and `memo(CellInspectionOverlay)`
  // re-ran on every mempool tick, health poll and peers poll (report L6-1).
  // `leaving` is the only member that moves, and it moves twice per exit.
  return useMemo(() => ({ leaving, close, cancel }), [leaving, close, cancel]);
}
