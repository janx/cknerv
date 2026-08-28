// DOSSIER — how the network last saw this node, on either probe card.
//
// Every row here is CRAWLER-class: observed from outside, on a vantage and a
// clock that are not ours. That is the whole reason the plate exists — it is
// the only surface on either card that can answer questions the local RPC has
// no standing to answer (where the node is, whether anyone can dial it, how
// long the network has carried it) — and it is also why nothing in it may sit
// unstamped beside live telemetry. The header carries the observation age, and
// every span in the body that ages is a leaf on the shared HUD clock: the
// second passing re-renders the span, never the plate around it.
//
// One component, two dialects: the peer card reads it as a foreign dossier,
// the node card as a mirror, which promotes EXPOSURE to the headline. DOM only
// — nothing here may touch three.js.
import type { ReactNode } from 'react';
import type {
  PeerAdvertisedEvidence,
  PeerProbeResult,
  PeerSightingAbsence,
  PeerSightingRecord,
} from '@cknerv/types';
import { formatAge, midTruncate } from './cellFormat';
import { HudAge, useHudClockSelector } from './hudClock';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE } from './hudTheme';
import {
  moduleTag,
  PlateReadoutCaption,
  PlateReadoutRow,
  SpatialPlateHeader,
  spatialPlate,
  stackedSatelliteBase,
} from './primitives';
import { formatLinkUptime } from '../../derives/peerLinkInstrument.derive';

/** The lookup's phases, in the vocabulary the Cell context readout already
 *  speaks — with `unsighted` in place of `unavailable`, because a source that
 *  answers "never seen from outside" has told us something true. */
export type PeerSightingPhase =
  | 'disabled'
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'unsighted'
  | 'error';

/** What the card is handed about its subject's sighting. Absent entirely when
 *  the source advertises no `peer_sighting` capability — the plate is additive
 *  and a CKB-only card is complete without it. */
export interface PeerSightingState {
  phase: PeerSightingPhase;
  record?: PeerSightingRecord | null;
  /** Why the source had no sighting. Only meaningful while `unsighted`. */
  reason?: PeerSightingAbsence | null;
  /** What the crawler holds about a peer it never verified. Arrives only with
   *  `advertised_unverified`, which is the one absence that has evidence
   *  behind it rather than only a word. */
  advertised?: PeerAdvertisedEvidence | null;
  /** The fault text, when the lookup could not be answered at all. */
  message?: string | null;
}

export interface PeerSightingPlateProps extends PeerSightingState {
  /** Module stamp in the host card's own numbering — `LINK·05` / `SELF·04`. */
  module: string;
  /** Wall clock every CRAWLER age is measured from, when a host holds one —
   *  a lab, a deterministic test, or a card freezing its clock at the instant
   *  a link was lost. Absent, each age is a leaf on the shared HUD clock; the
   *  plate starts no clock of its own either way. */
  nowMs?: number;
  /** `self` is the mirror dialect: EXPOSURE leads, under its own caption.
   *  `sighted` is the crawler-only dialect: its host card holds no live
   *  telemetry about the subject at all, so the rows that exist to set this
   *  account against ours stand down rather than compare it with itself. */
  variant?: 'peer' | 'self' | 'sighted';
  /** The version local RPC reports for this node — the other half of the
   *  identify cross-check. */
  liveVersion?: string;
  /** How long OUR link to this node has stood, printed against how long the
   *  network has known it. The local node holds no link to itself. */
  linkAgeMs?: number | null;
  /** The instant `linkAgeMs` was snapshotted, while the link is still up: the
   *  caption adds the seconds since, off the same clock as every other age.
   *  Null or absent prints `linkAgeMs` as it stands (a lost link, a lab). */
  linkAgeSinceMs?: number | null;
  /** Our own last measured round trip, beside the crawler's dial time. */
  liveRttMs?: number | null;
}

/** The plate is drawn in the colony's own wire colour: the crawler is another
 *  reader of the same network, not a second opinion about our link. */
const SIGHTING_ACCENT = HUD_COLORS.peerWire;

/** Upstream labels geography it could not resolve rather than dropping it, so
 *  the plate has to tell an answer from a shrug. */
function unresolved(label: string | undefined): boolean {
  const trimmed = label?.trim() ?? '';
  return trimmed === '' || trimmed.toLowerCase() === 'unknown';
}

/**
 * A span in the units a network membership is remembered in. `formatAge` tops
 * out at days, which is the right resolution for a sighting and the wrong one
 * for a node the crawler first met two years ago.
 */
export function formatNetworkSpan(ms: number): string {
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  const years = Math.floor(days / 365);
  if (years >= 1) {
    const months = Math.floor((days - years * 365) / 30);
    return months > 0 ? `${years} YR ${months} MO` : `${years} YR`;
  }
  const months = Math.floor(days / 30);
  if (months >= 1) return `${months} MO`;
  if (days >= 1) return `${days} D`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours} H` : 'UNDER AN HOUR';
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** One dossier fact. A readout, never a button: nothing in the crawler's
 *  account of a node is selectable, because none of it re-tints the scene. */
function SightingRow({
  row,
  label,
  value,
  valueColor,
  children,
}: {
  row: string;
  label: string;
  value: string;
  valueColor?: string;
  children?: ReactNode;
}) {
  return (
    <PlateReadoutRow
      accent={SIGHTING_ACCENT}
      railAlpha={0.3}
      label={label}
      value={value}
      valueColor={valueColor}
      valueSize={HUD_TYPE.label}
      rowAttributes={{ 'data-sighting-row': row }}
      valueAttributes={{ 'data-sighting-value': row }}
    >
      {children}
    </PlateReadoutRow>
  );
}

/** A sentence under a value, in the micro tier — the same caption grammar the
 *  self probe's vitals use. */
function SightingCaption({ tone, children }: { tone?: string; children: ReactNode }) {
  return <PlateReadoutCaption tone={tone}>{children}</PlateReadoutCaption>;
}

/** The unverified peer's clock line as a leaf — see `advertisedStamp`. */
function AdvertisedStampCaption({ advertised, nowMs }: {
  advertised: PeerAdvertisedEvidence;
  nowMs?: number;
}) {
  const text = useHudClockSelector((clock) => advertisedStamp(advertised, nowMs ?? clock));
  return <SightingCaption>{text}</SightingCaption>;
}

/** NETWORK AGE, and the link held against it: both readings move with the
 *  second, so the row is a leaf of its own. */
function NetworkAgeRow({ firstSeenMs, linkAgeMs, linkAgeSinceMs, nowMs }: {
  firstSeenMs: number;
  linkAgeMs?: number | null;
  linkAgeSinceMs?: number | null;
  nowMs?: number;
}) {
  const value = useHudClockSelector((clock) => (
    `ON NET ${formatNetworkSpan(Math.max(0, (nowMs ?? clock) - firstSeenMs))}`
  ));
  const held = useHudClockSelector((clock) => (
    linkAgeMs == null
      ? null
      : formatLinkUptime(linkAgeMs + (
        linkAgeSinceMs == null ? 0 : Math.max(0, (nowMs ?? clock) - linkAgeSinceMs)
      ))
  ));
  return (
    <SightingRow row="network-age" label="NETWORK AGE" value={value}>
      {held !== null ? (
        <SightingCaption>
          WE HAVE HELD THIS LINK {held}
        </SightingCaption>
      ) : null}
    </SightingRow>
  );
}

/** How far the crawler's furthest dial got, said the way a pilot reads it.
 *
 *  The axis is ordinal and each rung is a genuinely different diagnosis, so
 *  every one gets its own sentence: a peer whose addresses all refused the
 *  dial and a peer that completed a secure handshake and then went quiet have
 *  nothing in common except the outcome. Collapsing them into "unreachable"
 *  would throw away the only part of this report an operator can act on. */
function probeSentence(result: PeerProbeResult | undefined): string {
  switch (result) {
    case 'dial_request_failed':
      return 'NO DIAL TO IT COULD BE OPENED';
    case 'no_authenticated_session_before_deadline':
      return 'NO HANDSHAKE BEFORE THE DEADLINE';
    case 'authenticated_session_without_identify_before_deadline':
      return 'IT OPENED A SESSION AND NEVER SAID WHO IT WAS';
    case 'malformed_identify':
      return 'IT IDENTIFIED IN A SHAPE THE CRAWLER COULD NOT READ';
    case 'foreign_network':
      return 'IT ANSWERED, FROM ANOTHER CHAIN';
    case 'same_network_identified':
      return 'IT IDENTIFIED, AND NO RECORD OF IT WAS KEPT';
    case 'unknown':
      return 'THE CRAWLER NAMED A REASON THIS BUILD CANNOT READ';
    default:
      // No completed round has touched it. A third statement again, and the
      // reason the field is optional rather than carrying a seventh rung:
      // "nobody has tried yet" is not a failed dial.
      return 'NO COMPLETED ROUND HAS TRIED IT YET';
  }
}

/** When the network last named this peer, and how long it has been failing.
 *  Every CRAWLER-class line on this plate carries its own stamp, and an
 *  unverified peer has no sighting to be stamped by — this is the only clock
 *  it has, on every dialect, which is why no variant suppresses it the way the
 *  sighted dialect suppresses figures its host card prints twice.
 *
 *  Which clock that is, is a sentence and not a fallback. `LAST NAMED` is what
 *  the rung is about and it is preferred wherever it exists; a peer the
 *  crawler holds no gossiped alias for has never been named by anybody, and
 *  printing that phrase over the observation clock would date the report with
 *  an event that did not happen. So the word changes with the fact. */
function advertisedStamp(advertised: PeerAdvertisedEvidence, nowMs: number): string {
  // `!= null` rather than a check against `undefined`: the server omits the
  // key it has no answer for, and a wire that ever sends an explicit `null`
  // instead means exactly the same thing here.
  const advertisedAt = advertised.last_advertised_at_ms;
  const stamp = advertisedAt != null
    ? `LAST NAMED ${formatAge(advertisedAt, nowMs)} AGO`
    : `LAST OBSERVED ${formatAge(advertised.latest_positive_observed_ms, nowMs)} AGO`;
  const rounds = advertised.consecutive_exhausted_rounds;
  if (rounds <= 0) return stamp;
  return `${stamp} · ${rounds === 1 ? '1 ROUND' : `${count(rounds)} ROUNDS`} EXHAUSTED`;
}

/** Where the furthest dial was made, and out of how many.
 *
 *  The one thing on the mirror a node cannot read off its own configuration:
 *  that states what it BOUND, and this is what the network is telling
 *  everybody to dial — which is a different string the moment a NAT, a
 *  forwarded port or a moved host is involved, and the whole reason an
 *  operator opens this plate.
 *
 *  The denominator rides with it because the rung alone does not say how hard
 *  anybody tried: one refused address out of one is a dead entry in the
 *  gossip, and one out of nine is a node that is not answering anywhere. */
function dialedAtCaption(advertised: PeerAdvertisedEvidence): string | null {
  const dialed = advertised.dialed_address_count;
  const address = advertised.furthest_address;
  if (!address) {
    // Upstream named a rung and no address for it. The count is still a fact,
    // and stating it alone is better than inventing a place for the rung.
    return dialed > 0 ? `${count(dialed)} ${dialed === 1 ? 'ADDRESS' : 'ADDRESSES'} DIALED` : null;
  }
  // Head-weighted on purpose, and by a lot. A multiaddr ends in `/p2p/<id>`
  // — the node this card is already headed by — and what an operator needs
  // out of it is the transport and the PORT, which an even split hides
  // behind an ellipsis while spelling out the id twice. The head clears the
  // longest form that carries one (`/ip6/::ffff:…/tcp/8114`), and the tail
  // stays only long enough to show that something was cut.
  const at = `DIALED AT ${midTruncate(address, 34, 6)}`;
  return dialed > 1 ? `${at} · FURTHEST OF ${count(dialed)}` : at;
}

/** Every phase that has no record to print resolves to one quiet line and the
 *  captions that qualify it, the way the Cell context readout states its own
 *  empty phases. */
function absenceLine(
  phase: PeerSightingPhase,
  reason: PeerSightingAbsence | null | undefined,
  message: string | null | undefined,
): { text: string; captions: string[]; tone: string } | null {
  switch (phase) {
    case 'waiting':
      return { text: 'WAITING FOR THE SOURCE ANCHOR', captions: [], tone: HUD_COLORS.dim };
    case 'loading':
      return { text: 'ASKING THE CRAWLER…', captions: [], tone: HUD_COLORS.dim };
    case 'error':
      return {
        text: message ?? 'CRAWLER SIGHTING UNAVAILABLE',
        captions: [],
        tone: HUD_COLORS.danger,
      };
    case 'unsighted':
      // Four different true statements share this phase — a source with no
      // crawler, an id the crawler cannot be keyed by, a crawler that holds
      // nothing at all under this one, and a peer the network names that
      // nobody could get an identify out of — and the plate refuses to blur
      // them. Every one of them is a report; none of them is a fault.
      if (reason === 'no_crawler') {
        return {
          text: 'NO CRAWLER ON SOURCE',
          captions: ['THIS SOURCE RUNS WITHOUT A NETWORK CRAWLER'],
          tone: HUD_COLORS.dim,
        };
      }
      if (reason === 'unreadable_node_id') {
        return {
          text: 'NO CRAWLER SIGHTING',
          captions: ['THIS ID CANNOT BE KEYED TO THE CRAWLER'],
          tone: HUD_COLORS.dim,
        };
      }
      // The rung below a sighting, and the one absence with evidence under
      // it. Saying "never seen from outside" here would be false in the way
      // this plate exists to prevent: the crawler holds this peer's addresses
      // and dials them every round. Most of the colony lives here — a node
      // behind NAT dials out and cannot be dialed back — so this is an
      // ordinary report and not a fault, and it stays in the quiet tone.
      //
      // The headline stands on the reason alone. A source that names this
      // state without sending the evidence still said something true, and
      // falling back to the line below would replace it with something false.
      if (reason === 'advertised_unverified') {
        // The evidence under it is not captions on this line: it is rows, in
        // the same grammar a sighting's rows use, because it answers the same
        // questions the sighted body answers. EXPOSURE is still "can the
        // outside reach it", and what it prints here is how far the outside
        // got — which is that row gaining a reason rather than a second body
        // for the same subject.
        return {
          text: 'NAMED BY THE NETWORK, NEVER VERIFIED',
          captions: [],
          tone: HUD_COLORS.dim,
        };
      }
      return {
        text: 'NO CRAWLER SIGHTING',
        captions: ['NEVER SEEN FROM OUTSIDE'],
        tone: HUD_COLORS.dim,
      };
    default:
      return null;
  }
}

export default function PeerSightingPlate({
  phase,
  record,
  reason,
  advertised,
  message,
  module,
  nowMs,
  variant = 'peer',
  liveVersion,
  linkAgeMs,
  linkAgeSinceMs,
  liveRttMs,
}: PeerSightingPlateProps) {
  // Nothing was asked, so nothing is claimed. The card must read as complete
  // without this plate — enrichment is additive on every surface it touches.
  if (phase === 'disabled') return null;

  const sighting = phase === 'ready' ? record ?? null : null;
  // Every phase that is not a sighting resolves to exactly one line, including
  // the one that should not happen: a plate frame with an empty body would be
  // the only thing on either card that says nothing at all.
  const absence = sighting ? null : absenceLine(phase, reason, message) ?? {
    text: 'CRAWLER SIGHTING UNAVAILABLE',
    captions: [],
    tone: HUD_COLORS.dim,
  };
  // The one absence with a body. Everything else this plate cannot report is
  // a line and nothing under it; this one is a peer the crawler holds the
  // addresses of and dials every round, so it has rows to fill and they are
  // the same rows a sighting would have filled where the fact exists.
  const evidence = !sighting && reason === 'advertised_unverified' ? advertised ?? null : null;

  // The INBOUND half of the address book, and the one figure that stands on
  // BOTH sides of the sighted/unsighted split — the peers that name a node
  // are counted whether or not anybody ever got an answer out of it. One name
  // for one fact, so the row below does not have to know which of the two it
  // was handed.
  const advertiserPeerCount = sighting?.advertiser_peer_count
    ?? evidence?.advertiser_peer_count;

  // Severity belongs to the dialect that can act on it. On the mirror, EXPOSURE
  // is the one question a node cannot ask itself and the answer is the operator's
  // to fix: an undialable local node is a real condition of this instrument, so
  // the ramp is correct there. On the other two the row describes a STRANGER —
  // most of the colony is behind NAT, none of it is ours to reach, and nothing
  // about it is a fault of anything. That is the ruling `SightedNodeCard` already
  // writes down three plates away: steel, not caution, because the alarm colours
  // belong to links that broke. The mirrored `nominal` goes with it — a stranger
  // being dialable from outside is not this instrument's health either.
  const exposureIsOurs = variant === 'self';
  // The same question of a peer nobody ever answered. EXPOSURE asks whether
  // the outside can reach this node; a sighting answers yes-or-no, and this
  // answers HOW FAR the outside got, which is the same row with more of the
  // answer in it rather than a different row wearing its name. It takes the
  // mirror's severity by the identical rule: an undialable local node is a
  // real condition of this instrument and somebody's to fix, and a stranger
  // behind NAT is neither.
  const dialedAt = evidence ? dialedAtCaption(evidence) : null;
  const unverifiedExposure = evidence ? (
    <SightingRow
      key="exposure"
      row="exposure"
      label="EXPOSURE"
      value={probeSentence(evidence.furthest_result)}
      valueColor={exposureIsOurs ? HUD_COLORS.caution : HUD_COLORS.dim}
    >
      {/* The address takes the severity with the value: on the mirror it is
          the actionable half of the whole report, and the stamp under it is
          context rather than a thing to go and fix. */}
      {dialedAt ? (
        <SightingCaption tone={exposureIsOurs ? HUD_COLORS.caution : undefined}>
          {dialedAt}
        </SightingCaption>
      ) : null}
      <AdvertisedStampCaption advertised={evidence} nowMs={nowMs} />
    </SightingRow>
  ) : null;

  const exposure = sighting ? (
    <SightingRow
      key="exposure"
      row="exposure"
      label="EXPOSURE"
      value={sighting.reachable ? 'PUBLIC · DIALED FROM OUTSIDE' : 'UNREACHABLE FROM OUTSIDE'}
      valueColor={exposureIsOurs
        ? (sighting.reachable ? HUD_COLORS.nominal : HUD_COLORS.caution)
        : HUD_COLORS.dim}
    >
      {sighting.reachable ? null : (
        <SightingCaption>
          {sighting.last_reachable_at_ms != null
            ? <>LAST DIAL <HudAge atMs={sighting.last_reachable_at_ms} nowMs={nowMs} /> AGO</>
            : 'NO SUCCESSFUL DIAL ON RECORD'}
        </SightingCaption>
      )}
      {/* The sighted card prints the crawler's dial as a RECORD row of its
          own, straight off the roster and without waiting for this lookup, so
          the caption would be the same figure twice on one card. */}
      {sighting.rtt_ms != null && variant !== 'sighted' ? (
        <SightingCaption>
          {`THEIR DIAL ${count(sighting.rtt_ms)} MS`}
          {liveRttMs != null ? ` · OUR PING ${count(liveRttMs)} MS` : ''}
        </SightingCaption>
      ) : null}
    </SightingRow>
  ) : null;

  const whereabouts = sighting ? (
    <SightingRow
      key="whereabouts"
      row="whereabouts"
      label="WHEREABOUTS"
      // Printed exactly as the source labelled it, including its own word for
      // not knowing — dimmed rather than hidden, so the row never implies the
      // crawler placed a node it could not place.
      value={`${sighting.country || 'Unknown'} · ${sighting.asn || 'Unknown'}`}
      valueColor={unresolved(sighting.country) && unresolved(sighting.asn)
        ? HUD_COLORS.dim
        : undefined}
    />
  ) : null;

  const networkAge = sighting ? (
    <NetworkAgeRow
      key="network-age"
      firstSeenMs={sighting.first_seen_ms}
      linkAgeMs={linkAgeMs}
      linkAgeSinceMs={linkAgeSinceMs}
      nowMs={nowMs}
    />
  ) : null;

  const crawlerVersion = sighting?.client_version.trim() ?? '';
  const rpcVersion = liveVersion?.trim() ?? '';
  const versionsDisagree = Boolean(
    sighting && rpcVersion && crawlerVersion && rpcVersion !== crawlerVersion,
  );
  const identify = sighting ? (
    <SightingRow
      key="identify"
      row="identify"
      label="IDENTIFY"
      value={crawlerVersion || '—'}
      valueColor={versionsDisagree ? HUD_COLORS.caution : HUD_COLORS.dim}
    >
      <SightingCaption tone={versionsDisagree ? HUD_COLORS.caution : undefined}>
        {versionsDisagree
          ? `LIVE RPC SAYS ${rpcVersion}`
          : rpcVersion
            ? 'AGREES WITH THE LIVE RPC VERSION'
            : 'NO LIVE VERSION TO CHECK AGAINST'}
      </SightingCaption>
    </SightingRow>
  ) : null;

  // CROWD, back as the TWO rows the one it replaces could never have been.
  //
  // The row that stood here printed a single "peers in address book", and
  // upstream deleted the number under it. What arrived instead was the peers
  // that named THIS node — the same relationship read from the other end — so
  // there was no honest way to put it through the old row, and the slot went
  // rather than being inverted into it. Both directions can be said now, and
  // they are said separately because they are not the same measurement and
  // not even the same unit: one counts PEERS that gossip this node, the other
  // counts ADDRESSES this node gossiped. A peer is advertised under every
  // alias anybody ever saw it at, so the second runs several times the number
  // of peers behind it — which is why neither row states a bare number and
  // both spell their unit out.
  //
  // ⚠️ Neither is a link. Upstream is explicit that this is address-book
  // gossip rather than live topology: a peer repeating an address may never
  // have spoken to the node at it, and nothing here watched anybody try. The
  // captions carry that, because a crowd count beside a network drawing of
  // connected points is exactly where a reader would otherwise supply it.
  const crowdInbound = advertiserPeerCount != null ? (
    <SightingRow
      key="crowd-inbound"
      row="crowd-inbound"
      label="ADVERTISED BY"
      value={`${count(advertiserPeerCount)} ${advertiserPeerCount === 1 ? 'PEER' : 'PEERS'}`}
    >
      <SightingCaption>PEERS THAT NAMED IT TO THE CRAWLER · GOSSIP, NOT LINKS</SightingCaption>
    </SightingRow>
  ) : null;

  const advertisedAddresses = sighting?.advertised_address_count;
  const crowdOutbound = advertisedAddresses != null ? (
    <SightingRow
      key="crowd-outbound"
      row="crowd-outbound"
      label="ADVERTISES"
      value={`${count(advertisedAddresses)} ${advertisedAddresses === 1 ? 'ADDRESS' : 'ADDRESSES'}`}
    >
      <SightingCaption>ADDRESSES IT NAMED TO THE CRAWLER, NOT PEERS</SightingCaption>
    </SightingRow>
  ) : null;

  // The mirror dialect leads with the one question a node cannot ask itself.
  // The crawler-only dialect drops IDENTIFY entirely: with no live RPC on the
  // other side, the row could only set the crawler's version against the same
  // crawler's version — a cross-check with one party, printed twice.
  const rows = variant === 'self'
    ? [exposure, whereabouts, networkAge, identify, crowdInbound, crowdOutbound]
    : variant === 'sighted'
      ? [whereabouts, exposure, networkAge, crowdInbound, crowdOutbound]
      : [whereabouts, exposure, networkAge, identify, crowdInbound, crowdOutbound];

  // An unverified peer's body is the subset of those the crawler can actually
  // fill. There is no whereabouts to place it, no membership to age and no
  // version to cross-check — upstream refuses to fabricate any of them for a
  // peer it never reached, and so does this — which leaves the two rows it
  // does hold, in the order they hold each other: what the outside got, and
  // how much of the network is still repeating the address it got there at.
  const unverifiedRows = evidence ? [unverifiedExposure, crowdInbound] : [];
  const body = evidence ? unverifiedRows : rows;

  // What the plate says about itself, for a reader that is not a person. The
  // reason and the rung ride the SAME element on purpose: they answer one
  // question between them, and for one commit they sat two elements apart —
  // which cost nothing visible and made every oracle that asked the plate for
  // the rung read `null` without failing.
  const absenceAttributes = {
    ...(phase === 'unsighted' && reason ? { 'data-sighting-reason': reason } : {}),
    ...(evidence?.furthest_result
      ? { 'data-sighting-probe': evidence.furthest_result }
      : {}),
  };

  return (
    <section
      aria-label="Crawler dossier"
      data-sighting-plate
      data-sighting-phase={phase}
      data-sighting-variant={variant}
      {...absenceAttributes}
      style={{
        ...stackedSatelliteBase,
        padding: '9px 12px 10px 14px',
        ...spatialPlate(SIGHTING_ACCENT),
      }}
    >
      <SpatialPlateHeader
        en="DOSSIER"
        accent={SIGHTING_ACCENT}
        status={(
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
            {sighting ? (
              <span
                data-sighting-stamp
                style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.6 }}
              >
                SIGHTED <HudAge atMs={sighting.last_seen_ms} nowMs={nowMs} /> AGO
              </span>
            ) : null}
            {moduleTag(module)}
          </span>
        )}
      />
      {variant === 'self' ? (
        <div
          data-sighting-caption
          style={{
            marginTop: -3,
            marginBottom: 6,
            fontFamily: HUD_FONTS.tech,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 1.2,
            color: SIGHTING_ACCENT,
          }}
        >
          HOW THE NETWORK SEES YOU
        </div>
      ) : null}
      {absence ? (
        <div data-sighting-absence style={{ minWidth: 0 }}>
          <div
            title={absence.text}
            style={{
              color: absence.tone,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.9,
              lineHeight: 1.45,
            }}
          >
            {absence.text}
          </div>
          {absence.captions.map((caption) => (
            <SightingCaption key={caption}>{caption}</SightingCaption>
          ))}
        </div>
      ) : null}
      {/* Rows under an absence, not instead of it: the headline states which
          of the plate's true statements this is, and the body states what the
          crawler holds under it. Every other absence has nothing to hold and
          renders the headline alone. */}
      {body.some(Boolean) ? (
        <div style={{ display: 'grid', rowGap: 3, marginTop: absence ? 5 : 0 }}>{body}</div>
      ) : null}
    </section>
  );
}
