// The one number in this feature that nothing sends us.
//
// ⚠️⚠️ THE WHOLE POINT OF THIS SUITE IS THAT THE FORMULA IS SOMEBODY ELSE'S.
// A hash rate derived from difficulty and cadence is not a reading anyone can
// check by looking at it: it could be off by a factor of the epoch length, or
// of the target block time, or of two, and the number would still look like a
// mainnet hash rate. So the pin below is an AGREEMENT — the same difficulty
// and the same cadence, run through this file, landing where the explorer that
// publishes its own hash rate landed on the same afternoon.

import { describe, expect, it } from 'vitest';
import { emptyChainCache } from '@cknerv/cache';
import type { ChainEntry } from '@cknerv/types';
import { formatHashRate, networkHashRateHs } from '../../src/derives/networkHashRate.derive';

/** Mainnet's difficulty on 2026-09-02, as the chain states it. Above
 *  `Number.MAX_SAFE_INTEGER` by seventy-nine times, which is why it is parsed
 *  as a `BigInt` before it is ever divided. */
const DIFFICULTY_HEX = '0x9ece045093b6c2f';
const DIFFICULTY = 715_193_027_957_320_751n;

function chainWith(over: Partial<ChainEntry> = {}): ChainEntry {
  return { ...emptyChainCache(), difficulty: DIFFICULTY_HEX, ...over };
}

/** A ring of `n` identical intervals, so the mean is the interval and the
 *  arithmetic under test is the division and nothing else. */
function intervals(ms: number, n = 60): number[] {
  return Array.from({ length: n }, () => ms);
}

describe('networkHashRateHs', () => {
  it('agrees with the explorer that publishes its own, from the same two inputs', () => {
    // ⭐ THE MEASUREMENT, WRITTEN OUT. On 2026-09-02 ckbadger's
    // `statistics/network` printed `hashRate` **84.29 PH/s** beside
    // `avgBlockTime` **"8.48s"**, at this difficulty. Run the same difficulty
    // over the same 8.48 s here:
    //
    //     715,193,027,957,320,751 / 8.48 = 8.4339e16 H/s = 84.34 PH/s
    //
    // …which is not 84.29, and the difference is the whole reason this is
    // written as an interval rather than as an equality. `"8.48s"` is ITS
    // rounding of its own unrounded mean, so the mean it actually divided by
    // is somewhere in [8.475, 8.485) — and over that interval the formula
    // gives (84.2891, 84.3886] PH/s. 84.29 is inside it, at the bottom: the
    // mean behind that print was 8.4849 s, which is exactly what rounds to
    // "8.48". Two different quantities agreeing to the precision each of them
    // was printed at is the strongest form this pin can take, and a formula
    // off by any factor at all would miss the interval by that factor.
    const ours = networkHashRateHs(chainWith({ recent_block_intervals_ms: intervals(8_480) }));
    expect(ours).not.toBeNull();
    expect(formatHashRate(ours as number)).toBe('84.34 PH/s');

    const fastestPrintingAs848 = Number(DIFFICULTY) / 8.485;
    const slowestPrintingAs848 = Number(DIFFICULTY) / 8.475;
    // ckbadger's own figure carries two decimals, so it is allowed the half of
    // its last place in both directions and nothing more.
    const theirs = 84.29e15;
    const theirRounding = 0.005e15;
    expect(theirs + theirRounding).toBeGreaterThanOrEqual(fastestPrintingAs848);
    expect(theirs - theirRounding).toBeLessThanOrEqual(slowestPrintingAs848);
    // And ours, taken at the midpoint of that same interval, is inside it too
    // — which is the claim: one formula, two readers.
    expect(ours as number).toBeGreaterThanOrEqual(fastestPrintingAs848);
    expect(ours as number).toBeLessThanOrEqual(slowestPrintingAs848);

    // A second reading the same day, at a faster cadence: `84.50 PH/s` beside
    // `"8.46s"`. Same formula, and it moves the way the formula says it moves.
    const faster = networkHashRateHs(chainWith({ recent_block_intervals_ms: intervals(8_464) }));
    expect(formatHashRate(faster as number)).toBe('84.5 PH/s');
  });

  it('divides the exact difficulty, which no double can hold', () => {
    // The conversion this file is allowed to make, stated as the size of the
    // error it makes. `Number(715193027957320751n)` lands on
    // 715,193,027,957,320,704 — the last two digits are gone — and that is a
    // relative error of 7e-17 against a sample whose own standard error is
    // 13%. The same rounding on a balance would be a wrong number of
    // shannons, which is why it is refused there and taken here.
    expect(Number.isSafeInteger(Number(DIFFICULTY))).toBe(false);
    expect(BigInt(Number(DIFFICULTY))).not.toBe(DIFFICULTY);
    const relativeError = Math.abs(Number(DIFFICULTY) - 715_193_027_957_320_751) / 715_193_027_957_320_751;
    expect(relativeError).toBeLessThan(1e-15);

    const rate = networkHashRateHs(chainWith({ recent_block_intervals_ms: intervals(10_000) }));
    expect(rate).toBeCloseTo(Number(DIFFICULTY) / 10, 0);
  });

  it('reads every interval the ring holds, not the ECG\'s window', () => {
    // ⭐ THE TWO WINDOWS ARE FOR DIFFERENT JOBS. The ECG averages 30 because a
    // health verdict has to REACT to a chain that just slowed down; this
    // estimator only has to be steady, and its error falls as 1/√N over
    // whatever is on hand. Thirty fast intervals in front of thirty slow ones
    // is the shape that tells them apart: the ECG's answer is the recent half,
    // and this one is the whole ring.
    const ring = [...intervals(16_000, 30), ...intervals(8_000, 30)];
    const rate = networkHashRateHs(chainWith({ recent_block_intervals_ms: ring }));
    // The mean of the whole ring is 12 s, not the last 30's 8 s.
    expect(rate).toBeCloseTo(Number(DIFFICULTY) / 12, 0);
  });

  it('drops the intervals that are not intervals', () => {
    const ring = [Number.NaN, 0, -8_000, 8_000, 8_000];
    const rate = networkHashRateHs(chainWith({ recent_block_intervals_ms: ring }));
    expect(rate).toBeCloseTo(Number(DIFFICULTY) / 8, 0);
  });

  it('has no answer before the chain has a cadence, and says so', () => {
    // A boot, and every rebuild after one. The alternative is dividing by the
    // protocol's INTENDED cadence and printing the result as a measurement of
    // this chain, which is a number about a specification.
    expect(networkHashRateHs(chainWith({ recent_block_intervals_ms: [] }))).toBeNull();
    expect(networkHashRateHs(chainWith({ recent_block_intervals_ms: [0, Number.NaN] }))).toBeNull();
  });

  it('refuses a difficulty it cannot read rather than guessing at one', () => {
    for (const difficulty of ['', '0x', 'nonsense', '715193027957320751', '0xzz', '0x0']) {
      expect(networkHashRateHs(chainWith({
        difficulty,
        recent_block_intervals_ms: intervals(8_000),
      })), difficulty).toBeNull();
    }
    // …including the one an empty cache starts on, which is how a card gets a
    // dash instead of an infinity before the first block.
    expect(networkHashRateHs(emptyChainCache())).toBeNull();
  });
});

describe('formatHashRate', () => {
  it('writes mainnet magnitudes in PH/s, to the hundredth', () => {
    expect(formatHashRate(84.3388e15)).toBe('84.34 PH/s');
    expect(formatHashRate(52.0263e15)).toBe('52.03 PH/s');
  });

  it('falls down the ladder rather than printing a zero', () => {
    // ⭐ A devnet's single CPU is eight rungs below mainnet. `0.00 PH/s` for it
    // would say the chain had stopped, which is a different statement from
    // "this chain is small".
    expect(formatHashRate(2.4879e12)).toBe('2.49 TH/s');
    expect(formatHashRate(9.4e9)).toBe('9.4 GH/s');
    expect(formatHashRate(1.5e6)).toBe('1.5 MH/s');
    expect(formatHashRate(2_400)).toBe('2.4 KH/s');
    expect(formatHashRate(940)).toBe('940 H/s');
    expect(formatHashRate(0)).toBe('0 H/s');
  });

  it('climbs it too, and groups the way the rest of the HUD groups', () => {
    expect(formatHashRate(3.2e18)).toBe('3.2 EH/s');
    // Past the top rung the mantissa is allowed to grow rather than the
    // ladder: there is no unit above E in common use, and a made-up one would
    // be less legible than the digits.
    expect(formatHashRate(4_210e18)).toBe('4,210 EH/s');
  });

  it('drops a trailing zero, which is the house grammar and not a rounding', () => {
    // Same shape `formatCkb` writes a capacity in — `61 CKB`, `12.5 K·CKB` —
    // so a balance and a rate on one card read as one register.
    expect(formatHashRate(52e15)).toBe('52 PH/s');
    expect(formatHashRate(52.1e15)).toBe('52.1 PH/s');
  });

  it('has no reading for a figure that is not one', () => {
    expect(formatHashRate(Number.NaN)).toBe('0 H/s');
    expect(formatHashRate(Number.POSITIVE_INFINITY)).toBe('0 H/s');
    expect(formatHashRate(-1)).toBe('0 H/s');
  });
});
