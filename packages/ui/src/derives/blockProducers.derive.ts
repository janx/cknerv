// packages/ui/src/derives/blockProducers.derive.ts
// Pure producer/candidate logic for the block producers that stand inside the
// peer colony. No React, no three.js — unit-tested directly.
//
// Two questions live here, and the whole file exists to keep them apart:
//
//   WHO MADE THESE BLOCKS is measured. It comes off the cellbase witness of
//   every block cknerv fetched, and it arrives as a tally with its denominator
//   already attached. Nothing below may weaken it.
//
//   WHICH CRAWLED PEER IS THAT MACHINE is not measured, and on this evidence
//   it is not knowable. All this file can do is NARROW it, by joining one
//   self-declared string — what a miner wrote into its own block — against
//   another — what a peer told the crawler it was running. Neither side of
//   that join is an observation of a machine, so the answer is a SET, and the
//   rules below exist to stop a set from being read as a name.
//
// The scene draws the second question only when narrowing it teaches
// something. `PRODUCER_FAN_*` below are the three ways it can teach nothing,
// and each one names a different sentence a card has to be able to say.
//
// ⭐ THE FIRST QUESTION IS ASKED OVER TWO WINDOWS AND THEY ARE NOT THE SAME
// FACT. `ChainEntry.producers` is RECENCY: the last 240 attributed blocks
// cknerv itself fetched, emptied by every reorg and by every rebuild, and
// empty for the first minute of a boot. `ProducerLedger` is SIZE: seven
// complete days as the indexer counted them, warm from the first frame, and
// untouched by a reorg that closed after those days did. A standing may exist
// in either, and the set below is their UNION, because a producer that took a
// tenth of the week and has not landed a block in the last half hour is still
// a producer — it was only ever missing because of which window we asked.
// Every share still states the window it was divided by; the two are carried
// on separate fields precisely so no reader can average them.

import type {
  BlockProducer, ChainEntry, NetworkRosterRecord, ProducerLedger,
  ProducerLedgerRow, RosterNode,
} from '@cknerv/types';

/** Fewer candidates than this and the fan is not drawn.
 *
 *  A join that narrows to exactly one peer is the dangerous case, not the good
 *  one: it stops being "the machine is somewhere in here" and becomes a name,
 *  drawn out of two strings neither of which was measured. There is no
 *  rendering of a one-element set that reads as uncertain, so the set is not
 *  handed to the renderer at all — see `ProducerFan`, whose withheld branch
 *  carries a count and no identities. */
export const PRODUCER_FAN_MIN_CANDIDATES = 2;

/** More candidates than this and the fan is not drawn.
 *
 *  A legibility bound: twenty lines leaving one node is a haze, not evidence.
 *
 *  ⭐ It is dormant at the roster size cknerv sees today and still earns its
 *  place. While a quarter of the versioned rows is fewer peers than this, the
 *  modal gate below is always the one that fires and this ceiling never gets a
 *  vote. It takes the vote back in two regimes: a roster large enough that a
 *  quarter of it is hundreds of lines; and a roster whose version column has
 *  been INFLATED, which is the one cheap way to buy a fan you should not have.
 *  Distinct made-up versions push `versionedRosterSize` up, which drags every
 *  real build's share of it down under the modal gate — and lands the unlocked
 *  fan on this ceiling instead. Two gates over two different denominators, and
 *  an attack on one is not an attack on the other. */
export const PRODUCER_FAN_MAX_CANDIDATES = 8;

/** At or above this share of the versioned roster, the fan is not drawn.
 *
 *  The modal-release gate, and the live one. Most mainnet producers run the
 *  release everybody else runs; "your machine is one of the peers on the stock
 *  build" narrows nothing and would draw a fan across most of the colony while
 *  claiming to have found something. The producer worth drawing is the one
 *  running a build almost nobody else does.
 *
 *  ⚠️ The denominator is the versioned rows of THIS roster record, which is a
 *  bounded and possibly truncated sample of what the crawler knows, cut along
 *  recency — and recency correlates with carrying a version at all, since only
 *  a node the crawler reached has one. So this ratio is a statement about the
 *  builds we can currently see, not about the network. That is the right
 *  question for this gate (is this build modal AMONG WHAT WE CAN SEE) and the
 *  wrong number to print on a card as "N of the network". */
export const PRODUCER_FAN_MAX_SHARE_OF_VERSIONED = 0.25;

/** A roster version shorter than this is not treated as a version at all.
 *
 *  The join is `message.includes(version)`, so a short version string stops
 *  being a fingerprint and becomes a coincidence: a row advertising `n` is
 *  contained in half the messages ever written, and a row advertising the
 *  empty string is contained in ALL of them (`''.includes` is vacuously true,
 *  which would silently make every unversioned peer a candidate for every
 *  producer). No released CKB version has ever been shorter than this — the
 *  shortest shape the scheme can even express, `0.0.0`, already reaches it —
 *  so nothing real is refused.
 *
 *  ⭐ A refused row leaves BOTH sides of the modal gate, numerator and
 *  denominator, and that direction is deliberate. Counting it in the
 *  denominator only would let a fleet of nodes advertising junk versions
 *  inflate `versionedRosterSize` until a modal build slipped under the
 *  quarter — buying a fan rather than merely failing to earn one. */
export const PRODUCER_VERSION_MIN_CHARS = 5;

/** Why a producer's candidate fan is not drawn.
 *
 *  ⭐ THE REASON IS THE POINT, and a boolean could not carry it. §7.2's card
 *  has to be able to say "the crawler holds no builds to compare against"
 *  where it means that, "nobody we crawled runs this build" where it means
 *  that, and "this is the build everybody runs" where it means that — three
 *  different facts that all render as no fan.
 *
 *  Precedence, when more than one holds, is the order below. The producer's
 *  own silence comes first because it is a fact about THIS producer that no
 *  crawl could change, while the two roster reasons are facts about us and are
 *  the same sentence for every producer at once. After that: what we hold,
 *  then what the join found, then what the find is worth, then whether it
 *  would fit on screen. That last step is why `'modal'` sits ahead of
 *  `'crowd'` — the stock release fails both, and "this is the build everybody
 *  runs" is the reason while "too many lines" is a consequence of it. */
export type ProducerFanWithheld =
  /** The producer declared nothing readable. The miner did not say. */
  | 'no_declaration'
  /** No roster at all: no crawler, or a crawler that finished a round knowing
   *  nobody. We did not look. */
  | 'roster_absent'
  /** A roster with rows in it and not one usable version among them — every
   *  row is a node the crawler never reached, or never got a build string out
   *  of. We looked and hold nothing to compare against. */
  | 'roster_unversioned'
  /** The producer declared something and no versioned row is inside it.
   *  Distinct from every reason above: this is the crawler and the miner both
   *  answering, and the answers not meeting. */
  | 'no_match'
  /** Exactly one peer runs the declared build — see
   *  `PRODUCER_FAN_MIN_CANDIDATES`. */
  | 'singular'
  /** The declared build is (near enough) the modal one — see
   *  `PRODUCER_FAN_MAX_SHARE_OF_VERSIONED`. */
  | 'modal'
  /** Too many peers run it to draw — see `PRODUCER_FAN_MAX_CANDIDATES`. */
  | 'crowd';

/** The verdict on one producer's candidate join.
 *
 *  ⭐ THE ASYMMETRY IS STRUCTURAL. The drawn branch carries roster rows; the
 *  withheld branch carries a COUNT and no identities whatsoever. A consumer
 *  that disagrees with a gate cannot quietly draw the fan anyway, because the
 *  nodes it would need are not in the value it was handed — which is what
 *  makes "a candidate set of size one never renders a tie" a property of the
 *  type rather than of a test somebody remembered to write.
 *
 *  A count is still enough for the card: "most of the peers we hold a build
 *  for run this one" is the honest reading of a withheld modal fan, and
 *  `matched` beside `versionedRosterSize` says it in numbers while naming
 *  nobody. */
export type ProducerFan =
  | {
    readonly drawn: true;
    /** The roster version string found inside the message. */
    readonly matchedVersion: string;
    /** The peers running it. Length is in `[PRODUCER_FAN_MIN_CANDIDATES,
     *  PRODUCER_FAN_MAX_CANDIDATES]` by construction, ordered by `node_id`. */
    readonly candidates: readonly RosterNode[];
    /** `candidates.length / versionedRosterSize`. */
    readonly shareOfVersioned: number;
  }
  | {
    readonly drawn: false;
    readonly reason: ProducerFanWithheld;
    /** The version the join landed on, or `null` when it landed on none. */
    readonly matchedVersion: string | null;
    /** How many versioned roster rows carried it. A number, never the rows. */
    readonly matched: number;
    readonly shareOfVersioned: number;
  };

/** What the indexer's week says about one producer, and where its reward
 *  lands.
 *
 *  ⭐ EVERY NULL HERE IS AN ABSENCE, NEVER A ZERO. `blocks` and `share` come
 *  off one request that answered for the whole week; everything below them
 *  comes from a per-address request made afterwards, one per row, that can
 *  fail on its own (`ProducerLedgerRow` says the same thing on the wire, where
 *  the keys are simply missing). A card that printed `0 CKB` over a balance
 *  nobody read would be stating something the source did not, so the wire's
 *  absence is carried through as `null` rather than defaulted — and a reader
 *  that wants a number has to say what it means by having none.
 *
 *  `balanceShannons` and `lastRewardShannons` stay DECIMAL STRINGS all the way
 *  to the formatter: the live top miner held 9,820,183,392,640,200 shannons on
 *  2026-09-02, above `Number.MAX_SAFE_INTEGER`, and `Number()` on it returns a
 *  figure that looks right and is not. `producerLedgerIsCoherent` refuses a
 *  record whose strings are not digits, so `BigInt` on either is total. */
export interface ProducerLedgerStanding {
  /** Blocks this producer took in the ledger's window — a numerator whose
   *  denominator is `BlockProducerView.ledgerWindow.totalBlocks`, never
   *  `windowBlocks`, which counts the other window entirely. */
  readonly blocks: number;
  /** `blocks / ledgerWindow.totalBlocks`, in [0,1]. Safe: the coherence check
   *  refuses a total of zero, because every share here is a fraction of it. */
  readonly share: number;
  /** The payout address the source resolved, `ckb1…`, or null when it
   *  resolved none. Never minted from the key: an address is a rendering of a
   *  script under a network prefix, and inventing one would be inventing an
   *  identity. */
  readonly address: string | null;
  readonly balanceShannons: string | null;
  readonly liveCells: number | null;
  readonly txCount: number | null;
  /** One sampled cellbase payout, and the block it was read from. The two are
   *  null together or present together — a refresh samples one block, so at
   *  most one producer in a view carries them, and null says "this refresh did
   *  not sample this producer", never "this producer was not paid". */
  readonly lastRewardShannons: string | null;
  readonly lastRewardBlock: number | null;
}

/** One producer the colony will stand a node for.
 *
 *  ⭐ THERE IS NOTHING IDENTIFYING IN HERE, and there is nowhere to put it:
 *  no `node_id`, no address, no country, no ASN, no client version. §9.1 asks
 *  that an attested node never carry those, and a shape with no field for them
 *  cannot be handed one by a later edit that means well. `key` is a payout
 *  identity — a lock script hash — which is the only identity the chain
 *  actually attests, and it is the one a card prints.
 *
 *  ⭐ `role` is the literal `'producer'`, and `PeerMiningCandidacy.role` is
 *  the literal `'candidate'`. THERE IS DELIBERATELY NO UNION OF THE TWO. A
 *  `type MiningRole = 'producer' | 'candidate'` would be the single hole
 *  through which a named peer could be widened into a producer by assignment;
 *  without it the two roles are unrelated types that share a field name and
 *  nothing else, and §9.2 is a compile error rather than a code review. */
export interface ProducerStanding {
  readonly role: 'producer';
  /** The producer's key exactly as the chain reported it. Group and count by
   *  it; never parse it. */
  readonly key: string;
  /** What this producer declared on its most recent block in the window,
   *  verbatim. Self-declared and trivially spoofable — a card renders it as a
   *  claim, and `bpool` is a word a miner typed, not a measurement. */
  readonly message: string;
  /** Blocks of the 240-block window this producer holds — a numerator.
   *
   *  ZERO IS A REAL READING HERE, and it is what a producer the ledger knows
   *  and the window does not looks like: it took blocks this week and none in
   *  the last 240. Absence is not expressible — a standing with no window
   *  reading still states the window it was measured against below. */
  readonly blocks: number;
  /** The window those blocks are a share OF. It rides on the same object as
   *  `blocks` and `share` so §9.6 costs a consumer nothing: there is no
   *  destructuring of the fraction that leaves the denominator behind. */
  readonly windowBlocks: number;
  /** `blocks / windowBlocks`, in [0,1]. Never `0/0`: a window row exists only
   *  while it holds at least one block, and the window identity then forces
   *  the denominator above zero — while a ledger-only standing is a plain 0,
   *  written rather than divided, since its numerator and the window's
   *  denominator can both be nothing at once. */
  readonly share: number;
  /** Envelope timestamp of this producer's most recent block in the window —
   *  or, for a producer only the ledger knows, the ledger's `fetched_at_ms`.
   *
   *  ⚠️ THE SECOND READING IS "AS OF THE LEDGER", NOT A BLOCK. It dates the
   *  answer and not the producer: the week says this identity was producing,
   *  and says nothing about when it last did. A surface printing it as "last
   *  block" would be inventing a block, so it reads it beside `blocks 0`,
   *  which is the standing saying it holds none of this window. */
  readonly lastSeenMs: number;
  /** Whether this producer's fan may be drawn, and if not, why not. */
  readonly fan: ProducerFan;
  /** What the indexer's week says about this producer, or null when the week
   *  does not name it — a producer inside the 240 blocks and outside the seven
   *  days (brand new, or too small to make the row cap), and every producer at
   *  all when there is no ledger. Null is the shape every build before the
   *  ledger existed had, which is what makes the fallback a type. */
  readonly ledger: ProducerLedgerStanding | null;
}

/** The only mining attribute a NAMED node may ever carry.
 *
 *  It says `one of N`, and it says it with the N attached. There is no variant
 *  of this type that asserts a peer mines — see `ProducerStanding.role` for
 *  why the two roles are not one union.
 *
 *  `oneOf` is at least `PRODUCER_FAN_MIN_CANDIDATES`, because this index is
 *  built only from fans that were drawn. */
export interface PeerMiningCandidacy {
  readonly role: 'candidate';
  /** How many crawled peers run this peer's build. ≥ 2 always. */
  readonly oneOf: number;
  /** The build string that put it in the set — its own reported version. */
  readonly version: string;
  /** The producers this peer is a candidate for, in staging order — which is
   *  key ascending, so it does not reshuffle when two miners swap rank.
   *  Usually one; more than one when two payout identities declared the same
   *  build, which is a fact about the fleet and not a stronger claim about the
   *  peer. */
  readonly producerKeys: readonly string[];
}

/** The ledger's window, stated once for the whole view.
 *
 *  ⭐ IT RIDES BESIDE THE STANDINGS FOR THE SAME REASON `windowBlocks` RIDES
 *  ON EVERY ONE OF THEM: `totalBlocks` is the denominator of every
 *  `ProducerLedgerStanding.share`, and a share that travels without its
 *  denominator is a number a surface can restate against the wrong window
 *  without noticing. The dates are carried verbatim, in the source's own
 *  calendar (UTC+8, the last COMPLETE day — never today), because they are
 *  what a card prints beside the share so a reader knows which week it is
 *  looking at. */
export interface ProducerLedgerWindow {
  readonly days: number;
  readonly fromDate: string;
  readonly toDate: string;
  /** Every attributed block in the week, and never `sum(rows.blocks)`, which
   *  is smaller whenever the row cap has cut a tail off. */
  readonly totalBlocks: number;
  /** When the ledger was fetched. Nothing ages the view against it — the
   *  window states its own days instead of a staleness verdict. */
  readonly fetchedAtMs: number;
  /** How far the source had indexed when it answered. Freshness, not content,
   *  and deliberately not an anchor. */
  readonly indexedTip: number;
}

/** Everything T5 (staging), T7 (render) and T8 (cards) need without asking the
 *  chain or the roster a second question.
 *
 *  ⭐⭐⭐ TWO ORDERS, AND THERE IS NO FIELD THAT IS BOTH. One decides GEOMETRY
 *  and one decides READING, they are ordered on different things, and a single
 *  array serving both is how a rank swap came to rebuild a colony. Two names
 *  is the cheapest way for a call site to be unable to reach one while meaning
 *  the other — the same move `producerReadout` makes when it refuses to return
 *  a bare percentage.
 *
 *  They are permutations of each other over the SAME standing objects, so a
 *  lookup BY KEY finds the identical object in either and it does not matter
 *  which one a `find` is asked of. Only the sequence differs, and the sequence
 *  is the whole of what one is for and none of what the other is for. */
export interface BlockProducerView {
  /** The 240-block window every `ProducerStanding.share` is measured over.
   *  The OTHER window is `ledgerWindow`, and nothing divides across the two. */
  readonly windowBlocks: number;
  /** The staging set, in the order the colony stands it up: KEY ASCENDING, a
   *  pure function of WHICH miners exist and of nothing a block moves. This is
   *  the array that may reach `inferredTopology` and any cache key over the
   *  geometry — see `deriveBlockProducers` for why it may read no tally. */
  readonly staging: readonly ProducerStanding[];
  /** The same standings in reading order: descending by the tally of
   *  WHICHEVER WINDOW THIS VIEW IS A READING OF — the ledger's blocks when a
   *  coherent ledger exists, the 240-block window's when it does not — then
   *  key ascending. This is what MESH·02's `TOP` and a share list are.
   *  ⚠️ Nothing the geometry follows may be ordered by it. */
  readonly ranked: readonly ProducerStanding[];
  /** Roster rows carrying a usable version — the modal gate's denominator,
   *  and the number a card needs beside a withheld fan's `matched`. */
  readonly versionedRosterSize: number;
  /** `node_id` → the stamp its PEER / SIGHTED card may carry. Built only from
   *  drawn fans, so a peer that appears here is never the only suspect. */
  readonly candidacyByPeer: ReadonlyMap<string, PeerMiningCandidacy>;
  /** The week these standings' `ledger` figures were counted over, or null
   *  when no ledger reached this view — no source declares the capability, its
   *  route answered 404, or the record it did send contradicted itself
   *  (`producerLedgerIsCoherent`). All three read the same way downstream, and
   *  the view is then byte-identical to what it was before ledgers existed. */
  readonly ledgerWindow: ProducerLedgerWindow | null;
}

/** The roster's version column, grouped, with the unusable rows already gone. */
interface RosterVersionIndex {
  /** version → the peers reporting it, ordered by `node_id`. */
  readonly byVersion: ReadonlyMap<string, readonly RosterNode[]>;
  /** Every key of `byVersion`, longest first and then in code-unit order, so
   *  the first hit of a scan is the longest match and ties never depend on the
   *  order the crawler happened to send. */
  readonly candidateVersions: readonly string[];
  /** How many distinct peers those versions came from. */
  readonly versionedRosterSize: number;
  /** Whether the record had any rows at all — an empty roster and a roster
   *  with no readable versions are different sentences on a card. */
  readonly rosterHasEntries: boolean;
}

/** Ascending by `node_id`, in code units. Deliberately not `localeCompare`:
 *  these are opaque base58 identifiers, not words, and a collation that varies
 *  with the host's locale would reorder a fan's arcs between two machines
 *  looking at the same crawl. */
function byNodeId(left: RosterNode, right: RosterNode): number {
  if (left.node_id === right.node_id) return 0;
  return left.node_id < right.node_id ? -1 : 1;
}

/** Group the roster by reported version, dropping what cannot be joined on.
 *
 *  A repeated `node_id` inside one record is taken once, on its first row —
 *  the same tolerance `stageSighted` extends for the same reason. Here a
 *  duplicate would be counted twice in the modal gate's denominator and once
 *  more in its numerator, and would stand two arcs on one node. */
function indexRosterVersions(
  roster: NetworkRosterRecord | null | undefined,
): RosterVersionIndex {
  const grouped = new Map<string, RosterNode[]>();
  const seen = new Set<string>();
  let versionedRosterSize = 0;
  for (const entry of roster?.entries ?? []) {
    if (seen.has(entry.node_id)) continue;
    seen.add(entry.node_id);
    const version = entry.version;
    // Measured on the trimmed string so a row of blanks cannot pass the floor,
    // but joined on the string as reported: the crawler's value is not this
    // file's to repair, and surrounding whitespace can then only cost a match
    // that would otherwise have been made, which is the safe direction.
    if (version === undefined || version.trim().length < PRODUCER_VERSION_MIN_CHARS) continue;
    versionedRosterSize += 1;
    const rows = grouped.get(version);
    if (rows) rows.push(entry);
    else grouped.set(version, [entry]);
  }
  for (const rows of grouped.values()) rows.sort(byNodeId);
  const candidateVersions = [...grouped.keys()].sort((left, right) => (
    right.length - left.length || (left < right ? -1 : left > right ? 1 : 0)
  ));
  return {
    byVersion: grouped,
    candidateVersions,
    versionedRosterSize,
    rosterHasEntries: (roster?.entries.length ?? 0) > 0,
  };
}

/** The longest indexed version contained in `message`, or `null`.
 *
 *  ⭐ LONGEST WINS, and it is doing more than breaking the tie between a
 *  release number and that same number with a commit and a date after it. A
 *  shorter string that is contained in a real version is contained in every
 *  message that carries that version, so without this rule any node could
 *  advertise a fragment of the release string and quietly join itself to every
 *  producer running it. The longest rule hands the join to the most specific
 *  claim on offer.
 *
 *  It does not make the join TRUE — both sides are self-declared, and a node
 *  advertising a version string longer than the release it is impersonating
 *  can still win. That is not fixable from here and is not pretended away:
 *  every gate below bounds the SHAPE of the resulting claim, never its
 *  honesty, and the card that prints it says SELF-DECLARED. */
function matchVersion(message: string, index: RosterVersionIndex): string | null {
  for (const version of index.candidateVersions) {
    if (message.includes(version)) return version;
  }
  return null;
}

/**
 * The fingerprint join: for each producer, the crawled peers whose reported
 * version appears inside that producer's declared message.
 *
 * ⚠️ THIS IS THE JOIN, NOT THE VERDICT. It answers "who runs this build" and
 * says nothing about whether that answer is worth drawing — a one-element
 * result here is exactly the point accusation `ProducerFan` refuses to hand a
 * renderer. `deriveBlockProducers` is the function the scene reads; this one
 * is exported because the join is the piece worth testing on its own, and
 * because a card counting builds may legitimately want it without any verdict
 * attached.
 *
 * Every producer carrying a key gets an entry, `[]` when nothing matched, so a
 * caller never has to read absence as "no match" or as "not asked".
 */
export function producerCandidates(
  producers: readonly BlockProducer[],
  roster: NetworkRosterRecord | null | undefined,
): Map<string, RosterNode[]> {
  const index = indexRosterVersions(roster);
  const out = new Map<string, RosterNode[]>();
  for (const producer of producers) {
    if (producer.key.length === 0) continue;
    if (out.has(producer.key)) continue;
    const version = producer.message.trim().length === 0
      ? null
      : matchVersion(producer.message, index);
    const rows = version === null ? undefined : index.byVersion.get(version);
    out.set(producer.key, rows ? rows.slice() : []);
  }
  return out;
}

/** Decide one producer's fan from its join. The one place the three gates are
 *  applied, and the one place a `RosterNode` is allowed into a drawn result. */
function decideFan(
  matchedVersion: string | null,
  candidates: readonly RosterNode[],
  index: RosterVersionIndex,
  declared: boolean,
): ProducerFan {
  const matched = candidates.length;
  const shareOfVersioned = index.versionedRosterSize > 0
    ? matched / index.versionedRosterSize
    : 0;
  const withheld = (reason: ProducerFanWithheld): ProducerFan => (
    { drawn: false, reason, matchedVersion, matched, shareOfVersioned }
  );
  if (!declared) return withheld('no_declaration');
  if (!index.rosterHasEntries) return withheld('roster_absent');
  if (index.versionedRosterSize === 0) return withheld('roster_unversioned');
  if (matchedVersion === null || matched === 0) return withheld('no_match');
  if (matched < PRODUCER_FAN_MIN_CANDIDATES) return withheld('singular');
  if (shareOfVersioned >= PRODUCER_FAN_MAX_SHARE_OF_VERSIONED) return withheld('modal');
  if (matched > PRODUCER_FAN_MAX_CANDIDATES) return withheld('crowd');
  return { drawn: true, matchedVersion, candidates, shareOfVersioned };
}

/** Whether the window the shares would be drawn against adds up.
 *
 *  ⭐ `sum(producers[].blocks) === producer_window_blocks` is the
 *  machine-checkable form of "a share always states its window". Both reducers
 *  maintain it on every push and each asserts it in its own tests, so a
 *  violation reaching here means the wire contradicted itself, and there is no
 *  reading of it that leaves the shares meaning anything: the numerators would
 *  be drawn as parts of a whole they are not parts of, so every ring in the
 *  colony would be the wrong size rather than one of them. `NetworkAtlas`
 *  refuses a round whose counts do not close for exactly this reason.
 *
 *  A blank key is refused the same way rather than dropped. Upstream keeps
 *  "no producer" as a first-class `None` that never enters the window at all,
 *  so a keyless row is not a producer we may not stage — it is blocks with no
 *  one behind them, and subtracting them from the denominator would be
 *  inventing the answer to who made them. */
function producerWindowIsCoherent(chain: ChainEntry): boolean {
  if (!Array.isArray(chain.producers)) return false;
  if (!Number.isSafeInteger(chain.producer_window_blocks)) return false;
  if (chain.producer_window_blocks < 0) return false;
  const keys = new Set<string>();
  let counted = 0;
  for (const producer of chain.producers) {
    if (typeof producer.key !== 'string' || producer.key.length === 0) return false;
    if (keys.has(producer.key)) return false;
    keys.add(producer.key);
    // A row is created by its first block and dropped when its last one leaves
    // the window, so a non-positive count is a row that should not exist.
    if (!Number.isSafeInteger(producer.blocks) || producer.blocks <= 0) return false;
    counted += producer.blocks;
  }
  return counted === chain.producer_window_blocks;
}

/** A shannon figure the formatter can read: decimal digits and nothing else.
 *
 *  ⚠️ `BigInt('12 CKB')` THROWS, and it would throw inside a render. The
 *  balances on this record are decimal STRINGS because they do not fit a
 *  double, so every consumer reaches for `BigInt` — and the one input that
 *  makes `BigInt` partial is a string that is not digits. Refusing it here
 *  makes the conversion total everywhere downstream, which is cheaper than
 *  every call site remembering a try/catch. An empty string is refused for
 *  the same reason a blank key is: `BigInt('')` is `0n`, and a balance nobody
 *  read must not become a balance of zero. */
function shannonsAreReadable(value: string | undefined): boolean {
  if (value === undefined) return true;
  return typeof value === 'string' && /^[0-9]+$/.test(value);
}

/**
 * Whether the indexer's week is a week the shares may be drawn against.
 *
 * ⭐ THE SAME CHECK THE ADAPTER ALREADY RAN, RUN AGAIN — deliberately, and for
 * the reason `producerWindowIsCoherent` exists beside the two reducers that
 * maintain the window: the check upstream proves what ckbadger sent, and this
 * one proves what arrived. Between them sit a wire, a cache and any server
 * claiming to be cknerv, and a record that lost its identity anywhere along
 * that path would otherwise divide by it. `total_blocks: 0` alone would make
 * every share `Infinity` or `NaN`, and a `NaN` share reaches a Float32 lane
 * and a printed percentage without anything throwing.
 *
 * The rules mirror `map_producer_ledger`
 * (`crates/cknerv-adapter-ckbadger/src/source.rs`): a positive total, every
 * row holding at least one block, non-empty and unique keys, and a sum that
 * does not exceed the total. `<=` and not `==`, unlike the 240-block window's
 * identity: the row cap cuts the tail off a long week on purpose, so the rows
 * are a PREFIX of the total and were never meant to add up to it.
 *
 * Two deliberate differences from the adapter's copy. It refuses a key that is
 * not `0x`-prefixed; this does not, because nothing on this side parses a key
 * — it is a lock script hash to group and count by, and a client that started
 * validating its shape would be the one place a devnet spelling could break
 * the colony. And this refuses a balance string that is not digits, which the
 * adapter never has to: it built those strings from the source's own JSON,
 * while what arrives here has been through a wire that may not have been
 * cknerv's.
 *
 * Incoherent is treated as ABSENT by `deriveBlockProducers`, never as an
 * error: falling back to the 240-block window is a view this repo has shipped
 * for months, and it is the same fallback a source with no ledger at all gets.
 */
export function producerLedgerIsCoherent(
  ledger: ProducerLedger | null | undefined,
): ledger is ProducerLedger {
  if (!ledger) return false;
  if (!Array.isArray(ledger.rows)) return false;
  if (!Number.isSafeInteger(ledger.total_blocks) || ledger.total_blocks <= 0) return false;
  const keys = new Set<string>();
  let counted = 0;
  for (const row of ledger.rows) {
    if (typeof row.key !== 'string' || row.key.length === 0) return false;
    if (keys.has(row.key)) return false;
    keys.add(row.key);
    if (!Number.isSafeInteger(row.blocks) || row.blocks <= 0) return false;
    counted += row.blocks;
    if (!shannonsAreReadable(row.balance_shannons)) return false;
    if (!shannonsAreReadable(row.last_reward_shannons)) return false;
  }
  return counted <= ledger.total_blocks;
}

/** Ascending by producer key, in code units. Deliberately not `localeCompare`:
 *  these are hex digests, not words, and a collation that varied with the
 *  host's locale would stand one machine's colony in a different order from
 *  another's over the same window (`byNodeId` keeps the same rule for the same
 *  reason). */
function byKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The producers of the recent chain, ready to stand in the colony, joined
 * against the crawler's roster.
 *
 * `null` when the window contradicts itself — see `producerWindowIsCoherent`.
 * An empty window is not that: it is a view with no producers, which is what a
 * fresh boot, a devnet that has not mined, and the first block after a reorg
 * all look like.
 *
 * ⭐ It takes the whole `ChainEntry` rather than a producer list and a
 * denominator, and that is the point: there is no call site at which the
 * numerators can be handed to this function without the window they were
 * counted over, so they cannot drift apart on the way in either.
 *
 * ⭐⭐⭐ TWO ORDERS, BECAUSE ORDERING BY A TALLY IS ITSELF A CHURN SOURCE.
 *
 * `staging` is KEY ASCENDING and reads no tally at all. It is the array that
 * reaches `stageAttested`, and through it the colony's node list, the scaffold
 * memo's `stagedKey`, and App's `producerKeysSig` — every one of which is a
 * cache key over GEOMETRY. So what is handed to them has to be a function of
 * WHICH miners exist and of nothing a block moves.
 *
 * Ordering by blocks made it a function of the tallies too. Two miners swapping
 * rank re-sequenced an IDENTICAL SET, and an identical set in a new sequence is
 * a new signature, a missed scaffold cache and a full O(V² log V) rebuild on
 * the render path — which, often enough, lands mid-wave, hands `ColonyEdges`
 * fresh surge lanes and truncates the wavefront. Neighbouring shares cross
 * constantly in a rolling window, so this was never a corner case: it is
 * exactly the failure `producerKeysSig` excludes `blocks` to avoid, arriving
 * through the door the ORDER left open.
 *
 * `ranked` is blocks descending, then key ascending — the reading order of a
 * share list, which is genuinely what a reader wants and what MESH·02's `TOP`
 * means. It is a presentation view and nothing geometric may follow it.
 *
 * ⭐ The key comparison was always the load-bearing half; only its job changed.
 * The wire's own order is first-appearance in a rolling ring, which reshuffles
 * as the window rolls — a producer whose last block is evicted loses its row,
 * and that producer's next block appends a fresh row at the tail — so an order
 * that fell through to arrival would renumber the staging set every few
 * minutes. Promoting the key from tie-break to sole key serves that goal
 * strictly better rather than differently: the key is a lock script hash,
 * distinct per row by construction, so key ascending is already a total order
 * and falls through to nothing.
 *
 * ⭐⭐ THE STANDING SET IS THE UNION OF THE TWO WINDOWS, and the union is the
 * whole reason the third argument exists. A cohort used to blink out of the
 * colony the moment its producer's last block left the 240-block ring — and
 * out of every colony at once for the first minute of a boot, and again after
 * every reorg, since the ring is cleared and refilled a block at a time. Those
 * producers did not stop existing; we stopped asking a window that could see
 * them. A key the week names and the ring does not now stands with `blocks 0`
 * against the live `windowBlocks`, which is the honest reading: it holds none
 * of the last 240 blocks and some share of the week, and both numbers sit on
 * the standing beside the window each was counted over.
 *
 * A ledger that contradicts itself is treated as ABSENT — see
 * `producerLedgerIsCoherent` — so a hostile or broken record can only cost the
 * view what it had before ledgers existed, never a `NaN` share.
 */
export function deriveBlockProducers(
  chain: ChainEntry,
  roster: NetworkRosterRecord | null | undefined,
  ledger?: ProducerLedger | null,
): BlockProducerView | null {
  if (!producerWindowIsCoherent(chain)) return null;
  const index = indexRosterVersions(roster);
  const windowBlocks = chain.producer_window_blocks;
  // Absent, missing and self-contradicting collapse onto one value on purpose:
  // downstream there is exactly one question ("is there a week?") and exactly
  // one fallback, which is the view this file produced before a week existed.
  const week = producerLedgerIsCoherent(ledger) ? ledger : null;
  const ledgerRows = new Map<string, ProducerLedgerRow>();
  for (const row of week?.rows ?? []) ledgerRows.set(row.key, row);

  /** One producer's week, or null when the week does not name it. Absent
   *  optionals become null and never zero: the wire's absence is a lookup that
   *  failed, and `0 CKB` over it would state something nobody read. */
  const weekFor = (key: string): ProducerLedgerStanding | null => {
    if (week === null) return null;
    const row = ledgerRows.get(key);
    if (row === undefined) return null;
    return {
      blocks: row.blocks,
      // Safe: coherence refuses a total of zero, because every share here is a
      // fraction of it.
      share: row.blocks / week.total_blocks,
      address: row.address ?? null,
      balanceShannons: row.balance_shannons ?? null,
      liveCells: row.live_cells ?? null,
      txCount: row.tx_count ?? null,
      lastRewardShannons: row.last_reward_shannons ?? null,
      lastRewardBlock: row.last_reward_block ?? null,
    };
  };

  const standings: ProducerStanding[] = chain.producers.map((producer) => {
    const declared = producer.message.trim().length > 0;
    const matchedVersion = declared ? matchVersion(producer.message, index) : null;
    const candidates = matchedVersion === null
      ? []
      : index.byVersion.get(matchedVersion) ?? [];
    return {
      role: 'producer',
      key: producer.key,
      message: producer.message,
      blocks: producer.blocks,
      windowBlocks,
      // Safe: a row holds at least one block (checked above), so a non-empty
      // producer list forces windowBlocks over zero through the identity.
      share: producer.blocks / windowBlocks,
      lastSeenMs: producer.last_seen_ms,
      fan: decideFan(matchedVersion, candidates, index, declared),
      ledger: weekFor(producer.key),
    };
  });

  // The other half of the union: a producer the week names and the ring does
  // not. It declares nothing — a declaration is a string a miner wrote into a
  // block, and none of this producer's blocks is in the window to have carried
  // one — so its fan is withheld as `no_declaration`, the same sentence the
  // card already says for a miner that stayed silent. The reason is DECIDED
  // rather than assumed, which keeps both halves of the union on one code path
  // and means a later gate cannot apply to one half and not the other.
  const windowKeys = new Set(chain.producers.map((producer) => producer.key));
  if (week !== null) {
    for (const row of week.rows) {
      if (windowKeys.has(row.key)) continue;
      standings.push({
        role: 'producer',
        key: row.key,
        message: '',
        // Zero of the live window, stated against the live window: the standing
        // says "none of the last 240", never "no window". `share` is written
        // rather than divided because both halves can be zero at once — on a
        // fresh boot the ring is empty and `0 / 0` is `NaN`.
        blocks: 0,
        windowBlocks,
        share: 0,
        // As of the LEDGER, not a block — see `ProducerStanding.lastSeenMs`.
        lastSeenMs: week.fetched_at_ms,
        fan: decideFan(null, [], index, false),
        ledger: weekFor(row.key),
      });
    }
  }

  // ⚠️ THIS SORT READS NO TALLY, AND THAT IS THE POINT — see above. It runs
  // over the UNION, so the two windows decide membership and neither decides a
  // position: a producer that enters the ring after a week in the ledger keeps
  // the place its key already had, and moves no other cohort.
  const staging = standings.sort((left, right) => byKey(left.key, right.key));

  // The reverse index, built ONLY from drawn fans. A peer belongs to exactly
  // one candidate set — the set is "every row reporting version V" and a peer
  // reports one V — so every producer that lists a given peer lists the same
  // peers alongside it, and `oneOf` is well defined however many producers
  // share a build.
  const candidacyByPeer = new Map<string, PeerMiningCandidacy>();
  for (const standing of staging) {
    if (!standing.fan.drawn) continue;
    for (const candidate of standing.fan.candidates) {
      const existing = candidacyByPeer.get(candidate.node_id);
      if (existing) {
        candidacyByPeer.set(candidate.node_id, {
          ...existing,
          producerKeys: [...existing.producerKeys, standing.key],
        });
        continue;
      }
      candidacyByPeer.set(candidate.node_id, {
        role: 'candidate',
        oneOf: standing.fan.candidates.length,
        version: standing.fan.matchedVersion,
        producerKeys: [standing.key],
      });
    }
  }

  // The reading order, over the SAME objects rather than over copies of them:
  // a surface that finds a standing by key gets the identical one from either
  // array, and a share can never be read off one while its window is read off
  // the other.
  //
  // ⭐ IT READS THE WINDOW THIS VIEW IS A READING OF, and there is only ever
  // one of them: with a week, `TOP` is the top of the WEEK, and a producer the
  // week does not name reads as zero however many of the last 240 blocks it
  // holds; without one, `TOP` is the top of the ring exactly as it has always
  // been. Mixing them — ledger blocks where they exist and window blocks
  // elsewhere — would be a list ordered by two different denominators, which is
  // the one thing §9.6 exists to prevent, and it would reshuffle every time a
  // producer entered or left the ring.
  const ranked = staging.slice().sort(week === null
    ? (left, right) => right.blocks - left.blocks || byKey(left.key, right.key)
    : (left, right) => (
      (right.ledger?.blocks ?? 0) - (left.ledger?.blocks ?? 0)
        || byKey(left.key, right.key)
    ));

  return {
    windowBlocks,
    staging,
    ranked,
    versionedRosterSize: index.versionedRosterSize,
    candidacyByPeer,
    ledgerWindow: week === null ? null : {
      days: week.window_days,
      fromDate: week.from_date,
      toDate: week.to_date,
      totalBlocks: week.total_blocks,
      fetchedAtMs: week.fetched_at_ms,
      indexedTip: week.indexed_tip,
    },
  };
}

/**
 * The signature a colony cache key is built from: every staged producer's key,
 * in staging order, joined with NUL.
 *
 * ⚠️⚠️ THE KEY SET, AND NOTHING A BLOCK MOVES. Every standing changes on every
 * block — a block bumps one tally and re-divides every share — while the SET
 * changes only when a producer enters or leaves one of the two windows. Only
 * the set can move the geometry (one node per key, placed from the key alone),
 * so only the set may re-key the topology; letting tallies, shares, messages,
 * fans or ledger figures in here would rebuild the whole colony once a block
 * because a numerator moved, hand an in-flight wavefront fresh surge lanes and
 * truncate it.
 *
 * ⭐ It is order-SENSITIVE on purpose, and safe because `staging` is ordered by
 * the set itself: the scaffold draws its long-range links per index, so an
 * identical set in a new sequence really is a different colony — but the only
 * thing that can re-sequence this array is a key entering or leaving it.
 *
 * ⭐ THE UNION IS WHY IT IS A FUNCTION AND NOT A ONE-LINER AT THE CALL SITE.
 * `staging` now spans two windows, so this signature is what carries a
 * ledger-only cohort into the topology's attested set — a key can reach it from
 * a week's worth of blocks without holding a single block in the ring — and
 * that is worth pinning in one place, with a test, rather than spelling twice.
 *
 * NUL is the separator because it cannot occur inside a lock script hash, so no
 * pair of key sets can collide by concatenation.
 *
 * Absent, null and empty collapse onto one signature deliberately:
 * `inferredTopology` emits a byte-identical topology for all three.
 */
export function producerKeysSignature(
  view: BlockProducerView | null | undefined,
): string {
  return (view?.staging ?? []).map((standing) => standing.key).join('\u0000');
}
