// COHORT — the chain's own dialect of the floating inspection constellation,
// and the shortest of the four.
//
// The link probe reads a connection, the self probe reads our own vitals, the
// sighted probe reads somebody else's crawl. This card's subject is a node
// NOBODY has ever addressed: the chain says an entity made these blocks, and
// that is the entire evidence. So there is no compass (the bearing is a hash),
// no ping strip (we never dialled it), no sync ladder (it never told us a
// height), no uptime (nothing is up), no country, no ASN and no version — not
// as "Unknown", which is a word for a lookup that came back empty, but
// structurally, because `ProducerStanding` has nowhere to put them.
//
// ⭐ AN ADDRESS IS THE ONE THAT CAME BACK, and it came back from somewhere
// else. This card still computes nothing from the key it prints — that would
// be inventing the one thing it exists to refuse to invent — but an INDEXER
// resolved one, counted a week of blocks against it and read what it holds,
// and saying so is a different sentence from minting it. It gets a plate of
// its own for that reason, the only one on the card whose source is not this
// machine.
//
// What is left is the chain's RECORD of the window, what the cohort wrote into
// its own blocks, who else says they run that, the week an indexer counted
// with the harvest at the end of it, and one line saying what the scene is not
// claiming. Nothing here is a reading off a machine, which is the honest
// amount for a subject nobody has ever addressed.
//
// ⭐⭐ AND EVERY GLOSS IS A HOVER RATHER THAN A LINE. Every one of those rows
// used to print a sentence under its value saying what the value meant — ten
// sentences under nine rows, which is a paragraph a reader has to walk past to
// reach the next number, and it made the card read as prose with figures in it
// rather than as an instrument. The sentences are all still here and not one of
// them was softened: they are the rows' `title`s, so the column is facts and the
// gloss arrives when somebody asks for it. What is still printed UNDER a value
// is the harvest's second reading, which is data and not a gloss on data.
//
// ⚠️ AND A ROW THAT ALREADY SAID IT SAYS IT ONCE. Three titles — WEEK,
// HASHRATE, LAST PAID — were already carrying in prose what their caption said
// in caps, so nothing was appended to those. The rule is that the sentence is
// REACHABLE, never that it is written twice.
//
// ⭐ THE MASTHEAD IS THE ONE CLAIM A CARD CANNOT MAKE QUIETLY. Per the P2-b
// ruling a wrong masthead is itself a shipped lie, and this subject can wear
// neither of the words already on stage: PEER means we hold a link and we do
// not, SIGHTED means a crawler answered for it and none ever has.
//
// ⭐⭐ AND IT CANNOT SAY MINER EITHER, WHICH IS A CORRECTION AND NOT A RENAME.
// The subject of this card is a PAYOUT LOCK HASH — a destination, not a
// machine. One address pays every rig a pool runs, so `MINER // fc20a8c8` was
// asserting a machine off evidence that names a place the reward goes. The word
// is COHORT: the set of machines one payout identity stands for, which may be
// one rig and may be a fleet, and the card says which of those we can tell
// (neither) rather than picking.
//
// ⚠️ `POW COHORT //` IS THE FULL PRODUCT NAME AND IT FITS THE MEASURE. This
// card is 340px and its header plate leaves a 306px measure. The compact POW
// token keeps the payout-key head and `CHAIN ATTESTED` chip on the same line,
// while matching MESH·02's `POW COHORTS` vocabulary exactly.
//
// ⭐ THE CHIP CARRIES THE EVIDENCE CLASS, WHICH IS THE MASTHEAD'S OTHER HALF.
// `COHORT` says what the node does; `CHAIN ATTESTED` says how we know it is
// there at all, and it is the strongest sentence on the card — stronger than
// anything the crawler can say about anybody, because a crawl is hearsay and a
// block is proof. The graph's own name for the rung stays in the graph
// (`attested:<key>`); this is the one place the word surfaces, and it surfaces
// as evidence rather than as a tier.
//
// ⚠️ ENGLISH ONLY. A new CJK glyph costs a `pyftsubset` re-subset of the
// hand-cut woff2 (~21 glyphs today), and this dialect asks the face for none —
// see the comment on the header plate for why it wears no CJK companion.
//
// ⚠️ EVERY LIVE NUMBER COMES FROM THE PRODUCER VIEW, NEVER FROM THE STAGED
// NODE. The App's topology memo is keyed on the producer KEY SET alone and has
// to be, so the standing hanging off a staged node is whatever it was at the
// last key-set change — right for identity, stale for a tally. The host
// resolves this card's subject out of the live view, exactly as `selectedSighted`
// asks the live roster rather than the row on the node.
//
// Everything on it is known the moment it opens, so nothing reveals, nothing
// animates in and nothing is selectable. DOM only: nothing here may touch
// three.js.
import type { CSSProperties, ReactNode } from 'react';
import type {
  PeerMiningCandidacy,
  ProducerLedgerWindow,
  ProducerStanding,
} from '../../derives/blockProducers.derive';
import { midTruncate } from './cellFormat';
import { HudAge } from './hudClock';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import {
  CloseButton,
  moduleTag,
  PlateReadoutCaption,
  PlateReadoutRow,
  plateStateChip,
  SpatialPlateHeader,
  spatialPlate,
  stackedSatelliteBase,
} from './primitives';
import {
  COHORT_PAYOUT_CAPTION,
  PRODUCER_BUILD_DENOMINATOR_CAPTION,
  PRODUCER_FAN_DRAWN_CAPTION,
  PRODUCER_FAN_WITHHELD_TEXT,
  PRODUCER_NO_VALUE,
  peerCandidacyText,
  producerBuildShareText,
  producerHarvestCaption,
  producerHarvestText,
  producerHashRateText,
  producerLastPaidText,
  producerShareText,
  producerWeekText,
} from './producerReadout';
import { PEER_NETWORK_HEX } from '../../visualPalette';
import type { SceneInspectorPlacementSide } from '../sceneInspection';

/** Card width — the one narrow readout column all four floating dialects
 *  share, so a card swap never resizes the constellation. */
const CARD_WIDTH_PX = 340;

/** The tint the cohort's own mark is drawn in, in hex.
 *
 *  `makeCohortLensMaterial`'s glow — the halo that IS the mark when it is one
 *  mark among hundreds — is `PEER_NETWORK_PALETTE.scaffold`, and its disc runs
 *  from that same cyan family to white as the substance gathers. One colour
 *  family for the whole mark, with no hue of its own anywhere in it.
 *
 *  It is the SIGHTED card's accent too, and deliberately: a cohort is a member
 *  of the peer mesh rather than a species beside it, so the whole colony is one
 *  cyan and this card is the readout for the thing the chain proves. What tells
 *  them apart on stage is the SHAPE — a shadow with a ring of light bent around
 *  it, against a point of light — which is the same argument §3.1 makes about
 *  brightness, one channel over. */
export const MINER_NODE_ACCENT = PEER_NETWORK_HEX.scaffold;

/** The word this dialect wears, in the register a screen reader speaks. One
 *  export because the scene half names the same subject.
 *
 *  The spoken form matches the visible `POW COHORT` masthead. */
export const MINER_NODE_SPOKEN_WORD = 'POW cohort';

/** One line of the chain's record. A readout, never a button: nothing here
 *  re-tints the scene, because the scene has nothing to re-tint — the node
 *  carries no identity for a facet to select. */
export type MinerNodeRow =
  | 'blocks' | 'key' | 'message' | 'build'
  | 'week' | 'hashrate' | 'payout' | 'harvest' | 'paid';

/** The producer, the population its build share is measured against, and the
 *  two figures that belong to the whole view rather than to this standing.
 *
 *  ⚠️ EVERY FIELD COMES OFF ONE READ OF ONE `BlockProducerView`, and the host
 *  resolves them together for that reason. `versionedRosterSize` is the
 *  denominator the fan's own gates divided by; `ledgerWindow` is the
 *  denominator every week share was divided by; pairing a standing from one
 *  round's view with either of them from another would print a fraction whose
 *  halves were counted at different moments.
 *
 *  ⭐ NONE OF THE THREE IS OPTIONAL, which is the shape doing the work. An
 *  absent week is `ledgerWindow: null` — a thing the host had to write down —
 *  and not a field somebody forgot to wire, which would look identical on
 *  screen and be a bug that never raised its hand. */
export interface MinerNodeSubject {
  readonly producer: ProducerStanding;
  /** Roster rows carrying a usable build string — see
   *  `producerBuildShareText` for why this and not the crawler's wider set. */
  readonly versionedRosterSize: number;
  /** The week the standing's `ledger` figures were counted over, or null when
   *  no week reached this view at all. */
  readonly ledgerWindow: ProducerLedgerWindow | null;
  /** The whole network's search rate in hashes per second, derived from the
   *  chain's own difficulty and cadence (`networkHashRateHs`), or null before
   *  this node has seen enough blocks to have a cadence. It is a fact about
   *  the NETWORK; what makes it belong on a cohort's card is this cohort's
   *  share of it. */
  readonly networkHashRateHs: number | null;
}

export type MinerNodeLayoutSide = SceneInspectorPlacementSide;

export interface MinerNodeCardProps {
  /** The chain's standing for this producer, live off the producer view. */
  subject: MinerNodeSubject;
  /** Spatial fan direction chosen by the scene-anchor placement solver. */
  layoutSide?: MinerNodeLayoutSide;
  /** Wall clock the header's block age is measured from. Supplied by a host
   *  that already runs one (labs, deterministic tests); otherwise the age is a
   *  leaf on the shared HUD clock, and nothing else on the card renders for a
   *  tick. The card starts no timer of its own. */
  nowMs?: number;
  onClose: () => void;
  style?: CSSProperties;
}

/** The head of the payout key, in the register the other dialects print an id
 *  in. The `0x` is chrome rather than identity and costs two of the eight
 *  characters a masthead has room for. */
export function minerKeyHead(key: string): string {
  return (key.startsWith('0x') ? key.slice(2) : key).slice(0, 8);
}

function MinerReadout({
  row,
  label,
  value,
  title,
  badge,
  rowAttributes,
  children,
}: {
  row: MinerNodeRow;
  label: string;
  value: ReactNode;
  title?: string;
  badge?: ReactNode;
  /** What this row hangs off its own box rather than off its value: the two
   *  probe hooks that used to live on a caption, and — for the one row with no
   *  value column at all — the `title` the gloss now arrives in.
   *
   *  ⚠️ THE HOVER GOES ON THE VALUE WHEREVER THERE IS ONE. `title` above is
   *  `PlateReadoutRow`'s, which puts it on the value span, and that is the
   *  target a reader aims at. A row-level title is for MESSAGE, whose value is
   *  null and whose span is therefore a zero-width piece of nothing at the
   *  right-hand edge. */
  rowAttributes?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <PlateReadoutRow
      accent={MINER_NODE_ACCENT}
      label={label}
      value={value}
      title={title}
      badge={badge}
      rowAttributes={{ 'data-miner-probe-fact': row, ...rowAttributes }}
      valueAttributes={{ 'data-miner-probe-value': row }}
    >
      {children}
    </PlateReadoutRow>
  );
}

/** A line under a value, in the micro tier — the caption grammar the other
 *  three dialects already use.
 *
 *  ⭐ ON THIS CARD IT CARRIES DATA AND NEVER AN EXPLANATION ANY MORE. The ten
 *  sentences that used to sit under nine values are the rows' `title`s now; the
 *  one thing left under a value is the harvest's live cells and transactions,
 *  which is a second READING of the address rather than a gloss on the first. */
function ReadoutCaption({ children }: { children: ReactNode }) {
  return <PlateReadoutCaption>{children}</PlateReadoutCaption>;
}

/**
 * The ONE mining sentence a card about a NAMED node is allowed to carry:
 * `IN A MINING COHORT? · 1 OF 6 ON THIS BUILD`.
 *
 * ⭐⭐ IT LIVES IN THE MINER CARD'S FILE ON PURPOSE, and it is the whole reason
 * this component exists rather than two lines of JSX in two cards. There are
 * exactly two surfaces in the HUD that may say anything about mining — the card
 * for a subject the chain proves mined, and this stamp for a subject that
 * merely runs a build somebody's blocks mention — and the distance between
 * those two claims is the entire feature. Written out twice they would drift;
 * written once, beside the card that IS allowed to state it, the difference is
 * legible to whoever edits either.
 *
 * ⚠️ IT MAY NEVER LOSE THE `?` OR THE DENOMINATOR. The join behind it is two
 * self-declared strings meeting: a set is narrowed, a member is never named. A
 * set of one is refused outright rather than printed — `peerCandidacyText`
 * returns nothing for it, so there is no rendering of this stamp that reads as
 * an identification.
 *
 * ⭐ AND IT ASKS `IN A`, NOT `IS A`. The peer would be a MEMBER of the cohort,
 * never the cohort itself — a cohort is a set of machines behind one payout
 * identity, and a peer is one machine. The old stamp asked whether this peer
 * WAS the miner, which is the one relation the fan can never establish.
 *
 * No plate, no chip, no accent. It is set in the instrument's quietest ink
 * because it is the least certain thing on either card, and a claim we are not
 * making must not be the brightest line in the masthead.
 */
export function MiningCandidacyStamp({ candidacy }: { candidacy: PeerMiningCandidacy }) {
  const text = peerCandidacyText(candidacy);
  if (text === null) return null;
  return (
    <span
      data-mining-candidacy={String(candidacy.oneOf)}
      title={`One of ${candidacy.oneOf} crawled peers reporting the build a recent block producer declared. Both sides of that are self-declared, so it narrows a set and never names a machine — and the cohort may contain several of them, or none.`}
      style={{
        flex: '0 0 100%',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: HUD_FONTS.tech,
        fontSize: HUD_TYPE.micro,
        letterSpacing: 0.9,
        color: HUD_COLORS.dim,
      }}
    >
      {text}
    </span>
  );
}

export default function MinerNodeCard({
  subject,
  layoutSide = 'left',
  nowMs,
  onClose,
  style,
}: MinerNodeCardProps) {
  const accent = MINER_NODE_ACCENT;
  const {
    producer, versionedRosterSize, ledgerWindow, networkHashRateHs,
  } = subject;
  const keyHead = minerKeyHead(producer.key);
  // Trimmed only to ASK the question. What gets RENDERED is the string the
  // cohort wrote, byte for byte — the adapter already stripped the control
  // padding mainnet miners wrap their messages in, and anything left inside is
  // theirs and not this card's to tidy.
  const declared = producer.message.trim().length > 0;
  const buildShare = producerBuildShareText(producer.fan, versionedRosterSize);
  // ⭐⭐ THE PLATE FOLLOWS THE WEEK, THE ROWS FOLLOW THE COHORT, and those are
  // two different absences — which is this card's oldest idiom, applied to a
  // new fact. No week at ALL (no source declares the capability, its route
  // answered 404, or what it sent contradicted itself) is a lookup that was
  // never made, and the plate is not there, exactly as the MESSAGE row is not
  // there when the cohort declared nothing. A week that WAS counted and does
  // not name this cohort is a lookup that came back empty, and that prints the
  // house dash — the same distinction `SightedNodeCard` keeps when it refuses
  // to write `Unknown` over a field nobody ever asked for.
  const week = producer.ledger;
  const lastPaid = producerLastPaidText(producer);
  const harvestCaption = producerHarvestCaption(producer);
  // Seven reasons, seven sentences. Which one is true is the most informative
  // thing about the join whenever the fan is withheld, and blurring them into
  // "no candidates" would throw away six different facts about the world — so
  // the verdict follows the fraction into the row's hover rather than being
  // dropped with the caption that used to print it.
  const narrowing = producer.fan.drawn ? 'drawn' : producer.fan.reason;
  const narrowingText = producer.fan.drawn
    ? PRODUCER_FAN_DRAWN_CAPTION
    : PRODUCER_FAN_WITHHELD_TEXT[producer.fan.reason];

  const verticalLayout = layoutSide === 'above' || layoutSide === 'below';

  return (
    <div
      data-miner-probe-card
      data-miner-probe-layout={verticalLayout ? 'vertical' : layoutSide}
      role="region"
      aria-label={`${MINER_NODE_SPOKEN_WORD} ${keyHead} probe`}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        rowGap: 8,
        alignItems: 'start',
        width: CARD_WIDTH_PX,
        maxWidth: 'calc(100vw - 28px)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
        // One composited shadow for the whole constellation, as on every other
        // dialect — never a filter surface per plate.
        filter: `drop-shadow(0 8px 16px ${rgba(HUD_COLORS.ground, 0.56)}) drop-shadow(0 0 14px ${rgba(accent, 0.06)})`,
        ...style,
      }}
    >
      {/* No CJK companion. 对端 is the link probe's word for the far end of a
          connection and 节点 names a node somebody has met; this subject is
          neither, and borrowing either would be the one lie on the card. The
          hand-cut face is asked for no new glyph. */}
      <section
        data-miner-probe-module="header"
        style={{
          ...stackedSatelliteBase,
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '3px 8px',
          padding: '9px 20px 8px 14px',
          ...spatialPlate(accent),
        }}
      >
        <span
          title={producer.key}
          style={{
            color: accent,
            fontFamily: HUD_FONTS.display,
            fontSize: HUD_TYPE.title,
            fontWeight: 600,
            letterSpacing: 1.6,
            textShadow: `0 0 9px ${rgba(accent, 0.45)}`,
          }}
        >
          POW COHORT // {keyHead}
        </span>
        {/* The one thing this card can say that no other card can. It is not a
            caution: a node the chain proves and nobody has met is this
            dialect's normal condition, and the alarm colours belong to links
            that broke. */}
        <span
          data-miner-probe-evidence="chain"
          style={plateStateChip(accent)}
        >
          CHAIN ATTESTED
        </span>
        {/* One right-hand group in flow, as every other masthead carries
          * theirs. The clock is the producer's last block IN THE WINDOW, which
          * is the only clock this subject has — there is no sighting to date
          * and no link to age. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
          <span
            data-miner-probe-last-block
            style={{
              color: HUD_COLORS.dim,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.9,
            }}
          >
            LAST BLOCK <HudAge atMs={producer.lastSeenMs} nowMs={nowMs} />
          </span>
          {moduleTag('MINE·01')}
        </span>
        <CloseButton onClose={onClose} title="Close · ESC or click outside" />
      </section>

      {/* What the chain reported, and nothing derived from anywhere else. The
          window is the chain's own; the key is the chain's own. */}
      <section
        aria-label="Chain record"
        data-miner-probe-module="record"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(accent),
        }}
      >
        <SpatialPlateHeader
          en="RECORD"
          accent={accent}
          status={moduleTag('MINE·02')}
        />
        <div style={{ display: 'grid', rowGap: 3 }}>
          {/* The share and the window it was measured over, in one value,
              because there is no reading of either without the other — see
              `producerShareText`, where that is a property of the formatter
              rather than a habit of this line. */}
          <MinerReadout
            row="blocks"
            label="BLOCKS"
            value={producerShareText(producer)}
            title="OF THE RECENT BLOCKS THAT NAMED WHO THEY PAID"
          />
          {/* The whole of the identity. No encoded address and no operator
              name: both are crawler enrichment, neither is wired, and an
              address computed here would be this card inventing the one thing
              it is for refusing to invent.

              ⭐⭐ AND THE LAST SENTENCE OF ITS HOVER IS WHY THIS DIALECT IS
              CALLED A COHORT AT ALL. The value prints the only identity the
              chain attests, and the title says what that identity is worth: a
              destination, which may pay any number of machines. It hangs off
              the KEY rather than off the footer because it is a fact about the
              KEY — the footer's business is what the SCENE is not claiming,
              and this is a limit on the evidence itself.

              ⚠️ AND THE PROBE HOOK RIDES THE ROW, CARRYING THE SENTENCE IN ITS
              VALUE. It used to be an empty attribute on the caption's span,
              read by its text; the caption is gone and the row's own text is
              the whole row, so the sentence moved into the attribute where a
              live probe can still read exactly it. */}
          <MinerReadout
            row="key"
            label="KEY"
            value={midTruncate(producer.key, 14, 13)}
            title={`${producer.key}\nPAYOUT LOCK HASH · THE ONLY IDENTITY THE CHAIN ATTESTS\n${COHORT_PAYOUT_CAPTION}`}
            rowAttributes={{ 'data-miner-probe-cohort-reason': COHORT_PAYOUT_CAPTION }}
          />
        </div>
      </section>

      {/* The cohort talking about itself, and everyone who says the same thing.
          Both halves of this plate are SELF-DECLARED — that is the whole reason
          the join below can narrow a set and never name a member. */}
      <section
        aria-label="Declared build"
        data-miner-probe-module="build"
        style={{
          ...stackedSatelliteBase,
          padding: '9px 12px 10px 14px',
          ...spatialPlate(accent),
        }}
      >
        <SpatialPlateHeader
          en="BUILD"
          accent={accent}
          status={moduleTag('MINE·03')}
        />
        <div style={{ display: 'grid', rowGap: 3 }}>
          {/* Absent rather than dashed when the cohort said nothing: there was
              no declaration to print, which the withheld reason on the row
              below carries in words. A row that is not there is the honest
              form of a fact that is not there.

              ⚠️ ITS GLOSS IS THE ONE THAT SITS ON THE ROW. Every other row on
              the card hangs its hover off the value, which is what a reader
              aims at; this row's value is null — the string the cohort wrote is
              a block of its own underneath — so the title goes on the whole
              row and the label, the chip and the message all answer to it. */}
          {declared ? (
            <MinerReadout
              row="message"
              label="MESSAGE"
              value={null}
              rowAttributes={{
                title: 'WRITTEN BY THE COHORT INTO ITS OWN BLOCKS · NOT MEASURED, AND TRIVIALLY SPOOFED',
              }}
              badge={
                <span
                  data-miner-probe-declared
                  style={plateStateChip(HUD_COLORS.dim)}
                >
                  SELF-DECLARED
                </span>
              }
            >
              {/* Verbatim, on its own line and wrapping. The measure line
                  clips a long value to one row with an ellipsis, which is
                  right for an address and wrong for the one string on this
                  card whose exact bytes are the point. `pre-wrap` keeps the
                  interior spacing the miner typed. */}
              <div
                data-miner-probe-message
                style={{
                  marginTop: 2,
                  fontFamily: HUD_FONTS.mono,
                  fontSize: HUD_TYPE.value,
                  letterSpacing: 0.35,
                  lineHeight: 1.35,
                  color: HUD_COLORS.ink,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {producer.message}
              </div>
            </MinerReadout>
          ) : null}
          {/* The join, and its verdict. The fraction is `matched` over the
              peers we hold a build for — the same denominator the gates
              divided by — and its title names that population, because a
              fraction whose bottom half is unnamed is a fraction a reader will
              supply the wrong bottom half for. The verdict is the second line
              of the same hover; the badge beside the value is what says, on the
              face of the card, that there is a verdict to read. */}
          <MinerReadout
            row="build"
            label="ON THIS BUILD"
            value={buildShare ?? PRODUCER_NO_VALUE}
            title={buildShare === null
              ? narrowingText
              : `${PRODUCER_BUILD_DENOMINATOR_CAPTION}\n${narrowingText}`}
            rowAttributes={{ 'data-miner-probe-narrowing': narrowing }}
            badge={producer.fan.drawn ? undefined : (
              <span
                data-miner-probe-narrowed="none"
                style={plateStateChip(HUD_COLORS.dim)}
              >
                NOT NARROWED
              </span>
            )}
          />
        </div>
      </section>

      {/* The week, and where the reward for it lands. Everything on this plate
          comes from an INDEXER rather than from this node: it is the only
          third-party measurement on the card, and the only plate whose window
          is a stretch of calendar rather than a count of blocks.

          ⭐ IT IS LAST, AND IT IS LAST FOR THE TAGS. Evidence order would put
          a third party's count above what a cohort says about itself — but a
          plate that can be absent has to sit at the END of a module count-off,
          or a card without a week reads MINE·01, ·02, ·04 and the registry has
          a hole in it that means nothing. The two chain plates lead, the claim
          follows them, and the outside reading closes.

          ⚠️ AND IT IS WHY THE MASTHEAD ABOVE NO LONGER SAYS "NO ADDRESS". A
          `ProducerStanding` still has nowhere to put a country or an ASN, and
          this card still computes no address from the key it prints. What
          changed is that somebody else looked one up and said so, which is a
          different sentence and gets its own plate to be said on. */}
      {ledgerWindow !== null ? (
        <section
          aria-label="Indexed week"
          data-miner-probe-module="week"
          style={{
            ...stackedSatelliteBase,
            padding: '9px 12px 10px 14px',
            ...spatialPlate(accent),
          }}
        >
          <SpatialPlateHeader
            en="WEEK"
            accent={accent}
            status={moduleTag('MINE·04')}
          />
          <div style={{ display: 'grid', rowGap: 3 }}>
            {/* The other window, and the whole reason it exists: this one is
                warm on the first frame and survives a reorg that closed after
                the days it counts did. The unit is still BLK because what was
                counted is blocks; the days are the shape of the window and
                they are in the title with the dates. */}
            <MinerReadout
              row="week"
              label="WEEK"
              value={producerWeekText(producer, ledgerWindow)}
              title={week === null
                ? `The indexer counted ${ledgerWindow.days} complete days, ${ledgerWindow.fromDate} to ${ledgerWindow.toDate}, and this cohort is in none of its rows — it is newer than that week, or smaller than the smallest row the record carries.`
                : `Blocks the indexer attributed to this cohort over the ${ledgerWindow.days} complete days from ${ledgerWindow.fromDate} to ${ledgerWindow.toDate}, out of ${ledgerWindow.totalBlocks.toLocaleString('en-US')} it attributed in all.`}
            />
            {/* A scale rather than a reading, and the `≈` is the first
                character of it for that reason — see `producerHashRateText`,
                where refusing to print a zero is part of the same argument. */}
            <MinerReadout
              row="hashrate"
              label="HASHRATE"
              value={producerHashRateText(producer, networkHashRateHs)}
              title="This cohort's share of the blocks multiplied by the network's own rate — the chain's difficulty over the mean interval between the blocks this node has seen. Nothing here measured a machine: a cohort that ran twice as hard for half the week lands in the same place."
            />
            {/* The address, and it is the KEY in another notation rather than
                a second identity — which is why the hover names who did the
                rendering before it hands over the whole string. This card still
                computes nothing from the hash it prints. */}
            <MinerReadout
              row="payout"
              label="PAYOUT"
              value={week?.address == null
                ? PRODUCER_NO_VALUE
                : midTruncate(week.address, 14, 13)}
              title={week?.address == null
                ? 'WHAT THE INDEXER RESOLVED THE KEY ABOVE TO'
                : `${week.address}\nWHAT THE INDEXER RESOLVED THE KEY ABOVE TO`}
            />
            {/* What is sitting at that address — through `BigInt` the whole
                way, because the live figure is eight places past what a double
                can hold exactly.

                ⭐ AND ITS CAPTION IS THE ONE THAT STAYS ON THE CARD, because
                it is not an explanation of the value above it: live cells and
                transactions are a second READING of the same address, and
                moving data into a tooltip would be hiding a fact rather than
                putting away a gloss. */}
            <MinerReadout
              row="harvest"
              label="HARVEST"
              value={producerHarvestText(producer)}
              title="What that one address held when the indexer last read it. A fact about the ADDRESS and not about the cohort: it may be swept, split across others, or shared with whatever else that lock pays for."
            >
              {harvestCaption !== null ? (
                <ReadoutCaption>
                  <span data-miner-probe-harvest-caption>{harvestCaption}</span>
                </ReadoutCaption>
              ) : null}
            </MinerReadout>
            {/* One sampled payout, and absent rather than dashed on every card
                that was not the one sampled — a refresh reads a single height,
                so a dash here would be fifteen cohorts reporting an empty
                lookup that was never made about them. */}
            {lastPaid !== null ? (
              <MinerReadout
                row="paid"
                label="LAST PAID"
                value={lastPaid}
                title="One cellbase payout, sampled at a single height a few blocks behind the tip and matched to this cohort's payout address. It says this cohort was paid there; it is not a total and not a rate."
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The three things the scene cannot say for itself. The entity is really
          out there and really made these blocks; where it stands is the
          renderer's arrangement; and if any machine of this cohort is one of
          the peers already on stage, the colony is drawing it twice — which is
          inherent to giving every payout identity one anonymous node, and is
          disclosed here rather than hidden.

          ⭐ BOTH OF THE LAST TWO CLAUSES ARE PLURAL NOW, AND THEY HAVE TO BE.
          `NODE NOT OBSERVED` said "node", singular, about a subject that may
          stand for a whole fleet — and `MAY ALSO STAND AS A PEER ABOVE` said
          the cohort itself might be a peer, which is a category error: a peer
          is a machine and a cohort is a set of them. What may stand above is
          one of its MACHINES, and the honest count of the ones we have seen is
          none of them. */}
      <div
        data-miner-probe-footer
        style={{
          ...stackedSatelliteBase,
          padding: '5px 12px 6px 14px',
          fontFamily: HUD_FONTS.tech,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 1.2,
          lineHeight: 1.4,
          color: HUD_COLORS.dim,
          ...spatialPlate(HUD_COLORS.dim),
        }}
      >
        POSITION IS SCENE PLACEMENT · NONE OF ITS NODES OBSERVED · ITS MACHINES
        MAY ALSO STAND AS PEERS ABOVE
      </div>
    </div>
  );
}
