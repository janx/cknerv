// packages/ui/src/derives/networkHashRate.derive.ts
// How fast the whole network is searching, and the unit ladder that says it.
// Pure arithmetic over the chain entity — no React, no three.js.
//
// ⚠️⚠️ NOTHING ON THE WIRE CARRIES A HASH RATE, so this file computes one and
// the computation is the honest part. Neither cknerv's own adapter nor the
// enrichment source sends a rate: what exists is a DIFFICULTY, which the
// protocol sets, and a CADENCE, which the chain realizes. Difficulty is the
// expected number of hashes it takes to find one block; the mean interval is
// how long finding one took. Hashes per block over seconds per block is hashes
// per second, and that is the whole derivation:
//
//     hashRate = difficulty / meanBlockIntervalSeconds
//
// ⭐ IT IS THE EXPLORER'S OWN FORMULA, checked rather than assumed. ckbadger
// printed `84.50 PH/s` beside `8.46s` on 2026-09-02 at difficulty
// `0x9ece045093b6c2f`; that difficulty over that interval is 84.54 PH/s, and
// over the unrounded interval its own `8.46s` was rounded FROM it is 84.50.
// The test pins that agreement against the reading taken earlier the same day,
// where the arithmetic is written out.
//
// ⭐ AND IT IS AN ESTIMATE OF A RANDOM VARIABLE, not a reading off an
// instrument. Block finding is a Poisson process with CV = 1, so the mean of N
// intervals carries a standard error of 1/√N — about 13% at the 60 intervals
// the ring holds. Three significant figures is therefore ALL the display may
// spend: `84.3 PH/s` is already past what the sample supports, and the second
// decimal the formatter prints is there to keep one number grammar across the
// HUD rather than because the digit means anything. Nothing here is a
// measurement of anybody's machines.

import type { ChainEntry } from '@cknerv/types';
import { windowMeanMs } from './ecgCondition';

const MS_PER_SECOND = 1000;

/** The difficulty as the chain states it: a `0x…` quantity. Refused rather
 *  than coerced when it is anything else — `Number('0x…')` and `BigInt()` on a
 *  malformed string fail in opposite directions (one silently, one by
 *  throwing) and a rate computed from a misread difficulty is a number with no
 *  relation to the network at all. */
function parseDifficulty(difficulty: string): bigint | null {
  if (!/^0x[0-9a-fA-F]+$/.test(difficulty.trim())) return null;
  const value = BigInt(difficulty.trim());
  return value > 0n ? value : null;
}

/**
 * The network's hash rate in hashes per second, or null when the chain has not
 * said enough to divide.
 *
 * ⚠️ THE DIFFICULTY GOES THROUGH `BigInt` AND ONLY THEN TO A DOUBLE. Mainnet's
 * is 715,193,027,957,320,751 today — seventy-nine times `Number.MAX_SAFE_INTEGER`
 * — so `Number(difficulty)` lands on the nearest double and loses the last two
 * digits. That is a relative error of 7e-17 against a sample whose own standard
 * error is 1.3e-1, which is why the conversion is allowed here and is not
 * allowed on a balance: the same rounding that is invisible in a rate is a
 * wrong number of shannons.
 *
 * Null when the ring holds no valid interval — the first seconds of a boot,
 * and every rebuild — because the alternative is dividing by the protocol's
 * intended cadence and calling the result a measurement of this chain.
 */
export function networkHashRateHs(chain: ChainEntry): number | null {
  const difficulty = parseDifficulty(chain.difficulty);
  if (difficulty === null) return null;
  // Every interval the ring holds, and not the ECG's 30. The ECG windows its
  // mean because a health verdict has to REACT; this estimator only has to be
  // steady, and its error falls as 1/√N over exactly the samples on hand.
  const intervals = chain.recent_block_intervals_ms;
  const meanMs = windowMeanMs(intervals, intervals.length);
  if (meanMs === null || !(meanMs > 0)) return null;
  return Number(difficulty) / (meanMs / MS_PER_SECOND);
}

/** The unit ladder a search rate is written on. Mainnet lives in `PH/s`; a
 *  devnet's single CPU lives eight rungs down, and a readout that printed
 *  `0.00 PH/s` for it would be saying the chain had stopped. */
const HASH_RATE_TIERS: ReadonlyArray<{ threshold: number; suffix: string }> = [
  { threshold: 1e18, suffix: 'EH/s' },
  { threshold: 1e15, suffix: 'PH/s' },
  { threshold: 1e12, suffix: 'TH/s' },
  { threshold: 1e9, suffix: 'GH/s' },
  { threshold: 1e6, suffix: 'MH/s' },
  { threshold: 1e3, suffix: 'KH/s' },
];

/**
 * A search rate in the HUD's one number grammar: `84.34 PH/s`, `12.5 TH/s`,
 * `940 H/s`.
 *
 * Two decimals, trailing zeros dropped, grouping pinned to `en-US` — the same
 * shape `formatCkb` writes a capacity in, for the same reason: a reader should
 * not have to work out whether two figures on one screen are in one register.
 * The tier is chosen by magnitude so the mantissa always carries the
 * information and never the exponent.
 */
export function formatHashRate(hashesPerSecond: number): string {
  if (!Number.isFinite(hashesPerSecond) || hashesPerSecond < 0) return '0 H/s';
  const tier = HASH_RATE_TIERS.find((candidate) => hashesPerSecond >= candidate.threshold)
    ?? { threshold: 1, suffix: 'H/s' };
  const scaled = hashesPerSecond / tier.threshold;
  const body = scaled.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${body} ${tier.suffix}`;
}
