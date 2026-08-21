// DOSSIER — how the network last saw this node, on either probe card.
//
// Every row here is CRAWLER-class: observed from outside, on a vantage and a
// clock that are not ours. That is the whole reason the plate exists — it is
// the only surface on either card that can answer questions the local RPC has
// no standing to answer (where the node is, whether anyone can dial it, how
// long the network has carried it) — and it is also why nothing in it may sit
// unstamped beside live telemetry. The header carries the observation age, and
// every span in the body is measured from the card's own 1 Hz tick.
//
// One component, two dialects: the peer card reads it as a foreign dossier,
// the node card as a mirror, which promotes EXPOSURE to the headline. DOM only
// — nothing here may touch three.js.
import type { CSSProperties, ReactNode } from 'react';
import type { PeerSightingAbsence, PeerSightingRecord } from '@cknerv/types';
import { formatAge } from './cellFormat';
import { HUD_COLORS, HUD_FONTS, HUD_TYPE, rgba } from './hudTheme';
import { moduleTag, SpatialPlateHeader, spatialPlate } from './primitives';
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
  /** The fault text, when the lookup could not be answered at all. */
  message?: string | null;
}

export interface PeerSightingPlateProps extends PeerSightingState {
  /** Module stamp in the host card's own numbering — `LINK·05` / `SELF·04`. */
  module: string;
  /** Wall clock every CRAWLER age is measured from. The cards run one 1 Hz
   *  tick each and lend it here; the plate starts no clock of its own. */
  nowMs: number;
  /** `self` is the mirror dialect: EXPOSURE leads, under its own caption. */
  variant?: 'peer' | 'self';
  /** The version local RPC reports for this node — the other half of the
   *  identify cross-check. */
  liveVersion?: string;
  /** How long OUR link to this node has stood, printed against how long the
   *  network has known it. The local node holds no link to itself. */
  linkAgeMs?: number | null;
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
    <div
      data-sighting-row={row}
      style={{
        minWidth: 0,
        padding: '3px 0 4px 9px',
        borderLeft: `1px solid ${rgba(SIGHTING_ACCENT, 0.3)}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ flex: '0 0 auto', fontFamily: HUD_FONTS.tech, fontSize: HUD_TYPE.micro, letterSpacing: 1.4, color: HUD_COLORS.dim }}>
          {label}
        </span>
        <span
          data-sighting-value={row}
          title={value}
          style={{
            marginLeft: 'auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: HUD_TYPE.label,
            color: valueColor ?? HUD_COLORS.ink,
          }}
        >
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

/** A sentence under a value, in the micro tier — the same caption grammar the
 *  self probe's vitals use. */
function SightingCaption({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 2,
        fontFamily: HUD_FONTS.tech,
        fontSize: HUD_TYPE.micro,
        letterSpacing: 0.9,
        lineHeight: 1.35,
        color: tone ?? HUD_COLORS.dim,
      }}
    >
      {children}
    </div>
  );
}

/** Every phase that has no record to print resolves to one quiet line, the
 *  way the Cell context readout states its own empty phases. */
function absenceLine(
  phase: PeerSightingPhase,
  reason: PeerSightingAbsence | null | undefined,
  message: string | null | undefined,
): { text: string; caption?: string; tone: string } | null {
  switch (phase) {
    case 'waiting':
      return { text: 'WAITING FOR THE SOURCE ANCHOR', tone: HUD_COLORS.dim };
    case 'loading':
      return { text: 'ASKING THE CRAWLER…', tone: HUD_COLORS.dim };
    case 'error':
      return {
        text: message ?? 'CRAWLER SIGHTING UNAVAILABLE',
        tone: HUD_COLORS.danger,
      };
    case 'unsighted':
      // A source with no crawler and a crawler that never saw this node are
      // different true statements, and the plate refuses to blur them.
      if (reason === 'no_crawler') {
        return {
          text: 'NO CRAWLER ON SOURCE',
          caption: 'THIS SOURCE RUNS WITHOUT A NETWORK CRAWLER',
          tone: HUD_COLORS.dim,
        };
      }
      if (reason === 'unreadable_node_id') {
        return {
          text: 'NO CRAWLER SIGHTING',
          caption: 'THIS ID CANNOT BE KEYED TO THE CRAWLER',
          tone: HUD_COLORS.dim,
        };
      }
      return {
        text: 'NO CRAWLER SIGHTING',
        caption: 'NEVER SEEN FROM OUTSIDE',
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
  message,
  module,
  nowMs,
  variant = 'peer',
  liveVersion,
  linkAgeMs,
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
    tone: HUD_COLORS.dim,
  };

  const exposure = sighting ? (
    <SightingRow
      key="exposure"
      row="exposure"
      label="EXPOSURE"
      value={sighting.reachable ? 'PUBLIC · DIALED FROM OUTSIDE' : 'UNREACHABLE FROM OUTSIDE'}
      valueColor={sighting.reachable ? HUD_COLORS.nominal : HUD_COLORS.caution}
    >
      {sighting.reachable ? null : (
        <SightingCaption>
          {sighting.last_reachable_at_ms != null
            ? `LAST DIAL ${formatAge(sighting.last_reachable_at_ms, nowMs)} AGO`
            : 'NO SUCCESSFUL DIAL ON RECORD'}
        </SightingCaption>
      )}
      {sighting.rtt_ms != null ? (
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
    <SightingRow
      key="network-age"
      row="network-age"
      label="NETWORK AGE"
      value={`ON NET ${formatNetworkSpan(Math.max(0, nowMs - sighting.first_seen_ms))}`}
    >
      {linkAgeMs != null ? (
        <SightingCaption>
          WE HAVE HELD THIS LINK {formatLinkUptime(linkAgeMs)}
        </SightingCaption>
      ) : null}
    </SightingRow>
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

  const crowd = sighting ? (
    <SightingRow
      key="crowd"
      row="crowd"
      label="CROWD"
      value={`~${count(sighting.known_peers_count)} PEERS IN ADDRESS BOOK`}
    >
      <SightingCaption>SAMPLED FROM THEIR ADDRESS BOOK, NOT COUNTED</SightingCaption>
    </SightingRow>
  ) : null;

  // The mirror dialect leads with the one question a node cannot ask itself.
  const rows = variant === 'self'
    ? [exposure, whereabouts, networkAge, identify, crowd]
    : [whereabouts, exposure, networkAge, identify, crowd];

  const satelliteBase: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  };

  return (
    <section
      aria-label="Crawler dossier"
      data-sighting-plate
      data-sighting-phase={phase}
      data-sighting-variant={variant}
      {...(phase === 'unsighted' && reason ? { 'data-sighting-reason': reason } : {})}
      style={{
        ...satelliteBase,
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
                style={{ color: HUD_COLORS.dim, fontSize: HUD_TYPE.micro, letterSpacing: 0.72 }}
              >
                SIGHTED {formatAge(sighting.last_seen_ms, nowMs)} AGO
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
          {absence.caption ? <SightingCaption>{absence.caption}</SightingCaption> : null}
        </div>
      ) : (
        <div style={{ display: 'grid', rowGap: 3 }}>{rows}</div>
      )}
    </section>
  );
}
