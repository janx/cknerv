import type {
  EnrichmentSourceStatus,
  NetworkAtlasBucket,
  NetworkAtlasRecord,
} from '@cknerv/types';
import {
  deriveNetworkAtlasVisual,
  networkAtlasVisualState,
} from '../../derives/networkAtlas.derive';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { StatRow } from './primitives';

const fmt = (value: number) => value.toLocaleString('en-US');

/** How much of a legend line the named buckets may spend before the rest of
 *  them become a count.
 *
 *  It used to be a bucket budget — the first four, always — which was written
 *  when every label here was a country code. A client version is
 *  `0.209.0 (d166e28 2026-07-29)` and an autonomous system is
 *  `AS16509 Amazon.com, Inc.`, so four of either is a paragraph under a 6px
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

// MESH·02 has one subject, seen from two distances: the rows above are measured
// over our own links, these are indexed by the crawler's last round. Same
// network, so they join the panel flow as ordinary rows — a titled sub-frame
// would only split one subject into two instruments. The provenance every
// indexed number shares waits on hover instead of spending a line, and
// staleness speaks only when it is true.
//
// Strictly additive: with no usable crawler record the panel's own measured
// rows are the whole story, so absence renders nothing rather than a substitute
// readout. Crawler run telemetry (address attempts, dial histograms) is
// ckbadger's own operational view, not the pilot's — what survives here is the
// shape of the network the crawl saw.
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

  // The reach ladder. This row used to be one number under the word `Known
  // nodes`, and the number was never false — it counted the peers the crawler
  // holds a verification for, which is exactly what upstream's deleted
  // `totalKnown` counted. The NAME was the problem: "known" reads as
  // everything the crawler has heard of, and everything the crawler has heard
  // of is a separate, much larger number that now exists. Showing one of them
  // without the others is what made an honest figure read as the wrong one.
  //
  // The first four rows are one partition: a candidate the round completed
  // answered on this network, answered on another one, or ran its address list
  // out — three outcomes, no fourth, adding up to the peers it considered. The
  // fifth is NOT a fifth part. It cuts across the two failure rows and would
  // double-count against them, so it is worded on a different verb, and its
  // hover says which cohorts it is drawn from.
  //
  // Zero rows stay. `0` here is a RESULT — nobody answered from another chain
  // this round — and a row that vanished on zero would make a healthy crawl
  // and a broken one look identical, which is the whole failure this readout
  // was rebuilt out of. Today three of the five are zero on mainnet, so this
  // rule is the only thing keeping the ladder a ladder.
  const ladder: Array<[string, number, string]> = [
    [
      'Named by the network',
      record.candidate_peers,
      'every peer the round considered — advertised by somebody, dialed or not',
    ],
    [
      'Answered, this chain',
      record.last_round_reachable,
      'dialed, and it identified itself on this network',
    ],
    [
      'Answered, another chain',
      record.foreign_peers,
      'dialed, and it identified itself on a different network',
    ],
    [
      'No answer this round',
      record.exhausted_candidates,
      'every address the crawler holds was tried and none returned an identify',
    ],
    [
      'Verified, not reached',
      record.verified_unavailable_peers,
      'still held verified from an earlier round, out of the two rows above — '
        + 'not a further part of the peers considered',
    ],
  ];

  return (
    <div
      data-network-detail-mode="indexed"
      data-network-atlas-state={visualState}
      style={{ marginTop: 6 }}
    >
      <div data-network-atlas-rows style={{ opacity: stale ? 0.68 : 1 }}>
        {ladder.map(([label, value, meaning]) => (
          <StatRow key={label} label={label} title={`${provenance} · ${meaning}`}>
            {fmt(value)}
          </StatRow>
        ))}
        {/* One denominator, stated once, on the first strip that spends it —
            the same place the sample size used to ride. The three strips fold
            the same peers three ways, so repeating it under each would read as
            three different populations. */}
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
        {/* The axis a 64-row page could never have said anything useful about,
            and the one that answers a question the other two cannot: whether
            half the network is inside one operator's cloud. It is named for
            what it is rather than "hosting networks", because this panel is
            about a network and the word cannot mean two things inside it. */}
        <BucketStrip
          label="AUTONOMOUS SYSTEMS"
          buckets={visual.asns}
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
