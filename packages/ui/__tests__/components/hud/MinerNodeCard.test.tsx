// The cohort card WITH a week.
//
// ⚠️ ITS SIBLING SUITE IS IN `SightedNodeCard.test.tsx`, and deliberately: the
// card without a week is what every build before the ledger rendered, and it
// is tested beside the crawler-only dialect because those two are where the
// difference between "somebody named it" and "the chain proved it" has to stay
// legible. This file is the third source — an INDEXER — and the three states
// it can arrive in, which is one distinction more than a card usually has to
// draw:
//
//   no week at all       the plate is not there        (a lookup never made)
//   a week without this cohort   the plate dashes      (a lookup that came back empty)
//   a week with it       the plate reads
//
// ⚠️ THE LIVE FIGURES BELOW ARE DATED 2026-09-02 and are here for the property
// they carry, not for the amount: the balance is above `Number.MAX_SAFE_INTEGER`
// and the address is 97 characters, which is what the measure has to survive.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MinerNodeCard, {
  type MinerNodeSubject,
} from '../../../src/components/hud/MinerNodeCard';
import type {
  ProducerLedgerStanding,
  ProducerLedgerWindow,
  ProducerStanding,
} from '../../../src/derives/blockProducers.derive';

afterEach(cleanup);

const LAST_SEEN_MS = 1_700_000_000_000;
const NOW_MS = LAST_SEEN_MS + 300_000;

const PRODUCER_KEY = `0x${'eb0c0007'}${'9f76e90b'.repeat(7)}`;
const DECLARED = '0.209.0 (d166e28 2026-07-29)  bpool';

/** The payout destination the indexer resolved for the largest cohort on
 *  2026-09-02. A public address on a public chain, and 97 characters — this
 *  card's KEY row is 66, so the address is the longest identity the measure
 *  has ever had to hold. */
const PAYOUT_ADDRESS = 'ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0tpsqq08mkay9ewrfrdwlcghv62qw704s93hhsj';

const WEEK: ProducerLedgerWindow = {
  days: 7,
  fromDate: '2026-08-26',
  toDate: '2026-09-01',
  totalBlocks: 67_800,
  fetchedAtMs: 1_756_800_000_000,
  indexedTip: 20_337_488,
};

/** 84.34 PH/s — mainnet difficulty over an 8.48 s mean, the figure
 *  `networkHashRate.test.ts` pins against the explorer's own. */
const NETWORK_HS = Number(715_193_027_957_320_751n) / 8.48;

function ledger(over: Partial<ProducerLedgerStanding> = {}): ProducerLedgerStanding {
  const blocks = over.blocks ?? 41_824;
  return {
    blocks,
    share: blocks / WEEK.totalBlocks,
    address: PAYOUT_ADDRESS,
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
    key: PRODUCER_KEY,
    message: DECLARED,
    blocks,
    windowBlocks,
    share: windowBlocks === 0 ? 0 : blocks / windowBlocks,
    lastSeenMs: LAST_SEEN_MS,
    fan: { drawn: false, reason: 'modal', matchedVersion: null, matched: 0, shareOfVersioned: 0 },
    ledger: ledger(),
    ...over,
  };
}

function renderCard(subject: Partial<MinerNodeSubject> = {}) {
  return render(
    <MinerNodeCard
      subject={{
        producer: subject.producer ?? standing(),
        versionedRosterSize: subject.versionedRosterSize ?? 32,
        ledgerWindow: subject.ledgerWindow === undefined ? WEEK : subject.ledgerWindow,
        networkHashRateHs: subject.networkHashRateHs === undefined
          ? NETWORK_HS
          : subject.networkHashRateHs,
      }}
      layoutSide="left"
      nowMs={NOW_MS}
      onClose={() => {}}
    />,
  );
}

function value(container: HTMLElement, row: string): string {
  return container.querySelector(`[data-miner-probe-value="${row}"]`)?.textContent ?? '';
}

function titleOf(container: HTMLElement, row: string): string | null {
  return container.querySelector(`[data-miner-probe-value="${row}"]`)?.getAttribute('title') ?? null;
}

/** The row box. It is where the two probe hooks that used to ride a caption's
 *  span hang now, and where the MESSAGE row — the one with no value column —
 *  keeps its own hover. */
function rowOf(container: HTMLElement, row: string): Element | null {
  return container.querySelector(`[data-miner-probe-fact="${row}"]`);
}

describe('MinerNodeCard with a week', () => {
  it('states the week, the fraction and the share in one value', () => {
    const { container } = renderCard();
    expect(value(container, 'week')).toBe('41,824 / 67,800 BLK · 62%');
    // The 240-block window is still its own row, in the same grammar over its
    // own denominator. Nothing on this card averages the two.
    expect(value(container, 'blocks')).toBe('96 / 200 BLK · 48%');
  });

  it('puts the days and the dates in the title, where a window shape belongs', () => {
    // The VALUE counts blocks, because blocks are what was counted; seven days
    // is the shape of the window they were counted over.
    const { container } = renderCard();
    const title = titleOf(container, 'week') ?? '';
    expect(title).toContain('7 complete days');
    expect(title).toContain('2026-08-26');
    expect(title).toContain('2026-09-01');
    expect(title).toContain('67,800');
  });

  it('scales the network rate by the share, and marks it as a scale', () => {
    const { container } = renderCard();
    expect(value(container, 'hashrate')).toBe('≈ 52.03 PH/s');
    expect(titleOf(container, 'hashrate')).toContain('difficulty');
    // ⭐ Nothing here measured a machine, and the row says so before the
    // number does.
    expect(value(container, 'hashrate').startsWith('≈')).toBe(true);
  });

  it('has no hash rate before the chain has a cadence', () => {
    // A boot, and every rebuild after one: `networkHashRateHs` has no answer
    // until the interval ring holds something, and a dash is what that is.
    const { container } = renderCard({ networkHashRateHs: null });
    expect(value(container, 'hashrate')).toBe('—');
    // …and the rest of the plate is untouched by it. One absent input takes
    // one row.
    expect(value(container, 'week')).toBe('41,824 / 67,800 BLK · 62%');
    expect(value(container, 'harvest')).toBe('98.3 M CKB');
  });

  it('prints the payout address shortened, and keeps the whole of it in the title', () => {
    const { container } = renderCard();
    expect(value(container, 'payout')).toBe('ckb1qzda0cr08m…2qw704s93hhsj');
    // ⭐ THE HOVER LEADS WITH THE VALUE'S OWN STRING, which is what a title on
    // a truncated value has always been for, and the sentence naming who did
    // the resolving follows it instead of printing under the row.
    expect(titleOf(container, 'payout')?.startsWith(PAYOUT_ADDRESS)).toBe(true);
    expect(titleOf(container, 'payout')).toContain('WHAT THE INDEXER RESOLVED THE KEY ABOVE TO');
    expect(container.textContent).not.toContain('WHAT THE INDEXER RESOLVED THE KEY ABOVE TO');
    // ⚠️ The KEY row still carries the hash, unshortened and first in ITS
    // title. The address is that lock in another notation, resolved by somebody
    // else — this card computes none of it from the key.
    expect(titleOf(container, 'key')?.startsWith(PRODUCER_KEY)).toBe(true);
  });

  it('formats a balance no double can hold, and says what it is a balance of', () => {
    const { container } = renderCard();
    expect(value(container, 'harvest')).toBe('98.3 M CKB');
    expect(container.querySelector('[data-miner-probe-harvest-caption]')?.textContent)
      .toBe('155,450 LIVE CELLS · 4,094,449 TXS');
    // The title is the disclaimer the row cannot fit: a balance is a fact
    // about an ADDRESS, and one address may be swept or shared.
    expect(titleOf(container, 'harvest')).toContain('address');
  });

  it('shows the sampled payout only on the cohort the sample landed on', () => {
    expect(renderCard().container.querySelector('[data-miner-probe-fact="paid"]')).toBeNull();
    cleanup();
    const { container } = renderCard({
      producer: standing({
        ledger: ledger({ lastRewardShannons: '55981023159', lastRewardBlock: 20_337_476 }),
      }),
    });
    expect(value(container, 'paid')).toBe('559.81 CKB · #20,337,476');
  });

  it('carries a probe hook on every row it renders', () => {
    // The hooks are how the live leg reads this card off a real screen, so a
    // row that shipped without one is a row nobody can check.
    const { container } = renderCard({
      producer: standing({
        ledger: ledger({ lastRewardShannons: '55981023159', lastRewardBlock: 20_337_476 }),
      }),
    });
    const facts = Array.from(container.querySelectorAll('[data-miner-probe-fact]'))
      .map((row) => row.getAttribute('data-miner-probe-fact'));
    expect(facts).toEqual(['blocks', 'key', 'message', 'build', 'week', 'hashrate', 'payout', 'harvest', 'paid']);
    for (const fact of facts) {
      expect(container.querySelector(`[data-miner-probe-value="${fact}"]`), fact ?? '').not.toBeNull();
    }
  });

  it('closes the module count-off rather than opening a hole in it', () => {
    // ⭐ The plate is LAST because it is the one that can be absent. Put it in
    // evidence order — between the chain's record and what the cohort says
    // about itself — and a card without a week reads MINE·01, ·02, ·04.
    const { container } = renderCard();
    expect(Array.from(container.querySelectorAll('[data-miner-probe-module]'))
      .map((section) => section.getAttribute('data-miner-probe-module')))
      .toEqual(['header', 'record', 'build', 'week']);
    const text = container.textContent ?? '';
    for (const tag of ['MINE·01', 'MINE·02', 'MINE·03', 'MINE·04']) {
      expect(text).toContain(tag);
    }
  });

  it('never prints a share without the window it was measured over', () => {
    // §9.6 across the whole card, now that two windows are on it: every
    // element whose own text reaches a percentage also reaches a window unit.
    // Split `62%` off `41,824 / 67,800 BLK` to make the row narrower and the
    // leaf carrying the percentage alone fails here.
    const { container } = renderCard();
    const withPercent = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .filter((element) => (element.textContent ?? '').includes('%'));
    expect(withPercent.length).toBeGreaterThan(0);
    for (const element of withPercent) {
      expect(element.textContent).toContain('BLK');
    }
  });

  it('prints no gloss under any of its values, and keeps every one a hover away', () => {
    // ⭐⭐ THE CARD USED TO EXPLAIN ITSELF TEN TIMES over nine rows, and a
    // reader walking down a column of figures had a line of prose between every
    // two of them. Not one sentence was cut: they are the rows' `title`s, and
    // this test is the pair of assertions that says so — absent from what the
    // card PRINTS, present in what it answers when asked.
    const { container } = renderCard({
      producer: standing({
        ledger: ledger({ lastRewardShannons: '55981023159', lastRewardBlock: 20_337_476 }),
      }),
    });
    const text = container.textContent ?? '';
    for (const gloss of [
      'OF THE RECENT BLOCKS THAT NAMED WHO THEY PAID',
      'PAYOUT LOCK HASH · THE ONLY IDENTITY THE CHAIN ATTESTS',
      'ONE HASH MAY PAY MANY MACHINES · WHICH IS WHY THIS IS A COHORT',
      'WRITTEN BY THE COHORT INTO ITS OWN BLOCKS · NOT MEASURED, AND TRIVIALLY SPOOFED',
      'PEERS THE CRAWLER HOLDS A BUILD FOR',
      'THIS IS THE BUILD ALMOST EVERY PEER WE SEE RUNS',
      'COUNTED BY AN INDEXER OVER COMPLETE DAYS, NOT BY THIS NODE',
      'THE SHARE ABOVE × DIFFICULTY OVER BLOCK CADENCE · AN ESTIMATE',
      'WHAT THE INDEXER RESOLVED THE KEY ABOVE TO',
      'ONE SAMPLED CELLBASE · NOT A TOTAL AND NOT A RATE',
    ]) {
      expect(text, gloss).not.toContain(gloss);
    }

    // Six of them hang off the value, which is what a reader aims at.
    for (const [row, gloss] of [
      ['blocks', 'OF THE RECENT BLOCKS THAT NAMED WHO THEY PAID'],
      ['key', 'PAYOUT LOCK HASH · THE ONLY IDENTITY THE CHAIN ATTESTS'],
      ['key', 'ONE HASH MAY PAY MANY MACHINES · WHICH IS WHY THIS IS A COHORT'],
      ['build', 'PEERS THE CRAWLER HOLDS A BUILD FOR'],
      ['build', 'THIS IS THE BUILD ALMOST EVERY PEER WE SEE RUNS'],
      ['payout', 'WHAT THE INDEXER RESOLVED THE KEY ABOVE TO'],
    ] as ReadonlyArray<[string, string]>) {
      expect(titleOf(container, row), `${row}: ${gloss}`).toContain(gloss);
    }

    // The seventh sits on the ROW, because MESSAGE has no value column: the
    // string the cohort wrote is a block of its own underneath, and the span at
    // the right-hand edge is a zero-width piece of nothing.
    expect(rowOf(container, 'message')?.getAttribute('title'))
      .toBe('WRITTEN BY THE COHORT INTO ITS OWN BLOCKS · NOT MEASURED, AND TRIVIALLY SPOOFED');

    // ⚠️ AND THREE ROWS ALREADY SAID IT, so nothing was appended to those. A
    // title that carries the sentence twice is the thing this change was
    // against, one surface over — the rule is that the gloss is REACHABLE, not
    // that it is written wherever it would fit.
    expect(titleOf(container, 'week')).toContain('the indexer attributed');
    expect(titleOf(container, 'hashrate')).toContain('difficulty over the mean interval');
    expect(titleOf(container, 'paid')).toContain('it is not a total and not a rate');
    for (const [row, gloss] of [
      ['week', 'COUNTED BY AN INDEXER'],
      ['hashrate', 'THE SHARE ABOVE'],
      ['paid', 'ONE SAMPLED CELLBASE'],
    ] as ReadonlyArray<[string, string]>) {
      expect(titleOf(container, row), `${row} says it twice`).not.toContain(gloss);
    }
  });

  it('keeps the probe hooks that used to ride a caption', () => {
    // Both captions carrying a hook are gone, and both hooks are on their rows
    // with the same reading — the live leg reads this card off a real screen,
    // so a hook that vanished with its caption is a fact nobody can check.
    const { container } = renderCard();
    expect(rowOf(container, 'key')?.getAttribute('data-miner-probe-cohort-reason'))
      .toBe('ONE HASH MAY PAY MANY MACHINES · WHICH IS WHY THIS IS A COHORT');
    expect(rowOf(container, 'build')?.getAttribute('data-miner-probe-narrowing')).toBe('modal');
    // The harvest's second reading is the one line still printed under a value,
    // and it is DATA rather than a gloss: live cells and transactions are a
    // second reading of the address, not an explanation of the first.
    expect(container.querySelectorAll('[data-miner-probe-harvest-caption]')).toHaveLength(1);
  });

  it('says none of the words it is not allowed to say', () => {
    // ⚠️ THE VOCABULARY GUARD, ASKED OF THE WHOLE CARD. `MINER` claims a
    // machine and this subject may be any number of them; `PRODUCER` is the
    // derive's own name for the fact and no reader has ever seen it. The week
    // added five rows and an entire plate, which is exactly the kind of edit
    // that reintroduces a word.
    const { container } = renderCard({
      producer: standing({
        ledger: ledger({ lastRewardShannons: '55981023159', lastRewardBlock: 20_337_476 }),
      }),
    });
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bMINERS?\b/i);
    expect(text).not.toMatch(/producer/i);
    expect(text).toContain('POW COHORT // eb0c0007');
  });
});

describe('MinerNodeCard when the week says nothing', () => {
  it('drops the whole plate when no week reached the view', () => {
    // ⭐ A lookup that was NEVER MADE — no source declares the capability, its
    // route answered 404, or what it sent contradicted itself. The card is
    // then byte-for-byte what it was before the ledger existed, which is what
    // makes the fallback a shape rather than a hope.
    const { container } = renderCard({ ledgerWindow: null, producer: standing({ ledger: null }) });
    expect(container.querySelector('[data-miner-probe-module="week"]')).toBeNull();
    expect(container.querySelectorAll('[data-miner-probe-module]')).toHaveLength(3);
    for (const row of ['week', 'hashrate', 'payout', 'harvest', 'paid']) {
      expect(container.querySelector(`[data-miner-probe-fact="${row}"]`), row).toBeNull();
    }
    // And nothing of the week's vocabulary leaks into the card that has none.
    const text = container.textContent ?? '';
    expect(text).not.toContain('HARVEST');
    expect(text).not.toContain('ckb1');
    expect(text).not.toContain('PH/s');
  });

  it('keeps the plate and dashes the rows when the week names other cohorts', () => {
    // ⚠️ THE OTHER ABSENCE, AND IT IS A DIFFERENT SENTENCE. The week was
    // counted; this cohort is not in it — newer than the seven days, or
    // smaller than the smallest row the record carries. That is a lookup that
    // came back empty, and the house dash is what says so.
    const { container } = renderCard({ producer: standing({ ledger: null }) });
    expect(container.querySelector('[data-miner-probe-module="week"]')).not.toBeNull();
    expect(value(container, 'week')).toBe('—');
    expect(value(container, 'payout')).toBe('—');
    expect(value(container, 'harvest')).toBe('—');
    expect(container.querySelector('[data-miner-probe-harvest-caption]')).toBeNull();
    expect(container.querySelector('[data-miner-probe-fact="paid"]')).toBeNull();
    expect(titleOf(container, 'week')).toContain('none of its rows');

    // …and the hash rate still reads, off the 240-block window's share, which
    // is the one window that does name this cohort. 48% of 84.34 PH/s.
    expect(value(container, 'hashrate')).toBe('≈ 40.48 PH/s');
  });

  it('dashes one row at a time when the address lookup failed', () => {
    // The ledger keeps the row and drops that row's optionals — an address
    // record that would not answer never costs the week its blocks.
    const { container } = renderCard({
      producer: standing({
        ledger: ledger({
          address: null, balanceShannons: null, liveCells: null, txCount: null,
        }),
      }),
    });
    expect(value(container, 'week')).toBe('41,824 / 67,800 BLK · 62%');
    expect(value(container, 'hashrate')).toBe('≈ 52.03 PH/s');
    expect(value(container, 'payout')).toBe('—');
    expect(value(container, 'harvest')).toBe('—');
    expect(container.querySelector('[data-miner-probe-harvest-caption]')).toBeNull();
  });
});
