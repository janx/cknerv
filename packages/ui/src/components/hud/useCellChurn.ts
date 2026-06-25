import { useRef } from 'react';
import { cellChurnRates, CHURN_WINDOW_BLOCKS, type ChurnRates, type ChurnSample } from '../../derives/cellChurn';

// Holds a rolling buffer of (tip, born, dead) samples and returns the smoothed
// per-block churn. A new sample is appended only when the tip advances, so
// repeated renders at the same tip (incl. StrictMode double-invoke) are no-ops.
export function useCellChurn(tip: number, born: number, dead: number): ChurnRates {
  const samples = useRef<ChurnSample[]>([]);
  const last = samples.current[samples.current.length - 1];
  if (!last || tip > last.tip) {
    samples.current = [...samples.current, { tip, born, dead }].slice(-(CHURN_WINDOW_BLOCKS + 1));
  }
  return cellChurnRates(samples.current);
}
