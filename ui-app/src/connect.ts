// Bootstrap fetch helpers for the cknerv backend. Same-origin —
// `cknerv-cli`'s axum server hosts both the API routes and the SPA
// bundle on a single port, so an empty `API_BASE` resolves correctly
// against `window.location.origin`.

import { cellsSnapshotFromColumnar, decodeCellsColumnar } from '@cknerv/cache';
import type {
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
  Peer,
} from '@cknerv/types';

const API_BASE = '';

/** Wire shape of `/api/entities/chain/snapshot`. The chain-entities
 *  endpoint returns the Chain entity + chain_nodes inline rather than
 *  wrapping in a `snapshot` field (see cknerv-server `ServerState::snapshot`). */
export interface ChainSnapshotResponse {
  revision: number;
  chain: ChainEntry;
  chain_nodes?: ChainNode[];
  peers?: Peer[];
}

/** Wire shape of `/api/projections/:name/snapshot`. Projection endpoints
 *  wrap the snapshot payload in a `snapshot` field for parity with the
 *  WebSocket frame protocol. */
export interface ProjectionSnapshotResponse<T> {
  revision: number;
  snapshot: T;
}

export async function fetchChainSnapshot(): Promise<ChainSnapshotResponse> {
  const resp = await fetch(`${API_BASE}/api/entities/chain/snapshot`);
  if (!resp.ok) throw new Error(`chain snapshot: ${resp.status}`);
  return resp.json();
}

/** The cell galaxy, columnar when the server offers it.
 *
 * The columnar form is the same snapshot in a shape the main thread mostly
 * does not have to parse. Measured end to end against a live mainnet
 * server: 23.4MB and 73.9ms to `JSON.parse`, against 11.9MB and 43.7ms to
 * decode plus rebuild — and a 501-row field-by-field diff of the two
 * results, both hashes included, with no mismatches. Anything at all going
 * wrong — an older server that 404s the route, an unknown format
 * version, a truncated buffer — falls back to JSON, because a slower boot
 * is a cost and a failed boot is a bug. */
export async function fetchCellsSnapshot(): Promise<
  ProjectionSnapshotResponse<CellGalaxySnapshot>
> {
  try {
    const resp = await fetch(`${API_BASE}/api/projections/cells/snapshot.bin`);
    if (resp.ok) {
      const view = decodeCellsColumnar(await resp.arrayBuffer());
      return { revision: view.revision, snapshot: cellsSnapshotFromColumnar(view) };
    }
  } catch (error) {
    console.warn('columnar cells snapshot unusable; falling back to JSON', error);
  }
  const resp = await fetch(`${API_BASE}/api/projections/cells/snapshot`);
  if (!resp.ok) throw new Error(`cells snapshot: ${resp.status}`);
  return resp.json();
}
