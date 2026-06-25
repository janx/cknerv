// Cell churn = how fast the live UTXO set is changing, derived from the
// backend's authoritative cumulative born/dead counters sampled across block
// arrivals. A rolling window smooths the per-block noise.
export const CHURN_WINDOW_BLOCKS = 8;

export interface ChurnSample { tip: number; born: number; dead: number; }
export interface ChurnRates { bornPerBlock: number; spentPerBlock: number; netPerBlock: number; }

const ZERO: ChurnRates = { bornPerBlock: 0, spentPerBlock: 0, netPerBlock: 0 };

export function cellChurnRates(samples: ChurnSample[]): ChurnRates {
  if (samples.length < 2) return ZERO;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const span = newest.tip - oldest.tip;
  if (span <= 0) return ZERO;
  const bornPerBlock = (newest.born - oldest.born) / span;
  const spentPerBlock = (newest.dead - oldest.dead) / span;
  return { bornPerBlock, spentPerBlock, netPerBlock: bornPerBlock - spentPerBlock };
}
