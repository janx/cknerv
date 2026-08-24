// The LINK PROBE card's view model — one peer, decoded into the readouts the
// floating inspector prints. No React, no three.js: unit-tested directly.
//
// Every scene encoding this card explains is read back through the SAME
// function the colony renders with (`latencyToRadius01`, `peerAngle`,
// `peerColorKind`), so a peer's blip, bearing and tint can never disagree with
// the node the user clicked. The one thing that is genuinely new here is the
// sync tri-state: the scene compresses sync into crystal size, and the old rail
// panel folded AHEAD into AT TIP — hiding the one case that says *we* lag.

import type { Peer, PeerDirection } from '@cknerv/types';
import { HUD_COLORS } from '../components/hud/hudTheme';
import { PEER_NETWORK_HEX } from '../visualPalette';
import { latencyToRadius01, peerAngle, peerColorKind, type PeerColorKind } from './peers.derive';

/** Printed wherever the node reported nothing. */
export const PEER_LINK_UNKNOWN = '—';

/** CSS twin of `PEER_COLORS`. Both records are keyed by `peerColorKind`, and
 *  both resolve through `PEER_NETWORK_HEX` — the scene's float triples are
 *  converted from these same hex strings, so the card's accent is the measured
 *  node's own tint rather than a second, drifting palette. */
export const PEER_LINK_ACCENT_HEX: Readonly<Record<PeerColorKind, string>> = {
  outbound: PEER_NETWORK_HEX.outbound,
  inbound: PEER_NETWORK_HEX.inbound,
  version: PEER_NETWORK_HEX.version,
};

export type PeerLinkFacet =
  | 'addr'
  | 'direction'
  | 'version'
  | 'ping'
  | 'sync'
  | 'uptime';

/** Reveal order of the LINE FACTS grid — identity first, telemetry last. */
export const PEER_LINK_FACETS: readonly PeerLinkFacet[] = [
  'addr',
  'direction',
  'version',
  'ping',
  'sync',
  'uptime',
];

export type PeerSyncState = 'at-tip' | 'behind' | 'ahead' | 'unknown';

export interface PeerSyncReadout {
  state: PeerSyncState;
  /** Absolute block distance between the peer's best-known header and our
   *  tip. 0 for `at-tip` and for `unknown`, which carries no distance. */
  delta: number;
  label: string;
  color: string;
}

export interface PeerLinkFactRow {
  facet: PeerLinkFacet;
  label: string;
  value: string;
  color?: string;
}

export interface PeerLinkInstrument {
  nodeId: string;
  /** Header identity — a PeerId is far too long to print whole. */
  id8: string;
  direction: PeerDirection;
  directionBadge: 'IN' | 'OUT';
  /** Compass ring [0,1]; 1 is the 400ms cap rim. Unknown latency lands mid. */
  ring01: number;
  /** Compass bearing, the scene's own id-hash angle. */
  bearingRad: number;
  latencyMs: number | null;
  latencyKnown: boolean;
  localTip: number;
  peerBest: number | null;
  sync: PeerSyncReadout;
  versionMismatch: boolean;
  colorKind: PeerColorKind;
  accent: string;
  uptimeMs: number;
  facts: readonly PeerLinkFactRow[];
}

/** `3h 12m` / `47m` / `9s` — the link's own age, not a wall clock. */
export function formatLinkUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function blocks(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Where the peer's chain head sits relative to ours. AHEAD is a first-class
 * state: it means our node is the one behind, which is the single most
 * actionable thing this card can say.
 */
export function peerSyncReadout(
  bestKnown: number | null | undefined,
  tip: number,
): PeerSyncReadout {
  if (
    bestKnown == null
    || !Number.isFinite(bestKnown)
    || !Number.isFinite(tip)
  ) {
    return { state: 'unknown', delta: 0, label: 'UNCHARTED', color: HUD_COLORS.dim };
  }
  if (bestKnown > tip) {
    const delta = bestKnown - tip;
    return { state: 'ahead', delta, label: `${blocks(delta)} AHEAD`, color: HUD_COLORS.danger };
  }
  if (bestKnown === tip) {
    return { state: 'at-tip', delta: 0, label: 'AT TIP', color: HUD_COLORS.nominal };
  }
  const delta = tip - bestKnown;
  return { state: 'behind', delta, label: `${blocks(delta)} BEHIND`, color: HUD_COLORS.caution };
}

/** Two non-empty versions that disagree. An unreported version is silence,
 *  never a mismatch — the scene draws it the same way. */
export function peerVersionMismatch(peer: Peer, localVersion: string): boolean {
  return Boolean(localVersion && peer.version && peer.version !== localVersion);
}

export function derivePeerLinkInstrument(
  peer: Peer,
  tip: number,
  localVersion: string,
): PeerLinkInstrument {
  const latencyMs = peer.latency_ms == null || !Number.isFinite(peer.latency_ms)
    ? null
    : peer.latency_ms;
  const sync = peerSyncReadout(peer.best_known, tip);
  const versionMismatch = peerVersionMismatch(peer, localVersion);
  const colorKind = peerColorKind(peer, localVersion);
  const accent = PEER_LINK_ACCENT_HEX[colorKind];
  const peerBest = peer.best_known == null || !Number.isFinite(peer.best_known)
    ? null
    : peer.best_known;
  const facts: PeerLinkFactRow[] = [
    { facet: 'addr', label: 'ADDR', value: peer.addr || PEER_LINK_UNKNOWN },
    {
      facet: 'direction',
      label: 'DIRECTION',
      value: peer.direction.toUpperCase(),
      color: PEER_LINK_ACCENT_HEX[peer.direction],
    },
    {
      facet: 'version',
      label: 'VERSION',
      value: peer.version || PEER_LINK_UNKNOWN,
      color: versionMismatch ? PEER_NETWORK_HEX.version : undefined,
    },
    {
      facet: 'ping',
      label: 'PING',
      value: latencyMs == null ? PEER_LINK_UNKNOWN : `${latencyMs} MS`,
    },
    { facet: 'sync', label: 'SYNC', value: sync.label, color: sync.color },
    { facet: 'uptime', label: 'UPTIME', value: formatLinkUptime(peer.connected_ms) },
  ];
  return {
    nodeId: peer.node_id,
    id8: peer.node_id.slice(0, 8),
    direction: peer.direction,
    directionBadge: peer.direction === 'inbound' ? 'IN' : 'OUT',
    ring01: latencyToRadius01(peer.latency_ms),
    bearingRad: peerAngle(peer.node_id),
    latencyMs,
    latencyKnown: latencyMs !== null,
    localTip: tip,
    peerBest,
    sync,
    versionMismatch,
    colorKind,
    accent,
    uptimeMs: peer.connected_ms,
    facts,
  };
}

/** The card props the accent is a function of. The SYNC facet is judged
 *  against our own tip, so the tip travels with the peer. */
export interface PeerLinkAccentInput {
  peer: Peer;
  tip: number;
  localVersion: string;
}

/**
 * Connector tint for the selected fact — the peer dialect's
 * `selectedCellScanAccent`. A selected facet re-tints the leader line with the
 * colour that facet's own instrument is already speaking, so the line names
 * what is being read and not merely that something is.
 *
 * Which means there are exactly two answers a branch may give: the colour that
 * facet's own row carries, or — when the row carries none — the card's accent,
 * which is what the row falls back to on screen. A third colour is a line
 * pointing at a fact painted in something the fact is not wearing.
 *
 * Two branches used to give one. VERSION answered `nominal` whenever the two
 * versions AGREED — a green that appears nowhere else on the card and means
 * "state OK" everywhere else in the HUD, over a row whose own colour is
 * `undefined` and which therefore prints in the peer plane's wire. PING
 * answered chrome `cyanWire` always, which is the instrument's frame rather
 * than any reading on it. Both were the same shape of oversight: a facet with
 * nothing of its own to say, answered with an invention instead of a
 * fallthrough. ADDR and UPTIME are the other two colourless facets and both
 * fell through correctly, which is what made these two read as omissions
 * rather than as a rule.
 */
export function selectedPeerLinkAccent(
  input: PeerLinkAccentInput,
  facet: PeerLinkFacet | null,
): string {
  const { peer, tip, localVersion } = input;
  if (facet === 'sync') return peerSyncReadout(peer.best_known, tip).color;
  if (facet === 'version' && peerVersionMismatch(peer, localVersion)) {
    return PEER_NETWORK_HEX.version;
  }
  return PEER_LINK_ACCENT_HEX[peerColorKind(peer, localVersion)];
}
