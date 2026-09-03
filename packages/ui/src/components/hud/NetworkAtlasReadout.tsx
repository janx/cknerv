import type {
  EnrichmentSourceStatus,
  NetworkAtlasBucket,
  NetworkAtlasRecord,
} from '@cknerv/types';
import type {
  NetworkAtlasReachOutcome,
  NetworkAtlasReachSegment,
} from '../../derives/networkAtlas.derive';
import {
  deriveNetworkAtlasVisual,
  networkAtlasVisualState,
} from '../../derives/networkAtlas.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';

const fmt = (value: number) => value.toLocaleString('en-US');

/** How much of a legend line the named buckets may spend before the rest of
 *  them become a count.
 *
 *  It used to be a bucket budget — the first four, always — which was written
 *  when every label here was a country code. A client version is
 *  `0.209.0 (d166e28 2026-07-29)`, so four of those is a paragraph under a 6px
 *  bar. Four is still the ceiling, because a fifth country tells a reader
 *  nothing the bar has not already drawn; the budget is what stops the ceiling
 *  from being reached with three long names. Characters, not pixels: this line
 *  is monospace, which is the one face where they are the same measurement. */
const LEGEND_CHAR_BUDGET = 54;
const LEGEND_MAX_ENTRIES = 4;

function legend(buckets: NetworkAtlasBucket[]): string {
  const visible: string[] = [];
  let spent = 0;
  for (const bucket of buckets) {
    if (visible.length >= LEGEND_MAX_ENTRIES) break;
    const entry = `${bucket.label} ${bucket.count}`;
    const cost = entry.length + (visible.length > 0 ? 3 : 0);
    // The leader is never budgeted away: a strip whose whole legend is
    // `+11 groups` names nothing at all.
    if (visible.length > 0 && spent + cost > LEGEND_CHAR_BUDGET) break;
    visible.push(entry);
    spent += cost;
  }
  const rest = buckets.length - visible.length;
  if (rest > 0) visible.push(`+${rest} groups`);
  return visible.join(' · ');
}

/** What each outcome is called under a six-pixel bar, and what it means on the
 *  hover.
 *
 *  Short enough that all three fit on one legend line with their counts, which
 *  is what lets the bar keep the rule the five rows it replaced were built on:
 *  a cohort that resolves to zero stays on screen. A zero SEGMENT is zero
 *  pixels wide and invisible, so the legend is where zero is a reading — and
 *  because nothing is ever folded out of it, what the legend prints always adds
 *  up to the number in the caption, and a reader can check that.
 *
 *  `ANOTHER CHAIN` and `THIS CHAIN` are deliberately the same phrase twice.
 *  They are the two halves of one distinction — a peer that answered the dial
 *  perfectly well and named a different network, against one that named this
 *  one — and a reader who has to hold two unrelated words for that is being
 *  asked to remember which is which. */
const REACH_LABEL: Record<NetworkAtlasReachOutcome, string> = {
  exhausted: 'NO ANSWER',
  foreign: 'ANOTHER CHAIN',
  reachable: 'THIS CHAIN',
};

const REACH_MEANING: Record<NetworkAtlasReachOutcome, string> = {
  exhausted: 'every address the crawler holds was tried and none returned an identify',
  foreign: 'dialed, and it identified itself on a different network',
  reachable: 'dialed, and it identified itself on this network',
};

/** The round's peers, laid along how far the crawler got with each.
 *
 *  `BucketStrip`'s sibling and NOT a third call of it, because the rules the
 *  two follow are opposites.
 *
 *  It counts a DIFFERENT POPULATION. This bar totals every peer the network
 *  named, which is more than twice what the strips below it total — those count
 *  only the peers the crawler holds a verification for. Two proportional bars
 *  with different denominators, stacked, is the one thing a reader must not get
 *  wrong here, and three things say it: the caption states its own total and
 *  the unit that total is in, the bar sits up here with the round it decomposes
 *  rather than down there with the index scan the census is folded from, and it
 *  is painted in one hue stepping in brightness where the two below it are
 *  unrelated hues.
 *
 *  It is never sorted. The segments run from the peers the crawler never got an
 *  answer out of to the peers that answered on this chain, and that progression
 *  IS the reading — a bar re-ordered by size would be a different statement
 *  about the same three numbers.
 *
 *  It replaced five rows of one number each, at the user's word that they spent
 *  too much of the panel to say what a bar says at a glance. Four of those rows
 *  are here. The fifth — the peers still held verified from an earlier round —
 *  could never be a segment: it cuts across two of these three rather than
 *  joining them, and adding it would count those peers twice. It is on the
 *  hover instead, worded on its own verb, where it costs no lines at all. */
function ReachStrip({ segments, total, remembered, provenance }: {
  segments: NetworkAtlasReachSegment[];
  total: number;
  remembered: number;
  provenance: string;
}) {
  // A round that considered nobody. There is no shape to draw and no
  // denominator to draw it against; the panel's own measured rows are still
  // the whole story above.
  if (total === 0) return null;
  const named = (segment: NetworkAtlasReachSegment) =>
    `${REACH_LABEL[segment.outcome]} ${fmt(segment.peers)}`;
  const meanings = segments
    .map((segment) => `${REACH_LABEL[segment.outcome]}: ${REACH_MEANING[segment.outcome]}`)
    .join(' · ');
  return (
    <div
      style={{ marginTop: 6 }}
      title={
        `${provenance} · every peer the round considered — advertised by somebody, dialed or not`
        + ` · ${meanings}`
        + ` · ${fmt(remembered)} of them are still held verified from an earlier round,`
        + ' drawn from the two cohorts that did not answer here rather than beside them'
      }
    >
      <div style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
        NAMED BY THE NETWORK · {fmt(total)} PEERS
      </div>
      <div style={{ display: 'flex', height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.peerWire, 0.14)}` }}>
        {segments.map((segment) => (
          <span
            key={segment.outcome}
            data-reach-segment={segment.outcome}
            // No glow, unlike the qualitative strips below. Theirs separates
            // unrelated hues; here the neighbours are one hue two steps apart,
            // and a 5px bleed would smear exactly the edge the ranking is read
            // from.
            style={{ width: `${(segment.peers / total) * 100}%`, background: segment.color }}
          />
        ))}
      </div>
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.legendInk, marginTop: 3, lineHeight: 1.45 }}>
        {segments.map(named).join(' · ')}
      </div>
    </div>
  );
}

function BucketStrip({ label, buckets, total, provenance }: {
  label: string;
  buckets: Array<NetworkAtlasBucket & { color: string }>;
  total: number;
  provenance: string;
}) {
  if (total === 0) return null;
  const detail = buckets.map((bucket) => `${bucket.label} ${bucket.count}`).join(' · ');
  return (
    <div style={{ marginTop: 6 }} title={`${provenance} · ${detail}`}>
      <div style={{ fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.2, color: HUD_COLORS.dim, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ display: 'flex', height: 6, background: HUD_COLORS.trackGround, border: `1px solid ${rgba(HUD_COLORS.peerWire, 0.14)}` }}>
        {buckets.map((bucket) => (
          <span
            key={bucket.label}
            style={{
              width: `${(bucket.count / total) * 100}%`,
              background: bucket.color,
              boxShadow: `0 0 5px ${rgba(bucket.color, 0.25)}`,
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, color: HUD_COLORS.legendInk, marginTop: 3, lineHeight: 1.45 }}>
        {legend(buckets)}
      </div>
    </div>
  );
}

// PEER·02 has one subject, seen from two distances: the rows above are measured
// over our own links, these are indexed by the crawler's last round. Same
// network, so they join the panel flow as ordinary rows — a titled sub-frame
// would only split one subject into two instruments. The provenance every
// indexed number shares waits on hover instead of spending a line, and
// staleness speaks only when it is true.
//
// Strictly additive: with no usable crawler record the panel's own measured
// rows are the whole story, so absence renders nothing rather than a substitute
// readout.
//
// Every number here is a BAR now rather than a row of digits. Three of them
// used to be rows and are segments of the first one; two more were bars of
// their own and are gone, on the user's ruling that how far a dial got and
// which cloud a peer is hosted in were not questions this panel was being asked
// — which is also why the address population they counted is no longer read off
// the wire at all.
//
// What may be here is a fact about the NETWORK; what may not is a fact about
// the crawl that read it. The line used to be drawn by listing whatever was
// currently left out — three different lists in three commits, each naming the
// thing its own author had not built, and two of the three named something a
// later commit then put on screen. A list of exclusions is a changelog, not a
// rule, so the rule is written instead: the median crawler dial went because it
// measured the crawler's distance from the fleet; `frontier drained` went
// because it is the run loop's own state; the peers verified for the first time
// in a round is the crawler's knowledge changing rather than the network's
// shape.
export default function NetworkAtlasReadout({ source, record }: {
  source?: EnrichmentSourceStatus;
  record?: NetworkAtlasRecord | null;
}) {
  if (!source || !record) return null;
  const visualState = networkAtlasVisualState(source, record);
  const visual = deriveNetworkAtlasVisual(record);
  if (!visualState || !visual) return null;
  const stale = visualState === 'stale';
  const provenance = `Crawler atlas · round ${fmt(record.crawl_round)} · as of #${fmt(record.as_of.block)}`;

  return (
    <div
      data-network-detail-mode="indexed"
      data-network-atlas-state={visualState}
      style={{ marginTop: 6 }}
    >
      <div data-network-atlas-rows style={{ opacity: stale ? 0.68 : 1 }}>
        {/* The reach bar, and the reason it sits HERE rather than under the
            census below. It belongs to the round, on the round's clock and the
            round's evidence; the two strips below are folded out of a
            node-store scan taken when the request arrived. Two clocks, in
            order, with the boundary where a reader can see it — and two
            denominators, which is the same boundary said twice. */}
        <ReachStrip
          segments={visual.reach}
          total={record.candidate_peers}
          remembered={record.verified_unavailable_peers}
          provenance={provenance}
        />
        {/* One denominator, stated once, on the first strip that spends THIS
            one — the same place the sample size used to ride. The two strips
            fold the same peers two ways, so repeating it under each would read
            as two different populations. The bar above states a different one,
            over a different set, which is why it says so in its own caption
            rather than inheriting this. */}
        <BucketStrip
          label={`COUNTRIES · ALL ${fmt(record.indexed_peers)} VERIFIED PEERS`}
          buckets={visual.countries}
          total={record.indexed_peers}
          provenance={provenance}
        />
        <BucketStrip
          label="CLIENT VERSIONS"
          buckets={visual.versions}
          total={record.indexed_peers}
          provenance={provenance}
        />
      </div>
      {stale ? (
        <div
          data-network-atlas-caution
          style={{ fontFamily: HUD_FONTS.mono, fontSize: HUD_TYPE.nav, letterSpacing: 0.35, color: HUD_COLORS.caution, marginTop: 5 }}
        >
          ATLAS STALE · AS OF #{fmt(record.as_of.block)}
        </div>
      ) : null}
    </div>
  );
}
