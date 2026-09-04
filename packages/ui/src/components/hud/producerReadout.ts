// The one place a block producer's numbers become words.
//
// ⭐⭐ §9.6 LIVES HERE, AND IT LIVES HERE STRUCTURALLY. "A share is never
// rendered without the window it was measured over" is not a rule a card can be
// trusted to keep line by line — somebody adds a compact row, drops the
// denominator to make it fit, and the surface now says a producer takes 56% of
// something the reader has to guess at. So there is NO FUNCTION IN THIS MODULE
// THAT RETURNS A BARE PERCENTAGE. Every formatter below takes its window as an
// argument and puts that window in its own output, and the argument it takes is
// the whole standing rather than a numerator — so a caller cannot even reach a
// share without already holding the thing it is a share of. A surface wanting
// the percentage alone would have to build the string itself, which is a
// deliberate act rather than an omission.
//
// ⭐ AND THE OTHER HALF: nothing here can say a peer mines. `peerCandidacyText`
// is the only sentence a named node's card may carry, it is a question, and it
// carries the size of the set the question is asked over. A candidacy that
// somehow arrived narrowed to one is refused rather than printed — §9.3 asks
// that a set of size one never render a tie, and the cheapest way to hold that
// is for the formatter to have no output for it.
//
// ⭐⭐ AND THE WORD IS COHORT, NOT MINER, WHICH IS A CORRECTION AND NOT A
// RENAME. Everything here counts payout lock hashes, and a payout lock hash is
// a DESTINATION: one address pays every machine a pool runs, and §1.4 said so
// before a line of this was written — "one lock hash can pay for many
// machines". The surfaces then went ahead and said MINER anyway, which is a
// claim about a MACHINE, and it is a claim no evidence in this feature
// supports. A cohort is the set of machines one payout identity stands for; it
// may be one rig in somebody's garage and it may be a pool's whole fleet, and
// the honest reading is that we cannot tell which. Every sentence below is
// written to survive both.
//
// ⭐⭐ AND THERE ARE NOW TWO WINDOWS, WHICH IS WHY THE RULE ABOVE HAD TO GROW A
// SECOND ARGUMENT RATHER THAN A SECOND HABIT. The 240-block window is RECENCY
// and the indexer's week is SIZE; a share exists over each of them and the two
// are never averaged. The week's denominator does not ride on the standing —
// it is one number for the whole view (`BlockProducerView.ledgerWindow`), so a
// week formatter takes the WINDOW OBJECT beside the standing and there is
// still no call site at which a numerator arrives without the thing it is a
// fraction of. Two arguments, one rule: `producerWeekText(standing, window)`
// cannot be reached with only half of a share.
//
// ⚠️ ENGLISH ONLY, here and on every surface these strings reach. The hand-cut
// CJK face carries about twenty-one glyphs and a new one costs a `pyftsubset`
// re-subset of the woff2.
//
// Words only. Nothing here renders, and nothing here touches three.js.

import {
  PRODUCER_FAN_MIN_CANDIDATES,
  type BlockProducerView,
  type PeerMiningCandidacy,
  type ProducerFan,
  type ProducerFanWithheld,
  type ProducerLedgerWindow,
  type ProducerStanding,
} from '../../derives/blockProducers.derive';
import { formatHashRate } from '../../derives/networkHashRate.derive';
import { formatBlockRef, formatCkb } from './cellFormat';

/** The unit every window count is printed in. One spelling, because the card
 *  and PEER·02 print the same number in two different sentences and a reader
 *  has to be able to see that it is the same number. Not exported: nothing
 *  outside this module may assemble a window count of its own. */
const WINDOW_UNIT = 'BLK';

/** The unit the OTHER window is counted in, under the same rule and for the
 *  same reason: PEER·02 and the card both name the indexer's week, and a
 *  reader has to be able to see that `7D` on the panel and the dates in the
 *  card's title are one window. Not exported either — a surface that wanted to
 *  say "seven days" of its own would be inventing a second window nothing
 *  measured. */
const WEEK_UNIT = 'D';

/** Grouped, with the locale pinned, exactly as every other count in the HUD is
 *  written. The 240-block window never reaches four digits so `producerShareText`
 *  below has never needed this; the week's counts are five figures on the first
 *  frame. */
const fmt = (n: number) => n.toLocaleString('en-US');

/** The house mark for a fact that is not there. Same one `SightedNodeCard`
 *  prints for a version the crawler never got. */
export const PRODUCER_NO_VALUE = '—';

/** A share as a percentage, and never on its own — this is private on purpose.
 *
 *  ⚠️ A share can be genuinely smaller than the rounding: at a 240-block window
 *  a producer holding one block is 0.42%, and `0%` would say it took none of
 *  them while its own row says it took one. `<1%` is the true reading of a
 *  share that is present and below the precision printed beside it. */
function percentOfWindow(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

/**
 * One producer's standing: `113 / 240 BLK · 47%`.
 *
 * The numerator, the window and the share in one string, in that order — the
 * fraction first because it is the measurement and the percentage is a reading
 * OF it. It takes the standing rather than three numbers so there is no call
 * site at which the share can arrive without the window it was divided by;
 * `ProducerStanding` carries both on one object for the same reason.
 */
export function producerShareText(standing: ProducerStanding): string {
  return `${standing.blocks} / ${standing.windowBlocks} ${WINDOW_UNIT}`
    + ` · ${percentOfWindow(standing.share)}`;
}

/**
 * The same standing over the OTHER window: `41,824 / 67,800 BLK · 62%`.
 *
 * ⭐ THE UNIT IS STILL `BLK`, AND THE DAYS ARE NOT IN IT. What the indexer
 * counted is blocks; seven days is the SHAPE of the window it counted them
 * over, which the card prints in this row's title and PEER·02 prints beside
 * its own count. A value that said `41,824 / 67,800 D` would be stating a
 * number of days that does not exist, and one that said `62% OF 7D` would be
 * a share of a duration.
 *
 * ⚠️ THE DENOMINATOR COMES FROM THE WINDOW ARGUMENT AND NEVER FROM THE
 * STANDING, because the standing does not have one: `ProducerLedgerStanding`
 * carries `blocks` and `share` and the total is one figure for the whole view.
 * Reconstructing it as `blocks / share` would be dividing the week back out of
 * its own rounding, and the two callers would disagree in the last digit.
 *
 * `PRODUCER_NO_VALUE` when this producer is not in the week (new, or under the
 * row cap) and when there is no week at all — the caller cannot tell those
 * apart from here and must not: a surface that wants to say WHY the week is
 * silent has the window object in its hand.
 */
export function producerWeekText(
  standing: ProducerStanding,
  window: ProducerLedgerWindow | null,
): string {
  const week = standing.ledger;
  if (week === null || window === null) return PRODUCER_NO_VALUE;
  return `${fmt(week.blocks)} / ${fmt(window.totalBlocks)} ${WINDOW_UNIT}`
    + ` · ${percentOfWindow(week.share)}`;
}

/**
 * What this cohort's share of the blocks implies about the machines behind it:
 * `≈ 52.29 PH/s`.
 *
 * ⭐⭐ THE `≈` IS LOAD-BEARING AND IT IS THE FIRST CHARACTER FOR THAT REASON.
 * Nothing here measured a machine. The network's own rate is difficulty over
 * realized cadence — an estimate of a Poisson process from sixty samples — and
 * this cohort's slice of it is a share of blocks it happened to win. A pool
 * that ran twice as hard for half the week lands in exactly the same place.
 * The row is a scale, not a reading, and the mark says so before the number
 * does.
 *
 * The share is the WEEK's when the week names this producer and the 240-block
 * window's otherwise, which is the same precedence `ranked` follows: whichever
 * window this view is a reading of. Both are printed in full on the card
 * above this row, so the reader can see which one is doing the work.
 *
 * `PRODUCER_NO_VALUE` when the chain has not said enough to have a rate at all
 * (a boot with no cadence yet), and when the share is zero — a producer the
 * week knows and the window does not would otherwise print `0 H/s`, which says
 * its machines have stopped rather than that we counted none of its blocks
 * lately.
 */
export function producerHashRateText(
  standing: ProducerStanding,
  networkHashRateHs: number | null,
): string {
  if (networkHashRateHs === null || !Number.isFinite(networkHashRateHs)) {
    return PRODUCER_NO_VALUE;
  }
  const share = standing.ledger?.share ?? standing.share;
  if (!(share > 0)) return PRODUCER_NO_VALUE;
  return `≈ ${formatHashRate(share * networkHashRateHs)}`;
}

/**
 * What the payout address is holding: `98.3 M·CKB`.
 *
 * ⚠️⚠️ THROUGH `BigInt`, ALWAYS. The live top cohort's address held
 * 9,829,812,162,369,360 shannons on 2026-09-02 — above
 * `Number.MAX_SAFE_INTEGER`, and the danger is that `Number()` on it returns a
 * figure that LOOKS right: the value is even, so it round-trips through a
 * double exactly, and the loss only appears once something does arithmetic. It
 * rides as a decimal string from the wire to here and the string is what
 * `BigInt` is handed.
 *
 * `formatCkb` is the house's one CKB grammar and this spends it unchanged, so
 * a cohort's balance and a Cell's capacity are the same unit at two
 * magnitudes. That grammar drops a trailing zero — the live figure prints
 * `98.3 M·CKB`, not `98.30` — which is the price of there being one grammar.
 *
 * The catch is `formatExactCkb`'s: this is the last surface before a reader,
 * and a record that reached it through some path `producerLedgerIsCoherent`
 * did not screen must print "not there" rather than take the card down.
 */
export function producerHarvestText(standing: ProducerStanding): string {
  const balance = standing.ledger?.balanceShannons ?? null;
  if (balance === null) return PRODUCER_NO_VALUE;
  try {
    return formatCkb(BigInt(balance));
  } catch {
    return PRODUCER_NO_VALUE;
  }
}

/**
 * What that address is, beyond its balance: `155,450 LIVE CELLS · 4,094,449 TXS`.
 *
 * ⭐ IT IS A CAPTION AND NOT A VALUE because these two are what the balance is
 * a balance OF — the live cells are the state the address is actually holding
 * (each of them somewhere in the canopy this scene draws), and the transaction
 * count is how often it has moved. A row of its own would rank them beside the
 * harvest; underneath it, they read as its composition.
 *
 * `null` rather than a dash when neither is there: the caption is a sentence
 * about a lookup, and an empty one is a sentence with nothing in it.
 */
export function producerHarvestCaption(standing: ProducerStanding): string | null {
  const week = standing.ledger;
  if (week === null) return null;
  const parts: string[] = [];
  if (week.liveCells !== null) parts.push(`${fmt(week.liveCells)} LIVE CELLS`);
  if (week.txCount !== null) parts.push(`${fmt(week.txCount)} TXS`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The one cellbase payout this refresh happened to sample, and where it read
 * it: `559.81 CKB · #20,337,476`.
 *
 * ⚠️ `null` RATHER THAN A DASH, AND THE DISTINCTION IS THE WHOLE ROW. A
 * refresh samples ONE block, so at most one producer in a view carries this;
 * absence means "this refresh did not sample this cohort" and never "this
 * cohort was not paid". A dash on the other fifteen cards would be fifteen
 * surfaces reporting an empty lookup that was never made — the same thing this
 * dialect refuses when it prints no country rather than `Unknown`.
 *
 * Both fields or neither: the amount without its height is a payout at no
 * particular time, which is not a fact about the chain.
 */
export function producerLastPaidText(standing: ProducerStanding): string | null {
  const week = standing.ledger;
  if (week === null) return null;
  const { lastRewardShannons, lastRewardBlock } = week;
  if (lastRewardShannons === null || lastRewardBlock === null) return null;
  try {
    return `${formatCkb(BigInt(lastRewardShannons))} · ${formatBlockRef(lastRewardBlock)}`;
  } catch {
    return null;
  }
}

/**
 * PEER·02's one row: `6 · TOP 47% · 240 BLK`.
 *
 * The count of distinct payout identities, the largest share in the window, and
 * the window. The share is read off the leading STANDING rather than off the
 * view, so the percentage and the `BLK` beside it come from the same object and
 * cannot be assembled from two different windows.
 *
 * ⭐ `TOP` IS THE ONE THING HERE THAT NEEDS AN ORDER, so it reads `ranked` and
 * says so. `staging` holds the same standings sequenced by key — a colony
 * cache key may not be ordered by a number a block moves — and its first
 * element is merely the lowest key, which would print a share belonging to
 * whoever happened to sort first. A reader would have no way to tell.
 *
 * An empty window prints `0 · 0 BLK` rather than disappearing — a fresh boot, a
 * devnet nobody has mined and the first block after a reorg all look like this,
 * and a row that vanished on zero would make them indistinguishable from a
 * dashboard that has stopped reporting producers at all. There is no `TOP` in
 * that sentence because there is no producer to take a share.
 */
function fleetWindowText(view: BlockProducerView): string {
  // ⚠️⚠️ THE WINDOW'S COUNT IS THE STANDINGS THE WINDOW HOLDS, and that stopped
  // being the whole set the moment the set became a UNION. A standing may now
  // exist with `blocks 0` — a cohort the indexer's week names and the last 240
  // blocks do not — and counting it here would report a cohort in a window
  // that has never seen it, which is precisely the claim this row is not
  // allowed to make about the machine it is running on.
  //
  // ⚠️ AND THE LEADER IS FOUND RATHER THAN TAKEN OFF THE FRONT, for the same
  // reason: `ranked` is sequenced by the WEEK's blocks whenever a week exists,
  // so its head is the week's leader and may hold none of this window at all.
  // Without a week the two are the same array in the same order and this walk
  // returns exactly what reading `ranked[0]` returned — which is what keeps
  // every string this row has ever printed byte-identical.
  const inWindow = view.ranked.filter((standing) => standing.blocks > 0);
  const top = inWindow.reduce<ProducerStanding | undefined>(
    (best, standing) => (best === undefined
      || standing.blocks > best.blocks
      || (standing.blocks === best.blocks && standing.key < best.key)
      ? standing
      : best),
    undefined,
  );
  if (top === undefined) {
    return `${inWindow.length} · ${view.windowBlocks} ${WINDOW_UNIT}`;
  }
  return `${inWindow.length} · TOP ${percentOfWindow(top.share)}`
    + ` · ${top.windowBlocks} ${WINDOW_UNIT}`;
}

/**
 * The same row read off the indexer's week instead: `7 · TOP 62% · 7D`.
 *
 * ⭐⭐ THIS IS THE ROW THAT STOPS COLLAPSING, which is the whole reason the
 * week exists. The 240-block window is emptied by every reorg and by every
 * rebuild, and fifty-six seconds after a boot it honestly said `2 · TOP 60% ·
 * 5 BLK` — two cohorts, because two of them had landed the five blocks this
 * node had seen. The week names seven from the first frame and keeps naming
 * them through a fork that closed after it did.
 *
 * ⚠️ `TOP` IS THE WEEK'S SHARE, not the window's, and `ranked` is already
 * sequenced by the week's blocks whenever a week exists — so the head of that
 * array and the percentage taken off it are readings of one window by
 * construction rather than by this function remembering to agree.
 *
 * `null` — and the window row prints instead — in the one shape where a week
 * exists and names nobody: a coherent ledger with no rows at all, whose
 * leading standing therefore carries no week share to print. The row then says
 * what the local node can see for itself, which is the true smaller statement.
 */
function fleetWeekText(view: BlockProducerView): string | null {
  const window = view.ledgerWindow;
  if (window === null) return null;
  const top = view.ranked[0];
  if (top?.ledger == null) return null;
  return `${view.ranked.length} · TOP ${percentOfWindow(top.ledger.share)}`
    + ` · ${window.days}${WEEK_UNIT}`;
}

export function producerFleetText(view: BlockProducerView): string {
  return fleetWeekText(view) ?? fleetWindowText(view);
}

/** The sentence under PEER·02's cohort row, on hover.
 *
 *  ⭐ THE WINDOW THAT IS NOT IN THE ROW GOES HERE, WHOLE. One row can hold one
 *  window, and when the week is present it takes the row — so the 240 blocks
 *  the local node read for itself would simply vanish, and with them the only
 *  figure on this panel that nothing but this machine vouches for. The title
 *  is where it goes: the same string the row prints without a week, named as
 *  the local reading it is.
 *
 *  ⚠️ IT IS ASSEMBLED HERE AND NOT IN THE PANEL. The title carries a
 *  percentage, and a percentage assembled in a component is exactly the thing
 *  the header of this file exists to prevent — the row would be one edit away
 *  from a hover sentence stating a share of a window it never named. */
export function producerFleetTitle(view: BlockProducerView): string {
  const window = view.ledgerWindow;
  const cohorts = 'One payout address may pay many machines,'
    + ' so this counts cohorts and never miners.';
  if (window === null || fleetWeekText(view) === null) {
    return 'Distinct payout identities in the recent block window, read from'
      + ` each block's cellbase witness. ${cohorts}`;
  }
  return `Distinct payout identities over ${window.days} complete days`
    + ` (${window.fromDate} to ${window.toDate}), counted by the indexer across`
    + ` ${fmt(window.totalBlocks)} ${WINDOW_UNIT}. The recent block window this`
    + ` node read for itself says ${fleetWindowText(view)}, from each block's`
    + ` cellbase witness. ${cohorts}`;
}

/**
 * The stamp a PEER or SIGHTED card may carry, and the only mining sentence
 * either of them is allowed: `IN A MINING COHORT? · 1 OF 6 ON THIS BUILD`.
 *
 * ⭐ THE QUESTION MARK AND THE DENOMINATOR ARE THE WHOLE POINT. The join behind
 * this is two self-declared strings meeting; it narrows a set and never names a
 * member, so the card asks rather than states, and it says how large the set is
 * in the same breath. `1 OF 6` is not "this peer is one sixth of a cohort" — it
 * is "this peer is one of six machines, any number of which may belong to it".
 *
 * ⭐⭐ AND THE PREPOSITION IS THE CORRECTION. `MINER?` asked whether this peer
 * IS the thing that made the blocks; a cohort is a SET of machines behind one
 * payout identity, and a peer is never a set. What can honestly be asked is
 * whether this peer stands INSIDE one — which is also the only relation the fan
 * could ever support, since the join narrows membership and never identity.
 *
 * `null` for a set of one. `candidacyByPeer` is built only from fans that
 * passed `PRODUCER_FAN_MIN_CANDIDATES`, so this cannot happen from the derive;
 * refusing it here is what makes §9.3 a property of the sentence rather than of
 * the caller that happens to build it today.
 */
export function peerCandidacyText(candidacy: PeerMiningCandidacy): string | null {
  if (!Number.isFinite(candidacy.oneOf)) return null;
  if (candidacy.oneOf < PRODUCER_FAN_MIN_CANDIDATES) return null;
  return `IN A MINING COHORT? · 1 OF ${candidacy.oneOf} ON THIS BUILD`;
}

/**
 * Why no candidate set came out of the join — seven reasons, seven different
 * true sentences.
 *
 * ⭐ THEY MUST NOT BE BLURRED INTO ONE. "We hold no builds to compare against",
 * "nobody we hold a build for runs this one" and "this is the build they all
 * run" are three different states of the world that all render as no fan, and a
 * card that said "no candidates" to all three would be doing what `SightedNode`
 * refuses when it will not print "Unknown" for a field that is not there: a
 * lookup that came back empty is a different statement from a lookup that was
 * never made.
 *
 * None of them carries a number. The numbers live in the fraction beside them
 * (`producerBuildShareText`), which is the only place a denominator is printed
 * and the only place one is named.
 */
export const PRODUCER_FAN_WITHHELD_TEXT: Readonly<Record<ProducerFanWithheld, string>> = {
  no_declaration: 'THIS COHORT WROTE NO BUILD INTO ITS BLOCKS',
  roster_absent: 'NO CRAWLER ROSTER HERE TO COMPARE AGAINST',
  roster_unversioned: 'THE ROSTER NAMES PEERS AND HOLDS A BUILD FOR NONE',
  no_match: 'NO PEER WE HOLD A BUILD FOR IS RUNNING THIS ONE',
  singular: 'A SET OF ONE IS A NAME, NOT A NARROWING',
  modal: 'THIS IS THE BUILD ALMOST EVERY PEER WE SEE RUNS',
  crowd: 'TOO MANY PEERS RUN IT FOR THE SET TO BE EVIDENCE',
};

/** The withheld reasons a fraction can honestly stand beside.
 *
 *  ⚠️ `no_declaration` IS THE ONE WORTH READING TWICE. It is the only reason
 *  here that has a perfectly good denominator and still may not print one: the
 *  roster is versioned, `matched` is zero, and `0 OF 42` would say we asked
 *  forty-two peers and none of them matched. The miner declared nothing, so the
 *  join never ran, and "nobody matched" is a different sentence from "there was
 *  nothing to match against" — the same distinction `SightedNodeCard` keeps
 *  when it refuses to print `Unknown` for a field that is not there.
 *
 *  The other two absentees, `roster_absent` and `roster_unversioned`, have no
 *  denominator at all and are refused a second time by the zero check below. */
const REASONS_CARRYING_A_COUNT: ReadonlySet<ProducerFanWithheld> = new Set([
  'no_match', 'singular', 'modal', 'crowd',
]);

/**
 * How many peers run the build this producer declared, out of the peers we hold
 * a build for: `6 OF 57`.
 *
 * ⚠️⚠️ THE DENOMINATOR IS `versionedRosterSize`, AND IT IS NOT THE CRAWLER'S
 * KNOWN SET. The two are different populations and the draft of this feature had
 * them in one fraction. `versionedRosterSize` counts roster rows carrying a
 * usable build string — which is exactly the population the numerator is drawn
 * from, and exactly the denominator the modal gate divided by to decide the
 * verdict printed next to it. The crawler's wider figure (`indexed_peers`, or a
 * whole roster with its unreached rows in it) counts peers we hold no build for,
 * so `matched` over that would be a fraction whose top and bottom are counts of
 * different things — and a reader who worked out the percentage would get a
 * number that contradicts the reason on the same line.
 *
 * The card names it right underneath rather than assuming anybody can infer it.
 *
 * `null` when there is no fraction to print — see `REASONS_CARRYING_A_COUNT`.
 */
export function producerBuildShareText(
  fan: ProducerFan,
  versionedRosterSize: number,
): string | null {
  // No denominator, no fraction, whichever branch asked. `x OF 0` is not a
  // smaller true statement than the one below it; it is a false one.
  if (versionedRosterSize <= 0) return null;
  if (fan.drawn) return `${fan.candidates.length} OF ${versionedRosterSize}`;
  if (!REASONS_CARRYING_A_COUNT.has(fan.reason)) return null;
  return `${fan.matched} OF ${versionedRosterSize}`;
}

/** What that denominator counts, in words, carried wherever the fraction is.
 *  It is one sentence rather than a longer value string because the value
 *  column of a readout row is a measure, and this is what the measure is OF.
 *
 *  ⭐ IT IS HOVER COPY NOW RATHER THAN A LINE ON THE CARD. The cohort card
 *  printed it under the fraction and printed nine more sentences like it under
 *  its other rows, which is a paragraph between a reader and the next number;
 *  it is the row's `title` instead, unchanged word for word. Naming the
 *  population is still not optional — a fraction whose bottom half is unnamed
 *  gets the wrong bottom half supplied by whoever reads it — it is one reach
 *  away rather than a line everybody pays for. */
export const PRODUCER_BUILD_DENOMINATOR_CAPTION = 'PEERS THE CRAWLER HOLDS A BUILD FOR';

/** What a drawn fan is claiming, said out loud.
 *
 *  ⭐ `INCLUDE` RATHER THAN `BE`, AND THAT IS THE WHOLE CORRECTION. The old
 *  sentence — "the machine may be any of them" — asked a reader to pick one
 *  line out of the fan and it offered a set of one as the answer. A cohort is a
 *  SET, so it may contain several of them at once, and on the live shape that
 *  is what the evidence actually looks like: the dominant cohort's rare build
 *  narrows to six peers spread two apiece across three ASNs in three countries,
 *  which is a relay fleet and not a machine. `INCLUDE` says the true thing and
 *  the more informative one in the same breath.
 *
 *  `OR NONE` stays, and it is not hedging: a pool assembler behind private
 *  relays advertises nothing, so a cohort whose every candidate is wrong is an
 *  ordinary outcome rather than a failure. */
export const PRODUCER_FAN_DRAWN_CAPTION = 'THE COHORT MAY INCLUDE ANY OF THEM, OR NONE';

/** Why the word on every one of these surfaces is COHORT. The cohort card
 *  carries it in the KEY row's hover, which is also where the row's probe hook
 *  now holds it for a live read.
 *
 *  ⭐⭐ IT IS THE ONE FACT THAT MAKES THE VOCABULARY NECESSARY, so it is
 *  written down rather than assumed. Everything this feature measures is keyed
 *  on a payout lock hash, and a payout lock hash names where the reward GOES —
 *  one address can pay a whole fleet, and two addresses can belong to one
 *  operator. A card that said MINER would be claiming a machine off evidence
 *  that only ever named a destination.
 *
 *  It is also the honest form of the double-count the footer discloses: if one
 *  of a cohort's machines is a peer already on stage, the colony draws that
 *  machine twice, and it does so precisely BECAUSE a cohort is a set we cannot
 *  enumerate. */
export const COHORT_PAYOUT_CAPTION =
  'ONE HASH MAY PAY MANY MACHINES · WHICH IS WHY THIS IS A COHORT';
