// The browser's end of `GET /api/cells/:tx_hash/:output_index/data` — one
// Cell output's COMPLETE data, and a session memo for what came back.
//
// Deliberately not part of `semanticsClient.ts`, and the separation is the
// same one the server drew when `CellDataReader` was kept out of
// `EnrichmentSource` (the user's E5 ruling of 2026-09-04): these bytes are
// canonical chain truth read from the node, not an index's opinion about a
// Cell. The route therefore exists in CKB-only mode, where the entire
// enrichment surface is absent, and a client that lived beside the enrichment
// lookups would suggest it travels with them.
//
// Everything else in this cache holds a Cell's data as a bounded PREFIX beside
// its true length — 1 KiB direct, 4 KiB through an index, with `data_bytes`
// stating what was left behind. That is the right trade for ten thousand
// staged Cells at once and the wrong one for the single Cell a reader has
// opened, where the payload IS the subject. 93 of the 10,356 staged residents
// hold more than the prefix; this is the only way to see the rest of them.

import type { OutPoint } from '@cknerv/types';

import { outPointKey } from './semanticsReducer';

/** One Cell output's complete data, as the browser received it.
 *
 *  `totalBytes` is what the route PROMISED in `x-cell-data-bytes`, checked
 *  against `bytes.length` on arrival, so the two agree by construction. Both
 *  are carried because the reader reads the length as a stated fact about the
 *  payload — the same way the card reads `Cell.data_bytes` — rather than
 *  measuring whatever happened to be retained. */
export interface CellOutputData {
  bytes: Uint8Array;
  totalBytes: number;
  dataHash: string;
  live: boolean;
}

/** A fault this route reported, as one message.
 *
 *  The twin of `semanticsClient`'s `enrichmentError`, and it can be a twin
 *  because M2 wrote the data route's failures in the enrichment routes'
 *  `{"error","message"}` shape on purpose: one client-side reader of that
 *  shape covers every route on this server. The status stays the fallback for
 *  the answer that never reached the handler at all — a proxy's own error
 *  page, a dev server serving `index.html` for an unknown path. */
async function cellDataFault(response: Response): Promise<Error> {
  let message = `Cell data failed with HTTP ${response.status}`;
  try {
    const body = await response.json() as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // The HTTP status remains a useful fallback.
  }
  return new Error(message);
}

/** One header a 200 from this route always carries, or a fault.
 *
 *  The three `x-cell-*` headers are not decoration: they are how the client
 *  checks what it received against what was promised without parsing the body.
 *  A 200 without them did not come from this handler, and the alternative to
 *  failing is inventing — a hash nobody computed, a live/dead status nobody
 *  answered — which would put a fiction under the reader's own caption. */
function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value === '') {
    throw new Error(`Cell data answered without ${name}`);
  }
  return value;
}

/** Fetch one Cell output's complete data from the node, through cknerv.
 *
 *  `404` is an absence rather than a fault, and both of the route's 404s land
 *  here: `cell_unknown` (chain truth was consulted and knows no such output)
 *  and `cell_data_unavailable` (no node is configured to read one). They are
 *  different sentences on the server because it answers them differently; to
 *  a reader they are the same sentence — there are no bytes to show — so they
 *  collapse into `null`, exactly as `fetchCellSemantics` collapses its own.
 *
 *  Nothing here touches the memo below. The browser's HTTP cache already does
 *  the second-open work (the response carries `immutable` with a year's
 *  max-age, which is honest because an outpoint's bytes cannot change), so
 *  what the memo is for is a synchronous re-open inside one session — and
 *  WHEN to spend memory on that is the caller's judgement, not this
 *  function's. The precedent is `fetchPeerSighting`/`rememberPeerSighting`,
 *  where the write is likewise the caller's to ask for. */
export async function fetchCellOutputData(
  outPoint: OutPoint,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<CellOutputData | null> {
  const base = options.baseUrl?.replace(/\/$/, '') ?? '';
  const response = await fetch(
    `${base}/api/cells/${encodeURIComponent(outPoint.tx_hash)}/${outPoint.index}/data`,
    { signal: options.signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await cellDataFault(response);

  const declared = requiredHeader(response, 'x-cell-data-bytes');
  const totalBytes = Number(declared);
  if (!Number.isInteger(totalBytes) || totalBytes < 0) {
    throw new Error(`Cell data declared an unreadable length: ${declared}`);
  }
  const dataHash = requiredHeader(response, 'x-cell-data-hash');
  const status = requiredHeader(response, 'x-cell-status');
  if (status !== 'live' && status !== 'dead') {
    throw new Error(`Cell data answered with an unknown status: ${status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  // A payload that arrived short is the one failure the reader could not see
  // for itself: short bytes still draw as rows, and the missing tail would
  // read as a Cell that ends where the connection did. The declared length is
  // what the rest of the HUD already believes (`Cell.data_bytes`), so a
  // disagreement here is a fault rather than a smaller answer.
  if (bytes.length !== totalBytes) {
    throw new Error(`Cell data arrived short: ${bytes.length} of ${totalBytes} bytes`);
  }
  return { bytes, totalBytes, dataHash, live: status === 'live' };
}

/** How many bytes of Cell data one session will hold at once.
 *
 *  Enough for the whole tail of the distribution several times over — the
 *  largest staged payload is 37,314 bytes, and the route itself refuses
 *  anything over 2 MiB — so in practice the cap is never the thing that
 *  decides, which is the point. It is a ceiling on what an afternoon of
 *  opening Cells can accumulate, not a working set anybody has to size. */
export const CELL_DATA_MEMO_BYTES = 8 * 1024 * 1024;

// Insertion order IS the recency order: a `Map` iterates oldest-first, and the
// two functions below re-insert on read, so `keys().next()` is always the
// least recently used entry. The same shape as the peer sighting memo, with
// one thing missing — that memo empties when the source identity changes,
// because a source that reconnected or was swapped out has a different memory.
// There is no identity to key on here and nothing to invalidate against: an
// output is written once and afterwards only spent, so `(tx_hash, index)`
// names the same bytes forever. That property is what let the route promise an
// immutable response, and it is why this memo only ever forgets to make room.
const cellDataMemo = new Map<string, CellOutputData>();
let cellDataMemoBytes = 0;

/** What this session already holds for `outPoint`, or `null`.
 *
 *  A hit is what keeps a re-opened reader from flashing its ghost rows: the
 *  bytes are there before the first paint, with no request and no phase to
 *  pass through. Recalling counts as use — the entry moves to the young end. */
export function recallCellOutputData(outPoint: OutPoint): CellOutputData | null {
  const key = outPointKey(outPoint);
  const held = cellDataMemo.get(key);
  if (held === undefined) return null;
  cellDataMemo.delete(key);
  cellDataMemo.set(key, held);
  return held;
}

/** Hold one Cell's bytes for the rest of the session, oldest out first. */
export function rememberCellOutputData(outPoint: OutPoint, data: CellOutputData): void {
  const key = outPointKey(outPoint);
  const previous = cellDataMemo.get(key);
  if (previous !== undefined) {
    cellDataMemo.delete(key);
    cellDataMemoBytes -= previous.bytes.length;
  }
  // A payload larger than the whole cap is not remembered at all — evicting
  // everything else to hold one Cell would trade a session's worth of instant
  // re-opens for a single one. Nothing is lost by refusing: the browser's HTTP
  // cache still has the response, so re-opening that Cell costs a round trip
  // through the cache rather than a round trip to the node.
  if (data.bytes.length > CELL_DATA_MEMO_BYTES) return;
  while (cellDataMemoBytes + data.bytes.length > CELL_DATA_MEMO_BYTES) {
    const oldest = cellDataMemo.keys().next();
    if (oldest.done) break;
    const evicted = cellDataMemo.get(oldest.value);
    cellDataMemo.delete(oldest.value);
    if (evicted !== undefined) cellDataMemoBytes -= evicted.bytes.length;
  }
  cellDataMemo.set(key, data);
  cellDataMemoBytes += data.bytes.length;
}

/** Forget every payload this session is holding. For tests, and for a client
 *  that is tearing its transport down entirely. */
export function clearCellDataMemo(): void {
  cellDataMemo.clear();
  cellDataMemoBytes = 0;
}
