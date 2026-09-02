// The module where §9.6 is structural, tested as a structure.
//
// ⭐⭐ THE FIRST TEST IN THE LAST DESCRIBE IS THE ONE THAT MATTERS. Every
// string check below can be satisfied by a formatter that happens to be right
// today; the claim this module actually makes is that there is NO WAY to get a
// percentage out of it without the window beside the percentage, and that is a
// claim about the source rather than about any one output. So the source is
// read off disk and the `%` is counted: one function writes it, every other
// sentence goes through that function, and a new formatter that reached for
// `Math.round(share * 100)` of its own fails here before it can reach a card.
//
// ⚠️ EVERY LIVE FIGURE IN THIS FILE IS DATED. The two balances are what the
// two largest cohorts' payout addresses held on 2026-09-02, and they are here
// because they are above `Number.MAX_SAFE_INTEGER` — that property is what is
// being tested, not the amount. Nothing asserts that either address still
// holds it, or that either cohort is still the largest.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BlockProducerView,
  ProducerLedgerStanding,
  ProducerLedgerWindow,
  ProducerStanding,
} from '../../../src/derives/blockProducers.derive';
import {
  PRODUCER_NO_VALUE,
  producerFleetText,
  producerFleetTitle,
  producerHarvestCaption,
  producerHarvestText,
  producerHashRateText,
  producerLastPaidText,
  producerShareText,
  producerWeekText,
} from '../../../src/components/hud/producerReadout';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The week the indexer counted on 2026-09-02, verbatim: seven complete UTC+8
 *  days ending yesterday, and every block it attributed in them. */
const WEEK: ProducerLedgerWindow = {
  days: 7,
  fromDate: '2026-08-26',
  toDate: '2026-09-01',
  totalBlocks: 67_800,
  fetchedAtMs: 1_756_800_000_000,
  indexedTip: 20_337_488,
};

/** Mainnet's difficulty over an 8.48 s mean — 84.34 PH/s, the figure
 *  `networkHashRate.test.ts` pins against the explorer's own. */
const NETWORK_HS = Number(715_193_027_957_320_751n) / 8.48;

const KEY = `0x${'eb0c0007'}${'9f76e90b'.repeat(7)}`;

function week(over: Partial<ProducerLedgerStanding> = {}): ProducerLedgerStanding {
  const blocks = over.blocks ?? 41_824;
  return {
    blocks,
    share: blocks / WEEK.totalBlocks,
    address: 'ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0tpsqq08mkay9ewrfrdwlcghv62qw704s93hhsj',
    balanceShannons: '9829812162369360',
    liveCells: 155_450,
    txCount: 4_094_449,
    lastRewardShannons: null,
    lastRewardBlock: null,
    ...over,
  };
}

function standing(over: Partial<ProducerStanding> = {}): ProducerStanding {
  const blocks = over.blocks ?? 96;
  const windowBlocks = over.windowBlocks ?? 200;
  return {
    role: 'producer',
    key: KEY,
    message: '0.209.0 (aaaaaaa 2026-07-30)',
    blocks,
    windowBlocks,
    share: windowBlocks === 0 ? 0 : blocks / windowBlocks,
    lastSeenMs: 1_700_000_000_000,
    fan: { drawn: false, reason: 'modal', matchedVersion: null, matched: 0, shareOfVersioned: 0 },
    ledger: week(),
    ...over,
  };
}

function view(over: Partial<BlockProducerView> = {}): BlockProducerView {
  const ranked = over.ranked ?? [standing()];
  return {
    windowBlocks: 200,
    staging: ranked,
    ranked,
    versionedRosterSize: 32,
    candidacyByPeer: new Map(),
    ledgerWindow: WEEK,
    ...over,
  };
}

describe('producerWeekText', () => {
  it('states the week the way the window is stated: fraction, unit, share', () => {
    expect(producerWeekText(standing(), WEEK)).toBe('41,824 / 67,800 BLK · 62%');
    // …and the window's own row is untouched beside it, in the same grammar
    // over a different denominator. Nothing averages the two.
    expect(producerShareText(standing())).toBe('96 / 200 BLK · 48%');
  });

  it('groups the week, because five figures are unreadable ungrouped', () => {
    // The 240-block window never reaches four digits, which is why
    // `producerShareText` has never needed this and this one always does.
    expect(producerWeekText(standing(), WEEK)).toContain('41,824');
    expect(producerWeekText(standing(), WEEK)).toContain('67,800');
  });

  it('says a share is small rather than saying it is none', () => {
    // The smallest cohort in the live week took 2 of 67,800 blocks — 0.003%,
    // which rounds to zero. `0%` beside a row saying it took two of them is
    // the readout contradicting itself in one string.
    expect(producerWeekText(standing({ ledger: week({ blocks: 2 }) }), WEEK))
      .toBe('2 / 67,800 BLK · <1%');
  });

  it('has no value for a cohort the week does not name, or for no week at all', () => {
    expect(producerWeekText(standing({ ledger: null }), WEEK)).toBe(PRODUCER_NO_VALUE);
    expect(producerWeekText(standing(), null)).toBe(PRODUCER_NO_VALUE);
    expect(producerWeekText(standing({ ledger: null }), null)).toBe(PRODUCER_NO_VALUE);
  });

  it('takes its denominator from the window and never from the standing', () => {
    // ⭐ The week's total is one number for the whole view, so it arrives as
    // an argument rather than being reconstructed as `blocks / share` — which
    // would be dividing the week back out of its own rounding, and would put
    // two callers a digit apart. Hand this formatter a different week and the
    // fraction moves with it.
    expect(producerWeekText(standing(), { ...WEEK, totalBlocks: 70_000 }))
      .toContain('41,824 / 70,000 BLK');

    // ⚠️⚠️ AND THE PERCENTAGE DOES NOT MOVE WITH IT, WHICH IS THE INVARIANT
    // WRITTEN AS ITS OWN FAILURE. The share is the one the derive computed
    // against the real total (and the one the scene's intake reads, so the
    // card and the mark are driven by a single number); the denominator is the
    // one this caller handed over. Feed the two from different rounds and the
    // string says `62%` of a fraction that is 60% — which is exactly why
    // `MinerNodeSubject` carries the standing and the window as one read of
    // one view and neither of them optionally.
    expect(producerWeekText(standing(), { ...WEEK, totalBlocks: 70_000 }))
      .toBe('41,824 / 70,000 BLK · 62%');
    expect(producerWeekText(standing(), WEEK)).toBe('41,824 / 67,800 BLK · 62%');
  });
});

describe('producerHashRateText', () => {
  it('scales the network rate by this cohort\'s share, and marks it as a scale', () => {
    // 61.7% of 84.34 PH/s. The `≈` is the first character because nothing here
    // measured a machine: a cohort that ran twice as hard for half the week
    // lands in exactly the same place.
    expect(producerHashRateText(standing(), NETWORK_HS)).toBe('≈ 52.03 PH/s');
    expect(producerHashRateText(standing(), NETWORK_HS).startsWith('≈')).toBe(true);
  });

  it('falls down the unit ladder for a small cohort rather than printing zero', () => {
    expect(producerHashRateText(standing({ ledger: week({ blocks: 2 }) }), NETWORK_HS))
      .toBe('≈ 2.49 TH/s');
  });

  it('uses the window\'s share when the week does not name the cohort', () => {
    // The same precedence `ranked` follows: whichever window this view is a
    // reading of. 48% of the network, off 96 blocks of 200.
    expect(producerHashRateText(standing({ ledger: null }), NETWORK_HS)).toBe('≈ 40.48 PH/s');
  });

  it('has no value without a network rate, and none for a share of nothing', () => {
    expect(producerHashRateText(standing(), null)).toBe(PRODUCER_NO_VALUE);
    expect(producerHashRateText(standing(), Number.NaN)).toBe(PRODUCER_NO_VALUE);
    // A producer the week knows and the window does not is `blocks 0` over a
    // window it still names. `≈ 0 H/s` would say its machines had stopped.
    expect(producerHashRateText(
      standing({ blocks: 0, windowBlocks: 0, ledger: null }),
      NETWORK_HS,
    )).toBe(PRODUCER_NO_VALUE);
  });
});

describe('producerHarvestText', () => {
  it('formats a balance no double can hold, through BigInt', () => {
    // ⚠️ 9,829,812,162,369,360 shannons is above `Number.MAX_SAFE_INTEGER`,
    // and the trap is that it is EVEN — `Number()` on it round-trips to the
    // same string, so the loss is invisible in the value and only shows up in
    // arithmetic. The test for the hazard is the arithmetic, not the string.
    const shannons = '9829812162369360';
    expect(String(Number(shannons))).toBe(shannons);
    expect(Number(shannons) + 1).toBe(Number(shannons));
    expect(BigInt(shannons) + 1n).not.toBe(BigInt(shannons));

    expect(producerHarvestText(standing())).toBe('98.3 M CKB');
    // The second-largest cohort's address the same afternoon.
    expect(producerHarvestText(standing({
      ledger: week({ balanceShannons: '11133671694110362' }),
    }))).toBe('111.34 M CKB');
  });

  it('spends the house CKB grammar unchanged, trailing zero and all', () => {
    // `98.3`, not `98.30`. `formatCkb` drops a trailing zero everywhere in the
    // HUD, and one grammar across a card is worth more than a second decimal
    // on one row of it.
    expect(producerHarvestText(standing())).not.toContain('98.30');
    expect(producerHarvestText(standing({ ledger: week({ balanceShannons: '61_0000_0000'.replace(/_/g, '') }) })))
      .toBe('61 CKB');
  });

  it('has no value when the address lookup got none, and does not fall over on junk', () => {
    expect(producerHarvestText(standing({ ledger: week({ balanceShannons: null }) })))
      .toBe(PRODUCER_NO_VALUE);
    expect(producerHarvestText(standing({ ledger: null }))).toBe(PRODUCER_NO_VALUE);
    // The derive screens the digits, so this cannot arrive from there. It is
    // refused here anyway: the formatter is the last surface before a reader,
    // and a throw would take the whole card down rather than one row.
    expect(producerHarvestText(standing({ ledger: week({ balanceShannons: '9.8e15' }) })))
      .toBe(PRODUCER_NO_VALUE);
  });
});

describe('producerHarvestCaption', () => {
  it('says what the balance is a balance of', () => {
    expect(producerHarvestCaption(standing())).toBe('155,450 LIVE CELLS · 4,094,449 TXS');
  });

  it('prints whichever half the lookup returned', () => {
    expect(producerHarvestCaption(standing({ ledger: week({ txCount: null }) })))
      .toBe('155,450 LIVE CELLS');
    expect(producerHarvestCaption(standing({ ledger: week({ liveCells: null }) })))
      .toBe('4,094,449 TXS');
  });

  it('is a sentence or nothing, never an empty one', () => {
    expect(producerHarvestCaption(standing({
      ledger: week({ liveCells: null, txCount: null }),
    }))).toBeNull();
    expect(producerHarvestCaption(standing({ ledger: null }))).toBeNull();
  });
});

describe('producerLastPaidText', () => {
  it('states the amount and the height it was read at', () => {
    // The live sample on 2026-09-02: the tip was 20,337,488 and the reward
    // twelve blocks back had been paid.
    expect(producerLastPaidText(standing({
      ledger: week({ lastRewardShannons: '55981023159', lastRewardBlock: 20_337_476 }),
    }))).toBe('559.81 CKB · #20,337,476');
  });

  it('is absent rather than dashed, on every cohort the refresh did not sample', () => {
    // ⚠️ A refresh reads ONE height, so at most one producer in a view carries
    // this. A dash on the other fifteen would be fifteen cards reporting an
    // empty lookup that was never made about them — the same thing this
    // dialect refuses when it prints no country rather than `Unknown`.
    expect(producerLastPaidText(standing())).toBeNull();
    expect(producerLastPaidText(standing({ ledger: null }))).toBeNull();
  });

  it('refuses half a payout', () => {
    // An amount with no height is a payout at no particular time; a height
    // with no amount is a block that says nothing.
    expect(producerLastPaidText(standing({
      ledger: week({ lastRewardShannons: '55981023159', lastRewardBlock: null }),
    }))).toBeNull();
    expect(producerLastPaidText(standing({
      ledger: week({ lastRewardShannons: null, lastRewardBlock: 20_337_476 }),
    }))).toBeNull();
  });
});

describe('producerFleetText', () => {
  it('reads the week when there is one, in the week\'s own unit', () => {
    const ranked = [
      standing({ ledger: week({ blocks: 41_824 }) }),
      standing({ ledger: week({ blocks: 8_909 }) }),
      standing({ ledger: week({ blocks: 2 }) }),
    ];
    expect(producerFleetText(view({ ranked }))).toBe('3 · TOP 62% · 7 D');
  });

  it('reads the window when there is no week, byte for byte as it always did', () => {
    const ranked = [
      standing({ blocks: 96, windowBlocks: 200, ledger: null }),
      standing({ blocks: 48, windowBlocks: 200, ledger: null }),
    ];
    expect(producerFleetText(view({ ranked, ledgerWindow: null }))).toBe('2 · TOP 48% · 200 BLK');
    expect(producerFleetText(view({ ranked: [], ledgerWindow: null, windowBlocks: 0 })))
      .toBe('0 · 0 BLK');
  });

  it('falls back to the window when a week exists and names nobody', () => {
    // ⭐ A coherent ledger with no rows: the total is positive and the row list
    // is empty, which passes every check the derive makes. `TOP` would then be
    // a share of a producer the week does not carry, so the row says what this
    // node can see for itself instead — the true smaller statement.
    const ranked = [standing({ blocks: 96, windowBlocks: 200, ledger: null })];
    expect(producerFleetText(view({ ranked }))).toBe('1 · TOP 48% · 200 BLK');
  });

  it('counts the window\'s own standings when it reports the window', () => {
    // ⚠️⚠️ THE SET IS A UNION NOW, and this is where that shows. Two cohorts
    // hold blocks in the ring; five more are here because the WEEK names them,
    // with `blocks 0` against a window that has never seen them. A window
    // sentence that counted the whole set would report seven cohorts into a
    // five-block ring — and the leader would be taken off `ranked`, which is
    // sequenced by the WEEK's blocks and whose head may hold none of this
    // window at all.
    const ranked = [
      standing({ blocks: 3, windowBlocks: 5, ledger: week({ blocks: 41_824 }) }),
      standing({ blocks: 2, windowBlocks: 5, ledger: week({ blocks: 8_909 }) }),
      ...Array.from({ length: 5 }, () => standing({
        blocks: 0, windowBlocks: 5, ledger: week({ blocks: 7_570 }),
      })),
    ];
    const title = producerFleetTitle(view({ ranked, windowBlocks: 5 }));
    expect(title).toContain('2 · TOP 60% · 5 BLK');
    expect(title).not.toContain('7 · TOP');

    // …and with no week at all the walk returns exactly what reading the head
    // of `ranked` returned, which is what keeps every string this row has ever
    // printed byte-identical.
    const windowOnly = [
      standing({ blocks: 96, windowBlocks: 200, ledger: null }),
      standing({ blocks: 48, windowBlocks: 200, ledger: null }),
      standing({ blocks: 32, windowBlocks: 200, ledger: null }),
      standing({ blocks: 24, windowBlocks: 200, ledger: null }),
    ];
    expect(producerFleetText(view({ ranked: windowOnly, ledgerWindow: null })))
      .toBe('4 · TOP 48% · 200 BLK');
  });

  it('never prints a share without the window it is a share of', () => {
    // Both branches, and the empty one. Whichever window the row is reading,
    // the unit for that window is in the same string.
    const withWeek = producerFleetText(view());
    expect(withWeek).toContain('%');
    expect(withWeek).toMatch(/\d+ D$/);
    const withoutWeek = producerFleetText(view({ ledgerWindow: null }));
    expect(withoutWeek).toContain('%');
    expect(withoutWeek).toContain('BLK');
  });
});

describe('producerFleetTitle', () => {
  it('carries the window the row gave up, whole, when the week takes the row', () => {
    const ranked = [
      standing({ blocks: 3, windowBlocks: 5, ledger: week({ blocks: 41_824 }) }),
      standing({ blocks: 2, windowBlocks: 5, ledger: week({ blocks: 8_909 }) }),
    ];
    const title = producerFleetTitle(view({ ranked, windowBlocks: 5 }));
    // The week, with its dates and its denominator…
    expect(title).toContain('7 complete days');
    expect(title).toContain('2026-08-26 to 2026-09-01');
    expect(title).toContain('67,800 BLK');
    // …and the reading only this machine vouches for, which is the one that
    // says `2 · TOP 60% · 5 BLK` a minute after a boot.
    expect(title).toContain('2 · TOP 60% · 5 BLK');
    expect(title).toContain('cohorts and never miners');
  });

  it('is the sentence it has always been when there is no week', () => {
    const title = producerFleetTitle(view({ ledgerWindow: null }));
    expect(title).toBe(
      'Distinct payout identities in the recent block window, read from each'
      + " block's cellbase witness. One payout address may pay many machines,"
      + ' so this counts cohorts and never miners.',
    );
  });

  it('states the window in the same breath as every percentage it carries', () => {
    for (const v of [view(), view({ ledgerWindow: null })]) {
      const title = producerFleetTitle(v);
      if (!title.includes('%')) continue;
      expect(title).toContain('BLK');
    }
  });
});

describe('the rule this module exists to hold', () => {
  it('writes a percent sign in exactly one function', () => {
    // ⭐⭐ THE STRUCTURAL FORM OF §9.6. Every string test above can be
    // satisfied by a formatter that is right today; this one asks whether
    // there is any WAY to be wrong tomorrow. `percentOfWindow` is private and
    // is the only place in the module where a `%` is written down, so a new
    // sentence reaching for `Math.round(share * 100)` of its own — the exact
    // edit that put a bare `56%` on a surface once — cannot compile past this
    // line without somebody deleting it on purpose.
    const source = readFileSync(
      resolve(__dirname, '..', '..', '..', 'src', 'components', 'hud', 'producerReadout.ts'),
      'utf8',
    );
    // Comments argue about percentages at length; the rule is about code.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const start = code.indexOf('function percentOfWindow');
    expect(start, 'percentOfWindow moved or was renamed').toBeGreaterThan(-1);
    const end = code.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);

    const offenders: number[] = [];
    for (let at = code.indexOf('%'); at !== -1; at = code.indexOf('%', at + 1)) {
      if (at < start || at > end) offenders.push(at);
    }
    expect(
      offenders.map((at) => code.slice(Math.max(0, at - 60), at + 20)),
      'a percentage is written outside percentOfWindow',
    ).toEqual([]);
    // …and the pin: the sweep is looking at a file that really does write one.
    expect(code.slice(start, end)).toContain('%');
  });

  it('hands out no percentage that is not standing next to its window', () => {
    // The same claim from the other side: every string this module can produce
    // for a live view, checked for the pairing rather than for its text.
    const outputs = [
      producerShareText(standing()),
      producerWeekText(standing(), WEEK),
      producerWeekText(standing({ ledger: week({ blocks: 2 }) }), WEEK),
      producerFleetText(view()),
      producerFleetText(view({ ledgerWindow: null })),
      producerFleetTitle(view()),
      producerFleetTitle(view({ ledgerWindow: null })),
      producerHashRateText(standing(), NETWORK_HS),
      producerHarvestText(standing()),
      producerHarvestCaption(standing()) ?? '',
      producerLastPaidText(standing({
        ledger: week({ lastRewardShannons: '55981023159', lastRewardBlock: 20_337_476 }),
      })) ?? '',
    ];
    for (const output of outputs) {
      if (!output.includes('%')) continue;
      expect(output, output).toMatch(/\bBLK\b|\d+ D\b/);
    }
    // The pin again: some of them do carry one.
    expect(outputs.filter((output) => output.includes('%')).length).toBeGreaterThan(3);
  });
});
