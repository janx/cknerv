// COHORT — the chain's own dialect of the floating inspection constellation,
// and the shortest of the four.
//
// The link probe reads a connection, the self probe reads our own vitals, the
// sighted probe reads somebody else's crawl. This card's subject is a node
// NOBODY has ever addressed: the chain says an entity made these blocks, and
// that is the entire evidence. So there is no compass (the bearing is a hash),
// no ping strip (we never dialled it), no sync ladder (it never told us a
// height), no uptime (nothing is up), no country, no ASN, no address and no
// version — not as "Unknown", which is a word for a lookup that came back
// empty, but structurally, because `ProducerStanding` has nowhere to put them.
// What is left is the chain's RECORD of the window, what the cohort wrote into
// its own blocks, who else says they run that, and one line saying what the
// scene is not claiming. There is less here than on any other card and that is
// the honest amount.
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
// ⚠️ AND IT IS `COHORT //` RATHER THAN `MINING COHORT //` ON MEASURED WIDTH.
// This card is 340px and its header plate leaves a 306px measure; at
// `HUD_TYPE.title` in the display face `MINING COHORT // fc20a8c8` runs 215px
// and the `CHAIN ATTESTED` chip beside it 91px, which is 314px with the gap —
// the chip wraps and the masthead grows a line. `COHORT // fc20a8c8` measures
// 154px, lands at 253px with the chip, and keeps the two-line header the other
// three dialects have. MESH·02 carries the long form (`MINING COHORTS`), where
// there is room for it; a masthead is a name and the row is a sentence.
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
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from 'react';
import type {
  PeerMiningCandidacy,
  ProducerStanding,
} from '../../derives/blockProducers.derive';
import { formatAge, midTruncate } from './cellFormat';
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
  producerShareText,
} from './producerReadout';
import { PEER_NETWORK_HEX } from '../../visualPalette';
import type { SceneInspectorPlacementSide } from '../sceneInspection';

/** Card width — the one narrow readout column all four floating dialects
 *  share, so a card swap never resizes the constellation. */
const CARD_WIDTH_PX = 340;

/** The attested tier's own tint, read from the constant its point cloud and its
 *  ring are drawn with: `PEER_CLOUD_ATTESTED_TONE` sets brightness and size but
 *  no colour, so `makePeerCloudMaterial` falls back to
 *  `PEER_NETWORK_PALETTE.scaffold`, and `makeProducerRingMaterial` names that
 *  same value outright. This is that colour in hex.
 *
 *  It is the SIGHTED card's accent too, and deliberately: the rung is a rung of
 *  the peer mesh rather than a species beside it, so the whole colony is one
 *  cyan and this card is the readout for the stop the chain proves. What tells
 *  the tiers apart on stage is the ring, not the hue — which is the same
 *  argument §3.1 makes about brightness, one channel over. */
export const MINER_NODE_ACCENT = PEER_NETWORK_HEX.scaffold;

/** The word this dialect wears, in the register a screen reader speaks. One
 *  export because the scene half names the same subject.
 *
 *  ⭐ THE SPOKEN FORM IS THE LONG ONE. The masthead is clipped to `COHORT` by a
 *  306px measure; a screen reader has no measure, so it gets the whole noun and
 *  the reason the noun exists comes across without a second sentence. */
export const MINER_NODE_SPOKEN_WORD = 'Mining cohort';

/** One line of the chain's record. A readout, never a button: nothing here
 *  re-tints the scene, because the scene has nothing to re-tint — the node
 *  carries no identity for a facet to select. */
export type MinerNodeRow = 'blocks' | 'key' | 'message' | 'build';

/** The producer, and the population its build share is measured against.
 *
 *  ⚠️ BOTH FIELDS COME OFF ONE READ OF ONE `BlockProducerView`, and the host
 *  resolves them together for that reason. `versionedRosterSize` is the
 *  denominator the fan's own gates divided by; pairing a standing from one
 *  round's view with a roster size from another would print a fraction whose
 *  halves were counted at different moments. */
export interface MinerNodeSubject {
  readonly producer: ProducerStanding;
  /** Roster rows carrying a usable build string — see
   *  `producerBuildShareText` for why this and not the crawler's wider set. */
  readonly versionedRosterSize: number;
}

export type MinerNodeLayoutSide = SceneInspectorPlacementSide;

export interface MinerNodeCardProps {
  /** The chain's standing for this producer, live off the producer view. */
  subject: MinerNodeSubject;
  /** Spatial fan direction chosen by the scene-anchor placement solver. */
  layoutSide?: MinerNodeLayoutSide;
  /** Wall clock the header's block age is measured from. Supplied by a host
   *  that already runs a clock; otherwise the card keeps its own 1 Hz tick,
   *  which is the only timer it ever starts. */
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
  children,
}: {
  row: MinerNodeRow;
  label: string;
  value: ReactNode;
  title?: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <PlateReadoutRow
      accent={MINER_NODE_ACCENT}
      label={label}
      value={value}
      title={title}
      badge={badge}
      rowAttributes={{ 'data-miner-probe-fact': row }}
      valueAttributes={{ 'data-miner-probe-value': row }}
    >
      {children}
    </PlateReadoutRow>
  );
}

/** A sentence under a value, in the micro tier — the caption grammar the other
 *  three dialects already use. */
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
  const { producer, versionedRosterSize } = subject;
  const keyHead = minerKeyHead(producer.key);
  // Trimmed only to ASK the question. What gets RENDERED is the string the
  // cohort wrote, byte for byte — the adapter already stripped the control
  // padding mainnet miners wrap their messages in, and anything left inside is
  // theirs and not this card's to tidy.
  const declared = producer.message.trim().length > 0;
  const buildShare = producerBuildShareText(producer.fan, versionedRosterSize);

  // The card prints one age, so it needs a wall clock that keeps moving. A host
  // that already runs one hands it down and no interval starts here at all; on
  // its own the card runs exactly one, at the 1 Hz the other dialects tick at.
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs != null) return;
    setTickNowMs(Date.now());
    const interval = window.setInterval(() => setTickNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [nowMs, producer.key]);
  const atMs = nowMs ?? tickNowMs;

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
          COHORT // {keyHead}
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
            LAST BLOCK {formatAge(producer.lastSeenMs, atMs)}
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
          >
            <ReadoutCaption>
              OF THE RECENT BLOCKS THAT NAMED WHO THEY PAID
            </ReadoutCaption>
          </MinerReadout>
          {/* The whole of the identity. No encoded address and no operator
              name: both are crawler enrichment, neither is wired, and an
              address computed here would be this card inventing the one thing
              it is for refusing to invent.

              ⭐⭐ AND THE SECOND CAPTION IS WHY THIS DIALECT IS CALLED A
              COHORT AT ALL. The row above prints the only identity the chain
              attests, and this one says what that identity is worth: a
              destination, which may pay any number of machines. It sits HERE
              rather than in the footer because it is a fact about the KEY —
              the footer's business is what the SCENE is not claiming, and this
              is a limit on the evidence itself. */}
          <MinerReadout
            row="key"
            label="KEY"
            value={midTruncate(producer.key, 14, 13)}
            title={producer.key}
          >
            <ReadoutCaption>
              PAYOUT LOCK HASH · THE ONLY IDENTITY THE CHAIN ATTESTS
            </ReadoutCaption>
            <ReadoutCaption>
              <span data-miner-probe-cohort-reason>{COHORT_PAYOUT_CAPTION}</span>
            </ReadoutCaption>
          </MinerReadout>
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
              no declaration to print, which the withheld reason below states
              in words. A row that is not there is the honest form of a fact
              that is not there. */}
          {declared ? (
            <MinerReadout
              row="message"
              label="MESSAGE"
              value={null}
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
              <ReadoutCaption>
                WRITTEN BY THE COHORT INTO ITS OWN BLOCKS · NOT MEASURED, AND
                TRIVIALLY SPOOFED
              </ReadoutCaption>
            </MinerReadout>
          ) : null}
          {/* The join, and its verdict. The fraction is `matched` over the
              peers we hold a build for — the same denominator the gates
              divided by — and the caption under it names that population,
              because a fraction whose bottom half is unnamed is a fraction a
              reader will supply the wrong bottom half for. */}
          <MinerReadout
            row="build"
            label="ON THIS BUILD"
            value={buildShare ?? PRODUCER_NO_VALUE}
            badge={producer.fan.drawn ? undefined : (
              <span
                data-miner-probe-narrowed="none"
                style={plateStateChip(HUD_COLORS.dim)}
              >
                NOT NARROWED
              </span>
            )}
          >
            {buildShare !== null ? (
              <ReadoutCaption>{PRODUCER_BUILD_DENOMINATOR_CAPTION}</ReadoutCaption>
            ) : null}
            {/* Seven reasons, seven sentences. Which one is showing is the
                most informative thing on the plate whenever the fan is
                withheld, and blurring them into "no candidates" would throw
                away six different facts about the world. */}
            <PlateReadoutCaption>
              <span data-miner-probe-narrowing={producer.fan.drawn ? 'drawn' : producer.fan.reason}>
                {producer.fan.drawn
                  ? PRODUCER_FAN_DRAWN_CAPTION
                  : PRODUCER_FAN_WITHHELD_TEXT[producer.fan.reason]}
              </span>
            </PlateReadoutCaption>
          </MinerReadout>
        </div>
      </section>

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
