import type {
  CellSemanticRecord,
  OutPoint,
  PeerSightingLookup,
  TransactionSemanticRecord,
} from '@cknerv/types';

interface CellEnrichmentResponse {
  cell: CellSemanticRecord;
}

interface TransactionEnrichmentResponse {
  transaction: TransactionSemanticRecord;
}

async function enrichmentError(response: Response, subject: string): Promise<Error> {
  let message = `${subject} enrichment failed with HTTP ${response.status}`;
  try {
    const body = await response.json() as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // The HTTP status remains a useful fallback.
  }
  return new Error(message);
}

/** Fetch selected-Cell semantics through cknerv. Browsers never contact the
 * configured ckbadger service directly. */
export async function fetchCellSemantics(
  outPoint: OutPoint,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<CellSemanticRecord | null> {
  const base = options.baseUrl?.replace(/\/$/, '') ?? '';
  const response = await fetch(
    `${base}/api/enrichment/cells/${encodeURIComponent(outPoint.tx_hash)}/${outPoint.index}`,
    { signal: options.signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await enrichmentError(response, 'Cell');
  const payload = await response.json() as CellEnrichmentResponse;
  return payload.cell;
}

/** Fetch one selected Cell's origin-transaction semantics through cknerv. */
export async function fetchTransactionSemantics(
  txHash: string,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<TransactionSemanticRecord | null> {
  const base = options.baseUrl?.replace(/\/$/, '') ?? '';
  const response = await fetch(
    `${base}/api/enrichment/transactions/${encodeURIComponent(txHash)}`,
    { signal: options.signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await enrichmentError(response, 'Transaction');
  const payload = await response.json() as TransactionEnrichmentResponse;
  return payload.transaction;
}

/** Every answer the peer route can give, as one value. The chain lookups
 *  collapse "no source" and "no record" into `null` because both mean the
 *  same thing for a Cell; a peer's silence does not — "the crawler has never
 *  seen this node from outside" is an observation, and only `disabled` means
 *  nothing was asked. Faults still throw, as they do for a Cell. */
export type PeerSightingOutcome =
  | PeerSightingLookup
  | { state: 'disabled' };

/**
 * Fetch how the configured source's crawler last saw one network peer.
 *
 * The only enrichment lookup keyed by a node id rather than a chain object,
 * and the only one with no projection slot to land in: nothing caches it
 * server-side, so the session memo below is the whole of its memory.
 */
export async function fetchPeerSighting(
  nodeId: string,
  options: {
    baseUrl?: string;
    signal?: AbortSignal;
    /** Source identity this answer belongs to; supplying it memoizes the
     *  outcome for the session. Omit to leave the memo untouched. */
    cacheIdentity?: string;
  } = {},
): Promise<PeerSightingOutcome> {
  const base = options.baseUrl?.replace(/\/$/, '') ?? '';
  const response = await fetch(
    `${base}/api/enrichment/peers/${encodeURIComponent(nodeId)}`,
    { signal: options.signal },
  );
  if (response.status === 404) return { state: 'disabled' };
  if (!response.ok) throw await enrichmentError(response, 'Peer');
  const payload = await response.json() as PeerSightingLookup;
  // The discriminant is what the plate renders from, so an answer without one
  // is a fault rather than an absence — absences say why they are absent.
  if (payload?.state !== 'sighted' && payload?.state !== 'unsighted') {
    throw new Error('Peer sighting response carried no state');
  }
  if (options.cacheIdentity !== undefined) {
    rememberPeerSighting(nodeId, options.cacheIdentity, payload);
  }
  return payload;
}

/** A handful of open cards' worth of sightings. The memo exists so returning
 *  to a peer inside one session is free, not so the app can hold a network
 *  census — the oldest entry leaves once the ring is full. */
const PEER_SIGHTING_MEMO_CAP = 64;

let peerSightingMemoIdentity: string | null = null;
const peerSightingMemo = new Map<string, PeerSightingOutcome>();

function resetPeerSightingMemo(identity: string): void {
  if (peerSightingMemoIdentity === identity) return;
  peerSightingMemoIdentity = identity;
  peerSightingMemo.clear();
}

/** What this session already learned about `nodeId`, or `null`. `identity`
 *  names the source and health the entries were observed through: a source
 *  that reconnected, went stale or was swapped out has a different memory,
 *  so the memo empties rather than answering for it. */
export function cachedPeerSighting(
  nodeId: string,
  identity: string,
): PeerSightingOutcome | null {
  resetPeerSightingMemo(identity);
  return peerSightingMemo.get(nodeId) ?? null;
}

export function rememberPeerSighting(
  nodeId: string,
  identity: string,
  outcome: PeerSightingOutcome,
): void {
  resetPeerSightingMemo(identity);
  peerSightingMemo.delete(nodeId);
  peerSightingMemo.set(nodeId, outcome);
  while (peerSightingMemo.size > PEER_SIGHTING_MEMO_CAP) {
    const oldest = peerSightingMemo.keys().next();
    if (oldest.done) break;
    peerSightingMemo.delete(oldest.value);
  }
}

/** Forget every sighting this session learned. For tests and for a client
 *  that tears its enrichment transport down entirely. */
export function clearPeerSightingMemo(): void {
  peerSightingMemoIdentity = null;
  peerSightingMemo.clear();
}
