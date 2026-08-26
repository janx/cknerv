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
  type ProducerStanding,
} from '../../derives/blockProducers.derive';

/** The unit every window count is printed in. One spelling, because the card
 *  and MESH·02 print the same number in two different sentences and a reader
 *  has to be able to see that it is the same number. Not exported: nothing
 *  outside this module may assemble a window count of its own. */
const WINDOW_UNIT = 'BLK';

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
 * MESH·02's one row: `6 · TOP 47% · 240 BLK`.
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
export function producerFleetText(view: BlockProducerView): string {
  const top = view.ranked[0];
  const count = view.ranked.length;
  if (top === undefined) {
    return `${count} · ${view.windowBlocks} ${WINDOW_UNIT}`;
  }
  return `${count} · TOP ${percentOfWindow(top.share)}`
    + ` · ${top.windowBlocks} ${WINDOW_UNIT}`;
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

/** What that denominator counts, in words, printed wherever the fraction is.
 *  It is one caption rather than a longer value string because the value column
 *  of a readout row is a measure, and this is what the measure is OF. */
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

/** Why the word on every one of these surfaces is COHORT.
 *
 *  ⭐⭐ IT IS THE ONE FACT THAT MAKES THE VOCABULARY NECESSARY, so it is
 *  printed rather than assumed. Everything this feature measures is keyed on a
 *  payout lock hash, and a payout lock hash names where the reward GOES — one
 *  address can pay a whole fleet, and two addresses can belong to one operator.
 *  A card that said MINER would be claiming a machine off evidence that only
 *  ever named a destination.
 *
 *  It is also the honest form of the double-count the footer discloses: if one
 *  of a cohort's machines is a peer already on stage, the colony draws that
 *  machine twice, and it does so precisely BECAUSE a cohort is a set we cannot
 *  enumerate. */
export const COHORT_PAYOUT_CAPTION =
  'ONE HASH MAY PAY MANY MACHINES · WHICH IS WHY THIS IS A COHORT';
