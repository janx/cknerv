// Bootstrap fetch helpers for the cknerv backend. Same-origin —
// `cknerv-cli`'s axum server hosts both the API routes and the SPA
// bundle on a single port, so an empty `API_BASE` resolves correctly
// against `window.location.origin`.

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

export async function fetchCellsSnapshot(): Promise<
  ProjectionSnapshotResponse<CellGalaxySnapshot>
> {
  const resp = await fetch(`${API_BASE}/api/projections/cells/snapshot`);
  if (!resp.ok) throw new Error(`cells snapshot: ${resp.status}`);
  return resp.json();
}
