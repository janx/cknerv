import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** WHEN THE TOP BAR FOLDS, AND WHY IT IS A MEASUREMENT.
 *
 *  The strip has a one-row layout and a two-row one, and the HUD used to
 *  choose between them with `(max-width: 1280px)` — a number chosen in
 *  `0450de95` so "the control-dense top bar reflows before the panel rail
 *  does". That is an ordering wish, not a measurement, and it is why every
 *  iPad but the 13" shows a folded bar in landscape: the row measures 1,079 px
 *  and an 11" iPad is 1,194 px wide. It had a hundred pixels to spare and
 *  folded anyway.
 *
 *  A better number would be wrong the same way, because the row's width IS
 *  content: the ckbadger status word and its lag digits, `PANELS n/m`,
 *  whatever the host puts in the actions slot. Any constant is right for
 *  exactly one content state.
 *  So the rule is the one the rails already keep — `RAILS_COLLAPSE_*` in
 *  `HudOverlay.tsx` is "DERIVED and not chosen" — taken one step further:
 *  derived not from a table of measures but from the row itself, live.
 *
 *  ⭐ WHY A PROBE, AND NOT "MEASURE WHILE WIDE AND REMEMBER". A strip that
 *  folded because a chip was present could not find out the chip had left: it
 *  has no one row to measure any more, and on a tablet the viewport never
 *  changes, so it would stay folded for the session. The overlay therefore
 *  renders the strip TWICE — the second one hidden, at `width: max-content`
 *  (`StatusStrip`'s `probe` prop) — and the decision is a function of (want,
 *  available) at every moment, where `want` is the probe's border-box width
 *  and `available` is the width of the overlay root the strip spans.
 *
 *  ⭐ WHY AN ESTIMATE AS WELL. Two readers cannot measure: the boot band in
 *  `ui-app/index.html`, which stands where the strip will before React exists,
 *  and this HUD's own first render, which happens before any box has been
 *  laid out. Both run `STATUS_STRIP_FOLD_ESTIMATE_QUERY` — one string,
 *  computed here from the measured row, restated as a literal in `index.html`
 *  because a `<script>` in the document head cannot import, and held to this
 *  file by `ui-app/__tests__/boot-shell.test.ts`.
 *
 *  ⚠️ THE ACCEPTED EDGE. The estimate is a guess about content, so inside a
 *  band of roughly ±20 px around 1,103 the guess and the measurement can
 *  disagree — a page whose row happens to be wider or narrower than the 1,079
 *  this file records will hand over from a 64 px band to a 36 px strip, or the
 *  reverse, once. That is the same class of edge a late font swap already is,
 *  and it is the price of a shell that cannot measure. Everywhere else the
 *  band and the strip agree at the handover, which is more than the fixed
 *  query ever managed. */

/** The wide row, measured on the shipped build (`8512d3b`, headless Chromium
 *  at dpr 2, fonts loaded, ckbadger `READY · LAG n`, `PANELS 6/8`, `NOMINAL`):
 *  primary 268 · STAGE CELLS 275 · QUALITY 180 · CKBADGER 142 · health 170,
 *  five 4 px gaps and 24 px of padding. At boot, before ckbadger answers, it
 *  is 1,063.
 *
 *  ⚠️ It is the ESTIMATE's input and never the decision's: nothing in this
 *  file compares a live width against it. A decision that read this number
 *  would be the fixed breakpoint again, wearing a measurement's name. */
export const STATUS_STRIP_WIDE_MEASURED_PX = 1079;

/** How much clear space the row must have left over to stay one row: twice
 *  its own 12 px side padding. The row folds before its spacer — the `flex: 1`
 *  gap between the wordmark cluster and the controls — is thinner than the
 *  margins beside it, because a row whose two halves have touched has stopped
 *  being a bar with a shape and become a queue of chips. */
export const STATUS_STRIP_FOLD_SLACK_PX = 24;

/** The extra room the row must find before it unfolds again, so the decision
 *  cannot flap. Nearly three `tech` mono glyphs (8.5 px each): `LAG 9 → LAG
 *  10` and `NOMINAL → DEGRADED` change the row's width by less than this and
 *  therefore cannot move the layout on their own. It is still well under the
 *  54 px an iPad mini has to spare, so the mini unfolds and stays unfolded. */
export const STATUS_STRIP_FOLD_HYSTERESIS_PX = 16;

/** The widest page the ESTIMATE folds: the measured row plus its slack, minus
 *  one because `max-width` is inclusive — a page one pixel wider is the first
 *  one the row fits. Computed, never typed; `index.html` restates the value
 *  and `boot-shell.test.ts` derives it from the two constants above rather
 *  than from the answer, so the pact is the derivation and not the number. */
export const STATUS_STRIP_FOLD_ESTIMATE_MAX_WIDTH_PX = STATUS_STRIP_WIDE_MEASURED_PX
  + STATUS_STRIP_FOLD_SLACK_PX
  - 1;

/** The one query the boot band and the HUD's first render both run. */
export const STATUS_STRIP_FOLD_ESTIMATE_QUERY = `(max-width: ${STATUS_STRIP_FOLD_ESTIMATE_MAX_WIDTH_PX}px)`;

/** Should the strip stand folded, given where it stands now and what the last
 *  measurement said?
 *
 *  Three clauses, and the first is the one that makes the rest safe: a zero
 *  from either box is NO EVIDENCE, not a width of zero. jsdom lays nothing
 *  out, a display:none ancestor lays nothing out, and a box measured before
 *  its first layout is 0 — in every one of those cases the honest answer is
 *  "I have not been told anything", and the decision stays where it is.
 *
 *  Then: standing wide, fold as soon as the row wants more than the room less
 *  its slack. Standing folded, unfold only when there is the slack AND the
 *  hysteresis over it — the asymmetry is deliberate, and it is why one digit
 *  of `LAG` cannot start an oscillation between two layouts of different
 *  heights, each of which moves every rail on the page. */
export function decideStatusStripFold(
  folded: boolean,
  want: number,
  available: number,
): boolean {
  if (want <= 0 || available <= 0) return folded;
  if (folded) {
    return want + STATUS_STRIP_FOLD_SLACK_PX + STATUS_STRIP_FOLD_HYSTERESIS_PX > available;
  }
  return want + STATUS_STRIP_FOLD_SLACK_PX > available;
}

/** Whether the strip should fold, measured from the probe against its host.
 *
 *  Returns the estimate until a measurement has been made, and the measurement
 *  ever after. The measurement happens in a LAYOUT effect for the reason
 *  `useMediaQuery` reads `matchMedia` in its state initialiser (report E,
 *  E-4): React flushes a layout effect's state update before the browser
 *  paints, so the first frame anyone sees is already the measured one. An
 *  effect would have committed one frame of the estimate and then moved every
 *  rail on the page 28 px — a jump on the first paint, in the same frames the
 *  boot band is trying to hold still.
 *
 *  The observer is attached in that same effect and watches BOTH boxes: the
 *  probe, because content arrives (a chip, a font, a longer status word), and
 *  the host, because the page is resized, rotated or put in a split view.
 *  Where there is no `ResizeObserver` the window's own `resize` is the
 *  fallback — it catches the viewport half, which is the half a browser
 *  without a `ResizeObserver` is likely to be changing. Nothing polls. */
export function useStatusStripFold(
  probeRef: RefObject<HTMLElement>,
  hostRef: RefObject<HTMLElement>,
  estimate: boolean,
): boolean {
  const [measured, setMeasured] = useState<boolean | null>(null);
  // Read through a ref, and written in render rather than in an effect: the
  // first measurement runs in a LAYOUT effect, and an effect that refreshed
  // this ref would run after it — the one moment the estimate is the standing
  // answer is the one moment the ref would be stale.
  const estimateRef = useRef(estimate);
  estimateRef.current = estimate;

  useLayoutEffect(() => {
    const probe = probeRef.current;
    const host = hostRef.current;
    if (!probe || !host) return undefined;
    const measure = () => {
      // The border box, paddings included: what the row wants is the whole
      // row, and `clientWidth` on the host is the room inside the overlay
      // root, which is what the strip stretches across.
      const want = probe.getBoundingClientRect().width;
      const available = host.clientWidth;
      setMeasured((standing) => {
        // No evidence keeps `null` NULL, and that is not the same sentence the
        // pure function says. `decideStatusStripFold` would hand back the
        // standing answer — but a hook that has never measured is standing on
        // the estimate, and writing the estimate's value into state would
        // freeze it: the media query would stop moving the strip. So the state
        // stays "nothing measured yet" and the estimate goes on being live.
        if (want <= 0 || available <= 0) return standing;
        return decideStatusStripFold(standing ?? estimateRef.current, want, available);
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    observer.observe(host);
    return () => observer.disconnect();
  }, [probeRef, hostRef]);

  return measured ?? estimate;
}
