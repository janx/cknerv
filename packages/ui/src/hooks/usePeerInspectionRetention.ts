import { useEffect, useRef } from 'react';
import type { Peer } from '@cknerv/types';
import type { Vec3 } from '../types';

/**
 * LINK LOST retention — the peer dialect's lifecycle epilogue.
 *
 * Churn is the peer's native ending: when a link drops, the `Peer` record AND
 * its colony node vanish from the same poll, so an inspector reading live data
 * would blank mid-sentence. This hook keeps the last honest pair — snapshot
 * plus the anchor point it was drawn at — so the card can say the link is gone
 * instead of silently disappearing, then retires the selection on its own.
 *
 * Retention is per selection: reselecting anything drops the snapshot at once,
 * and a peer that returns while the epilogue runs cancels it (the link was
 * never lost, only unobserved for a poll).
 */

/** How long a lost link is held on screen before the selection is retired.
 *  Long enough to read the banner, short enough to stay an epilogue. Reduced
 *  motion changes the banner's presentation, never this duration. */
export const PEER_LINK_LOST_HOLD_MS = 2400;

export interface PeerInspectionRetentionInput {
  /** Selection identity (`peer:<node_id>`), or null when no peer is selected.
   *  A change here is a new subject, never a continuation of the old one. */
  selectionKey: string | null;
  /** The live peer for that selection, null once it leaves `peers[]`. */
  peer: Peer | null;
  /** Colony-space anchor from the current topology. Latency moves the node
   *  between polls, so the latest live position is the one retained. */
  position: Vec3 | null;
  /** Fired once the epilogue has run its course; App clears the selection. */
  onExpire: () => void;
  holdMs?: number;
}

export interface PeerInspectionRetention {
  /** Peer to render: the live record, or the retained snapshot after churn. */
  peer: Peer | null;
  /** Anchor point for the scene half, retained alongside the snapshot. */
  position: Vec3 | null;
  /** The subject outlived its live record — the card speaks in past tense. */
  linkLost: boolean;
}

interface RetainedPeerLink {
  key: string;
  peer: Peer;
  position: Vec3;
}

const IDLE: PeerInspectionRetention = {
  peer: null,
  position: null,
  linkLost: false,
};

export function usePeerInspectionRetention({
  selectionKey,
  peer,
  position,
  onExpire,
  holdMs = PEER_LINK_LOST_HOLD_MS,
}: PeerInspectionRetentionInput): PeerInspectionRetention {
  const retainedRef = useRef<RetainedPeerLink | null>(null);
  // Retention happens in render, not in an effect: the peer and its node are
  // already gone by the time an effect for this render could run, so an
  // effect-based copy would only ever capture the absence. Re-running this
  // with the same inputs writes the same snapshot, so a repeated render is a
  // no-op rather than a second observation.
  const prior = retainedRef.current?.key === selectionKey
    ? retainedRef.current
    : null;
  let retained = prior;
  if (selectionKey === null) {
    retained = null;
  } else if (peer !== null) {
    const anchor = position ?? prior?.position ?? null;
    retained = anchor === null ? null : { key: selectionKey, peer, position: anchor };
  }
  retainedRef.current = retained;

  const linkLost = retained !== null && peer === null;

  // The expiry callback is read through a ref so a caller that re-creates it
  // per render cannot restart the epilogue; only losing the link starts it.
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!linkLost) return;
    const timer = setTimeout(() => expireRef.current(), holdMs);
    return () => clearTimeout(timer);
  }, [linkLost, selectionKey, holdMs]);

  if (retained === null) return IDLE;
  return { peer: retained.peer, position: retained.position, linkLost };
}
